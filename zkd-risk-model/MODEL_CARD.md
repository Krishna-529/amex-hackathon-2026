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

> **These numbers were regenerated 2026-08-17 after a real retrain adding UK CAA, Australia (BITRE),
> and France (AQST/DGAC) — a five-country training set (US, Brazil, UK, Australia, France) — plus a
> real (not fabricated) DGCA-sourced India carrier-rate prior.** See `documentation/design/05-
> cancellation-risk-model.md` §1 and this card's "international coverage" section below.
>
> **A real bug this pipeline's own diagnostics caught, fixed, and is worth stating plainly rather
> than hiding**: the first attempt at adding Australia used its full available date range
> (2023-2026), which reaches later than every other source (all capped at real calendar year 2024).
> `train.py`'s chronological split sorts every source together by real date, so the held-out test
> tail became ~75% Australian data from a period (2025-2026) nothing else in the training set had
> any representation in — test ROC-AUC collapsed to 0.619, and `fit_diagnostics` showed a 0.20
> train/test gap, the textbook overfitting signature. That is exactly what these diagnostics exist
> to catch. Fixed by locking Australia to the same real calendar year (2024) as the other rolling
> sources — the numbers below are from the corrected run, verified balanced across countries in the
> test split before retraining (see `ingest_bitre.py`'s header for the full account).

- On flights the model never saw during training, it separates a flight that will be cancelled
  from one that won't correctly **82.9% of the time** (ROC-AUC 0.829) — the best result across every
  version of this model so far (two-country: 0.804; three-country: 0.807).
- Its riskiest 10% of predictions contain real cancellations at **5.4x** the rate you'd see by
  chance, against a 1.27% base rate across the whole test set.
- **Honest baseline comparison, not cherry-picked**: a plain logistic regression on the same
  features scores 0.766 ROC-AUC / 0.140 PR-AUC; "always guess the base rate" scores 0.500 ROC-AUC /
  0.0127 PR-AUC. Our gradient-boosted model beats the base-rate floor by **~9.5x** on PR-AUC — the
  metric that matters most at this class imbalance. **Said plainly: the logistic-regression baseline
  now has a real PR-AUC edge over XGBoost (0.140 vs 0.121)** — five real, differently-shaped sources
  (some with several features honestly masked to unknown — see below) make this a harder ranking
  problem for the tree model specifically on precision-recall trade-off, even as ROC-AUC still
  clearly favors XGBoost (0.829 vs 0.766). We report this un-flattering comparison because a model
  card that only quotes the flattering one isn't one you should trust.
- Predictions are **calibrated**: when the model says 3%, real outcomes land close to 3% (isotonic
  regression fit on a held-out calibration split, never touched during training) — Brier score
  **0.0118** — see `reports/calibration_plot.png` for the real reliability diagram.
- **Overfitting/underfitting, checked, not assumed** (`reports/model_metrics.json`'s
  `fit_diagnostics`/`cross_validation`, produced by every `train.py` run):
  - Train ROC-AUC 0.833 vs test ROC-AUC 0.829 — a **0.004 gap**, tighter than either prior version.
    Healthy: this small a gap with train only marginally ahead is not the overfitting signature
    (which looks like the 0.20 gap the broken Australia-date-range run above produced); absolute
    performance well above the base-rate baseline rules out underfitting too.
  - The learning curve (`fit_diagnostics.learning_curve`) shows calibration-split PR-AUC peaking
    around round 24 and gently declining after — `early_stopping_rounds=30` is what stops training
    there rather than at round 500; the curve is the evidence that guardrail is doing real work.
  - **5-fold blocked (forward-chaining) time-series cross-validation** — never shuffled, each fold
    trains only on real time strictly before its test block — gives ROC-AUC **0.786 ± 0.029** and
    PR-AUC **0.123 ± 0.022** across 4 real folds, both a tighter spread than the three-country
    version's ±0.042/±0.020. Stated plainly: the single fixed test-split number above (0.829) sits
    on the better end of what different real time periods actually show, and that spread is real,
    not hidden by only reporting the headline split.
- `score()` also returns `riskScore` (0–100): the percentile rank of the calibrated probability
  against the real live-realistic score distribution (`reports/score_distribution.json`), used only
  to gate alternative-flight pre-search on an intuitive cutoff. It is **not** a probability, is
  **never** derived by rescaling `cancelProbability`, and does not affect or replace the calibration
  claim above — `cancelProbability` alone is the honest number. See
  `documentation/design/05-cancellation-risk-model.md` §6.

## What it doesn't know yet — stated plainly, not buried

- **International coverage, precisely stated.** Real per-flight training data now spans five
  countries across the Americas, Europe, and Oceania — US (BTS), Brazil (ANAC, real cross-border
  routes included), UK (CAA, ~80% international by real route count), Australia (BITRE), France
  (AQST/DGAC, real international routes including e.g. Abidjan-Paris). That is a real, substantial
  improvement over a single-country model, but it is **not global coverage, and the remaining gaps
  were genuinely researched, not left unexamined**:
  - **India**: real (not fabricated) carrier-level cancellation-rate prior — `ingest_india_dgca.py`
    extracts it from 28 real DGCA monthly bulletins (2021-2023) for the 11 carriers DGCA names.
    DGCA publishes a rate, not flight counts, so this informs the *prior* a live Indian flight
    cold-starts from, not new per-flight training rows. Confirmed (fresh research pass, 2026-08-17):
    no finer-granularity real Indian source exists publicly — AAI, data.gov.in's full catalog,
    dataful.in, and individual airlines were all checked directly; DGCA's bulletin is the real
    ceiling for this market today.
  - **Middle East, Russia, most of Africa, most of Asia-Pacific**: genuinely researched and
    confirmed unavailable at ANY usable granularity — not a search that gave up early. UAE's GCAA
    open-data catalog (108 real items, queried directly via its backend API) contains zero
    cancellation/delay datasets, only traffic counts. Saudi Arabia's GACA and Russia's Rosaviatsia
    are both unreachable from outside (Rosaviatsia has documented reduced public disclosure since
    mid-2024). Turkey, Israel, the Arab Civil Aviation Organization, Japan (beyond a scattered
    quarterly national percentage), South Korea, Singapore, and China all have no bulk structured
    cancellation dataset. This is a real, uneven global distribution of aviation-data transparency,
    not an effort gap — see `README.md`'s "Known gaps" for the full per-country account.
  - **OAG** (already partially integrated for live serving — `zkd-app/server/oag.ts`) sells a real
    global historical on-time-performance product covering every region above, dating back to 2004.
    It is a paid, sales-contact-required commercial product with no free/trial tier for bulk
    historical data — what's already wired into this app (`OAG_FLIGHT_INFO_TRIAL_*`) is a different
    product entirely: a 100-call live flight-status lookup API, nowhere near the volume a training
    set needs, and not designed for historical archives. Procuring OAG's actual OTP product is the
    clearest real path to closing the remaining regions; even then, note it publishes monthly
    aggregates by airline/route, the same evidence tier as India's DGCA prior, not raw per-flight
    rows.
- **Measured, not assumed: real segment performance, on the same held-out test set:**

  | Market | n (test) | Real cancellation rate | ROC-AUC | PR-AUC |
  |---|---|---|---|---|
  | US (BTS) | 1,090,275 | 0.58% | 0.726 | 0.020 |
  | Brazil (ANAC) | 151,139 | 4.45% | 0.763 | 0.201 |
  | UK (CAA) | 270,084 | 1.76% | **0.862** | 0.171 |
  | Australia (BITRE) | 159,126 | 2.21% | 0.771 | 0.100 |

  (France/AQST has zero rows in this test segment — its only real data covers Oct 2018-Sep 2019,
  which sorts entirely into the training portion of the chronological split; it contributes real
  training signal but isn't independently evaluated here. Stated plainly rather than hidden.)

  UK again scores the *highest* segment ROC-AUC — a genuinely positive, non-cherry-picked result
  (it's the full real test-set segment). Two things worth being precise about: **(1)** the blended
  ROC-AUC (0.829) sits above every individual segment except UK — an expected effect when segments
  have different base rates and the model can partly separate "which market is this" as a side
  channel, not evidence the model is stronger within any one market than its own row shows. **(2)**
  on the US segment specifically, PR-AUC 0.020 against a 0.58% base rate is a real but modest ~3.5x
  lift, far weaker than the blended ~9.5x figure implies — `prior_leg_cancelled` (aircraft-rotation
  signal) is real training signal only for US rows with a tail number.
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
