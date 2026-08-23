# Detection & Triggers

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

This component notices that a booked flight has been cancelled (or, more broadly, disrupted) and hands off to recovery. It is not one mechanism but three independent detection lanes — push webhooks, a budget-capped poller, and member self-report — plus a manual operator trigger, all converging on the same entry point, `detectDisruption()` in `server/engine/simulation.ts`. Each lane also feeds `triggerEventRescore()` (`server/engine/forecast.ts`) on any disruption-*shaped* signal, even one that doesn't rise to a cancellation, so the risk forecast stays current independently of whether a recovery starts.

## Where it lives

| File (relative to `zkd-app/`) | Purpose |
|---|---|
| `server/webhooks/index.ts` | Webhook front door: adapter registry, delivery dedupe, per-provider heartbeat/health, `handleDelivery()` (verify → dedupe → normalise → act) |
| `server/webhooks/duffel.ts` | Duffel adapter — `order.airline_initiated_change_detected`; only fires for orders booked *through* Duffel |
| `server/webhooks/aerodatabox.ts` | AeroDataBox adapter — per-flight-number push; the lane that covers this product's actual case (tickets booked elsewhere) |
| `server/webhooks/oag.ts` | OAG adapter — stub only; verifies nothing, normalises nothing, deliberately unconfigured |
| `server/webhooks/subscriptions.ts` | Registers/re-registers AeroDataBox subscriptions against `WEBHOOK_PUBLIC_URL`; picks which flights are worth watching |
| `server/webhooks/types.ts` | Shared `Adapter`, `NormalisedFlightEvent`, `DeliveryResult` shapes |
| `server/webhooks/verify.ts` | HMAC (Duffel) and shared-secret (AeroDataBox) verification, with replay-window checks |
| `server/webhooks/lane.test.ts` | Vitest coverage of lane health and delivery handling |
| `server/engine/statusPoller.ts` | Fallback AviationStack poller — budget-capped, stands down only while webhooks are demonstrably alive |
| `server/engine/memberReports.ts` | Member self-report + corroboration ladder |
| `server/aviationstack.ts` | AviationStack client, day-cached, shared by the poller, member reports, and `/api/flight-status` |
| `app/api/disruptions/route.ts` | Operator console feed (`GET`) and manual trigger (`POST`), both behind `requireOperator` |
| `app/api/disruptions/[flightId]/route.ts` | Recovery view for a signed-in passenger (downstream of detection, included here for completeness) |
| `app/api/disruptions/[flightId]/consent/route.ts` | Consent/resolve actions on a recovery task (downstream, not a detection entry point) |
| `app/api/webhooks/flight-status/[provider]/route.ts` | The one inbound HTTP route all webhook providers POST to |
| `app/api/flights/[id]/report-cancellation/route.ts` | Member-facing report endpoint, wraps `server/engine/memberReports.ts` |
| `app/api/flight-status/route.ts` | Ad hoc live-status lookup + classification; triggers a rescore but **not** `detectDisruption` |

## How it works

All lanes ultimately call `classify()` (`lib/disruptionKind.ts`) against the flight's *booked* departure — never the carrier's current schedule, since a moved flight reports zero delay against its own new time — and all cancellation-kind classifications call `detectDisruption(flightId)` in `server/engine/simulation.ts`.

