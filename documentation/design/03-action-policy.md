# Action policy — what we do, and when

**ZKD Concierge · Codestreet 2026 / American Express**

The complete decision path from "this flight looks shaky" to "you have been told". Every timing
figure traces to the latency budget in §4.

---

## 1. The seven phases

| Phase | Trigger | What happens | Reversible? |
|---|---|---|---|
| **WATCH** | A carrier signal or forecast crossing | Deduplicate at the edge; **classify the disruption** (cancellation / reschedule / delay-cascade / diversion) | Yes — the phone stays silent |
| **WARM** | Forecast crosses the flight's own `prepare` threshold | Assemble trip context; **one** coordinator reshop for the whole route group; build and price a candidate portfolio across every supplier | Yes — nothing claimed, nothing spent |
| **ASK** | A plan exists | Notify with the plan and the price; open the **derived window** (§3) | Yes |
| **WAIT** | — | Keep the bundle portfolio refreshed and valid against offer expiry. Nothing is held | Yes — nothing has been claimed |
| **RE-CHECK** | Member confirms, or the window closes | Re-validate the chosen offer with its supplier; cascade to the next candidate if it is gone | Yes — this is the last reversible step |
| **ACT** | Consent (explicit or by silence) **and** a re-validated offer | Allocate → policy gate → payment → saga | **No. This is the boundary.** |
| **VERIFY** | Original disposed | Re-check every onward segment | — |
| **CLAIM** | Booking settled | Claim duty of care from the carrier; settle only the uncovered remainder | — |

**Nothing irreversible happens left of ACT.** That is the load-bearing safety claim, and it does
not depend on the model being right.

---

## 2. Probability → action

The bands are **not fixed percentages**. Each flight carries its own thresholds, computed from how
much inventory is left on the route, how close departure is, whether a hard onward constraint
exists, and how confident the forecast is in itself (`lib/thresholds.ts`, and `design/01` §4).

| Band | What runs | Member sees | Cost if wrong |
|---|---|---|---|
| Below `prepare` | Monitor only | A green figure in the app | Nothing |
| `prepare` | WARM: context, coordinator reshop, priced candidates across all suppliers | An amber figure | ~102 supplier calls |
| `ready` | WARM + the refresh loop keeping bundles bookable + pre-computed policy verdicts | A red figure, and *"we have backup seats identified"* | Above, plus the supplier calls each refresh costs |
| `preAuthorise` | **Pre-authorise** — present the whole plan and the exact amount, collect a conditional instruction | A notification asking what they'd want **if** it cancels | Nothing. The instruction expires unused if the flight operates. |
| Carrier acts | ACT | **The notification** | — |

**Only a disruption and the ask-early crossing notify.** Below that, a member cannot act on a
forecast, and a product that alerts at 60% gets muted. At the threshold the question changes from
*"your flight is cancelled"* to *"what would you like if it is?"* — which they have hours to answer.

Every threshold evaluation is written to the decision ledger **with its inputs**. An adaptive
threshold that cannot be reconstructed after the fact is not auditable.

### 2.1 Not every disruption needs a rebooking

| Kind | Rebook? | Re-time hotel & transfers? | Consent needed? |
|---|---|---|---|
| Cancellation | Yes | Yes | Yes, if it costs the member |
| Reschedule, connection survives | **No** | Yes | **No** — nothing is being spent |
| Reschedule, connection breaks | Yes | Yes | Yes, if it costs |
| Delay cascade, connection survives | No | Yes | No |
| Diversion | Yes | Yes | Yes |

A schedule move that still makes the onward connection wakes Pipeline 3 alone. Opening a consent
window for a free hotel re-timing would be asking permission to spend nothing.

### 2.2 What a pre-authorisation changes

| | No pre-auth | Pre-authorised |
|---|---|---|
| On cancellation | Notify → window → act | **Act immediately** |
| Human in the critical path | Yes | **No** |
| Member's thinking time | Minutes, under pressure | Hours, calm |

It is **conditional and specific**: it fires only if the flight cancels, and only for the plan shown.
If any part of that plan is unavailable when the moment comes, the authorisation **does not carry
over** and we fall back to asking. Substituting silently would break the promise the whole system
rests on. Declining, or simply not answering, costs nothing — it falls back to the window.

---

## 3. The consent window

Captured **once, at card activation** — not as an in-app toggle. Two settings:

