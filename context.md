# context.md — current state of the repository

> **One file, and it lives on `main`** — shared by every session and every worktree, never forked
> per branch. See the note at the top of [`memory.md`](memory.md) for why the copies drift and how
> they are reconciled. This file is the fast orientation; `memory.md` is the dated decision log.

Last refreshed: 2026-08-21, on the **`demo`** branch (this file was untouched since 2026-08-08 —
badly stale — while `memory.md` on this branch was kept current throughout; this refresh reads the
code and the full `memory.md` log, not the old copy of this file).

## Project

ZKD Concierge — Codestreet 2026 / American Express (Team ZKD, IIT Madras). Autonomous
travel-disruption concierge for Indian domestic aviation, framed more broadly than that in
practice (see "International" below): predict/detect an IRROPS event, re-accommodate the member
(flight + hotel + ground), claim duty of care from the carrier, stop safely when it cannot.

**Team, from the commit graph**: Krishna (`Krishna-529`, repo owner) and Dhawal Khatri build
feature branches, largely Claude-assisted (`Co-Authored-By: Claude Opus 4.8/5`); Mohamed Zayaan
("Zayaan" in the log) owns the Postgres/risk-model lineage on a sibling branch (see "Two diverged
lineages" below). **House rule, stated in `AGENTS.md`**: a commit authored by Dhawal with no
`Co-Authored-By: Claude` trailer is authoritative over one that has it — when branches disagree,
find that commit and start from what it actually says.

## This branch vs. the rest of the repo — read this before trusting any other doc in this tree

This repository contains **two significantly diverged lineages** that share a common ancestor
(`5359121`, "Add login/auth and party-level rebooking, wire MyCa and .env for OAG") and have since
built genuinely different, non-overlapping capability:

- **`demo`** (this branch, what the user pointed Claude at) — real cancellation **detection**
  (webhooks + poller + member reports), real member **notifications** (WhatsApp/push), real
  **refund/FX honesty**, real flight+hotel **booking origination**, an Amex-branded UI skin, a
  **learned** (ML discrete-choice) alt-flight ranker, a per-flight journey-window/consent
  override, a real ground-transport supplier (Uber sandbox) and a real hotel supplier (LiteAPI) —
  **but** the risk model is the older 2-country (US+Brazil) build, and the entire Temporal/OPA
  execution plane was deleted (see below).
- **`feature/adaptive-forecast-and-bedrock-refinement`** (Zayaan's branch, NOT this one — the repo
  root's `.git` clone was sitting on this branch before today's session switched it to `demo`) —
  a stronger, 5-country + India-prior risk model with real overfitting diagnostics, neighbor-
  smoothed forecasting, a real LangGraph.js `StateGraph`, a first real Bedrock use (preference
  refinement), an autopilot notice window, and a **real Temporal saga + OPA policy plane**
  (`zkd-execute`/`zkd-shared`/`policy/`) enforcing a hard PLAN/EXECUTE authority boundary — **but**
  no real detection wiring, no notifications, no real refund/FX, no real booking origination, no
  Amex UI, and a simpler (deterministic, not learned) ranker.

**Do not read old copies of `context.md`/`memory.md` on other branches/worktrees as describing this
branch.** They describe the other lineage. The two branches never merged back into each other after
`5359121`; reconciling them (or deliberately choosing one path per capability) is the single
biggest architectural decision this project has open right now — see "Cross-lineage opportunity"
under Known gaps.

## The EXECUTE plane was deleted on this branch — there is currently no enforced spend gate

This is the most important fact in this file. The real Temporal saga + OPA policy sidecar
(`zkd-execute/`, `zkd-shared/`, `policy/*.rego`, `infra/execution-plane/`, `docker-compose.yml`)
that the other lineage built **do not exist on `demo`** — confirmed via `git ls-tree`, not
assumed. What replaced it:

- `server/policy/index.ts` — a real, unit-tested, default-deny TypeScript policy gate (12 rules:
  `voluntary_under_autopilot`, `fare_class_ceiling`, `exposure_cap_exceeded`,
  `incoherent_bundle`, etc.), written as a 1:1 stand-in for the Rego canon specifies, because `opa`
  isn't available in this environment. **Confirmed today: `evaluatePolicy` has exactly one
  importer in the whole repo — its own test file (`tests/policy.test.ts`).** No route, no pipeline
  step calls it. It is real and tested, and it is inert.
- The ₹25,000 per-transaction spend cap was **deliberately removed on 2026-08-19** (Dhawal's
  call — a stranded member seeing their only seat home greyed out as "over your cap" was judged a
  refusal dressed as protection). It was replaced by a four-rung **notification ladder**
  (`server/notify/templates.ts`): risk crossed → cancelled → *"about to spend ₹N after your
  refund, you have M minutes to stop us"* → booked. Silence now **proceeds** on every consent
  tier (this restores the frozen canon's own Tier A mechanics, which the app had drifted away
  from).
- **A confirmed, still-open safety defect** (found by `ZKD-Gap-Audit-Session-Report.md`,
  2026-08-19, and re-verified today — `grep 'delivered'` in `server/engine/simulation.ts` still
  returns nothing): `server/notify/index.ts`'s `dispatch()` computes `delivered` (whether *any*
  channel actually got through) and logs it, but **nothing in the consent path reads it.** A
  member whose WhatsApp and push both fail is indistinguishable, to the system, from a member who
  saw rung 3 and chose not to object — and is charged. Since the cap removal, notification
  delivery is the **only** remaining control on an unattended spend, and it is currently unchecked.

