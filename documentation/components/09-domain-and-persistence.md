# Domain & Persistence

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

This is the one Postgres-backed data layer every other component in the app reads and writes
through: flights, passengers, bookings, travellers, itineraries, pre-auths, journey preferences,
disruption events, recovery tasks, stays and rides, all stored as JSONB-per-aggregate. It also owns
the two money computations the rest of the system depends on for a correct number — refund
estimation (`refund.ts`) and replacement-plan pricing (`pricing.ts`) — plus the audit trail
(`decisionLedger.ts`) and a set of small, generic infra helpers (`cache.ts`, `governor.ts`,
`deadline.ts`) that are not domain-specific but that the domain layer's callers lean on.

## Where it lives

| File | Purpose |
|---|---|
| `server/domain/store.ts` | The store module — every domain read/write goes through here |
| `server/domain/db.ts` | Shared Postgres client, connection pool, advisory locks, migration runner |
| `server/domain/types.ts` | The whole domain's TypeScript shape (Passenger, Flight, Booking, RecoveryTask, etc.) |
| `server/domain/views.ts` | Turns domain entities into API response shapes; also the fabricated-alt read guard |
| `server/domain/refund.ts` | What comes back to the member when a flight is cancelled |
| `server/domain/pricing.ts` | What the replacement plan costs, party-scaled |
| `server/domain/outcome.ts` | Turns a saga's per-component step results into a member-facing report |
| `server/domain/seed.ts` | Demo dataset (5 flights → now 8, 5 card members) and demo-reset logic |
| `server/domain/migrations/0001–0007*.sql` | Schema history, applied in order at boot |
| `server/decisionLedger.ts` | Prediction/outcome/threshold/notification/intent/report audit log |
| `server/ledger/reconciliation.ts` | Refund-claim lifecycle tracking (in-memory, not Postgres — see below) |
| `server/cache.ts` | Process-lifetime TTL cache + a soft-ceiling call counter |
| `server/governor.ts` | Per-supplier rate/quota budget enforcement (`globalThis`-scoped, in-memory) |
| `server/deadline.ts` | Timezone-correct wall-clock ↔ instant conversion for hard deadlines |
| `app/api/passengers/*`, `app/api/flights/*`, `app/api/health/route.ts` | Thin route handlers over `store`/`views` |

## Schema, as it actually evolved

**0001_init.sql** — the baseline. One table per top-level `Map` that used to live in
`server/domain/store.ts`: `flights`, `passengers`, `credentials`, `travellers`, `bookings`,
`itineraries`, `pre_auths`, `past_flights`, `disruption_events`, `recovery_tasks`. JSONB-per-
aggregate throughout — the full TypeScript shape lives in a `data` column, with only the columns a
real query filters or sorts on (`dep_iso`, `passenger_id`, `flight_id`) pulled out as real columns.
Also introduces real Postgres sequences (`booking_seq`, `itinerary_seq`, `task_seq`,
`traveller_seq`) replacing module-level `let x = 0` counters that would have collided across two
ECS tasks, and a `seed_state` marker table so demo seeding happens exactly once across every
process sharing the database.

**0002_stays_and_rides.sql** — adds `stays` and `rides`. Before this, a member could only book a
flight; `bookings` is flight-shaped by design (seat, PNR, cabin), so a hotel or a cab got its own
table rather than widening `bookings` with columns that would be null on every existing row.
`flight_id` is nullable on both — null for a stay booked standalone, set when the stay was arranged
because a specific flight broke.

**0003_journey_prefs.sql** — adds `journey_prefs`: a member's temporary, per-flight window +
consent instruction, same storage shape as `pre_auths` (composite `${flightId}:${passengerId}` key,
JSON blob) and deliberately kept out of the durable MyCa profile — it's discarded with the flight.

**0004_preauth_flight_index.sql** — adds indexes on `pre_auths.flight_id` and
`journey_prefs.flight_id`, columns that had existed since 0001/0003 but were never indexed. This
migration exists because `altsCache.ts`'s `mergePinned` used to find a flight's pre-auths by
loading the *entire* passenger table and issuing one `getPreAuth` call per passenger — a true N+1
on a path (alts refresh) that can fire every 20 seconds during a live disruption. `store.ts`'s
`getPreAuthsForFlight` replaced that with one filtered query; this index is what turns that query
into an index lookup instead of a sequential scan.

