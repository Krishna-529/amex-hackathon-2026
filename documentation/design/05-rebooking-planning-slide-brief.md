# Page 7 Brief — Rebooking & Planning (Stage 04)

Source material for redesigning **Page 7** of `ZKD_Concierge_Deck_1.pptx`. Everything below is
grounded in the actual repo (`zkd-app/`, `amex-travel-disruption-concierge/`,
`documentation/design/*.md`, `documentation/agent-specs/current/*.md`) as of commit `1d52a8d`
("Remove speculative holds; add refresh loop, bundles, reissue, policy gate"), the current tip of
branch `no-holds-refresh-reissue`. Nothing here is invented — every claim is traceable to a file.

**Current Page 7 text** (for reference — this is what exists today and what we're replacing/upgrading):

> STAGE 04 — Rebooking & Planning (Before Anything Is Booked)
> "A reversible planning engine that builds the best recovery bundle — flight, hotel, and ground —
> without locking in seats or spending a rupee."
> Flight Search · Hotel Search · Ground Transfer · Member Profile
> How it works: 1. Search & Refresh 2. Build Connections 3. Apply Rules 4. Scoring & Ranking
> 5. Overnight & Ground 6. Hold for Consent

⚠️ Note item 6, "Hold for Consent" — this is **stale**. The most recent commit on this branch
explicitly removed the "hold" model (see §0 below). The new slide should not say "hold."

---

## 0. The one fact that must shape this slide

The repo contains **two architectures side by side**, and the current commit message is explicit
about why:

> "A passenger cannot hold two flight tickets, so a speculative hold on a replacement seat is a
> duplicate booking that carriers' auditors cancel — sometimes cancelling the original. Most
> Indian LCCs offer no free hold at all. The hold gate is dead, everywhere: flights, hotels and
> ground alike."

1. **The live, clickable demo** — `server/engine/simulation.ts` and friends. This is what runs
   when you click through the app. It uses pre-seeded candidate lists, narrates a decide→act
   sequence with realistic pacing, and is the thing a reviewer will actually see on screen.
2. **The target architecture** — `lib/bundle.ts`, `lib/ranking.ts`, `server/policy/index.ts`,
   `lib/refreshCadence.ts`, `server/suppliers/sandbox.ts`'s write-plane (`reissue`,
   `bookReplacement`, `voidTicket`). This is **fully implemented and unit-tested** (79 new tests
   per the commit message: `tests/bundle.test.ts`, `tests/ranking.test.ts`, `tests/policy.test.ts`,
   `tests/refreshCadence.test.ts`) but **not yet called from any live request path** — it is
   built, correct, and sitting next to the demo rather than inside it.

**Recommendation for the slide**: describe the target architecture (it's real code, it's tested,
it's the actual design) but do not claim it is "live" if asked a pointed technical question —
the honest framing is "engine built and proven; wiring into the demo path is the next integration
step." The deck's Stage 04 copy already describes the target architecture correctly (bundles,
scoring/ranking, no holds) — that instinct was right. This brief gives you the precise mechanics
under each of those bullets.

---

## 1. INPUT — what enters the rebooking/planning pipeline

| Input | Source | File |
|---|---|---|
| Disruption signal (cancellation confirmed / reschedule / delay-cascade / diversion) | Live AviationStack status vs. the member's originally *booked* time (not just delay-minutes, because a carrier that reschedules also resets its own delay baseline) | `server/aviationstack.ts`, `lib/disruptionKind.ts` |
| Disruption-probability forecast | Lumo (thinklumo.com) — a **bought**, not built, vendor model; `cancelProbability`, `delayBuckets`, `connectionRisk`, `confidence`, always tagged `source: 'lumo'\|'mock'` | `server/lumo.ts`, `server/engine/forecast.ts` |
| Itinerary / hard constraints | Booked flight(s), multi-leg itinerary linkage (e.g. MAA→DEL→LHR as two bookings under one itinerary), `connectionSlackMinutes`, `hasHardConstraint` flag | `server/domain/types.ts` |
| Member profile & entitlement | **MyCa** (the Amex card-member app) — cabin entitlement, per-transaction spend cap, preferred carriers, payment instrument reference. ZKD stores **no local copy** — MyCa is kept as the system of record | `server/myca.ts` |
| Consent tier | Member-set `autopilot` vs `ask` | `Passenger.consent`, settable via `PATCH /api/passengers/[id]` |
| Standing pre-authorization (optional) | A conditional, *specific* advance approval tied to one exact alt/hotel/cab combination — void the instant any one of those three no longer matches what the member actually saw | `PreAuthRecord`, `POST /api/flights/[id]/preauth` |
| Live flight inventory | Parallel fan-out across Duffel (real sandbox, book+cancel), Sabre (auth-only, empty), Travelport (synthetic mock) — each source degrades independently, a dead source doesn't fail the search | `server/suppliers/{duffel,sabre,travelport}.ts`, `server/suppliers/index.ts` |
| Live hotel inventory | LiteAPI/Nuitee sandbox — city+dates → rated offers, currency/nationality resolved from MyCa, not hardcoded | `server/liteapi.ts` |
| Duty-of-care jurisdiction | Resolved from a 6,072-airport OpenFlights dataset: `IN-DGCA` / `EU261` / `CARD-TERMS` fallback | `server/airportDirectory.ts`, `lib/entitlement.ts` |
| Member's live in-flow decisions | `approve`, `browse`, `back`, `choose(altId)`, `swap-hotel`, `swap-cab`, `hand-over` | `server/engine/simulation.ts` (`ResolveAction`) |

