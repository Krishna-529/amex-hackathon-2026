# The cancellation-risk model — built, not bought

**ZKD Concierge · Codestreet 2026 / American Express**
Status: implemented and running end-to-end against real data. Supersedes `01-prediction-model.md`
§2 ("we buy the forecast rather than building one") and the "no model of our own to run" line in
`04-infrastructure-and-cost.md` §7. Every other section of `01`–`04` — the seven-phase lifecycle,
the adaptive-threshold *shape*, the confirmation window, the hold gate, the policy layer — still
holds. What changed is only where the probability comes from.

## 0. Why this doc exists

Lumo was never wired to a commercial key, so every number the old design showed was
`source: 'mock'` — a deterministic hash, with three flights' probabilities hand-pinned so a demo
walkthrough was reachable (`DEMO_FIXTURES` in the now-deleted `server/lumo.ts`). That is
indefensible in front of people deciding whether to fund this. This doc, and the code behind it,
replace the vendor call and its mock fallback with a model **we trained ourselves on real,
independently verifiable historical flight data**, served by our own code, with every limitation
stated at the tier it actually earns.

## 1. What the model is

Gradient-boosted decision trees (XGBoost), CPU only — exactly the shape `04-infrastructure-and-cost.md`
§2 already predicted AI would take in this system, now actually built instead of hypothetical.

| | |
|---|---|
| Objective | `binary:logistic`, real class imbalance handled via `scale_pos_weight`, not oversampling |
| Evaluation metric | PR-AUC (not ROC-AUC alone — the honest metric at a ~1–6% positive rate) |
| Calibration | Isotonic regression, fit on a held-out chronological split the trees never saw |
| Split | **Chronological**, not shuffled k-fold — train / calibrate / test are three consecutive time windows, so the reported numbers are a genuine out-of-time evaluation, not leakage dressed as generalization |
| Where it runs | Batch (every N minutes) + event-triggered, CPU, no standing inference endpoint — see §5 |

Real, reproducible numbers live in `zkd-risk-model/reports/model_metrics.json`, written by
`zkd-risk-model/src/train.py` on every run — re-run it and these regenerate from scratch. As of the
training run behind this doc (2026-08-15T18:44 UTC, the full 12-month BTS+ANAC pull, this is the
retrain described in the callout below — model hash changes on every retrain, read it live from
`GET /health`, never hardcode it here):

| | |
|---|---|
| Train / calibrate / test rows (chronological, no shuffling) | 5,525,568 / 1,184,050 / 1,184,051 |
| Test-set positive rate | 1.05% (real, not resampled) |
| **ROC-AUC** (test, never trained/calibrated on) | **0.804** |
| **PR-AUC** (test) | **0.123** — the honest metric at this base rate; beats the logistic-regression baseline (0.104) by ~19% relative and the base-rate-only baseline (0.0105) by ~12x |
| **Brier score** (test) | **0.0097** — well-calibrated on the scale the thresholds act on |
| Top-decile lift over base rate | **5.2x** |
| Best boosting round | 63 (early-stopped) |

Feature importances (gain) and the full 10-bin calibration curve are in the JSON, so a claim like
"redeye flights matter" is checkable, not asserted. `data_sources`: 7,079,061 real BTS rows +
814,608 real ANAC rows.

