# How disruption detection actually works — OAG, SABRE/GDS, and the production design

**ZKD Concierge · Codestreet 2026 / American Express**

This file exists to answer one question precisely: **how does the system know a flight has been
cancelled, in the real-world/production design** — not the demo shortcut, the rehearsal button, or
a guess at how it "probably" works. Everything below is either `verified` (read directly from the
current source in `amex/zkd-app/server/`) or a direct quote from
[`02-data-sources-and-apis.md`](02-data-sources-and-apis.md) §1/§4, which is the evidence-tier
discipline this repo already uses (see `AGENTS.md`). It complements that file and the code map in
`amex/CLAUDE.md`; it supersedes nothing.

---

## 1. The production model: push primary, poll as reconciliation

The design position, stated directly in `02-data-sources-and-apis.md` §1, is the frame everything
else in this file sits inside:

> Target architecture is **push (webhook) primary, poll as reconciliation**:
> - **Push** from Cirium or FlightAware for flights in the active window.
> - **Poll sweep** every 5 minutes over the same window as a backstop.
>
> The sweep is not redundancy theatre. A change-feed cannot recover a *dropped* message — and a
> missed cancellation is indistinguishable from a healthy trip, so it fails silently. The periodic
> reconcile is what makes the feed's misses recoverable.

This is not a workaround for a prototype limitation — it is the intended architecture. A carrier's
status system pushes a change the instant it happens; the system also polls independently so that
a dropped push is caught within one reconciliation cycle rather than never.

**Detection** ("a flight *has been* cancelled") and **prediction** ("a flight *will* be cancelled,"
`05-cancellation-risk-model.md`) are two different capabilities. This file is entirely about the
former.

---

## 2. Where OAG fits, for real

OAG Flight Instances v2 is **capability-proven**, not a placeholder waiting on engineering work.
Quoted directly from §1:

> **Does OAG provide the data? Yes.** OAG's Flight Instances v2 response carries a live status
> field whose values include `"Cancelled"`, alongside a `scheduleChanged` flag — both already
> modelled in `zkd-app/server/oag.ts`, and the endpoint is verified working against our trial key.
> The status is present on status-bearing queries and null on a pure schedules query, which is an
> honest distinction the client already preserves.

In production, OAG is meant to sit exactly where AeroDataBox and other push sources sit today —
feeding the webhook/push lane directly, subscribed per flight in the active window, so a
`Cancelled` status or a `scheduleChanged` flag reaches the system in seconds.

What limits it today is **commercial, not technical**:

> **So capability is not the constraint. Budget is.** `OAG_FLIGHT_INFO_TRIAL` is capped at **100
> calls in total across a 14-day window** — not per day, not per month. Detection means watching a
> book of flights continuously; 100 calls does not cover one day of that for a single route, let
> alone a portfolio.