**One-line summary for the slide**: *the pipeline reads the disruption signal, the bought risk
forecast, the member's own MyCa entitlements, live multi-supplier inventory, and the itinerary's
hard constraints — never assumes, always pulls from the system of record.*

---

## 2. FLOW / PIPELINE — step by step

### Stage boundary: where Rebooking & Planning picks up
Detection (Stage 01–03 of the deck) hands off a confirmed or high-probability disruption. From
here:

```
Disruption confirmed / risk crosses threshold
        │
        ▼
┌───────────────────────────────────────────┐
│ 1. SEARCH & REFRESH                        │  Fan out to Duffel / Sabre / Travelport
│    (parallel, degrade-independent)         │  (+ sandbox coupon inventory when enabled)
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│ 2. BUILD CONNECTIONS / BUNDLE              │  lib/bundle.ts — flight is the anchor;
│    Anchor = flight. Stay derives from      │  stay/ground are DERIVED, not searched
│    arrival + 60min transfer. Ground        │  independently ("a hotel task without a
│    derives from both.                      │  flight_offer_id is malformed")
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│ 3. APPLY RULES (Policy Gate)               │  server/policy/index.ts — 12 default-deny
│    Cabin ceiling, fare cap, travel window, │  rules; every candidate must get an
│    duplicate-ticket check, onward-leg      │  explicit ALLOW; missing inputs = deny
│    protection, bundle coherence            │
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│ 4. SCORING & RANKING                       │  lib/ranking.ts — net economic cost
│    Materiality gate → net-economic-cost    │  (not member-visible cost) drives the
│    ordering → reversibility tiebreak       │  sort, so a hidden cost can't win
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│ 5. OVERNIGHT & GROUND                      │  If the delay/reroute spans an overnight
│    Hotel + ground added only if the        │  window, duty-of-care entitlement covers
│    itinerary genuinely requires it         │  it (lib/entitlement.ts jurisdiction bundle)
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│ 6. KEEP FRESH, NEVER HOLD                  │  lib/refreshCadence.ts — re-shop on a
│    (replaces the old "hold" step)          │  derived interval per component/band;
│                                             │  nothing is held, nothing is spent
└───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│ 7. CONSENT WINDOW → MEMBER DECISION        │  lib/confirmWindow.ts — a derived,
│    (Stage 05 of the deck picks up here)    │  bounded window; revalidated at the
│                                             │  instant of approval before any spend
└───────────────────────────────────────────┘
```

### Key modules and what each owns

