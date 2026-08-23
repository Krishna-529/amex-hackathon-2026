# Notifications

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

Turns an internal event (a risk score crossing a band, a cancellation, an imminent spend, a completed booking) into a member-facing message and fans it out across WhatsApp, Android push, and SMS in parallel. It never raises an exception back to its caller — every channel outcome, including "not configured," is captured as a value — because `dispatch()` is called from inside the scoring hot path and a dead Twilio session must never cost a member their risk score. It also carries the four-rung notification ladder's copy (`templates.ts`) and the pure rule (`bandCrossing.ts`) that decides whether a given risk change is worth interrupting someone over.

## Where it lives

| File | Purpose |
|---|---|
| `server/notify/index.ts` | `dispatch()` — fans an event out to all three channels via `Promise.allSettled`, computes `delivered`, logs the attempt, exposes `channelStatus()` for `/ops` |
| `server/notify/templates.ts` | The four-rung ladder's actual copy: `thresholdAlert`, `cancelledAlert`, `aboutToBookAlert`, `stoodDownAlert` |
| `server/notify/whatsapp.ts` | WhatsApp channel via Twilio — sandbox free-text vs. Meta-approved Content Template |
| `server/notify/push.ts` | Android push via Expo's push service, plus the device-token registry (local JSON file) |
| `server/notify/fast2sms.ts` | SMS channel via Fast2SMS's DLT-exempt "Quick SMS" route |
| `server/notify/bandCrossing.ts` | `crossedUpward()` / `ALERT_AT` — the pure rule for whether a band change is alert-worthy |
| `server/notify/types.ts` | Shared `NotifyEvent`, `ChannelResult`, `AlertKind`, `NotifyChannel`, `linkFor()` |
| `app/api/devices/route.ts` | `POST`/`DELETE` — where the Android app registers/deregisters its Expo token, bound to the session's passenger |
| `server/decisionLedger.ts` (`logNotification`) | Persists every dispatch attempt — delivered, failed, or skipped — as a `NotificationLedgerEntry` |

## How it works

### The four-rung ladder

All copy lives in `templates.ts` rather than per-channel, specifically so WhatsApp and push can never drift into telling the member two different things about the same flight.

**Rung 1 — `thresholdAlert()` — "this flight is at risk."** Fires on a first upward crossing into an alert-worthy band (see `crossedUpward` below). States the risk as a band label plus percentage together — `` `${BAND_LABEL[i.band].toLowerCase()} (${i.pct}%)` `` — because a bare "4%" reads as reassuring and a bare "high risk" as alarmist; together they read correctly. The body branches on consent tier:
- `ask`: *"Tell us what you would prefer and we will line it up now, while there is still time to think. If we do not hear from you, we will use the details from your card."*
- `autopilot`: *"You have us on autopilot, so if it does cancel we will rebook you using the preferences on your card — no need to do anything. Tap below if you would rather choose yourself."*

It never says an option is "held" or "reserved" — nothing is reserved in this system (see `memory.md`, 2026-08-17) — and names a ranked alternative only when one already exists; otherwise it says *"We are searching alternatives now and will keep them fresh until this is settled."*

**Rung 2 — `cancelledAlert()` — "it cancelled, here's where we are."** Fired (fire-and-forget) from `createTaskForBooking` in `server/engine/simulation.ts` the moment a recovery task is created. Deliberately describes what has *already* been done, not what is about to happen: *"We saw it before you did and have already ranked your alternatives against your preferences. Right now the best is {code}, arriving {arr}."* — falling back to an option count, or "We are searching alternatives for you now" if nothing is ranked yet. Explicitly closes with *"Nothing is booked yet. We will tell you before anything is charged."*

**Rung 3 — `aboutToBookAlert()` — "we're about to spend ₹N, you have M minutes."** This is the rung documented as *the one that replaced the spend ceiling*. States the exact delta (never the gross fare — *"quoting ₹18,000 when ₹14,000 of it is coming straight back is technically true and practically a lie"*), the exact deadline, and says plainly what happens on silence: *"You have about {minutes} minutes to change or stop this. If we do not hear from you we will go ahead, because leaving you stranded is worse than spending without a reply."* When the delta is zero or negative: *"It costs you nothing."* The two buttons are `stop` ("Stop — let me choose") listed **before** `approve` ("Yes, go ahead") — deliberately, because a member skimming a lock-screen notification reads the leftmost button first, and the destructive-to-them outcome should be the fastest one to reach.