| Setting | On a disruption | If they do not answer |
|---|---|---|
| **Autopilot** | Present the plan, open the window | **Proceed and book.** That is the permission granted. |
| **Ask me first** — recovery is free | Present the plan, open the window | **Book it anyway.** There is no spend to consult about, and stranding them is the worse outcome. |
| **Ask me first** — recovery costs them | Present the plan, open the window | **Stop.** Nothing booked, nothing charged, held seats retained. |

### 3.1 How long the window is, and why

The previous specification said 90 seconds and never derived it. It was indefensible in both
directions: too short for a person to read a plan and decide, and unrelated to how long the offer
being decided on actually survives.

The window is now **the supplier's own guarantee, minus the time we need to act inside it**:

```
window = clamp( (offer.expires_at − now) − exec_budget(11 s) − network_margin(20 s),
                FLOOR, min(CEILING, time_to_departure − checkin_cutoff) )
```

| Bound | Value | Why |
|---|---|---|
| `offer.expires_at` | From the supplier | A quoted fare is guaranteed until a stated moment. Past it we are offering a price we cannot fill. |
| `FLOOR` | 2 min | Below this the ask is theatre — a push must arrive, be noticed and be answered. **Assumption, to be replaced by measured push-to-first-interaction latency.** |
| `CEILING` | 20 min | The offer's expiry is the supplier's promise, not the market's. |
| `checkin_cutoff` | 45 min domestic / 60 international | A window that outlives check-in on the replacement is useless. |

Observed behaviour (`lib/confirmWindow.ts`, verified against live Duffel offers):

| Situation | Window | Bound by |
|---|---|---|
| Offer expires in 6 min | 5.5 min | offer expiry |
| Offer expires in 3 h, departure in 8 h | 20 min | ceiling |
| International, departure in 70 min | 9.5 min | check-in |
| Offer expires in 40 s | **no window** | floor — consent tier decides alone |

**Below the floor we do not ask.** Autopilot acts; ask-me-first acts if the recovery is free and
escalates if it costs. Asking someone to answer in seconds is not really asking.

### 3.2 The seat can still be sold while they think

It can — and the answer is not to rush them.

**At the moment of confirm, and not before, we re-check that exact offer with the supplier.** If it
has been sold we do not fail and we do not stop: the next ranked candidate from the portfolio takes
its place. What the member consented to was the outcome — getting to Delhi tonight with their
connection intact — not one specific seat.

| Re-check result | What happens |
|---|---|
| `available` | Book it, at the price shown |
| `price-changed` | Surface the new price before spending |
| `gone` | Cascade to the next bookable candidate |
| `unknown` | **Treated as not bookable.** A source we could not verify is one we cannot promise. |

This is what makes a longer, humane window safe. Verified end to end against live Duffel
inventory: a sold offer cascades to the next flight rather than erroring.

**Consent gates spending, not care.** This is the principle the table encodes. Asking permission
exists to protect a member's money — so when the fix costs them nothing, silence should not leave
them at an airport overnight. If it would cost them, silence means stop.

During the window the member may:

- **Approve** → straight to ACT
- **Open the options** → the countdown **pauses** (engaging is itself an intervention; nothing proceeds silently during one)
- **Take the wheel** → halt immediately; hand to a human with full context

### When the member overrides

- Their stated preference becomes a **new hard constraint**, gating at the policy layer like any other.
- The rejected option is appended to `rejected_offer_ids` and **can never be re-proposed** — enforced as a **policy input**, not a prompt instruction. A rule that lives only in a prompt is a preference, not a control.
- The iteration counter resets **once** per intervention; the visited-set **persists**, so the agent may re-plan but cannot ping-pong.
- The refresh loop keeps running, so the member decides against currently valid options. Nothing is confirmed and nothing is paid while an intervention is outstanding.
- If their constraint empties the feasible set: **say so and escalate.** Never quietly fall back to the option they just rejected — that is the single worst failure available to the system, because it overrides an explicit human decision.

---

## 4. Latency budget

**53 s cold path. 42 s of it runs before the cancellation.**

### Before — WARM, 42 s, off the critical path

| Step | Budget |
|---|---|
| Signal ingest | 3 s |
| Trip context assembly | 5 s |
| Supplier fan-out (one coordinator reshop) | 34 s |

### At the carrier event — ~11 s