**Lane 1 — push webhooks** (`server/webhooks/`)
- Single inbound route: `POST /api/webhooks/flight-status/[provider]`. It reads the raw body (`req.text()`, not `req.json()`, since HMAC verification signs exact bytes), looks up the adapter (`adapterFor`), calls `adapter.verify()`, and on success calls `handleDelivery(provider, rawBody, headers)`.
- `handleDelivery()` (`server/webhooks/index.ts`) is verify → dedupe → normalise → act, and is documented as never throwing — the route holds an open connection to a provider that retries on non-2xx.
  - Dedupe: `remember(key)` against an in-memory `Map` capped at `SEEN_LIMIT = 5000`, keyed by `${provider}:${deliveryId}`, oldest evicted first. A `deliveryId` comes from the adapter (`idempotency_key` for Duffel; a composed `listener:flight:changed:revised` string for AeroDataBox, since AeroDataBox supplies none of its own) or falls back to a hash of the raw body.
  - Normalise: each adapter's `normalise(payload)` flattens the provider's shape into `NormalisedFlightEvent[]`. AeroDataBox filters on `changed` fields (`status`, `departure.scheduled|revised`, `delay`) via `ACTIONABLE_FIELDS`, treating a missing `changed` array as "pass it through, let `classify()` decide" rather than dropping it. Duffel only reacts to `order.airline_initiated_change_detected` (an explicit allow-list, not a prefix match).
  - Act: `act(event)` (`server/webhooks/index.ts`) resolves the event to one of our tracked flights via `resolveFlight()` — matching normalised flight code plus, when the provider gave a departure date, that date; if ambiguous (more than one same-day match, or more than one upcoming match with no date given) it refuses rather than guesses. It then calls `classify()`, `triggerEventRescore(flight.id)` on anything disruption-shaped, and `detectDisruption(flight.id)` only on `classification.kind === 'cancellation'`.
- Heartbeat/health: every delivery (matched or not, duplicate or not — a duplicate still proves the feed is alive) updates `lastDeliveryAt`/`deliveries` per provider. `laneStatus()` reports a provider `stale` once `now - lastDeliveryAt > HEARTBEAT_STALE_MS` (6 hours), and the lane as a whole `primary` only if `WEBHOOK_PUBLIC_URL` is set **and** at least one configured provider is not stale. A provider that has never delivered anything is never counted as healthy — "registered but silent" must not read the same as "healthy and quiet".
- Subscriptions: `server/webhooks/subscriptions.ts` registers AeroDataBox per-flight-number webhooks (`POST /subscriptions/webhook/FlightByNumber/{number}`) against `receiverUrl('aerodatabox')`, gated on `WEBHOOK_PUBLIC_URL`, `AERODATABOX_API_KEY`, and `WEBHOOK_SHARED_SECRET` all being set (refusing to register without the last one, since that would create a subscription the receiver then rejects every delivery from). `flightsToSubscribe()` narrows to flights departing within the next 3 days whose forecast tier (`tierFor`, `server/engine/rescoreTiming.ts`) is not `'dormant'`. `startSubscriptionSync()` runs once at startup and every 30 minutes (`SYNC_INTERVAL_MS`), idempotent against Next dev-mode HMR re-invoking `instrumentation.ts`. Duffel is not registered here at all — it's configured once per-account in the Duffel dashboard, not per flight.
- OAG (`server/webhooks/oag.ts`) is a pure stub: `verify()` always fails with an explanatory reason, `deliveryId()` returns `null`, `normalise()` returns `[]`. `isConfigured('oag')` in `index.ts` hard-codes `false`, so it can never count toward `primary` health.

**Lane 2 — status poller** (`server/engine/statusPoller.ts`)
- `startStatusPoller()` schedules `tick()` every `POLL_INTERVAL_MS` (5 min) via `setTimeout`/reschedule, gated on `AVIATIONSTACK_API_KEY` being set; idempotent against HMR the same way the subscription sync is.
- `flightsToPoll()` selects flights that: haven't departed more than an hour ago; are `tierFor(...) === 'critical'`; and — only when `laneStatus(now).primary` is true — are **not** already covered by a live AeroDataBox subscription (`isSubscribed`). If webhooks are configured but stale, the poller resumes covering those flights; standing down requires the webhook lane to be demonstrably alive, not merely configured.
- `tick()` enforces a hard monthly ceiling (`MONTHLY_CALL_CEILING = 15`, lowered from 45 once webhooks became primary) checked before every call, and caps each tick to `LOOKUPS_PER_TICK = 2` (AviationStack rate-limits to 1 req/60s). It skips flights that already have an open `DisruptionEvent`. For flights it does look up, it calls `lookupFlightStatus()` → `classify()` → `triggerEventRescore()` → `detectDisruption()` on a `'cancellation'` classification only.
- The day-level cache in `server/aviationstack.ts` (`getOrSet('aviationstack:{code}:{date}', 24h, ...)`) means the effective spend unit is a distinct flight-day, not a poll tick.

