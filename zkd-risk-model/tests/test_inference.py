"""Real tests against the real trained artifact in models/ — no mocking of
the model itself, matching this project's no-mock ground rule. Requires
`python src/train.py` to have been run at least once (models/ populated),
same precondition local dev and CI both already need.
"""
import math

import pytest

from inference import CancellationScorer, FEATURE_COLS

REAL_FEATURES = {
    "carrier_hist_cancel_rate": 0.02, "route_hist_cancel_rate": 0.018,
    "origin_hist_cancel_rate": 0.015, "dest_hist_cancel_rate": 0.015,
    "origin_month_hist_cancel_rate": 0.02, "month": 6, "day_of_week": 3,
    "hour_of_day": 14, "is_redeye": 0, "is_weekend": 0,
    "distance_km": 1200.0, "sched_duration_min": 150, "origin_hour_density": 20,
    "prior_leg_cancelled": 0, "international": 0,
}


@pytest.fixture(scope="module")
def scorer() -> CancellationScorer:
    return CancellationScorer()


def test_loads_real_artifacts(scorer: CancellationScorer):
    assert scorer.booster is not None
    assert len(scorer.model_version) == 12  # sha256[:12] of the real model file
    assert "global_prior" in scorer.entity_rates
    assert 0 < scorer.entity_rates["global_prior"] < 1  # a real base rate, not a placeholder


def test_score_returns_a_real_bounded_probability(scorer: CancellationScorer):
    out = scorer.score(REAL_FEATURES)
    assert 0.0 <= out["cancelProbability"] <= 1.0
    assert 0.0 <= out["confidence"] <= 1.0
    assert out["source"] == "internal-ml"
    assert out["modelVersion"] == scorer.model_version


def test_risk_score_is_a_bounded_percentile_rank(scorer: CancellationScorer):
    """riskScore only appears once models/score_percentile_lookup.npy exists
    (python src/score_distribution.py) — same precondition as the other
    real-artifact tests in this file, not skipped/mocked."""
    if scorer.score_percentiles is None:
        pytest.skip("run python src/score_distribution.py to produce score_percentile_lookup.npy first")
    out = scorer.score(REAL_FEATURES)
    assert 0.0 <= out["riskScore"] <= 100.0


def test_risk_score_is_monotonic_in_calibrated_probability(scorer: CancellationScorer):
    """A feature combination with a higher calibrated cancelProbability must
    never get a lower riskScore than one with a lower probability — the
    whole point of a percentile rank is that it preserves order."""
    if scorer.score_percentiles is None:
        pytest.skip("run python src/score_distribution.py to produce score_percentile_lookup.npy first")
    prior = scorer.entity_rates["global_prior"]
    low = scorer.score({**REAL_FEATURES, "carrier_hist_cancel_rate": prior, "route_hist_cancel_rate": prior})
    high = scorer.score({**REAL_FEATURES, "carrier_hist_cancel_rate": prior * 5, "route_hist_cancel_rate": prior * 5})
    if high["cancelProbability"] > low["cancelProbability"]:
        assert high["riskScore"] >= low["riskScore"]


def test_explain_false_omits_explanation(scorer: CancellationScorer):
    out = scorer.score(REAL_FEATURES, explain=False)
    assert "explanation" not in out


def test_explanation_covers_every_feature_exactly_once(scorer: CancellationScorer):
    out = scorer.score(REAL_FEATURES, explain=True)
    names = [f["feature"] for f in out["explanation"]["features"]]
    assert sorted(names) == sorted(FEATURE_COLS)


def test_explanation_contributions_sum_to_the_real_raw_margin(scorer: CancellationScorer):
    """The exact mathematical invariant tree-SHAP guarantees, verified
    against THIS trained model — not asserted, computed. bias +
    sum(contributions) must equal the booster's own raw margin output
    (pre-sigmoid, pre-calibration) for the same input."""
    dmat = scorer._dmatrix(REAL_FEATURES)
    raw_margin = float(scorer.booster.predict(dmat, output_margin=True)[0])
    explanation = scorer.explain(REAL_FEATURES, dmat=dmat)
    computed = explanation["biasMarginLogOdds"] + sum(
        f["contributionLogOdds"] for f in explanation["features"]
    )
    assert math.isclose(raw_margin, computed, abs_tol=1e-3)


def test_relative_shares_are_a_real_partition(scorer: CancellationScorer):
    out = scorer.score(REAL_FEATURES, explain=True)
    shares = [f["relativeShare"] for f in out["explanation"]["features"]]
    assert all(0.0 <= s <= 1.0 for s in shares)
    assert math.isclose(sum(shares), 1.0, abs_tol=1e-2)


def test_missing_optional_features_do_not_crash(scorer: CancellationScorer):
    """prior_leg_cancelled is genuinely None for every live flight today
    (OAG Flight Info Connections is Production-tier, unavailable on trial —
    see server/oag.ts) — the model must handle that natively, not require
    a backfilled guess."""
    features = {**REAL_FEATURES, "prior_leg_cancelled": None, "distance_km": None}
    out = scorer.score(features)
    assert 0.0 <= out["cancelProbability"] <= 1.0


def test_cold_start_like_input_stays_bounded_with_lower_confidence(scorer: CancellationScorer):
    """A LIVE:-namespaced entity that fell back to the population prior for
    every historical-rate feature (server/engine/riskModel.ts's honest
    cold-start design) should score near the population base rate with
    reduced confidence, not an arbitrary or unbounded number."""
    prior = scorer.entity_rates["global_prior"]
    cold_start = {
        **REAL_FEATURES,
        "carrier_hist_cancel_rate": prior, "route_hist_cancel_rate": prior,
        "origin_hist_cancel_rate": prior, "dest_hist_cancel_rate": prior,
        "origin_month_hist_cancel_rate": prior,
    }
    out = scorer.score(cold_start)
    assert 0.0 <= out["cancelProbability"] <= 1.0
    assert math.isclose(out["confidence"], 0.4, abs_tol=1e-2)  # _confidence()'s floor at zero deviation
