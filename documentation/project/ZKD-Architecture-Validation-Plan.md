# ZKD Concierge — Architecture Validation & Rewrite


> **PARTIALLY SUPERSEDED — read against the v2.0 agent files, not instead of them.**
>
> The 13 findings below still stand and are still the Q&A rehearsal sheet. **Part 2's
> adaptive SLA does not.** `T_recover` / `T_negotiate` / `T_commit` appear **zero** times
> in the four `*_v2.0.md` files: v2.0 dissolves finding 13 differently — and better — by
> iterating negotiation over **one pre-fetched in-memory candidate set with zero extra
> supplier calls**, so there is no 3-fan-out latency to bound in the first place.
>
> One consequence is easy to miss: Part 2's safety argument, *"the traveller can never end
> worse off: the fallback is already held"*, **does not hold under v2.0**. v2.0's hold gate
> is conditional (`hold_TTL > expected_time_to_announcement` AND the value test), so the
> common case is *no hold at all* — candidates stay warm. Escalation therefore reads
> "confirm the held baseline **where one exists**". Do not repeat the unconditional version
> on stage.

## Context

`ZKD-Concierge-Pitch-India.pptx` (10 slides, Codestreet 2026 / Amex Round 1, Team ZKD, IIT Madras)
is submitted for Phase 1 but the prototype build runs 7–21 Aug with an in-person finale 25 Aug in
Chennai. The deck is strong — sourced claims, correct Pool A arithmetic, the right four primitives
(LIFO saga, OPA default-deny, hold-before-buy, grounding on supplier offer ID). But a system-design
review surfaced 13 defects, two of which attack the deck's own headline claims, plus a scaled-out
design (Celery/Redis/sharding) that contradicts the stack on slide 7 and over-engineers against a
load model the deck itself already sizes correctly.

Deliverable is a single self-contained artifact serving three jobs: (1) the rewritten two-layer
architecture, (2) the newly-specified cross-agent negotiation loop, (3) all 13 findings explained
deeply enough to rehearse Q&A against before 25 Aug.

**Decisions taken (user-confirmed):**
- **Celery is dropped.** Temporal only — one orchestrator, one failure model, one idempotency story.
- **Adaptive SLA.** Negotiation may exceed 60s *only* when it yields realized value within
  user-declared constraints. Baseline safety is secured first.
- **Findings get full treatment** — what the deck says, why it fails, the fix, how a judge attacks it.

---

## Part 1 — Two-layer architecture rewrite

Replaces the slide 5 six-layer diagram's framing. The load-bearing claim is that **authority and
cognition are physically separated**.

### Layer A — Planning & Negotiation (LangGraph supervisor)
Cognitive work only: context assembly (PNR, trip DAG, benefit entitlement), option generation,
cross-supplier negotiation, ranking, explanation.

- Supervisor routes; it never calls a supplier itself.
- Sub-agents (Weather, Flight, Hotel, Ground, Duty-of-Care) are **strict tool-callers** returning
  schema-validated proposals.
- **Zero execution authority, zero spend authority.** No network route to a mutating supplier API.
- MCP tool clients in this layer are **read-only** — search, reshop, price. This clause is what
  makes slide 5's "one edge that deliberately does not exist" survive scrutiny (finding 4).
- Shared state: `TripState { disruption · pnr · consent_tier · constraints · candidates[] ·
  policy_decisions[] · holds[] · confirmed[] · escalation? }`

### Layer B — Durable Execution (Temporal.io)
Sole owner of side effects. Everything that touches inventory or money.

- Executes supplier API calls as Temporal activities; owns retries, backoff, heartbeats, timeouts.
- Registers the compensation **before** each side effect; rolls back LIFO on failure.
- Deterministic idempotency keys per activity, attempt-invariant, derived from
  `(workflowID, activityID)` — closes the at-least-once duplicate-booking hole (finding 5).
- Distinguishes **compensation completed** from **compensation initiated**; async/partial refunds
  route to escalation rather than being drawn as clean no-ops (finding 6).

### Between them — the Control Plane (authority gate)
OPA/Rego PDP, default deny, decision log. Every proposal crosses this boundary or it does not
execute. Run OPA **as a sidecar or in-process library**, not a remote PDP — evaluation drops from
200ms to ~1ms and leaves the critical path (finding 8).

