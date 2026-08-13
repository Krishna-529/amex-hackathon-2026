# AGENTS.md — read first

Guidance for any agent working in this repository. Read this file first, then `context.md`, then `memory.md`.

## What this repo is

ZKD Concierge — Codestreet 2026 / American Express (Team ZKD, IIT Madras).
An autonomous travel-disruption concierge for Indian domestic aviation: predict/detect an IRROPS
event, re-accommodate the member across flight + hotel + ground, claim duty of care from the
carrier, and stop safely when it cannot.

## Canonical facts that must never break

- **The four agent specs are the current-canon source of truth**: `zkd_*_agent_v2.0.md`
  (Supervisor/Negotiator, Flight Reshop, Hotel Re-accommodation, Ground Transfer).
  The `_v1.0.md` files are superseded and kept only for provenance — do not edit or quote them as current.
- **`## A2. FROZEN ARCHITECTURAL FACTS` must stay byte-identical across all four `*_v2.0.md` files.**
  Never hand-edit one copy. Verify after any edit:
  ```sh
  python3 - <<'PY'
  import hashlib, pathlib
  for f in pathlib.Path('.').glob('documentation/agent-specs/current/*_v2.0.md'):
      t = f.read_text(encoding='utf-8')
      b = t[t.index('## A2. FROZEN'):t.index('## A3.')]
      print(hashlib.sha256(b.encode()).hexdigest()[:16], len(b), f.name)
  PY
  ```
  All four hashes must match.
- **`iropssim.py` → `iropssim-output.json`**: every `sim`-tier number comes from this 250,000-case
  Monte Carlo, fixed seed. `python3 iropssim.py | diff - iropssim-output.json` must be empty.

## What is where

| Path | What it is |
|---|---|
| `documentation/design/` | The four core documents: prediction model, data sources & APIs, action policy, infrastructure & cost |
| `documentation/architecture/` | `architecture.md` (system design) and `validation-plan.md` (the 13-finding Round 1 review) |
| `documentation/agent-specs/current/` | Current agent specs `zkd_*_agent_v2.0.md` (design docs + runtime LangGraph prompts); `legacy/` holds superseded `_v1.0.md` provenance copies |
| `documentation/project/` | `SUBMISSION.md` — what was submitted and what is honestly not built |
| `assets/` | `deck/` the pitch deck · `data/` API-requirements tracker · `reference/` PDFs and mockups · `builds/` the APK · `media/` the demo videos |
| `tools/` | One-off scripts that are not part of either app |
| `zkd-app/` | Next.js web app. Routes: `/flights`, `/flights/[id]`, `/prepare/[id]`, `/recovery/[id]`, `/profile`, `/settings`, `/history`, `/how-it-works`, `/ops` |
| `zkd-android/` | Expo / React Native Android app (subset of the web app: 4 screens) |
| `ZKD Website/` | Production builds of the three demo sites + `serve.js` (ports 5173/5174/5175) |
| `README.md`, `context.md`, `memory.md` | Kept at the root deliberately — landing page, fast orientation, and the running decision record |
| `iropssim.py` | Monte Carlo simulator behind every `sim`-tier number. Stays at the root because the metrics site cites `python iropssim.py` as its reproduction command |

## House rules

- No GPU is on the critical path; supplier API rate limits are the binding constraint, not compute.
- The disruption forecast is **bought, not built** — Lumo (thinklumo.com), mocked until a commercial
  key exists and advisory until back-tested. Never present a mocked number as a vendor one; every
  forecast carries `source: 'lumo' | 'mock'`. Thresholds adapt per flight; they are not fixed at
  25/55/80. The confirmation window is derived from supplier offer expiry, not a flat 90 seconds.
- No live supplier integrations exist; Duffel / LiteAPI sandboxes are the intended proving ground.
- Safety rests on the WAIT / consent gate and a default-deny policy layer. Quote numbers with
  their evidence tier (`verified` / `calc` / `sim` / `assumed` / `budget` / `deck`).
- When you change behavior, update `memory.md`.

## Workflow

1. Run reproducible checks before and after edits (`iropssim.py` diff, canon hashes).
2. Apply changes to all four canon files as one scripted change-set, never one copy.
3. After finishing a task, record decisions/insights in `memory.md` and refresh `context.md`.
4. Don't touch `Code/` and `zkd-sites/` — they were committed as inert gitlinks and hold no source.