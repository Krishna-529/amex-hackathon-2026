# memory.md — decisions, insights, work log

## Recent work

- 2026-08-18 (even later) — **Shipped a real, member-preference-aware rebooking ranker, a
  timeout-bounded "autopilot notice" window, and a Bedrock-driven free-text refine flow** — the
  LangGraph/LLM alternate-flight-search orchestration the user asked for after the neighbor-
  smoothing work below, done as its own planned build (plan mode → a critical mid-plan discovery
  → re-scoped plan → approved → implementation). Verified clean: `tsc --noEmit`, `npm test`
  (154 passed / 13 skipped, up from 95/101 — the new skips are DB-gated integration tests for
  `refine.ts`/`simulation.ts`'s autopilot-notice lifecycle), `next build --webpack`.
  - **Critical discovery before any code was written**: the richer scoring engine this feature
    needed (a real six-criterion weighted ranker, a member-preference wire schema) does NOT exist
    on this branch — it only exists on an unmerged branch (`origin/feature/autonomous-rebooking-pipeline`)
    that has diverged **264 files** and predates massive amounts of this branch's own real work
    (the trained risk model, Postgres/auth/rate-limit hardening, real Duffel/Sabre/Travelport
    suppliers — that branch still has the deleted mock vendor forecast). A full merge would have
    been catastrophic. Verified via `git diff`/`git show` that the actual scoring logic
    (`server/preferences/{schema,adapt,presets}.ts`, `server/pipeline/score.ts`) is nearly
    self-contained — its only domain dependencies (`altsForParty.ts`, `pricing.ts`, `myca.ts`)
    are byte-identical or functionally identical to this branch's own versions — so this shipped
    as a **surgical 6-file port**, not a branch merge, adapted onto this branch's current
    `planningGraph.ts`/`simulation.ts` rather than pulling in the source branch's own (much older)
    orchestration. Flagged to whoever owns branch strategy: that source branch should probably be
    archived now that its one genuinely valuable piece has been ported, before it drifts further.
  - **The ranker is real, not a rename.** `server/engine/planningGraph.ts`'s `flightSpecialistNode`
    used to be a bare `find()` priority cascade (carrier-protected first, else first eligible
    market alt). It now calls `applyHardRules()` (avoid_airlines / party-fit / cabin-downgrade —
    real exclusions, never outvoted by score) then `rankAlts()` (six criteria — arrival/cost/
    reliability/cabin/loyalty/effort — weighted by the member's `optimization_strategy`, three
    explicit guards against carrier-protected's `fare:0` sweeping every comparison on price alone).
    Ported with exactly one deliberate logic addition beyond a verbatim port: a `leadingCriterion`
    field so the UI-facing reasoning doesn't have to duplicate the scorer's own `explain()` logic.
  - **Every option now carries a real, honest "why"** — `OptionReason` (`server/domain/types.ts`),
    same `{kind, text, ...}` shape family as the cancellation-risk `TopReason` from earlier today,
    same "deterministic baseline always present, LLM enrichment layered on top, never required"
    contract. This directly answers the mid-session follow-up request for transparency/trust in
    why a given option was picked.
  - **`server/preferences/`, `server/pipeline/` are new packages**, `TravelerPreferencesWire` is
    a new optional field on `Passenger` (`preferencesWire?`), stored in the existing JSONB blob —
    no migration. `defaultWireFor()` synthesizes a sane `earliest_arrival` default for any
    passenger with no saved profile, so nobody regresses to "no ranking at all." Two non-flagship
    demo passengers (`p-rohan`: `minimize_layovers`, `p-ananya`: `lowest_cost`) got real seeded
    profiles so the preference-driven ranking is actually demonstrable — Priya/Arjun's own
    behavior was deliberately left untouched.
  - **Autopilot gets a real countdown notice for the first time** — it used to have ZERO window,
    booking a real seat decision instantly with no chance to intervene. `lib/confirmWindow.ts`
    gained an optional `ceilingSeconds` param (the 120s floor is reused unchanged — "below this,
    asking is theatre" applies to a notice exactly as much as a real ask) and a new
    `AUTOPILOT_NOTICE_CEILING_SECONDS = 180` (3 minutes — short because this is an override
    *opportunity*, not a decision gate, deliberately an order of magnitude below `ask`'s 20-minute
    ceiling so autopilot never quietly becomes a second ask flow). `ask` consent's own window/
    escalation behavior is provably unchanged (`server/engine/simulation.test.ts`'s regression
    guard). A free re-time (no seat decision) still books instantly on both tiers, unchanged.
  - **Bedrock is now actually used** — the first real use anywhere in this codebase (previously
    confirmed completely absent, back at the earlier VP review). `server/bedrock.ts`'s
    `parsePreferencePrompt()` uses the official `@aws-sdk/client-bedrock-runtime` SDK (new
    dependency — Bedrock needs real SigV4 signing, unlike Gemini's simple API-key REST call),
    Converse API with forced tool-use for structured output, wrapped in the **existing**
    `CircuitBreaker` class (reused verbatim from the risk-model scorer, not reimplemented). Its
    entire attack surface is a `.strict()` zod schema (`server/preferences/refinePatch.ts`) with
    no field that could raise a cap, raise a cabin, un-reject a rejected offer, or reference a
    specific flight — the safety envelope is enforced by those fields not existing, not by a
    runtime check alone. `server/engine/refine.ts` re-ranks the SAME already-fetched candidate
    pool by default (no new supplier call — matches the agent-spec's own explicit "a fresh fan-out
    per intervention is exactly the churn the coordinator exists to prevent" mandate); only a
    real fresh search, separately and more tightly rate-limited, runs if the patch makes the
    existing pool structurally empty. New route `app/api/disruptions/[flightId]/refine/route.ts`
    (separate from `consent/route.ts` since `resolveTask` is synchronous and this needs to
    `await` a real LLM call), rate-limited per-member (4 burst/1-per-min, tighter than
    `reverify`'s 5/1 since this is strictly more expensive per call).
  - **Never fabricates on failure.** No `BEDROCK_INFERENCE_PROFILE_ARN` configured, a timeout, an
    open circuit, or a response that fails the zod schema all return `null` from
    `parsePreferencePrompt` — never throws. `refine.ts`'s re-rank on a `null` patch is a no-op
    re-run of the unmodified deterministic ranking, with an honest "couldn't process your
    preference right now" note — never silence, never a fabricated change.
  - Full plan at `C:\Users\Mohamed Zayaan\.claude\plans\as-a-senior-vp-hashed-sun.md` (as with
    the two prior features today, this file has been reused again for this session's plan —
    see the standing note about this path not being a stable pointer).
- 2026-08-18 (later) — **Shipped neighbor-smoothed forecasting, real DB-level prediction storage,
  per-member reverify rate limiting, an always-on plain-language "top reason," and hardened the
  prediction-history chart** — the full feature set from the earlier VP review's Tier-1-adjacent
  work, done as its own planned build (plan mode → approved plan → implementation, verified with
  `tsc --noEmit`, `npm test` — 95/101, 6 skips, up from 76/79 — and `next build --webpack`, all
  clean). **Reused the same Claude Code plan-file path** as the earlier VP roadmap (Claude Code
  binds one plan file per conversation, not per task) — that roadmap's content had already been
  folded into `context.md`'s "Known gaps" before this happened, so nothing was lost, but any
  external reference to "the roadmap file" by path is now stale; `context.md` is the durable record.
  - **Neighbor smoothing** (`server/engine/neighborSmoothing.ts`, new): between real model calls,
    nudges a standard/dormant-tier flight's cancellation estimate using OTHER flights at the same
    origin airport departing within a configurable window (default 90min), weighted by time-
    proximity and how fresh each neighbor's own real score still is — a Laplace-pseudocount blend
    mirroring `zkd-risk-model/src/features.py`'s `SMOOTH_N` idiom. Deliberately NOT named "adaptive
    threshold" — that term was already taken by the existing alt-cache-gate feature in the same
    config file. Four guardrails make it safe: every input is a real (`source:'internal-ml'`) score
    read via a query that structurally cannot return a smoothed row (`store.getLastRealSnapshot`/
    `getNeighborRealSnapshots`, filtered at the SQL layer — never a runtime check that could be
    forgotten), each pass is capped (±8 riskScore points / ±0.8pp cancelProbability), a 45-min
    wall-clock backstop forces a real re-score regardless of tier timing, and the critical tier is
    never smoothed. This is what let `config/risk-thresholds.json`'s `forecast.batchRescoreIntervalMs`
    (10min→15min) and `dormantRescoreIntervalMs` (30min→60min) widen safely — real model-call
    volume drops while the smoothing backstop actually TIGHTENS the worst-case real-grounding gap
    for dormant flights vs. the old flat 30min-with-zero-interpolation behavior. Avoided multiplying
    live supplier-search calls: `forecast.ts`'s `applyScore()` gained an optional
    `seatsAvailableOverride` param specifically so a smoothing pass reuses the flight's last known
    seat count instead of re-running a real `searchInventory()` call every 3 minutes per flight —
    flagged explicitly as a deliberate, bounded staleness trade-off, not an oversight.
  - **Real DB-level prediction storage** (`server/domain/migrations/0002_forecast_snapshots.sql`,
    new table + two indexes): one row per prediction, real or smoothed, independent of and
    additive to the existing JSONB `forecastHistory` array (which stays the unchanged read path
    for the chart). Exists because a JSONB blob nested in a flight row wasn't a real answer to
    "store every prediction in the backend DB," and because neighbor smoothing needed an
    efficient "other flights at this airport, in this window, with their latest real score" query
    that scanning JSONB blobs in application code couldn't give cheaply.
  - **Always-on top reason** (`server/engine/topReason.ts`, new): every `FlightForecast` now
    carries a `topReason` — a deterministic, synchronous, zero-I/O sentence derived from the top
    SHAP factor (or, for a smoothed score, an honest "not a fresh model run" note) — computed
    inside `applyScore()` so it can never be missing, regardless of whether the optional Gemini
    re-phrasing succeeds. This also surfaced and fixed a real pre-existing gap: `applyScore` used
    to drop `explanation`/`dataSource` entirely on any batch-tier score (only the on-demand path
    ever produced one) — now carries the last real explanation forward so most of a flight's
    lifecycle still has real SHAP material behind the reason, not just the moment after a reverify.
  - **Gemini finally has a caller.** `POST /api/explain` was fully built but had zero callers
    anywhere in the app (confirmed by the earlier VP review) — `app/flights/[id]/page.tsx` now
    calls it to re-phrase the deterministic top reason, with its own request-body-keyed cache
    (kept local to the route, not `server/cache.ts`'s `getOrSet`, specifically so a Gemini
    *failure* is never cached — only successful responses are, for 10 minutes).
  - **Reverify is now rate-limited — it had none before.** `POST /api/flights/[id]/reverify`
    (found to have zero rate limiting during this session's own exploration) now uses
    `server/rateLimit.ts`'s `consumeToken()` directly, keyed per-member (`reverify:${passenger.id}`,
    not the usual per-IP `checkRateLimit()` pattern, since the abuse surface is per-account): 5
    burst, 1/min sustained. 429 responses carry a real `retryAfterMs`; the flight page's existing
    reverify button now shows a ticking "try again in Xs" using that value.
  - **Chart hardening** (`components/ForecastAudit.tsx`'s `HistoryChart`, already existed and was
    reasonably built — extended, not rebuilt): explicit axis titles, and real vs. neighbor-smoothed
    points are now visually distinct (solid vs. hollow-dashed circle, same `--iris` hue deliberately
    — never `--risk`, so an estimate is never visually implied to be worse than a real score), plus
    an updated tooltip/legend. A "Last updated" line was added to `flights/[id]/page.tsx` instead
    of the chart itself (`lib/time.ts`'s existing `agoLabel`, no new helper needed).
  - `FEATURE_LABEL` (the SHAP-factor-name → human-string dictionary) moved out of
    `ForecastAudit.tsx` into new `lib/featureLabels.ts` so `topReason.ts` (server) and the
    component (client) can share one source, instead of duplicating it.
  - Regression fix along the way: adding `store.insertForecastSnapshot()` inside `applyScore()`
    meant two existing tests (`altPrefetchGate.test.ts`, `forecastEventRescore.test.ts`) that mock
    `../domain/store` without that export needed it added to their mocks — caught by `tsc`/running
    the suite, not by inspection.
  - Full plan at `C:\Users\Mohamed Zayaan\.claude\plans\as-a-senior-vp-hashed-sun.md` (as noted
    above, this file no longer holds the earlier VP roadmap).
- 2026-08-18 — **Full VP-of-Engineering architecture review (analysis only, no code changed) +
  refreshed `README.md`/`context.md`/`memory.md`/`AGENTS.md` from a from-scratch re-audit of the
  whole repo** (three parallel deep-dive explorations: `zkd-app`'s engine/rebooking pipeline,
  `zkd-risk-model`, and the LangGraph/Bedrock/`zkd-execute`/`infra`/`policy` surface). These three
  root docs had gone stale since 2026-08-15 — a huge amount of real work (the three-way pipeline
  merge, the real `zkd-execute`/`zkd-shared`/`policy` execution plane landing on origin, two more
  risk-model retrains growing 2→5 real countries) had happened without a docs refresh. Full
  prioritized optimization roadmap written to
  `C:\Users\Mohamed Zayaan\.claude\plans\as-a-senior-vp-hashed-sun.md` (5 tiers: demo-day fire
  prevention, a real Bedrock-driven LangGraph negotiation loop, closing the "autonomous" gap,
  judge-Q&A credibility, real production hardening — not yet implemented, that's the next session).
  - **Headline finding, previously undocumented anywhere in this repo's own tracking**: the four
    agent-spec docs promise an LLM-driven multi-round negotiation between Supervisor + 3 specialist
    agents. `zkd-app/server/engine/planningGraph.ts` **is** a real, compiled LangGraph.js
    `StateGraph` — but every node is deterministic TypeScript (`.find()` over pre-fetched
    candidates); there is no LLM call anywhere in the decision path, and `grep -ri bedrock` across
    the entire repo (code, docs, Terraform) returns nothing. The only LLM in the whole system is
    Gemini, used once, to narrate an already-computed number in one sentence — never to decide
    anything. `zkd-shared/src/haltConditions.ts` (the spec's 6-condition negotiation-loop halt
    logic) is implemented and unit-tested but has no caller outside its own test file.
  - **Found a live, undocumented config-staleness bug**: `zkd-app/config/risk-thresholds.json` was
    last hand-tuned 2026-08-16 against a 3-country score distribution (real max 10.33%). The two
    retrains since (5-country + India prior, see the 2026-08-17 entries below) shifted the real
    distribution again — current `score_distribution.json` reports max 9.2%. The `preAuthorise`
    band (`base:11, floor:9, ceiling:15`) is now likely unreachable or only barely reachable by any
    real flight, and this was never re-verified against the 6 seeded demo flights the way the
    2026-08-16 recalibration was. Flagged in `context.md`'s Known gaps; not fixed this session.
  - Full detail (file:line references, every route/table/gap) lives in the three sub-agent
    transcripts this session, condensed into `context.md`'s new "Key architectural commitments" and
    "Known gaps" tables — treat `context.md` as current going forward, not this log.
- 2026-08-17 — **Landed the real execution plane on origin for the first time, three-way-merged
  three parallel pipelines, then closed every gap a full audit found — plus two more risk-model
  retrains growing 2→5 real training countries.** (Reconstructed from `git log`; this was not
  logged in `memory.md` when it happened.)
  - `zkd-execute` (Temporal worker), `zkd-shared` (contracts), `policy/` (OPA), `docker-compose.yml`
    — the real EXECUTE plane — had existed only as unpushed local work; this is the point it became
    part of one buildable whole on `origin` (commit `425f888` merges it onto the Postgres/risk-model
    base; `d661023` is the full hardening pass on top).
  - Three pipelines three-way-merged: the ML cancellation-prediction/caching pipeline (`6f10843`
    onward — threshold-gated pre-cache, adaptive alt-cache TTL), the autonomous-rebooking pipeline
    (`6d44d80`…`f48d33e` — outbound governor, traveller-preference scoring, hotel/ground registries,
    a real pipeline state machine + journal + option scorer replacing the old scripted act path),
    and the no-holds-refresh-reissue pipeline (`1d52a8d` — removed speculative holds, added a
    refresh loop/bundles/reissue/policy gate).
  - **Audit-driven hardening (`d661023`)**: `/ops` and everything it drives had *zero* auth — added
    a real operator-session boundary (`server/auth/opsSession.ts`, `requireOperator`). No rate
    limiting anywhere — added a token-bucket limiter (`server/rateLimit.ts`) on login/ops-login/
    disruption-trigger. CSRF defense was `sameSite=lax` alone on payment-adjacent routes — added an
    explicit Origin check (`server/auth/csrf.ts`). The decision ledger never reached the
    provisioned S3 bucket and had no tamper-evidence — added a hash chain (`hashChain.ts`, every
    entry embeds the previous entry's hash) + best-effort S3 mirroring. No circuit breaker on the
    ML scorer (a slow/down model silently blanked every forecast) — added one
    (`server/engine/circuitBreaker.ts`) + a last-known-good fallback honestly labeled `stale:true`.
    No way to interrupt an in-flight autonomous saga — added an operator kill-switch routing through
    Temporal's own cancellation (the saga's existing compensation path handled it correctly with no
    changes needed). Dropped a "be reassuring" instruction from the `/api/explain` prompt — let the
    real calibrated numbers speak for themselves next to real SHAP math.
  - **Risk model retrain #1 (`6f10843`/`27d4122`)**: added UK CAA (real, ~80% international by
    count, 1.82M frequency-expanded rows, intraday features honestly masked NaN) and a real India
    DGCA carrier-rate prior (28 real monthly bulletins, pdfplumber-parsed, 11 carriers — a rate
    prior, not new per-flight rows, documented as a materially weaker evidence shape). Added real
    overfitting/underfitting diagnostics to every `train.py` run (train/test gap, learning curve,
    5-fold blocked time-series CV, segment metrics) — this is the mechanism that caught the next bug.
  - **Risk model retrain #2 (`d3a3058`)**: added Australia (BITRE) and France (AQST/DGAC) as real
    training countries — five real countries total now. The new diagnostics immediately caught a
    real chronological-split bug: BITRE's first ingest used its full 2023-2026 range, extending
    later than every other capped-at-2024 source, so the time-sorted test tail became ~75%
    Australian 2025-26 data nothing else represented — test ROC-AUC had collapsed to 0.619, a 0.20
    train/test gap, the textbook overfitting signature. Fixed by locking BITRE to calendar-2024;
    corrected result is the current headline (ROC-AUC 0.829, best of every version so far, train/test
    gap 0.004). Also spent one research pass honestly confirming Middle East/Russia/most of
    Asia-Pacific have no bulk public cancellation data (checked directly, not assumed) — documented
    in `MODEL_CARD.md` rather than left silently unexamined.
  - Verified at the time: `tsc --noEmit` clean across `zkd-app`/`zkd-shared`/`zkd-execute`, vitest
    76/79 `zkd-app` (3 intentional skips) / 22/22 `zkd-shared` / 10/10 `zkd-execute`, 12/12
    `zkd-risk-model` pytest, `next build --webpack` production build succeeds.
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
- **Standing house rule (2026-08-18, user-requested): after any change to code or files in this
  repo, update `README.md` (if the change is user/setup-facing), `context.md` (if it changes
  architecture, status, or a known gap), and `memory.md` (always — a dated entry). The goal is that
  a future session, human or agent, never has to re-explore the whole repo from scratch to know
  what's true right now — `context.md` should always be trustworthy as of its "Last refreshed" date.**
- `n3`-tier numbers must come from `iropssim.py`; never invent `sim` figures.
- Canon block `## A2. FROZEN ARCHITECTURAL FACTS` must stay byte-identical across four files —
  single scripted change-set, verify hashes, never hand-edit one.
- `README` warns the recovery platform headline is **both** breadth + selection; when quoting levers,
  separate "search more alternative flights" from "allocate better".
- `zkd-app` never depends on `zkd-execute` — that's not a convention, it's the actual dependency
  graph enforcing "PLAN has zero execution authority." Never add an import that would break this.
- When retraining `zkd-risk-model`, always re-run `score_distribution.py` afterward and check it
  against `zkd-app/config/risk-thresholds.json`'s bands before assuming the demo bands still work —
  this has now silently gone stale at least once (see the 2026-08-18 entry above) after a retrain
  shifted the real distribution and nobody re-checked the config.

## Open items (current, as of 2026-08-18 evening)

- **`zkd-app/config/risk-thresholds.json`'s `bands` (prepare/holdGate/preAuthorise) are still stale
  against the current real score distribution** — last recalibrated 2026-08-16 (max was 10.33%
  then), two retrains since moved real max to 9.2%. `preAuthorise` (`floor:9`) is likely
  unreachable or barely reachable by any real flight today. Needs the same empirical
  re-verification against the 6 seeded flights the file's own comment describes.
  **Highest-priority open item — directly affects what a live demo can show.** Note: this
  session's neighbor-smoothing work touched the SAME config file (added a `neighborSmoothing`
  block, widened `forecast.batchRescoreIntervalMs`/`dormantRescoreIntervalMs`, bumped `version`
  to 2) but deliberately did not touch `bands` — this item is still fully open, don't assume the
  version bump means it was addressed.
- **Partially resolved 2026-08-18: Bedrock is now used (member-driven rebooking refinement,
  `server/bedrock.ts` + `server/engine/refine.ts`), but the full LLM-driven multi-round
  negotiation the four agent-spec docs describe is still not built** — `planningGraph.ts`'s nodes
  are still deterministic, and `zkd-shared/src/haltConditions.ts` (the negotiation-loop halt
  logic) still has no caller outside its own test. Don't conflate "Bedrock is used somewhere"
  with "the specced negotiation loop exists."
- **The disruption lifecycle doesn't survive a process restart mid-window** — `simulation.ts`'s
  `setTimeout` chains are module-level/process-lifetime; a persisted `windowExpiresAt` with no live
  timer behind it silently never resolves. Not yet fixed.
- **Nothing autonomously starts the recovery lifecycle from a live signal** — `flight-status/route.ts`
  classifies real AviationStack data and triggers a risk re-score, but never calls
  `detectDisruption()`; only `/ops`'s human-operated button does. Not yet fixed.
- Circuit breaker exists in exactly one place (the risk-model scorer call) — every other external
  call has no retry/backoff. Not yet fixed.
- DGCA duty-of-care thresholds carry `deck` tier; primary CAR text not re-verified — must be
  reconciled before production.
- **Continual-learning loop's outcome-join is still not built** — predictions/outcomes are logged
  (`server/decisionLedger.ts`, weekly unattended retrain via `entrypoint.py`), but nothing yet joins
  the accumulated `LIVE:` outcome log back onto `features.py`'s training schema. Real Indian/live
  flights stay cold-started to the prior indefinitely, even across retrains, until this is built.
- **OAG `flightInstancesBatch()` unconditionally throws** — the real endpoint's filter shape
  (`CarrierCode` + airports + a datetime range) doesn't match what the function sends (a
  flight-number list); 2 of 100 trial calls spent confirming this. `prior_leg_cancelled` stays
  `null` at serving time until this is fixed. See `server/oag.ts` header.
- Model doesn't consume weather yet — `server/weather.ts` is real and live but not joined into
  training data.
- A plain logistic-regression baseline currently **beats** XGBoost on PR-AUC (0.140 vs 0.121) on
  the 5-country blend — reported honestly in `MODEL_CARD.md`, not gated by any automated
  champion/challenger check yet.
- AWS infra (`zkd-risk-model/infra/` and `infra/execution-plane/`) is real Terraform,
  `validate`-clean, **never `apply`'d** for either — a first-ever apply under finale-week pressure
  is itself a risk if any part of the demo needs real AWS.
- Rate limiter, TTL cache, local decision-ledger, and the OAG trial-budget counter are all
  single-instance/local-disk-first — fine for one demo process, not multi-instance-safe. Now also
  true of the new `neighborSmoothing.ts` loop and `/api/explain`'s new response cache (2026-08-18)
  — same caveat, not a regression.
- Next.js 16 deprecated the `middleware.ts` file convention in favor of `proxy.ts` (`npm run build`
  prints the warning) — cosmetic/forward-compat only, not touched yet.
- `npm audit` flags 3 high-severity transitive vulnerabilities (postcss/sharp, via `next`) —
  fix requires bumping `next` past its pinned `16.2.12`, untested — flagged, not applied.
- Supplier integration partial: Duffel real (search+write), Sabre cert returns no inventory,
  Travelport mock-only regardless of key presence, ground transport has no real supplier at all.
- Android app lacks pre-auth / consent-settings screen (the four-screen subset).
- Stray empty directory `policy;C` at repo root — a malformed Windows `cd`/`mkdir` artifact, not a
  real component. Safe to delete whenever noticed.
- ~~Reverify (`POST /api/flights/[id]/reverify`) had no rate limiting~~ — **fixed 2026-08-18**,
  5 burst / 1-per-min, per-member. See the dated entry above.
- **`RebookingRules.outOfPocketCap` (a member's own stated spend preference, from
  `adapt()`) is produced but never consulted by `server/pipeline/score.ts`** — only the real MyCa
  `perTransactionCap` gates. A member who set a tighter personal cap than their card's real limit
  won't see it enforced by the ranker. Flagged in the port, not silently patched (2026-08-18).
- **`defaultWireFor()` defaults every passenger without a saved preference profile to
  `optimization_strategy: 'earliest_arrival'`** — a real product decision (2026-08-18), not a
  neutral technical default; wants explicit sign-off since it shapes every unconfigured
  passenger's rebooking behavior, including indirectly the flagship Priya/Arjun scenarios.
- **No global (cross-member) cost ceiling on Bedrock calls** — per-member rate limits
  (`refine:${passengerId}`, 4 burst/1-per-min) bound worst case per incident, but nothing bounds
  aggregate spend if this ran at real incident scale.
- **The source branch (`origin/feature/autonomous-rebooking-pipeline`) that the rebooking ranker
  was ported from is 264 files stale and should probably be archived** now that its one genuinely
  valuable piece (the scoring/preferences module) has been extracted — flag to whoever owns
  branch strategy.

## Reproducibility checks to keep green

1. `python3 iropssim.py | diff - iropssim-output.json` → empty
2. Four canon hashes identical (`python3` glob now reads `documentation/agent-specs/current/*_v2.0.md`).

## Scoring / build notes

- `zkd-app` runs `npm install && npm run dev` → `http://localhost:5176`.
- `zkd-app` tests: `npm test` (vitest, no server needed — the two `*.integration.test.ts` files
  self-skip without `DATABASE_URL` set) / `npm run test:e2e` (Playwright — needs the real app AND
  the real scorer both running, see `PILOT_TESTING.md`) / `npm run build`.
- `npm run build` runs with `NODE_ENV=production` internally (Next.js), which trips
  `session.ts`/`opsSession.ts`'s "refuses to boot without a real secret" guard — a plain local
  `npm run build` with no env vars set fails at the page-data-collection step for the ops-login
  route. Set dummy `SESSION_SECRET`/`OPS_SECRET`/`OPS_ACCESS_KEY` env vars to verify the build
  compiles; this is expected/by-design, not a bug (see the `document/design` note on refusing to
  run insecurely in production).
- `zkd-risk-model` tests: `pip install -r requirements-dev.txt && pytest -v` (needs `models/`
  populated — real, small, checked into git, no download/retrain needed to just run the tests).
- If a route mysteriously 404s in dev right after a burst of file edits/restarts, it's very likely
  a stale Turbopack `.next` cache, not a real code regression — `rm -rf zkd-app/.next` and restart
  before debugging further (chased a phantom "reverify is broken" this session before finding this).
- `ZKD Website/serve.js` serves the three demo sites on 5173/5174/5175; binds `0.0.0.0` (demo),
  don't run on public Wi-Fi.