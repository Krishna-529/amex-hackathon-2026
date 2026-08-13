# architecture.md — ZKD Concierge system architecture

Current canon. Mirrors the `## A2. FROZEN ARCHITECTURAL FACTS` block that is byte-identical across
the four `zkd_*_agent_v2.0.md` specs. Where this file and the Round 1 deck disagree, this file wins.

## Scope

The **Tier A (full consent, autopilot)** path only. The member has given standing consent; the agent
acts and narrates. Tier C (monitor-only) is out of scope. Tier B is not a separate mode — a Tier A
member may **take the wheel at any moment** and the system must adapt (see *Human override*).

## Two layers, authority physically separated

| Layer | Component | Owns | Authority |
|---|---|---|---|
| **Layer A** | Planning & Negotiation — LangGraph | Cognition only: context assembly (PNR, trip DAG, entitlement, travel window), option generation, cross-supplier negotiation, allocation, ranking, explanation | **Zero execution authority, zero spend authority.** MCP tool clients are read-only (search, reshop, price). No network route from Layer A to a mutating supplier API |
| **Layer B** | Durable Execution — Temporal.io | Sole owner of side effects — everything touching inventory or money. Retries, backoff, heartbeats, timeouts | Executes only what the Control Plane allows |
| **Control Plane** | OPA/Rego PDP, **default deny**, decision log | Gateway between A and B. **Every proposal crosses this boundary or it does not execute** | Sidecar / in-process library (~1 ms, proof `opa-latency`). **Never a remote PDP** — a remote PDP puts a network failure on the critical path of the one unbypassable component |

## Agent graph

Supervisor routes, never calls a supplier itself. Sub-agents — **Flight, Hotel, Ground,
Duty-of-care** — are strict tool-callers returning schema-validated proposals. Only a Temporal
activity downstream of an OPA allow touches a supplier mutatively. Duty-of-care is drawn as its own
node; its rules are spread across the four spec files, not a fifth file.

## Shared state

```
TripState {
  disruption · pnr · consent_tier · travel_window · constraints ·
  candidates[] · portfolio[] · policy_decisions[] · holds[] ·
  confirmed[] · rejected_by_member[] · claims[] · escalation?
}
```

## The seven-phase lifecycle

Every recovery walks these phases in order:

| Phase | What happens | Reversible? |
|---|---|---|
| **WATCH** | Delay-to-departure ratio crosses threshold, or a carrier signal arrives. Edge dedup drops duplicates | Yes — member's phone is silent |
| **WARM** | Context assembly; per-route coordinator runs **one** reshop for the whole affected group; portfolio built and priced | Yes — no hold, no spend |
| **ASK** | Conditional consent captured **against the outcome, never a flight number** | Yes |
| **WAIT** | Hold gate evaluated. Candidates stay warm, or a speculative hold is taken from the coordinator block | Yes — an unconfirmed hold expires free |
| **ACT** | Min-cost allocation across the portfolio → OPA → Temporal saga | **No — this is the boundary** |
| **VERIFY** | Onward segments checked intact after disposal | — |
| **CLAIM** | Duty of care claimed from the carrier; only the uncovered remainder is settled | — |

## WAIT gate — the central safety claim

**Nothing irreversible happens left of the WAIT gate.** Everything to its right is triggered by the
carrier actually acting — which is what makes the re-route free and preserves statutory entitlement.

**Consent mechanics under Tier A:** Notify → **quiet window derived from the supplier's offer expiry** → proceed if silent. Payment
is a **vPayment VAN locked to an amount and a date** — unusable and unoverspendable. The quiet window
maps onto the RBI Additional Factor of Authentication e-mandate as a recognised pre-debit
notification. Modes within Tier A: `zeroCharge` (carrier owes it), `wallet` (settled via the VAN),
`cannotBook` (consent held, inventory gone — the honest failure).

## Three clocks — never conflated

- `hold_TTL` — how long the **seat** is held before auto-release.
- `offer_expiry` — how long the **price** is guaranteed.
- `time_to_announcement` — how long until the **carrier decides**.