**Lane 3 — member self-report** (`server/engine/memberReports.ts`, `app/api/flights/[id]/report-cancellation/route.ts`)
- `POST /api/flights/[id]/report-cancellation`: `requireSession` → rate limit (`consumeToken`, capacity 10 / refill 2 per minute, keyed per passenger) → verifies the caller actually holds a booking on that flight (the "cheapest possible spam filter") → calls `report(flightId, passengerId, 'member')`.
- `report()` records the claim (`Map<flightId, Map<passengerId, MemberReport>>`, one entry per passenger — repeat presses overwrite, not append) and calls `corroborate()`, a fixed ladder, cheapest/free signal first:
  1. Any report with `source === 'ops'` → confirmed immediately (operator-asserted, authoritative).
  2. `count >= INDEPENDENT_REPORTS_NEEDED` (3) independent passengers → confirmed.
  3. `flight.cancelledInData` (set via `/ops` "Mark cancelled (data only)", or a real feed) → confirmed.
  4. The flight's own forecast band is already `>= 'hold-gate'` (`BAND_RANK`) → noted as `alreadyWorried`, not yet decisive alone.
  5. `lookupFlightStatus()` against AviationStack (spends from the same ~100/month allowance as the poller) → confirmed if the carrier feed itself says cancelled; an explicit `'none'` classification from the carrier is treated as evidence *against* the report, overriding a lone unconfirmed member claim.
  6. If nothing conclusive but the forecast was already worried (step 4), confirmed anyway — the report corroborates rather than carries the decision alone.
- The asymmetry the whole lane exists for: the route only calls `detectDisruption(id)` (and `widenDetection(id)`, `server/engine/simulation.ts`, to fan the recovery out to every other booked passenger) when `verdict.confirmed` is true **and** this passenger hadn't already reported (`repeat` check, to avoid re-running the paid corroboration ladder on a repeated tap). An unconfirmed report never calls `detectDisruption` for anyone, including the reporter — the response instead points them at a helpline.
- Every report, confirmed or not, is written to the decision ledger via `logMemberReport()` (`server/decisionLedger.ts`), wrapped in a try/catch so a ledger failure never breaks the member's screen.

**Manual lane — `/ops` console** (`app/api/disruptions/route.ts`)
- `POST /api/disruptions` calls `detectDisruption(body.flightId)` directly — the identical entry point every automated lane uses. `GET` serves the operator console's disruption feed (`toDisruptionOpsView` per event). Both verbs require `requireOperator` (`server/auth/guard.ts`, which delegates to `opsSessionFrom` in `server/auth/opsSession.ts`) — this was fixed 2026-08-21; before that, `GET` returned real passenger names and owed-dollar amounts to any anonymous request, and `POST` let anyone on the internet trigger a real recovery (with no confirmation window for autopilot/pre-authed passengers, and no per-transaction cap since that was removed 2026-08-19) on any flight id. `POST` also requires same-origin (`isSameOriginRequest`) and is rate-limited (`checkRateLimit`, 20 burst / 20 per minute) even behind operator auth, specifically so a stuck demo script or a compromised operator credential can't hammer it. The route's comment states its only caller anywhere in the app is `app/ops/page.tsx`, verified by grep.

**Not a trigger lane — `/api/flight-status`**
`app/api/flight-status/route.ts` runs the same `lookupFlightStatus()` → `classify()` sequence as the other lanes and calls `triggerEventRescore()` on a disruption-shaped result, but it never calls `detectDisruption()`. Per `statusPoller.ts`'s own header comment, this route "had no callers at all" before the poller was built to call the underlying pieces itself; today its only referenced use is a manual curl example in `README.md` and a mention in `forecastEventRescore.test.ts`. It is a live status/classification utility, not a fourth detection lane.

```
Duffel ──▶ POST /api/webhooks/flight-status/duffel ──┐
AeroDataBox ──▶ POST /api/webhooks/flight-status/aerodatabox ──┤
                                                                 ├──▶ handleDelivery() ──▶ act() ──▶ classify() ──▶ detectDisruption()
OAG (stub, inert) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
                                                                       ▲ (stands down only while laneStatus().primary)
statusPoller.tick() [5 min, budget-capped] ─────────────────────────────┘
                                                                       ▲ (fires only when corroborate() confirms)
memberReports.report() [per-passenger claim + ladder] ─────────────────┘

/ops console ──▶ POST /api/disruptions (requireOperator) ──▶ detectDisruption() directly
```

