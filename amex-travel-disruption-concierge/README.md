# Autonomous Travel-Disruption Concierge

Amex Codestreet 2026 prototype. Priya, an Amex Card Member, flies **MAA → DEL → LHR** for a
board meeting in London. At **06:12** the Chennai–Delhi leg is cancelled, invalidating the
Delhi hotel, the airport transfer and the DEL→LHR connection. The concierge re-plans the trip,
gates every booking through real Rego policy, and rolls the whole saga back if a supplier fails.

Currency is **INR** throughout. Duty of care comes from **DGCA CAR Section 3, Series M, Part IV**.

## Setup

```bash
brew install temporal opa      # the only two things that must be on PATH
npm install                    # also installs web/
npm run demo                   # success path  → artifacts/dashboard.png + push.png
npm run demo:fail              # rollback path → artifacts/temporal-trace.png
opa test policy/               # 25 policy tests
```

Add `--fast` (`npm run demo:fast`) to collapse every simulated latency while iterating.
`npm run stop` tears down the OPA and Temporal dev servers, which are left running on purpose
so the Temporal Web UI stays available after a run.

## Artefacts

| File | What it shows | Produced by |
|---|---|---|
| `artifacts/temporal-trace.png` | Real workflow history: A1→A4, `CarrierUnavailableError`, then C4→C3→C2→C1 | `npm run demo:fail` |
| `artifacts/dashboard.png` | Recovered itinerary with a "why" chip expanded to its OPA rule path | `npm run demo` |
| `artifacts/push.png` | Disruption push on a 9:16 phone frame | `npm run demo` |

All three are captured at 2× pixel density. `temporal-trace.png` is captured automatically but
can be retaken by hand — the failure run prints the direct Temporal Web URL.

## The saga

Each activity registers its compensation **before** it executes. On failure the stack unwinds LIFO.

| | Activity | Compensation |
|---|---|---|
| A1 | `reserveVAN` — single-use Amex virtual account number | `releaseVAN` |
| A2 | `bookFlight` — rebook MAA→DEL, protect DEL→LHR | `voidFlight` |
| A3 | `bookHotel` — Delhi hotel, funded by duty of care | `cancelHotel` |
| A4 | `bookGround` — airport transfer | `cancelGround` |

`FORCE_FAILURE=bookGround` makes the ground-transit mock throw a non-retryable
`CarrierUnavailableError`. Every compensation is idempotent, keyed on
`${workflowRunId}:${activityId}` in the `compensation_ledger` table.

## Policy

`policy/rebook.rego` gates every proposed booking (supplier offer must exist, TTL > 30s, cabin
and carrier permitted, fare delta within cap). `policy/dutyofcare.rego` encodes the DGCA
entitlements and the cancellation slab (₹5,000 / ₹7,500 / ₹10,000 by block time, or the booked
fare, whichever is less). Force majeure removes the cash slab but never the duty of care.

Policy is **evaluated at runtime by `opa run --server`** over HTTP. There is no allow/deny
logic in TypeScript anywhere in this repo.

Every OPA decision is written to the `decision_ledger` table (SQLite) with its input, result,
`rule_path` and timestamp. The dashboard's "why" chip reads `rule_path` from that table — the
UI has no hard-coded copy of it.

## Layout

```
policy/    rebook.rego, dutyofcare.rego, *_test.rego, data.json
worker/    Temporal workflow (workflows.ts) + activities
mocks/     supplier mocks with seeded latency + forced-failure switch, recorded fixtures
web/       React dashboard + phone frame
scripts/   run-demo.ts, capture.ts, capture-trace.ts, api-server.ts
artifacts/ the three PNGs
```

## Determinism

"Now" is frozen at `2026-08-25T06:12:00+05:30`. All randomness is seeded — booking references
are a hash of the idempotency key. Mock latencies are fixed (signal 2s, context 3s, supplier
fan-out 15s, OPA ~50ms, rank 4s), and the ledger's virtual clock advances by the full simulated
latency even under `--fast`, so timestamps are identical between a real-time and a fast run.

No external API is ever called. Every supplier response replays a recorded fixture.