**0005_pipeline_runs.sql** — adds `pipeline_runs`. `pipelineRuns` was the one piece of domain state
deliberately left as a pure in-memory `Map` when everything else moved to Postgres, because 24+
call sites in `journal.ts`/`pipeline/index.ts` depend on `getPipelineRun`/`setPipelineRun` being
synchronous. This migration adds durability without touching any of those call sites: writes mirror
to the table fire-and-forget, and a startup hydration reads the table back into the Map.

**0006_decision_ledger.sql** — adds `decision_ledger`, a single generic table (`kind` discriminator
+ JSONB `data`) replacing what used to be **six separate local JSONL files** under `server/.state/`
(predictions, outcomes, threshold evaluations, notifications, member intents, member reports),
appended via `fs.appendFileSync`. That was genuinely broken across more than one process instance —
each instance's disk held only what *it* logged, so "every prediction and every observed outcome
gets logged" was true on one instance and false the moment a second one existed.

**0007_ranker_decision_log.sql** — adds `ranker_decision_log`, the same pattern applied to the
ranker's shown-set/choice logs (`server/pipeline/ranker/decisionLog.ts`), which used to be two
local JSONL files (`ranker-shown.jsonl`, `ranker-choices.jsonl`) with the identical
broken-across-instances problem: whichever process instance served a request was the only one
whose disk ever saw that shown-set, so the offline trainer could only ever learn from one
instance's traffic. `kind` discriminates `'shown'` vs `'choice'`; `decision_id` is pulled out of
the JSON body because `reconcile.ts` and `train.ts` both join on it.

## How it works

### The store module