---

## Part 2 — Cross-agent negotiation loop

New capability: Supervisor negotiates between Flight and Hotel agents to align, e.g., a cheaper
flight date against a discounted hotel rate. This is a joint optimization, not two independent
searches.

### Adaptive SLA — "hold the floor, then negotiate for the ceiling"

| Phase | Target | Meaning |
|---|---|---|
| `T_recover` | **P95 < 60s** (unchanged) | A policy-compliant baseline itinerary is **held**. Traveller is already safe. |
| `T_negotiate` | variable, bounded | Hunt a better joint itinerary against the held baseline. |
| `T_commit` | ≤ baseline hold expiry − margin | Hard stop. Confirm winner, release loser. |

The traveller can never end worse off: the fallback is already held. Negotiation is upside-only.
The **negotiation window is bounded by the baseline hold's TTL** — which also resolves finding 7,
since offer expiry becomes the natural hard stop rather than an unstated assumption.

Negotiation budget = `min(user_max_wait, baseline_hold_expiry − margin, hard_cap)`

### Loop constraints (all enforced, all testable)

1. **Max 3 supervisor iterations.** Hard cap.
2. **No cycle without progress.** Progress = joint objective strictly improves by ≥ ε **or** the
   feasible candidate set changes. Otherwise halt immediately, regardless of iterations remaining.
3. **Oscillation guard.** Supervisor keeps a visited-set of proposed
   `(flight_offer_id, hotel_offer_id, date)` tuples. Revisiting a tuple = no progress = halt. This
   is what stops the classic ping-pong (Flight wants D1 → Hotel wants D2 → Flight wants D1).
4. **Value gate.** Continue only if projected improvement clears the user's declared threshold.
5. **Constraints are OPA inputs, not agent preferences.** Hard constraints (arrive before the board
   meeting, max layover, cabin floor, hotel minimum) gate at the policy layer, so a negotiated
   "bargain" that breaks a hard constraint is denied, not ranked lower.
6. **Unroutable states exit to escalation** — never hang, never silently expire.

### Escalation path
No qualifying match after iteration 3 (or on any halt condition) → **confirm the held baseline**,
then hand the negotiation context to Pipeline 04 (Conversational Fallback), pre-loaded so the
traveller never re-explains. Human inherits the full handoff object.

**Rate-limit note:** negotiation must iterate over a **single pre-fetched candidate set** held in
memory, not re-fan-out per iteration. Three live fan-outs would be ~102s and would multiply load
against the ceiling the deck already identifies as binding (finding 3).

---

## Part 3 — Artifact structure

Single self-contained HTML page, dark/light theme-aware, Mermaid rendered natively (no external
libraries — CSP blocks them).

**Sections:**
1. Verdict summary — what holds up, what breaks, severity-ranked
2. Two-layer architecture (Part 1) + diagram
3. End-to-end process flowchart
4. Negotiation loop spec (Part 2) + state-machine diagram + adaptive-SLA timeline
5. All 13 findings, full treatment each
6. The sharding answer (arithmetic + the four-part response if pushed)

**Diagrams (Mermaid):**
| # | Diagram | Purpose |
|---|---|---|
| 1 | Two-layer architecture w/ control plane | Authority separation, the read-only MCP clause |
| 2 | **Whole-process flowchart** | Signal → assembly → generation → baseline hold → negotiation → policy → saga → settle/escalate |
| 3 | Negotiation state machine | 3-iteration cap, progress test, oscillation guard, halt conditions |
| 4 | LIFO saga incl. compensation-failure branch | Fixes the "compensations always succeed" gap |
| 5 | Adaptive SLA timeline | `T_recover` / `T_negotiate` / `T_commit` against hold TTL |
| 6 | Per-route coordinator | Inventory contention under mass-cancellation burst |

---

## Part 4 — The 13 findings

Each written as: what the deck says → why it fails → concrete fix → how a judge attacks it.

