# Action policy — what we do, and when

**ZKD Concierge · Codestreet 2026 / American Express**

The complete decision path from "this flight looks shaky" to "you have been told". Every timing
figure traces to the latency budget in §4.

---

## 1. The seven phases

| Phase | Trigger | What happens | Reversible? |
|---|---|---|---|
| **WATCH** | Delay-ratio crossing, or a carrier signal | Deduplicate at the edge; classify the disruption | Yes — the phone stays silent |
| **WARM** | `P(cancel) ≥ 25%` | Assemble trip context; **one** coordinator reshop for the whole route group; build and price a candidate portfolio | Yes — no hold, no spend |
| **ASK** | A plan exists | Notify with the plan and the price; open the **90-second window** | Yes |
| **WAIT** | — | Evaluate the hold gate: hold speculatively, or keep candidates warm | Yes — an unconfirmed hold expires free |
| **ACT** | Consent (explicit or by silence) | Allocate → policy gate → payment → saga | **No. This is the boundary.** |
| **VERIFY** | Original disposed | Re-check every onward segment | — |
| **CLAIM** | Booking settled | Claim duty of care from the carrier; settle only the uncovered remainder | — |

**Nothing irreversible happens left of ACT.** That is the load-bearing safety claim, and it does
not depend on the model being right.

---

## 2. Probability → action

| P(cancel) | What runs | Member sees | Cost if wrong |
|---|---|---|---|
| < 25% | Monitor, re-score every 10 min | A green figure in the app | Nothing |
| 25–55% | WARM: context, coordinator reshop, priced candidates | An amber figure | ~102 supplier calls |
| 55–80% | WARM + hold gate evaluation + pre-computed policy verdicts | A red figure, and *"we have backup seats identified"* | Above, plus possible hold churn |
| **≥ 80%** | **Pre-authorise** — present the whole plan and the exact amount, and collect a conditional instruction | A notification asking what they'd want **if** it cancels | Nothing. The instruction expires unused if the flight operates. |
| Cancellation filed | ACT | **The notification** | — |

**Only a disruption and the 80% crossing notify.** Below that, a member cannot act on a forecast,
and a product that alerts at 60% gets muted. At 80% the question changes from *"your flight is
cancelled"* to *"what would you like if it is?"* — which they have hours, not ninety seconds, to answer.

### 2.1 What a pre-authorisation changes

| | No pre-auth | Pre-authorised |
|---|---|---|
| On cancellation | Notify → 90 s window → act | **Act immediately** |
| Human in the critical path | Yes | **No** |
| Member's thinking time | 90 s | Hours |

It is **conditional and specific**: it fires only if the flight cancels, and only for the plan shown.
If any part of that plan is unavailable when the moment comes, the authorisation **does not carry
over** and we fall back to asking. Substituting silently would break the promise the whole system
rests on. Declining, or simply not answering, costs nothing — it is the 90-second window as before.

---

## 3. The consent window

Captured **once, at card activation** — not as an in-app toggle. Two settings:

| Setting | On a disruption | If they do not answer |
|---|---|---|
| **Autopilot** | Present the plan, open 90 s | **Proceed and book.** That is the permission granted. |
| **Ask me first** — recovery is free | Present the plan, open 90 s | **Book it anyway.** There is no spend to consult about, and stranding them is the worse outcome. |
| **Ask me first** — recovery costs them | Present the plan, open 90 s | **Stop.** Nothing booked, nothing charged, held seats retained. |

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
- Live holds stay live. Nothing is confirmed and nothing is paid while an intervention is outstanding.
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

The 90-second consent window sits **between** the decision and the execution and is *not* counted
in either figure. It is the member's time, not the machine's.

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
| `fare_delta_cap` | Cost exceeds the declared per-transaction cap |
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
| 5 | Prediction decays below the hold gate | Release hold at zero cost |
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
