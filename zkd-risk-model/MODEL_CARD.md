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

> **These numbers were regenerated 2026-08-15 after a real retrain that masked `prior_leg_cancelled`
> to null before training** (see `documentation/design/05-cancellation-risk-model.md` §1) — that
> feature is `null` for every live flight (OAG Flight Info Connections, the real source, is not
> available on this account), so an earlier version of this card reporting ROC-AUC 0.873 / PR-AUC
> 0.236 was measuring a model that could lean on a signal it never actually receives live. The
> numbers below are what a live prediction can actually reproduce.

- On flights the model never saw during training, it separates a flight that will be cancelled
  from one that won't correctly **80% of the time** (ROC-AUC 0.804).
- Its riskiest 10% of predictions contain real cancellations at **5.2x** the rate you'd see by
  chance — a 5.49% real cancellation rate in that top decile, against a 1.05% base rate across
  the whole test set.
- **Honest baseline comparison, not cherry-picked**: a plain logistic regression on the same
  features scores 0.742 ROC-AUC / 0.104 PR-AUC; "always guess the base rate" scores 0.500 ROC-AUC /
  0.0105 PR-AUC. Our gradient-boosted model beats the base-rate floor by **~12x** on PR-AUC (the
  honest metric at this ~1% positive rate) and the logistic-regression baseline by **~19%
  relative**. We are not claiming a dramatic leap over every baseline — the base-rate comparison is
  the one that actually matters at this class imbalance, and that gap is large; the logistic
  regression gap is real but more modest, and the honest reason to prefer the gradient-boosted
  model is as much its native handling of missing/cold-start features as raw ranking power. A model
  card that only quotes the flattering comparison isn't one you should trust; this one quotes all
  three.
- Predictions are **calibrated**: when the model says 3%, real outcomes land at 3% (isotonic
  regression fit on a held-out calibration split, never touched during training) — Brier score
  **0.0097** — see `reports/calibration_plot.png` for the real reliability diagram.
- `score()` also returns `riskScore` (0–100): the percentile rank of the calibrated probability
  against the real live-realistic score distribution (`reports/score_distribution.json`), used only
  to gate alternative-flight pre-search on an intuitive cutoff. It is **not** a probability, is
  **never** derived by rescaling `cancelProbability`, and does not affect or replace the calibration
  claim above — `cancelProbability` alone is the honest number. See
  `documentation/design/05-cancellation-risk-model.md` §6.

## What it doesn't know yet — stated plainly, not buried

- **No Indian/international outcome history exists yet.** Every live Indian/international flight
  cold-starts to the population base rate with reduced confidence, by design — see
  `documentation/design/05-cancellation-risk-model.md` §2.
- **Measured, not assumed: the model is markedly weaker on the US segment than the headline number
  suggests, and this REVERSED after the `prior_leg_cancelled` fix above.** Segment breakdown on the
  same held-out test set:

  | Market | n (test) | Real cancellation rate | ROC-AUC | PR-AUC |
  |---|---|---|---|---|
  | US (BTS) | 1,040,559 | 0.58% | 0.704 | 0.016 |
  | Brazil (ANAC) | 143,492 | 4.41% | 0.772 | 0.215 |

  Two things worth being precise about, because a headline number can hide both: **(1)** the
  blended ROC-AUC (0.804) is higher than *either* segment's own ROC-AUC (0.704 / 0.772) — a real,
  expected effect when segments have different base rates and the model can partly separate "which
  market is this" as a side channel, not a sign the model is stronger within a market than it is.
  **(2)** on the US segment specifically, PR-AUC 0.016 against a 0.58% base rate is only a ~2.7x
  lift — real, but far weaker than the blended 12x figure implies, and the segment that (before the
  leakage fix) looked like the *stronger* one is now the *weaker* one, because `prior_leg_cancelled`
  was disproportionately a US-only signal (BTS carries tail numbers; ANAC does not). **India has
  never been evaluated at all** — it is neither of these two segments — so treat both rows as an
  upper bound on what to expect there, not a floor, until the continual-learning loop (see
  `README.md`) accumulates enough real local outcomes to retrain on and measure directly.
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