> **Why these numbers are lower than an earlier version of this doc reported (ROC-AUC 0.873 /
> PR-AUC 0.236), stated plainly rather than quietly changed:** that earlier run left
> `prior_leg_cancelled` (the aircraft's previous leg cancelled) trainable, and it became the single
> highest-gain feature by roughly 15x over everything else combined — because it *was* present on
> ~88% of real training/test rows (BTS rows with a tail number). But `server/engine/riskModel.ts`
> hardcodes this feature to `null` for every live flight (OAG Flight Info Connections, the real
> source, is not available on this account) — so that headline number was never the number a live
> prediction actually gets. Forcing the old model to predict with the feature null everywhere
> (simulating exactly what production sees) dropped it to ROC-AUC 0.805 / PR-AUC 0.125 on its own —
> and retraining with the feature masked to null from the start (`src/train.py`, current) landed at
> 0.804 / 0.123, essentially the same number. That similarity is itself the useful finding: it
> confirms ~0.80 ROC-AUC / ~0.12 PR-AUC is the honest ceiling of the other 14 real features today,
> not an artifact of a bad retrain — and the number now reported here is one a live prediction can
> actually reproduce, not one that quietly assumed a feature production doesn't have.

## 2. What it's trained on, honestly

There is no free, bulk, per-flight-labeled dataset covering India or most of the world. The two
real ones that exist and are usable today:

| Source | What it is | Real rows (grows with each download) | Status |
|---|---|---|---|
| **US DOT/BTS** On-Time Performance | Every US reporting-carrier flight, monthly, real `Cancelled`/`CancellationCode` field | ~500–600k/month, no auth, public | `wired` — `zkd-risk-model/src/ingest_bts.py` |
| **Brazil ANAC** VRA (Voo Regular Ativo) | Every flight ANAC tracks, including real international legs on foreign carriers (e.g. American Airlines GRU↔MIA) — this is where the genuinely international evidence comes from, not just a second domestic dataset | ~50–85k/month, no auth, public | `wired` — `zkd-risk-model/src/ingest_anac.py` |

**This is a real limitation, stated plainly**: neither source has Indian or most of Asia/Europe's
per-flight history. The feature set is deliberately **geography-agnostic** — smoothed historical
rates, schedule position, rotation exposure, not raw carrier/airport identity as the primary signal
— specifically so a model trained on US+Brazil data has a mechanism to generalize rather than
memorize. A live Indian flight's carrier/route keys are namespaced `LIVE:` (distinct from training's
`BTS:`/`ANAC:`) and **cold-start to the population base rate** with correspondingly lower
`confidence` — verified live, not asserted: see §6.

**Softening the cold-start, honestly, not by pretending it's solved**: `zkd-risk-model/data/synthetic/generate_india_synthetic.py`
→ `src/ingest_india_synthetic.py` produces `models/entity_rates_synthetic.json` — fabricated but
directionally-grounded Indian carrier/route/airport/origin-month rates (documented reliability
differences like SpiceJet vs. IndiGo, Delhi winter fog, west-coast monsoon), smoothed with the exact
same formula (`SMOOTH_N=20`) as the real BTS/ANAC table. It is a genuinely separate file, served
under its own `live_synthetic` key (`serve.py`), never merged into the real trained table, and
`zkd-app/server/engine/riskModel.ts` labels any feature it backs `'synthetic-market-estimate'` — a
third, distinct value from `'real'` and `'population-average'` — all the way to the audit panel
(`components/ForecastAudit.tsx`). It moves a `LIVE:` flight's historical-rate features off a single
flat number that treats every Indian carrier and route identically; it does not create real evidence,
and is never presented as if it does.

**The closing move is partly real, precisely stated:** every prediction this app makes is logged,
and every observed outcome (AviationStack/OAG status) is logged too
(`zkd-app/server/decisionLedger.ts` locally; `handler.py` → S3 once deployed) — that half is built
and wired in, not aspirational. The weekly retrain (`zkd-risk-model/infra/training.tf`,
`src/entrypoint.py`) now runs genuinely unattended end to end. **Not yet built**: the join that
would fold the accumulated `LIVE:` outcome log back into `features.py`'s BTS/ANAC-derived training
table — until that exists, a retrain refreshes the model on the same US/Brazil data, and `LIVE:`
entities stay cold-started to the population base rate even across retrains. This is the real next
step, tracked honestly rather than implied by the logging existing — see §8.

