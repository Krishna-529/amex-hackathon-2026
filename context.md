# context.md — current state of the repository

Last refreshed: 2026-08-18 (full re-audit — three parallel deep-dive explorations of
`zkd-app`, `zkd-risk-model`, and the LangGraph/Bedrock/`zkd-execute`/`infra`/`policy`
surface, plus a git-log reconstruction of every commit since the last refresh).

## Project

ZKD Concierge — Codestreet 2026 / American Express (Team ZKD, IIT Madras). Autonomous
travel-disruption concierge for Indian domestic aviation: predict/detect an IRROPS event,
re-accommodate the member (flight + hotel + ground), claim duty of care from the carrier, stop
safely when it cannot.

## The system is two planes + a shared contract, not one app

This is the single most important structural fact to internalize before touching code:

| Plane | Package | Owns | Can it spend/book? |
|---|---|---|---|
| **PLAN** | `zkd-app/` | Domain model, Postgres store, read-only supplier search/scoring, the LangGraph.js planning graph, member/ops UI, auth | **No — zero execution authority, structurally.** `zkd-app/package.json` has no dependency on `zkd-execute`; there is no import path by which PLAN code could call a booking/payment function even by mistake. |
| **EXECUTE** | `zkd-execute/` | The real Temporal worker: `recoverySaga.ts` (LIFO saga), booking/payment activities, its own ledger | **Yes — the only plane that can.** Every mutating activity calls `evaluatePolicy()` (real OPA) immediately before the real/mock side effect. |
| **Contract** | `zkd-shared/` | Types only + two pure-function/thin-client modules shared by both planes: `idempotency.ts` (deterministic key derivation), `opaClient.ts` (fail-closed OPA HTTP client), `haltConditions.ts` (6-condition negotiation-loop halt logic — implemented and tested, **not yet wired into any live caller**, see below), `ledger.ts` (shared entry types) | N/A — no I/O beyond the OPA fetch |

`docker-compose.yml` (repo root) stands up the whole local stack for real: Postgres (5433),
Temporal (7234) + Temporal UI (8082), an OPA sidecar (8181), and the `zkd-execute` worker
container. This is genuinely runnable end-to-end locally without any cloud account.

`policy/execute.rego` (+ `execute_test.rego`, repo root) is the real, tested, default-deny OPA
policy enforced by `zkd-execute`. `zkd-app`'s own pre-check of the same shape is a cheap
in-process early filter only — never the actual authorization boundary; that's `zkd-execute`'s job.

`infra/execution-plane/` — real Terraform for the EXECUTE plane (ECS Fargate for
`zkd-execute` + an OPA sidecar, Temporal on shared RDS, Secrets Manager). `terraform
validate`-clean, **never `apply`'d**. Reads `zkd-risk-model/infra`'s remote state to share a
VPC rather than building a second network.

`amex-travel-disruption-concierge/` is a **separate, earlier, standalone** proof-of-concept for
the same LIFO saga/rollback pattern (Temporal + OPA + mock suppliers) — not part of the Round 2
submission bundle, kept for its own README/demo. Don't confuse it with the real `zkd-execute`
plane above, which is the one that matters now.

## Version history

- **Round 1**: deck + architecture validation plan (`documentation/architecture/validation-plan.md`,
  13 findings — 11 still live as Q&A rehearsal material, 1 resolved (Celery dropped, confirmed:
  `zkd-execute` depends only on `@temporalio/*`), 1 superseded by the current in-memory
  candidate-set negotiation design). Evidence tier `deck` numbers originate here.
- **Round 2**: four v2.0 agent specs, four written design docs, web + Android prototypes, Monte
  Carlo simulator, submission bundle (APK, videos).
- **2026-08-14 → 15**: risk model replaced a mocked vendor forecast with a real self-trained
  model (US+Brazil only at first); demo-readiness pass (real thresholds, real tests/CI, security
  fixes). See `memory.md` for the detailed log.
