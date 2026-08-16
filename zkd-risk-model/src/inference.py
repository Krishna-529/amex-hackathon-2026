"""Real scoring function: loads the artifact train.py produced and turns a
feature vector into a calibrated cancellation probability. Used by:
  - serve.py (local HTTP endpoint, for `npm run dev` against zkd-app)
  - handler.py (the same function, wrapped as the AWS Lambda batch/event
    scorer — see zkd-risk-model/infra/scoring.tf)

No fallback branch that invents a number when the model or an entity's
history is missing: cold-start entities fall back to the trained
global_prior (the honest population base rate, not a guess), and the
feature dict itself must be provided by the caller — this module never
reaches out to a network for data itself.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import xgboost as xgb


def _default_models_dir() -> Path:
    """Local dev layout is src/inference.py with models/ as a sibling of
    src/; the Lambda image (Dockerfile.scorer) flattens both into the same
    LAMBDA_TASK_ROOT with models/ as a direct subdirectory. Try both rather
    than hardcode one — MODELS_DIR env var overrides either."""
    if os.environ.get("MODELS_DIR"):
        return Path(os.environ["MODELS_DIR"])
    here = Path(__file__).resolve().parent
    sibling = here.parent / "models"
    nested = here / "models"
    return sibling if sibling.exists() else nested


MODELS = _default_models_dir()
FEATURE_COLS = json.loads((MODELS / "feature_columns.json").read_text())


class CancellationScorer:
    def __init__(self, models_dir: Path = MODELS):
        self.booster = xgb.Booster()
        self.booster.load_model(str(models_dir / "cancellation_model.json"))

        calib = np.load(models_dir / "calibrator_isotonic.npz")
        self.calib_x = calib["X_"]
        self.calib_y = calib["y_"]

        self.entity_rates = json.loads((models_dir / "entity_rates.json").read_text())
        self.model_version = self._model_hash(models_dir)

        # Synthetic Indian-market reference rates (data/synthetic/, built by
        # src/ingest_india_synthetic.py) — a SEPARATE table, never merged
        # into self.entity_rates, so it can never be mistaken for real
        # trained history. Optional: absent on a fresh checkout until that
        # script has been run, same "may not exist yet" treatment as
        # score_percentile_lookup.npy below.
        synthetic_path = models_dir / "entity_rates_synthetic.json"
        self.entity_rates_synthetic = json.loads(synthetic_path.read_text()) if synthetic_path.exists() else None

        # Percentile-rank lookup for riskScore (see score_distribution.py's
        # docstring) — produced by `python src/score_distribution.py`, not by
        # train.py itself, so it may not exist yet on a fresh checkout.
        # riskScore is simply omitted from score()'s output until it does;
        # never fabricated to fill the gap.
        lookup_path = models_dir / "score_percentile_lookup.npy"
        self.score_percentiles = np.load(lookup_path) if lookup_path.exists() else None

    @staticmethod
    def _model_hash(models_dir: Path) -> str:
        import hashlib
        h = hashlib.sha256((models_dir / "cancellation_model.json").read_bytes()).hexdigest()
        return h[:12]

    def _calibrate(self, raw: np.ndarray) -> np.ndarray:
        return np.interp(raw, self.calib_x, self.calib_y)

    def _risk_score(self, calibrated: float) -> float | None:
        """Percentile rank of this flight's calibrated probability against
        the real, live-realistic score distribution (score_distribution.py) —
        e.g. 75 means this flight's cancelProbability is higher than 75% of
        the 168,000 realistic live-flight scenarios we've scored. This is a
        RANK, not a probability: cancelProbability is the honest calibrated
        number (never touched here); riskScore exists only to give ops an
        intuitive, human-scaled 0-100 gate (config/risk-thresholds.json's
        altCache.prefetchAtOrAboveRiskScore) that stays meaningful even
        though this model's real probabilities never approach 100%."""
        if self.score_percentiles is None:
            return None
        rank = np.searchsorted(self.score_percentiles, calibrated) / len(self.score_percentiles) * 100
        return float(min(100.0, max(0.0, rank)))

    def entity_rate(self, kind: str, key: str) -> float:
        """Latest known smoothed historical rate for a carrier/origin/dest/
        route/origin_month key; the population prior when the entity was
        never seen in training (a real, stated cold-start, not an
        invented number)."""
        table = self.entity_rates.get(kind, {})
        return float(table.get(key, self.entity_rates["global_prior"]))

    def origin_hour_density(self, origin: str) -> float:
        table = self.entity_rates.get("origin_hour_density_avg", {})
        return float(table.get(origin, 1.0))

    def _dmatrix(self, features: dict) -> xgb.DMatrix:
        row = [[features.get(c, np.nan) if features.get(c) is not None else np.nan for c in FEATURE_COLS]]
        return xgb.DMatrix(np.array(row, dtype=float), missing=np.nan, feature_names=FEATURE_COLS)

    def score(self, features: dict, explain: bool = True) -> dict:
        """features must contain every key in FEATURE_COLS; missing optional
        ones (prior_leg_cancelled, sched_duration_min, distance_km) may be
        None/np.nan — the model handles that natively, it is not backfilled
        with a guess.

        `explain=True` (default) also returns real per-feature contributions
        via XGBoost's tree-SHAP (`pred_contribs=True`) — this is what
        server/engine/riskModel.ts surfaces as the audit "reasons", not a
        scripted sentence. Set False for the tight batch-scoring loop where
        the explanation is never displayed and the extra tree pass isn't
        worth paying for hundreds of flights at once.
        """
        dmat = self._dmatrix(features)
        raw = self.booster.predict(dmat)
        calibrated = float(self._calibrate(raw)[0])
        confidence = self._confidence(features)
        risk_score = self._risk_score(calibrated)

        out = {
            "cancelProbability": round(calibrated, 4),
            "confidence": round(confidence, 3),
            "modelVersion": self.model_version,
            "source": "internal-ml",
        }
        if risk_score is not None:
            out["riskScore"] = round(risk_score, 1)
        if explain:
            out["explanation"] = self.explain(features, dmat=dmat)
        return out

    def explain(self, features: dict, dmat: xgb.DMatrix | None = None) -> dict:
        """Real SHAP-style additive feature contributions (XGBoost tree-SHAP,
        `pred_contribs=True`) — exact for this tree ensemble, not an
        approximation or a post-hoc guess. Units are LOG-ODDS (the model's
        margin space before the sigmoid and before isotonic calibration):
        contributions sum exactly to `raw_margin - bias`, and
        `sigmoid(bias + sum(contributions)) == raw uncalibrated probability`.
        They are NOT probability-percentage-point contributions — probability
        is not a linear function of these, so that number would be false
        precision. `relativeShare` (each |contribution| over the sum of all
        |contributions|) is the honest human-readable version: "how much of
        the swing away from baseline did this feature account for."
        """
        dmat = dmat if dmat is not None else self._dmatrix(features)
        contribs = self.booster.predict(dmat, pred_contribs=True)[0]  # len = FEATURE_COLS + 1 (bias last)
        bias = float(contribs[-1])
        per_feature = dict(zip(FEATURE_COLS, (float(c) for c in contribs[:-1])))
        total_abs = sum(abs(v) for v in per_feature.values()) or 1.0

        ranked = sorted(per_feature.items(), key=lambda kv: -abs(kv[1]))
        return {
            "biasMarginLogOdds": round(bias, 4),
            "features": [
                {
                    "feature": name,
                    "value": features.get(name),
                    "contributionLogOdds": round(contribution, 4),
                    "direction": "increases" if contribution > 0 else "decreases" if contribution < 0 else "neutral",
                    "relativeShare": round(abs(contribution) / total_abs, 4),
                }
                for name, contribution in ranked
            ],
        }

    def _confidence(self, features: dict) -> float:
        # Proxy: distance of the route/carrier historical rate from the
        # global prior, scaled — a route we have real, differentiated
        # history on produced a score that moved away from the population
        # average; one we don't sits at the prior and confidence is lower.
        prior = self.entity_rates["global_prior"]
        route_rate = features.get("route_hist_cancel_rate", prior)
        carrier_rate = features.get("carrier_hist_cancel_rate", prior)
        deviation = (abs(route_rate - prior) + abs(carrier_rate - prior)) / 2
        return float(min(1.0, 0.4 + deviation * 15))