## Interfaces

### Inbound — who calls this, and how

| Caller | Entry point | When |
|---|---|---|
| Duffel | `POST /api/webhooks/flight-status/duffel` | Airline-initiated order change, for orders booked through Duffel (none exist in this app today — booking origination isn't built) |
| AeroDataBox | `POST /api/webhooks/flight-status/aerodatabox` | Any subscribed flight-number change touching status, scheduled/revised departure, or delay |
| OAG | `POST /api/webhooks/flight-status/oag` | Never in practice — adapter rejects every delivery (`verify()` always returns `ok: false`) |
| Any provider | `GET /api/webhooks/flight-status/[provider]` | Endpoint-verification pings some providers send before registering a subscription |
| `server/engine/statusPoller.ts` (internal timer) | `tick()` → `lookupFlightStatus()` → `classify()` → `detectDisruption()` | Every 5 minutes, only for `'critical'`-tier flights not already covered by a healthy webhook |
| Signed-in passenger with a booking on the flight | `POST /api/flights/[id]/report-cancellation` | Member reports their own flight cancelled |
| Operator (`requireOperator`) | `POST /api/disruptions` (`{ flightId }`) | Manual/rehearsal trigger from `/ops`, or in principle any future live feed |
| Operator (`requireOperator`) | `GET /api/disruptions` | Reads the disruption-event feed for the ops console |
| Any caller (no session required) | `GET /api/flight-status?flightId=...` | Ad hoc status/classification lookup; rescore only, not a recovery trigger |

### Outbound — what this calls, and why

| Target | Purpose | Failure behavior |
|---|---|---|
| `server/engine/simulation.ts` → `detectDisruption(flightId)` | Starts (or idempotently returns) the recovery for a confirmed cancellation | Documented as idempotent — a duplicate call returns the existing event rather than starting a second recovery |
| `server/engine/simulation.ts` → `widenDetection(flightId)` | Fans a confirmed member-reported cancellation out to every other booked passenger | Called only after `detectDisruption` on confirmation; not called on an unconfirmed report |
| `server/engine/forecast.ts` → `triggerEventRescore(flightId)` | Debounced out-of-cycle rescore on any disruption-shaped signal, cancellation or not | Debounced per flight (`eventRescoreDebounceMs`) so a flapping feed can't cause a rescore storm |
| `server/aviationstack.ts` → `lookupFlightStatus(code)` | Carrier status lookup, shared by the poller, member-report ladder, and `/api/flight-status` | Returns `null` on missing key, non-OK response, or any thrown error (wrapped in try/catch); callers treat `null` as "no evidence," not as an error to propagate |
| AeroDataBox subscription API (`subscriptions.ts` → `registerAerodatabox`) | Registers/refreshes per-flight-number push subscriptions | Never throws out of `syncSubscriptions()`; a failed registration for one flight is logged (`console.warn`) and skipped, not retried inline |
| `server/decisionLedger.ts` → `logMemberReport(...)` | Audit trail for every member report, confirmed or not | Wrapped in try/catch in `memberReports.report()` — "a ledger write must never break the member's screen" |

## State it owns

- **Webhook delivery dedupe** — `Map<string, number>` (`seen`), capped at 5000 entries, oldest evicted first. Keyed `${provider}:${deliveryId}`.
- **Webhook provider health** — `Record<WebhookProvider, { lastDeliveryAt, deliveries, matched }>`, updated on every delivery attempt (even unmatched or duplicate ones).
- **AeroDataBox subscription registry** — `Map<flightId, { url, at }>`, tracking which flights are subscribed against which registered public URL (so a changed `WEBHOOK_PUBLIC_URL`, e.g. a new tunnel, is detected and triggers re-registration).
- **Status poller monthly spend** — `{ month, calls }`, reset whenever the current month key changes.
- **Member reports** — `Map<flightId, Map<passengerId, MemberReport>>`, one live claim per passenger per flight.
- All five of the above are process-lifetime in-memory state (`globalThis`-backed in the webhook and subscription modules specifically to survive Next's per-route module instantiation — see the long comment in `server/webhooks/index.ts` explaining that this was found the hard way, when the receiver and `/api/pipeline/health` held two separate instances of what was assumed to be shared module state). None of it is persisted; a process restart forgets all of it. The documented consequence in each case is bounded: a forgotten delivery-dedupe entry just means a re-processed but idempotent `detectDisruption`; a forgotten member report means corroboration has to restart, never that something under-scrutinized gets acted on.

## Real vs. simulated vs. mocked

- **AeroDataBox webhook lane** — live and tested at the mechanism level (verification, dedupe, normalisation, health/staleness) via `lane.test.ts`'s Duffel-flavoured cases plus the adapter's own logic; actual end-to-end delivery depends on `WEBHOOK_PUBLIC_URL` being set to a real reachable HTTPS origin, `AERODATABOX_API_KEY`, and `WEBHOOK_SHARED_SECRET` all being present — otherwise `syncSubscriptions()` reports what's missing and registers nothing, and the receiver route itself is still fully exercisable locally via curl.
- **Duffel webhook lane** — live wiring (real signature scheme, real event type), but structurally inert today: it only fires for orders booked through Duffel, and this app originates no bookings through Duffel. Every seeded PNR stands in for a booking made elsewhere. The comment in `server/webhooks/duffel.ts` is explicit that this is "the architecturally correct lane the moment the system books anything itself," not a working path today.
- **OAG webhook lane** — a stub, not a mock: it does not pretend to work. `verify()` always fails, `normalise()` always returns nothing. Per its own header, OAG Flight Info Alerts is a separate paid product from the Flight Info API this codebase already calls, and the configured OAG key is a trial key, not an active alerts subscription.
- **Status poller** — live against AviationStack's real free-tier API when `AVIATIONSTACK_API_KEY` is set; otherwise `startStatusPoller()` logs a warning and does nothing, and the code says so explicitly ("Disruptions must come from the ops console or from a member report").
- **Member self-report** — fully live: real rate limiting, real booking-ownership check, real corroboration ladder against real forecast state and a real (budget-shared) AviationStack call.
- **Manual `/ops` trigger** — live code path (calls the same `detectDisruption` everything else does) but explicitly a rehearsal/demo control, not a production detection source — it stands in for "a live status feed" per the code's own comment.
- **`/api/flight-status`** — a live utility endpoint (real AviationStack call, real classification) but not wired to `detectDisruption` at all; it only triggers a rescore. It is not one of the three detection lanes despite living in the same file set.

## Failure modes & concurrency

- **Duplicate delivery (same provider retry)** — caught by `remember()`'s dedupe map in `server/webhooks/index.ts`; returns `{ duplicate: true, ok: true }` without re-running `act()`. Explicitly still counted toward the heartbeat (`lastDeliveryAt`/`deliveries` update *before* the dedupe check), since a retry still proves the feed is alive — asserted directly in `lane.test.ts` ("counts a duplicate as a heartbeat").
- **Same cancellation reaching two lanes** (e.g. AeroDataBox delivers it, and the poller's next tick also sees it, or a member reports the same flight the webhook just caught) — relies entirely on `detectDisruption()` being idempotent (documented in the header comment of `server/webhooks/index.ts`: "it returns the existing event rather than starting a second recovery"). This doc did not read `simulation.ts`, so that idempotency guarantee is taken on the stated word of the webhook module's own comment, not independently verified here — flagged as a claim to check against `03-simulation-lifecycle-engine.md`.
- **Dead/silent webhook feed** — the failure mode the whole design explicitly worries about most: a lapsed subscription looks identical to a quiet week. Guarded by the heartbeat: `laneStatus().primary` goes false once `now - lastDeliveryAt > HEARTBEAT_STALE_MS` (6h), which both `/ops` can display and `statusPoller.flightsToPoll()` reads to resume covering flights it would otherwise skip. A provider that has *never* delivered is never counted healthy in the first place (`lane.test.ts`: "is not primary before anything has ever been delivered").
- **AviationStack budget exhaustion** — `tick()` checks `s.calls >= MONTHLY_CALL_CEILING` both before selecting flights and before each individual lookup, and simply stops for the rest of the month; `pollerStatus().budgetRemaining` surfaces this on `/ops`. The same underlying allowance is shared with `/api/flight-status` and the member-report corroboration ladder (step 5) — a poller that consumed all 100 calls would silently disable both, which is exactly why the poller's own ceiling (15) is set well below the real limit, and why it stands down once webhooks are healthy rather than continuing to spend.
- **Malformed or unverifiable webhook body** — `handleDelivery` never throws; a `JSON.parse` failure returns `{ ok: false, detail: 'body was not JSON' }`, an unknown provider returns `{ ok: false, detail: 'unknown provider' }`, and a failed `adapter.verify()` in the route returns HTTP 401 with a generic `{ error: 'unauthorised' }` — the specific reason is logged server-side only, never returned to the caller, per the route's own comment about not helping an attacker distinguish "no secret configured" from "bad signature."
- **Ambiguous flight resolution** (webhook lane) — `resolveFlight()` refuses to guess: more than one same-day match, or more than one upcoming match with no departure date given, returns `null` and the event is reported as unmatched (a 200, not an error — unmatched is expected traffic, not a failure).
- **Member-report spam / repeated taps** — bounded by a per-passenger token bucket (`consumeToken`, capacity 10 / refill 2/min) at the route level, and by `memberReports.report()` keying claims by passenger (a fifth tap from the same person is one report, not five), plus the route's own `repeat` check that skips re-triggering `detectDisruption`/`widenDetection` on a passenger who already reported.
- **False member report** — the asymmetry is the guard: acting for the reporter alone costs one recovery; acting for the whole flight requires either 3 independent passengers, an operator assertion, `cancelledInData`, a positive carrier-feed confirmation, or (weakest) an already-elevated forecast band with no contradicting evidence. An explicit carrier "not cancelled" response overrides a lone member claim.
- **Cross-module state split** — a real, previously-hit bug, not a hypothetical: the long comment in `server/webhooks/index.ts` (lines ~78–99) documents that Next instantiates `server/webhooks/index.ts` separately per route bundle, so plain module-level state was invisibly split between the receiver route and `/api/pipeline/health` — three real deliveries were recorded on one instance while the health endpoint read another and reported zero. Fixed by hanging state off `globalThis` (`gw.__zkdWebhookState`), the same pattern `statusPoller.ts` and `subscriptions.ts` use for their own timers/counters.

## Tests

- `server/webhooks/lane.test.ts` covers: `laneStatus()` correctness before any delivery, after `WEBHOOK_PUBLIC_URL` is unset, after a real delivery (becomes primary), after going stale past `HEARTBEAT_STALE_MS`, and that the OAG stub never counts toward configured/health; plus `handleDelivery()` behavior for duplicate detection, duplicates still counting as a heartbeat, an unmatched flight returning success, an unknown provider, a non-JSON body, and an unrecognised-but-valid event type being recorded as handled rather than failed. This is the one file this doc was asked to treat as a full read; it exercises Duffel's HMAC path specifically (constructs real `x-duffel-signature` headers via `hmacHex`), not AeroDataBox's shared-secret path.
- `server/engine/forecastEventRescore.test.ts` (not fully read for this doc; found only by grep) references `/api/flight-status` in relation to `triggerEventRescore` debouncing.
- **Real gaps**: no test file was found (via grep across the read set) exercising the AeroDataBox adapter's own `normalise()`/`isActionable()` field-filtering logic, `subscriptions.ts`'s registration/re-registration logic, `statusPoller.ts`'s `flightsToPoll()`/budget-ceiling behavior, or `memberReports.ts`'s corroboration ladder end to end. `lane.test.ts`'s coverage is concentrated on the Duffel path and the shared health/dedupe machinery in `index.ts`; the AeroDataBox-specific normalisation rules and the two non-webhook lanes appear to be exercised only by inspection/manual testing, not by an automated test in the files reviewed here.

## See also
- [02-prediction-and-risk-model.md](02-prediction-and-risk-model.md)
- [03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md)
- [10-auth-and-security.md](10-auth-and-security.md)
