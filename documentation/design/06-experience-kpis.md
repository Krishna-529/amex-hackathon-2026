# 06 · Experience KPIs

**How this project is measured.** Granular operational measures that compose into whether a
disrupted member had a good time or a bad one.

See also: [`06a-amex-kpi-mapping.md`](06a-amex-kpi-mapping.md) maps these same 20 KPIs onto Amex's
own engagement/satisfaction/experience vocabulary, and
[`09-problem-scale-and-incidents.md`](09-problem-scale-and-incidents.md) is the real-world evidence
for why the gaps below (particularly A1 and E4) matter at all.

---

## The objective, stated once

**Customer experience is the only thing this system optimises for.** Not incremental spend, not
attachment rate, not commercial upside. No KPI in this document is a revenue proxy, and none may
be added later — a metric that improves when the member spends more is disqualified here on
principle, however it is dressed up.

Running cost is tracked, in [`04-infrastructure-and-cost.md`](04-infrastructure-and-cost.md), as a
**constraint we work within** — the budget that decides whether a design is affordable. It is
never a goal, and it never trades against the member.

Mandated in mentor meeting 2, [`../project/mentor-meetings.md`](../project/mentor-meetings.md).

## Why granular

"Member satisfaction" is not measurable at the moment it is produced, and by the time a survey
comes back the recovery is weeks gone. What *is* measurable, in the moment, are the small things
that make a recovery feel handled or feel like a fight: how long the member waited, how much work
we made them do, how often they had to correct us, whether they trusted us enough to come back.

So the KPIs below are deliberately small and mechanical. Each one ladders into satisfaction, and
each one names the thing that would have to be instrumented to get it.

## How to read the status column

| Status | Meaning |
|---|---|
| `EXISTS` | The data is on `main` today. The named symbol is where it comes from. |
| `PENDING` | Implemented on the unmerged `worktree-preference-refinement` branch. Becomes `EXISTS` when that lands. |
| `PARTIAL` | Some of it exists; the gap is stated. |
| `BLOCKED` | Cannot be computed, and the specific reason why. |
| `ABSENT` | Nothing in the system produces this. |

Statuses are stated against `main`, not against any working branch — a KPI that is only measurable
on somebody's laptop is not measurable.

Numbers carry the project's standard evidence tiers — `verified` · `calc` · `sim` · `assumed` ·
`budget` · `deck` — defined in the agent specs. **This document sets no target values.** Targets
are set once a baseline exists; inventing them first is how a KPI becomes decoration.

---

## A. Speed — how long the member was in trouble

| # | KPI | Definition | Status |
|---|---|---|---|
| A1 | **Detection lead time** | Minutes between the cancellation becoming knowable and us knowing it. Negative when we knew before the member did. | `ABSENT` |
| A2 | **Time to plan ready** | Detection → a ranked, policy-checked plan waiting at the consent gate. | `EXISTS` |
| A3 | **Time to confirmed** | Consent → everything booked and verified. | `EXISTS` |
| A4 | **Pre-emptive share** | Share of recoveries where the warm path ran *before* the cancellation, not after. | `PARTIAL` |

**A1** is the meeting's detection gap expressed as a number, and it is the single most important
metric this project does not have. Today it is undefined, because detection is a human clicking
`/ops` — `detectDisruption` has one production caller and there is no poller in
`zkd-app/server/`. Until a status feed exists (see
[`02-data-sources-and-apis.md`](02-data-sources-and-apis.md)), every other speed metric starts
from an arbitrary clock.

**A2/A3** come from `timings()` in `zkd-app/server/pipeline/journal.ts`, which returns
`decideSeconds` and `actSeconds` measured from the run's own journal — real elapsed time, not the
budgeted constants the UI displays beside them.

**A4** is the "last-minute versus pre-booked" measure from the meeting. The warm path exists (the
prepare route, the pre-auth record, the threshold-gated alt pre-cache) but nothing currently
records, per recovery, whether warming had completed when the disruption landed. The pipeline
journal is the natural place to derive it.

## B. Member effort — how much work we made them do

| # | KPI | Definition | Status |
|---|---|---|---|
| B1 | **Baseline call handling time** | Average minutes a member spends on the phone to resolve a disruption under *today's* process. | `ABSENT` — external |
| B2 | **Hand-off rate** | Share of recoveries the member took over rather than let us finish. | `EXISTS` |
| B3 | **Decisions required** | Count of choices put to the member per recovery. | `PARTIAL` |
| B4 | **Member effort minutes** | Wall-clock time the member spent interacting, in-app. | `PARTIAL` |

**B1 and B2 are deliberately two KPIs, not one.** They answer different questions and must not be
merged.

B1 is the **external baseline** — the thing this project exists to reduce. It belongs to Amex's
current operation, not to our system, and no amount of instrumentation on our side will produce
it. **We do not have this number.** It is requested from the Amex side and carries tier `assumed`
with no value until supplied. Writing a plausible figure here would be inventing our own success
criterion.

B2 is the **in-product signal** — `DisruptionResolution.kind === 'handed-over'` in
`zkd-app/server/domain/types.ts`, set whenever the member says *"I'll take it from here"*, or
whenever the system stops safely and hands back. It is a proxy for "the automation was not enough
this time" and is fully measurable today. Its value is in what precedes it: pairing the hand-off
with the run's journal shows *which* step lost the member.

B3 and B4 are partial because the consent gate and the choosing view are instrumented for
*outcome* but not for *interaction count* — the number of taps, or how long the member sat on the
choosing screen, is not recorded.

## C. Outcome quality — was the plan any good

