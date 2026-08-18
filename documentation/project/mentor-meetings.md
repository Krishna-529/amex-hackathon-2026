# Mentor meetings

The running record of mentor reviews for ZKD Concierge — what was decided, what is still open, and
which document now carries each outcome.

Newest first. Same dated-heading convention as the root `memory.md`, so the two read alike: that
file is the engineering decision log, this one is the steer we were given.

A decision recorded here is binding on the docs. Where a meeting changed a document, the action
row names it, so a reader can always get from "we were told X" to "here is where X now lives".

---

## Meeting 2 — 2026-08-18

### Decisions

**1. Family members' travel preferences: assume Amex holds the data.**
The open doubt was whether preference data exists for companions on a booking, or only for the
card member. It exists — Amex has it. We may design against it rather than around it.

This is a design permission, not a description of the code. Today the app has nowhere to put it:
`Traveller` (`zkd-app/server/domain/types.ts`) carries identity, passport and loyalty but no seat,
meal, cabin or optimisation preference, and the only party-level merge in the system
(`unionHotelRulesAcrossParty`, `zkd-app/server/preferences/adapt.ts`) unions exactly one field —
accessibility. Everything else applies the card member's preference to everyone on the ticket.
Recorded in `documentation/design/02-data-sources-and-apis.md`.

**2. Customer experience is the only objective. Revenue is out of scope.**
The project is judged on what the disrupted member experiences. Not incremental spend, not
attachment rate, not commercial upside. No metric in this project may be a revenue proxy.

The docs already comply — a sweep for revenue/monetisation vocabulary across `documentation/`
found nothing to remove. The cost figures in `04-infrastructure-and-cost.md` are the cost of
running the system, a constraint we work within, and stay. This decision is therefore about
stating the stance so it holds under pressure later, not about a cleanup. It is now stated in
`CLAUDE.md` and at the head of `documentation/design/06-experience-kpis.md`.

**3. Measurement must be granular, and must ladder up to satisfaction.**
One headline number is not enough. We want the small operational measures that actually compose
into a good or bad experience — how long the member waited, how much work we made them do, how
often they had to correct us, whether they came back. Named in the meeting: call handling time,
last-minute versus pre-emptive booking, prediction accuracy, and how often the member chooses this
service again.

Written up as `documentation/design/06-experience-kpis.md`, with every KPI marked by whether the
data exists in the system today.

### Open questions

**A. Who detects the cancellation?**
This is the gap the meeting identified in the procedure, and it is real. Today's flow is
*reactive*: the member notices, the member tells Amex, and only then do we rebook. In the code,
`detectDisruption` has exactly one production caller — `POST /api/disruptions`, reached by a human
clicking the `/ops` console. There is no poller, cron, webhook or worker anywhere in
`zkd-app/server/`. Everything upstream of that click is *prediction* (the risk model), which is a
different thing from *detection*.

**Does OAG provide it? Yes — with a caveat that decides the answer.**
OAG's Flight Instances API carries a live status field whose values include `"Cancelled"`, plus a
`scheduleChanged` flag (`zkd-app/server/oag.ts`). So the data exists and we already hold a working
key for the product.

The caveat is budget, not capability. Our `OAG_FLIGHT_INFO_TRIAL` key is capped at **100 calls
total across a 14-day window**. Detection means watching flights continuously; 100 calls cannot
support that for even one day of a real book of business. And today OAG is wired only into flight
search — it is imported in exactly two places in the app, neither of them a status watcher.

So the question is not "can OAG do it" but "what do we pay, or who else do we use". Carried into
`documentation/design/02-data-sources-and-apis.md` as a decision to make, not a solved problem.

**B. What is Amex's current call handling time?**
We need the baseline of today's phone process to say what the automation saves. Nobody in the
repo has this number and we must not invent one. Requested from the Amex side; until it arrives it
is marked `assumed` and left blank in the KPI doc.

### Actions

| # | Action | Where it landed |
|---|---|---|
| 1 | Record that companion preference data exists at Amex, and that our model has nowhere to hold it | `documentation/design/02-data-sources-and-apis.md` |
| 2 | State the customer-experience-only objective as a standing principle | `CLAUDE.md`, `documentation/design/06-experience-kpis.md` |
| 3 | Answer the OAG detection question with evidence and name the real constraint | `documentation/design/02-data-sources-and-apis.md` |
| 4 | Write the reactive-today versus proactive-target procedure down explicitly | `documentation/design/03-action-policy.md` |
| 5 | Build the granular experience KPI set, graded by what is measurable today | `documentation/design/06-experience-kpis.md` |
| 6 | Obtain Amex's baseline call handling time | **Open** — external dependency |
| 7 | Give companions a preference field and a party merge rule beyond accessibility | **Open** — code change, not yet scoped |

---

## Meeting 1 — date TBC

> **Stub.** The takeaways from meeting 1 were not committed to this repository and are not
> recoverable from it. Paste them here in the same shape as meeting 2 — Decisions, Open questions,
> Actions — and delete this note.
>
> Anything in meeting 2 above that reads as a *resolution* of an earlier doubt (the family
> preferences question in particular) came from meeting 1, so filling this in makes the record
> continuous rather than starting mid-conversation.
