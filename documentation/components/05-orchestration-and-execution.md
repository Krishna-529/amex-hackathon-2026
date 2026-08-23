# Orchestration & Execution

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

This component is the irreversible half of the rebooking pipeline. Everything upstream of it — search, scoring, holding a top option — is designed to lapse free; nothing here is. Once `execute()` is called with a member's consent, it runs a forward booking saga (revalidate → authorise → flight → hotel → ground → dispose → onward → notify), commits each step to an append-only journal that doubles as the rollback stack, and if a trip-critical step fails it walks that stack backwards to compensate everything already committed. It also exposes a stateless duty-of-care lookup (`/api/care`) that is unconnected to the saga.

## Where it lives

| File | Purpose |
|---|---|
| `server/pipeline/types.ts` | The six-state `PipelineState` machine, its legal-transition table, and the `PipelineRun`/journal/orphan shapes |
| `server/pipeline/journal.ts` | The only writer of `run.state`; the transition guard, commit/orphan recording, and the mirror onto `RecoveryTask.shown` |
| `server/pipeline/journal.test.ts` | Regression test for the double-booking fix in `transition()` |
| `server/pipeline/saga.ts` | The booking saga itself: forward chain, compensation chain, two-tier (critical/degrade) failure policy |
| `server/pipeline/compose.ts` | Constructs multi-leg connection options the raw supplier search doesn't return, feeding the candidate portfolio `plan()` picks from |
| `server/pipeline/fallbackNote.ts` | The exact string a member reads when the saga rolls back — pure, no supplier dependencies |
| `server/pipeline/narrate.ts` | Per-step member-facing narration for each saga step, keyed on `SagaStepName` |
| `server/pipeline/index.ts` | Public surface: `plan()` (SEARCHING→EVALUATING→HOLD_PENDING), `execute()` (the WAIT→ACT crossing), `replan()`, `abort()` |
| `app/api/pipeline/[flightId]/route.ts` | Guarded read of one passenger's own run + the `replan` action |
| `app/api/pipeline/health/route.ts` | Ops visibility into supplier budgets, refresh cadence, detection lane — no passenger data |
| `app/api/bookings/route.ts` | Where a flight booking enters the system (session-bound, CSRF-checked) |
| `app/api/bookings/hotel/route.ts` | Where a hotel booking enters the system, same guard pattern |
| `app/api/care/route.ts` | Stateless GET: looks up the duty-of-care regime for a route and returns what's owed |

## How it works

### Allocation

