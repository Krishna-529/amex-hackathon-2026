# Documentation

**ZKD Concierge · Codestreet 2026 / American Express**

Every written document for the project. Code lives in `zkd-app/` and `zkd-android/`; deck, data,
builds and videos live in `assets/`.

---

## design/ — the core documents

Read in order. Each answers one question a judge will ask.

| Document | The question it answers |
|---|---|
| [`01-prediction-model.md`](design/01-prediction-model.md) | Where the disruption probability comes from, why we buy it rather than build it, how the thresholds adapt, and how long the member gets to decide |
| [`02-data-sources-and-apis.md`](design/02-data-sources-and-apis.md) | Every external dependency, what it costs, and which ones we cannot actually get |
| [`03-action-policy.md`](design/03-action-policy.md) | The full decision path from detection to settlement, and what silence means at each step |
| [`04-infrastructure-and-cost.md`](design/04-infrastructure-and-cost.md) | What it costs to run, and why there is no GPU on the critical path |
| [`05-cancellation-risk-model.md`](design/05-cancellation-risk-model.md) | **Supersedes `01` §2.** The real, self-trained model that replaced the Lumo vendor call — data, features, serving, and the threshold-gated alt pre-cache |
| [`06-experience-kpis.md`](design/06-experience-kpis.md) | How the project is measured — granular customer-experience KPIs, each marked by whether the data exists in the system today |
| [`07-disruption-detection-explained.md`](design/07-disruption-detection-explained.md) | How detection actually works end to end — the three lanes, OAG's real role, and how a cancellation reaches every passenger |
| [`08-flutter-notifications.md`](design/08-flutter-notifications.md) | Whether Flutter's push notification / FCM token registration actually works (short answer: not yet, local-only) |
| [`09-problem-scale-and-incidents.md`](design/09-problem-scale-and-incidents.md) | How big the problem really is — global/India disruption base rates and four named real-world incidents (IndiGo, Southwest, CrowdStrike, American Airlines) |

## architecture/

| Document | What it is |
|---|---|
| [`architecture.md`](architecture/architecture.md) | The system design — layers, the authority boundary, and the invariant that makes it testable |
| [`validation-plan.md`](architecture/validation-plan.md) | The 13-finding review of the Round 1 deck. Partially superseded — see its own banner |

## agent-specs/

The LangGraph agent specifications: design documents and runtime prompts in one file each.

- `current/` — v2.0, the specs in force
- `legacy/` — v1.0, kept for the diff rather than for use

## project/

| Document | What it is |
|---|---|
| [`SUBMISSION.md`](project/SUBMISSION.md) | What was submitted, what runs, and what is honestly not built |
| [`DEPLOYMENT.md`](project/DEPLOYMENT.md) | How to deploy `zkd-app`, and why a serverless host breaks the engine |
| [`PILOT_TESTING.md`](project/PILOT_TESTING.md) | How to run the real model + app together and exercise the pipeline end to end |
| [`mentor-meetings.md`](project/mentor-meetings.md) | The mentor-review record — decisions, open questions, and which doc carries each outcome |

---

## Also at the repo root

Four files stay outside this folder on purpose:

| File | Why it is at the root |
|---|---|
| `README.md` | GitHub renders it as the repository landing page |
| `AGENTS.md` | Coding agents look for it at the repo root |
| `context.md` | Fast orientation for anyone (human or agent) picking the project up |
| `memory.md` | Running record of decisions and open items; updated whenever behaviour changes |

`iropssim.py` also stays at the root, because the metrics site cites `python iropssim.py` as the
command that reproduces every `sim`-tier number. Moving it would invalidate a published claim.
