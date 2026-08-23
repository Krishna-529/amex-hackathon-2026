# Prediction & Risk Model

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

Estimates the probability that a specific scheduled flight will be cancelled, ahead of time, so the
rest of the pipeline can act before the carrier files. It spans two processes: a Node/TypeScript
client inside `zkd-app` that assembles a feature vector for a live flight and turns a probability
into a member-facing risk band, and a standalone Python service (`zkd-risk-model`) that holds the
actual trained XGBoost model and returns a calibrated probability plus a SHAP-style explanation.
There is no mock branch on the live path: if the Python service cannot be reached, the caller
returns `null` and the UI shows "not available" rather than a fabricated number.

## Where it lives

**Node-side client (`zkd-app/`)**

| File | Purpose |
|---|---|
| `server/engine/riskModel.ts` | Assembles the feature vector for a live flight, calls the Python service (`/entity-rates`, `/score`), tags each historical-rate feature with its data-source tier |
| `server/engine/forecast.ts` | Turns a `ModelScore` into a `FlightForecast` (adds live seat scarcity, adaptive thresholds, band, alert/stand-down side-effects), on-demand path |
| `server/engine/batchScorer.ts` | Interval re-scorer: three cadence tiers (critical/standard/dormant), one batch HTTP call per tick, startup warm-up with retry |
| `server/engine/rescoreTiming.ts` | Pure functions deciding which tier a flight is in (`tierFor`) and how fast its alt-cache TTL decays as departure nears (`effectiveAltTtlMs`) |
| `server/engine/thresholds.ts` | Computes the adaptive `prepare`/`holdGate`/`preAuthorise` bands from scarcity, urgency, criticality, and forecast confidence |
| `server/risk/index.ts`, `weatherRisk.ts`, `notam.ts`, `gdelt.ts`, `types.ts` | A **separate** live-signal system (weather/NOTAM/news) that feeds the alternative-flight *ranker* (`server/pipeline/score.ts`), not the cancellation model — see note below |
| `server/airportDirectory.ts` | 6,072-airport IATA/ICAO/timezone/lat-lon lookup; supplies `distance_km` and, critically, local-timezone calendar parts (`localDateParts`) so `hour_of_day`/`day_of_week`/`month` match the model's local-time training convention |
| `server/weather.ts` | Real METAR (NOAA Aviation Weather Center) + Open-Meteo fallback weather lookups; feeds `server/risk/weatherRisk.ts`, not the trained model itself |
| `app/api/flights/[id]/demo-risk/route.ts` | `/ops` "Ramp risk" presenter control — writes a hardcoded, clearly-tagged demo forecast, entirely outside the model |

**Python inference service (`zkd-risk-model/`)**

| File | Purpose |
|---|---|
| `src/features.py` | Builds the leakage-checked, geography-agnostic training table from BTS+ANAC data |
| `src/train.py` | Trains XGBoost, calibrates with isotonic regression, evaluates on a chronological holdout, writes `models/` + `reports/model_metrics.json` |
| `src/inference.py` | `CancellationScorer` — loads the trained artifact, scores a feature dict, produces `cancelProbability`, `confidence`, `riskScore`, tree-SHAP `explanation` |
| `src/serve.py` | stdlib-only local HTTP server (`/health`, `/entity-rates`, `/score`) — what `RISK_MODEL_URL` points at in dev |
| `src/handler.py` | AWS Lambda entry points (`batch_score`, `event_score`) wrapping the same `CancellationScorer`, writing to DynamoDB + an S3 decision-ledger |
| `src/ingest_bts.py` | Normalizes US DOT/BTS On-Time Performance monthly files into the shared schema |
| `src/ingest_anac.py` | Normalizes Brazil ANAC VRA monthly files into the same shared schema |
| `src/ingest_india_synthetic.py` | Builds the **separate**, clearly-labeled synthetic Indian-market rate table from fabricated CSV rows — never merged into the real training table |
| `src/entrypoint.py` | Unattended weekly retrain orchestrator (download → ingest → features → train → score_distribution → S3 upload), run by `Dockerfile.trainer` |
| `src/score_distribution.py` | Scores a synthetic grid of ~168,000 real-shaped feature combinations to build the percentile-rank lookup behind `riskScore`, and `reports/score_distribution.json` |