A candidate isn't chosen inside `execute()` — it is chosen earlier, in `plan()`, and `execute()` only ever acts on what `plan()` already decided. `plan()` runs TRIGGERED → SEARCHING → EVALUATING → HOLD_PENDING and then **stops**: it force-refreshes the alt cache, re-reads the flight, optionally augments the direct-search results with constructed multi-leg connections from `compose.ts` (gated on the direct market being thin — `directCount < 3` — and on the member's `maxLayovers` rule), resolves risk signals once per recovery, runs `applyHardRules` + `rankAlts` (the ranking engine, documented separately), and if an overnight is indicated (`needsOvernight`, driven by the member's own `hotel_trigger_threshold_hours`), searches accommodation and ground via `arrangeOvernight`. The result — `{ altId, hotelId, cabId }` — is written to `run.plan` and the run parks at `HOLD_PENDING`. `execute()` later reads `task.chosenAltId`/`chosenHotelId`/`chosenCabId` off the `RecoveryTask` (which the consent flow may have let the member override) and resolves those ids back against `flight.candidates` — it does not re-rank or re-choose anything itself.

### The policy gate

Grepped `server/pipeline/index.ts` and `server/pipeline/saga.ts` directly: neither imports `@/server/policy` nor any relative `../policy` path. `server/policy/index.ts`'s `evaluate()` is not called anywhere in this component's execution path. The only "policy" this component actually enforces is `Alt.ok` — a boolean already decided upstream by the card's cabin-entitlement check in scoring — which `applyHardRules`/`runSaga` simply respect as a given fact rather than evaluate themselves. **This component does not call the policy gate.** It is a default-deny module with, per a sibling agent's grep, exactly one importer in the whole repo (its own test), and this pipeline is not that importer.

### The booking saga

Built by `buildSteps()` in `saga.ts`, in this fixed order:

1. **revalidate** — real in both mutation modes; the last check before anything is spent
2. **authorise** — issues a `van:<runId>` reference; no live payment integration exists on this branch, so there is nothing real behind it
3. **flight** — the scarce, most failure-prone resource; committed first so a failure here costs the fewest compensations
4. **hotel** *(only if an overnight was arranged)*
5. **ground** *(only if a cab kind was selected)*
6. **dispose** — voids the original PNR
7. **onward** *(only if the booking has a next leg)*
8. **notify** — always reports `ok:true` regardless of delivery outcome

Only `revalidate`, `authorise`, `flight` and `hotel` are in `CRITICAL`. A critical step's failure triggers `compensateAll`, which walks the `done` stack **in reverse, sequentially, and never stops early** — even if one compensation fails, the loop still processes every remaining entry, because an incomplete rollback leaves strictly more orphaned bookings than a slow, complete one. A non-critical step's failure (ground, dispose, onward) is recorded as an orphan and the saga **degrades**: it continues and still reaches `CONFIRMED`, on the reasoning that tearing up a confirmed flight and hotel because a rideshare declined would be a worse outcome than the ground failure itself.

`dispose` (voiding the original ticket) has no `compensate` function and sits outside the loop entirely — it runs last, after the trip-critical steps have already succeeded. The code's own comment states the reason plainly: a cancellation has no inverse. If disposal itself fails, that is not treated as a rollback trigger; the member already has a valid replacement and a stale original, and rolling back the good booking to "fix" that would be strictly worse for them.

### Idempotency

Two distinct idempotency guards exist, and both are scoped to the business entity, not the workflow instance:

- `journal.ensureRun(flightId, passengerId)` derives the run id as `pr-${flightId}:${passengerId}` — one run per (flight, passenger) pair, not one per invocation. `onDisruptionDetected` can be re-fired by a redelivered webhook or a repeated poller pass and will simply find the existing run past `TRIGGERED` and skip it.
- `POST /api/bookings` and `POST /api/bookings/hotel` derive their dedup key from the booking's real-world identity — `(flightId, passengerId)` for a flight, `(passengerId, city, checkin, hotel name)` for a stay — not from a request id or idempotency-key header. A second identical call returns the existing record (200) instead of creating a duplicate.

If either were scoped to the workflow/request instead of the entity, a double-click or a retried webhook would issue a second PNR or a second reservation on the same trip — exactly the failure the code comments describe as "observed live before this guard existed" for the booking route.

### The journal / state machine

Six states: `TRIGGERED → SEARCHING → EVALUATING → HOLD_PENDING → CONFIRMED`, with `FAILED_FALLBACK` reachable from any of the first four. `LEGAL_TRANSITIONS` is the sole source of truth for which edges exist; `CONFIRMED` and `FAILED_FALLBACK` have no outgoing edges at all — a saga rollback does not move the run backwards, it is recorded as a halt on the run and a `handed` phase on the task instead. `HOLD_PENDING → CONFIRMED` is named `IRREVERSIBLE_EDGE` in `types.ts`: canon requires nothing irreversible happens left of it.

**The double-booking race (fixed 2026-08-21):** `transition()` used to short-circuit any same-state call (`from === to`) as a harmless no-op returning `{ok: true}`. `execute()`'s only guard against running the saga twice is `if (!transition(run, 'CONFIRMED', ...).ok) return`. Because `execute()` is reachable from two independent async paths — a member's own "Approve" click and the consent window's own expiry timer, each working from its own separately-fetched task snapshot — both could call `transition(run, 'CONFIRMED', ...)` within the same tick. The second call found `run.state` already `CONFIRMED`, hit the `from === to` short-circuit, got `{ok: true}` back, and `execute()` read that as permission to run the **entire saga a second time**: a second hotel hold (a real third-party call even in intent mode) and a duplicate "you're rebooked" notification, both live today, and a real double-booked/double-charged seat once live ticketing lands.

The fix narrows the short-circuit: `if (from === to && to !== 'HOLD_PENDING' && to !== 'CONFIRMED') return {ok: true}`. A repeat `CONFIRMED→CONFIRMED` now falls through to `canTransition()`, which rejects it (`LEGAL_TRANSITIONS.CONFIRMED = []`), returning `{ok: false}` — so `execute()`'s existing `!ok` early-return path, previously unreachable for this case, now actually fires. `HOLD_PENDING` is excluded from the short-circuit for the same reason but keeps its own re-entry semantics (a re-plan is a real, meaningful transition each time, not a no-op). States NOT excluded — e.g. `FAILED_FALLBACK→FAILED_FALLBACK` — remain a legitimate no-op for a retried caller hitting an already-terminal state. `journal.test.ts` is the regression coverage for exactly this scenario.

### Duty-of-care claim

`GET /api/care` is not a claim in any stateful sense — it takes `from`, `to`, `delayHours`, `overnight`, `forceMajeure` as query parameters, looks up the applicable jurisdiction (`jurisdictionFor`) and its entitlement bundle (`lib/entitlement.ts`'s `BUNDLES`), and returns what's owed (`owed(...)`), a distance-banded EU261/UK261-style compensation figure where applicable (`compensationFor`), and the bundle's evidence tier and citation. It is a pure computation over static regime data — unguarded (no `requireSession`), reads nothing from the domain store, writes nothing, and is not called anywhere inside `saga.ts` or `pipeline/index.ts`. It answers "what would this member be owed" rather than filing or recording an actual claim against a carrier.

## Interfaces

### Inbound — who calls this, and how

| Caller | Entry point | Notes |
|---|---|---|
| `server/engine/simulation.ts` | `onDisruptionDetected`, `execute`, `abort`, `ensurePlanned` | Owns the consent decision and the WAIT gate; this module never decides whether to spend, only acts once told |
| `app/api/disruptions/route.ts` (`detectDisruption`) | `onDisruptionDetected` | Synchronous, never throws — an exception here would take the trigger endpoint down |
| `app/api/pipeline/[flightId]/route.ts` | `snapshot`, `replan` | Member-guarded (`requireSession`), returns only the caller's own run |
| `app/api/pipeline/health/route.ts` | (reads `store` and other engines directly, not this module's saga) | Ops-only counters, no passenger data |
| A member, via the booking UI | `POST /api/bookings`, `POST /api/bookings/hotel` | Session-bound and CSRF-checked; per project history these are now the only way a flight/hotel booking is created |
| `/ops`, by hand | `abort`, replan, etc. via existing routes | Manual operator path referenced in project docs |

### Outbound — what this calls, and why

| Target | Called from | Why |
|---|---|---|
| `revalidateOffer` (`server/suppliers`) | `saga.ts` (`revalidate` step) | Last-second price/availability check against the live offer before committing |
| `holdHotel`, `revalidateHotel` (`server/hotels`) | `saga.ts` (`hotel` step) | Real-in-both-modes revalidation, plus a genuinely reversible hold (Duffel Stays is the only provider whose `hold()` is implemented) |
| `dispatch` (`server/notify`) | `saga.ts` (`notify` step) | Delivers the "you're rebooked" push/email; failure is recorded but never rolls back the trip |
| `store.getFlight`, `getBooking`, `getRecoveryTask`, `setRecoveryTask`, `getPipelineRun`, `setPipelineRun`, `getNextLeg`, etc. (`server/domain/store`) | `journal.ts`, `index.ts` | Reads/writes the flight, booking, task and run records this component operates on |
| `searchInventory`, `getRate` (`server/suppliers`, `server/fx`) | `compose.ts` | Building multi-leg connection candidates during planning |
| `searchAccommodation`, `searchGround` | `index.ts` (`arrangeOvernight`) | Populating hotel/ground candidates when a stranding is long enough to need them |
| `server/policy` | — | **Not called.** See "The policy gate" above |

## State it owns

The `PipelineRun` journal — one per `(flightId, passengerId)` pair, keyed in `store.pipelineRuns: Map<string, PipelineRun>`. This Map is the primary, synchronous read/write path: `getPipelineRun`/`setPipelineRun` are synchronous because 24+ call sites throughout the state machine and saga depend on that, and converting them to async Postgres calls would cascade `await` through the exact hot path this session's double-booking fix already touched.

Durability was added on top (2026-08-21) via a fire-and-forget mirror: `setPipelineRun` also writes to the `pipeline_runs` Postgres table (`mirrorPipelineRunToDb`), swallowing and logging its own errors so a transient DB hiccup never surfaces as a booking failure. `hydratePipelineRunsFromDb` reads every row back into the in-memory Map once at process startup (`instrumentation.ts`), so a restart resumes in-flight runs instead of silently losing them; on hydration failure it degrades to starting with no memory of prior runs rather than blocking boot. The in-memory Map remains authoritative at runtime — Postgres is a mirror for restart recovery, not a second source of truth queried on the hot path.

## Real vs. simulated vs. mocked

Within the saga itself:

- **Real, in both intent and mutation modes:** `revalidateOffer` and `revalidateHotel` — the checks that protect the member's money are never skipped.
- **Real only under `PIPELINE_ALLOW_MUTATIONS=1`, and honestly absent otherwise:** live flight ticketing and live hotel booking are not implemented behind that flag — the `flight` and `hotel` steps return `ok:false` with an explicit "not implemented" error rather than a stub that pretends to succeed, when mutations are actually turned on. With mutations off (the default), both steps commit an `intent:`/`unverified:` reference against the real, revalidated offer.
- **Never real on this branch:** `authorise` (no live payment integration exists — `van:<runId>` is never a genuine authorisation).
- **Real, unconditionally:** `dispose` (voiding the original PNR) and `notify` (dispatch to the notification system) always run their actual logic; disposal has no live-vs-mocked branch to speak of since it operates on locally-generated PNRs.

The compensators are explicitly honest about this, and it's worth stating plainly because it was a real bug fixed 2026-08-21: they used to claim things like `"voided ${ref}"` or `"cancelled ${ref} inside the free-cancellation window"` unconditionally for any non-empty ref — a real API call this codebase never actually made. Every compensator now says exactly what happened: `authorise`'s compensator returns "no real authorisation was ever made ... nothing to void"; `flight`'s returns "no real seat was ever booked ... nothing to release"; `hotel`'s returns either "nothing to release" (for an `unverified:` ref, where nothing was ever held) or "no real hotel booking was ever made ... only a quote, which expires unclaimed at no cost" — because the only hotel provider implementing `hold()` (Duffel Stays) documents that a quote-hold lapses for free, and no provider in the registry implements a real cancel/release endpoint, since none of their holds are a persistent booking. Only `ground`'s compensator still claims an unconditional `"cancelled ${ref}"` — the code comments do not flag this one as revisited the way the other three were.

## Failure modes & concurrency

- **The double-booking race** — see "The journal / state machine" above. Fixed by narrowing `transition()`'s same-state short-circuit to exclude `HOLD_PENDING` and `CONFIRMED`, so a repeat `CONFIRMED→CONFIRMED` is now rejected rather than silently accepted. Covered by `journal.test.ts`.
- **A compensation failing outside a provider's window** — `compensateAll` retries exactly once per failed compensator, then gives up on that one component, records an `Orphan` (component, ref, error, `uncertain` flag) via `journal.recordOrphan`, and **keeps going** through the rest of the rollback stack rather than stopping. Every orphan is surfaced on the run snapshot and on `/ops`; `fallbackNote.ts` makes sure the member-facing text never claims a release that an orphan shows did not happen, and explicitly tells them not to book a replacement themselves when one exists.
- **A process restart mid-saga** — the in-memory `pipelineRuns` Map is lost on restart, but `hydratePipelineRunsFromDb` replays every row from the `pipeline_runs` table back into it at boot, using whatever `state`/`committed`/`journal` was last mirrored. Because the mirror happens on every `setPipelineRun` call (i.e. after every commit, orphan, and transition), a run resumes from wherever its last successfully-mirrored write left it — not necessarily mid-step, since the saga's `for` loop itself has no persisted checkpoint narrower than "which steps are in `run.committed`". A crash strictly between a step's `run()` succeeding and `journal.recordCommit` being called would lose that one step's commit record on restart even though the underlying side effect (e.g. a hotel hold) may have gone through — this is not something the code explicitly hedges against beyond the general orphan-recording philosophy.

## Tests

- `server/pipeline/journal.test.ts` is the only test file for this component's own modules, and it is narrowly scoped: four cases directly regression-covering the `transition()` double-booking fix (first `HOLD_PENDING→CONFIRMED` succeeds, a duplicate `CONFIRMED→CONFIRMED` is rejected, an unrelated same-state transition like `FAILED_FALLBACK→FAILED_FALLBACK` stays a harmless no-op, `HOLD_PENDING` self-loop semantics are unchanged).
- `server/pipeline/verify.ts` (`npm run verify:pipeline`) exercises `fallbackNote()`'s claims directly (alongside its primary subject, `score.ts`'s ranking claims), runnable under `node --experimental-strip-types` without pulling in the supplier/hotel registries. Per `AGENTS.md`/this repo's own house rule, **CI does not run `npm run verify`** — only `tsc`, `vitest run`, and `build`.
- **Real gap:** `saga.ts` itself — the forward chain, the compensation chain, the critical/degrade split, the compensator honesty fixes — has no test file at all. Nothing in `vitest run` (the suite CI actually executes) exercises `runSaga` or `compensateAll` directly; the only executable check anywhere near the saga's failure-path text is `verify.ts`'s coverage of the pure `fallbackNote()` function, and that file is not run in CI either.

## See also
- [03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md)
- [04-ranking-engine.md](04-ranking-engine.md)
- [06-policy-and-preferences.md](06-policy-and-preferences.md)
- [08-suppliers-and-integrations.md](08-suppliers-and-integrations.md)
- [09-domain-and-persistence.md](09-domain-and-persistence.md)
