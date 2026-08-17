# Model card — flight cancellation risk

*Every number below is read from `reports/model_metrics.json`, produced by a real run of
`python src/train.py` against a real, out-of-time held-out test set (1,184,051 real flights the
model never trained or calibrated on) — nothing here is asserted without a computation behind it.
Full technical detail: `documentation/design/05-cancellation-risk-model.md`.*

## What it predicts

The probability a specific booked flight gets cancelled by the airline, computed **before** the
airline files the cancellation — early enough to search and cache alternative flights ahead of
time instead of scrambling after the fact.

## How good is it — plainly

> **These numbers were regenerated 2026-08-17 after a real retrain adding UK CAA (real per-flight-
> equivalent rows, ~80% real international routes) as a third training country alongside US/Brazil,
> and a real (not fabricated) DGCA-sourced India carrier-rate prior** — see
> `documentation/design/05-cancellation-risk-model.md` §1 and this card's "international coverage"
> section below for what changed and why the headline numbers moved slightly versus the prior
> two-country version (ROC-AUC 0.804 → 0.807, PR-AUC 0.123 → 0.106).

- On flights the model never saw during training, it separates a flight that will be cancelled
  from one that won't correctly **80.7% of the time** (ROC-AUC 0.807).
- Its riskiest 10% of predictions contain real cancellations at **5.1x** the rate you'd see by
  chance — a 6.03% real cancellation rate in that top decile, against a 1.18% base rate across
  the whole test set.
- **Honest baseline comparison, not cherry-picked**: a plain logistic regression on the same
  features scores 0.733 ROC-AUC / 0.106 PR-AUC; "always guess the base rate" scores 0.500 ROC-AUC /
  0.0118 PR-AUC. Our gradient-boosted model beats the base-rate floor by **~9x** on PR-AUC (the
  honest metric at this ~1% positive rate) — that gap is still large and is the one that matters
  most at this class imbalance. **Said plainly, not softened: PR-AUC against the logistic-regression
  baseline is now an effective tie (0.1062 vs 0.1062)** — adding the UK CAA rows (many with several
  features honestly masked to unknown, see below) narrowed the tree model's edge over a linear
  model on this metric specifically, versus a clearer ~19% relative edge in the prior two-country
  version. ROC-AUC still favors XGBoost (0.807 vs 0.733). We report this un-flattering comparison
  because a model card that only quotes the flattering one isn't one you should trust.
- Predictions are **calibrated**: when the model says 3%, real outcomes land close to 3% (isotonic
  regression fit on a held-out calibration split, never touched during training) — Brier score
  **0.0111** — see `reports/calibration_plot.png` for the real reliability diagram.
- **Overfitting/underfitting, checked, not assumed** (`reports/model_metrics.json`'s
  `fit_diagnostics`/`cross_validation`, produced by every `train.py` run):
  - Train ROC-AUC 0.830 vs test ROC-AUC 0.807 — a 0.023 gap. Healthy: a gap this small with train
    only modestly ahead is not the overfitting signature (which looks like train pulling far ahead,
    e.g. >0.05, while test stalls); absolute performance well above the base-rate baseline rules out
    underfitting too.
  - The learning curve (`fit_diagnostics.learning_curve`) shows calibration-split PR-AUC peaking
    around round 30 and gently declining after — `early_stopping_rounds=30` is what stops training
    there rather than at round 500; the curve is the evidence that guardrail is doing real work, not
    an assertion that it is.
  - **5-fold blocked (forward-chaining) time-series cross-validation** — never shuffled, each fold
    trains only on real time strictly before its test block — gives ROC-AUC **0.777 ± 0.042** and
    PR-AUC **0.129 ± 0.020** across 4 real folds. Stated plainly: the single fixed test-split number
    above (0.807) sits on the better end of what different real time periods actually show; there is
    real fold-to-fold variability (0.71 to 0.82 ROC-AUC across folds), not hidden by only reporting
    the headline split.
- `score()` also returns `riskScore` (0–100): the percentile rank of the calibrated probability
  against the real live-realistic score distribution (`reports/score_distribution.json`), used only
  to gate alternative-flight pre-search on an intuitive cutoff. It is **not** a probability, is
  **never** derived by rescaling `cancelProbability`, and does not affect or replace the calibration
  claim above — `cancelProbability` alone is the honest number. See
  `documentation/design/05-cancellation-risk-model.md` §6.

