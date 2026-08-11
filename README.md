# ZKD Concierge — Codestreet 2026 / American Express

Team ZKD, IIT Madras. Autonomous travel-disruption concierge for Indian domestic aviation:
predict or detect an IRROPS event, re-accommodate the member across flight + hotel + ground,
claim duty of care from the carrier, and stop safely when it cannot.

This is a **Round 1 → Round 2 hybrid repo**: the Round 1 evidence sites (architecture, Monte
Carlo metrics, personas) sit alongside the Round 2 deliverable — a working Next.js prototype
and an Android app, both wired to real sandbox APIs.

## Start here

| I want to… | Go to |
|---|---|
| Run the actual product | [`zkd-app/`](#zkd-app--the-round-2-product-start-here) below, or `cd zkd-app && npm install && npm run dev` |
| See the submission package (videos, APK, docs) | [`SUBMISSION.md`](SUBMISSION.md) |
| Read the design docs | [`docs/`](docs/README.md) |
| Check which APIs are wired vs. stubbed | [`round2-api-requirements.xlsx`](round2-api-requirements.xlsx) / `.csv` |
| Read the current agent specs | `zkd_*_agent_v2.0.md` (see below — never edit `_v1.0.md`, provenance only) |
| See the Round 1 evidence sites | `zkd-website/` (built) or `Code/` (source) — see [below](#round-1-evidence-sites) |

---

## `zkd-app/` — the Round 2 product, start here

Next.js 16 / React 19 prototype. Predicts a cancellation, shows the risk gauge with a
plain-language explanation, and walks the member through pre-authorisation and the live
rebooking sequence — for any of several flights, each with any number of passengers, including
passengers with a connecting itinerary (a layover between two legs).

```bash
cd zkd-app
npm install
npm run dev          # → http://localhost:5176
```

**Architecture: the backend is the only thing that decides anything.** A module-level
simulation engine (`server/engine/simulation.ts`) runs the whole disruption lifecycle —
detection, the decision window, rebooking — with real `setTimeout`/`setInterval` chains, so it
resolves on schedule whether or not any device is watching. Every screen (web tab, phone) is a
plain poller of that shared state (`GET /api/passengers/[id]/schedule`,
`GET /api/disruptions/[flightId]`, …); nothing is computed or timed client-side any more. This
only behaves correctly as one continuous `npm run dev` / `npm start` process — a serverless
redeploy would drop the in-memory state and any scheduled timers mid-flight. The identity
switcher in the header (`?as=<passengerId>`) is what makes "multiple members, multiple devices,
one shared backend" demonstrable: open two tabs with different `?as=` values and watch them
converge independently.

Since a live demo can't wait for an actual airline to cancel a flight, `/ops` (not linked from
the nav — direct URL only) is an operator console that adds flights and triggers a disruption on
one. Its trigger button calls the exact same `detectDisruption()` entry point a real production
live-status poller would call — only the caller differs, never the detection logic.

Routes: `/flights` · `/flights/[id]` · `/prepare/[id]` · `/recovery/[id]` · `/profile` ·
`/settings` · `/history` · `/how-it-works` · `/ops` (operator console, direct URL only)

**Live API integrations** (added this round — see `round2-api-requirements.xlsx` for the full
credential tracker): real weather (NOAA / Open-Meteo) and aircraft-position data (OpenSky) feed
the risk gauge; a live flight-status check (AviationStack) is shown informationally; two live
flight-search sandboxes and a live hotel-search sandbox back the rebooking options; a live LLM
call (Gemini) generates the plain-language risk and recommendation explanations. Every call is
server-side only (`zkd-app/app/api/*`), fires on-demand (never polled), and fails silently back
to the existing mock data if a provider is down — no vendor name is ever shown in the UI.
**Payment stays fully mocked** — no live payment integration exists.

To actually use the live integrations, copy `zkd-app/.env.example` to `zkd-app/.env.local` and
fill in the keys documented there (`round2-api-requirements.xlsx` has signup links and free-tier
details for each). Without it, the app runs entirely on its built-in mock data.

## `zkd-android/` — the mobile app

Expo / React Native subset of the web app: Flights, Flight detail, Recovery, Profile. No
pre-authorisation flow and no consent-settings screen — those exist only in the web build.

```bash
cd zkd-android
npm install
npx expo run:android
```

Or install the pre-built release APK directly — see [`SUBMISSION.md`](SUBMISSION.md).

## `amex-travel-disruption-concierge/` — saga/rollback policy prototype

A separate, earlier proof-of-concept for the compensation/rollback pattern specifically:
Temporal workflows + OPA policy gating + mock suppliers, demonstrating a saga that unwinds
LIFO when a supplier call fails mid-booking. Not part of the Round 2 submission bundle — see
its own `README.md` for setup (`brew install temporal opa`, `npm run demo:fail`).

---

## Round 1 evidence sites

Three static sites — System Design, Success Metrics, Personas — each figure tagged with a
provenance badge (VERIFIED / CALC·SIM / ASSUMED·BUDGET) linking to its derivation.

| Path | What it is |
|---|---|
| `Code/` | Editable source for the three sites (`apps/design`, `apps/metrics`, `apps/personas`) — run `npm install && npm run dev` here for local editing. |
| `zkd-sites/` | The same source, configured for GitHub Pages deploy (own `.github/workflows/pages.yml`, own `deploy.config.js`). Push changes to **both** `Code/` and `zkd-sites/` if you edit the sites — they are kept in sync by hand, not by a build step. |
| `zkd-website/` | Production build of all three sites + `serve.js`, a zero-dependency static host. Run `node "zkd-website/serve.js"` → ports 5173 / 5174 / 5175. |
| `zkd-launcher/` | Windows launcher (`Start ZKD Sites.cmd`) and `.url` shortcuts to the hosted versions — not source, just shortcuts. |

The servers in `zkd-website/` bind `0.0.0.0` so a phone on the same Wi-Fi can reach them. That
is intentional for a demo on your own network — **do not run them on conference or public
Wi-Fi.**

## Round 1 supporting artifacts

| Path | What it is |
|---|---|
| `zkd_*_agent_v2.0.md` | **Current.** Four agent specs — Supervisor/Negotiator, Flight Reshop, Hotel Re-accommodation, Ground Transfer. Each is Part A (a prompt that writes the design-doc section) + Part B (the runtime LangGraph system prompt). |
| `zkd_*_agent_v1.0.md` | **Superseded.** Kept for provenance only; each carries a banner saying so. |
| `ZKD-Architecture-Validation-Plan.md` | The 13-finding review of the Round 1 deck. Partially superseded — see its banner. |
| `iropssim.py` → `iropssim-output.json` | 250,000-case Monte Carlo behind every `sim`-tier number. Fixed seed; `python3 iropssim.py` reproduces the JSON byte-for-byte. |
| `Amex-workflows.pdf`, `amex-goat-components-2-3.html` | Round 1 supporting artifacts. |

## The canon block is byte-identical across four files — keep it that way

`## A2. FROZEN ARCHITECTURAL FACTS` is asserted identical in all four `*_v2.0.md` files. It is,
today. Verify after any edit:

```sh
python3 - <<'PY'
import hashlib, pathlib
for f in pathlib.Path('.').glob('zkd_*_v2.0.md'):
    t = f.read_text(encoding='utf-8')
    b = t[t.index('## A2. FROZEN'):t.index('## A3.')]
    print(hashlib.sha256(b.encode()).hexdigest()[:16], len(b), f.name)
PY
```

All four hashes must match. Never hand-edit one copy — apply one scripted change-set to all four.

## Reproducing the numbers

```sh
python3 iropssim.py | diff - iropssim-output.json    # must be empty
```

Read `breadth_vs_allocation` in the output before quoting the recovery levers: the headline
"portfolio" figure is **two** mechanisms, and the larger one is simply searching more than one
alternative flight. `closed_without_human_pct` is the `p_intrinsically_complex` assumption restated,
not a model finding — the sensitivity table now shows this directly.

## Known limitations, stated plainly

See [`SUBMISSION.md`](SUBMISSION.md#known-limitations-stated-plainly) for the full list. In
short: no trained risk model yet (transparent weighted sum), payment is mocked, the Android app
is a four-screen subset, and DGCA duty-of-care thresholds still carry the Round 1 `deck`
evidence tier pending a primary-source re-check.