**Rung 4 — the "booked" confirmation.** Not built as a `templates.ts` function; it is composed inline where it's sent, in `server/pipeline/saga.ts`'s `notify` step: *"You're rebooked on {alt.code}... Your seats and any hotel or car we arranged are in the app."* `AlertKind` also names a `'handed-over'` kind and `push.ts` routes it to the calmer `updates` channel, but no call site currently constructs a `handed-over` `NotifyEvent` — a member handed to a human operator (the `settleExpired` halt path in `simulation.ts`) is not, today, actually notified of that fact through this component.

There is also a fifth, non-ladder message: **`stoodDownAlert()`**, sent by `standDown()` in `forecast.ts` when a flight that reached at least `hold-gate` genuinely falls back to `watch`. It fires at most once per alarm (state is `Flight.lastNotifiedBand`, cleared on stand-down) specifically so the member hears something other than bad news at least occasionally.

### Dispatch

`dispatch(event: NotifyEvent)` in `index.ts` calls all three channel `send()`s inside a single `Promise.allSettled`, addressed **in parallel**, not sequence — the code comment is explicit that a member waiting on a WhatsApp timeout before their push arrives is a worse outcome than any ordering guarantee. Each settled result is normalized into a `ChannelResult` (a rejection becomes `{ ok: false, error: <message> }` rather than propagating); `delivered` is `results.some(r => r.ok)`. The full attempt — every channel, including ones skipped as unconfigured — is written to the decision ledger via `logNotification()`, wrapped in its own `try/catch` so that ledger I/O can never be the thing that breaks a notification. `dispatch()` returns a `DispatchResult = { event, results, delivered }` and, by construction (`allSettled` plus the ledger try/catch), cannot reject.

### The delivery-check safety fix

`DispatchResult.delivered` is a plain boolean computed and returned by this component; **this component does not itself retry, grant grace, or halt anything** — it only reports the fact upward. All of that logic lives in `server/engine/simulation.ts`, not here:

- `createTaskForBooking` sends rung 3 without awaiting it (`rung3Dispatch = dispatch(aboutToBookAlert(...))`) and schedules `settleExpired` for when the consent window closes, passing along the still-pending dispatch promise.
- `settleExpired` is where delivery is actually checked: `const delivered = await rung3.dispatch.then(r => r.delivered).catch(() => false)`. The surrounding comment states the defect plainly: *"`dispatch()` computed `delivered` and logged it, and nothing downstream read it, so a member whose WhatsApp and push both failed was indistinguishable from one who saw the message and chose not to object"* (citing `ZKD-Gap-Audit-Session-Report.md` §3). With the ₹25,000 spend cap removed on 2026-08-19, this delivery check is described as "the only remaining control on an unattended spend."
- On non-delivery, a `RecoveryTask` gets **one grace extension** (`UNDELIVERED_GRACE_SECONDS = 5 * 60`, tracked via `task.undeliveredGraceUsed`): a fresh rung-3 `aboutToBookAlert` is dispatched and `settleExpired` is rescheduled.
- If the retry also goes undelivered, the task halts: `finalizeResolution(task, { kind: 'handed-over', at: Date.now() })` — the system refuses to book "on an amount the member was never confirmably told about," and hands the recovery to a human operator instead of treating an unreachable member as a silent consent.
- `reconcileStrandedTasks()` (process-restart recovery, added 2026-08-21) deliberately re-sends a **fresh** rung-3 message and routes through this same `settleExpired` check rather than assuming a pre-restart delivery still counts — otherwise a restart would reopen exactly the gap the fix closed.

This is exercised in `server/engine/simulation.test.ts`, whose header explicitly frames itself as "regression coverage for the safety defect ... this session fixed."

Separately, `saga.ts`'s "booked" (rung 4) notify step treats delivery failure as non-fatal by design: a failing step there would trigger `compensateAll` and unwind an already-completed booking, hotel, and transfer — so this step always returns `ok: true` and records the delivery outcome only in `ref` (`notified:whatsapp,push` or `notify-failed`) for the ledger, never as a pipeline failure.

### Channels

