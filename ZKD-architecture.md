# ZKD Concierge — Architecture

An autonomous **travel-disruption concierge** for aviation. It predicts a flight's
disruption risk, and when a real disruption (cancellation/reschedule) is detected, it
re-accommodates every passenger on the booking — new flight + hotel + ground transfer —
inside a consent window, claims duty-of-care money back from the carrier, and stops safely
when policy says it can't act.

---

## 1. Repo layout — what's actually the pipeline

The repo contains **several codebases**. Only one is the live pipeline; the rest are
history, docs, or the pitch.

| Path | Role | Status |
|---|---|---|
| **`zkd-app/`** | Next.js 16 app — the real, current product (frontend + backend in one process) | **active** |
| **`zkd-android/`** | React Native app — a thin poller of `zkd-app`'s API | active client |
| `amex-travel-disruption-concierge/` | Earlier prototype: Temporal workflows + OPA/Rego + separate Vite dashboard | superseded reference |
| `Code/` | Vite micro-site (design/metrics/personas) — the pitch visuals | marketing |
| `documentation/`, `iropssim.py`, `assets/` | Agent specs, an IRROPS Python simulator, the deck/APK/videos | supporting |

Everything below is about `zkd-app` + `zkd-android`, because that is the pipeline.

---

## 2. The core architectural idea

**The server is the only thing that decides anything. Every client is a pure viewer.**

The engine (`zkd-app/server/engine/simulation.ts`) mutates state on real `setTimeout`
chains that advance *whether or not any client is watching*. A web tab and the Android
phone both just `fetch` the same endpoints on a poll and render whatever they get back.
No client computes risk, picks an alternative flight, or holds a countdown another client
can't see.

An earlier version built a whole "World" in the browser and each device ran its own copy;
that was torn out. `WorldProvider.tsx` is now "a thin poller"; `zkd-android/src/api.ts`
describes the phone as "a plain poller of the same server-authoritative engine every web
tab polls."

---

## 3. The three layers inside `zkd-app`

```
 CLIENTS                    BACKEND (one Node process, port 5176)              EXTERNAL
 ┌──────────────┐           ┌─────────────────────────────────────┐           ┌──────────┐
 │ Web (Next)   │  fetch    │  app/api/*/route.ts   (HTTP edge)    │  fetch    │  Lumo    │ forecast
 │ WorldProvider│ ────────► │        │  thin wrappers             │ ────────► │  MyCa    │ profile
 │  (poll 4s)   │  JSON     │        ▼                            │  (or mock)│  Duffel  │ inventory
 ├──────────────┤           │  server/engine/  ← THE DECIDER       │           │  Sabre   │
 │ Android (RN) │  fetch    │  server/domain/store  (in-mem Maps)  │           │ Travelpt │
 │ src/api.ts   │ ────────► │  server/policy   (default-deny gate) │           │ LiteAPI  │ hotels
 │  (poll)      │  JSON     │  server/ledger   (what we're owed)   │           │ Gemini   │ explain
 └──────────────┘           │  server/suppliers, server/*.ts       │           └──────────┘
                            └─────────────────────────────────────┘
```

**1. `app/api/*/route.ts` — the HTTP edge.** Thin wrappers: read query params, call one or
two `server/*` functions, return JSON. Example — the entire disruption-view endpoint:

```ts
// app/api/disruptions/[flightId]/route.ts
const view = getRecoveryView(flightId, passengerId);   // all logic is in the engine
return NextResponse.json(view);
```

They *must* live under `app/api/` — that is the only place Next's router recognizes a
handler.

**2. `server/` — server-only logic and every external call.** Nothing here is ever
imported by a `'use client'` file, and nothing outside `server/` + `app/api/` reads a
supplier API key. This is "the backend."

**3. `app/*/page.tsx`, `components/`, `lib/` — the frontend.** `WorldProvider` is the
*only* place that knows *who* is looking (the passenger, from `?as=` in the URL) and polls
their schedule. Recovery state is polled per-page from `/api/disruptions/[flightId]`, not
centralized, because it's scoped to one flight.

---

## 4. The domain store — where state lives

`server/domain/store.ts` is a set of module-level `Map`s (`flights`, `passengers`,
`bookings`, `itineraries`, `disruptionEvents`, `recoveryTasks`, `preAuths`…).
Process-lifetime only, resets on restart. `server/domain/seed.ts` fills it once at import:
5 passengers, 5 flights, including the flagship demo trip **Priya: MAA→DEL→LHR** (a
connection) and a **3-passengers-on-one-flight** case (`f-multi`).

