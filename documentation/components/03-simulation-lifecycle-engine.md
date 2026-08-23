# Simulation & Lifecycle Engine

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

`server/engine/simulation.ts` is the module-level state machine that drives a disruption's lifecycle from the moment a cancellation signal arrives to the moment consent (explicit, autopilot, or by expiry) hands the recovery over to execution. It runs on real `setTimeout` chains rooted in process memory, not in a request handler — a consent window keeps counting down, and expires and books, whether or not any browser tab or phone is currently polling it. Every UI screen (`app/recovery/[id]/page.tsx`, `/ops`) is a downstream poller of `getRecoveryView()`; none of them drive the clock. The trade-off this buys is a real reconciliation gap: the state only advances while a Node process is alive, which is why the same file also owns a stranded-task sweep that repairs what a restart abandoned.

## Where it lives

| File | Purpose |
|---|---|
| `server/engine/simulation.ts` | The state machine itself: `detectDisruption`, per-passenger task creation, the consent window timer, re-check/cascade, resolution, member actions, and the restart-reconciliation sweep. |
| `server/engine/altsCache.ts` | Keeps `Flight.candidates.alts` (alternative flights) live from real supplier search on an adaptively computed TTL; pins any alt an open `RecoveryTask` still points at so a background refresh cannot null out a member's in-progress plan. |
| `server/engine/groundCache.ts` | Same TTL/in-flight pattern as `altsCache.ts`, for hotel and cab candidates; shares `altsCache`'s TTL config rather than a separate one. |
| `lib/confirmWindow.ts` | Pure function computing how long a member gets to answer — offer expiry / check-in cutoff / a fixed ceiling, floored below which asking is skipped entirely. |
| `lib/refreshCadence.ts` | Per-component-class (flight/hotel/ground) re-shop cadence, banded by risk stage; not called from `simulation.ts` directly but shares its "derive, don't hardcode" discipline and its output rides in the decision ledger next to the window. |
| `lib/refreshInterval.ts` | The formula `altsCache.ts` calls to size its own poll interval (urgency × severity × scarcity × window, Nyquist-capped against offer expiry, floored by the supplier rate limit). |
| `lib/thresholds.ts` | Client-safe `Band` type, `bandFor()`, and the `ACT_AT_RISK_SCORE` constant that gates alt pre-fetching; the actual adaptive computation lives server-side in `server/engine/thresholds.ts` (not read for this doc — out of scope). |
| `lib/thresholdConfig.ts` | Loads `config/risk-thresholds.json` (local file, or AWS AppConfig via `THRESHOLD_CONFIG_URL`), 30s reload interval, remote-cache-once-loaded-is-authoritative semantics. |
| `app/api/flights/[id]/preauth/route.ts` | Member sets a standing pre-authorised plan (alt/hotel/cab) for one flight, ahead of any disruption — read by `createTaskForBooking` at detection time. |
| `app/api/flights/[id]/warm/route.ts` | Force-refreshes alt/hotel/cab candidates unconditionally, bypassing the risk-gate that normally triggers `altsCache`/`groundCache` — used by `/ops` and member self-check. |
| `app/api/flights/[id]/reverify/route.ts` | Forces a fresh risk re-score (`server/engine/forecast.ts`'s `reverify`) — adjacent to this engine's inputs but not part of the lifecycle machine itself. |

## How it works

### The phase machine

The code does not use the design docs' seven-phase WATCH→CLAIM naming. Two separate state shapes exist here:

**`DisruptionEvent.phase`** (per flight, shared by every passenger on it): `'DECIDING' → 'READY'`. `detectDisruption()` creates the event at `'DECIDING'`; a fixed-delay timer (`decideDelayMs = Math.max(FLOOR, DECIDE_TOTAL * PLAY)`, from `lib/recovery.ts` — `DECIDE_TOTAL` ≈ 1.01s of narrated "steps", `PLAY = 190`, `FLOOR = 260` → effectively a ~260ms floor) fires `finishDecide()`, which flips the event to `'READY'` and fans a `RecoveryTask` out to every affected booking.

**`RecoveryTask.phase`** (per passenger): `'waiting' → 'choosing' → 'acting' → 'booked' | 'handed'`. Created as `'waiting'`, or `'acting'` immediately if pre-auth applies. `resolveTask()`'s `'browse'` action moves it to `'choosing'` (holds the clock — see below) and `'back'` returns it to `'waiting'`. `finalizeResolution()` moves it to `'acting'` (then execution/`pipeline.execute` eventually reaches `'booked'`) or straight to `'handed'` for a hand-over/halt. `RecoveryTask.resolution: DisruptionResolution | null` is the terminal marker checked everywhere (`if (task.resolution) return;`) to make finalization idempotent — first writer wins.

Transitions, in order:
1. `detectDisruption(flightId)` — event created at `DECIDING`, `pipeline.onDisruptionDetected(flightId)` fired (void, non-throwing) to start the real supplier search in parallel, decide-timer scheduled.
2. `finishDecide()` — event → `READY`; `createTaskForBooking()` runs per booking (filtered to `restrictedTo` for an uncorroborated member report).
3. `createTaskForBooking()` branches on pre-auth and consent tier:
   - **Pre-auth + plan intact** → `phase='acting'` immediately, consent recorded as `{kind:'approved', ...}`, calls `pipeline.execute()` directly. No window.
   - **Pre-auth but plan broken** → falls through to the normal ask/autopilot path with a note explaining why.
   - **`consent === 'autopilot'`** → revalidates the default choice, then `finalizeResolution()` immediately with `{kind:'autopilot', ...}`. No window — "standing consent already answered."
   - **`consent === 'ask'`** → computes `confirmWindow()`; if `!win.askable`, resolves immediately via `settleExpired()` (asking would be theatre); otherwise sets `windowExpiresAt`, dispatches rung 3, and schedules `settleExpired()` for `win.seconds` later.
4. Either the member calls `resolveTask()` (approve/hand-over/choose/swap/browse/back) or the window timer fires `settleExpired()`.
5. `finalizeResolution()` is the single funnel both paths converge on; it sets `phase` and, for anything except `'handed-over'`, calls `pipeline.execute(task, resolution)` — **this is the handoff to orchestration/execution** (`05-orchestration-and-execution.md`).

### The consent window

Computed in `lib/confirmWindow.ts`, called from `createTaskForBooking()` with the chosen alt's real `expiresAt`, the replacement flight's departure time, and whether the route is international. The formula:

```
fromOffer    = (offerExpiresAt - now)/1000 - EXECUTION_BUDGET_SECONDS(11) - NETWORK_MARGIN_SECONDS(20)   // Infinity if no offer expiry
fromCheckIn  = (departureAt - now)/1000 - checkinCutoffMinutes*60 - EXECUTION_BUDGET_SECONDS - NETWORK_MARGIN_SECONDS
              // checkinCutoffMinutes: 45 domestic, 60 international
ceiling      = WINDOW_CEILING_SECONDS (20 * 60)

rawSeconds, boundBy = the SMALLEST of {fromOffer, fromCheckIn, ceiling}

if rawSeconds < WINDOW_FLOOR_SECONDS (120):
    → { seconds: 0, askable: false, boundBy: 'floor' }
else:
    → { seconds: floor(rawSeconds), askable: true, boundBy, expiresAt: now + seconds*1000 }
```

`EXECUTION_BUDGET_SECONDS` (11) is `MACHINE_TOTAL`'s measured act-path budget from `lib/recovery.ts`; `NETWORK_MARGIN_SECONDS` (20) is slack for push delivery, a cold app start, and the round trip. `boundBy` is stored on the task (`RecoveryTask.windowBoundBy`) purely for explanation — `windowRationale()` turns it into the member-facing sentence ("You have 14 minutes — that is how long the airline is holding this price.").

Below the floor (`askable: false`), `createTaskForBooking()` does not ask at all: it sets `windowExpiresAt = 0`, writes a note ("too little time to ask... your standing permission decided this one"), and calls `settleExpired()` immediately — the same function a timed-out window calls, just with no `rung3` argument (so no delivery-check/grace-retry branch runs; see below).

### Re-check and cascade

`revalidateChoice(task, flight)` is called at every point where a plan is about to become irreversible: on autopilot's immediate act, on the window's natural expiry (`settleExpired`), and on the member's explicit `'approve'`. It re-validates the chosen alt against the live supplier (`revalidateOffer`) only when the alt carries a real `supplier`/`supplierOfferId` — a seeded/demo candidate with neither is left alone rather than blocked, since this demo's inventory has no real supplier behind every row. Only a confirmed `state === 'gone'` triggers a switch:

- The old alt is added to `task.rejectedAltIds` (permanently excluded — `mergePinned()` in `altsCache.ts` keeps a rejected id pinned so a background refresh can't silently un-reject it).
- The first other party-fitting (`altsForParty`, so the whole PNR can still travel together) alt is substituted, with a note: `"{code} went while you were deciding, so we booked {next.code} instead — it still keeps your trip together."`
- If no substitute fits the whole party, the function returns `null` and the original (now possibly stale) chosen alt proceeds unchanged — there's no further fallback beyond this point in this file.

The member's `choose`/swap actions in `resolveTask()` enforce the same party-fit rule server-side (`if (!picked?.fitsParty) { ...break }`), not just in the UI.

### Notification triggers

Three rungs, all through `server/notify/dispatch()` (not re-documented here — see `07-notifications.md`):

| Rung | Trigger point | Payload builder | Awaited? |
|---|---|---|---|
| 2 | `createTaskForBooking()`, right after `ensurePlanned()` resolves and before any plan/consent decision | `cancelledAlert({flightId, passengerId, code, from, to, optionCount, topOption})` | No — `void dispatch(...)`, fire-and-forget so a dead channel can't delay the member finding out |
| 3 | `createTaskForBooking()`, only on the `askable` ask-consent path, right before the window timer is set | `aboutToBookAlert({flightId, passengerId, code, altCode, altArrives, deltaDisplay, free, minutes})` — content built by `buildRung3Content()` (spend minus expected refund, via `estimateRefund`) | Dispatch call started but not awaited immediately; its `Promise<DispatchResult>` is threaded through to `settleExpired` as `rung3.dispatch` and awaited **there**, at expiry, to check `.delivered` |
| 3 (grace retry) | Inside `settleExpired()`, when rung 3's delivery could not be confirmed and the one grace extension hasn't been used yet | Same `aboutToBookAlert`, same content, `minutes` recomputed from `UNDELIVERED_GRACE_SECONDS` (5 min) | Same fire-then-await-at-expiry pattern |
| 3 (fresh, post-restart) | `reconcileOneStrandedTask()`, once per stranded task the sweep picks up | Same `buildRung3Content`/`aboutToBookAlert`, fresh dispatch | Awaited synchronously by the immediately-following `settleExpired()` call |

The delivery check is the load-bearing piece: `settleExpired()` will not let a recovery proceed on rung 3's silence-equals-consent unless `dispatch()`'s result reports `delivered: true`. Undelivered → one 5-minute grace extension (`undeliveredGraceUsed` flips to `true`, a fresh rung-3 is sent) → still undelivered → `finalizeResolution(task, {kind:'handed-over', ...})`, i.e. halt to a human rather than book blind.

### Restart safety

`reconcileStrandedTasks()` (exported, called by `instrumentation.ts` once at startup and then every `RECONCILE_INTERVAL_MS` = 5 minutes via `startReconciliationSweep()`'s self-rescheduling `setTimeout`) queries `store.listWaitingRecoveryTasks()` (a Postgres query on `recovery_tasks` filtered to `phase='waiting'` and JSON-null `resolution`), then for every task whose `windowExpiresAt` is already in the past (`task.windowExpiresAt > now` is skipped — "a live timer still owns this one"), calls `reconcileOneStrandedTask()`.

`reconcileOneStrandedTask()` re-fetches the task/flight/passenger/booking, sends a **fresh** rung-3 message, and routes through the exact same `settleExpired()` function a live timer would have used — deliberately, per the file's own comment, because after a restart there is no way to know whether the *original* rung-3 was ever confirmed delivered, and assuming so "would reintroduce the exact defect the 2026-08-21 delivery-check fix closed." A task that had already used its one grace retry before the restart goes straight to hand-over on a second undelivered attempt, matching what would have happened had the process never died. The sweep explicitly does **not** treat the mere fact of a stranded window as consent — it re-runs the full delivery-confirmed-before-proceeding gate from scratch.

Guarded so a single bad task's data problem (a vanished flight/booking) is logged and skipped without aborting the rest of the sweep, and against Next dev-mode HMR re-invoking `instrumentation.ts`'s `register()` (`globalThis.__zkdReconcileSweepStarted` guard) — the same `globalThis`-guard shape `statusPoller.ts`/`batchScorer.ts` already use.

## Interfaces

### Inbound — who calls this, and how

| Caller | Entry point |
|---|---|
| `POST /api/disruptions` (detection lanes: webhook push, `statusPoller.ts` fallback, `memberReports.ts`, `/ops` manual) | `detectDisruption(flightId, opts?)` — documented in `01-detection-and-triggers.md`, not re-covered here |
| A corroborated member report, once other evidence confirms an initially single-passenger report | `widenDetection(flightId)` — lifts `restrictedTo` and fans out `createTaskForBooking` to remaining bookings, skipping any passenger already handled |
| Member-facing recovery screen / `/ops` (approve, hand-over, browse, choose, swap-hotel, swap-cab, back) | `resolveTask(flightId, passengerId, action)` |
| Every poller of the recovery screen | `getRecoveryView(flightId, passengerId)` — read-only projection, computes `secondsLeft`/`windowSeconds`/cost/pipeline summary fresh on each call |
| `app/api/flights/[id]/preauth/route.ts` (POST) | writes `store.setPreAuth(...)`, read by `createTaskForBooking` at detection time via `store.getPreAuth` |
| `instrumentation.ts` at process startup, and its own recursive timer thereafter | `reconcileStrandedTasks()` / `startReconciliationSweep()` |

### Outbound — what this calls, and why

| Callee | Why |
|---|---|
| `server/pipeline` — `onDisruptionDetected`, `ensurePlanned`, `preferredPlan`, `execute` | `onDisruptionDetected` kicks the real supplier search/plan in parallel with the decide timer; `ensurePlanned` is awaited before a pre-auth/autopilot task can act, closing a race where `execute()`'s `HOLD_PENDING → CONFIRMED` transition would otherwise be illegal; `preferredPlan` (synchronous, `null` if not ready) supplies the pipeline's better-informed default pick without ever blocking; `execute` is the handoff to orchestration/execution — called from `finalizeResolution()` for every resolution except `'handed-over'`, and directly from the pre-auth-intact branch of `createTaskForBooking()`. See `05-orchestration-and-execution.md`. |
| `server/notify` — `dispatch`, plus `cancelledAlert`/`aboutToBookAlert` from `server/notify/templates.ts` | Rungs 2 and 3 of the notification ladder — see above. Not re-documented; see `07-notifications.md`. |
| `../suppliers` — `revalidateOffer` | The at-confirm re-check inside `revalidateChoice()`. |
| `../domain/altsForParty` | Party-fit filtering everywhere an alt is chosen or re-chosen, so a market alt that can't seat the whole PNR is never silently substituted. |
| `../domain/pricing` (`costFor`), `../domain/refund` (`estimateRefund`), `lib/time` (`money`) | Compute the exact spend delta shown in rung 3 and in `RecoveryView.owedNow`/`cost`. |
| `../preferences/journeyPrefs` (`resolveConsent`) | Merges a member's per-flight `journeyPrefs.consent` override with their standing profile consent to decide autopilot vs. ask for this one flight. |
| `../domain/store` (throughout) | The persistence boundary — see "State it owns" below. |
| `../domain/seed` (`ensureSeeded`) | Called at the top of `detectDisruption`, `reconcileStrandedTasks`, and `getRecoveryView` to guarantee demo data exists before any read. |
| Ranking (`server/pipeline/score.ts` via `pipeline.preferredPlan`) | This engine never calls the ranker directly — it reads the pipeline's already-ranked pick through `preferredPlan()`, falling back to its own "first bookable alt" heuristic only when the pipeline hasn't finished. See `04-ranking-engine.md`. |

## State it owns

- **`restrictedTo: Map<string, string>`** (flightId → passengerId) — in-process only, never persisted. Scopes an uncorroborated member report's fan-out to one passenger until `widenDetection()` clears it.
- **The per-task `setTimeout` handles** for the decide delay, the consent window, and the undelivered-grace retry — pure in-process timers, not tracked in any map (each is a bare `setTimeout(() => {...}, ms)` closure); this is exactly the state a process restart loses, and exactly what `reconcileStrandedTasks()` exists to repair from durable state instead.
- **`DisruptionEvent`** and **`RecoveryTask`** records — read/written entirely through `server/domain/store.ts`, which this file's header describes as Postgres-backed (`recovery_tasks` table, confirmed directly in `store.listWaitingRecoveryTasks()`'s SQL). So the *decision* state (phase, window deadline, chosen alt, resolution) is durable; only the *timer* that would act on it is not.
- **`PreAuthRecord`** — also store-backed (`store.getPreAuth`/`setPreAuth`), read once at task creation.
- The reconciliation sweep's own recursive timer is tracked on `globalThis` (`__zkdReconcileSweepStarted`, `__zkdReconcileSweepTimer`) specifically so it survives Next dev-mode hot-module-reload re-registration without double-starting.

## Real vs. simulated vs. mocked

The module name is historical, not descriptive of what runs today. Per its own header comment, it predates a "redesign" to real `setTimeout` chains that persist independent of any observer — "simulation" here means *lifecycle simulation engine* in the sense of a state-machine/discrete-event engine, not *fake data*. Concretely:

- The phase transitions, window arithmetic, delivery-gated proceed/halt logic, party-fit cascade, and Postgres-backed durability are real production logic — none of it is scripted for a demo.
- What genuinely is fixed/demo-shaped: `decideDelayMs` (`Math.max(FLOOR, DECIDE_TOTAL * PLAY)`, from narrated "steps" in `lib/recovery.ts` originally written for client-side animation timing) is a presentation pacing constant, not a measurement of real work — the module header for `lib/recovery.ts` is explicit that `ACT_STEPS`' durations are now a "declared budget, not a script" for the *act* path (paced against measured wall-clock time in the saga), but the *decide* steps this file uses to schedule `finishDecide()` remain pure pacing.
- `BILLING_CURRENCY = 'INR'` is a hardcoded constant standing in for an awaited MyCa profile read, justified in-code by "one mock profile serves every member today" — a deliberate, documented simplification, not a hidden one.
- `revalidateChoice()`'s explicit non-blocking fallback for candidates with no `supplier`/`supplierOfferId` ("this is a demo whose seeded inventory has no real supplier behind it") is a real, commented compromise: some candidates simply cannot be re-validated against a live source in this build, and are trusted rather than blocked.
- Everything else — the consent window formula, the delivery check, the reconciliation sweep, the Postgres-backed task store — is real logic exercised by real tests, not a stand-in.

## Failure modes & concurrency

- **Process restart mid-window**: handled by `reconcileStrandedTasks()` (see above). The explicit, documented risk it closes: before 2026-08-21, a restart while any member had an open consent window left that task permanently stuck at `phase:'waiting'`, `resolution:null` forever, since the `windowExpiresAt` written to Postgres had no timer left to act on it.
- **Double-transition race**: `finalizeResolution()` guards with `if (task.resolution) { await store.setRecoveryTask(task); return; }` — first writer wins, so a member's explicit `approve` racing the window's `settleExpired` (or the sweep's fresh `settleExpired`) cannot double-resolve a task. `settleExpired()` itself independently re-checks `task.resolution || task.phase !== 'waiting'` before doing anything, so a task already moved to `'choosing'` (member is actively browsing) is excluded from the short-circuit check that would otherwise let an in-flight window timer resolve out from under an engaged member — that `phase !== 'waiting'` guard is the actual mechanism.
- **A timer firing twice**: not explicitly deduplicated by handle-cancellation (no `clearTimeout` calls anywhere in this file), but rendered harmless by the same `task.resolution`/`phase` guard in `settleExpired()` and `finalizeResolution()` — a second firing is a no-op read that finds the task already resolved.
- **An offer expiring during the window**: this is not treated as a failure but as the expected case `revalidateChoice()` exists for — checked at every point something is about to become irreversible (autopilot-immediate, natural expiry, explicit approve), never assumed valid from the moment it was first shown.
- **A `settleExpired` racing a member's `resolveTask('choose', ...)`**: both mutate `task.chosenAltId`/`rejectedAltIds` without an optimistic-concurrency check on the store write (`store.setRecoveryTask` is a last-write-wins upsert per the code read here) — a genuine narrow window exists between "member picks a different alt" and "the expiring timer's `revalidateChoice` reads the old alt," though the `task.resolution`/`phase` guards prevent the more severe double-booking case.
- **Undelivered notification on the very last safety check**: explicitly does not fail open. Two failed delivery attempts (original + one grace retry) halt to `'handed-over'` rather than proceed with an unconfirmed spend — the exact fix `simulation.test.ts`'s primary describe block exists to pin down.

## Tests

`server/engine/simulation.test.ts` drives the **real public entry points** (`detectDisruption`, `reconcileStrandedTasks`) through the real internal timer chain using Vitest fake timers (`vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()`), mocking only the boundary modules — `../domain/seed`, `../notify`, `../notify/templates`, `../pipeline`, `../domain/store` (as in-memory `Map`s). This is the same pattern the file's own comment attributes to `forecastEventRescore.test.ts`, and it means `settleExpired`'s actual logic is under test, not a stand-in for it.

Two describe blocks:
1. **`settleExpired` — the notification-delivery safety check** (3 tests): proceeds to book on confirmed delivery; halts to hand-over on a fully-undelivered rung 3 (checking the one grace extension is granted, then consumed); recovers and books if the grace retry succeeds where the first attempt didn't.
2. **`reconcileStrandedTasks` — resuming a consent window a restart abandoned** (6 tests): fresh rung-3 + resolve on confirmed delivery; grace retry on undelivered fresh rung-3; straight-to-hand-over when the grace retry was already used pre-restart; skips a task whose window genuinely hasn't expired yet (a live timer still owns it); skips a task that isn't actually stranded (wrong phase); one stranded task with a missing booking doesn't throw and doesn't stop the sweep.

Real gaps: no test exercises `finishDecide`'s fan-out to multiple bookings, `widenDetection`, the `restrictedTo` single-passenger restriction, `revalidateChoice`'s cascade-to-next-alt path, the party-fit rejection in `resolveTask('choose', ...)`, pre-auth (intact or broken), or the `autopilot` consent branch directly (only the `ask`-consent, `askable` path is exercised end to end). The consent-window arithmetic in `lib/confirmWindow.ts` itself has no dedicated unit test file among those read for this doc.

## See also

- [01-detection-and-triggers.md](01-detection-and-triggers.md)
- [04-ranking-engine.md](04-ranking-engine.md)
- [05-orchestration-and-execution.md](05-orchestration-and-execution.md)
- [07-notifications.md](07-notifications.md)