| Step | Budget | Bound by |
|---|---|---|
| Cancellation confirmed | 0.4 s | Feed |
| Allocation + 3 negotiation rounds | 0.6 s | CPU — in-memory candidate set, **zero new supplier calls** |
| Policy gate | ~0.01 s | In-process evaluation (~1 ms) |
| Payment authorised | 0.9 s | Payment API |
| Seat booked | 3.4 s | **Supplier** |
| Hotel moved | 2.6 s | **Supplier** |
| Cab re-booked | 1.5 s | **Supplier** |
| Original disposed | 1.1 s | **Supplier** |
| Onward leg verified | 0.6 s | Supplier |
| Member notified | 0.3 s | FCM |

**~95% of the live path is waiting on somebody else's API.** The thinking — allocation, three
negotiation rounds, and the policy evaluation — is ~0.6 s combined, because negotiation iterates a
candidate set already in memory and issues no new supplier calls. That is the only reason three
rounds cost 0.6 s instead of 100.

The consent window sits **between** the decision and the execution and is *not* counted in either
figure. It is the member's time, not the machine's. The one machine cost that does land inside the
critical path is the re-validation call before ticketing — one supplier round trip, and worth it,
because the alternative is spending on a seat that is already sold.

---

## 5. Choosing between candidates

Min-cost assignment across the portfolio, with allocation priority:

| Priority | Condition |
|---|---|
| 1 | Hard constraint at risk — the travel window is about to break |
| 2 | Onward-leg cascade exposure |
| 3 | Duty-of-care exposure |
| 4 | Flexible window |
| 5 | Block exhausted → next block, or escalate |

Every candidate then crosses a **default-deny** policy gate. Rules evaluated in order; any deny is
terminal:

| Rule | Denies when |
|---|---|
| `voluntary_under_autopilot` | The original flight operated — the change is the member's, not the carrier's |
| `member_rejected_offer` | The offer is in `rejected_offer_ids` |
| `fare_class_ceiling` | Cabin exceeds entitlement |
| `fare_delta_cap` | Cost exceeds a budget **the member themselves stated** (`RebookingRules.outOfPocketCap`). The card's own per-transaction ceiling was removed on 2026-08-19 — see §10 |
| `travel_window` | Departure falls outside the stated window |
| `seat_exists` | No free seat |

Reaching the end with no rule objecting is the **only** way to get an allow.

### The disposition rule

**Involuntary** — the carrier cancelled, or the delay crossed threshold. The re-route is free and
statutory entitlement is intact.
**Voluntary** — the original operated and the member chose to move. The member pays, and under
autopilot it is **denied outright** rather than executed.

Derived from *whether the original operated* — never from whether the member was inconvenienced.
Getting this backwards silently bills the carrier for a change it does not owe, and surprises the
member with a cost they were never shown.

---

## 6. Execution and rollback

Forward: `reserveVAN → bookFlight → bookHotel → bookGround`, then terminal `disposeOriginal`.
On failure, compensations run in reverse: `cancelGround → cancelHotel → voidFlight → releaseVAN`.

- Each compensation is registered **before** its side effect.
- **Disposal is last and sits outside the chain** — a cancellation has no inverse, so the original
  is only released once the replacement is confirmed.
- Idempotency keys derive from the **business entity** — `(pnr, segment, member, intent)` — not
  from the workflow. A workflow-scoped key defeats activity retry and nothing else: a reset or a
  re-run after escalation mints a new workflow and therefore a second real booking.
- **Compensation *initiated* is not compensation *completed*.** A void outside the airline's void
  window is an asynchronous refund, and routes to escalation rather than being recorded as a clean
  no-op.

---

## 7. Halt conditions

First match wins. The loop always terminates.

| # | Condition | Action |
|---|---|---|
| 1 | Member intervention outstanding | Suspend; re-plan once; await member |
| 2 | Iteration cap (3) reached | Emit best feasible for confirmation; halt |
| 3 | Δ < ε and feasible set unchanged | Emit held baseline; halt |
| 4 | Tuple already visited | Emit held baseline; halt |
| 5 | Prediction decays below the `ready` band | Stand down; nothing was claimed |
| 6 | Feasible set empty | Change objective to next-day, claim duty of care, escalate |

Every terminal state is one of `CONFIRMED`, `ESCALATED`, `ROLLED_BACK`, `RELEASED`. **No state
hangs and no state expires in silence.**

---

## 8. Duty of care

Claimed from the carrier **before** anything touches the member's wallet; only the uncovered
remainder is settled.

| Entitlement | Threshold |
|---|---|
| Meals | Delay ≥ 2 h |
| Hotel + transfer | Delay ≥ 6 h **and** an overnight window |
| Alternate flight or refund | Delay ≥ 6 h |