This in-memory design is why the deck notes **"serverless breaks the engine"**: the
`setTimeout` chains and Maps only survive as one continuous Node process
(`npm run dev` / `start`). Serverless isolates would lose both. Documented as an accepted
prototype tradeoff; a real deployment would back this with Postgres/Redis.

---

## 5. Data flow #1 — standing prediction (before anything goes wrong)

Every upcoming flight carries a live disruption forecast so the UI can show a risk gauge
and offer **pre-authorisation** *before* a disruption.

1. A client polls `/api/passengers/:id/schedule` → `views.toFlightSummary()`.
2. `refreshIfStale(flight)` fires (non-blocking, 10-min TTL) → `engine/forecast.ts`.
3. Forecast does **two calls in parallel**:
   - `lumo.forecast()` → the **bought** cancellation probability + confidence + connection risk.
   - `suppliers.searchInventory()` → how many seats actually exist across all sources (the *scarcity* input).
4. `thresholdsFor(...)` computes the **bar** the probability is judged against — and that
   bar *moves* with seat scarcity, time-to-departure, hard constraints, and forecast
   confidence. A probability without its threshold can't become a decision, so the two
   travel together on the `Flight`.
5. Result cached onto `flight.forecast`; the next poll picks it up. Concurrent pollers for
   the same flight share **one** vendor request (an `inFlight` promise map) — "five devices
   must not become five vendor calls."

**Key idea:** prediction is *bought, not built*. There is no local ML model to feed, which
is why flights no longer carry weather/rotation "signals."

---

## 6. Data flow #2 — recovery (the main pipeline)

All in `server/engine/simulation.ts`.

**Trigger.** `detectDisruption(flightId)` is the single entry point for "a disruption was
caught." Today the **`/ops` panel** calls it via `POST /api/disruptions` (a human triggers
cancellations on cue for a live demo). The function doesn't know or care who called it — a
future real AviationStack-status poller would call the exact same function.

**Lifecycle** (advances on timers, watched or not):

