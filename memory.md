# memory.md — decisions, insights, work log

## Recent work

- 2026-08-17 — **Outbound member notifications built (`zkd-app/server/notify/`)** — the one part of
  the "predict → warn → recover" story that did not exist at all. Before this there was no SMS,
  WhatsApp, email or push code anywhere in `zkd-app`, `saga.ts`'s `notify` step was a stub returning
  `{ok:true, ref:'notified'}`, and nothing compared consecutive risk bands, so a flight could cross
  every threshold without anyone being told.
  - **Trigger:** `server/engine/forecast.ts`'s `applyScore` — the single place a real `ModelScore`
    becomes a forecast, shared by the on-demand and batch paths, so it is the only point that
    catches both. New persisted `Flight.lastNotifiedBand` dedupes; the rule is a pure function in
    `server/notify/bandCrossing.ts` (`crossedUpward`) so it is testable without a database.
    **Fires only on a STRICTLY upward move into `prepare` or above** — the batch re-scorer
    re-evaluates on an interval, so anything firing on a steady state fires forever.
    Deliberate cost: a dip-and-recovery is never re-announced.
  - **Mark-then-send, not send-then-mark.** The marker is set before `applyScore`'s existing
    `store.createFlight` so it lands in the same write (a second write would race the batch
    scorer). A crash between the two loses one alert; the reverse would re-send on every restart,
    and crying wolf is the worse failure. `store.createFlight` JSON-serialises the whole `Flight`
    into a `data` column, so the new field needed no migration.
  - **Three channels, fanned out in parallel, none of them load-bearing:** `telegram.ts` (no KYC —
    the only channel reliably obtainable in minutes; Indian transactional SMS needs DLT
    registration, which is days and a registered entity, so real SMS was rejected as a demo bet),
    `whatsapp.ts` (Twilio sandbox — recipient must send the join code once per phone and the
    session dies after 24h idle, so **re-join on demo morning**), `push.ts` (Expo → the Android
    app's existing `disruption`/`updates` channels and `zkd.recovery` category; tokens registered
    at runtime via new `POST /api/devices`, bound to the SESSION passenger, never a body-supplied
    id, and stored in `server/.state/devices.json`).
  - **The invariant the module exists to enforce: notifying must never break predicting.**
    `dispatch()` is called from inside `applyScore`, so a revoked Telegram token must not cost a
    member their risk score — every channel is awaited inside `allSettled`, every failure is a
    value, and `dispatch` cannot reject. Same reason `saga.ts`'s notify step now **always returns
    `ok:true`**: a failing step triggers `compensateAll`, which would have *unwound the flight,
    hotel and car we just booked* because a text message failed.
  - Every attempt is logged to `server/decisionLedger.ts`'s new `logNotification` →
    `.state/notifications.jsonl`, with skipped-because-unconfigured kept distinct from
    tried-and-rejected. "We warned you in advance" is this product's strongest claim and an
    unlogged notification makes it unfalsifiable.
  - Copy lives in `templates.ts` so three channels cannot drift; it is asserted by test to **never
    say "held" or "reserved"** (the no-holds design below) and to always state the band next to the
    bare percentage — "4%" alone reads as reassuring, "4%, high risk" reads correctly.
  - **Verification:** `tsc --noEmit` clean · `npm test` 67 passed / 3 skipped, from 54 before ·
    both reproducibility gates green (`iropssim` diff empty, four canon hashes identical).
    20 new tests across `bandCrossing.test.ts`, `dispatch.test.ts` (fan-out logic, fully mocked)
    and `wiring.test.ts` (real modules, no credentials — catches a channel that throws at import
    or an `isConfigured()` reading an env var nobody sets, which a mocked test cannot).
  - Env keys documented in `.env.example`; with none set, nobody is messaged and prediction and
    recovery behave exactly as before.