**Net effect: today, on `demo`, nothing in the live code path stops an autonomous booking based on
policy or amount.** The only backstops left are Amex's own card-issuer authorization declining the
charge, and whatever a member actually reads and acts on. This is not a hypothetical — it is the
literal current state of the code, confirmed by two independent audits (the 2026-08-19 one and
today's).

## No-holds design (unchanged from the other lineage's understanding, confirmed still in force)

Speculative holds were removed from the design entirely (2026-08-17) — a passenger cannot hold two
tickets, so pre-claiming a replacement before the carrier cancels risks a duplicate booking a
carrier's own audit later cancels. Replaced by a **refresh loop** that keeps N valid
flight+hotel+ground *bundles* policy-passing and re-shopped ahead of the soonest `offer_expiry`
(`refreshCadence.ts`). Nothing is claimed before the carrier acts, on flights, hotels, or ground.

## Key architectural commitments (demo branch, verified today)

| Topic | Commitment |
|---|---|
| Detection | **Three lanes, webhook-first**, real (not aspirational): `server/webhooks/` (Duffel + AeroDataBox adapters + an inert OAG stub, `server/webhooks/index.ts`), `server/engine/statusPoller.ts` (AviationStack fallback, 15/month ceiling — the free-tier ceiling is not tunable, AviationStack cannot push at all), `server/engine/memberReports.ts` (a report starts the *reporter's* own recovery immediately; corroborates for everyone else at 3 independent reporters, or a carrier feed, or an operator). `/ops` shows which lane is live; a dead feed is treated as a fault, not as a quiet week. |
| Ranking | **Learned, not hand-tuned (2026-08-20).** `server/pipeline/ranker/` replaced ~35 hand-set weighted-sum constants with a conditional-logit (discrete-choice) model fitted on which alternative a member actually picked from each shown set. Smart init blends a strategy prior + MyCa warm start + learned global + learned per-member via empirical-Bayes shrinkage, gated by a hard minData floor; monotonicity enforced by clipping (cheaper/earlier is never ranked worse); bookability enters as a fixed log-offset, not a competing weight; each option's own carrier+route cancellation-model rate becomes a `stability` feature; near-tie exploration exists (`explore.ts`) but is **off by default** — no live experimentation on real members. `applyHardRules`, `OptionScore`, and `explain()` are unchanged, so nothing downstream moved. 23 ranker unit tests. `lib/ranking.ts` is **dead code** — no importers — the live ranker is `server/pipeline/score.ts` calling into `ranker/`. |
| Journey window / consent override (2026-08-20, explicitly labeled "temporary" in its own commit) | Before a booked flight is disrupted, a member can set — per flight, never written to their durable MyCa profile — the earliest a replacement may depart, the latest it may arrive, and whether rebooking should be autonomous or ask-first for *that flight only*. Stored one row per `(flightId, passengerId)` in a new `journey_prefs` table (migration `0003_journey_prefs.sql`). The window is applied as **hard rules** (filtered, not penalized) via a new `Flight.earliestDepartISO` mirroring the existing `hardDeadlineISO`. Consent resolves through one pure function, `resolveConsent(profileConsent, override)` — override wins, `null` means use the standing profile. |
| Money shown to the member | Three figures, never one (2026-08-19, `bdbd5f4`): what the plan costs, what comes back (`server/domain/refund.ts`, **computed since 2026-08-19**, statutory entitlement overrides voluntary-cancellation fare rules when the *carrier* cancels), and the delta actually paid. Absent a recorded fare, refund reads **"not known yet"**, never ₹0. Refund scales by **party size** (fixed 2026-08-19, `8f1db4b` — was previously computed per-ticket and compared against a party-scaled replacement, understating a 6-person refund by ~32,250). A stale fabricated `fare:0/seats:99` "carrier owes you a free seat" row-type was deleted, but its **already-written rows survived in Postgres** until a read-path guard (`dropFabricatedAlts()`) was added — the lesson recorded in `memory.md`: deleting a writer is not the same job as purging what it already wrote. |
| Currency | **Converts, doesn't refuse (2026-08-19).** `server/fx.ts` (Frankfurter/ECB daily rate, keyless, committed fallback table) replaced a `needsConversion` guard that had been silently emptying the option list on every EUR-priced Duffel offer — the flights side of this was live-breaking before the fix. Hotel FX is flagged as the remaining prerequisite for a genuinely international demo (see "International" below). |
| Real bookings | **Booking is now the only way a flight is created** (2026-08-19) — `POST /api/flights` and the `/ops` create-flight form are gone; `POST /api/bookings` / `POST /api/bookings/hotel` do the real thing. A hardcoded `farePaid: 6500` invented on every booking was removed — OAG sells schedules, not fares, so no price exists at booking time; an absent fare now honestly reads `known:false` rather than a wrong number propagating through every alternative's delta. |
| Suppliers (verified substantially more real than the stale audit trail claimed) | **Flights**: Duffel (real, search+write) + OAG (real, `flightInstancesByRoute` — the query-shape blocker resolved 2026-08-17) + Travelport (mock). **Hotels**: LiteAPI is a **registered, live-called** `HotelSupplier` (only the *legacy* `/api/hotels` route still uses seeded mock inventory). **Ground**: `server/ground/index.ts` is a **real Uber sandbox integration**, OAuth2 client-credentials, with an exercised cancel/rollback path — `mockCabs.ts` is the fallback, not the implementation. **Payment**: fully mocked, no live integration. |
| International capability | Substantially further along than any doc states (per the 2026-08-19 gap audit, re-confirmed): a **5-regime jurisdiction engine** (`IN-DGCA`, `EU261`, `UK261`, `US-DOT`, `CARD-TERMS` fallback, correct EU/UK departure-vs-arrival attachment rules), a **6,072-airport worldwide table** (not an Indian subset), and a risk model trained on **real US DOT/BTS + Brazil ANAC data** (India is synthetic-only). What blocks an actual international demo is small: billing currency and hotel search hardcode `INR`/`'IN'`; seed fixtures are Delhi-only; `US-DOT`/`CARD-TERMS` entitlement bundles have no persona exercising them. See `ZKD-Gap-Audit-Session-Report.md` §4 for the itemized fix list. |
| Risk model (**demo branch's own build — weaker than the sibling lineage's, see below**) | Self-trained XGBoost, real US DOT/BTS + Brazil ANAC data (7.9M rows: 5.53M train / 1.18M calib / 1.18M test), India synthetic-only. **ROC-AUC 0.804, PR-AUC 0.123, Brier 0.0097**, trained 2026-08-15. This is the **2-country** build — it does NOT include the other lineage's later UK/Australia/France expansion, India DGCA carrier-rate prior, or overfitting/underfitting diagnostics (ROC-AUC 0.829 there). Porting that better-trained model onto `demo` is a concrete, low-risk, high-value opportunity — see Known gaps. |
| Money-flow invariant | §10 of `documentation/design/03-action-policy.md`: every spend and every refund route through the same Amex card, so the balance can never go negative *by design* — but as stated above, the mechanism enforcing this is now informed-consent-by-delivery, not a hard ceiling, and delivery itself is unchecked. §10 states this trade explicitly; don't let a skim of the invariant's headline hide the trade underneath it. |
| Continual learning | **Still not built**, same gap as the other lineage: `logOutcome()` in `server/decisionLedger.ts` has zero callers (found 2026-08-18) — predictions accumulate, outcomes never do, so no live accuracy claim about the deployed model is computable today. |
| UI | Two themes in one stylesheet — `:root` in `app/globals.css` is a dark default; a complete, separately-scoped Amex light skin (`--amex-blue`, `--amex-bg`, ~105 override rules) lives under `.amex-page`, switched on per-route by `lib/amexRoutes.ts` (`/`, `/login`, `/flights`, everything under `/flights/`). **A token grep for `--bg` will report this app as dark-only — that is wrong for every member-facing flight screen**, and a session already made exactly that mistake on 2026-08-19 while the user was looking at the light theme. Read `amexRoutes.ts`, never grep the token declarations, when the question is "which theme is a screen using." |
| Mobile client | `zkd-android/` (Expo/RN, 4-screen subset) is what's actually tracked in this repo. A `zkd-flutter/` (5-screen Flutter rewrite, "Expo dropped; Flutter is the client") was reported to exist by the 2026-08-19 gap audit but **is entirely untracked in git** — not recoverable from any branch. The server's push notification limb (`server/notify/push.ts`) still targets Expo (`EXPO_ACCESS_TOKEN`), which won't reach a Flutter client — if Flutter is really the demo client, push notifications need to move to FCM or the team accepts WhatsApp as the sole channel (whose Twilio trial session also expires after 24h idle — re-join on demo morning). **Verify which client is actually being demoed before trusting any Android-specific claim in this file.** |
| Public Wi-Fi | Demo servers bind `0.0.0.0` — never run on conference/public Wi-Fi. |

## Reproducibility contract (verified green today, 2026-08-21)

1. `python3 iropssim.py | diff - iropssim-output.json` → empty. **Verified.**
2. Four canon hashes match (`6294649430f22e26` across all four `*_v2.0.md`). **Verified.**
3. `zkd-app`: `npx tsc --noEmit` clean. **Verified.** `npx vitest run` → **222 passed / 5 skipped /
   8 failed** — all 8 failures are `ECONNREFUSED 127.0.0.1:5433` (no local Postgres running;
   `docker-compose` no longer exists on this branch to start one, since the EXECUTE-plane compose
   file was deleted — see below), not real regressions. Note: unlike the sibling lineage, these
   DB-gated tests (`memberReports.test.ts`, one case in `webhooks/lane.test.ts`) **hard-fail rather
   than self-skip** without a reachable database — a cheap fix (gate on `DATABASE_URL`/a reachability
   probe, matching the pattern used elsewhere in this codebase) would make `npm test` genuinely
   green out of the box for anyone who clones this branch without standing up Postgres.
   `npm run build` (webpack) — **succeeds**, verified today with dummy `SESSION_SECRET`/
   `OPS_SECRET`/`OPS_ACCESS_KEY`.
4. `zkd-risk-model`: `pytest -v` — not re-run today (no code changes to it on this branch since the
   2026-08-15 train), last known-good per its own CI job.

## Directory map (demo branch — significantly different from any stale copy of this file)

- `zkd-app/` — the only product surface. Next.js 16/React 19. Routes: `/flights` `/flights/[id]`
  `/prepare/[id]` `/recovery/[id]` `/profile` `/settings` `/history` `/how-it-works` `/ops`
  (operator console, direct URL only, gained "Ramp risk"/"Reset demo" sticky-override controls
  2026-08-21). No `zkd-execute`, `zkd-shared`, `docker-compose.yml`, or root `policy/` — **do not
  look for them, they were deleted on this branch.**
  - `server/domain/` — Postgres store (`store.ts`), types, `refund.ts` (real, party-scaled),
    `views.ts` (`dropFabricatedAlts()` read-path guard), migrations (`0003_journey_prefs.sql` is
    the newest).
  - `server/engine/` — `simulation.ts` (the lifecycle engine — **still no `delivered` check, see
    above**), `statusPoller.ts`, `memberReports.ts`, `batchScorer.ts`, `forecast.ts`,
    `riskModel.ts`, `thresholds.ts`. **No `planningGraph.ts` (no LangGraph on this branch), no
    `neighborSmoothing.ts`, no `topReason.ts`, no `bedrock.ts` anywhere in `server/`** — those are
    the other lineage's work, not this branch's.
  - `server/pipeline/` — `index.ts` (the state machine), `score.ts` (calls into `ranker/`),
    `saga.ts`, `journal.ts`, `verify.ts`. `server/pipeline/ranker/` — the learned discrete-choice
    model (`features.ts`, `weights.ts`, `model.ts`, `bookability.ts`, `cancelRisk.ts`,
    `explore.ts`, `decisionLog.ts`, `train.ts`, `model.json` artifact).
  - `server/preferences/` — `adapt.ts`, `intent.ts` (free-text at `/prepare`, pre-emptive),
    `journeyPrefs.ts` (validation for the per-flight window).
  - `server/notify/` — `index.ts` (`dispatch()`), `templates.ts` (the four-rung ladder copy),
    `whatsapp.ts` (Twilio), `push.ts` (Expo). Telegram was dropped 2026-08-17.
  - `server/webhooks/` — `index.ts` (the receiver), adapters for Duffel/AeroDataBox/OAG (OAG
    deliberately stubbed inert — no active subscription).
  - `server/policy/index.ts` — the unwired default-deny gate, see above.
  - `server/ground/` (real Uber sandbox), `server/hotels/` (LiteAPI + Duffel Stays), `server/fx.ts`,
    `server/oag.ts`, `server/oag-fixtures/` (recorded real responses, `OAG_REPLAY=1`).
  - `app/api/` — see the full current route list embedded in this session's build output;
    notable additions over any older doc: `bookings`, `bookings/hotel`, `devices`,
    `flights/[id]/demo-risk`, `flights/[id]/intent`, `flights/[id]/journey`,
    `flights/[id]/report-cancellation`, `flights/[id]/warm`, `ops/demo-reset`, `pipeline/*`,
    `search/flights`, `search/hotels`, `webhooks/flight-status/[provider]`.
- `zkd-risk-model/` — 2-country (US+Brazil) build on this branch, see above. Own `README.md`,
  `MODEL_CARD.md`.
- `zkd-android/` — tracked Expo/RN subset. See the "Mobile client" row above for the untracked
  Flutter question.
- `documentation/` — `agent-specs/current/` (canon), `design/01`–`06` (05 supersedes 01 §2; **06 is
  new since the old copy of this file**, `06-experience-kpis.md`, deliberately no target values or
  composite score yet), `architecture/`, `project/` (`SUBMISSION.md`, `mentor-meetings.md`, new).
  **`design/03-action-policy.md` §11 ("Today: reactive... no poller, cron, webhook or worker")
  is now stale against the code** — three real detection lanes exist since 2026-08-19 — flagged
  by the gap audit as needing a fix before the doc is shown to judges; not yet fixed.
- `ZKD-Gap-Audit-Session-Report.md`, `ZKD-Rebooking-Pipeline-Session-Report.md` (+
  `.VERIFICATION.md`) — dated session reports living at repo root, **not yet merged into `demo`**
  — see "Active unmerged branches" below.
- `amex-travel-disruption-concierge/` — separate, earlier Temporal+OPA saga/rollback
  proof-of-concept. Not part of either lineage's live product.
- `iropssim.py` + `iropssim-output.json`, `assets/`, `tools/`, `zkd-website/`/`zkd-launcher/`/
  `zkd-sites/`/`Code/` — unchanged in kind from prior descriptions.

## Active unmerged branches on `origin` (as of 2026-08-21 — check before assuming `demo` is final)

Six branches exist beyond `demo` that are **not yet reflected in it**. Do not duplicate their work;
merge or explicitly supersede it instead.

| Branch | Contains | Status |
|---|---|---|
| `worktree-gap-audit-report` | `ZKD-Gap-Audit-Session-Report.md` (already read into this file, see above) + a real **Fast2SMS** notification channel ("give SMS a channel that can actually reach an Indian phone" — likely the real fix for India-reachable SMS, previously rejected as needing DLT registration). 2 commits ahead of `bdbd5f4`, predates the learned ranker/journey-window merge. | Report content already folded in above; the Fast2SMS code itself is **not yet on `demo`** — worth merging. |
| `worktree-live-risk-weights` | `e06ad4f` "Add two live disruption-risk features to the alternate-flight ranker" — new `server/risk/` (`weatherRisk.ts`, `notam.ts`, `gdelt.ts`) feeding live weather/NOTAM/geopolitical signal into the ranker's `cancelRisk` feature. Branches from `9477b6f`, **before** the Aug-19 refund/FX/Amex-theme work and before `c562e0c` merged the ranker to `main` — needs a rebase onto `demo` tip before it can merge cleanly. | Not on `demo`. Real, additive capability — worth rebasing and merging. |
| `worktree-preference-refinement` | The free-text refine loop that collided with `intent.ts` (see `memory.md`'s 2026-08-19 "collision resolved" entry) — **superseded**. Its useful pieces (the `unsupported[]` reporting, the monetary-field question) were already manually resolved into `intent.ts` on `demo`. | **Do not merge as-is** — would reintroduce a resolved conflict. Safe to archive. |
| `docs/meeting-2-kpis`, `worktree-intent-refund-detection`, `worktree-learned-alt-ranker` | Already merged into `demo` (`6db7977`, the intent/refund/webhook commits, and `7b24b8c`/`9477b6f`/`c562e0c` respectively). | Merged — stale branch refs, safe to delete once confirmed. |

## Evidence tiers

`verified` · `calc` · `sim` · `assumed` · `budget` · `deck`. Known gap: DGCA duty-of-care
thresholds carry `deck` until primary CAR text is re-retrieved (unchanged from every prior audit).

## Known gaps (current, as of 2026-08-21, this branch)

- **No enforced spend/policy gate anywhere in the live path** — `server/policy/index.ts` is real
  and unwired; the ₹25,000 cap that used to backstop this was removed 2026-08-19. Highest-priority
  open item on this branch.
- **The one confirmed safety defect**: `dispatch()`'s `delivered` result is computed, logged, and
  never read by the consent path. A member no channel reached is charged exactly as if they'd been
  told and stayed silent. Fix is scoped and specific (feed `DispatchResult.delivered` into
  `simulation.ts`; on a fully-undelivered notify, extend/retry or halt to `/ops` rather than
  proceeding) — see `ZKD-Gap-Audit-Session-Report.md` §3.
- **Cross-lineage opportunity**: this branch's risk model (2-country, ROC-AUC 0.804) is measurably
  weaker than the sibling `feature/adaptive-forecast-and-bedrock-refinement` branch's model
  (5-country + India carrier prior, ROC-AUC 0.829, with real overfitting diagnostics). Porting the
  better-trained artifacts (or the ingestion/training code) is concrete and low-risk — the serving
  interface (`inference.py`'s `score()`) is shared and stable across both.
- **`design/03-action-policy.md` §11 is stale** — still describes detection as "no poller, cron,
  webhook or worker exists," contradicted by the three real lanes shipped 2026-08-19.
- **DB-gated tests hard-fail instead of skipping** without a reachable Postgres
  (`memberReports.test.ts` + one `webhooks/lane.test.ts` case) — cosmetic but makes `npm test`
  report false negatives on a fresh clone.
- **Continual-learning outcome-join not built** — `logOutcome()` has zero callers; no live accuracy
  claim about the deployed model is computable.
- **`zkd-flutter/` is untracked** — if it's the actual demo client, it does not exist in any branch
  of this repository and cannot be recovered from git; also the server push limb still targets
  Expo, not FCM.
- **P1–P5 canonical personas (identical across all four agent specs) have zero automated test
  coverage** — flagged by the gap audit as "the single highest-value test the repo is missing,"
  because P3 (FATIMA) is exactly the case a lazy `disruption ⇒ airline pays` default gets wrong,
  and getting it wrong breaks the payment path silently rather than visibly.
- **International demo is four small fixes away, not a redesign** — billing currency/hotel search
  hardcode `INR`/`'IN'`; seed fixtures are Delhi-only; see `ZKD-Gap-Audit-Session-Report.md` §4.
- DGCA duty-of-care thresholds still carry `deck` evidence tier.
- Payment fully mocked; no live payment integration exists on either lineage.
- Six branches on `origin` not yet reconciled into `demo` — see table above.