Force majeure removes the cash compensation, never the duty of care.

> Tier `deck` — from the Round 1 submission; the primary DGCA CAR text has not been re-retrieved
> for this build and must be reconciled before production.

---

## 9. Outcome taxonomy

Every recovery resolves to exactly one, and we report the mix rather than a single success number.

| Outcome | Definition | Modelled |
|---|---|---|
| **A** | Same-day seat, hard constraint held | 52.61% |
| **B** | Same-day seat, arrives past the member's slack | 12.87% |
| **C** | No same-day seat; next-day flight + duty of care | 27.64% |
| **D** | Escalated to a human | 6.88% |

Same-day recovery (A+B) is **65.48%**, and it is the headline **because it discriminates** — it
moves under every lever we care about. Closed-without-a-human (93.12%) is reported as a secondary
figure only, because it tracks the `p_intrinsically_complex` assumption almost 1:1 and is
therefore an input restated rather than a finding.

Source: `iropssim.py`, fixed seed, reproducible — `python3 iropssim.py | diff - iropssim-output.json`.

---

## 10. Money flows only on the member's Amex card

**Every payment goes out on the member's Amex card, and every refund comes back to that same
card.** This is the routing invariant, stated once here so every other document can refer to it.

| Direction | Instrument | Rule |
|---|---|---|
| Any spend — rebooked flight, hotel, ground transfer, or any supplier charge | The member's Amex card (the same card the original trip was booked on) | Never any other instrument: no cash, no bank transfer, no vouchers, no third-party pay-out |
| Any refund — cancelled original ticket, carrier duty-of-care reimbursement, hotel/cab credit | Credited back to that same Amex card | A refund first offsets what the card was charged; the system never routes it anywhere else |

**Consequence: the member's Amex balance can never go negative because of this system.**

Two mechanisms enforce it, both already in the engine:

1. **The member is told what is about to be spent, before it is spent, with time to stop it.**

   This replaced a per-transaction cap on **2026-08-19**, and the change is worth stating
   plainly rather than quietly. There used to be a ₹25,000 ceiling checked on every spend path;
   exceeding it stopped the recovery and handed over. It was removed because it was doing more
   harm than good in the case that matters most: a member stranded overnight could be shown the
   only remaining seat home greyed out as *"over your cap"*, which is not protection, it is a
   refusal dressed as one.

   What enforces the invariant now is the notification ladder
   (`server/notify/templates.ts`), and it is a genuinely different guarantee — one of
   **informed consent by default** rather than a hard ceiling:

   | Rung | What the member is told | If they say nothing |
   |---|---|---|
   | 1 | This flight is at risk of cancellation — tell us what you'd prefer | keep watching |
   | 2 | It cancelled. We have already ranked your alternatives | proceed to 3 |
   | 3 | We are about to book *X* for *₹N after your refund*. You have *M* minutes to stop us | **book it** |
   | 4 | Booked. Here is the itinerary and what comes back to your card | — |

   Rung 3 quotes the **delta** after the expected refund on the original ticket, never the gross
   fare: announcing ₹18,000 when ₹14,000 of it is returning is true and misleading, and this
   message only works if it is neither.

   This restores the frozen canon's Tier A mechanics — *notify → quiet window → proceed if
   silent* — which the application had drifted away from by treating silence plus a cost as a
   stop condition.

   **The honest cost of the trade:** an unattended recovery can now spend an arbitrary amount if
   the member never answers. What stands between them and that is rung 3 *actually arriving*.
   That makes an undeliverable notification channel a real safety defect rather than a cosmetic
   one — which is why every dispatch attempt, delivered or skipped, is written to the decision
   ledger and surfaced on `/ops`. A budget the *member themselves* states still applies as a hard
   rule (`RebookingRules.outOfPocketCap`); the distinction is that it is their choice rather than
   the card's refusal.

2. **Money returns to where it was drawn from.** A duty-of-care reimbursement or a cancelled
   ticket's refund lands on the same card the recovery was charged to, so spend and credit are
   always the same instrument and net out on one statement.

   As of 2026-08-19 this is **computed**, not merely asserted. `server/domain/refund.ts`
   estimates what comes back — the original fare (in full when the carrier cancelled, since
   statutory entitlement overrides the fare rules that govern a passenger changing their mind),
   less cancellation charges on any stay or transfer being unwound. Member-facing surfaces show
   three figures rather than one: **what the plan costs**, **what comes back**, and **what you
   end up paying**. Where we have no record of what the member paid, the refund reads *"not known
   yet"* and never ₹0 — a guessed refund becomes a wrong delta, and the delta is the number a
   member decides on.

