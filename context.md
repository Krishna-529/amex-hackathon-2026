# context.md — current state of the repository

Last refreshed: 2026-08-08.

## Project

ZKD Concierge — Codestreet 2026 / American Express (Team ZKD, IIT Madras). Autonomous
travel-disruption concierge for Indian domestic aviation: predict/detect an IRROPS event,
re-accommodate the member (flight + hotel + ground), claim duty of care from the carrier, stop
safely when it cannot.

## Version history

- **Round 1**: deck + architecture validation plan (`documentation/project/ZKD-Architecture-Validation-Plan.md`, 13
  findings, partially superseded). Evidence tier `deck` numbers originate here.
- **Round 2 (current)**: four v2.0 agent specs, four written docs in `documentation/design/`, web + Android
  prototypes, Monte Carlo simulator, submission bundle (APK, videos).

## Key architectural commitments

| Topic | Commit |
|---|---|
| Agent architecture | Four collaborative agents (Supervisor/Negotiator, Flight Reshop, Hotel Re-accommodation, Ground Transfer) on LangGraph |
| Canon facts | `## A2. FROZEN ARCHITECTURAL FACTS` identical in all four `*.pdf`; never edit one copy |
| Risk model | Bought, not built: Lumo (thinklumo.com) supplies the disruption forecast, mocked until a commercial key exists and advisory until back-tested. Thresholds adapt to seat scarcity, urgency, connection criticality and forecast confidence |
| Latency budget | ~11 s total recovery; ~95% is supplier API wait time; thinking ~0.6 s; no GPU on critical path |
| Consent/safety | WAIT window derived from supplier offer expiry (~5-20 min, floor 2 min) with re-validation before spend; Autopilot (silence proceeds) vs Ask-me-first (silence stops unless the fix is free); default-deny policy layer; consumed flight and hotel options cannot be re-proposed |
| Suppliers | Duffel + LiteAPI sandboxes intended proving ground; no live integrations; payment mocked behind Amex vPayment contract test |
| Public Wi-Fi | Demo servers bind `0.0.0.0` — never run on conference/public Wi-Fi |

## Reproducibility contract (must stay green)

1. `python3 iropssim.py | diff - iropssim-output.json` → empty
2. Four canon hashes match (see `AGENTS.md` § canon block)

## Directory map

- `documentation/agent-specs/current/` — current-canon four specs `zkd_*_agent_v2.0.md`; `legacy/` superseded, provenance only
- `documentation/design/` — four docs read in order (prediction, data/APIs, action policy, infra & cost)
- `documentation/project/` — submission, architecture validation plan, architecture narrative
- `zkd-app/` — Next.js web app; routes `/flights` `/flights/[id]` `/prepare/[id]` `/recovery/[id]` `/profile` `/settings` `/history` `/how-it-works`
- `zkd-android/` — Expo/RN Android app, subset (Flights, Flight detail, Recovery, Profile)
- `iropssim.py` + `iropssim-output.json` — 250k-case fixed-seed Monte Carlo
- `ZKD Website/` — production builds of the three demo sites + `serve.js` (5173/5174/5175)
- `apk/`, `videos/` — submission artifacts
- `README.md`, `documentation/project/SUBMISSION.md`, `documentation/README.md` — the story, claims, evidence tiers
- `assets/` — pitch deck (`PPT.pptx`) and the API-requirements tracker (`.xlsx`/`.csv`)

## Evidence tiers

`verified` · `calc` · `sim` · `assumed` · `budget` · `deck`. Known gap: DGCA duty-of-care
thresholds carry `deck` until primary CAR text is re-retrieved.

## Known limitations (stated in docs)

- No commercial Lumo key; forecast is mocked and labelled as such, and not yet back-tested
- Sabre cert returns no inventory, so multi-source rests on Duffel plus synthetic Travelport
- Payment mocked
- Confirmation-window floor is assumed, not measured from push telemetry
- Card-member-books-for-someone-else consent model is unresolved (mentor question)
- API failure/rate-limit behavior not modeled — biggest gap
- Diversions/turn-backs out of scope
- Android build has no pre-auth flow or consent settings screen
- Android app is a subset of the web app