## The process boundary

`zkd-app` never imports any Python code or trained-model file directly. The only contact is HTTP,
gated by one env var, `RISK_MODEL_URL` (default `http://localhost:8090` in `riskModel.ts`).

- **`GET /entity-rates`** — `riskModel.ts`'s `entityRates()` fetches the full historical-rate reference
  tables (`carrier`, `origin`, `dest`, `route`, `origin_month`, `origin_hour_density_avg`,
  `global_prior`, plus `live_synthetic` riding alongside under its own key). Cached client-side in
  the Node process's in-memory TTL cache (`getOrSet`, `server/cache.ts`) for `ENTITY_RATES_TTL_MS =
  10 * 60 * 1000` (10 minutes), with a 5-second request timeout (`AbortSignal.timeout(5000)`). On
  failure (non-2xx or thrown error) the whole call resolves to `null` — no partial or stale-forever
  answer.
- **`POST /score`** — body is either one feature object (single-flight, on-demand path,
  `assembleFeatures` → `scoreFlight`, 8s timeout, explanation included) or an array of feature
  objects (batch path, `scoreFlightsBatch`, 15s timeout, explanation always omitted). The batch
  response is a same-length array where a per-item failure is represented as `{"error": "..."}` in
  that slot rather than failing the whole request; `scoreFlightsBatch` verifies index alignment by
  construction (`withFeatures` and the request body are built from the same array in the same
  order) rather than assuming it holds.
- Response shape (`ModelScore`): `{ cancelProbability, confidence, modelVersion, source:
  'internal-ml', riskScore?, explanation? }`. `riskScore` is absent whenever
  `score_percentile_lookup.npy` hasn't been generated (`score_distribution.py` not yet run);
  `explanation` is present on-demand, omitted in batch mode.

**What happens on each side if the other is unreachable:**

- *Node → Python down*: `assembleFeatures` returns `null` if `/entity-rates` fails (feature
  assembly can't even start without the rate tables), and `scoreFlight`/`scoreFlightsBatch` catch
  the fetch and return `null` / an empty `Map`. `forecast.ts`'s `compute()` then returns `null` —
  the caller shows "not available," and `batchScorer.ts`'s startup `warmUntilScored` retries every
  20 seconds, up to 5 attempts, before yielding to the normal tiered cadence. There is no fallback
  probability anywhere on this path — deliberately, per the header comment in `riskModel.ts`.
- *Python → Node's domain data unreachable*: not applicable in this direction — `inference.py`
  never calls out to the network; it only scores a feature dict handed to it. Feature *assembly*
  (calling the domain store, airport directory, etc.) is exclusively a Node-side responsibility;
  `handler.py`'s docstring states this explicitly to avoid a second, divergent copy of that logic
  in Python.
- *Malformed/oversized request*: `serve.py` caps request bodies at `MAX_BODY_BYTES = 5 * 1024 *
  1024` (413 on overflow) and returns 400 on invalid JSON — both degrade to an HTTP error the Node
  client already treats as "not ok, return null," not a crash.

## How it works

### The model itself

**Training data**: real historical flight data only, no synthetic rows in the trained table.
- US DOT/BTS On-Time Performance, ~12 months, columns read off the file header (`ingest_bts.py`,
  verified 2026-08-14 against `bts_2024_1.zip`).
- Brazil ANAC VRA monthly extracts, semicolon-delimited (`ingest_anac.py`, verified 2026-08-14),
  which also contributes real international rows (e.g. Rio–Miami).
- `model_metrics.json`'s `data_sources`: **`BTS_US: 7,079,061`**, **`ANAC_BR: 814,608`** rows feeding
  `features.py`; after the chronological split, `n_train = 5,525,568`, `n_calib = 1,184,050`,
  `n_test = 1,184,051`.
- No Indian per-flight historical dataset exists publicly in bulk — stated as a known, permanent
  gap in `zkd-risk-model/README.md`, not implied to be solved.

**Features** (`FEATURE_COLS`, identical list in `features.py` and `train.py`):
`carrier_hist_cancel_rate`, `route_hist_cancel_rate`, `origin_hist_cancel_rate`,
`dest_hist_cancel_rate`, `origin_month_hist_cancel_rate` (smoothed expanding-window historical
rates, Laplace-style with `SMOOTH_N = 20.0`), `month`, `day_of_week`, `hour_of_day`, `is_redeye`,
`is_weekend`, `distance_km`, `sched_duration_min`, `origin_hour_density` (schedule congestion proxy
at the origin airport, same hour bucket), `prior_leg_cancelled` (upstream tail-rotation exposure,
BTS-only, real tail numbers), `international`.

**Excluded — leakage**: BTS delay-attribution columns (`CarrierDelay`, `WeatherDelay`, etc.) are
never used because they are only known after the flight resolves. `features.py`'s
`_leakage_self_check()` recomputes one high-volume carrier's historical rate by hand on every run
and compares it against the vectorized expanding-window version as a live guard against an
accidental current-row inclusion.

**`prior_leg_cancelled` is deliberately masked to `NaN` for every training row** (`train.py` line
105), even though it is real and present for ~88% of BTS rows and would otherwise be the
single highest-gain feature (~15x everything else combined). The reason, stated exactly in the
code comment: `server/engine/riskModel.ts` hardcodes this feature to `null` for every live flight
(OAG Flight Info Connections, the real source, is not available on this account), so training on
it would let the model lean on a signal it will never receive live. Masking it forced a real,
measured accuracy cost — the comment quotes **ROC-AUC 0.873 (unmasked) → 0.805 (forced null,
i.e. what live scoring actually gets)** for the previous artifact.

**Calibration**: isotonic regression (`sklearn.isotonic.IsotonicRegression`, `out_of_bounds='clip'`)
fit on a held-out calibration split (the middle 15% of the chronological data), because the raw
XGBoost margin is a ranking signal distorted by `scale_pos_weight` and boosting, not a calibrated
probability, and the member-facing bands act on the absolute percentage.

**Split**: strictly chronological by `sched_dep` — train (first ~70%), calib (next ~15%), test
(last ~15%), touched exactly once for the reported metrics. No k-fold shuffling (would leak future
rows into the past).

**Evaluation numbers, exactly as reported in `zkd-risk-model/reports/model_metrics.json`**
(`trained_at: "2026-08-15T18:44:18.628275+00:00"`):

| Metric | Value |
|---|---|
| ROC-AUC | 0.8038269098091382 |
| PR-AUC | 0.12344536409903796 |
| Brier score | 0.009715256281197071 |
| Log loss | 0.04906681180000305 |
| Positive rate (train / test) | 0.01894339188297022 / 0.010462387177579344 |
| Best boosting iteration | 63 |

Baselines computed in the same file for comparison, not asserted in isolation:
- Base-rate-only: ROC-AUC 0.5, PR-AUC 0.010462387177579344 (== the test positive rate, as it must
  be), Brier 0.010424853072938632.
- Logistic regression on the same features: ROC-AUC 0.7422816222194584, PR-AUC
  0.10375353029371927, Brier 0.2411636441978684 (explicitly noted as not calibrated, so its Brier
  isn't directly comparable to the calibrated XGBoost Brier above).
- Top-decile lift over the test base rate: **5.25x** (`lift_table`'s last row,
  `lift_over_base_rate: 5.247533481972106`), not the "22x" figure the training script's docstring
  region seems to anticipate — the actual computed lift table tops out at ~5.25x, which is worth
  flagging as a real number to use instead of any higher figure that might be quoted elsewhere.
- Segment breakdown exists (`by_country`, `by_month`) and shows real spread: BR ROC-AUC
  0.7720292412929622 / PR-AUC 0.21523030418140782 vs US ROC-AUC 0.7035181531090687 / PR-AUC
  0.015868311124092378 — the model performs meaningfully worse on the lower-base-rate US segment by
  PR-AUC, which is expected at ~0.6% positive rate but is a real, disclosed weak spot, not hidden.
  The `by_month` segment only has 3 months present (1, 11, 12) in the test window, and month "1"
  has an n of only 13 rows — too small to read as a real per-month result.

`riskScore` (0–100 percentile rank, not a probability) comes from `score_distribution.py` scoring
168,000 realistic live-flight feature combinations (varying month/day/hour/distance/duration/origin
density/international, all historical-rate features cold-started to `global_prior` since every live
flight is `LIVE:`-namespaced). Per `reports/score_distribution.json`: real calibrated probability
range is **min 1.64%, p50 3.22%, p75 4.37%, p90 6.45%, p95 7.08%, p97 7.63%, p99/p99.5/p99.9 9.74%,
max 10.33%** — confirming the code comments' claim that `cancelProbability` never meaningfully
exceeds ~10% for any realistic live scenario (the comment in `riskModel.ts` says "never exceeds
~4%," which describes an earlier distribution before a retrain shifted it; `config/risk-thresholds.json`'s
own comment records the shift explicitly: "was 0.89%-4.06% before, not a small tweak").

**A live score response** (`CancellationScorer.score()` in `inference.py`) looks like:
```json
{
  "cancelProbability": 0.0322,
  "confidence": 0.412,
  "modelVersion": "984594ba18a7",
  "source": "internal-ml",
  "riskScore": 50.0,
  "explanation": {
    "biasMarginLogOdds": -4.21,
    "features": [
      { "feature": "origin_month_hist_cancel_rate", "value": 0.019, "contributionLogOdds": 0.83, "direction": "increases", "relativeShare": 0.41 }
    ]
  }
}
```
`modelVersion` is the first 12 hex characters of a SHA-256 hash of the trained model JSON file, so
a redeploy with an unchanged model reports the same version and the audit "reverify" flow
(`forecast.ts`'s `reverify()`) can tell a genuine retrain apart from a probability swing on the same
model. `explanation.features[].contributionLogOdds` are exact tree-SHAP contributions in log-odds
space (they sum with the bias to the raw pre-calibration margin) — explicitly **not**
probability-percentage-point contributions, per `inference.py`'s own docstring, because probability
is not linear in that space.

### Serving path

1. **Feature assembly** (`riskModel.ts`'s `assembleFeatures`): fetches `entityRates()` (cached
   10 min), resolves the flight's origin/destination via `airportDirectory.ts`, computes local
   calendar parts (`localDateParts`) at the **origin airport's own timezone** — not UTC — because
   the BTS/ANAC training data's `hour_of_day`/`day_of_week`/`month` are local wall-clock fields.
   Before this existed, the code used `Date.getUTCHours()` etc., which is silently wrong for every
   non-UTC+0 airport (a constant 5.5-hour skew for India) on two of the highest-gain features
   (`is_redeye` ranks 9th, `hour_of_day` 5th in `feature_importance`).
2. Carrier/airport keys are namespaced `LIVE:` (e.g. `LIVE:6E`, `LIVE:DEL>LIVE:BOM`) — distinct from
   the training table's `BTS:`/`ANAC:` keys by construction, so every live Indian/international
   entity is a guaranteed cold-start miss against the real trained history.
3. **Three-tier lookup per historical-rate feature** (`tieredRate`): (1) this entity's real trained
   rate if the `LIVE:` key happens to match (never does today) → `'real'`; (2) the
   `entity_rates_synthetic.json` fabricated Indian-market rate if present → `'synthetic-market-estimate'`;
   (3) the trained `global_prior` → `'population-average'`. Each feature's chosen tier is recorded
   in a parallel `DataSourceMap` returned alongside the features, so the UI (`ForecastAudit.tsx`,
   per the code comments) can label a bar honestly instead of implying real per-carrier evidence.
   `prior_leg_cancelled` is always `null` live (OAG connections product not provisioned) and always
   labeled `'unknown'`.
4. **The actual HTTP call**: single-flight (`scoreFlight`) or batched (`scoreFlightsBatch`) `POST
   /score` as described in the process-boundary section above.
5. `applyScore()` (`forecast.ts`) then folds the returned `ModelScore` together with a **live seat
   count** (`searchInventory` across suppliers, filtered to offers that can seat the flight's
   largest booked party) into `thresholdsFor()` to get the adaptive bands, computes `pct =
   round(cancelProbability * 100)`, derives the `band` via `bandFor`, appends a history point
   (capped at 288 entries ≈ 24h at the 10-minute default interval), persists the mutated `Flight`
   back to the store, logs the prediction and the threshold evaluation to `decisionLedger.ts`, and
   fires `triggerAltPrefetchIfWarranted` plus alert/stand-down notifications.

**Caching / TTL**: `entityRates()` — 10 minutes, process-lifetime in-memory (`server/cache.ts`,
resets on server restart). A computed `FlightForecast` is considered stale after
`config/risk-thresholds.json`'s `forecast.ttlMs` (600,000 ms / 10 min) unless the flight is
demo-pinned (`isDemoPinned`, checked via `modelVersion === 'demo-override'`), which never expires
until explicitly reset. Concurrent `refreshForecast` calls for the same flight ID share one
in-flight promise (`inFlight` map) so five simultaneous viewers never trigger five HTTP calls.

### Thresholds

`thresholdsFor()` (`server/engine/thresholds.ts`) computes three bands from `config/risk-thresholds.json`
(hot-reloaded via `lib/thresholdConfig.ts`, backed in production by AWS AppConfig per the config
file's own comment):

```
shift = (scarcity * urgency * criticality) / confidence
prepare      = clamp(base.prepare * shift, floor.prepare, ceiling.prepare)       [base 4, floor 2, ceiling 6]
holdGate     = clamp(base.holdGate * shift, floor.holdGate, ceiling.holdGate)    [base 6, floor 7, ceiling 9]
preAuthorise = clamp(base.preAuthorise * shift, floor.preAuthorise, ceiling.preAuthorise) [base 11, floor 9, ceiling 15]
```

- `scarcity`: fewer seats available (filtered to the flight's largest party) → lower factor → act
  earlier; flattens to 1 above `amplePlateauSeats` (20). Floor `soldOutFactor` 0.6.
- `urgency`: closer to departure → lower factor → act on less certainty; flattens to 1 beyond
  `amplePlateauMinutes` (480). Floor `insideWindowFactor` 0.65 inside `insideWindowMinutes` (60).
- `criticality`: 0.85 multiplier if the booking has a hard downstream constraint (e.g. an onward
  connection), else 1 — makes all three bands fire earlier.
- `confidence`: divides the shift, so a less-confident forecast (lower `score.confidence`) needs a
  **higher** raw probability to cross the same band — `floor 0.7 + span 0.3 * clamp01(confidence)`.

`holdGate.floor (7)` is deliberately set **above** `holdGate.base (6)`, per the config file's own
comment, so the multiplicative factors above can only ever push a flight's threshold up toward the
floor, never below it — this was tuned after a retrain shifted the real score distribution and the
config comment documents the exact empirical check against all 6 seeded demo flights.

Crossing bands is what gates everything downstream: `prepare` triggers no spend, `hold-gate`/
`pre-authorise` are the "critical" tier for re-score cadence (`rescoreTiming.ts`'s `tierFor`), and
separately, once `riskScore` (the 0–100 percentile rank, not `pct`) crosses
`altCache.prefetchAtOrAboveRiskScore` (75), `forecast.ts`'s `triggerAltPrefetchIfWarranted` hands
off to the WARM-phase alternative-flight and ground-transport pre-cache — see
[03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md) for what happens on that side
of the handoff.

## Interfaces

### Inbound — who calls this, and how

| Caller | Path |
|---|---|
| On-demand flight view / poll | `server/engine/forecast.ts`'s `refreshIfStale` → `refreshForecast` → `compute` → `scoreFlight` |
| Scheduled interval re-scorer | `server/engine/batchScorer.ts`'s three tiers (critical 90s, standard 600s, dormant 1,800,000ms) → `scoreFlightsBatch` |
| Real-time status-change signal | `server/engine/forecast.ts`'s `triggerEventRescore`, called from `app/api/flight-status/route.ts` when AviationStack reports a real disruption-classified change, debounced 30s per flight |
| Audit "reverify" action | `forecast.ts`'s `reverify()` — forces an immediate rescore and reports the delta plus whether the model or threshold config version changed |
| `/ops` presenter control | `app/api/flights/[id]/demo-risk/route.ts` — bypasses the model entirely, writes a tagged `demo-override` forecast |

### Outbound — what this calls, and why

| Target | Why |
|---|---|
| `zkd-risk-model`'s `serve.py`/`handler.py` (`RISK_MODEL_URL`) | The actual scored probability, confidence, riskScore, explanation |
| `server/suppliers` (`searchInventory`) | Real live seat counts, to compute scarcity for the adaptive thresholds |
| `server/risk/weatherRisk.ts` → `server/weather.ts` (METAR/Open-Meteo) | Weather severity signal for the alternative-flight **ranker** (`server/pipeline/score.ts`), gated behind `ZKD_LIVE_RISK=1` — not consumed by the cancellation model itself |
| `server/risk/notam.ts` (FAA NOTAM API) | Airspace/airport closure signal for the ranker, US-airport coverage only, requires `FAA_NOTAM_CLIENT_ID`/`SECRET` |
| `server/risk/gdelt.ts` (GDELT DOC 2.0) | Soft news signal (strikes, unrest, closures) for the ranker, keyless, gated behind `ZKD_LIVE_RISK=1` |
| `server/airportDirectory.ts` | Airport metadata, distance, timezone-correct local calendar parts |
| `server/decisionLedger.ts` | `logPrediction` / `logThresholdEvaluation` — every score and every threshold evaluation is logged for audit/replay |

**Note on `server/risk/*`**: this subsystem (weather + NOTAM + GDELT) is a real, separate live-signal
layer that exists to inform `server/pipeline/score.ts`'s ranking of *alternative* flights, not to
predict the *original* flight's cancellation probability. It was included in the file list for this
document because it lives conceptually adjacent to "risk," but it does not feed `riskModel.ts`'s
feature vector or the trained XGBoost model in any way — keep these two systems mentally separate.

## State it owns

- In-process TTL cache (`server/cache.ts`, plain `Map`, resets on restart): `entityRates()` under
  key `riskmodel:entity-rates`, 10-minute TTL; `metarSeverity`/`openMeteoSeverity` under
  `metar:{icao}`/`open-meteo:{iata}`, 15-minute TTL each (used by the separate ranker risk system,
  not the cancellation model).
- `flight.forecast` and `flight.forecastHistory` (capped at 288 points) — persisted per-flight
  fields in the domain store (Postgres-backed per `store.createFlight`), not recomputed from
  scratch each read.
- `lastEventRescoreAt` (in-memory `Map<flightId, timestamp>`) — debounce state for event-triggered
  rescores, per-process, not persisted.
- `inFlight` (in-memory `Map<flightId, Promise>`) — concurrent-request dedup, per-process.
- On the Python side: the trained model artifact (`models/cancellation_model.json`), calibrator
  (`models/calibrator_isotonic.npz`), entity rate tables (`models/entity_rates.json`,
  `entity_rates_synthetic.json`), feature column list (`models/feature_columns.json`), and the
  percentile lookup (`models/score_percentile_lookup.npy`) are all static files loaded once at
  `CancellationScorer.__init__` and held in the Python process's memory — refreshed only by a new
  weekly retrain + redeploy/restart, never mutated at request time.

## Real vs. simulated vs. mocked

- **Real, trained**: the XGBoost model itself, trained on 7,079,061 real BTS rows + 814,608 real
  ANAC rows; calibration; evaluation metrics in `model_metrics.json`; the live HTTP scoring path;
  the tree-SHAP explanation.
- **Real signal, honest cold-start**: any `LIVE:`-namespaced carrier/origin/dest/route/origin-month
  feature falls back to the trained `global_prior` (a real number, computed from real data, just not
  differentiated per-entity) whenever no synthetic override exists — tagged `'population-average'`
  in `DataSourceMap`.
- **Fabricated but clearly labeled**: `entity_rates_synthetic.json`, built by
  `ingest_india_synthetic.py` from `data/synthetic/india_carrier_monthly.csv` — every row there is
  invented, never merged into the real training table or `entity_rates.json`, tagged
  `'synthetic-market-estimate'` end to end (the JSON file itself carries a `"_comment"` field stating
  this, and `serve.py` serves it under its own `live_synthetic` key rather than merging it in).
- **Hardcoded/demo-only**: `app/api/flights/[id]/demo-risk/route.ts` — the `/ops` "Ramp risk"
  control writes a forecast with a fixed `pct = 8` and an operator-chosen `riskScore` (default 82,
  clamped 0–100), tagged `modelVersion: 'demo-override'` so no rescore path can silently overwrite
  or be confused with it. This is the only place in the reviewed code that writes a forecast without
  calling the model at all.
- **Explicitly absent, never guessed**: `prior_leg_cancelled` is always `null` on the live path
  (OAG Flight Info Connections not provisioned); `connectionRisk` is always `null` in
  `FlightForecast` for the same reason; NOTAM risk is US-airport-only with no Indian equivalent
  wired; weather is not a trained-model feature at all (v1 gap, stated in both `riskModel.ts`'s
  header and the README's "Known gaps").
- **Continual-learning loop**: `zkd-risk-model/README.md` states plainly that folding accumulated
  `LIVE:` outcomes back into the training table is **not yet built** — the weekly retrain re-runs
  against BTS/ANAC only, so cold-started entities stay cold-started even after a retrain.

## Failure modes & concurrency

- **Python service down or unreachable**: every Node-side entry point (`assembleFeatures`,
  `scoreFlight`, `scoreFlightsBatch`) catches the error and returns `null` / empty results — no
  fabricated fallback probability anywhere. `batchScorer.ts`'s startup warm pass retries up to 5
  times at 20-second intervals, then defers to the normal tiered cadence, which will keep failing
  silently (logged via `console.error`) until the service comes back.
- **A single flight's feature assembly throws** (e.g. malformed flight record): caught per-flight in
  both the single (`scoreFlight`) and batch (`scoreFlightsBatch`) paths — one bad flight is logged
  and skipped, never aborting the rest of a batch tick.
- **A single flight fails inside the Python scorer** (batch path): `serve.py`'s `do_POST` and
  `handler.py`'s `_score_batch` both catch per-item and place `{"error": ...}` in that slot instead
  of 500ing the whole request; the Node side checks `'error' in score` and skips it while keeping
  the rest of the batch.
- **Missing/null features for a live flight**: XGBoost's `DMatrix` is constructed with
  `missing=np.nan`, and the model was trained the same way (`missing=np.nan` in `train.py`) — a
  genuinely absent feature (e.g. `distance_km` when an airport is unrecognized, or
  `prior_leg_cancelled`, always null live) is handled natively by the tree splits, not imputed with
  a guess.
- **`entity-rates` unreachable but `/score` reachable** (or vice versa): `assembleFeatures` requires
  `entityRates()` to succeed first, so a down `/entity-rates` blocks scoring entirely for that
  refresh cycle even if `/score` itself would answer — there is no partial-feature degraded mode.
- **Demo-pin race**: a `/ops`-ramped forecast (`modelVersion: 'demo-override'`) is checked via
  `isDemoPinned` at the top of both `isStale` and `applyScore`, and excluded from both `tick()` and
  `warmAll()` in `batchScorer.ts` — this is the documented fix for a real bug where the 90-second
  critical-tier rescore used to silently reset a presenter's ramped score back down.
- **Training/live schema skew (fixed, documented)**: `airportDirectory.ts`'s `localDateParts` exists
  specifically because an earlier version computed `hour_of_day`/`day_of_week`/`month` from UTC
  components instead of the origin airport's local time, a constant 5.5-hour skew for every Indian
  flight, on two of the model's highest-gain features.
- **`origin_hour_density` unit skew (fixed, documented)**: `train.py`'s
  `compute_origin_hour_density` docstring records that an earlier live-serving reference table
  computed a whole-year sum per (origin, hour-of-day) rather than the per-slot count the training
  feature actually measures — "two orders of magnitude larger," caught by what the comment calls a
  "VP-readiness audit."
- **Upstream data source unavailable at training time**: `ingest_bts.py`/`ingest_anac.py` raise
  `FileNotFoundError` with an explicit instruction to run the download script first, rather than
  silently proceeding on partial data; a still-downloading zip is skipped with a warning
  (`zipfile.BadZipFile`), not treated as corrupt.

## Tests

Tests exist at the Node-client layer, not for the Python model itself in this file set:

- `zkd-app/server/engine/riskModel.test.ts` — the feature-assembly / scoring client
- `zkd-app/server/engine/thresholds.test.ts`, `zkd-app/lib/thresholds.test.ts` — adaptive band
  computation and the pure `bandFor`/UI lookups
- `zkd-app/lib/thresholdConfig.test.ts` — config loading/hot-reload
- `zkd-app/server/engine/batchScorer.test.ts` — tiered interval scoring
- `zkd-app/server/engine/rescoreTiming.test.ts` — tier assignment and TTL scaling
- `zkd-app/server/engine/forecastEventRescore.test.ts` — event-triggered rescore + debounce
- `zkd-app/server/engine/altPrefetchGate.test.ts` — the riskScore-gated alt-prefetch trigger
- `zkd-app/server/notify/bandCrossing.test.ts`, `dispatch.test.ts` — alert/stand-down logic
  downstream of a band change
- `zkd-app/server/airportDirectory.test.ts` — airport lookups, jurisdiction, local time math

**Real gap**: no test file in this list exercises `zkd-risk-model`'s Python code (`features.py`,
`train.py`, `inference.py`) directly — correctness there rests on `features.py`'s own runtime
leakage self-check and `train.py`'s honest chronological-holdout evaluation, not on an automated
test suite. Per the top-level `CLAUDE.md`, CI (`.github/workflows/ci.yml`) runs `tsc`, `vitest run`,
and `build` only — it does not run the Python model pipeline or `npm run verify`, so a regression in
`zkd-risk-model` would not be caught by CI at all, only by a human re-running `train.py` and
comparing `model_metrics.json` by eye.

## See also
- [01-detection-and-triggers.md](01-detection-and-triggers.md)
- [03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md)
- [08-suppliers-and-integrations.md](08-suppliers-and-integrations.md)