**Re-holding is not renewal.** An expired hold returns the seat to a market that clears in seconds.

## Hold gate (proof `hold-ttl`)

Take a speculative hold **only if** `hold_TTL > expected_time_to_announcement` **AND**
`P(cancel) × value_of_seat > cost_of_hold + inventory_externality`. Otherwise keep candidates **warm** —
no hold, zero churn risk. The hold remains **tentative throughout** — the member can take minutes to
choose without losing the seat; nothing is confirmed or paid while an intervention is outstanding.

**Churn governance (proof `churn-governance`).** `hold_conversion = holds ticketed ÷ holds placed`
≥ **85%** per carrier, else speculative holding **auto-disables** for that carrier. Prediction
precision *is* hold conversion.

## Portfolio: two levers, not one

Build a **portfolio of alternatives** and run **min-cost assignment across passengers × seats**.

| Lever | Value | Proof |
|---|---|---|
| Combined | **38.63 points** same-day recovery | `sens-portfolio` |
| Breadth — searching > one alternative | **26.31 points**, measured at share 0.001 | `sens-breadth` |
| Allocation — min-cost assignment | **7.20 pts @ 2% share · 12.32 pts @ 6%** | `sens-allocation` |
| Degenerate (breadth = 1, share 25%) | **4.68%** | `sens-worst` |

Always state the split. Most of 38.63 is "search more than one alternative", which is unaffected by
our footprint; allocation is what scales.

## Per-route coordinator

Group affected trips by disrupted route; one reshop per group with request coalescing and jittered
backoff: **300 → 102 API calls for 100 members, −66%** (proof `api-call-collapse`). Confirms do
**not** collapse — every passenger gets their own ticket. **Searches/holds are a race you cannot
pace; confirms are a queue you can.**

## Involuntary vs voluntary disposition — an OPA policy input

- **Involuntary** — carrier cancelled or delay crossed threshold. Re-route is free, airline pays.
- **Voluntary** — original operated, member chose to move. Member pays.
- **A voluntary cancellation is denied outright under autopilot.**

## Side-effect, compensation, idempotency

LIFO compensation chain. Forward:
`reserveVAN → bookFlight → bookHotel → bookGround → disposeOriginal`.
On failure, reverse: `cancelGround → cancelHotel → voidFlight → releaseVAN`.
Compensation is registered **before** each side effect; *initiated ≠ completed*, so partial refunds
route to escalation.

**Terminal disposal.** Dispose the original last, only after the replacement is confirmed, **outside
the LIFO chain — a cancellation has no inverse.**

**The invariant.** Every side effect ⇒ exactly one OPA allow ∧ exactly one registered compensation.
Idempotency keys are deterministic and **attempt-invariant**, from the **business entity**
`(pnr, segment, member, intent)` — never `(workflowID, activityID)`.

## VERIFY — onward segments

After disposal, verify every onward segment is intact. **A no-show on the first leg silently
cancels the rest of the itinerary. Not intact ⇒ escalate.**

## WATCH reconcile

Edge dedup only handles duplicates, not dropped delivery — a dropped cancellation is
indistinguishable from a healthy trip. A **periodic reconcile sweep** is mandatory, over trips inside
the active window, batched by departure-time bucket, comparing held state to carrier schedule and
injecting a synthetic WATCH event on divergence.

## Outcome taxonomy

| Outcome | Definition | Modelled | Proof |
|---|---|---|---|
| **A** | Same-day seat, hard constraint held | 52.61% | `sim-outcome-a` |
| **B** | Same-day seat, arrives past slack | 12.87% | `sim-outcome-b` |
| **C** | Next-day flight + hotel + duty of care | 27.64% | `sim-outcome-c` |
| **D** | Escalated to a human | 6.88% | `sim-outcome-d` |

