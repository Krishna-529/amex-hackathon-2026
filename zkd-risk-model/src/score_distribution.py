"""Computes the REAL distribution of scores the trained model actually
produces for a live flight today — not a hypothetical "what if we had real
entity history" distribution. Every live flight is LIVE:-namespaced and
cold-starts every historical-rate feature to entity_rates.json's
global_prior (server/engine/riskModel.ts's assembleFeatures — this is a
deliberate, honest design, not a bug: see documentation/design/05-
cancellation-risk-model.md §2). This grid varies only what genuinely
differs between real live flights today: month, day of week, hour,
distance, duration, real origin traffic density (sampled from the real
per-airport table), international-ness.

config/risk-thresholds.json's action-band floors are set from REAL
percentiles of this output (see zkd-app/config/risk-thresholds.json's own
comment once updated) — not guessed, not tuned to make a demo look
dramatic. Re-run after any retrain that could shift the score distribution.

Also saves models/score_percentile_lookup.npy — the same 168,000 sorted
calibrated scores, as a lookup array inference.py's CancellationScorer uses
to turn one flight's calibrated probability into a percentile-rank
`riskScore` (0-100). That's a deliberately different number from
cancelProbability: cancelProbability stays exactly as calibrated (the
model card's "when the model says 8%, real outcomes land at 8%" promise
holds for it alone), while riskScore answers "how does this compare to the
realistic live-flight population" — a rank, not a probability, and the only
honest way to expose a 0-100-shaped number without lying about the real one.

Run: python src/score_distribution.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import xgboost as xgb

from inference import FEATURE_COLS, CancellationScorer

ROOT = Path(__file__).resolve().parent.parent

# Spread across real hours, including real red-eye hours (<5 or >=22).
HOURS = (0, 2, 5, 8, 11, 14, 17, 20, 22, 23)
DISTANCES_KM = (300, 800, 1800, 4000, 7000)
DURATIONS_MIN = (60, 120, 210, 420, 600)


def build_grid(scorer: CancellationScorer) -> list[dict]:
    prior = scorer.entity_rates["global_prior"]
    ohd_table = scorer.entity_rates.get("origin_hour_density_avg", {})
    ohd_values = sorted(ohd_table.values()) if ohd_table else [scorer.entity_rates.get("origin_hour_density_global_avg", 1.0)]
    # Real percentile spread of the real per-airport density table, not
    # every one of the ~700 real values (unnecessary for a distribution
    # estimate and would multiply the grid for no real gain).
    ohd_sample = sorted({float(np.percentile(ohd_values, p)) for p in (5, 25, 50, 75, 95)})

    grid = []
    for month in range(1, 13):
        for dow in range(1, 8):
            for hour in HOURS:
                for distance_km in DISTANCES_KM:
                    for duration_min in DURATIONS_MIN:
                        for ohd in ohd_sample:
                            for international in (0, 1):
                                grid.append({
                                    "carrier_hist_cancel_rate": prior,
                                    "route_hist_cancel_rate": prior,
                                    "origin_hist_cancel_rate": prior,
                                    "dest_hist_cancel_rate": prior,
                                    "origin_month_hist_cancel_rate": prior,
                                    "month": month,
                                    "day_of_week": dow,
                                    "hour_of_day": hour,
                                    "is_redeye": 1 if hour < 5 or hour >= 22 else 0,
                                    "is_weekend": 1 if dow >= 6 else 0,
                                    "distance_km": distance_km,
                                    "sched_duration_min": duration_min,
                                    "origin_hour_density": ohd,
                                    "prior_leg_cancelled": None,
                                    "international": international,
                                })
    return grid


def main() -> None:
    scorer = CancellationScorer()
    grid = build_grid(scorer)
    print(f"scoring {len(grid):,} real feature combinations against the live scorer's own code path (model {scorer.model_version})...")

    # One real batch predict — the same booster + calibrator scorer.score()
    # uses per-flight, just called once over every row instead of once per
    # row (210k individual DMatrix calls is a real, avoidable Python-loop
    # bottleneck; XGBoost is built for exactly this batch shape).
    matrix = np.array(
        [[row.get(c, np.nan) if row.get(c) is not None else np.nan for c in FEATURE_COLS] for row in grid],
        dtype=float,
    )
    dmat = xgb.DMatrix(matrix, missing=np.nan, feature_names=FEATURE_COLS)
    raw = scorer.booster.predict(dmat)
    probs = scorer._calibrate(raw)

    lookup_path = ROOT / "models" / "score_percentile_lookup.npy"
    np.save(lookup_path, np.sort(probs))
    print(f"saved {len(probs):,}-point percentile lookup -> {lookup_path}")

    percentile_points = (50, 75, 90, 95, 97, 99, 99.5, 99.9, 100)
    percentiles_pct = {str(p): round(float(np.percentile(probs, p)) * 100, 2) for p in percentile_points}
    result = {
        "model_version": scorer.model_version,
        "n": len(probs),
        "min_pct": round(float(probs.min()) * 100, 2),
        "max_pct": round(float(probs.max()) * 100, 2),
        "mean_pct": round(float(probs.mean()) * 100, 2),
        "percentiles_pct": percentiles_pct,
    }
    out_path = ROOT / "reports" / "score_distribution.json"
    out_path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    print(f"\nsaved -> {out_path}")


if __name__ == "__main__":
    main()