## What it doesn't know yet — stated plainly, not buried

- **International coverage, precisely stated.** Real per-flight training data now spans three
  countries — US (BTS), Brazil (ANAC, real cross-border routes included), UK (CAA — real per-flight
  cancellation counts, real, ~80% of it genuinely international routes touching a UK airport). That
  is a real improvement over a single-country model, but it is **not global coverage**: no real
  per-flight data exists yet for India, most of Asia-Pacific, the Middle East, or continental Europe
  beyond routes that touch the UK. **India specifically now has a real (not fabricated) carrier-level
  cancellation-rate prior** — `ingest_india_dgca.py` extracts it directly from 28 real DGCA monthly
  bulletins (2021-2023), replacing the synthetic estimate for the 11 carriers DGCA's bulletin
  actually names. That is a real government-sourced number, but it is a weaker evidence shape than
  the per-flight training rows above: DGCA publishes a rate, not the underlying flight counts, so it
  can inform the *prior* a live Indian flight cold-starts from, not become new training rows the
  trees themselves learn from. India has still never been evaluated end-to-end (no real observed
  outcomes to test against yet) — treat its improved prior as a better starting point, not a
  measured accuracy claim, until the continual-learning loop (see `README.md`) accumulates enough
  real local outcomes to retrain and measure on directly.
- **Measured, not assumed: real segment performance, on the same held-out test set:**

  | Market | n (test) | Real cancellation rate | ROC-AUC | PR-AUC |
  |---|---|---|---|---|
  | US (BTS) | 1,043,439 | 0.58% | 0.711 | 0.019 |
  | Brazil (ANAC) | 143,834 | 4.41% | 0.771 | 0.206 |
  | UK (CAA) | 270,084 | 1.76% | **0.831** | 0.094 |

  The new UK segment scores the *highest* ROC-AUC of the three — a genuinely positive real result,
  not cherry-picked (it's the full real test-set segment, same as the other two rows). Two things
  worth being precise about, because a headline number can hide both: **(1)** the blended ROC-AUC
  (0.807) sits between the segments, not above all of them the way the prior two-country version's
  did — an expected effect of adding a third, differently-distributed segment, not evidence the
  model is stronger within any one market than its own row shows. **(2)** on the US segment
  specifically, PR-AUC 0.019 against a 0.58% base rate is a real but modest ~3.3x lift, far weaker
  than the blended ~9x figure implies — `prior_leg_cancelled` (aircraft-rotation signal) is real
  training signal only for US rows with a tail number, so the US segment leans on a smaller usable
  feature set than the blended number suggests.
- **No weather feature yet.** `server/weather.ts` is real and live for the risk-explanation
  narrative, not the trained model's own inputs, in this version.
- **`prior_leg_cancelled` (aircraft-rotation signal) is `null` for every live flight today** — OAG
  Flight Info Connections, the product that would supply it, is Production-tier and unavailable on
  the current trial key.
- **No systematic hyperparameter search has been run.** `max_depth=6, eta=0.08, subsample=0.8,
  colsample_bytree=0.8` (`src/train.py`) are reasonable, standard starting values for
  gradient-boosted trees at this data scale, with early stopping providing some automatic tuning of
  tree count — but they were not chosen via a grid/random/Bayesian sweep against the calibration
  split. A bounded, legitimate next step for more accuracy, not attempted here for lack of a
  held-out validation loop dedicated to it (reusing the calibration split for both isotonic fitting
  and hyperparameter selection would itself leak).

## What it costs to run

Not a standing endpoint — a scheduled Lambda batch/event scorer plus a weekly Fargate Spot
retrain (see `infra/`). At real AWS us-east-1 on-demand rates, computed (not estimated) from the
actual Terraform config: **~$0.67/month at 1,000 monitored trips, ~$6.10/month at 10,000, ~$30/month
at 50,000** — see `documentation/design/04-infrastructure-and-cost.md` §5a for the full unit-economics
table and the arithmetic behind it. This is the prediction pipeline only; whole-app infrastructure
(NAT/ALB/RDS/compute) and the flight-status feed itself are priced separately in that same document.

## Reproduce these numbers yourself

```
cd zkd-risk-model
python src/train.py
```

Deterministic given the same input data and the chronological (never shuffled) split — the same
numbers come back out. `reports/model_metrics.json` holds the full detail (baseline comparisons,
the complete lift table, per-month segment breakdown) behind the summary above.