**WhatsApp (`whatsapp.ts`), via Twilio.** Two mutually exclusive paths, selected by whether `TWILIO_WHATSAPP_CONTENT_SID` is set:
- **Sandbox (demo) path — the one actually configured/working today**, driven by `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TO`. Sends free-form text (`Body`) inside the 24-hour window opened by the recipient texting Twilio's `join <phrase>` code — which must be re-sent per phone whenever that window lapses (documented as a recurring demo-day risk: "it must be re-sent on demo morning, from every phone shown on stage").
- **Production path** — same four env vars plus `TWILIO_WHATSAPP_CONTENT_SID` set to a Meta-approved UTILITY template. This is documented as the only path that can ever reach a real member, since a real member never texts a join code first; it is not shown to be actually exercised (no live WABA credentials referenced anywhere in the code or tests).
Both known Twilio failure codes are decoded into actionable hints: `63016` (sandbox session expired — re-send the join code) and `21654` (no session and no template).

**Push (`push.ts`), via Expo.** Delivers to the Android app's `zkd.recovery` notification category using tokens the app registers as `ExpoPushToken[...]`/`ExponentPushToken[...]` strings (validated by `isExpoToken()`). `risk-threshold`/`cancelled`/`about-to-book`/`stood-down` route to the `disruption` (max-importance) channel; `booked`/`handed-over` route to the calmer `updates` channel. A token Expo reports as `DeviceNotRegistered` is proactively forgotten so it is never retried. Documented as having a real demo risk: remote push to a standalone APK needs FCM credentials wired into the EAS project — inside Expo Go it works with zero setup, but on an unconfigured standalone build this channel fails and the file notes the app's own local-notification path remains the fallback.

**SMS (`fast2sms.ts`), via Fast2SMS.** Gated by `isConfigured()` requiring both `FAST2SMS_API_KEY` and `FAST2SMS_TO`. Uses Fast2SMS's `route: "q"` ("Quick SMS"), explicitly chosen because it needs no DLT/Sender-ID registration — the file documents this as right for a demo, and explicitly **not** a production duty-of-care channel ("the sender is anonymous-numeric and delivery is less reliable at peak hours"). Twilio was ruled out for Indian SMS entirely because TRAI/DLT (TCCCPR) requires a paid account, a registered Principal Entity, a registered Sender ID, and approved templates before any A2P SMS reaches a +91 number — a verified caller ID does not clear it. Numbers are normalized to bare 10-digit national form via `toLocalNumber()`. Known failures are decoded: `status_code 412` (invalid key) and `402`/a "balance" substring match (insufficient credit).

## Interfaces

### Inbound — who calls this, and how

| Caller | What it triggers |
|---|---|
| `server/engine/forecast.ts` (`applyScore` → `alertMember`/`standDown`) | Rung 1 (`thresholdAlert`) on a first upward band crossing per `crossedUpward`; the stand-down message on a genuine fall back to `watch` |
| `server/engine/simulation.ts` (`createTaskForBooking`, `settleExpired`, `reconcileStrandedTasks`) | Rung 2 (`cancelledAlert`) on task creation; rung 3 (`aboutToBookAlert`) at consent-window open, on grace retry, and on restart reconciliation |
| `server/pipeline/saga.ts` (its `notify` step) | Rung 4, the "booked" confirmation, after a real booking completes |
| `app/api/devices/route.ts` | `registerDevice`/`forgetDevice` — device-token lifecycle, not a `dispatch()` call |
| `/ops` (via `channelStatus()`) | Reads which channels are configured, for setup-time visibility |

### Outbound — what this calls, and why

| Target | Why |
|---|---|
| Twilio Messages API (`api.twilio.com`) | Send the WhatsApp message (sandbox free text or template) |
| Expo push API (`exp.host/--/api/v2/push/send`) | Deliver Android push notifications to registered Expo tokens |
| Fast2SMS bulk API (`www.fast2sms.com/dev/bulkV2`) | Send the SMS fallback |
| `server/decisionLedger.ts` (`logNotification`) | Record every dispatch attempt, delivered or not |

## State it owns

The Expo device-token registry: a flat JSON file at `server/.state/devices.json`, keyed by passenger id (or `__any__` for tokens registered before login, e.g. a demo phone). Read/write is fully synchronous (`readFileSync`/`writeFileSync` in `push.ts`), not Postgres-backed. No comment in `push.ts` itself states the rationale, but it follows directly from `index.ts`'s stated invariant that **notifying must never break predicting**: `dispatch()` is called from inside `forecast.ts`'s `applyScore`, the single path a real model score becomes a forecast, so the notify path — including its own local state — must resolve with zero external dependencies (no DB connection, no network round trip) to guarantee it can never become a hard dependency of scoring.

