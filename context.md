# context.md — current state of the repository

Last refreshed: 2026-08-08.

## Project

ZKD Concierge — Codestreet 2026 / American Express (Team ZKD, IIT Madras). Autonomous
travel-disruption concierge for Indian domestic aviation: predict/detect an IRROPS event,
re-accommodate the member (flight + hotel + ground), claim duty of care from the carrier, stop
safely when it cannot.

## Version history

- **Round 1**: deck + architecture validation plan (`documentation/architecture/validation-plan.md`, 13
  findings, partially superseded). Evidence tier `deck` numbers originate here.
- **Round 2 (current)**: four v2.0 agent specs, four written docs in `documentation/design/`, web + Android
  prototypes, Monte Carlo simulator, submission bundle (APK, videos).

## Key architectural commitments

| Topic | Commit |
|---|---|
| Agent architecture | Four collaborative agents (Supervisor/Negotiator, Flight Reshop, Hotel Re-accommodation, Ground Transfer) on LangGraph |
| Canon facts | `## A2. FROZEN ARCHITECTURAL FACTS` identical in all four `*.pdf`; never edit one copy |
| Risk model | **Built, not bought (2026-08-14).** Self-trained XGBoost on real US DOT/BTS + Brazil ANAC historical data (`zkd-risk-model/`), no vendor call, no mock fallback — see `documentation/design/05-cancellation-risk-model.md`. Thresholds adapt to seat scarcity, urgency, connection criticality and forecast confidence, externalized to `zkd-app/config/risk-thresholds.json` (hot-reloadable) |
| Latency budget | ~11 s total recovery; ~95% is supplier API wait time; thinking ~0.6 s; no GPU on critical path |
| Consent/safety | **Notify-then-proceed (2026-08-19).** WAIT window still derived from supplier offer expiry (~5-20 min, floor 2 min) with re-validation before spend, but silence now PROCEEDS on every tier rather than stopping when the fix costs money — restoring canon's Tier A mechanics. The safety guarantee is a four-rung notification ladder (risk → cancelled → about to spend ₹N, stop us → booked), not a spend ceiling; the ₹25,000 per-transaction cap is gone. Consumed flight and hotel options still cannot be re-proposed. Load-bearing consequence: an undeliverable alert channel is now a safety defect, not a cosmetic one |
| Money shown to the member | Three figures, never one: what the plan costs, what comes back (`server/domain/refund.ts`), and the delta they actually pay. Unknown fare → "not known yet", never ₹0 |
| Currency | Converted through `server/fx.ts` at published daily rates, original quote retained alongside, rate + timestamp recorded with the decision. The old refuse-to-convert rule emptied the option list on EUR-priced Duffel inventory |
| Cancellation detection | **Three lanes, webhook-first (2026-08-19).** (1) Push — `server/webhooks/`, Duffel + AeroDataBox adapters behind one provider-agnostic receiver, OAG stubbed. (2) Poll — `server/engine/statusPoller.ts`, now a *fallback*, ceiling cut 45→15/month, skips flights a live webhook already covers. (3) Member report — `server/engine/memberReports.ts`, acts for the reporter immediately and everyone else only once corroborated. **AviationStack has no webhooks at all** (pull-only by design), which is why the poller was never improvable past its ceiling. **A dead webhook looks exactly like a quiet week**, so deliveries are a heartbeat: `/ops` shows which lane is live and the poller reclaims primary the moment a feed goes stale |
| Webhook endpoint | Built and testable locally; **no subscriptions are registered until `WEBHOOK_PUBLIC_URL` is set** — that one variable is the whole job when this is hosted |
| Free-text intent | `/prepare` takes one sentence, an LLM translates it into a constrained preference delta, it is clamped and confirmed by the member, then the SAME deterministic scorer ranks. No LLM touches ranking |
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
- `zkd-risk-model/` — the real, self-trained cancellation model (data, features, training, serving, AWS Terraform) — see its own README.md
- `zkd-android/` — Expo/RN Android app, subset (Flights, Flight detail, Recovery, Profile)
- `iropssim.py` + `iropssim-output.json` — 250k-case fixed-seed Monte Carlo
- `ZKD Website/` — production builds of the three demo sites + `serve.js` (5173/5174/5175)
- `assets/builds/`, `assets/media/` — the APK and the demo videos
- `README.md`, `documentation/project/SUBMISSION.md`, `documentation/README.md` — the story, claims, evidence tiers
- `assets/deck/PPT.pptx` — the pitch deck; `assets/data/` — the API-requirements tracker

## Evidence tiers

`verified` · `calc` · `sim` · `assumed` · `budget` · `deck`. Known gap: DGCA duty-of-care
thresholds carry `deck` until primary CAR text is re-retrieved.

## Known limitations (stated in docs)

- No self-serve booking: flight/hotel/cab/cruise origination and PNR creation are not built —
  every PNR is seeded, standing in for a booking made elsewhere. Cruise is not modelled at all.
- Cancellation model (`zkd-risk-model/`) is real and self-trained but has no Indian/most-international
  historical training data yet, and no weather feature in v1 — see
  `documentation/design/05-cancellation-risk-model.md` §8 for the full, honest list.
- Sabre cert returns no inventory, so multi-source rests on Duffel plus synthetic Travelport
- Payment mocked
- Confirmation-window floor is assumed, not measured from push telemetry
- Card-member-books-for-someone-else consent model is unresolved (mentor question)
- API failure/rate-limit behavior not modeled — biggest gap
- Diversions/turn-backs out of scope
- Android build has no pre-auth flow or consent settings screen
- Android app is a subset of the web app