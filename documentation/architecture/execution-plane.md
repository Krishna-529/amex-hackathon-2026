# The execution plane — what's actually built

**ZKD Concierge · Codestreet 2026 / American Express**

This document exists because the design atlas (the diagram reviewed alongside
`documentation/design/03-action-policy.md`) describes an architecture that,
until this build, was entirely aspirational: the running code's ACT phase was
narration — timed strings like "Seat booked" played back over `setTimeout`,
with no supplier ever actually called and nothing to roll back because
nothing real ever happened. This page describes what replaced that, so the
next reader isn't staring at an aspirational diagram again.

## The two planes, for real

```
zkd-shared/     — the boundary contract: types, idempotency, the OPA client,
                   halt conditions. No secrets, no side effects. Both planes
                   depend on it; neither imports the other.
zkd-app/        — PLAN. Next.js. WATCH → CLASSIFY → WARM → ASK → WAIT →
                   RE-CHECK happen here, via server/engine/planningGraph.ts
                   (a real LangGraph.js graph — see below). At ACT, it starts
                   a Temporal workflow and holds nothing that can spend.
zkd-execute/    — EXECUTE. A separate Node service. Hosts the Temporal
                   Worker that runs the recovery saga's activities. The only
                   place DUFFEL_ACCESS_TOKEN / payment credentials exist.
policy/         — Rego source of truth for the default-deny gate. Identical
                   bundle evaluated by the local `opa` container and (once
                   applied) the ECS sidecar in infra/execution-plane/.
```

zkd-app's own `package.json` has no `book`/`cancel` dependency of any kind —
the write-capable supplier clients (`zkd-execute/src/suppliers/*`) live in a
package zkd-app never installs. "No route from the planning layer to a
mutating supplier API" is therefore true at the level of what code is even
*present* in the PLAN container image, not just what's reachable over the
network.

## The saga, for real

`zkd-execute/src/workflows/recoverySaga.ts` is a real Temporal workflow:
forward `reserveVAN → bookFlight → bookHotel → bookGround`, each compensation
pushed onto a stack only after its forward step succeeds, `disposeOriginal`
last and outside the chain. On any failure the stack unwinds LIFO
(`cancelGround → cancelHotel → voidFlight → releaseVAN`). This is exercised
by a real Temporal test-server run in
`zkd-execute/src/workflows/recoverySaga.test.ts` — not a mock of the
ordering logic, the actual workflow engine running the actual workflow, with
a failure injected at each step to prove the correct subset of compensations
runs and `disposeOriginal` never fires on a rollback.

The workflow's `workflowId` **is** the idempotency key
(`zkd-shared/src/idempotency.ts`, derived from `(pnr, segment, memberId,
intent)`), started with Temporal's own duplicate-rejection — this is what
makes "a retry after escalation mints a new key and books the leg twice"
(03-action-policy.md §6) structurally impossible rather than a rule someone
has to remember to enforce.

## The policy gate, for real

`policy/execute.rego` is the actual default-deny gate — one `deny` rule per
row of 03-action-policy.md §5, `allow` true only when `deny` is empty. Tested
with OPA's own native test runner (`policy/execute_test.rego`, `opa test
policy/`), which is how a real gap got caught during this build: Rego's
comparisons are *undefined*, not *false*, when a field is missing, so an
empty or malformed input silently produced `allow = true` until a
`malformed_input` rule was added specifically to close that. Every mutating
Temporal activity calls this gate — via the local OPA sidecar, fail-closed if
unreachable (`zkd-shared/src/opaClient.ts`) — immediately before it touches a
supplier. PLAN's own call to the same client is a cheap early filter; it is
never the enforcement point.

## The planning graph, for real

`zkd-app/server/engine/planningGraph.ts` is a compiled LangGraph.js
`StateGraph`: `classify → flightSpecialist → hotelSpecialist →
groundSpecialist → supervisor`. Every node reads `Flight.candidates` (already
fetched, off the critical path, by `altsCache.ts`/`groundCache.ts`) and
returns a pick — none of them is given a write tool, because there is no
write-capable code importable from this package at all. `classify` reuses
`lib/disruptionKind.ts`'s existing classification (cancellation / reschedule
survives / reschedule breaks / delay-cascade / diversion), so a reschedule
the connection survives correctly proposes no new seat, only a hotel/ground
re-timing — the §2.1 table, enforced by the graph's own control flow.

## What is still a proposal, not a running system

- **AWS**: `infra/execution-plane/` is real, reviewed Terraform
  (`terraform validate` passes) that has **not** been applied — no ECS
  service, no IAM role, no security group exists in AWS yet. Applying it is
  a separate, explicitly-confirmed step because it spends real money in a
  real account.
- **Persistence**: see `zkd-app/server/domain/README.md` for the Postgres
  migration that replaced the old process-lifetime in-memory store — this is
  what makes `app_desired_count > 1` in `zkd-risk-model/infra/app.tf`
  actually correct rather than silently losing state on whichever task
  didn't handle the last request.
- **Duffel real order booking**: `zkd-execute/src/suppliers/duffelWrite.ts`
  is written against Duffel's documented order API and used automatically
  the moment `DUFFEL_ACCESS_TOKEN` is set — but no key has ever existed in
  this project, so every demo run today exercises the realistic mock
  fallback, not a live sandbox call.