## Real vs. simulated vs. mocked

| Channel | State |
|---|---|
| WhatsApp | Sandbox path is the one demonstrably live-tested (join-code flow, decoded Twilio error codes for it); the production Meta-template path is implemented and switched on by `TWILIO_WHATSAPP_CONTENT_SID` but nothing in the code or tests shows it exercised against real Meta-approved credentials |
| Push | Live via Expo's push service; works out of the box in Expo Go, documented as needing FCM credentials in the EAS project for a standalone APK — a known, named demo risk rather than something silently assumed to work |
| SMS | Live via Fast2SMS's no-DLT "Quick SMS" route; explicitly documented as demo/internal-only, not a production channel |
| All three | Degrade cleanly and silently (as `skipped`, not `ok: false` with an error) when unconfigured — proven by `wiring.test.ts` running with zero credentials set |

## Failure modes & concurrency

- **Unconfigured channel**: each `send()` returns `{ ok: false, skipped: true }` without attempting a network call — confirmed for SMS by `fast2sms.test.ts` ("does not fail... and never calls the network") and for all three channels together by `wiring.test.ts`.
- **A channel throws/rejects**: `Promise.allSettled` in `dispatch()` catches it and turns it into a normal `{ ok: false, error }` result rather than letting it propagate — proven by `dispatch.test.ts`'s "does not throw when a channel REJECTS" and "resolves rather than throwing when EVERY channel fails" cases.
- **Ledger write fails**: caught locally in `dispatch()`'s own `try/catch`; `dispatch.test.ts` ("survives a ledger that throws") confirms the dispatch result still resolves normally.
- **Notify invoked from the scoring/prediction hot path**: `dispatch()` is called (un-awaited in most call sites, e.g. `alertMember`, `standDown`, `createTaskForBooking`'s rung 2) from inside `forecast.ts`'s `applyScore`. By construction (`allSettled` + internal try/catch), `dispatch()` cannot reject, so a notify failure never propagates up to break a score. `wiring.test.ts`'s "resolves cleanly with nothing configured — the CI and fresh-checkout case" is the closest thing to a direct proof of the "notifying must never break predicting" invariant, run with zero channel credentials (the actual CI condition); the invariant itself is stated as a design rule in `index.ts`'s header comment rather than tested against a live `applyScore` call inside this component's own test suite. The consuming test that most directly exercises the invariant across the boundary is `server/engine/simulation.test.ts`, which mocks `dispatch` to control `delivered` and proves `settleExpired`'s grace/halt behavior around it.

## Tests

- `server/notify/fast2sms.test.ts` — unit-level: number normalization, `isConfigured()` gating, skip-vs-fail distinction, provider-error mapping.
- `server/notify/bandCrossing.test.ts` — unit-level, no I/O: every case of `crossedUpward()`, including the "fires once per escalation, never on a dip-and-recover" behavior.
- `server/notify/dispatch.test.ts` — `dispatch()` fan-out logic with all three channels mocked: partial success, rejection-not-failure, all-fail, ledger logging content, ledger-throws survival.
- `server/notify/wiring.test.ts` — no mocks; loads the real channel modules with zero credentials to catch import-time throws or an `isConfigured()` reading an unexpected env var, plus `thresholdAlert` copy assertions (ask vs. autopilot phrasing, no "held/reserved" language, band+percentage together).
- `server/engine/simulation.test.ts` — exercises the delivery-check safety fix end to end (grace retry, hand-over on repeated non-delivery, restart reconciliation) with `dispatch` mocked to return controlled `delivered` values; explicitly framed as the regression test for the fix.
- Gap: no test in this component (or found elsewhere) drives a real network call against Twilio, Expo, or Fast2SMS — all provider interaction is either mocked or exercised only via the unconfigured/skip path. The production WhatsApp Content Template path in particular has no test coverage of its own beyond the `contentSid`-set branch being reachable in code.

## See also
- [03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md)
- [02-prediction-and-risk-model.md](02-prediction-and-risk-model.md)
- [11-frontend-and-clients.md](11-frontend-and-clients.md)
