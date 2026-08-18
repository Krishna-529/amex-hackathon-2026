# CLAUDE.md — which document holds which data

**ZKD Concierge · Codestreet 2026 / American Express (Team ZKD, IIT Madras)**

An autonomous travel-disruption concierge for Indian domestic aviation: predict or detect an IRROPS
event, re-accommodate the member across flight + hotel + ground, claim duty of care from the
carrier, and stop safely when it cannot.

This file exists to answer one question fast: **where does the thing I need live?** It is a map,
not a rulebook.

> **For house rules, canon and workflow, read [`AGENTS.md`](AGENTS.md).** That file is
> authoritative for what you may and may not change — the frozen `A2` block across the four agent
> specs, the `iropssim.py` reproducibility check, evidence tiers, and the requirement to log
> decisions in `memory.md`. Nothing here overrides it, and the two are kept deliberately
> non-overlapping: `AGENTS.md` maps *paths to what they are*, this file maps *questions to the doc
> that answers them*.

---

## The standing objective

**Customer experience is the only thing this system optimises for.** Not revenue, not incremental
spend, not attachment rate. If you are weighing a design choice and the tiebreak is commercial,
the tiebreak is wrong.

Running cost is a **constraint**, tracked in `documentation/design/04-infrastructure-and-cost.md` —
the budget a design has to fit inside. It is never a goal and never trades against the member.

Decided in mentor meeting 2; see `documentation/project/mentor-meetings.md`.

---

## Start here, by question

### "What is this project, and what actually works?"

| Question | Document |
|---|---|
| What is this, in one page? | [`README.md`](README.md) |
| What is the current state of the repo? | [`context.md`](context.md) |
| What was submitted, and what is honestly not built? | [`documentation/project/SUBMISSION.md`](documentation/project/SUBMISSION.md) |
| What decisions have been made, and when? | [`memory.md`](memory.md) — dated engineering log |
| What did the mentors tell us? | [`documentation/project/mentor-meetings.md`](documentation/project/mentor-meetings.md) |
| Where is every document? | [`documentation/README.md`](documentation/README.md) |

### "How does the system decide anything?"

| Question | Document |
|---|---|
| Where does the cancellation probability come from? | [`design/05-cancellation-risk-model.md`](documentation/design/05-cancellation-risk-model.md) — the real self-trained model. **Supersedes §2 of `01`** |
| How do thresholds adapt, and how long does the member get to decide? | [`design/01-prediction-model.md`](documentation/design/01-prediction-model.md) |
| What happens between detection and settlement? | [`design/03-action-policy.md`](documentation/design/03-action-policy.md) |
| What does silence mean at each step? | `design/03-action-policy.md` §3 — the consent window |
| When does the system stop rather than continue? | `design/03-action-policy.md` §7 — halt conditions |
| Who pays, and can the member ever end up out of pocket? | `design/03-action-policy.md` §10 — **the money-flow invariant** |
| Who notices the cancellation, today versus the target? | `design/03-action-policy.md` §11 |
| How are competing options ranked? | `design/03-action-policy.md` §5, and `zkd-app/server/pipeline/score.ts` in code |

### "Where does the data come from?"

| Question | Document |
|---|---|
| Every external dependency, its cost, and which we cannot get | [`design/02-data-sources-and-apis.md`](documentation/design/02-data-sources-and-apis.md) |
| Can we detect a cancellation, and does OAG provide it? | `design/02-data-sources-and-apis.md` §1 — *Detection versus prediction* |
| What does Amex/MyCa hold about the member and their family? | `design/02-data-sources-and-apis.md` §6 |
| What does it cost to run, and why is there no GPU on the critical path? | [`design/04-infrastructure-and-cost.md`](documentation/design/04-infrastructure-and-cost.md) |

### "How is it measured?"

| Question | Document |
|---|---|
| What KPIs do we care about, and which can we actually compute today? | [`design/06-experience-kpis.md`](documentation/design/06-experience-kpis.md) |
| Where does every `sim`-tier number come from? | [`iropssim.py`](iropssim.py) → `iropssim-output.json`, fixed seed |
| What do the evidence tiers mean? | `documentation/agent-specs/current/*_v2.0.md`, §"Evidence tiers" |

### "How is it built?"

| Question | Document |
|---|---|
| System design, layers, the authority boundary | [`architecture/architecture.md`](documentation/architecture/architecture.md) |
| The 13-finding Round 1 review | [`architecture/validation-plan.md`](documentation/architecture/validation-plan.md) — *partially superseded, see its banner* |
| What each LangGraph agent does, and its runtime prompt | [`agent-specs/current/`](documentation/agent-specs/current/) — four `*_v2.0.md` files |
| The superseded v1.0 specs | `agent-specs/legacy/` — **provenance only, never quote as current** |
| How do I deploy it, and why does serverless break the engine? | [`project/DEPLOYMENT.md`](documentation/project/DEPLOYMENT.md) |
| How do I run the model and the app together end to end? | [`project/PILOT_TESTING.md`](documentation/project/PILOT_TESTING.md) |
| What did the rebooking-pipeline build actually deliver? | [`ZKD-Rebooking-Pipeline-Session-Report.md`](ZKD-Rebooking-Pipeline-Session-Report.md), and its `.VERIFICATION.md` — read-only checks of the report's claims against the code |

---

## Code, by question

Docs describe intent; these are where the behaviour actually lives.

| Question | Where |
|---|---|
| What ranks the alternatives? | `zkd-app/server/pipeline/score.ts` — six criteria, hard rules filter *before* scoring |
| What turns a member's preferences into rules? | `zkd-app/server/preferences/adapt.ts` — the single translation point |
| What runs the recovery end to end? | `zkd-app/server/pipeline/index.ts`, with `saga.ts` for the irreversible half |
| What decides whether we may spend? | `zkd-app/server/engine/simulation.ts` — consent, windows, and the cap check |
| Where is the disruption trigger? | `zkd-app/app/api/disruptions/route.ts` → `detectDisruption`. **Today this is only reached by hand from `/ops`** |
| Where are predictions logged? | `zkd-app/server/decisionLedger.ts` |

### Two traps worth knowing before you search

- **`zkd-app/lib/ranking.ts` is dead code.** It has no importers and survives only in two comments.
  The live ranker is `zkd-app/server/pipeline/score.ts`. Reading the wrong one leads to the wrong
  conclusion about how options are ordered.
- **CI does not run `npm run verify`.** `.github/workflows/ci.yml` runs `tsc`, `vitest run` and
  `build` only, and never sets `GEMINI_API_KEY`. New assertions belong in a vitest `*.test.ts`, and
  anything LLM-dependent must pass with the LLM absent.

---

## Superseded — do not cite as current

| Document | Superseded by |
|---|---|
| `design/01-prediction-model.md` §2 (the bought Lumo forecast) | `design/05-cancellation-risk-model.md` |
| `agent-specs/legacy/*_v1.0.md` | `agent-specs/current/*_v2.0.md` |
| Parts of `architecture/validation-plan.md` | See the banner in that file |