1. **DECIDING** → after a short delay, `finishDecide()` flips the event to **READY** and
   creates one `RecoveryTask` *per booking on the flight* (the multi-passenger "common
   brain" — each passenger on the same disruption gets their own task).

2. **Per task, branch on pre-auth:**
   - **Pre-authorised & plan still intact** → act immediately, no window.
   - **Pre-auth but a piece is gone** → hand back to the member (won't substitute something they never saw).
   - **No pre-auth** → open a **consent window whose length is derived, not constant**:
     `confirmWindow()` takes the supplier offer's own expiry, subtracts the time needed to
     book, and bounds it (`offer-expiry` / `check-in` / `ceiling` / `floor`). The old
     hardcoded 90s is gone. If there's too little time to even ask, consent tier decides alone.

3. **Window expires unanswered** → `settleExpired()`. Consent gates **spending, not care**:
   - `autopilot` → book it.
   - `ask` but the recovery **costs ₹0** → book it anyway ("stranding someone because they didn't pick up is worse").
   - `ask` and it **costs money** → stop, nothing booked, seats stay held, hand over.

4. **Member acts** (`resolveTask`, via `POST /api/disruptions/:flightId/consent`): approve
   / hand-over / browse / choose / swap-hotel / swap-cab. Choosing an alt permanently
   excludes the rejected one.

5. **Before spend — revalidation** (`revalidateChoice` → `suppliers.revalidateOffer`): the
   seat is re-checked at the moment of ticketing. If it's gone, cascade to the next viable
   candidate. *"Consent was to the outcome, not to this specific seat."* Instead of
   shrinking the window to outrun the market, it re-checks at spend time.

6. **Acting → booked**: `scheduleAct()` streams narration steps (seat, onward-leg re-check,
   hotel, cab, single-use virtual card) on timers.

Every recovery ends in exactly one terminal outcome:
`CONFIRMED / RELEASED / ESCALATED / ROLLED_BACK`, reported **per component**
(payment / flight / hotel / ground) so a partial success has somewhere to go.

The client side: `getRecoveryView()` assembles *everything* the recovery page needs (phase,
`secondsLeft`, `windowSeconds`, chosen IDs, `owedNow`, note, resolution) — computed on the
server, rendered raw by the client.

---

## 7. The supply side — inventory fetch and de-dupe

`server/suppliers/index.ts` fans one search across **Duffel + Sabre + Travelport** (and a
write-capable `sandbox` when `ZKD_SANDBOX=1`), via `Promise.allSettled` so **a dead vendor
degrades the result rather than failing it**, with per-source status reported. The same
physical flight arriving from two sources is de-duped, preferring
*live over synthetic → known-expiry → cheaper*. The **union of seats** across all sources
is the scarcity number that feeds thresholds. This is the "2–3 inventory sources, not a
single GDS" commitment.

---

## 8. The safety spine

**Policy gate — `server/policy/index.ts`. Default deny.** Every proposal (a *bundle*)
crosses `evaluate()` or it doesn't execute. Rules are pure functions
(`fare_class_ceiling`, `fare_delta_cap`, `seat_exists`, `duplicate_ticket`,
`exposure_cap_exceeded`, `onward_leg_unprotected`, `incoherent_bundle`, …). Two invariants:
**missing inputs deny** (absence isn't permission), and **every evaluation — even a cache
hit — reaches the ledger** (no holes in the audit trail). It's TypeScript now but written
one-function-per-rule to map 1:1 to OPA/Rego later. (The older prototype in
`amex-travel-disruption-concierge/policy/` has the actual `.rego` files.)

**Bundle — `lib/bundle.ts`.** The unit the pipeline searches for is not a seat but a
coherent **flight + hotel + ground** plan. Flight *anchors*; hotel/ground derive from it
(so it's not a 576-combination cross-product). `coherence()` is a hard constraint — a hotel
you can't reach in time "is not a worse room, it is not a room." `repairPlan()` fixes the
cheapest broken component and keeps the anchor; only a dead flight kills a bundle.

**Two separate ledgers:**
- *Decision ledger* — why we decided (fed by the policy gate).
- *Reconciliation ledger* (`server/ledger/reconciliation.ts`) — **what we're owed**. When
  the card fronts a fresh purchase, the money is a receivable until the carrier settles.
  Settlement is polled **in batches per carrier** on a settlement-cycle cadence (not per
  claim, not hourly). A short payment is `partial`, never `settled` ("initiated is not
  completed"). A `recoveryRate` per carrier feeds back into ranking, so a carrier that
  stiffs claims makes fronting against it visibly more expensive.

---

## 9. External APIs — all behind adapters, all with mock fallback

Every provider is one file in `server/`, catches its own errors, and returns empty /
`source:'mock'` rather than throwing:

| Provider | File | Supplies | Live today? |
|---|---|---|---|
| **Lumo** (thinklumo.com) | `lumo.ts` | Cancellation probability, connection risk, confidence; webhook subscription for reschedule detection | No key → deterministic mock. Demo probabilities are **pinned fixtures** (Priya's leg = 0.83), still labelled `source:'mock'` |
| **MyCa** (Amex) | `myca.ts` | System of record: identity, cabin entitlement, per-transaction cap, single-use vPayment. Concierge **stores none of it** | No creds → mock |
| **Duffel / Sabre / Travelport** | `suppliers/*` | Flight inventory + revalidation; sandbox has the write plane for reissue/rollback | Sandboxes |
| **LiteAPI** | `liteapi.ts` | Hotel offers | Sandbox |
| **AviationStack** | `aviationstack.ts` | Live flight status (the future real disruption trigger) | Optional key |
| **Gemini** | `gemini.ts` | Natural-language "explain this decision" | Optional key |

The whole app runs entirely on mock data with no `.env.local` — keys only switch on the
live integrations. Nothing is ever allowed to present a mocked probability as a vendor one;
the `source` field enforces this end to end, all the way into `zkd-android`'s types.

---

## 10. The clients

**Web** (`app/*/page.tsx`): server-rendered pages, `WorldProvider` polls the schedule every
4s keyed on `?as=<passenger>`, recovery pages poll their own flight's disruption view.

**Android** (`zkd-android/src/api.ts`): a mirror of the *same* `apiTypes` contract, pointed
at `API_BASE_URL`, doing `getJSON` / `postJSON` against the identical `/api/*` endpoints —
schedule, flight detail, preauth, recovery, consent, resolve. Architecturally just another
poller; the phone decides nothing.

---

## 11. Known open seam

The `MycaProfile` type separates `cardMember` from `traveller`, but today they're the same
person — the **"card member books for someone else" consent model is unresolved** (whose
spend consent, whose passport/preferences?). That's the single biggest flagged gap, and the
party-level work (`altsForParty`, `partyCost`, aggregate exposure caps in the policy gate)
is the groundwork being laid for it.