A paid OAG tier is one of four options the design leaves open (§1, "The decision this leaves
open"), alongside AviationStack (already wired, ~1-minute poll), Cirium/FlightAware push
(industry-reference, enterprise pricing), and Airline NDC direct (authoritative the instant a
carrier files a cancellation, per-carrier commercial agreement). Whichever is chosen, the poll
sweep stays — the design position above holds regardless of which push provider wins.

---

## 3. Where SABRE and other GDS fit, for real — and where they don't

**No GDS is a source of the cancellation signal, in the production design or in the code.** Sabre
Dev Studio and Travelport belong to a different part of the system entirely: §4, "Booking and
inventory — where the money moves":

> | **Sabre Dev Studio** | Shop, price, book; broad Indian carrier coverage | Authenticates against
> cert; every route tried returns no results. Degrades to empty, never blocks the others |
> `wired (unpopulated)` |

Sabre and Travelport are candidate **suppliers of replacement inventory**, consumed once a
cancellation is already known — they feed `searchInventory()` in `zkd-app/server/suppliers/`, which
fans out across every supplier with `Promise.allSettled`, normalises offers to a common shape
carrying currency and expiry, and de-duplicates the same physical flight arriving from two sources.
That function is called *after* `detectDisruption` has already fired, to find the member a new seat
— it never triggers detection itself.

Detection and re-booking are two separate supplier relationships. Keeping that boundary explicit
matters: a GDS integration, however good its coverage, answers "what can I book," not "did this
flight just cancel."

---

## 4. The three detection lanes racing each other — the actual production architecture

This is the real mechanism, not a fallback stack bolted on around a manual button. Quoted from the
header of `zkd-app/server/webhooks/index.ts`, the file's own account of why it exists:

> **It does not replace the other two lanes**, and that is deliberate. Three imperfect detectors
> covering each other's gaps is the honest architecture: the webhook is fastest but can silently
> stop; the poller is bounded but self-driven; the member standing at the gate is the only one that
> works when both feeds are wrong. What changes here is the ordering, not the roster.

All three lanes converge on one function: `detectDisruption(flightId, opts)` in
`zkd-app/server/engine/simulation.ts`. Its own header states the design directly:

> `detectDisruption` is the single entry point for "we caught a disruption signal for this
> flight." ... a future live AviationStack-status poller would call this exact same function. Only
> the caller differs.

```ts
export async function detectDisruption(
  flightId: string,
  opts: { onlyForPassengerId?: string } = {},
): Promise<DisruptionEvent | null> {
  await ensureSeeded();
  const existing = await store.getDisruptionEvent(flightId);
  if (existing) return existing;           // idempotent — safe to call from every lane

  const flight = await store.getFlight(flightId);
  if (!flight) return null;

  const event: DisruptionEvent = { id: `de-${flightId}`, flightId, detectedAt: Date.now(), phase: 'DECIDING' };
  await store.createDisruptionEvent(event);

  pipeline.onDisruptionDetected(flightId);   // fire-and-forget search, never awaited/throws
  setTimeout(() => { void finishDecide(flightId); }, decideDelayMs);
  return event;
}
```

### Lane 1 — Webhooks (push), `zkd-app/server/webhooks/`

`act()` normalises a delivered event and decides what to do with it:

```ts
const classification = classify({ status: event.status, bookedDepartureAt: ..., scheduledDepartureAt: event.scheduledDepartureAt, delayMinutes: event.delayMinutes, connectionSlackMinutes: flight.connectionSlackMinutes });
if (classification.kind === 'none') return ...;
triggerEventRescore(flight.id);
if (classification.kind !== 'cancellation') return `acted: rescored`;
await detectDisruption(flight.id);
```

Provider adapters registered in `ADAPTERS` (`webhooks/index.ts`): `aerodatabox` (per-flight push,
filters on status/departure/delay changes — the adapter that fires live in the current build),
`oag` (the intended production feed, see §2), `duffel` (order-level events, only relevant for
flights actually booked through Duffel). A delivered event is deduped by delivery id before
`act()` runs.

Because a dead subscription looks exactly like a quiet week, every provider carries a heartbeat:
`laneStatus()` only reports the webhook lane as `primary` once a provider has actually delivered
recently (6-hour staleness window) — silence is treated as a fault to surface, not as good news.

### Lane 2 — Poller (bounded reconciliation), `zkd-app/server/engine/statusPoller.ts`

Runs on a 5-minute tick, capped at **15 AviationStack calls/month** (down from 45 once webhooks
became primary — the freed headroom went to the member-report corroboration ladder below, since a
member's report is a moment where one call genuinely decides something). It skips any flight
already covered by a healthy webhook subscription and otherwise polls the flights closest to
departure:

```ts
const classification = classify({ status: match.flightStatus, ... });
if (classification.kind === 'none') continue;
triggerEventRescore(flight.id);
if (classification.kind === 'cancellation') {
  await detectDisruption(flight.id).catch(...);
}
```

### Lane 3 — Member reports (the fallback of last resort), `zkd-app/server/engine/memberReports.ts`

The file's own header explains why this lane must exist even with two automated feeds running:

> A member standing at a gate knows before any feed does. ... Somebody in the terminal, looking at
> the board, is the highest-quality signal available.

A report is treated as a **claim, not an event** — acting on a false one spends real money on every
other passenger's card, so it is corroborated cheapest-first (an operator's own mark, three
independent member reports, the flight already flagged cancelled in stored data, the forecast
already at the highest risk band, or — as a last resort — one spent AviationStack lookup) before it
fans out beyond the reporter.

### The order

`app/api/pipeline/health/route.ts` computes, live, which lane would actually catch a cancellation
right now:

```ts
primaryLane: webhooks.primary ? 'webhook' : poller.running && poller.budgetRemaining ? 'poller' : 'manual',
```

`webhook` → `poller` (only while webhooks are unhealthy and budget remains) → `manual`. The `/ops`
console's manual trigger is that fourth, non-automated case — a rehearsal and override tool for a
flight none of the three real lanes cover, not a peer detection lane.

---

## 5. How a cancellation reaches every affected passenger

The mental model — *"when a member books a flight, check whether we're already monitoring it; if
not, start monitoring it; if another passenger later books the same flight, they join the same
watch rather than starting a new one"* — is exactly what the system does, but it is implemented
**relationally**, not as an object with a `passengers[]` array that gets appended to. There is no
`MonitoredFlight` type or `addPassenger()` function in the codebase; searching for one will find
nothing. The two tables that stand in for it:

**Registering the flight — an upsert keyed by flight id**, `store.createFlight()`:

```ts
export async function createFlight(f: Flight): Promise<void> {
  await q`
    insert into flights (id, dep_iso, data)
    values (${f.id}, ${f.depISO}, ${q.json(f)})
    on conflict (id) do update set dep_iso = excluded.dep_iso, data = excluded.data
  `;
}
```

`on conflict (id) do update` makes this safe to call for the same flight any number of times — the
"is this flight already being watched" check is simply an upsert rather than a branch.

**A passenger joining an already-registered flight — a new row, not an append**,
`store.createBooking()` inserts into `bookings`, carrying `flight_id` as a foreign key. Two
passengers on the same flight are just two booking rows with the same `flight_id`, exactly as seeded
in `zkd-app/server/domain/seed.ts`:

```
flightId: 'f-multi', passengerId: 'p-arjun', ...
flightId: 'f-multi', passengerId: 'p-rohan', ...
```

**Reading who to notify** — `store.getBookingsForFlight(flightId)` is a plain
`select ... where flight_id = ...`. This is what `finishDecide()` (called after `detectDisruption`)
iterates over to fan a confirmed cancellation out to every passenger on that flight:

```ts
const bookings = await store.getBookingsForFlight(flightId);
for (const booking of bookings) {
  void createTaskForBooking(event, flight, booking);
}
```

A real in-memory watch-registry, `Map<flightId, subscription>`, does exist — but it tracks
**webhook subscription state**, not passengers: `zkd-app/server/webhooks/subscriptions.ts`. When a
new flight appears with no active subscription, `syncSubscriptions()` registers a push subscription
for it and records `{ url, at }` against that flight id. This is the literal "if not already
monitored, start monitoring it" step — it just answers "is a webhook subscribed to this flight,"
not "who is on it."

---

## 6. End-to-end trace

1. A member books a flight → `store.createBooking()` inserts a row with that `flightId`.
2. If this flight has no active webhook subscription yet, `syncSubscriptions()` registers one
   (production: OAG/Cirium/FlightAware; current build: AeroDataBox).
3. A second member books the same flight → another `createBooking()` row, same `flightId`. No new
   subscription is needed — the flight is already being watched.
4. The carrier cancels the flight. The push feed delivers the change (or, if it's missed, the
   5-minute poll sweep or a member's own report catches it).
5. `act()`/poller-`tick()`/`report()` all funnel into `classify()` → `detectDisruption(flightId)`.
6. `detectDisruption` is idempotent — the first lane to report wins, later reports are no-ops —
   and schedules `finishDecide`.
7. `finishDecide` calls `getBookingsForFlight(flightId)` and fans out `createTaskForBooking` to
   every passenger found, each one firing the notification ladder (`server/notify/index.ts`) that
   tells them the flight is cancelled and recovery has started.

---

## 7. Current build status — a snapshot, not the design (as of 2026-08-23)

This section is deliberately separated from everything above it: it describes today's prototype
constraints, not the architecture.

- **Live today**: AeroDataBox push adapter (webhook lane), AviationStack poll (poller lane, 15
  calls/month), member-report corroboration ladder.
- **Stubbed pending a subscription**: `zkd-app/server/oag.ts`'s webhook adapter — `verify()`
  currently always fails with "OAG Flight Info Alerts is not subscribed." OAG is imported in the
  app today only for search, not as a status watcher (§2 above explains why: budget, not
  capability).
- **Inert for this app's flows**: the Duffel webhook adapter (order-level events; this app books no
  Duffel orders today) and Sabre/Travelport on the booking side (both authenticate but return zero
  live results in every route tried — degrades to empty, never blocks the others).
- **Defined but not currently exercised**: `detectDisruption`'s `onlyForPassengerId` restriction
  parameter, meant to let a single uncorroborated member report act for the reporter alone before
  corroboration widens it to everyone on the flight. No live caller currently passes it — every
  call site invokes `detectDisruption(flightId)` unrestricted.
- **Manual override**: the `/ops` console's trigger, for rehearsal and for a flight none of the
  three automated lanes cover. It calls `detectDisruption` through the same function everything
  else does — it just isn't one of the three lanes racing in production.
