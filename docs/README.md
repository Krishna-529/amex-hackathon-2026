# ZKD Concierge — documentation

**Codestreet 2026 / American Express · Autonomous Travel-Disruption Concierge**

Four documents. Read them in order; each assumes the one before it.

| # | Document | Answers |
|---|---|---|
| 1 | [Prediction model](01-prediction-model.md) | How we calculate the probability, what the features are, how it is trained and validated, and what it is honestly not |
| 2 | [Data sources & APIs](02-data-sources-and-apis.md) | Every API behind every signal — provider, latency, cost, and whether we have it today |
| 3 | [Action policy](03-action-policy.md) | What we *do* at each probability, the consent window, the policy gate, the saga, and every halt condition |
| 4 | [Infrastructure & cost](04-infrastructure-and-cost.md) | Why there is no GPU on the critical path, scale sizing, and running cost |

---

## The three things worth taking away

**1. The probability buys speed, not safety.**
A cancellation is a fact the airline files — we do not need to predict it to act on it. The model
exists to move 42 seconds of work off the critical path, so recovery takes ~11 s instead of 53 s.
Safety rests on the WAIT gate, the default-deny policy layer and the consent window — none of which
consult a probability. A false positive costs an API call; a false negative costs 42 seconds.
**Neither strands anyone.**

**2. The fast part is fast because it isn't AI.**
Of the ~11 seconds, **95% is waiting on airline, hotel and payment APIs.** The thinking —
min-cost allocation, three negotiation rounds and the policy evaluation — is ~0.6 s combined,
because negotiation iterates a candidate set already held in memory and issues zero new supplier
calls. There is **no GPU on the critical path**; the risk model is gradient-boosted trees on
tabular features, batch-scored on CPU. Supplier rate limits are the ceiling, not compute.

**3. Nothing irreversible happens before the member has had their say.**
Everything left of ACT is free: no hold, no spend, nothing that could be charged. The member gets
a real **90 seconds**, and what silence means depends on the permission they granted when they
activated the card — Autopilot proceeds, Ask-me-first stops. A flight they reject can never be
re-proposed, and that exclusion is enforced as a **policy input**, not a prompt instruction,
because a rule that lives only in a prompt is a preference rather than a control.

---

## Prototypes in this repo

| Path | What it is |
|---|---|
| `zkd-app/` | Next.js web app — `/flights`, `/flights/[id]`, `/history`, `/profile`, `/settings`, `/recovery/[id]` |
| `zkd-android/` | Expo / React Native Android app with native notification channels |
| `iropssim.py` | Monte Carlo behind every `sim`-tier number. Fixed seed: `python3 iropssim.py \| diff - iropssim-output.json` must be empty |
| `zkd_*_agent_v2.0.md` | The four agent specifications — Supervisor, Flight, Hotel, Ground |

---

## Evidence tiers

Every number in these documents carries one. Where a figure is a target or an estimate, it says so
rather than borrowing the authority of a measurement.

| Tier | Means |
|---|---|
| `verified` | External source retrieved and linked |
| `calc` | Arithmetic over cited inputs |
| `sim` | Simulation output, fixed seed, reproducible |
| `assumed` | Our input, not a measurement |
| `budget` | Engineering design target |
| `deck` | From the Round 1 submission, not re-verified |

**Known outstanding:** the DGCA duty-of-care thresholds carry tier `deck`. The primary CAR text
has not been re-retrieved for this build and must be reconciled before production.