- **2026-08-16 → 17 (current)**: three parallel workstreams — an ML cancellation-prediction/caching
  pipeline, an autonomous-rebooking pipeline (state machine + option scorer), and a
  no-holds-refresh-reissue pipeline — were three-way merged, **and** the real Temporal/OPA/Duffel
  execution plane (`zkd-execute`, `zkd-shared`, `policy/`, `docker-compose.yml`) — which had
  existed only as unpushed local work — landed on `origin` as one buildable whole for the first
  time. A full audit pass then closed every gap it found (auth, rate limiting, CSRF, hash-chained
  ledger, circuit breaker, saga kill-switch — see `memory.md`). The risk model was retrained twice
  more, growing from 2 to 5 real training countries (US, Brazil, UK, Australia, France) plus a
  real India carrier-rate prior, and gained real overfitting/underfitting diagnostics that caught
  and fixed a real chronological-split bug along the way.
- **2026-08-18**: full VP-level architecture review across all three planes (see
  `C:\Users\Mohamed Zayaan\.claude\plans\as-a-senior-vp-hashed-sun.md` for the complete
  prioritized optimization roadmap). Headline finding, not previously documented anywhere in this
  repo's own tracking files: **LangGraph.js is genuinely wired in (`zkd-app/server/engine/planningGraph.ts`,
  a real compiled `StateGraph`) but every node is deterministic TypeScript with zero LLM calls, and
  Bedrock is used nowhere in the codebase** — the only live LLM is Gemini, used solely to narrate
  an already-computed number/decision in one sentence, never to decide anything. The four
  agent-spec docs promise a real LLM-driven multi-round negotiation; the code does not have one.
  See "Known gaps" below (the VP roadmap's content now lives entirely in this file — the plan
  file it was written to has since been reused for a different, later plan, see the next entry).