**Known v1 gap, stated plainly**: the model does not consume weather as a feature. `server/weather.ts`
is real and live (NOAA METAR + Open-Meteo), but neither BTS nor ANAC's extract carries a per-row
weather join today. Adding one — NOAA's ISD archive, joined by station and hour — is the clearly
scoped next retrain, not silently implied by weather.ts's existence.

## 3. Features (all real, all pre-departure, no leakage)

| Feature | What it is | Why it doesn't leak |
|---|---|---|
| `carrier_hist_cancel_rate`, `route_hist_cancel_rate`, `origin_hist_cancel_rate`, `dest_hist_cancel_rate`, `origin_month_hist_cancel_rate` | Smoothed (Laplace, n=20) expanding-window cancellation rate per entity | Computed on rows **strictly before** the current one in chronological order — verified by a self-check in `features.py` that recomputes one carrier's rate by hand and compares |
| `month`, `day_of_week`, `hour_of_day`, `is_redeye`, `is_weekend` | Schedule position | Read off the published timetable |
| `distance_km`, `sched_duration_min` | Route geometry | Published, not observed |
| `origin_hour_density` | How many flights are scheduled from this airport in the same hour — a real congestion proxy computed from the timetable itself | No live traffic observation needed |
| `prior_leg_cancelled` | Same tail number's immediately preceding flight that day was cancelled (BTS only — ANAC's extract has no registration field) | The inbound aircraft's status is known before the outbound leg's scheduled departure, in reality |
| `international` | ANAC's own `Código Tipo Linha` flag | Published route classification |

Explicitly **excluded**: `CarrierDelay`, `WeatherDelay`, `NASDelay`, `SecurityDelay`,
`LateAircraftDelay` — BTS's delay-cause attribution columns. These are known only after the flight
resolves and would leak the label; a model trained on them would look excellent offline and be
useless live.

## 4. Live serving

```
zkd-app (Node)                          zkd-risk-model (Python)
──────────────                          ───────────────────────
server/engine/riskModel.ts
  assembleFeatures(flight)
    - server/airportDirectory.ts  ──┐
    - entity-rates (cached, TTL)  ──┼──►  GET /entity-rates  (serve.py / Lambda)
  scoreFlight(flight)               │
    POST { features }  ─────────────┴──►  POST /score
                                            src/inference.py: CancellationScorer
                                              - loads cancellation_model.json (XGBoost)
                                              - isotonic calibration
                                              - returns {cancelProbability, confidence,
                                                modelVersion, source: 'internal-ml'}
```

`RISK_MODEL_URL` env var points at either: `http://localhost:8090` (local dev — run
`python zkd-risk-model/src/serve.py`) or the deployed Lambda Function URL / ALB endpoint in AWS.
**Same inference code (`src/inference.py`) runs in both places** — `serve.py` and `handler.py` are
thin wrappers around one `CancellationScorer` class, so "works locally" and "works in the Lambda"
are the same claim, not two implementations that can drift apart.

**No mock fallback.** `server/lumo.ts` — the module that returned a deterministic hash when no
vendor key existed — is deleted. If the scorer is unreachable, `scoreFlight` returns `null`,
`refreshForecast` returns `null`, and the flight shows "forecast not available" rather than a
number. This was verified live (not assumed): killing the scorer process mid-session and re-polling
produces exactly this, logged as `[riskModel] scorer unreachable for <flightId>` rather than a
silent fabricated value.

## 5. Where it runs, and why that's cheap

Per `04-infrastructure-and-cost.md`'s own framing, gradient-boosted trees on tabular features are a
CPU workload — this was true when written hypothetically and stays true now that it's real:

- **Batch scorer** (`zkd-risk-model/infra/scoring.tf`): a scheduled Lambda, container image, CPU
  only, re-scores the active-window book every `batch_rescore_interval_minutes` (config value,
  default 10). No GPU, no standing inference endpoint.
- **Event scorer**: fires only on a material signal (OAG schedule-change/cancellation alert, or an
  upstream rotation delay) — see §7 for the honest gap on how that signal reaches it today.