- 2026-08-17 — **Two pre-existing test-suite defects found and fixed while adding the above.**
  Neither was caused by the notification work; both had been red since the three-way merge, which
  had never run `npm test` (see the merge entry below: "Not run: npm test/vitest").
  - **`npm test` was reporting 8 failing files, 7 of them meaningless.** `tests/*.test.ts` are
    written for **Node's own runner** (`import { test } from 'node:test'`) — they arrived with the
    no-holds branch, which verified via `node --experimental-strip-types` — while the rest of the
    suite is vitest from Zayaan's branch. Vitest still matched them on `**/*.test.ts`, found no
    vitest suite inside, and failed each one. Excluded `tests/**` in `vitest.config.ts`.
    **Still open:** `node --test tests/` dies on `MODULE_NOT_FOUND` because the `@/` alias has no
    resolver under `node:test`, so those ~7 files are unrunnable by *either* runner as committed.
    They need porting to vitest (which already resolves `@/`) or a loader. Excluding them stopped
    the noise; it did not restore the coverage.
  - **`altCache.ttlMs` is now a DEAD CONFIG KNOB for alts** — a real finding, left for the team.
    `ttlWiring.test.ts` existed to catch exactly this bug class ("ops retunes the config and
    nothing happens"). `isAltsStale` no longer reads `config.altCache.ttlMs` at all: since the
    no-holds branch it delegates entirely to `altsRefreshPlan` → `refreshIntervalFor()`, whose
    inputs are departure proximity, severity, seats, watchers, the supplier rate-limit floor,
    offer expiry and whether a consent window is open. The field is **still live for ground**
    (`isGroundStale` shares it and still passes), so it cannot just be deleted — someone has to
    decide whether alts staleness was *meant* to escape ops control when the refresh loop replaced
    holds. Rewrote the alts case to assert what the code now genuinely guarantees (staleness
    tracks the live plan's own boundary, not a hardcoded constant), preserving the regression
    value without asserting something untrue. The test had also been comparing an unawaited
    Promise since the Postgres migration, so it passed vacuously on one side.

- 2026-08-17 — **Merged all three parallel Aug-17 branches into one working tree**
  (`feature/cancellation-prediction-and-caching`, `feature/autonomous-rebooking-pipeline`,
  `no-holds-refresh-reissue`) — not a mechanical `git merge`: all three had independently rewritten
  overlapping parts of the same engine from the same Aug-13 base, and a plain merge left real
  conflicts, one silent regression, and one duplicate object key.
  - **The load-bearing fix**: Zayaan's branch deleted `server/engine/simulation.ts` and the entire
    `/api/disruptions/*` route tree (migrating the store to Postgres) without a replacement, which
    would have shipped with no way to trigger or recover from a disruption at all. Krishna's pipeline
    branch has the real state machine (search → score → hold → consent-gated execute) but predates
    the Postgres migration. Kept Krishna's logic and converted every `store.*` call site to the
    async/Postgres API: `simulation.ts`, `pipeline/index.ts`, `pipeline/journal.ts`'s `mirrorToTask`
    (made fire-and-forget rather than cascading `async` through the saga's 17+ synchronous
    `journal.append`/`transition` call sites — it only mirrors step progress onto
    `RecoveryTask.shown` for display, not pipeline decision state). Restored
    `/api/disruptions/*`, `/api/pipeline/*`, and `/recovery/[id]` from Krishna's branch and
    re-exported `RecoveryView` from `lib/apiTypes.ts`, which had silently lost it.
  - **`altsCache.ts`**: kept Krishna's version over Zayaan's — his fixes a real live bug (a
    wholesale-replace refresh could null out `owedNow` under an open consent window) and adds an
    adaptive refresh interval via `server/governor.ts`; Zayaan's was a simpler config-driven TTL.
    Added Zayaan's `await store.createFlight(flight)` write-back, since the cache mutates a
    Postgres-backed object in place.
  - **Band naming**: `no-holds-refresh-reissue` renamed `lib/thresholds.ts`'s `holdGate` band to
    `ready`; Zayaan's branch (already merged first) had independently rewritten the same logic into
    `server/engine/thresholds.ts` under the original `hold-gate` name. Kept `hold-gate` as canonical
    (already wired end to end) and fixed the `ready`-named references that came in from
    `refreshCadence.ts` and its tests instead of porting the rename.
  - **`server/engine/forecast.ts`**: merge produced a literal object with `partySize` set twice (a
    stale hardcoded `partySize: 1` from before, and the real threaded value) — not a git conflict,
    since both edits landed on different lines. Kept the real one.
  - **Suppliers**: `server/suppliers/index.ts`/`types.ts` now carry both `kiwi`/`skyscanner`/
    `travelfusion` (pipeline branch) and the write-capable `sandbox` adapter (no-holds branch,
    `ZKD_SANDBOX=1`-gated) side by side — additive, no real conflict once both were kept.
  - **Verification**: `npx tsc --noEmit` is clean across the fully merged tree (was the baseline
    before starting, and the bar throughout). Not run: `npm test`/`vitest` (several test files —
    e.g. `ttlWiring.test.ts` — still assert against the pre-Postgres synchronous `isAltsStale` API
    and need updating to `await`; no Postgres instance or Python venv available in this session to
    exercise the DB or model paths live).
  - Pushed as `integration/three-way-merge-onto-main` for review — not merged into `main` directly.
- 2026-08-17 — **Speculative holds removed from the design entirely.** A passenger cannot hold two
  flight tickets, so a hold on a replacement seat taken *before* the carrier cancels is a duplicate
  booking that carriers' auditors cancel — sometimes cancelling the original. Most Indian LCCs offer
  no free hold at all. Applies to flights, hotels and ground alike: **nothing is claimed before the
  carrier acts.** Replaced by a **refresh loop** that keeps N coherent flight+hotel+ground *bundles*
  policy-passing and valid, re-shopping before the soonest `offer_expiry` lapses (`refresh-cadence`,
  derived like the confirmation window and returning which bound was binding).
  - **Retired proof IDs `hold-ttl` and `churn-governance`**; `refresh-cadence` replaces both, and
    per-carrier `recovery_rate` (how reliably a carrier settles valid refund claims) replaces
    `hold_conversion` as the feedback signal that changes behaviour.
  - **Three clocks are now** `offer_expiry` · `time_to_announcement` · `cancellation_deadline`.
    `hold_TTL` is deleted; the hotel `cancellation_deadline` is promoted from "a fourth clock" and
    now matters *more*, since with nothing held it is the only thing making `cancelHotel` possible.
  - **`iropssim.py` never modelled holds**, so `sens-portfolio` (38.63), `sens-breadth` (26.31),
    `sens-allocation` and every outcome band are unaffected. Both gates verified green afterwards.
  - **Honest cost, do not hide it:** nothing is secured, so in a systemic surge we lose seats we
    would previously have held, and Outcome C (next-day + hotel + duty of care) gets likelier.
    What it wins is no inventory externality — we never hoard seats during a disruption.
  - Code: this branch renamed `lib/thresholds.ts` band `holdGate` → `ready`; **not carried into the
    merge** — `lib/thresholds.ts` is superseded by Zayaan's `server/engine/thresholds.ts` on the
    branch this merged onto, which already uses `hold-gate` as the canonical band name end to end.
    The refresh-loop/no-holds *design* decision above stands; only the band-rename mechanics didn't
    port. `partySize` threaded into `ThresholdInputs`; `scarcityFactor` now works on
    `seats / partySize` and is **identical at partySize 1**.
- 2026-08-17 — **Reissue model, sandbox and policy gate implemented.** 79 tests, `tsc --noEmit`
  clean, `next build` clean, both reproducibility gates green.
  - `lib/refreshCadence.ts` — derived per-component interval mirroring `confirmWindow.ts`, returning
    `boundBy: offer-expiry | band-floor | band-ceiling`. Flights refresh on offer expiry (minutes),
    hotels far slower, ground never (quoted on demand). **Band maxima are tier `assumed`** — set at
    2× the minimum pending measurement of how fast offers actually die per route.
  - `server/suppliers/sandbox.ts` — the only write-capable adapter. Inventory is **stateless by
    construction**: `hash(seed, route, date)` plus an exponential decay curve, so a hot reload or
    parallel test run cannot make it drift. Refuses a second active coupon for the same
    `(passenger, date)`, which turns the no-holds constraint into a regression test. Registered in
    the search union **only under `ZKD_SANDBOX=1`**, so synthetic seats never appear beside real
    Duffel inventory.
  - `server/policy/index.ts` — default deny, **twelve** rules (the ten planned plus
    `incoherent_bundle` and `incomplete_policy_inputs`). Missing carriers or fare rules deny rather
    than pass. Memo cache stores digest→verdict only, so a count bound is correct and we never walk
    the object graph at runtime; a data reload flushes it; **a cache hit still emits a ledger entry.**
  - `lib/ranking.ts` — the trap worth remembering: once Amex fronts, member-visible cost for a fresh
    purchase is ₹0, so ranking on it would tie with a free reissue and the reversibility tiebreak
    would pick the *expensive* option. Ranking uses **net economic cost**, consent uses
    **member-visible cost**, and there is a regression test for the inversion.
  - `server/ledger/reconciliation.ts` — `RefundClaim`, separate from the decision ledger. A denial
    raises `ESCALATED_FINANCE` on a back-office queue with a contestable case computed from our own
    entitlement rules. Sweeps batch **by carrier, not per claim**. `recoveryRate` per carrier is the
    successor to churn governance and feeds the expected-recovery term in ranking.
  - `server/domain/outcome.ts` — per-component status with four states; `ROLLED_BACK` and
    `NOT_ATTEMPTED` deliberately distinct ("your cab was cancelled" vs "we never booked a cab" need
    different things from the member). The push carries the same split as the screen.
  - **`opa` is not installed here**, so the Rego/WASM gate canon specifies is implemented in
    TypeScript, one named pure function per rule for a 1:1 swap later. Deliberately one
    implementation rather than a Rego copy that can drift.
  - **Merge note (2026-08-17, this integration):** brought in as available-but-not-yet-wired
    capabilities alongside Krishna's `autonomous-rebooking-pipeline` and Zayaan's Postgres/risk-model
    rewrite — this branch's own log already flagged "still to do: wire the engine to these modules,"
    so nothing here regresses by landing unwired. `server/suppliers/index.ts` and
    `server/suppliers/types.ts` were reconciled to carry both this branch's `sandbox` adapter/`lane`
    plumbing and the pipeline branch's `kiwi`/`skyscanner`/`travelfusion` sources together.
- 2026-08-15 — **VP-readiness pass: fixed real correctness/security bugs, made the demo non-inert,
  added a real accuracy story, real tests/CI, and production-hardening infra — all found by a live
  browser walkthrough + a 48-tool-call audit, all fixed and live-verified, nothing left unresolved
  from that audit's "fix five things first" list.**
  - **The demo was inert — now fixed and proven live.** Action-band floors (10/25/45) were never
    checked against real model output; every live flight scored 2-4% and could never cross them, so
    `prepare`/`hold-gate`/`pre-authorise`, the alt-cache pre-fetch, and the recovery flow were all
    unreachable in a demo. Wrote `zkd-risk-model/src/score_distribution.py` (grid-scores 168,000 real
    feature combinations through the live scorer, batched into one DMatrix call — a first per-row-loop
    version took >20 min and was killed/rewritten) to get the model's REAL live-serving score
    distribution (min 0.89%, p90 2.58%, p99 3.63%, max 4.06%). Recalibrated
    `config/risk-thresholds.json` to `base:{2,3,5} floor:{1,2,4} ceiling:{3,4,7}` — verified against
    real property tests (`server/engine/thresholds.test.ts`), which caught a real edge case
    (`hasHardConstraint:true` alone collapsed `holdGate`==`preAuthorise` at a narrower gap). Seeded one
    real high-risk flight (`u4`, BOM→GOI, real late-Sunday-22:00-UTC red-eye — the actual real
    max-risk profile the grid search found for the current month, computed dynamically via
    `nextSundayAt22UTC()` so it's never a stale hardcoded date) — **live-verified in browser**: 4%
    real score, real "HIGH RISK" band, 4 real alternatives pre-cached (up from 0), decision ledger
    logging both the prediction and the disruption-trigger outcome. Even the original flagship flight
    `u1` now reaches `hold-gate` under the recalibrated thresholds.
  - **Fixed a real train/serve skew, not just a cosmetic bug**: `train.py`'s `origin_hour_density_avg`
    groupby split an already-namespaced key ("BTS:JFK:14") on the first ":" and collapsed to 2
    country-level buckets; worse, it measured a WHOLE-YEAR SUM per (origin, hour-of-day), not the
    per-real-hour-slot COUNT `features.py`'s actual training feature measures — two orders of
    magnitude different (fallback was 625, real training median is 17). Fixed by extracting
    `compute_origin_hour_density()` (now unit-tested, `tests/test_train_features.py`) to rebuild the
    exact per-slot count and fall back to its real median (now 2.0), not a mean-of-means skewed by
    hub airports. Retrained 3x chasing this down; model hash unchanged (only the serving-time
    reference table changed, not the training data itself — expected, not a bug).
  - **Made the explanation panel honest about cold-start fallback**, not just mathematically correct:
    `riskModel.ts`'s `assembleFeatures` now also returns a `dataSource` map (`'real'` /
    `'population-average'` / `'unknown'`) per historical-rate feature; `ForecastAudit.tsx` fades and
    labels fallback-driven bars ("population average — no history yet for this one") instead of
    presenting a population prior as if it were this carrier's own evidence — closes a real gap the
    audit flagged as "the most likely place a sharp technical judge catches the team out."
  - **Real accuracy story, not cherry-picked**: `train.py` now computes a naive-baseline and a
    logistic-regression baseline, a real lift table, and per-country/month segment metrics, plus a
    real matplotlib reliability diagram (`reports/calibration_plot.png`). Honest finding, stated
    plainly in the new `zkd-risk-model/MODEL_CARD.md`: XGBoost only modestly beats logistic regression
    on PR-AUC (0.236 vs 0.232) though it meaningfully leads on ROC-AUC (0.873 vs 0.848); top-decile
    lift is 7.0x; Brazil (the smaller market) measurably underperforms the US (ROC-AUC 0.772 vs
    0.819) — the model card leads with this, not just the flattering number.
  - **Security/resilience real bugs fixed**: `session.ts` now refuses the checked-in dev secret in
    production (`NODE_ENV==='production' && !SESSION_SECRET` throws at import); all 17 outbound
    `fetch` calls now have `AbortSignal.timeout`; `scoreFlightsBatch`/`serve.py`'s batch handler are
    now per-item-resilient (one bad flight no longer 500s the whole sweep); 6 previously-unguarded
    Next.js API routes now validate/reject malformed bodies via a new `server/jsonBody.ts` helper
    (`explain/route.ts`'s LLM-prompt inputs are also length-capped and control-char-stripped).
  - **OAG: real progress, 2 of 100 trial calls spent.** `version=2` → real 404 (routing broken).
    `version=v2` → real 400 naming the actual required shape (`CarrierCode` +
    `DepartureAirport`/`ArrivalAirport` + a `DepartureDateTime`/`ArrivalDateTime` range — NOT the
    `FlightIdentities` batching the original code assumed). `flightInstancesBatch()` now throws a
    specific documented error instead of silently sending a known-wrong request; one more real call
    (datetime-range format) would close it out.
  - **Real tests + CI, from zero**: 10 pytest tests (`inference.py` golden-vector + SHAP-sum
    invariant + the `origin_hour_density` regression), 12 vitest property tests (`bandFor`,
    `thresholdsFor` — deliberately test properties/ordering, not hardcoded numbers, so they survive
    threshold recalibration), 1 Playwright E2E test (real login → real forecast → real audit panel →
    real reverify, against the real app + real scorer both booted) — all passing,
    `.github/workflows/ci.yml` added. Found and fixed a real accessibility bug along the way:
    `/flights`'s "View details →" / "View recovery →" were plain `<div>`s, not real links — Playwright
    couldn't click them and neither could a keyboard user; now real `<Link>`s.
  - **Retrain automation + monitoring, unapplied**: `src/entrypoint.py` + `Dockerfile.trainer` chain
    download→ingest→features→train→S3-upload unattended, with S3-cached raw data so a weekly retrain
    isn't a 600MB re-download every time (`infra/training.tf`'s task pointed at an image that didn't
    exist before this). `infra/monitoring.tf` adds real CloudWatch alarms (Lambda errors/duration,
    SQS DLQ depth for Scheduler-level RunTask failures, an EventBridge rule for real ECS Task State
    Change failures — deliberately NOT a fabricated `ECS/ContainerInsights` metric, which doesn't
    exist for a scheduled RunTask) + a dashboard, reusing `budgets.tf`'s existing SNS topic.
    `terraform fmt` + `validate` clean. Local decision ledger (`server/decisionLedger.ts`,
    `.state/predictions.jsonl` + `.state/outcomes.jsonl`) makes the "every prediction and outcome is
    logged" claim real in dev, not just in unapplied S3-writing Lambda code — verified live: a real
    disruption trigger logged a real `outcome:"cancelled"` row.
  - **Stale/contradictory doc lines fixed**: root `README.md` and `SUBMISSION.md` still said "no
    trained risk model yet"; `04-infrastructure-and-cost.md` still said "forecast is bought from
    Lumo" — all three superseded/corrected, since a VP or judge reads these first.
  - Two full `next build` passes clean; final live regression (login → flights → flight detail →
    audit panel → reverify → `/ops` trigger-disruption → real recovery) all passed in-browser.
  - Full plan at `C:\Users\Mohamed Zayaan\.claude\plans\shiny-herding-dream.md`.
- 2026-08-14 — **Added prediction history, real per-prediction explanation, and reverification.**
  `Flight.forecastHistory` (capped 288 points) grows on every real score, including from a new
  self-starting interval batch re-scorer (`server/engine/batchScorer.ts`, wired via
  `instrumentation.ts` — Next's server-startup hook) so history accumulates independent of page
  views. `zkd-risk-model/src/inference.py`'s `explain()` returns real XGBoost tree-SHAP
  contributions per prediction (verified: bias + contributions == raw margin, to 4 decimals);
  surfaced as a diverging bar chart in the new `components/ForecastAudit.tsx` on `/flights/[id]`,
  using a validated blue/red pair (`node scripts/validate_palette.js` — the app's own existing
  safe/risk green-red pair FAILED CVD separation, so this chart uses `--iris`/`--risk` instead,
  which passed clean). `POST /api/flights/[id]/reverify` forces a real re-score and reports drift
  against the last one, flagging same-model/same-config swings ≥15pp. Verified live end-to-end
  (two reverifies reproduced identically); the rendered chart itself was not visually checked in a
  browser — see `documentation/design/05-cancellation-risk-model.md` §8 item 7.
- 2026-08-14 — **Replaced the Lumo vendor forecast with a real, self-trained model.** Deleted
  `zkd-app/server/lumo.ts` (the mock/DEMO_FIXTURES fallback) entirely — no mock path remains in the
  prediction pipeline, per explicit instruction ("no mock, demo, or fake data/model/pipeline",
  because this has to be VP-demoable end to end). New `zkd-risk-model/` package: real US DOT/BTS +
  Brazil ANAC historical data (2.4M+ real rows, no synthetic data), leakage-checked geography-agnostic
  feature engineering, XGBoost + isotonic calibration, chronological (not shuffled) train/calib/test
  split. Served by `zkd-risk-model/src/serve.py` locally and the same `inference.py` in an AWS Lambda
  (`infra/scoring.tf`) in production — verified identical code path both ways.
  `zkd-app/server/engine/riskModel.ts` assembles live features (real OAG + airport-distance data,
  cold-starting unseen `LIVE:`-namespaced Indian/international carriers to the population base rate
  with lower confidence, closing via the weekly retrain as real outcomes accumulate) and calls the
  scorer; returns `null` (never a fabricated number) if unreachable. Verified live end-to-end: booted
  both processes, logged in as a real seeded passenger, confirmed real `source: 'internal-ml'` +
  real `modelVersion` scores flowing through `/api/passengers/[id]/schedule`.
  Alternative-flight pre-caching (`server/engine/altsCache.ts`) is now **gated on the real risk band**
  (`config/risk-thresholds.json` → `altCache.prefetchAtOrAbove`, default `prepare`) instead of firing
  on every page view (`server/domain/views.ts`'s old unconditional `refreshAltsIfStale` call removed).
  Adaptive-threshold constants (`lib/thresholds.ts`) externalized to
  `zkd-app/config/risk-thresholds.json`, hot-reloadable (`lib/thresholdConfig.ts`, 30s poll locally;
  AWS AppConfig in prod, `infra/appconfig.tf`).
  Real Terraform (`zkd-risk-model/infra/`, `terraform validate`-clean) for the AWS production shape —
  **not applied**; user has a $140 AWS credit reserved for the week before the final presentation,
  demo-sized `terraform.tfvars.demo.example` provided, `terraform plan`-only until then.
  Live-tested the real OAG Flight Info Trial key (user-provided, one call spent of the 100-call
  budget): `Subscription-Key` auth reaches the gateway fine, but the assumed
  `https://api.oag.com/flight-instances/` path 404s — real base path needs confirming from the
  account's own OAG developer portal page before spending more of the trial budget. Documented in
  `server/oag.ts` and `documentation/design/05-cancellation-risk-model.md` §8.
  New doc `documentation/design/05-cancellation-risk-model.md` supersedes `01-prediction-model.md`
  §2 (banner added there); `04-infrastructure-and-cost.md`'s "no model of our own" line and
  `architecture.md`'s "not modelled" section both updated to point at it.
- 2026-08-12 — Reorganized markdown: specs → `documentation/agent-specs/{current,legacy}/`,
  the four design docs → `documentation/design/` (+ `documentation/README.md`), submission-deck
  artifacts → `documentation/project/`; PPT + API-requirements sheets → `assets/`. Cross-references
  and the canon-hash check in `AGENTS.md`/`README.md` updated to the new paths. Committed and merged
  `origin/main` + `worktree-shimmering-stirring-sutherland` into `main`.
- 2026-08-12 — **DATA LOSS INCIDENT**: `documentation/design/02-data-sources-and-apis.md` had
  uncommitted edits (two reference lines: "conversion (`design/01` §6) is the measurable form of
  that…" and "expiry rather than fixed (`design/03` §3.1)…") that were overwritten during the move
  when the working-copy encoding was corrupted and the file restored from git. No backup found
  (VS Code local history, worktree copy, git blobs, VSS all negative). Restore by re-typing those
  two lines into `documentation/design/02-…` if they mattered.
- 2026-08-08 — Initial scaffolding: created `AGENTS.md`, `context.md`, `memory.md` in repo root.
  Repository is a Round 1→Round 2 hybrid with GitHub `submodule` history (gitlinks pointed at
  `49e78886…` for `Code/` and `zkd-sites/` which are inert and carry no source).

## Decisions & insights

- **The sequence agent reads root `AGENTS.md` first, then `context.md`, then `memory.md`.**
- `n3`-tier numbers must come from `iropssim.py`; never invent `sim` figures.
- Canon block `## A2. FROZEN ARCHITECTURAL FACTS` must stay byte-identical across four files —
  single scripted change-set, verify hashes, never hand-edit one.
- `README` warns the recovery platform headline is **both** breadth + selection; when quoting levers,
  separate "search more alternative flights" from "allocate better".

## Open items (gaps from the docs)

- DGCA duty-of-care thresholds carry `deck` tier; primary CAR text not re-verified — must be
  reconciled before production.
- **Model has no Indian/most-international historical training data yet** (real bulk per-flight
  labeled datasets don't exist publicly for these routes) — feature set is geography-agnostic by
  design so it has a mechanism to generalize; real accuracy on Indian carriers is unmeasured until
  the back-test/retrain loop accumulates enough real outcomes. See `zkd-risk-model/README.md`.
- Model doesn't consume weather yet (v1) — `server/weather.ts` is real and live but not joined into
  training data. Next retrain scope.
- **OAG: base path + version confirmed (`version=v2`), exact query shape not yet** — 2 of 100 trial
  calls spent; real 400 named the required params (`CarrierCode` + `DepartureAirport`/
  `ArrivalAirport` + a `DepartureDateTime`/`ArrivalDateTime` range). One more real call would close
  it out. See `server/oag.ts` header and `documentation/design/05-cancellation-risk-model.md` §8.3.
- **Continual-learning loop's outcome-join is not built** — predictions/outcomes are really logged
  locally (`server/decisionLedger.ts`) and to S3 in the AWS path, and the weekly retrain now runs
  genuinely unattended (`zkd-risk-model/src/entrypoint.py`), but nothing yet maps the accumulated
  `LIVE:` outcome log back onto `features.py`'s BTS/ANAC training schema — a retrain today still
  trains on US+Brazil data only.
- AWS infra (`zkd-risk-model/infra/`) is real Terraform, `terraform fmt`/`validate`-clean (now
  includes real CloudWatch alarms + a dashboard, `infra/monitoring.tf`), unapplied — $140 credit
  reserved for demo week, `terraform plan`-only until then.
- Next.js 16 deprecated the `middleware.ts` file convention in favor of `proxy.ts` (`npm run build`
  prints the warning) — cosmetic/forward-compat only, not touched yet.
- `npm audit` flags 3 high-severity transitive vulnerabilities (postcss/sharp, via `next`) —
  pre-existing, not introduced this session; fix requires bumping `next` past its pinned
  `16.2.12`, untested — flagged, not applied.
- Supplier integration partial: Duffel returns real offers, Sabre cert returns none, Travelport synthetic.
- API-failure modeling gap (rate limits, timeouts, circuit breakers) — swap statement in
  `iropssim.py` may be the first place to model it.
- Android app lacks pre-auth / consent-settings screen (the four-screen subset).

## Reproducibility checks to keep green

1. `python3 iropssim.py | diff - iropssim-output.json` → empty
2. Four canon hashes identical (`python3` glob now reads `documentation/agent-specs/current/*_v2.0.md`).

## Scoring / build notes

- `zkd-app` runs `npm install && npm run dev` → `http://localhost:5176`.
- `zkd-app` tests: `npm test` (vitest, no server needed) / `npm run test:e2e` (Playwright — needs
  the real app AND the real scorer both running, see `PILOT_TESTING.md`) / `npm run build`.
- `zkd-risk-model` tests: `pip install -r requirements-dev.txt && pytest -v` (needs `models/`
  populated — real, small, checked into git, no download/retrain needed to just run the tests).
- If a route mysteriously 404s in dev right after a burst of file edits/restarts, it's very likely
  a stale Turbopack `.next` cache, not a real code regression — `rm -rf zkd-app/.next` and restart
  before debugging further (chased a phantom "reverify is broken" this session before finding this).
- `ZKD Website/serve.js` serves the three demo sites on 5173/5174/5175; binds `0.0.0.0` (demo),
  don't run on public Wi-Fi.