Same-day (A+B) **65.48%** (`sim-same-day`), cutoff **12 h**. Isolated **81.22%** · systemic
**38.15%**. `closed_without_human` (93.12%) is an **assumed escalation floor restated**, not a model
finding — quote as tier `assumed`.

## Latency budget (~11 s prepared path)

| Work | Time | Done |
|---|---|---|
| Signal ingest | 3 s | WARM (in advance) |
| Context assembly | 5 s | WARM |
| Supplier fan-out | 34 s | WARM |
| **Carrier event → confirmed alternative** | **~11 s** | — |
| OPA evaluation | ~1 ms | — |

Prediction earns its keep by **moving work off the critical path**, not by taking risk early.

## Supervisor loop constraints

- Max **3 iterations**, hard cap.
- No cycle without progress: progress = joint objective strictly improves by ≥ ε, or candidate set
  changes; otherwise halt immediately.
- **Oscillation guard** on visited `(flight_offer_id, hotel_offer_id, date)`.
- Negotiation iterates one pre-fetched candidate set in memory — **zero extra supplier calls**.
- Unroutable states exit to escalation; never hang, never expire in silence.

## Human override — "take the wheel"

- Member input becomes a **new hard constraint**, gating at OPA.
- The rejected option goes to `rejected_by_member[]` and **must never be re-proposed** — enforced at
  **OPA** (first-class `rejected_offer_ids` field with a `deny` rule), not in a prompt.
- Iteration counter resets **once per intervention**; `visited_tuples` persists (re-plan without
  ping-pong).
- Live tentative holds stay live throughout.

## Entitlement (tier `deck` — reconcile before production)

DGCA CAR Section 3, Series M, Part IV (not re-retrieved this build): meals at delay ≥ 2 h; hotel +
transfer at ≥ 6 h **and** overnight window; alternate flight or refund at ≥ 6 h.
Cancellation slab ₹5,000 / ₹7,500 / ₹10,000 by block time or booked fare, whichever is less. **Force
majeure removes the cash component, never the duty of care.**

## Suppliers

- Duffel + LiteAPI sandboxes — free, real book **and** cancel round trip (rollback demo).
- Sabre Dev Studio (free, self-serve; onboarding is top ask).
- Lumo predictive — **advisory only until back-tested**. Precision *is* accuracy.
- Amex ACE + vPayment behind a contract test.
- FCM v1 hybrid notification + data payload at `apns-priority: 10`.
- **Amadeus Self-Service was decommissioned 17 Jul 2026 — never reference it as available.**
- Abstract the supplier so no single GDS is load-bearing.

## Scale

- Burst target Dec 2025 IndiGo event: 2,507 cancellations, 3 lakh passengers in 72 h = **1.16 events/s**.
- Temporal persistence ~58 writes/s (~1,157/s at 20× burst). **Do not shard** — one well-provisioned
  PostgreSQL absorbs this; supplier rate limits are the ceiling.
- `numHistoryShards` fixed at cluster creation — pick **512** up front.
- Decision ledger off the hot path (event bus → BigQuery).

## Orchestration, models, compliance

- **Temporal only. Never reintroduce Celery.**
- Model id/version pin && decode settings fixed; every runtime prompt carries a content hash on each
  decision; any prompt edit invalidates the provider-side cache. Superseded prompt files carry a
  supersession banner in their own header.
- **DPDP Act 2023** governs PNR, passport, payment data.
- Evidence tiers: `verified` / `calc` / `sim` / `assumed` / `budget` / `deck` — quote with a proof ID.

## Not modelled (state as limits)

- Fare and policy availability (a seat that exists may be out of fare policy).
- API failure: rate limits, timeouts, circuit-breaker opening.
- Cross-route correlation (e.g. a Delhi closure disrupts every route into Delhi at once) — captured
  with a scarcity multiplier rather than a network model.
- Diversions are classified but the recovery path for them is not built. The disruption forecast is
  bought from Lumo and mocked until a key exists — advisory, never authorising. Live supplier
  integration is partial: Duffel returns real offers, Sabre cert returns none, Travelport is synthetic.