`store.ts` is organized around one exported async function per read/write operation, grouped by
aggregate (flights, passengers, credentials, travellers/bookings/itineraries, pre-auths, journey
prefs, past flights, disruption events, recovery tasks, pipeline runs, stays/rides). Every
`create*` function doubles as an upsert (`INSERT ... ON CONFLICT (id) DO UPDATE`), mirroring what
was previously `map.set(id, value)` — already an unconditional overwrite — which is why call sites
that fetch-mutate-and-persist (e.g. `finishDecide` flipping a `DisruptionEvent`'s phase) simply
re-call the same `create*` function rather than needing a separate `update*` export. The one
exception is `createCredential`, which keeps an explicit no-op-on-duplicate-email check.

Two functions deviate from plain overwrite-and-persist because a prior version of each had a real
concurrency bug:
- `updateConsent` uses `jsonb_set(...)` inside the `UPDATE` itself, so a passenger's consent flip is
  atomic under Postgres row-level locking rather than a read-modify-write that could silently lose
  one of two concurrent writers (e.g. a member toggling autopilot on two devices).
- `createItinerary` wraps its itinerary insert and every booking's `itineraryId`/`legIndex` update
  in one `q.begin(...)` transaction, so a crash mid-loop can no longer leave an itinerary and its
  bookings permanently disagreeing.

**The mirroring pattern.** `pipelineRuns` is the one place in this file where the in-memory `Map`
is still the primary, synchronous source of truth — `getPipelineRun`/`setPipelineRun`/
`getPipelineRunsForFlight`/`listPipelineRuns` are all plain synchronous `Map` operations, kept that
way because 24+ call sites in the pipeline state machine depend on them not requiring `await`.
`setPipelineRun` additionally calls `mirrorPipelineRunToDb`, a fire-and-forget async write to the
`pipeline_runs` table that swallows and logs its own errors — a transient DB hiccup on the
durability mirror must never surface as a failure in the actual booking flow. `hydratePipelineRunsFromDb`
reads every row back into the Map once, at process startup (`instrumentation.ts`), so a restart
resumes in-flight pipeline runs instead of silently losing them. This is explicitly the same shape
`journal.ts`'s own `mirrorToTask` uses for an analogous concern, and it's the pattern migrations
0005–0007 all generalize: hot-path state stays synchronous and in-memory; Postgres is a
fire-and-forget durability mirror behind it, hydrated back at boot.

### Refund and pricing

`refund.ts`'s `estimateRefund()` is the current, real refund calculation — not a fabricated
number. Three specific properties, verified in this read:

1. **Statutory override on carrier cancellation.** `cancelledBy === 'carrier'` combined with
   `owed(...)` (from `lib/entitlement.ts`) including `'alt-flight-or-refund'` sets
   `statutory: true`, and in that branch the fare rules on the ticket (`fareBasis`) are ignored
   entirely — the full fare comes back, no voluntary-cancellation fee is deducted. The
   `personas.test.ts` P3 case exists specifically to prove this is *not* a lazy
   `cancelledBy === 'carrier' → statutory` shortcut: a carrier cancellation with only a 5h delay
   (under the 6h hotel/refund threshold) is correctly **not** statutory, only `'meals'` is owed.

2. **Party-size scaling — confirmed fixed.** `booking.farePaid` is documented as per-traveller, and
   `estimateRefund` multiplies it by `partySize(booking)` (`booking.travellerIds.length`, floored
   at 1) before using it in any line: `const ticket = paid.amount * travellers;`. The code's own
   comment describes the bug this replaced: the multiplication was previously missing, and since
   alternatives are priced with `partyFare` (fare × party), a party of six compared a six-person
   replacement against a one-person refund — understating Arjun's refund on `f-multi` by ₹32,250.
   `refund.test.ts`'s three cases (`6450 * 6`, `6450 * 1`, `6450 * 4 - round(6450*4*0.25)`) and
   `personas.test.ts`'s P1 (`total === 6500`, single traveller) both exercise this path and pass
   against the code as read. **The bug is fixed in the current code.**

3. **"Not known yet" vs. fabricated zero.** When `booking.farePaid` is absent or non-finite,
   `estimateRefund` returns `{ known: false, lines: [], total: 0, ... }` immediately, before any
   arithmetic runs. Every caller is expected to treat `known: false` as "unknown" in the UI, never
   as a real ₹0. `personas.test.ts`'s P5 ("no allocator claim survives without a fare on record")
   asserts exactly this: `known` is `false` even though `total` happens to be `0`.

`pricing.ts`'s `costFor()` is the mirror-image calculation — what the *replacement* plan costs, per
party. Fare scales by `partySize` (bought once per traveller); hotel and cab costs scale by rooms
(`Math.ceil(partySize / ROOM_OCCUPANCY)`, 2 per room) and vehicles (`Math.ceil(partySize /
cab.seats)`) respectively, since those are shared resources rather than per-ticket ones. The file's
own header records two removed responsibilities worth knowing about: it used to zero the fare for a
now-deleted `'carrier-protected'` alt kind, and it used to check spend against a per-transaction
cap that was removed 2026-08-19 — there is no cap check anywhere in this codebase any more; the
notification ladder in `server/notify/templates.ts` is what stands in its place.

### Decision ledger

`logPrediction()` is called from `server/engine/forecast.ts`'s `applyScore` — the single place a
real `ModelScore` becomes a cached forecast — and writes a `PredictionLedgerEntry`
(`cancelProbability`, `confidence`, `modelVersion`, `source`, `loggedAt`) into `decision_ledger`
with `kind: 'prediction'`. This is the write side of "every prediction gets logged," and it is
exercised: `decisionLedger.integration.test.ts` proves a call to `logPrediction` lands a real row.

`logOutcome(flightId, outcome)` is exported, fully implemented (writes `{ flightId, outcome:
'cancelled', observedAt }` with `kind: 'outcome'`), and documented in its own comment as "the real
'a cancellation was observed' moment — called wherever a disruption is actually detected."

**It has zero real callers.** A repo-wide grep for `logOutcome` across `zkd-app/` returns exactly
one match: the function's own definition in `server/decisionLedger.ts`. No status poller, webhook
handler, member-report path, or test file calls it. This means the *outcome* half of the
prediction/outcome pair that would let anyone compute live model accuracy is never written —
`decision_ledger` will accumulate `kind: 'prediction'` rows indefinitely with no corresponding
`kind: 'outcome'` rows to join them against. `decisionLedger.ts`'s own header comment states
reconciliation is deliberately "not built here" and belongs in the offline retrain pipeline "once
there's enough real outcome volume to be worth running" — but with `logOutcome` never invoked,
there is no outcome volume accumulating locally to reach that point. This is the single largest gap
in the measurement story: no live accuracy claim about the cancellation-risk model is computable
from what this codebase actually writes today.

The other five ledger functions (`logThresholdEvaluation`, `logNotification`, `logMemberIntent`,
`logMemberReport`) are all called from elsewhere in the pipeline (not re-verified here beyond the
grep already performed for `logOutcome`); they follow the identical fire-and-forget,
error-swallowing `logAsync` wrapper.

### Read-path guards vs. write-path fixes

`views.ts`'s `dropFabricatedAlts()` is a direct, documented instance of the "deleting a writer of
bad data is not the same job as purging what it already wrote" pattern. Until 2026-08-19, a
function called `carrierProtectedAlt()` cloned the cheapest real market offer and overwrote its
`fare` to `0` and `seats` to `99`, labeling the result "the airline owes you a seat." That writer
and the `AltKind` value it produced (`'carrier-protected'`) were removed, and the equivalent guards
in `server/pipeline/verify.ts` were deleted along with it — on the assumption that removing the
writer was sufficient. It was not: `altsCache` only rewrites a flight's alts *on refresh*, so a row
that writer had already produced sat untouched in Postgres. One such row survived on `f-multi` —
the flight the demo runs on — and rendered as a free option that also refunded the member, because
`altsForParty` reads `seats: 99` as "fits everyone" and `fare: 0` as "costs nothing."

`dropFabricatedAlts()` runs on the **read path** in `toFlightDetail()`, before currency conversion
and before party-projection, filtering any alt that is free (`fare > 0` required) or has an
impossible seat count (`seats < 99` required) — matched on that signature rather than on `kind`
alone, because rows exist that predate the `kind` field entirely. `views.test.ts` exercises this
directly against the exact fabricated row shape found in production (`id:
'cp-mock:DELBLR:2026-08-17:5', fare: 0, seats: 99`), and separately confirms the guard does *not*
drop a merely unusual real offer (`fare: 1, seats: 1`) — cheap is not the same as fabricated.

## Interfaces

### Inbound — who calls this, and how

| Component | Reads/writes |
|---|---|
| `app/api/passengers/*`, `app/api/flights/*` | `store.listPassengers/listFlights/getFlight/getPassenger/updateConsent`, plus `views.toFlightSummary/toFlightDetail` |
| `server/engine/forecast.ts` | `store.createFlight` (caches forecast in place); `decisionLedger.logPrediction`, `logThresholdEvaluation` |
| `server/engine/simulation.ts` | `store.createDisruptionEvent/setRecoveryTask/listWaitingRecoveryTasks`, `refund.estimateRefund`, `pricing.costFor` |
| `server/engine/altsCache.ts` / `groundCache.ts` | `store.createFlight` (in-place candidate mutation), `store.getPreAuthsForFlight` |
| `server/pipeline/index.ts`, `saga.ts` | `store.getPipelineRun/setPipelineRun`, `store.getBooking/getTravellersForBooking`, `outcome.reportFor/outcomeFor` |
| `server/pipeline/score.ts` | Reads `Flight`/`Booking`/`Alt` types from `types.ts`; not the ranker itself, but scores against these shapes |
| `server/notify/*` | `decisionLedger.logNotification` |
| `server/webhooks/`, `server/engine/statusPoller.ts`, `server/engine/memberReports.ts` | `store.createDisruptionEvent`; `decisionLedger.logMemberReport` (member-reports path) |
| `server/ledger/reconciliation.ts` | Reads `RefundClaim`/`Money` types from `types.ts`/`suppliers/types.ts`; does **not** call `store.ts` — its own state is a separate in-memory `Map` (see Real vs. simulated below) |
| `server/suppliers/*` | `governor.tryAcquire/withBudget/noteOutcome` before every outbound supplier call |
| `instrumentation.ts` | `db.ensureReady` (eager migration run), `store.hydratePipelineRunsFromDb` at boot |
| `server/domain/seed.ts` | Calls almost every `create*`/`set*` export in `store.ts` to build the demo dataset |

### Outbound — what this calls, and why

| Target | Why |
|---|---|
| Postgres (via `db.ts`'s `sql`, the `postgres` npm client) | The only outbound dependency of substance. One pool per process (`max: 10`), `idle_timeout: 20`s and `max_lifetime: 30`min to stop idle connections from exhausting Postgres's connection slots (observed twice in dev, per `db.ts`'s comment) |
| `lib/entitlement.ts` | `refund.ts` calls `owed()`/jurisdiction lookups to determine statutory entitlement |
| `server/airportDirectory.ts` | Jurisdiction and international/domestic classification for refund; timezone lookups for `deadline.ts` |
| `server/fx.ts` | `views.ts`'s `convertAltsToBillingCurrency` for cross-currency alt display |

## State it owns

| Table | Holds |
|---|---|
| `flights` | Flight, including cached forecast, forecast history, and searched alt/hotel/cab candidates (JSONB) |
| `passengers` | Card member profile, consent tier, preferences (JSONB) |
| `credentials` | Login (email → passwordHash), keyed separately from `passengers` so the passenger API response is never one bug away from leaking a hash |
| `travellers` | Every person on a ticket, card member or companion |
| `bookings` | One PNR — flight, seat(s), fare paid, fare basis, party (`travellerIds`) |
| `itineraries` | Ordered list of `bookingIds` making up one connected trip |
| `pre_auths` | Per-flight, per-passenger pre-authorised replacement plan (`altId`/`hotelId`/`cabId`/`owed`) |
| `journey_prefs` | Per-flight, per-passenger temporary window + consent override, discarded with the flight |
| `past_flights` | One JSONB array per passenger of historical flight outcomes |
| `disruption_events` | One active disruption per flight (`phase`, `detectedAt`, `decidedAt`) |
| `recovery_tasks` | Per-flight, per-passenger recovery state machine (phase, chosen alt/hotel/cab, resolution, terminal outcome) |
| `stays` / `rides` | Member-booked hotels and ground transfers, optionally tied to the flight that caused them |
| `pipeline_runs` | Durability mirror of the in-memory `pipelineRuns` Map — the pipeline state machine's own record |
| `decision_ledger` | Every prediction, outcome, threshold evaluation, notification, member intent, and member report (`kind`-discriminated) |
| `ranker_decision_log` | The ranker's shown-set and choice logs (`kind: 'shown' | 'choice'`) for offline training |
| `seed_state` | One-row marker so demo seeding runs exactly once across every process |
| `migrations` | Bookkeeping table of which `.sql` files have been applied |

Sequences: `booking_seq`, `itinerary_seq`, `task_seq`, `traveller_seq`, `stay_seq`, `ride_seq` —
atomic id generation across concurrent processes.

## Real vs. simulated vs. mocked

- **Genuinely durable today:** everything in 0001–0004's tables (flights, passengers, credentials,
  travellers, bookings, itineraries, pre-auths, journey prefs, past flights, disruption events,
  recovery tasks, stays, rides) — every read and write goes straight to Postgres, no in-memory
  layer in front.
- **Durable via mirror, confirmed round-tripped:** `pipeline_runs`. The hot path
  (`getPipelineRun`/`setPipelineRun`) stays a synchronous in-memory `Map`; `setPipelineRun` mirrors
  fire-and-forget to Postgres, and `hydratePipelineRunsFromDb` reads it back into the Map at
  startup. `store.integration.test.ts`'s `setPipelineRun mirrors to Postgres, and
  hydratePipelineRunsFromDb reads it back into a fresh Map` test exercises exactly this: it writes
  a run, waits 200ms for the fire-and-forget write to land, clears the in-memory Map to simulate a
  restart, calls `hydratePipelineRunsFromDb()`, and asserts the run comes back. This is confirmed
  working, not just asserted in a comment.
- **Durable, write path confirmed, read path (accuracy measurement) not exercised in production:**
  `decision_ledger` predictions (`logPrediction` has a real caller and an integration test proving
  the row lands) — but `logOutcome` has no caller anywhere, so the outcome half needed to compute
  accuracy never gets written.
- **Purely in-memory, not on Postgres at all:** `server/ledger/reconciliation.ts`'s refund-claim
  tracking (`const claims = new Map<string, RefundClaim>()`). Unlike everything in `store.ts`, this
  file has no database-backed persistence — `fileClaim`, `recordSettlement`, `recordDenial`, and
  the batch-sweep functions all operate on a process-lifetime Map that is lost on restart and
  invisible to a second process instance. The file's own docstring frames this as a deliberate
  architectural separation from the decision ledger ("what we decided" vs. "what we are owed"), but
  it means refund-claim state carries the same multi-instance/restart fragility that predictions,
  outcomes, and pipeline runs used to have before their respective migrations.
- **Process-lifetime, deliberately not durable:** `server/cache.ts` (TTL cache, resets on restart —
  fine for OAuth token caching and a soft API-call ceiling) and `server/governor.ts` (per-supplier
  rate/quota ledgers, `Map<ProviderId, Ledger>` at module scope). `governor.ts`'s own header states
  this plainly: "Two dev workers, or a serverless deployment, would each keep their own ledger and
  collectively overshoot. Not solved here; a shared counter (Redis) is the production shape." This
  is real and correct for a single-process demo but would need a shared backing store the moment a
  second instance runs concurrently — the same class of problem `store.ts`'s Postgres migration
  already solved for domain data.

## Failure modes & concurrency

**N+1 fixed:** `altsCache.ts`'s `mergePinned` used to resolve a flight's pre-auths by calling
`store.listPassengers()` — the entire passenger table — then issuing one `getPreAuth` call per
passenger. `store.ts`'s `getPreAuthsForFlight` replaced this with a single query filtered on
`flight_id`, and migration 0004 added the index that makes that an index lookup rather than a
sequential scan. This mattered because alts refresh can fire every 20 seconds during a live
disruption.

**Missing indexes fixed by 0004:** `pre_auths.flight_id` and `journey_prefs.flight_id` existed as
columns since 0001/0003 but were never indexed until 0004, specifically to support the new
`getPreAuthsForFlight` query path above.

**Postgres unreachable — no graceful degradation on the domain path.** Every `store.ts` function
calls `db()` → `ensureReady()` first, which lazily runs migrations and then hands back the `sql`
client; if Postgres is unreachable, the underlying `postgres` client call throws and that
propagates up as a rejected promise — there is no fallback or cached-read path in `store.ts`
itself. Two places soften this deliberately: `mirrorPipelineRunToDb` and `hydratePipelineRunsFromDb`
both wrap their Postgres calls in try/catch and only log on failure, so a DB outage degrades the
*durability mirror* silently rather than breaking the pipeline's synchronous in-memory hot path.
`decisionLedger.ts`'s `logAsync` wrapper does the same for every ledger write. The health check at
`app/api/health/route.ts` is explicitly shallow by design — it answers "is the Node process alive,"
not "is Postgres reachable" — so a Postgres outage would surface as failing feature requests, not
as the ALB pulling the instance from rotation.

**Connection exhaustion, previously observed:** `db.ts`'s comment documents a real incident
(2026-08-17/18) where `idle_timeout: 0` (the `postgres` client default) let idle connections
accumulate across dev-server restarts and parallel vitest workers until 97 of Postgres's 100 slots
were held by idle `zkdapp` backends, which then failed every new connection with a superuser-slot
error that looked like a wrong password. Fixed by setting `idle_timeout: 20` and `max_lifetime: 30min`.

## Tests

| File | Level |
|---|---|
| `server/domain/refund.test.ts` | Unit — party-size scaling of both the statutory refund and the voluntary cancellation fee |
| `server/domain/personas.test.ts` | Unit — the five canonical P1–P5 scenarios against `estimateRefund`/`owed`/`compensationFor` directly, not through the live pipeline (both live call sites of `estimateRefund` currently hardcode `delayHours: 24`, a separate, larger gap this test file does not fix) |
| `server/domain/views.test.ts` | Unit — currency conversion (`convertAltsToBillingCurrency`) and the fabricated-alt read guard (`dropFabricatedAlts`), including the exact row shape found in production |
| `server/domain/altsForParty.test.ts` | Unit — not read in full for this doc, but present alongside the above |
| `server/domain/store.integration.test.ts` | **Integration, DB-gated.** Round-trips flights/passengers/bookings/disruption events/recovery tasks/pre-auths through a real Postgres; also covers sequence uniqueness, `listWaitingRecoveryTasks`'s JSON-null-vs-SQL-null distinction, `updateConsent`'s atomicity under concurrent writers, `createItinerary`'s transactional linking, and the `pipeline_runs` mirror-then-rehydrate round trip |
| `server/decisionLedger.integration.test.ts` | **Integration, DB-gated.** Proves `logPrediction` lands a real row, `logNotification`/`logMemberReport` land independently-queryable rows, and a ledger write never throws back into its caller |
| `server/pipeline/ranker/decisionLog.integration.test.ts` | **Integration, DB-gated** (present in the tree; not read for this doc beyond confirming its existence) |

**On the hard-fail-vs-skip question:** all three `.integration.test.ts` files found in this tree
use `describe.skipIf(!hasDb)` keyed off `!!process.env.DATABASE_URL`, and `store.integration.test.ts`'s
own header comment states the intent explicitly — it "skips itself entirely rather than failing
when [a database] isn't configured, so `npx vitest run` stays green in an environment with no
database." This is a **graceful skip**, not a hard fail. If this project's history includes a period
where DB-gated tests hard-failed instead of skipping, that is not the behavior in the files read for
this document — all of them currently degrade to a skip.

## See also

- [04-ranking-engine.md](04-ranking-engine.md)
- [05-orchestration-and-execution.md](05-orchestration-and-execution.md)
- [02-prediction-and-risk-model.md](02-prediction-and-risk-model.md)