- **2026-08-18 (later same day)**: shipped neighbor-smoothed forecasting — see the new
  "Forecast responsiveness" row below and the full design rationale in git history (commit
  message on the change that added `server/engine/neighborSmoothing.ts`). The Claude Code plan
  file at `C:\Users\Mohamed Zayaan\.claude\plans\as-a-senior-vp-hashed-sun.md` **now holds this
  plan, not the VP optimization roadmap referenced above** — that roadmap was never a repo file
  to begin with (it lived only in Claude's local plan storage), and its content was already fully
  absorbed into this file's "Known gaps" list before the file got reused, so nothing was lost.
  Any future "Tier N" language you see referenced elsewhere in old chat history refers to that
  now-overwritten plan; treat this file's "Known gaps" list as the current source of truth instead.
- **2026-08-18 (even later)**: shipped a real member-preference-aware rebooking ranker (surgically
  ported from an unmerged, 264-file-diverged branch — see `memory.md` for why a full merge was
  rejected), a timeout-bounded "autopilot notice" window (autopilot used to have zero window),
  and — this is the direct answer to this file's own "Bedrock is used nowhere" finding above —
  **Bedrock now has its first real use in this codebase**: a member's free-text preference prompt
  ("arrive before 6pm") is parsed into a structured patch and re-ranked through the same
  deterministic scorer, never used for flight selection itself. See the new "Rebooking ranker"
  and "Member-driven refinement (Bedrock)" rows below. `planningGraph.ts`'s own nodes are still
  100% deterministic — Bedrock sits in an adjacent, narrowly-scoped flow, not inside the graph.

## Key architectural commitments

| Topic | Commitment |
|---|---|
| Agent architecture (as specified) | Four collaborative agents (Supervisor/Negotiator, Flight Reshop, Hotel Re-accommodation, Ground Transfer) on LangGraph, LLM-driven, 3-iteration negotiation with 6 ordered halt conditions |
| Agent architecture (as implemented) | A real LangGraph.js `StateGraph` (`classify → flightSpecialist → hotelSpecialist → groundSpecialist → supervisor → END`) — every node is still pure deterministic TS, **no LLM call inside the graph itself**, no iteration/negotiation loop wired up (`zkd-shared/src/haltConditions.ts` remains uncalled). `flightSpecialistNode` was upgraded 2026-08-18 from a bare `.find()` to a real six-criterion ranker (see "Rebooking ranker" row) — still fully deterministic, just no longer a priority cascade. |
| Rebooking ranker (2026-08-18) | **Real, not a rename.** `server/pipeline/score.ts`'s `applyHardRules()`+`rankAlts()` (surgically ported from `origin/feature/autonomous-rebooking-pipeline`, adapted onto this branch's current domain files) replaced the old `.find()` cascade. Hard rules (`avoid_airlines`, party-fit, cabin-downgrade) filter first and can never be outvoted by score; survivors are ranked on six weighted criteria (arrival/cost/reliability/cabin/loyalty/effort) per the member's `optimization_strategy` (`server/preferences/presets.ts`), with three explicit guards stopping a free carrier-protected option from sweeping every comparison on price alone. `TravelerPreferencesWire` (`server/preferences/schema.ts`) is a new optional `Passenger.preferencesWire` field, JSONB, no migration; `defaultWireFor()` synthesizes a sane `earliest_arrival` default for anyone without a saved profile. Every ranked option — the notice's top pick and every "browse" alternative — carries a real `OptionReason` (`{kind, text, leadingCriterion}`, same shape family as `TopReason`), always present, never dependent on an LLM. |
| Member-driven refinement (Bedrock) (2026-08-18) | **Bedrock's first real use anywhere in this codebase.** `server/bedrock.ts`'s `parsePreferencePrompt()` (official `@aws-sdk/client-bedrock-runtime` SDK, Converse API forced tool-use, wrapped in the existing `CircuitBreaker` class) turns a member's free-text prompt into a `.strict()`-zod-validated patch (`server/preferences/refinePatch.ts`) with **no field that could raise a cap, raise a cabin, un-reject a rejected offer, or reference a specific flight** — the safety envelope is the schema not having those fields, not a runtime check. `server/engine/refine.ts` merges the patch and re-runs the SAME deterministic ranker above on the SAME already-fetched candidate pool by default (no new supplier call, matching the agent-spec's own "a fresh fan-out per intervention is exactly the churn the coordinator exists to prevent" mandate); a fresh, more tightly rate-limited search only runs if the patch empties an otherwise non-empty pool. New route `POST /api/disruptions/[flightId]/refine`, rate-limited per-member (4 burst/1-per-min). Any Bedrock failure (no ARN configured, timeout, open circuit, invalid response) returns `null`, never throws — the re-rank silently degrades to the unmodified deterministic ranking with an honest note, never a fabricated change. |
| Autopilot notice window (2026-08-18) | Autopilot used to have **zero window** for a real seat decision — it booked instantly, with no chance to intervene. `lib/confirmWindow.ts` gained an optional `ceilingSeconds` param (the 120s floor is reused unchanged for every tier) and `AUTOPILOT_NOTICE_CEILING_SECONDS=180` (3 min — short and deliberate: an override *opportunity*, not a decision gate, an order of magnitude below `ask`'s 20-min ceiling). `ask` consent's own window/escalation behavior is unchanged (regression-tested). A free re-time (no seat decision) still books instantly on both tiers. |
| Canon facts | `## A2. FROZEN ARCHITECTURAL FACTS` identical in all four agent-spec `*_v2.0.md`; never edit one copy — verify hash script in `AGENTS.md`/root `README.md` |
| Risk model | **Built, not bought.** Self-trained XGBoost, real per-flight/aggregate-expanded data from **five** countries (US DOT/BTS, Brazil ANAC, UK CAA, Australia BITRE, France AQST/DGAC) + a real India DGCA carrier-rate prior (rate-only, not per-flight rows) + honestly-documented unavailability for Middle East/Russia/most of Asia-Pacific (each region individually researched, not assumed). ROC-AUC 0.829 / PR-AUC 0.121 / Brier 0.0118 on the current 5-country test split; a plain logistic-regression baseline currently **beats** XGBoost on PR-AUC (0.140 vs 0.121) — reported honestly in `MODEL_CARD.md`, not hidden. See `documentation/design/05-cancellation-risk-model.md` and `zkd-risk-model/MODEL_CARD.md`. |
| Overfitting/underfitting diagnostics | `train.py` now reports train-vs-test gap, a per-round learning curve, 5-fold blocked (time-ordered, never-shuffled) cross-validation, and per-country/month segment metrics on every run — this is what caught the real BITRE chronological-split bug (test ROC-AUC had collapsed to 0.619) before it shipped. |
| Continual learning | **Not built.** Every live prediction/outcome is logged (`decisionLedger.ts`, weekly unattended retrain via `entrypoint.py`), but nothing joins the accumulated `LIVE:`-namespaced outcome log back into `features.py`'s training schema — real Indian/live flights stay cold-started to the population/DGCA/synthetic prior indefinitely, even across retrains, until this ETL is built. |
| Data layer | **Real Postgres** (`zkd-app/server/domain/store.ts`, JSONB-per-aggregate, advisory-lock-guarded migrations + seeding), replacing an earlier in-memory `Map` design specifically to survive two ECS tasks behind a load balancer. Migration `0002_forecast_snapshots.sql` (2026-08-18) adds a real, indexed, queryable table — one row per prediction, real or neighbor-smoothed — separate from and additive to the JSONB `forecastHistory` array the chart reads. |
| Forecast responsiveness (2026-08-18) | **Neighbor smoothing** (`zkd-app/server/engine/neighborSmoothing.ts`, config: `risk-thresholds.json`'s `neighborSmoothing` block) nudges a standard/dormant-tier flight's cancellation estimate using other flights at the same origin airport departing within `windowMinutes`, on a 3-min tick — every input is a real (`source:'internal-ml'`) score, never chained off another smoothed one (enforced at the SQL layer, `store.getLastRealSnapshot`/`getNeighborRealSnapshots`), capped per-pass, with a 45-min wall-clock backstop forcing a real re-score. This is what let the standard/dormant real-call intervals widen (10min→15min, 30min→60min) without the displayed number going stale. `FlightForecast.topReason` (`server/engine/topReason.ts`) is now always present — a deterministic plain-language reason computed synchronously for every forecast, optionally re-phrased by Gemini (`/api/explain`, now actually called, cached) but never dependent on it. `POST /api/flights/[id]/reverify` is now rate-limited per member (5 burst / 1-per-min, keyed on session, not IP — see Trust/safety row). `ForecastAudit.tsx`'s `HistoryChart` visually distinguishes real vs. neighbor-smoothed points (solid vs. hollow-dashed, same `--iris` hue — never `--risk`, so an estimate is never visually implied to be "bad"). **`risk-thresholds.json`'s `bands` (prepare/holdGate/preAuthorise cutoffs) were NOT touched by this work** — the ⚠️ staleness gap below is still open. |
| ⚠️ Live config staleness | **`zkd-app/config/risk-thresholds.json` was last hand-tuned 2026-08-16, against a score distribution from a UK-only 3-country retrain (real max 10.33%).** Two retrains since (5-country + India prior) shifted the real distribution again (current `zkd-risk-model/reports/score_distribution.json`: max 9.2%, p99 6.88%, mean 3.93%). The `preAuthorise` band (`base:11, floor:9, ceiling:15`) is likely now unreachable or only barely reachable by any real flight. **Not yet re-verified against the 6 seeded demo flights** — re-run `zkd-risk-model/src/score_distribution.py` and redo the empirical recalibration the file's own comment describes before relying on `preAuthorise` in a live demo. |
| Auth | Two independent hand-rolled HMAC-signed-cookie schemes (`node:crypto` only, no next-auth): member session (`zkd_session`, 12h) and operator session (`zkd_ops_session`, single shared `OPS_ACCESS_KEY`, 8h). Both refuse to boot in production without their secret set. `middleware.ts` does presence-only checks (edge runtime can't run the crypto); the real boundary is `server/auth/guard.ts`, checked in every route handler. |
| Trust/safety | Rate limiting (token-bucket, in-process — not yet multi-instance-safe, see Known gaps) on login/ops-login/disruption-trigger/**reverify** (5 burst, 1/min, per-member since 2026-08-18 — previously unlimited); Origin-header CSRF check on payment-adjacent routes; a hash-chained (`hashChain.ts`) decision ledger, best-effort S3-mirrored; an operator kill-switch that cancels an in-flight Temporal saga through its own compensation path; OPA default-deny, fail-closed on unreachable. |
| Consent/safety (member-facing) | Decision window derived from real supplier offer expiry (floor 120s below which asking is "theatre" and consent tier decides alone); Autopilot (silence proceeds, gated on a real per-transaction cap) vs Ask-me-first (silence escalates unless the fix is free); a rejected offer is permanently blacklisted (`rejectedAltIds`), enforced at OPA via `rejected_offer_ids`, not just filtered in TS. |
| Party-level rebooking | Real, not bolted on — `Booking.travellerIds[]`, one `RecoveryTask` per (flight, passenger/PNR), `altsForParty()` makes a market alt hard-block (`ok:false`) if it can't seat the whole party ("we will not split your party across flights" enforced server-side, not just displayed), while a carrier-protected seat is always owed per-ticket regardless of party size. |
| Suppliers | Duffel = real sandbox bookings (search + write). Sabre = real cert client, returns no inventory. Travelport = **always mock, key or no key** — both code branches call the same generator; the "real integration lands here once access exists" comment is accurate today but the branching structure invites the wrong assumption on a skim. LiteAPI hotels = real, falls back to mock. Ground transport (cabs) = **no real supplier at all, ever.** Payment = fully mocked (`zkd-execute/src/payments/vpayment.ts`, in-memory). |
| OAG | Real Azure APIM client, dual-key rotation, 100-call/14-day trial budget tracked in a local JSON file. `masterDataAirport()` genuinely works (airport reference data). `flightInstancesBatch()` **unconditionally throws** — the real endpoint's filter shape (`CarrierCode` + airports + a datetime range) doesn't match what the function was written against (a flight-number list); 2 of 100 trial calls spent confirming this. `prior_leg_cancelled` (the risk model's theoretically strongest feature) is therefore always `null` at serving time, and is now correctly masked out of training too so reported metrics reflect reality. |
| LLM usage | **Gemini** (`server/gemini.ts`, plain `fetch`, no SDK, `gemini-flash-latest`) narrates an already-computed number in ≤25 words (`/api/explain`) or re-phrases a deterministic rebooking reason — never influences a decision, never the only source of a "why." **Bedrock** (`server/bedrock.ts`, official SDK, since 2026-08-18) does influence what gets ranked, but only by producing a narrow, schema-constrained preference patch that the same deterministic scorer re-ranks against — it never picks a flight directly. Both fail to `null`/an honest fallback note on any error, never fabricate. No LLM anywhere calls a booking/spend function — that authority still lives only in `zkd-execute`, which neither plane depends on. |
| Latency budget | WARM phase does ~42s of prepared work (signal ingest + context assembly + supplier fan-out) ahead of time so the live carrier-event path is ~10-11s, not 53s cold; alt/ground search is gated on `riskScore >= 75` (percentile rank) so it doesn't fire on every page view — this is the real mechanism behind the "~300→102 API calls" cost-control claim. |
| Public Wi-Fi | Demo servers (`zkd-website/serve.js`) bind `0.0.0.0` — never run on conference/public Wi-Fi. |

## Reproducibility contract (must stay green)

1. `python3 iropssim.py | diff - iropssim-output.json` → empty
2. Four canon hashes match (see `AGENTS.md` § canon block)
3. `zkd-risk-model`: `python3 src/train.py | diff` is **not** byte-reproducible run-to-run in the
   way `iropssim.py` is (real retrains can shift the score distribution — see the config-staleness
   entry above); instead, `pytest -v` (12/12) and `tsc --noEmit` across `zkd-app`/`zkd-shared`/`zkd-execute`
   must stay clean, and `zkd-app`'s vitest suite must stay at 154/167 (13 skips: 3 intentional,
   the rest DB-gated integration tests — `store.integration.test.ts`,
   `forecastSnapshots.integration.test.ts`, `refine.test.ts`, `simulation.test.ts` — that only run
   against a real Postgres, e.g. via `docker-compose up`).

## Directory map

- `zkd-app/` — **PLAN plane.** Next.js 16/React 19 web app. Routes: `/flights` `/flights/[id]`
  `/prepare/[id]` `/recovery/[id]` `/profile` `/settings` `/history` `/how-it-works` `/ops`
  (operator console, direct URL only). `server/engine/simulation.ts` is the module-level
  `setTimeout`-driven lifecycle engine — process-lifetime by design, does not survive a restart
  mid-window (still unfixed, see Known gaps). `server/engine/planningGraph.ts` is the real
  LangGraph.js graph (see above). Real Postgres via `server/domain/store.ts`.
  `server/engine/neighborSmoothing.ts` + `server/engine/topReason.ts` (2026-08-18) are the
  forecast-side additions — see "Forecast responsiveness" above. `server/preferences/` (wire
  schema/adapter/presets), `server/pipeline/` (the six-criterion ranker, `score.ts`),
  `server/bedrock.ts`, and `server/engine/refine.ts` (2026-08-18, later) are the rebooking-side
  additions — see "Rebooking ranker"/"Member-driven refinement" above.
- `zkd-execute/` — **EXECUTE plane.** Standalone Temporal worker package: `workflows/recoverySaga.ts`
  (real LIFO saga), `activities.ts` (every activity OPA-gated before its side effect),
  `suppliers/duffelWrite.ts` (real), `suppliers/mockBookingSupplier.ts`, `payments/vpayment.ts`
  (mock), `failureInjection.ts` (chaos-testing hook, `FORCE_FAILURE` env var).
- `zkd-shared/` — **Contract package**, types + `idempotency.ts` + `opaClient.ts` +
  `haltConditions.ts` (unwired, see Known gaps) + `ledger.ts`. Both planes depend on it; neither
  plane depends on the other.
- `policy/` — real OPA/Rego for the EXECUTE plane: `execute.rego` (default-deny) +
  `execute_test.rego`. `policy;C` (a stray empty dir, almost certainly a malformed Windows
  `cd`/`mkdir` artifact, not a real component — safe to delete whenever noticed).
- `infra/execution-plane/` — Terraform for `zkd-execute`'s AWS shape. Unapplied.
- `zkd-risk-model/` — the real, self-trained cancellation model: `src/ingest_*.py` (one per
  country/source), `src/features.py`, `src/train.py`, `src/inference.py` (shared scorer class),
  `src/serve.py` (local stdlib HTTP, port 8090), `src/handler.py` (AWS Lambda), `src/entrypoint.py`
  (weekly unattended retrain), `models/` (checked-in trained artifacts), `reports/`
  (`model_metrics.json`, `score_distribution.json`, `calibration_plot.png`), `infra/` (Terraform,
  unapplied), `MODEL_CARD.md`, own `README.md`.
- `zkd-android/` — Expo/RN Android app, subset (Flights, Flight detail, Recovery, Profile) of the
  web app, polling the same server-authoritative engine.
- `documentation/agent-specs/current/` — current-canon four specs `zkd_*_agent_v2.0.md` (design
  doc prompt + runtime LangGraph system prompt each); `legacy/` superseded, provenance only.
- `documentation/design/` — four core docs read in order (prediction model, data/APIs, action
  policy, infra & cost) + `05-cancellation-risk-model.md` (supersedes `01-prediction-model.md` §2).
- `documentation/architecture/` — `architecture.md` + `validation-plan.md` (13-finding Round 1
  review; status per-finding noted in Version History above).
- `documentation/project/` — `SUBMISSION.md` (what was submitted, honest known-limitations list).
- `amex-travel-disruption-concierge/` — separate, earlier saga/rollback proof-of-concept, not part
  of the Round 2 bundle. Own README.
- `iropssim.py` + `iropssim-output.json` — 250k-case fixed-seed Monte Carlo behind every
  `sim`-tier number.
- `docker-compose.yml` (root) — the real local stack: Postgres, Temporal + UI, OPA, `zkd-execute`.
- `zkd-website/` — production builds of the three Round 1 evidence sites + `serve.js`
  (5173/5174/5175). `Code/` — their editable source. `zkd-sites/` — same source, GitHub Pages
  config. `zkd-launcher/` — Windows shortcuts to the hosted versions, not source.
- `assets/builds/`, `assets/media/` — the APK and demo videos. `assets/deck/` — pitch deck.
  `assets/data/` — API-requirements/credential tracker.
- `tools/` — one-off scripts not part of either app (`build_logo.py`).
- `README.md`, `context.md`, `memory.md`, `AGENTS.md` — kept at root deliberately: landing page,
  fast architecture orientation, the running decision record, and agent house rules.

## Evidence tiers

`verified` · `calc` · `sim` · `assumed` · `budget` · `deck`. Known gap: DGCA duty-of-care
thresholds carry `deck` until primary CAR text is re-retrieved.

## Known gaps (current, as of 2026-08-18 — this list is the durable record; no external plan
file is required to understand it, see the Version History note above about the Claude Code
plan-file path having been reused for a later, unrelated plan)

- **Partially addressed (2026-08-18): Bedrock now has a real, narrow use (member-driven rebooking
  refinement — see "Member-driven refinement" row above), but the full LLM-driven multi-round
  negotiation the four agent-spec docs describe (Supervisor + 3 specialist agents, iteration/
  halt-condition loop) is still not built.** `planningGraph.ts`'s nodes remain deterministic;
  `zkd-shared/src/haltConditions.ts` still has no caller. The spec/code gap is smaller than it
  was but still real — don't conflate "Bedrock is used" with "the specced negotiation loop exists."
- **`risk-thresholds.json`'s `bands` (prepare/holdGate/preAuthorise cutoffs) are stale against the
  current real score distribution** — see the ⚠️ row above. Still open; the 2026-08-18 neighbor-
  smoothing work touched this same file's `forecast`/`neighborSmoothing` sections but deliberately
  did not touch `bands` — don't conflate the two changes.
- **The disruption lifecycle doesn't survive a process restart mid-window** — `setTimeout` chains
  are module-level/process-lifetime; a persisted `RecoveryTask.windowExpiresAt` with no live timer
  behind it just silently never resolves. Not yet fixed.
- **Nothing autonomously starts the recovery lifecycle from a live signal.**
  `app/api/flight-status/route.ts` classifies real AviationStack data and triggers a risk re-score,
  but never calls `detectDisruption()` — only a human clicking `/ops` does. Not yet fixed.
- **`evaluateHaltConditions` (zkd-shared) has no caller outside its own test** — the spec's 6-halt-condition
  negotiation loop is implemented and tested in isolation but not wired into `planningGraph.ts`.
  Not yet fixed.
- Circuit breaker exists in exactly one place (`riskModel.ts`'s call to the scorer); every other
  external call (AviationStack, weather, LiteAPI, Duffel/Sabre search, MyCa) has no retry/backoff.
  Not yet fixed.
- Continual-learning join not built (see table above).
- `prior_leg_cancelled` unusable at serving time (OAG gap, see table above).
- Rate limiter, TTL cache, and the local decision-ledger/OAG-trial-budget files are all
  single-instance/local-disk-first — fine for a demo process, not multi-instance-safe yet. This
  now also applies to the new `neighborSmoothing.ts` scheduling loop and the module-scope Gemini
  response cache in `app/api/explain/route.ts` (2026-08-18) — same caveat, not a regression.
- DGCA duty-of-care thresholds still carry `deck` evidence tier.
- Travelport is mock-only regardless of key presence (misleading branch structure, low risk).
- No real ground-transport supplier exists at all.
- `infra/` (both `zkd-risk-model/infra` and `infra/execution-plane`) is `terraform validate`-clean
  but has **never been `apply`'d** — a first-ever apply under finale-week pressure is itself a risk
  if any part of the demo is meant to run on real AWS.