- **Weekly retrain**: Fargate Spot, ~2 vCPU, minutes not hours — training is fully retryable, so
  Spot's interruption risk costs nothing but a delayed rerun.

No standing SageMaker endpoint anywhere in this design. That is the same argument
`04-infrastructure-and-cost.md` §2 made about "no GPU on the critical path" — it turns out to also be
true of the model that was, at the time, still hypothetical.

## 6. Threshold-gated alternative-flight pre-caching — the point of predicting at all

This is the mechanism the whole prediction exists to pay for (`01-prediction-model.md` §1): search
for and price alternatives **before** the cancellation, so the live recovery path is ~11s instead
of ~53s. The old code (`server/domain/views.ts`) called `refreshAltsIfStale()` on **every flight
page view**, regardless of risk — spending a three-supplier search on a flight nobody was ever going
to act on.

**Fixed, then re-fixed.** `server/engine/forecast.ts`'s `compute()` calls
`triggerAltPrefetchIfWarranted(flight, riskScore)` after every score, and the search only fires
once the gate value is crossed. The first version of the fix gated on the adaptive **band**
(`prepare`/`hold-gate`/`pre-authorise`) — correct, but a raw-probability-shaped gate wasn't
available for anyone who wanted a plain, intuitive cutoff on the number itself, because this
model's real `cancelProbability` never exceeds ~4% (see the real distribution just below): a
"gate at 75%" request against the raw probability would simply never fire, for any flight, ever.

**Now gated on `riskScore` instead — a percentile rank, not the raw probability.**
`zkd-risk-model/src/inference.py`'s `CancellationScorer` loads a sorted, 168,000-point lookup
(`models/score_percentile_lookup.npy`, built by `score_distribution.py` from the same live-realistic
grid described below) and ranks each flight's calibrated `cancelProbability` against it:
`riskScore = searchsorted(lookup, calibrated) / len(lookup) * 100`. `riskScore: 75` means "this
flight's real probability is higher than 75% of the realistic live-flight scenarios we've scored" —
a rank that is meaningful across its full 0–100 range by construction, unlike the raw probability.
`cancelProbability`/`pct` is never rescaled or touched by this — it stays exactly as calibrated, and
still drives every member-facing prepare/hold-gate/pre-authorise banner via the band system above,
unchanged. `riskScore` exists solely as the alt-search gate:

```
gate fires when: riskScore >= config.altCache.prefetchAtOrAboveRiskScore   (default 75)
```

Verified live: a flight scoring `riskScore: 38.3` (`pct: 2%`) did not trigger a supplier search
against the default gate of 75; temporarily lowering the gate to 1 and forcing a re-score
(`POST /api/flights/:id/reverify`) did trigger it, confirming the gate is load-bearing.

## 7. The adaptive threshold, in a config file, hot-reloadable

Per the explicit requirement that the pre-cache trigger "not be a static number": every constant
that used to be hardcoded in `lib/thresholds.ts` (`BASE`/`FLOOR`/`CEILING`, the scarcity/urgency
curve shape, the alt-cache `riskScore` gate) now lives in `zkd-app/config/risk-thresholds.json`, loaded by
`lib/thresholdConfig.ts`. Locally that's a JSON file re-stat'd every 30s (a hot edit is live within
one poll window — verified: `thresholdsFor()`'s returned `configVersion` field ticks up after an
edit). In production it's **AWS AppConfig** (`zkd-risk-model/infra/appconfig.tf`) — versioned,
schema-validated (`infra/appconfig-threshold-schema.json`), linearly-deployed over 5 minutes so a
bad value doesn't hit 100% of traffic at once, and pageable via CloudWatch if it regresses.

