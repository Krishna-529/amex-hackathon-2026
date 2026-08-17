# memory.md — decisions, insights, work log

## Recent work

- 2026-08-17 — **Speculative holds removed from the design entirely.** A passenger cannot hold two
  flight tickets, so a hold on a replacement seat taken *before* the carrier cancels is a duplicate
  booking that carriers' auditors cancel — sometimes cancelling the original. Most Indian LCCs offer
  no free hold at all. Applies to flights, hotels and ground alike: **nothing is claimed before the
  carrier acts.** Replaced by a **refresh loop** that keeps N coherent flight+hotel+ground *bundles*
  policy-passing and valid, re-shopping before the soonest `offer_expiry` lapses (`refresh-cadence`,
  derived like the confirmation window and returning which bound was binding).
  - **Retired proof IDs `hold-ttl` and `churn-governance`**; `refresh-cadence` replaces both, and
    per-carrier `recovery_rate` (how reliably a carrier settles valid refund claims) replaces
    `hold_conversion` as the feedback signal that changes behaviour.
  - **Three clocks are now** `offer_expiry` · `time_to_announcement` · `cancellation_deadline`.
    `hold_TTL` is deleted; the hotel `cancellation_deadline` is promoted from "a fourth clock" and
    now matters *more*, since with nothing held it is the only thing making `cancelHotel` possible.
  - **`iropssim.py` never modelled holds**, so `sens-portfolio` (38.63), `sens-breadth` (26.31),
    `sens-allocation` and every outcome band are unaffected. Both gates verified green afterwards.
  - **Honest cost, do not hide it:** nothing is secured, so in a systemic surge we lose seats we
    would previously have held, and Outcome C (next-day + hotel + duty of care) gets likelier.
    What it wins is no inventory externality — we never hoard seats during a disruption.
  - Code: `lib/thresholds.ts` band `holdGate` → **`ready`** (+ `app/flights/page.tsx`), and three
    stale user-facing copy sites fixed (`/flights/[id]` "Consider holding a seat at", `/how-it-works`
    band description, `BAND_SAY.ready`). `partySize` threaded into `ThresholdInputs`;
    `scarcityFactor` now works on `seats / partySize` and is **identical at partySize 1**.
    `forecast.ts` passes 1 pending PNR grouping. `tsc --noEmit` and `npm run build` both clean.
- 2026-08-17 — **Reissue model, sandbox and policy gate implemented.** 79 tests, `tsc --noEmit`
  clean, `next build` clean, both reproducibility gates green.
  - **A test runner now exists** — `tsx` + `node:test`, `npm test` / `npm run typecheck`. Previously
    the only gate was `tsc` via `next build`.
  - `lib/refreshCadence.ts` — derived per-component interval mirroring `confirmWindow.ts`, returning
    `boundBy: offer-expiry | band-floor | band-ceiling`. Flights refresh on offer expiry (minutes),
    hotels far slower, ground never (quoted on demand). **Band maxima are tier `assumed`** — set at
    2× the minimum pending measurement of how fast offers actually die per route.
  - `server/suppliers/sandbox.ts` — the only write-capable adapter. Inventory is **stateless by
    construction**: `hash(seed, route, date)` plus an exponential decay curve, so a hot reload or
    parallel test run cannot make it drift. Refuses a second active coupon for the same
    `(passenger, date)`, which turns the no-holds constraint into a regression test. Registered in
    the search union **only under `ZKD_SANDBOX=1`**, so synthetic seats never appear beside real
    Duffel inventory.
  - `server/policy/index.ts` — default deny, **twelve** rules (the ten planned plus
    `incoherent_bundle` and `incomplete_policy_inputs`). Missing carriers or fare rules deny rather
    than pass. Memo cache stores digest→verdict only, so a count bound is correct and we never walk
    the object graph at runtime; a data reload flushes it; **a cache hit still emits a ledger entry.**
  - `lib/ranking.ts` — the trap worth remembering: once Amex fronts, member-visible cost for a fresh
    purchase is ₹0, so ranking on it would tie with a free reissue and the reversibility tiebreak
    would pick the *expensive* option. Ranking uses **net economic cost**, consent uses
    **member-visible cost**, and there is a regression test for the inversion.
  - `server/ledger/reconciliation.ts` — `RefundClaim`, separate from the decision ledger. A denial
    raises `ESCALATED_FINANCE` on a back-office queue with a contestable case computed from our own
    entitlement rules. Sweeps batch **by carrier, not per claim**. `recoveryRate` per carrier is the
    successor to churn governance and feeds the expected-recovery term in ranking.
  - `server/domain/outcome.ts` — per-component status with four states; `ROLLED_BACK` and
    `NOT_ATTEMPTED` deliberately distinct ("your cab was cancelled" vs "we never booked a cab" need
    different things from the member). The push carries the same split as the screen.
  - **`opa` is not installed here**, so the Rego/WASM gate canon specifies is implemented in
    TypeScript, one named pure function per rule for a 1:1 swap later. Deliberately one
    implementation rather than a Rego copy that can drift.
  - Still to do: wire the engine to these modules (`simulation.ts` still runs the old
    `setTimeout` narration), the LangGraph layer, and identity. Plan at
    `~/.claude/plans/declarative-brewing-willow.md`.
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