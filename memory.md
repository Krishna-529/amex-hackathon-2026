# memory.md — decisions, insights, work log

## Recent work

- 2026-08-12 — Reorganized markdown: specs → `documentation/agent-specs/{current,legacy}/`,
  the four design docs → `documentation/design/` (+ `documentation/README.md`), submission-deck
  artifacts → `documentation/project/`; PPT + API-requirements sheets → `assets/`. Cross-references
  and the canon-hash check in `AGENTS.md`/`README.md` updated to the new paths. Committed and merged
  `origin/main` + `worktree-shimmering-stirring-sutherland` into `main`.
- 2026-08-12 — **DATA LOSS INCIDENT**: `documentation/design/02-data-sources-and-apis.md` had
  uncommitted edits (two reference lines: "conversion (`design/01` §6) is the measurable form of
  that…" and "expiry rather than fixed (`design/03` §3.1)…") that were overwritten during the move
  when the working-copy encoding was corrupted and the file restored from git. No backup found
  (VS Code local history, worktree copy, git blobs, VSS all negative). Restore by re-typing those
  two lines into `documentation/design/02-…` if they mattered.
- 2026-08-08 — Initial scaffolding: created `AGENTS.md`, `context.md`, `memory.md` in repo root.
  Repository is a Round 1→Round 2 hybrid with GitHub `submodule` history (gitlinks pointed at
  `49e78886…` for `Code/` and `zkd-sites/` which are inert and carry no source).

## Decisions & insights

- **The sequence agent reads root `AGENTS.md` first, then `context.md`, then `memory.md`.**
- `n3`-tier numbers must come from `iropssim.py`; never invent `sim` figures.
- Canon block `## A2. FROZEN ARCHITECTURAL FACTS` must stay byte-identical across four files —
  single scripted change-set, verify hashes, never hand-edit one.
- `README` warns the recovery platform headline is **both** breadth + selection; when quoting levers,
  separate "search more alternative flights" from "allocate better".

## Open items (gaps from the docs)

- DGCA duty-of-care thresholds carry `deck` tier; primary CAR text not re-verified — must be
  reconciled before production.
- Forecast bought from Lumo, mocked until a key exists, advisory until back-tested.
- Supplier integration partial: Duffel returns real offers, Sabre cert returns none, Travelport synthetic.
- API-failure modeling gap (rate limits, timeouts, circuit breakers) — swap statement in
  `iropssim.py` may be the first place to model it.
- Android app lacks pre-auth / consent-settings screen (the four-screen subset).

## Reproducibility checks to keep green

1. `python3 iropssim.py | diff - iropssim-output.json` → empty
2. Four canon hashes identical (`python3` glob now reads `documentation/agent-specs/current/*_v2.0.md`).

## Scoring / build notes

- `zkd-app` runs `npm install && npm run dev` → `http://localhost:5176`.
- `ZKD Website/serve.js` serves the three demo sites on 5173/5174/5175; binds `0.0.0.0` (demo),
  don't run on public Wi-Fi.