**Recalibrated against the real score distribution, not guessed — twice.** The original `base`/
`floor`/`ceiling` values (25/55/80, 10/25/45, 45/75/95) were picked before the model existed and
never checked against what it actually outputs — a real gap a VP-readiness audit caught by
grid-scoring 168,000 real feature combinations through the live scorer
(`zkd-risk-model/src/score_distribution.py`, fixing historical-rate features at `global_prior`,
exactly what every live `LIVE:`-namespaced flight sends today). A first recalibration set
`base: {2, 3, 5}` against that grid's real distribution at the time (min 0.89%, max 4.06%).

That recalibration was itself invalidated by the `prior_leg_cancelled` retrain (§1): masking that
feature shifted the real distribution meaningfully higher (min 1.64%, p50 3.22%, p75 4.37%, p90
6.45%, p95 7.08%, p99 9.74%, max 10.33%) **and** changed how much the seeded flights differentiate
from each other — `u1`/`f-multi` (both `hasHardConstraint`) now score a real ~6%, close enough to
`u4`'s ~8% that a same-ratio rescale of the old bands put them in `hold-gate` too, breaking the
seeded walkthrough's own property that `u4` alone should reach it. `config/risk-thresholds.json` now
uses `base: {4, 6, 11}`, `floor: {2, 7, 9}`, `ceiling: {6, 9, 15}` — note `holdGate`'s floor (7) sits
*above* its base (6), deliberately: `hasHardConstraint`/scarcity/urgency can lower a flight's
`holdGate` bar, but never below the floor, so a flight that's merely constrained (`u1`/`f-multi`,
landing exactly on the floor) can't collapse into the same tier as one whose raw probability is
genuinely higher (`u4`, whose more favorable shift clears the floor on its own). Verified against
all 6 seeded flights' real computed bands (not asserted): `u1`/`f-multi` → `prepare`, `u2`/`u3`/
`f-depth` → `watch`, `u4` → `hold-gate` — exactly one flight, with a real 1-point margin, not a tie.
Also re-verified against `server/engine/thresholds.test.ts`'s real property tests (single-factor
extremes, not just default conditions — these previously caught `hasHardConstraint: true` alone
rounding `holdGate` and `preAuthorise` to the same integer, which is why the gap between them stays
wide). Re-run `score_distribution.py`, and re-derive `bands` from the 6 seeded flights' own real
scores, after any retrain that could shift the distribution.

## 7a. Auditability — history, explanation, reverification

Three real mechanisms, added 2026-08-14, so a prediction is never just a number on a screen:

1. **Prediction history.** Every real score — on-demand or from the interval batch re-scorer
   (`server/engine/batchScorer.ts`, started once per server process via `instrumentation.ts`) —
   appends to `Flight.forecastHistory`, capped at 288 points (~24h at the default 10-minute
   interval). `/flights/[id]` plots it as a real time-series, not a synthetic curve; a gap in the
   graph means no score ran in that window, and stays a gap rather than being interpolated.
