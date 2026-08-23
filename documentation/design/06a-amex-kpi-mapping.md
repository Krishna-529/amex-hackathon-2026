# 06a · Mapping granular KPIs to Amex's three target metrics

**Companion to [`06-experience-kpis.md`](06-experience-kpis.md).** That document defines the 20
granular, mechanically-measurable KPIs and is the source of truth for status and evidence. This
document does one additional thing: maps those same 20 KPIs onto the three macro-outcomes Amex
actually targets — **engagement, satisfaction, experience** — so it's visible which granular
metric ladders into which business-level bucket, and which bucket is weakest today.

Nothing here redefines a KPI or changes its status. Statuses (`EXISTS` / `PARTIAL` / `PENDING` /
`BLOCKED` / `ABSENT`) and the code symbols they come from are inherited unchanged from
`06-experience-kpis.md` §A–E. This is a re-grouping for a different audience, not a new
instrument.

---

## Why a second grouping, when `06` already groups by ladder

`06-experience-kpis.md` groups by *mechanism* — Speed, Effort, Outcome quality, Trust, Loyalty —
because that's what tells an engineer where to instrument next. It deliberately does not group by
Amex's own vocabulary, because a judge or sponsor doesn't think in terms of `journal.ts` timings —
they think in terms of engagement, satisfaction, experience. Same 20 KPIs, organized by which
of those three each one actually moves.

**No new KPI is introduced here, and no composite score is either** — the same objection `06`
raises against a single "experience index" applies to any single "Amex score." Keeping the three
buckets separate is the point: a strong engagement number can sit next to a weak satisfaction
number, and collapsing them would hide that.

---

## → Engagement — do they keep letting us handle it, and how deeply

| KPI | Status | Why it's an engagement signal |
|---|---|---|
| **E1 Repeat usage** | `PARTIAL` | Direct definition of engagement — how often the member lets the concierge run versus bailing to the airline or call centre, across their disruptions. |
| **E2 Autopilot opt-in rate** | `EXISTS` | The strongest revealed-preference signal available: moving to autopilot means trusting the system *unsupervised* — deeper engagement than any survey answer could show. |
| **E3 Preference set rate** | `PENDING` | A member who configures preferences is investing in future use — an intent-to-return signal, measurable before a second disruption ever happens. |
| **A4 Pre-emptive share** | `PARTIAL` | Engagement with the *predictive* layer specifically. Proves the warm path — not just the reactive path — is doing work, which is the product's actual differentiator over a call centre. |

## → Satisfaction — did it feel good, or did it feel like a fight

| KPI | Status | Why it's a satisfaction signal |
|---|---|---|
| **E4 Post-recovery CSAT / NPS** | `ABSENT` | The only *direct* ask in the whole set. Everything else here is inferred from behaviour — this is the sole place a member could say "that was handled badly" in their own words, and today nothing captures it. |
| **C2 Refinement rate** | `PENDING` | "The member had to tell us what they actually needed" — the most direct *behavioural* dissatisfaction proxy, and it arrives with free text explaining why. |
| **B2 Hand-off rate** | `EXISTS` | "I'll take it from here" is a vote of no confidence mid-recovery, fully measurable today via `DisruptionResolution.kind === 'handed-over'`. |
| **C6 Member out of pocket** | `EXISTS` | Financial stress during an already-stressful event undermines satisfaction even when the rebooking itself succeeded. |
| **D1 / D2 Prediction accuracy / false-alarm rate** | `BLOCKED` | A wrong warning (cried wolf) or a missed one erodes trust going into the *next* disruption — satisfaction has memory across events, not just within one. |

## → Experience — the lived quality of the recovery itself

| KPI | Status | Why it's an experience signal |
|---|---|---|
| **A1 Detection lead time** | `ABSENT` | The single number separating "we told you" from "you found out at the gate." Marked in `06` as the most important metric the project doesn't have yet. |
| **A2 / A3 Time to plan ready / confirmed** | `EXISTS` | Raw speed of the recovery — the ~11s the Round 1 deck leads with. |
| **B3 / B4 Decisions required / effort minutes** | `PARTIAL` | Effort is inversely proportional to premium-service feel — a concierge that asks less of the member is doing its job better. |
| **C1 Plan acceptance rate** | `EXISTS` | Did the first thing offered actually fit, without a fight. |
| **C3 Options rejected before acceptance** | `EXISTS` | How much friction preceded a yes — a proxy for ranking quality. |
| **C4 Excluded-by-own-policy rate** | `PENDING` | Distinguishes "nothing was available" from "your own settings emptied the list" — the same member-visible outcome, a very different fix. |
| **C5 Party kept together** | `EXISTS` | A family split across two flights is a bad experience even if both flights land on time. |

---

## The biggest gap against each of Amex's three targets

1. **Satisfaction has no direct measurement at all.** E4 (CSAT/NPS) is `ABSENT`. Every
   satisfaction-related signal today is inferred (hand-offs, refinements) rather than asked.
2. **Engagement's clean cross-time signal is only `PARTIAL`.** E1 (repeat usage) is recorded
   per-recovery, but not as a durable event log — so "how many times has this member chosen us"
   is not yet actually countable across members and time.
3. **Experience's headline number is `ABSENT`.** A1 (detection lead time) can't be computed until
   real detection exists — today it's a human clicking `/ops`, so every downstream speed metric
   starts from an arbitrary clock.

These three map directly onto `06-experience-kpis.md`'s own "What to instrument first" list
(items 5, 3, and 2, respectively) — so the priority order that document already recommends is
also the priority order for closing the weakest of Amex's three target buckets.

## What this document deliberately does not do

Same discipline as `06-experience-kpis.md`, restated for this grouping:

- **No target values.** No baseline exists for any KPI in the set; targets follow the first month
  of real measurement, not this document.
- **No composite "Amex score."** Rolling engagement, satisfaction and experience into one number
  would hide exactly which bucket is weak — which is the reason this mapping exists as three
  separate tables rather than one.
- **No revenue-adjacent metric**, for the same reason `06` excludes them: this project optimises
  customer experience only, and a metric that improves when the member spends more is
  disqualified on principle.