| # | KPI | Definition | Status |
|---|---|---|---|
| C1 | **Plan acceptance rate** | Recoveries resolved as `approved` or `autopilot`, over all resolved. | `EXISTS` |
| C2 | **Refinement rate** | Share of recoveries where the member had to tell us what they actually needed. | `PENDING` |
| C3 | **Options rejected before acceptance** | How many alternatives the member said no to first. | `EXISTS` |
| C4 | **Excluded-by-own-policy rate** | Options removed by the member's own standing rules rather than by availability. | `PENDING` |
| C5 | **Party kept together** | Share of recoveries where the whole booking travelled on one alternative. | `EXISTS` |
| C6 | **Member out of pocket** | What the member actually paid, per recovery. | `EXISTS` |

**C2 is the most direct dissatisfaction signal in the set.** A refinement is the member saying, in
their own words, that our ranked list did not fit their life. A rising refinement rate means the
standing preference model is wrong, and the free text itself says how.

C2, C4 and E3 are `PENDING` together: all three depend on the free-text refinement action, the
recorded exclusion list and the stored optimisation strategy, which live on the unmerged
`worktree-preference-refinement` branch. None needs new instrumentation once that lands — the
signals are already recorded there.

**C4 matters because it separates two failures that look identical to a member**: "there was
nothing available" and "your own settings excluded everything". The hard-rules filter has always
computed which rule removed which option; the pending branch is what keeps that list on the run and
puts it in front of the member. Once it lands, a member repeatedly emptying their own option set is
visible and fixable — usually by asking them to relax one rule.

**C6 is an experience metric, not a cost metric.** It measures what the member was asked to bear,
which is the opposite of a revenue measure. Lower is better, and it is bounded by the card's
authorisation limit, which no preference can raise (see §10 of
[`03-action-policy.md`](03-action-policy.md)).

## D. Trust in the forecast — were we right to warn them

| # | KPI | Definition | Status |
|---|---|---|---|
| D1 | **Prediction accuracy** | Calibration of predicted cancellation probability against observed outcome. | `BLOCKED` |
| D2 | **False-alarm rate** | Share of warned flights that operated normally. | `BLOCKED` |
| D3 | **Threshold-crossing precision** | Of flights that crossed a band, the share that were genuinely disrupted. | `PARTIAL` |

**D1 and D2 are blocked for one concrete reason, and it is small.** Every forecast is written to
the prediction ledger — `logPrediction()` is called on each scoring pass. The matching
`logOutcome()` exists, is exported, and has **zero callers anywhere in the codebase**. So we
accumulate predictions and never record what actually happened, and the two can never be joined.

Nothing else stands in the way: the ledger has an outcomes path and an entry type ready for it.
Calling `logOutcome()` when a flight resolves — cancelled, delayed or operated — unblocks both
KPIs. Reconciliation itself is deliberately out of the app (see the header of
`zkd-app/server/decisionLedger.ts`), and belongs in the retrain pipeline; that is a reasonable
split, but it only works once the outcome side is actually written.

Until then, **prediction accuracy is unmeasured**, and no accuracy claim about the live model
should be made. This is the meeting's "prediction accuracy" KPI, and its honest status is: we
cannot compute it yet.

**D3** is partial: threshold evaluations are logged, so the decision side is recoverable, but it
joins to the same missing outcomes.

## E. Loyalty — did they come back

| # | KPI | Definition | Status |
|---|---|---|---|
| E1 | **Repeat usage** | How often a member lets us handle a disruption, over their disruptions. | `PARTIAL` |
| E2 | **Autopilot opt-in rate** | Share of members standing on autopilot rather than ask-me-first. | `EXISTS` |
| E3 | **Preference set rate** | Share of members who have chosen what to optimise for. | `PENDING` |
| E4 | **Post-recovery satisfaction** | CSAT or NPS captured after a recovery closes. | `ABSENT` |

**E1 is the meeting's "how many times he chooses our service".** Partial rather than absent:
resolutions are recorded per recovery, and the member's history carries an outcome and a recovery
marker, but that history is a display projection rather than an event log — it is shaped for
rendering a page, not for counting across members over time.

**E2 and E3 are the strongest revealed-preference signals available**, and both are cheap.
A member who moves to autopilot is telling us they trust the system unsupervised, which is a
stronger statement than any survey answer. A member who sets an optimisation strategy is telling
us they expect to use it again.

**E4 is absent entirely.** Nothing in this repository collects member feedback of any kind — no
survey, no rating, no complaint path. Every other KPI here is inferred from behaviour. That is
defensible, and behavioural signals are often more honest than surveys, but it means the system
currently has no way for a member to say "that was handled badly" in their own words except by
handing over (B2) or by refining (C2).

---

## What to instrument first

Ordered by how much each unlocks, not by effort:

1. **Call `logOutcome()` when a flight resolves.** One call site. Unblocks D1, D2 and most of D3,
   and turns the risk model from unvalidated to measurable.
2. **Automated detection.** Defines A1, and makes A2–A4 measure from a real clock instead of the
   moment somebody happened to press a button. This is a supplier decision before it is a code
   change — see [`02-data-sources-and-apis.md`](02-data-sources-and-apis.md).
3. **A recovery event log.** Promote resolutions from a display projection to durable events, so
   E1 becomes countable across members and time.
4. **Interaction counters at the consent gate.** Cheap, and completes B3 and B4.
5. **A feedback prompt after a closed recovery.** The only route to E4, and the only place the
   member gets to speak outside a refinement.

## What this document deliberately does not do

- **No target values.** Every target here would be invented, because no baseline exists for a
  single KPI in the set. Targets follow the first month of real measurement.
- **No composite score.** Rolling these into one "experience index" would hide exactly the
  granularity the meeting asked for, and would let a good number in one ladder mask a bad one in
  another.
- **No revenue-adjacent metric**, including ones that could be argued as experience proxies —
  attachment, ancillary uptake, spend per recovery. Out of scope by decision.