2. **Real per-prediction explanation.** `zkd-risk-model/src/inference.py`'s `explain()` returns
   XGBoost's exact tree-SHAP contributions (`pred_contribs=True`) for the live prediction — verified
   to sum exactly to the model's raw margin output (§ below). Units are log-odds, not probability
   points (probability is not linear in these features, so a percentage-point attribution would be
   false precision); the audit panel shows the honest relative-share version instead. This costs an
   extra tree pass per flight, so it runs on the on-demand/reverify path and is skipped on the batch
   path (`serve.py`'s array-body branch) — nobody is watching a batch explanation in real time.
3. **Reverify.** `POST /api/flights/[id]/reverify` forces an immediate real re-score — never a
   cached read — and reports the delta against what was last shown, flagging a large swing
   (≥15pp) that happened on the *same* model version and *same* threshold config as worth a human
   look, while explicitly not treating model/config changes as anomalies (a retrain or a threshold
   edit is expected to move the number).

**Verified live, not just typechecked**: two consecutive reverifies on a real seeded flight
reproduced the identical 2% score and were correctly reported as consistent; the explanation's
`bias + sum(contributions)` matched the booster's raw margin output on a synthetic high-risk test
vector to four decimal places.

## 8. Honest limitations, stated plainly

1. **No Indian/most-international historical training data exists yet.** The model generalizes by
   feature design (§2), not by having seen the routes. Real accuracy on Indian carriers is a
   claim to be *measured*, via the back-test loop, not assumed from day one — exactly the
   discipline `01-prediction-model.md` §2 already applied to Lumo's vendor accuracy claim.
2. **No weather feature in the trained model** (§2). `server/weather.ts` exists and is live for the
   risk explanation narrative, not the model's own inputs, in this version.
3. **OAG's exact live request shape is now mostly confirmed — two real trial calls spent, 98 of 100
   remain.** The first (2026-08-14, `version=2`) returned a genuine 404 — auth reached the gateway
   fine, the request itself was wrong. The second (2026-08-14, `version=v2`) returned a real 400
   validation error, confirming the path AND that `version` must be the literal string `"v2"` — and
   naming the actual required filters: `CarrierCode` + `DepartureAirport`/`ArrivalAirport` +
   `DepartureDateTime`/`ArrivalDateTime`, not the comma-joined `FlightIdentities` batching the
   original code assumed. `flightInstancesBatch()` now throws a specific, documented error instead
   of silently sending a request already known to be shaped wrong. One more real call — to pin down
   the exact datetime-range format — would close this out entirely. See `server/oag.ts`'s header
   comment for the full real request/response history.
4. **OAG Flight Info Connections (real tail-rotation/connection linkage) is a Production-tier
   product, not usable on the trial key.** `prior_leg_cancelled` at live-inference time is `null`
   for every flight until that product is live — a stated gap, not a guess.
5. **This infrastructure has not been `terraform apply`'d.** The AWS budget is a $140 credit,
   reserved for the week before the final presentation — see `zkd-risk-model/infra/README.md`. Local
   `serve.py` is real and running; the AWS deployment is real Terraform, unapplied.
6. **Cross-validation against a second, truly independent country would strengthen the
   generalization claim further** — Eurocontrol's public data was checked and is not bulk-downloadable
   without a registered agreement; ANAC's real international legs are the closest substitute
   available today.
7. **The history graph and explanation panel (`components/ForecastAudit.tsx`) have now been
   visually verified in a real browser**, not just by data shape — logged in as a real seeded
   passenger, the history chart, the diverging contribution bars (with population-average bars
   correctly faded and labeled), and a live reverify round-trip all rendered and behaved correctly.
8. **Forecast history resets on every dev-server restart**, same as the rest of the in-memory store
   (`server/domain/store.ts`) — a real limitation of the process-lifetime store, not specific to
   the graph.
9. **The continual-learning loop's outcome-join is not built.** Predictions and observed outcomes
   are both really logged (§2 above), and the weekly retrain now runs genuinely unattended
   (`src/entrypoint.py`) — but nothing yet maps the accumulated `LIVE:` outcome log onto
   `features.py`'s BTS/ANAC-derived training schema, so a retrain today still trains on US+Brazil
   data only. `LIVE:` entities stay cold-started to the population prior even across retrains until
   this join exists. See `zkd-risk-model/README.md`'s "Continual learning loop" section.

## See also

- `zkd-risk-model/MODEL_CARD.md` — the 2-minute plain-English version of this document: real
  accuracy stated as a plain comparison against a naive and a logistic-regression baseline, the
  real per-market performance gap, and what it costs to run
- `zkd-risk-model/README.md` — how to reproduce training, the exact commands, the continual-learning loop
- `zkd-risk-model/infra/README.md` — the AWS deployment, cost levers, and the $140-credit demo-week plan
- `01-prediction-model.md` §§1, 3–12 — everything about *what the system does* with a probability, unchanged
- `04-infrastructure-and-cost.md` — the original "no GPU" argument this doc's §5 confirms in practice