| Module | Owns | Status |
|---|---|---|
| `server/engine/forecast.ts` | Fetches Lumo forecast + inventory in parallel, computes adaptive thresholds, caches per-flight (10 min TTL), dedupes concurrent callers | **Live** |
| `lib/thresholds.ts` | Adaptive `prepare / ready / pre-authorise` risk bands per flight (see §3.1) | **Live** |
| `lib/confirmWindow.ts` | Derives the member's decision window from the offer's own price-guarantee expiry, capped 2–20 min | **Live** |
| `server/engine/simulation.ts` | Orchestrates detect → decide → (ask) → act, per passenger, with real server-side timers | **Live** (drives the demo) |
| `lib/bundle.ts` | Anchored flight+hotel+ground composition; coherence as a hard constraint; repair hierarchy on staleness | **Built, tested, not yet wired into the live path** |
| `lib/ranking.ts` | Net-economic-cost ordering, reversibility tiebreak | **Built, tested, not yet wired into the live path** |
| `server/policy/index.ts` | 12-rule default-deny policy gate, in-process, memoized, every decision reaches the ledger | **Built, tested, not yet wired into the live path** |
| `lib/refreshCadence.ts` | Per-component, per-band re-shop interval (replaces holds) | **Built, tested, not yet wired into the live path** |
| `server/suppliers/sandbox.ts` | The only write-capable supplier adapter: reissue / book-replacement / void / claim-credit, with idempotent business-key writes and duplicate-ticket refusal | **Built, tested, not yet wired into the live path** |
| `lib/entitlement.ts` | Jurisdiction-based duty-of-care bundle (what's owed, after how long, hotel/meal/cash rules) | **Live** |
| `server/domain/outcome.ts` | Four-state terminal taxonomy (`CONFIRMED / ESCALATED / ROLLED_BACK / RELEASED`) with per-component partial-success reporting | **Built, tested, not yet wired into the live path** |

### Relevant API surface (`zkd-app/app/api/*`)

| Endpoint | Purpose |
|---|---|
| `POST /api/disruptions` | Triggers `detectDisruption()` — entry point of the whole recovery flow |
| `POST /api/disruptions/[flightId]/consent` | Member actions: approve / browse / back / choose / swap-hotel / swap-cab / hand-over |
| `GET /api/flight-status` | Live AviationStack status → `classify()` disruption kind |
| `GET /api/alts` | Live-ranked flight alternatives against MyCa entitlement (cabin ceiling, spend cap, currency) |
| `GET /api/hotels` | LiteAPI hotel search |
| `GET /api/care` | Duty-of-care entitlement lookup by delay-hours/overnight/force-majeure |
| `POST /api/flights/[id]/preauth` | Records a standing conditional pre-authorization |
| `PATCH /api/passengers/[id]` | Sets consent tier (`autopilot` / `ask`) |
| `POST /api/explain` | One-shot Gemini call for a plain-language explanation of a risk score or a rebooking pick (cosmetic only — never on the decision path) |

---

## 3. APPROACH — the actual decision logic

### 3.1 Adaptive thresholds decide *when* to act (`lib/thresholds.ts`)
Instead of one fixed cancellation-probability cutoff, three bands (`prepare`/`ready`/
`pre-authorise`) are computed **per flight**:

```
shift = (scarcity × urgency × criticality) / confidence
band  = clamp(BASE_band × shift, FLOOR_band, CEILING_band)
```
- **Scarcity** — fewer seats per party pushes the trigger earlier.
- **Urgency** — closer to departure, the system acts on less certainty.
- **Criticality** — a flight with a hard downstream constraint (e.g. a connection) gets a *lower*
  threshold — more to lose, so it acts sooner.
- **Confidence** — a *less* confident forecast must clear a *higher* bar (it divides the shift).

### 3.2 Bundle generation is anchored, not a cross-product (`lib/bundle.ts`)
The design explicitly rejects combinatorial explosion: "eight flights, twelve hotels and six cabs
is 576 combinations — neither affordable nor necessary." Instead:
- The **flight is the anchor**.
- The **stay derives** from the chosen flight's arrival time + a 60-minute transfer buffer.
- **Ground derives** from both flight and stay.
- **Coherence is a hard constraint, not a ranking term** — a bundle where the hotel check-in
  predates the flight's actual arrival, or seats/rooms are short, is rejected outright, not
  scored down.
- A **repair hierarchy** means most breaks don't discard the whole bundle: if the flight is
  simply retimed, only the derived windows are recomputed; if the hotel falls through, only the
  stay is re-derived; only a fully cancelled flight forces a full rebuild.

### 3.3 Rules — the policy gate (`server/policy/index.ts`)
**Default-deny.** Twelve named rules run in full (not short-circuited) on every candidate; any
denial blocks that candidate. The most notable rules:
- **`voluntary_under_autopilot`** — if the original flight actually operated and the member is
  choosing to move, autopilot cannot silently authorize it (the member would be the one paying).
- **`fare_class_ceiling`** / **`fare_delta_cap`** — never moves a member above their entitled
  cabin, never spends past their cap.
- **`duplicate_ticket`** — refuses a fresh purchase if the member already holds an overlapping
  active coupon — "the rule that killed the speculative hold, enforced at the gate."
- **`onward_leg_unprotected`** — catches a broken connection *before* spend, not after.
- **`incoherent_bundle`** — delegates straight to `lib/bundle.ts`'s coherence check.
- **`incomplete_policy_inputs`** — missing data is treated as a **denial**, never as implicit
  permission.

Every evaluation — including a cache hit — is written to the decision ledger, so there is no gap
in the audit trail.

### 3.4 Scoring & ranking — net economic cost, not sticker price (`lib/ranking.ts`)
The core design insight: never rank on what the member *sees*. A carrier-caused reissue costs the
member nothing and also *shows* nothing; a card-fronted fresh purchase can also show "0" up front
— but someone bears the real cost. So two figures are tracked separately:
- **`memberVisible`** — what shows on the member's decision screen.
- **`netEconomic`** — the true unrecovered cost (e.g. a fronted purchase's cost net of the
  carrier's historical recovery rate).

Ranking order:
1. **Materiality gate first** — if the arrival-time gap is large enough to matter (e.g. breaks a
   connection), time alone decides. A free seat that lands after the connection is gone is not a
   bargain.
2. Otherwise, **net economic cost** dominates the sort.
3. Ties break on **reversibility** (cheaper-to-undo wins).
4. Final tie breaks on **freshness** (more recently revalidated wins).

This deliberately prevents a scenario the tests specifically check: a free reissue must always
outrank a "shows-as-free" fronted purchase, because the fronted one is carrying real unrecovered
cost even though the member can't see it.

### 3.5 Keeping options alive without holding them (`lib/refreshCadence.ts`)
Since no seat can be held, the pipeline instead **re-shops on a derived cadence** — tighter as
risk rises:
- Flights: every 30–60 min at `prepare`, 5–15 min at `ready`, 2–5 min at `pre-authorise`.
- Hotels: refresh far more slowly than flights in the same band.
- Ground: never stood-up on a standing refresh — quoted fresh at the moment a bundle is actually
  assembled.

### 3.6 Revalidate at the very last moment before spend
Immediately before any booking action commits, the exact chosen offer is re-checked against the
live supplier. If it's gone, the pipeline falls through to the next policy-approved candidate and
narrates the substitution — "what the member consented to was the outcome, not one specific seat."

---

## 4. OUTPUT — what the pipeline produces

- **A ranked, policy-approved recovery bundle** — flight (+ derived hotel/ground where the delay
  spans overnight), each carrying its net economic cost, member-visible cost, and reversibility.
- **A consent-bound decision window** — derived from the chosen offer's own price-guarantee
  expiry, floor 2 minutes / ceiling 20 minutes; if the window would fall below the floor, the
  system decides on its own (autopilot, or — even under "ask" — if the plan costs the member
  nothing).
- **Automated action** when: a valid, still-intact pre-authorization exists; or the window expires
  unanswered under autopilot; or the window expires unanswered and the plan is free.
- **A held-for-approval action** when the plan would cost the member money and they haven't
  responded — nothing is booked, nothing is charged, and the member is handed to a follow-up
  channel (this becomes Stage 05, the Notification & Consent Ladder).
- **A four-state terminal outcome** (`CONFIRMED / ESCALATED / ROLLED_BACK / RELEASED`) — with a
  hard rule that a *partial* success after an irreversible step already happened is always
  escalated, never quietly reported as a plain error.
- **Communicated downstream**: single-use virtual card payment locked to an exact amount and
  date; the original ticket disposed **last** and only after the replacement is confirmed
  (deliberately outside any rollback chain, since "a cancellation has no inverse"); a
  member-facing "was → now" diff across flight/hotel/ground/PNR; and a plain-language
  explanation of the pick (via a one-shot Gemini call, cosmetic only, never on the decision path).

---

## 5. SLIDE-WORTHY NARRATIVE — Page 7

### The story in one sentence
*"Before a single seat, room, or ride is booked, ZKD assembles a coherent, policy-checked,
ranked recovery plan — flight, hotel, and ground as one bundle — kept fresh instead of held,
ready the instant the member says go."*

### Why this is the differentiator (what to emphasize)
1. **Reversible by design, not by accident.** The system explicitly rejected the industry-typical
   "hold a fallback seat" pattern because carriers cancel duplicate holds — sometimes cancelling
   the original ticket too. Nothing is committed until consent.
2. **Bundle coherence is a hard gate, not a nice-to-have.** A hotel check-in before the flight
   even lands, or a cab that can't reach the airport in time, is never presented as an option —
   it's rejected structurally, before ranking even runs.
3. **Cost-aware ranking that can't be gamed by hiding cost.** Net economic cost (what actually
   gets spent, by whoever pays) — never the number shown to the member — drives the sort, so a
   "shows as free" option can never silently beat a genuinely free one.
4. **A real default-deny policy gate, not a checklist.** Twelve explicit rules, every candidate
   evaluated, missing data treated as a denial, every decision — cache hit or not — logged.
5. **Adaptive urgency.** The system doesn't wait for certainty; it acts earlier when seats are
   scarce, departure is close, or a connection is at stake — and later when the forecast itself
   is less confident.

### Suggested slide structure (inputs → processing → outputs)

**Left column — INPUT**
- Disruption signal (confirmed / predicted)
- Live flight, hotel & ground inventory (multi-supplier)
- Member profile & entitlement (from MyCa)
- Itinerary & hard constraints (connections, timing)

**Center — PROCESSING / DECISION FLOW** (a simple 4–5 step horizontal flow, matching the current
deck's "HOW IT WORKS" numbered format but updated):
1. Search & Refresh across suppliers
2. Build the Bundle (flight-anchored, hotel & ground derived)
3. Apply the Policy Gate (default-deny rules)
4. Rank by real cost, not sticker price
5. Keep it fresh — never held, re-validated at the last moment

**Right column — OUTPUT**
- One ranked, policy-approved bundle, ready for consent
- Nothing booked, nothing spent, nothing held
- Automatic action only when it's free or pre-authorized
- Full plan handed to Stage 05 (Notification & Consent Ladder)

### What to leave out (avoid clutter)
- The exact rule names/count of the policy gate (12 rules) — say "a strict, default-deny policy
  check," not the enumerated list.
- The net-economic-cost vs. member-visible-cost distinction in formula form — say "ranks by real
  cost, not just what's shown," not the underlying math.
- Implementation status caveats (live vs. built-but-unwired) — that's an engineering detail for
  Q&A, not slide copy. If asked directly in Q&A: "the ranking, policy gate, and refresh-cadence
  engine are built and fully tested; the live demo currently runs the underlying decision timeline
  narratively while that engine is wired in as the next integration step."

### Suggested visual
A simple three-zone horizontal diagram: **Inputs** (four small icons/labels: disruption signal,
inventory, member profile, itinerary) → **Processing** (a short numbered pipeline of 4–5 steps,
visually distinct as "the engine") → **Output** (one bundle card showing flight+hotel+ground with
a "held for consent, nothing spent" badge). This mirrors the existing deck's visual language
(Stage 04's current three-column-plus-numbered-list layout) while replacing "Hold for Consent"
with something like "Ready — Not Yet Spent" to match the corrected no-holds model.

---

## Appendix — file references used in this brief

```
zkd-app/lib/bundle.ts             zkd-app/lib/ranking.ts            zkd-app/lib/refreshCadence.ts
zkd-app/lib/thresholds.ts         zkd-app/lib/confirmWindow.ts      zkd-app/lib/entitlement.ts
zkd-app/lib/disruptionKind.ts     zkd-app/lib/recovery.ts           zkd-app/lib/outcome.ts
zkd-app/server/policy/index.ts    zkd-app/server/domain/outcome.ts  zkd-app/server/domain/types.ts
zkd-app/server/engine/forecast.ts zkd-app/server/engine/simulation.ts
zkd-app/server/suppliers/{index,duffel,sabre,travelport,sandbox}.ts
zkd-app/server/{lumo,myca,liteapi,aviationstack,gemini,airportDirectory}.ts
zkd-app/server/ledger/reconciliation.ts
zkd-app/app/api/{disruptions,alts,hotels,care,flight-status,explain}/**, app/api/flights/[id]/preauth
documentation/design/{01-prediction-model,02-data-sources-and-apis,03-action-policy}.md
documentation/agent-specs/current/zkd_{flight_reshop,hotel_reaccommodation,ground_transfer,supervisor_negotiator}_agent_v2.0.md
git commit 1d52a8d (branch tip, no-holds-refresh-reissue)
```