| # | Finding | Severity |
|---|---|---|
| 1 | Celery is Python; backend is Node/TS. Temporal already is a durable queue — two orchestrators = two failure models | **Resolved: drop Celery** |
| 2 | Caching supplier **offer IDs** across users breaks bookings — they're single-use and context-bound | Critical |
| 3 | No inventory-contention model. Mass cancellation = N users racing for the same seats, N× rate-limit burn → **per-route coordinator** | Critical |
| 4 | Slide 5 draws the edge it claims doesn't exist (MCP clients in agent layer) → read-only clause | Critical (self-contradiction) |
| 5 | Invariant weaker than stated: at-least-once retry ⇒ two supplier bookings, one compensation. Property test only reads workflow history | Critical |
| 6 | Compensations drawn as always succeeding; `voidFlight` outside window is an async refund, not a void | High |
| 7 | 90s quiet window has no stated relation to offer TTL (~143s exposure vs. unspecified expiry) | High |
| 8 | OPA at 0.2s is ~100× pessimistic — implies remote PDP; sidecar/in-process is ~1ms | Medium (free credibility) |
| 9 | iOS data-only FCM is throttled by Apple; unreliable as "the only thing most users see" | High |
| 10 | Pool B's ~45% capture rate is unshown in a deck whose whole play is "the arithmetic, in full". Also 17.2% is per-flight applied to per-trip (understates Pool A) | High |
| 11 | DPDP Act 2023 absent despite meticulous DGCA grounding — PNR/passport/payment data | Medium |
| 12 | Tier A silence-as-consent vs. RBI AFA → map onto the e-mandate framework, making 90s a recognized pre-debit notification | High |
| 13 | Negotiation loop breaks the 60s P95 (3 live fan-outs ≈ 102s) | **Resolved: adaptive SLA** |

Plus the **RICE rationale** sharpening: P2-alone *is* Lumo, positioned two slides earlier as a
competitor that predicts but never transacts. Building P2 first makes them their own competitor —
a far stronger reason than "we build to order."

---

## Part 5 — The sharding answer

**Don't shard.** Show arithmetic instead: 3 lakh passengers / 72h ≈ 1.2 disruptions/sec. A 6-activity
saga ≈ 50 history events ⇒ **~58 Temporal writes/sec average, ~1,200/sec at 20× burst**. Single
Postgres handles it. Supplier rate limits are the ceiling, exactly as slide 7 says. Also drop the
"gateway manages 1M connections" framing — FCM push means ~zero persistent connections, which is a
cost win worth claiming.

If pushed, four parts:
1. Temporal shards by `workflowID` hash. **`numHistoryShards` is immutable after cluster creation** — pick 512 up front.
2. Split persistence from **visibility** (Elasticsearch/OpenSearch) — "millions of states" is a visibility-query problem.
3. Partition the business DB by **time** (`disruption_date`), not user — access is time-clustered, rows cold in 72h, detach partitions cheaply.
4. **Archival** to object storage for closed workflows is the actual scaling lever.

Keep the **decision ledger out of the hot store** — append-only, audit-read, belongs on the existing event bus → BigQuery path.

---

## Execution notes

- Load the `artifact-design` skill before writing the page (required by the Artifact tool).
- Write to `C:\Users\HPW\.claude\jobs\db34f55d\tmp\zkd-architecture-review.html`, then publish via Artifact.
- Self-contained only: inline all CSS/JS, no external fonts or CDN. Mermaid via `<pre class="mermaid">`.
- Theme-aware: `@media (prefers-color-scheme: dark)` **plus** `:root[data-theme=...]` overrides.
- Wide tables and diagrams get their own `overflow-x: auto` container; page body must not scroll horizontally.
- **Do not modify the .pptx.** Copy `(2)` is open in PowerPoint (`~$` lock file present). Deck edits
  are a separate, later decision.

## Verification

1. Publish and open the artifact URL; confirm all 6 Mermaid diagrams render (no raw fence text).
2. Toggle light/dark — confirm both themes are legible, including diagram text.
3. Narrow the viewport to ~380px — confirm no horizontal body scroll; tables/diagrams scroll internally.
4. Re-check the arithmetic rendered on the page against the deck: Pool A `3,612 × $11.66 = $42,116`;
   Temporal `300,000 × 50 / 259,200 ≈ 58 writes/sec`; Pool B implied capture `₹8.7cr ÷ (17,200 × ₹11,300) ≈ 45%`.
5. Confirm every one of the 13 findings has all four parts (claim → failure → fix → attack).
6. Confirm the flowchart's escalation path has no terminal state that hangs — every branch reaches
   confirm, escalate, or rollback.