Ordering note (this is why the invariant matters during recovery): the replacement is booked and
confirmed **before** the original is disposed (§6 — disposal is last, outside the rollback
chain). The refund of the original is therefore always an event that follows a *completed*
recovery, never one the pipeline depends on to fund the next step — the card must be able to
carry the recovery charge on its own.

This is exactly why *expected* and *recovered* are tracked as separate fields on a
`RefundClaim` (`server/ledger/reconciliation.ts`), and why the delta shown to a member is
labelled as what they will end up paying rather than what they are charged today. Canon's
**initiated is not completed** rule applies to money as much as to bookings: the refund is
quoted because the member needs it to decide, not because it has arrived.

Member-facing copy wherever a price is shown should say the same thing: *"Charged to your Amex;
anything refunded comes back to the same card."*

---


## 11. Who notices — the procedure today versus the procedure we are building

Raised in mentor meeting 2. Everything above §11 describes the system **from detection onward**.
This section is about the step before that, which is the one the member actually experiences first.

### As of 2026-08-19: proactive, on three lanes. Superseded the "reactive" shape below.

```
flight is cancelled
      ↓
a push webhook (Duffel/AeroDataBox), the AviationStack poll fallback, or a
corroborated member report tells us within seconds-to-minutes
      ↓
pipeline is already warm — options ranked against their preferences
      ↓
member's phone tells them, with a plan already attached
```

`detectDisruption` (`zkd-app/server/engine/simulation.ts`) is now reachable from `server/webhooks/`
(push — Duffel and AeroDataBox adapters live, OAG deliberately stubbed inert pending a
subscription), `server/engine/statusPoller.ts` (poll — AviationStack, a budget-capped fallback that
stands down whenever a live webhook already covers a flight), and `server/engine/memberReports.ts`
(the member — acts for the reporter immediately, corroborates for everyone else at three
independent reports), in addition to the `/ops` console's manual trigger (kept for rehearsal and
for a flight none of the three lanes covers). **`A1` (detection lead time,
`06-experience-kpis.md`) is still undefined** — the lanes exist and are tested, but nobody has yet
measured minutes-before-vs-after against a real cancellation outside a demo trigger.

### The procedure this superseded — kept for the record, not current

```
flight is cancelled → member finds out → member contacts Amex → Amex begins to rebook
```

This used to be the literal production shape: `detectDisruption` had exactly one production
caller, a human pressing a button in `/ops`, and the whole latency budget in §4 measured from the
wrong moment — the member's own noticing-and-queueing minutes were unmeasured and unoptimised.
Fixed 2026-08-19; do not cite this shape as current.

Note what the fix does **not** change: the risk model is real and runs ahead of time (§2, and
`05-cancellation-risk-model.md`) — prediction and detection remain different capabilities. A
forecast that a flight is *likely* to be cancelled is not the same signal as knowing it *has been*,
and the three lanes above are what closes that second gap.

### What's still genuinely a gap, not just an unmeasured target

The warm path that makes this credible was already real before the three lanes landed: risk
crosses a threshold, alternatives are pre-cached, the plan is composed and parked at the consent
gate with nothing spent. What remains open is **OAG specifically** — it can express a cancellation
and is already integrated, but the trial key allows 100 calls per 14 days, which cannot support
continuous watching, so it stays deliberately stubbed inert rather than silently under-covering.
That is a budget decision to revisit, not an architecture gap — see §1 of
[`02-data-sources-and-apis.md`](02-data-sources-and-apis.md).

### What does not change

The authority boundary is unaffected. Detecting sooner means the member is told sooner and the
options are better prepared — it does **not** mean anything irreversible happens earlier. The
consent gate in §3, the halt conditions in §7 and the money-flow invariant in §10 all sit
downstream of detection and are untouched by moving it earlier. A faster trigger buys the member
more time to decide, not less.

### How we will know it worked

The measure is `A1` (detection lead time) in
[`06-experience-kpis.md`](06-experience-kpis.md) — minutes between the cancellation becoming
knowable and us knowing it, negative when we knew before the member did. **The mechanism exists
now; the measurement still doesn't** — no session has yet logged a real cancellation's lead time
against this metric outside a demo trigger. Wiring `A1` off the real webhook/poll/report timestamps
already in the decision ledger is a small follow-up, not a new capability.

---
