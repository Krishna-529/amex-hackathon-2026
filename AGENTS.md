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
| `zkd-risk-model/` | The real, self-trained cancellation-prediction model — data, features, training, serving, AWS Terraform |
| `ZKD Website/` | Production builds of the three demo sites + `serve.js` (ports 5173/5174/5175) |
| `README.md`, `context.md`, `memory.md` | Kept at the root deliberately — landing page, fast orientation, and the running decision record |
| `iropssim.py` | Monte Carlo simulator behind every `sim`-tier number. Stays at the root because the metrics site cites `python iropssim.py` as its reproduction command |

## Whose decision wins

**A commit authored by Dhawal with no `Co-Authored-By: Claude` trailer is authoritative.** Of the
81 commits in this repository, 70 carry that trailer — they are Claude-assisted and yield to the
11 that do not. When two branches disagree about what the system should do, find the human-only
commit that governs the question and start from what it actually says, not from a summary of it.

The rule earned its keep immediately. `worktree-preference-refinement` and this branch both built
free-text preference capture, and disagreed about whether a member may state a budget. The
governing commit is `f1346ba` (Dhawal, 2026-08-18), and re-reading it settled the argument in a
way neither branch's own comments could: it pins an **invariant** (money moves only on the
member's Amex card, and the balance can never go negative from this flow) and separately names
**two mechanisms** that enforce it. The per-transaction cap was one mechanism, not the invariant.
Removing the cap therefore did not break what that commit pinned — but it did replace a ceiling
with a guarantee of a different kind, and §10 of the action policy now says so plainly.

Read the commit. Summaries of decisions drift; the commit does not.

## The two shared logs — one file each, on `main`

`memory.md` (the dated decision log) and `context.md` (fast orientation) are **shared by every
session, every worktree and every branch**. They are never forked per branch and never maintained
in parallel.

Worktrees make this need saying out loud. A worktree is a separate checkout, so each one holds its
own working copy of both files — on 2026-08-19 there were four copies of `memory.md` at 425, 464,
479 and 646 lines, all the same tracked path. That is not a bug in git; it is what a checkout is.
The rule is that the copies get **reconciled back onto `main`**, not left to diverge.

Three things make that cheap, and they are already in place:

- `.gitattributes` marks both files `merge=union`, so two branches appending at once merge instead
  of conflicting. Union keeps both sides but cannot know which came first — **check the ordering
  after a merge**.
- `* text=auto eol=lf` in the same file. A single stray CRLF in `memory.md` once blocked a
  fast-forward, because git correctly reported the file as modified.
- Write UTF-8. A latin-1 `§` (0xa7) written by an earlier session made `memory.md` decode-hostile:
  grep classified it as binary and silently matched **nothing**, and python refused to read it. A
  log nobody can grep is not a log. Repaired 2026-08-19.

When you finish a task: append your entry to the top of `memory.md`'s *Recent work*, refresh
`context.md` if the shape of the repo changed, and get both onto `main`.

## House rules

- No GPU is on the critical path; supplier API rate limits are the binding constraint, not compute.
- The disruption forecast is **built, not bought** (2026-08-14) — a real, self-trained model in
  `zkd-risk-model/`, no vendor call, no mock fallback. Every forecast carries
  `source: 'internal-ml'` and a `modelVersion`; see `documentation/design/05-cancellation-risk-model.md`.
  Thresholds adapt per flight, externalized to `zkd-app/config/risk-thresholds.json`; they are not
  fixed at 25/55/80. The confirmation window is derived from supplier offer expiry, not a flat 90
  seconds.
- No live supplier integrations exist; Duffel / LiteAPI sandboxes are the intended proving ground.
- Detection is **webhook-first with two fallbacks** (`server/webhooks/`, then the poller, then a
  member report). Before "improving" the poller, know that **AviationStack cannot push at all** —
  it is pull-only by design, so its 100-calls/month ceiling was never tunable. The receiver is
  live and locally testable; setting `WEBHOOK_PUBLIC_URL` is what registers real subscriptions.
  **Treat a silent feed as a fault, not as good news** — `/ops` exists to make that visible.
- Safety rests on the WAIT window plus a **notification ladder**, not a spend ceiling — the
  ₹25,000 per-transaction cap was removed on 2026-08-19 and silence now proceeds to book. The
  member is told the risk crossed, told the moment it cancelled, and told the exact delta with a
  window to stop it. **This makes an undeliverable channel a safety defect**: check
  `server/notify/index.ts` and the ledger before assuming an alert was seen. The default-deny
  policy layer in `server/policy/` remains designed-and-tested but is still not wired into the
  live path. Quote numbers with
  their evidence tier (`verified` / `calc` / `sim` / `assumed` / `budget` / `deck`).
- When you change behavior, update `memory.md`.

## Workflow

1. Run reproducible checks before and after edits (`iropssim.py` diff, canon hashes).
2. Apply changes to all four canon files as one scripted change-set, never one copy.
3. After finishing a task, record decisions/insights in `memory.md` and refresh `context.md`.
4. Don't touch `Code/` and `zkd-sites/` — they were committed as inert gitlinks and hold no source.