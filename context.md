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
  importer in the whole repo — its own test file (`server/policy/policy.test.ts`, moved from
  `tests/policy.test.ts` 2026-08-21 so vitest actually reports its 79 assertions).** No route, no pipeline
  step calls it. It is real and tested, and it is inert.
- The ₹25,000 per-transaction spend cap was **deliberately removed on 2026-08-19** (Dhawal's
  call — a stranded member seeing their only seat home greyed out as "over your cap" was judged a
  refusal dressed as protection). It was replaced by a four-rung **notification ladder**
  (`server/notify/templates.ts`): risk crossed → cancelled → *"about to spend ₹N after your
  refund, you have M minutes to stop us"* → booked. Silence now **proceeds** on every consent
  tier (this restores the frozen canon's own Tier A mechanics, which the app had drifted away
  from).
- **The `delivered` defect found by `ZKD-Gap-Audit-Session-Report.md` §3 is now fixed (2026-08-21,
  `f71c7aa`).** `settleExpired()` in `server/engine/simulation.ts` now awaits rung 3's
  `DispatchResult.delivered` before proceeding: undelivered gets exactly one fixed 5-minute grace
  retry (`RecoveryTask.undeliveredGraceUsed` prevents a second one — this is a safety-net retry for
  a transient provider failure, not a second negotiation), and if the retry also goes undelivered
  the task halts to a human (`kind: 'handed-over'`) rather than booking on an amount nobody was
  confirmably told about. New `server/engine/simulation.ts` test coverage (previously zero) drives
  the real `detectDisruption()` entry point through the real timer chain with fake timers.

**Net effect: the notification-delivery half of the safety story is now real** — an unattended spend
can no longer proceed past a rung-3 message nobody received. What is **still** true: there is no
amount- or policy-based backstop at all (`server/policy/index.ts` remains unwired — see above), so
a message that *does* deliver, to a member who simply doesn't respond, still proceeds to book
whatever amount rung 3 named, exactly as designed. The only backstops beyond that are Amex's own
card-issuer authorization declining the charge, and the member actually reading and acting on what
they were sent.

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
| Ranking | **Learned, not hand-tuned (2026-08-20).** `server/pipeline/ranker/` replaced ~35 hand-set weighted-sum constants with a conditional-logit (discrete-choice) model fitted on which alternative a member actually picked from each shown set. Smart init blends a strategy prior + MyCa warm start + learned global + learned per-member via empirical-Bayes shrinkage, gated by a hard minData floor; monotonicity enforced by clipping (cheaper/earlier is never ranked worse); bookability enters as a fixed log-offset, not a competing weight; each option's own carrier+route cancellation-model rate becomes a `stability` feature; near-tie exploration exists (`explore.ts`) but is **off by default** (`epsilon: 0.0` in the live `model.json`) — no live experimentation on real members. `applyHardRules`, `OptionScore`, and `explain()` are unchanged, so nothing downstream moved. 23 ranker unit tests. `lib/ranking.ts` is **dead code** — no importers — the live ranker is `server/pipeline/score.ts` calling into `ranker/`. **Continual learning is now wired (2026-08-21), offline rather than in the live path.** `logShownSet` fires live on every ranking call; the label half was closed not by calling `logChoice` from the hot consent/spend path (deliberately avoided — that path was just hardened, see the delivery-check fix above, and adding more live call sites under time pressure was judged riskier than necessary), but by a new offline join, `server/pipeline/ranker/reconcile.ts`: `train.ts`'s CLI entrypoint now reads every resolved `RecoveryTask` from Postgres and matches each one's `chosenAltId` against the most recent shown-set logged before it resolved, producing real training pairs with no change to `simulation.ts`. 8 new unit tests (`reconcile.test.ts`), degrades to zero-observations (never throws) if Postgres is unreachable. **Still cold-started in practice** — `model.json` is v1 (`learnedByStrategy: {}`), and this branch has no accumulated resolved-task history yet to reconcile against; the mechanism is real, the training data isn't there until real recoveries resolve. Also fixed in passing: `server/domain/store.ts` imported `./db` without an extension, which is invisible under webpack but broke `train.ts` when run standalone via `node --experimental-strip-types` (its own documented invocation) — changed to `./db.ts`. **Full correctness/robustness audit, 2026-08-21 (later): 7 real bugs found and fixed** in `score.ts`/`altsForParty.ts`/`ranker/*` — see the dedicated "Alt-flight ranking hardening" row below. |
| Alt-flight ranking hardening (2026-08-21) | A full audit of the alt-flight ranking pipeline (`score.ts`, `altsForParty.ts`, `ranker/*`) — previously zero vitest coverage on `score.ts`/`altsForParty.ts` despite being the most consequential files in the product — found and fixed 7 real, verified bugs, all with regression tests (40 new tests across 3 new files: `score.test.ts`, `altsForParty.test.ts`, plus additions to `ranker.test.ts`'s siblings): **(1)** `applyHardRules`'s `avoidAirlines` check only inspected a connecting alt's FIRST leg — a member who said "never book me on X" could still be booked onto a connection whose SECOND leg was X. **(2)** The same single-leg blindness existed in the ranker's own loyalty FEATURE (not just display) — a status carrier operating a connection's second leg got zero ranking credit. **(3)** The alt's own cancellation-risk feature had the same bug, scoring a connection only on its first leg's carrier rather than the worst (most conservative) of all legs. All three now use `ranker/features.ts`'s `carriersOf()` consistently. **(4)** A single malformed candidate (NaN/undefined fare, seats, or arrival time — real supplier-integration noise, not hypothetical) could corrupt the ENTIRE choice set's ranking: `model.ts`'s softmax subtracts the set's max utility before exponentiating, so one NaN utility poisons every OTHER candidate's choice probability too. Fixed with defense in depth: `features.ts` now sanitizes every computed feature to a finite fallback, `model.ts` independently guards against a non-finite utility slipping through, and `score.ts`'s shared display aggregates (`bestArrival`, the cost `band`) now filter with `Number.isFinite` instead of `typeof n === 'number'` (which is TRUE for NaN in JS) — a bug that let one broken candidate blank out every OTHER candidate's display bars, not just its own. **(5)** `altsForParty.ts` now validates fare/seats at the one choke point every consumer passes through — a NaN/negative fare is DISQUALIFIED (never coerced to 0, which would recreate the exact fabricated-free-option danger this codebase already fought hard to eliminate); a bad seat count safely floors to "no seats". **(6)** The most serious finding: `dropFabricatedAlts()` (the defense against stale `fare:0/seats:99` rows left over from the deleted `carrierProtectedAlt()` writer) was only wired into the member-facing DISPLAY path (`views.ts`) — every live decision-making call site (`pipeline/index.ts`, `simulation.ts`, the intent route) called `altsForParty` directly on raw stored data and never filtered fabricated rows at all. Since a stale fabricated row only survives in Postgres if it's PINNED to an unresolved recovery (`altsCache.ts`'s `mergePinned`), this was exactly the highest-risk case: a free-looking fabricated row that's the CURRENTLY CHOSEN option for an in-flight recovery would be hidden from the member's screen while still being what the live pipeline could act on. Fixed by moving the check into `altsForParty` itself. **(7)** `explore.ts`'s propensity tracking (needed for unbiased offline/counterfactual evaluation, per this session's earlier note about borrowing that technique from large-scale recommenders) left the LAST element's propensity stale at its default when it was the second half of an unswapped near-tie pair — silently biasing IPW the moment exploration is ever turned on (currently off by default, so no live impact today, but a real latent bug in exactly the machinery a future improvement would depend on). **Also fixed, a UX/trust bug found while testing #2**: `explain()`'s detail sentence used to always show the first two notes in a FIXED axis order (arrival, cost) regardless of which criterion actually led — so a loyalty-led pick could say "we picked this because it keeps you on an airline you hold status with" and then talk about arrival time without ever mentioning the carrier. Notes are now tagged by criterion so the detail sentence actually supports its own stated reason. Verified throughout: `tsc --noEmit` clean, `npm test` 310 passed (up from 260 before this session's work began) / 8 pre-existing DB-gated failures / 5 skipped, `pipeline/verify.ts`'s 33 checks all pass, `next build` succeeds. |
| Notifications, live-vs-code-ready status | **WhatsApp** (`server/notify/whatsapp.ts`) supports a Meta-approved template path (no join-code) alongside the Twilio sandbox path, but `TWILIO_WHATSAPP_CONTENT_SID` is unset in `.env.example` — **still sandbox-only today**, needs a real member join-code, not yet demo-verified on the template path. **Android push** (Expo) is wired (`POST /api/devices`) but `zkd-android/app.json` has no `eas.projectId`, so a standalone build silently falls back to local-only notifications — untested on a real device build. **Fast2SMS** (merged 2026-08-21 from `worktree-gap-audit-report`) is real, env-key-gated, degrades to `isConfigured():false` cleanly when unset. Telegram fully removed. |
| Journey window / consent override (2026-08-20, explicitly labeled "temporary" in its own commit) | Before a booked flight is disrupted, a member can set — per flight, never written to their durable MyCa profile — the earliest a replacement may depart, the latest it may arrive, and whether rebooking should be autonomous or ask-first for *that flight only*. Stored one row per `(flightId, passengerId)` in a new `journey_prefs` table (migration `0003_journey_prefs.sql`). The window is applied as **hard rules** (filtered, not penalized) via a new `Flight.earliestDepartISO` mirroring the existing `hardDeadlineISO`. Consent resolves through one pure function, `resolveConsent(profileConsent, override)` — override wins, `null` means use the standing profile. |
| Money shown to the member | Three figures, never one (2026-08-19, `bdbd5f4`): what the plan costs, what comes back (`server/domain/refund.ts`, **computed since 2026-08-19**, statutory entitlement overrides voluntary-cancellation fare rules when the *carrier* cancels), and the delta actually paid. Absent a recorded fare, refund reads **"not known yet"**, never ₹0. Refund scales by **party size** (fixed 2026-08-19, `8f1db4b` — was previously computed per-ticket and compared against a party-scaled replacement, understating a 6-person refund by ~32,250). A stale fabricated `fare:0/seats:99` "carrier owes you a free seat" row-type was deleted, but its **already-written rows survived in Postgres** until a read-path guard (`dropFabricatedAlts()`) was added — the lesson recorded in `memory.md`: deleting a writer is not the same job as purging what it already wrote. |
| Currency | **Converts, doesn't refuse (2026-08-19).** `server/fx.ts` (Frankfurter/ECB daily rate, keyless, committed fallback table) replaced a `needsConversion` guard that had been silently emptying the option list on every EUR-priced Duffel offer — the flights side of this was live-breaking before the fix. Hotel FX is flagged as the remaining prerequisite for a genuinely international demo (see "International" below). |
| Real bookings | **Booking is now the only way a flight is created** (2026-08-19) — `POST /api/flights` and the `/ops` create-flight form are gone; `POST /api/bookings` / `POST /api/bookings/hotel` do the real thing. A hardcoded `farePaid: 6500` invented on every booking was removed — OAG sells schedules, not fares, so no price exists at booking time; an absent fare now honestly reads `known:false` rather than a wrong number propagating through every alternative's delta. |
| Suppliers (verified substantially more real than the stale audit trail claimed) | **Flights**: Duffel (real, search+write) + OAG (real, `flightInstancesByRoute` — the query-shape blocker resolved 2026-08-17) + Travelport (mock). **Hotels**: LiteAPI is a **registered, live-called** `HotelSupplier` (only the *legacy* `/api/hotels` route still uses seeded mock inventory). **Ground**: `server/ground/index.ts` is a **real Uber sandbox integration**, OAuth2 client-credentials, with an exercised cancel/rollback path — `mockCabs.ts` is the fallback, not the implementation. **Payment**: fully mocked, no live integration. |
| International capability | Substantially further along than any doc states (per the 2026-08-19 gap audit, re-confirmed): a **5-regime jurisdiction engine** (`IN-DGCA`, `EU261`, `UK261`, `US-DOT`, `CARD-TERMS` fallback, correct EU/UK departure-vs-arrival attachment rules), a **6,072-airport worldwide table** (not an Indian subset), a risk model trained on **real US DOT/BTS + Brazil ANAC data** (India is synthetic-only), and a **real MAA→DEL→LHR flagship itinerary already seeded** (`u1`/`u2`, Priya's canonical P1 scenario — this existed before today, the gap audit's "seed the LHR persona" recommendation was already satisfied). **Fixed 2026-08-21**: `app/api/search/hotels/route.ts` (hotel origination search) hardcoded `currency: 'INR'` regardless of destination — now derives the destination's real currency (`server/fx.ts`'s new `currencyForCountry()`, a small country→currency map covering the currencies `FALLBACK_RATES` already prices) and adds a converted `totalInBillingCurrency` figure alongside the supplier's original quote. **Deliberately NOT fixed today**: `server/pipeline/index.ts`'s `arrangeOvernight` — the LIVE RECOVERY-flow hotel search — still hardcodes INR. Matters only when a disrupted flight's own departure airport is itself international (e.g. a returning LHR→DEL flight); scoped out because changing it touches a spend-adjacent hot path and needs `applyHotelRules`/`affordabilityVeto`/ground-cap comparisons verified currency-safe first, which wasn't done under this session's time budget. `US-DOT`/`CARD-TERMS` entitlement bundles still have no persona exercising them. See `ZKD-Gap-Audit-Session-Report.md` §4. |
| Risk model (**demo branch's own build — weaker than the sibling lineage's, see below**) | Self-trained XGBoost, real US DOT/BTS + Brazil ANAC data (7.9M rows: 5.53M train / 1.18M calib / 1.18M test), India synthetic-only. **ROC-AUC 0.804, PR-AUC 0.123, Brier 0.0097**, trained 2026-08-15. This is the **2-country** build — it does NOT include the other lineage's later UK/Australia/France expansion, India DGCA carrier-rate prior, or overfitting/underfitting diagnostics (ROC-AUC 0.829 there). Live score distribution (`reports/score_distribution.json`, n=168,000): min 1.64%, p50 3.22%, p90 6.45%, p99 9.74%, max 10.33%. `config/risk-thresholds.json`'s bands (`prepare:4/holdGate:6/preAuthorise:11`, floor `9`) are internally consistent with this distribution — `preAuthorise` is reachable by roughly the top 1%, not stale on this branch specifically (re-verify after any model swap). Porting the better-trained model onto `demo` is a concrete, low-risk, high-value opportunity — see Known gaps. |
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

**Update, same day, after this table was first written**: `worktree-gap-audit-report` and
`worktree-live-risk-weights` (rows below) were merged into local `demo` (`e15c0b1`, `8cc2406`) —
Fast2SMS and the live weather/NOTAM/GDELT ranker features are now real, present code on this
branch, not aspirational. **Not yet pushed to `origin/demo`** — local `demo` is currently 8 commits
ahead of `origin/demo` pending a review/push decision. Four branches remain genuinely unreconciled.

| Branch | Contains | Status |
|---|---|---|
| `worktree-gap-audit-report` | `ZKD-Gap-Audit-Session-Report.md` + a real **Fast2SMS** notification channel. | **Merged into local `demo`** (`e15c0b1`). |
| `worktree-live-risk-weights` | `e06ad4f` — new `server/risk/` (`weatherRisk.ts`, `notam.ts`, `gdelt.ts`, both with `AbortSignal.timeout` guards, no hardcoded keys) feeding live weather/NOTAM/geopolitical signal into the ranker's `cancelRisk` feature. | **Merged into local `demo`** (`8cc2406`). |
| `worktree-preference-refinement` | The free-text refine loop that collided with `intent.ts` (see `memory.md`'s 2026-08-19 "collision resolved" entry) — **superseded**. Its useful pieces (the `unsupported[]` reporting, the monetary-field question) were already manually resolved into `intent.ts` on `demo`. | **Do not merge as-is** — would reintroduce a resolved conflict. Safe to archive. |
| `docs/meeting-2-kpis`, `worktree-intent-refund-detection`, `worktree-learned-alt-ranker` | Already merged into `demo` (`6db7977`, the intent/refund/webhook commits, and `7b24b8c`/`9477b6f`/`c562e0c` respectively). | Merged — stale branch refs, safe to delete once confirmed. |

## Evidence tiers

`verified` · `calc` · `sim` · `assumed` · `budget` · `deck`. Known gap: DGCA duty-of-care
thresholds carry `deck` until primary CAR text is re-retrieved (unchanged from every prior audit).

## Full-codebase security & robustness audit (2026-08-21)

On the user's explicit request to find anything "not built up to the standards and scale of Amex,"
four parallel read-only research passes covered security/access-control, the data layer/state
machine, the full API route surface, and multi-instance/scale readiness — cross-verified against
each other and, for the two most severe claims, against the code directly. **11 real, verified
issues found; 9 fixed same-session, 2 documented as genuine larger efforts (see below).**

**Fixed:**
- **`POST /api/disruptions` had NO authentication at all** (confirmed independently by two of the
  four passes, then read directly) — any anonymous caller could trigger a real disruption on any
  flight, cascading into an immediate, uncapped autopilot/pre-auth spend with no confirmation
  window (the ₹25,000 cap was already removed by design). `GET /api/disruptions` also leaked real
  passenger names + owed amounts with zero auth. **Fixed**: new `server/auth/opsSession.ts` (a
  real, separate HMAC-signed operator credential, mirroring `session.ts`'s exact conventions —
  own secret, own cookie, own 8h expiry), a new `requireOperator` guard, and a real login gate
  added to the `/ops` page itself (it used to have none — the page's own copy claimed "no account
  of its own," which was true in a way that was actually a gap, not a feature). Both verbs on
  `/api/disruptions`, plus `ops/mark-cancelled`, `ops/demo-reset`, and `flights/[id]/demo-risk`,
  now require it.
- **`/ops` mutation routes (`mark-cancelled`, `demo-reset`) checked only `requireSession`** — "is
  ANY member signed in," not an operator check — meaning any of the publicly-listed demo accounts
  could wipe the whole demo state or manufacture "confirmed" cancellation corroboration for an
  arbitrary flight. **Fixed** — same `requireOperator` fix as above.
- **Three routes missing per-flight ownership checks**: `flights/[id]/warm` and
  `flights/[id]/reverify` let any signed-in member force a real, budget-consuming supplier
  search/re-score against ANY flight id, not only their own. **Fixed** — both now check the caller
  has a real booking on the flight (reusing the exact pattern `report-cancellation` already
  established), with an operator session still passing through unconditionally since `/ops` itself
  calls these for demo purposes.
- **A real double-booking race in `journal.ts`'s `transition()`**: a member's own "Approve" click
  and their consent window's own expiry timer firing within the same tick both independently call
  `pipeline.execute()`; the "already there" short-circuit (`from === to → {ok:true}`) let a
  SECOND `CONFIRMED` transition silently succeed, which `execute()` read as "go ahead" and ran the
  **entire booking saga twice** — a real duplicate hotel hold and a duplicate "you're rebooked"
  notification today, and would be a real double-booked/double-charged seat the moment live
  ticketing lands. **Fixed**: `CONFIRMED` excluded from the short-circuit, matching the existing
  `HOLD_PENDING` exclusion exactly — a repeat `CONFIRMED` now correctly fails `canTransition` and
  routes into `execute()`'s existing (previously unreachable for this case) strand path. New
  `journal.test.ts` (journal.ts had zero coverage before this).
- **Consent-window timers are 100% in-memory with zero reconciliation** — a routine process
  restart (a deploy, not a crash) while any member had an open consent window permanently stranded
  that recovery: the timer that would call `settleExpired` dies with the process, and nothing
  anywhere ever looked for a `RecoveryTask` with a lapsed `windowExpiresAt` and no resolution.
  **Partially fixed**: new `store.listWaitingRecoveryTasks()` + `simulation.ts`'s
  `reconcileStrandedTasks()`/`startReconciliationSweep()`, wired into `instrumentation.ts` to run
  once at startup and every 5 minutes thereafter. Deliberately does NOT resolve a stranded task by
  assuming silence-equals-proceed (that would reintroduce the delivery-check defect fixed earlier
  the same day) — it sends a FRESH rung-3 notification and routes through the same
  delivery-check/grace-retry logic a live timer would have used, so the safety guarantee holds
  across a restart. **Still not a full fix**: `store.ts`'s `pipelineRuns` (the actual pipeline
  state-machine journal `journal.ts` drives) remains pure in-memory and still resets to nothing on
  restart — the sweep resumes the CONSENT decision, not the pipeline execution state underneath
  it. A real fix needs `pipelineRuns` migrated to Postgres the same way every other domain
  aggregate already was; flagged, not attempted (see "not fixed" below).
- **Two saga compensators claimed an action that never happens**: `hotel`'s compensator said
  `cancelled ${ref} inside the free-cancellation window` for a REAL Duffel Stays hold
  (`holdHotel()` is a genuine third-party call), but no provider in the registry implements a
  real cancel/release endpoint — traced why: a Duffel Stays "quote" is a stateless repriced rate
  check that simply expires unclaimed at no cost (the code's own comment says so), not a real
  booking, so there was never anything to actively cancel. `authorise`/`flight`'s compensators
  similarly claimed "voided"/"released" for refs that are never real (no live payment integration
  exists; live ticketing is deliberately unimplemented, not stubbed). **Fixed**: all three now say
  honestly that nothing real was ever committed, matching the exact "never claim a release that
  did not happen" standard `fallbackNote.test.ts`/`verify.ts` already enforce elsewhere in this
  codebase — this was the one place still violating it.
- **Raw third-party errors and an internal file path leaked to API clients**: `search/flights`
  returned OAG's own upstream error body (up to 500 chars) and, in replay mode, this server's
  absolute file path to a missing fixture, verbatim in the JSON error response of a deliberately
  unauthenticated route. **Fixed** — logged in full server-side, client gets one of three clean,
  pre-written messages (budget exhausted / replay-mode gap / generic unavailable).
- **An N+1 query pattern on a hot path**: `altsCache.ts`'s `mergePinned` (can run every 20s during
  a real disruption) loaded the ENTIRE passenger table, then issued one `getPreAuth` call per
  passenger just to find one flight's pre-auths. **Fixed**: new indexed `getPreAuthsForFlight()` +
  migration `0004_preauth_flight_index.sql` (neither `pre_auths` nor `journey_prefs` had a
  `flight_id` index despite both having the column).
- **Five external-call sites had no request timeout** (a hung upstream could hang the caller
  indefinitely): Kiwi (both search+revalidate), Skyscanner, Uber's OAuth token fetch + every
  authenticated Uber request, Makcorps, and — found while checking, not originally flagged — all
  three Duffel *Stays* hotel calls (a separate client from the already-timeout-guarded Duffel
  *flights* client). **Fixed** — all now carry `AbortSignal.timeout(10000)`, matching every other
  supplier client in the codebase.

**Documented, not fixed this session** (real, larger efforts — flagged rather than rushed):
- ~~`pipelineRuns` is still pure in-memory~~ — **fixed 2026-08-21**: migration `0005_pipeline_runs.sql`
  + `mirrorPipelineRunToDb`/`hydratePipelineRunsFromDb` in `store.ts`, wired into `instrumentation.ts`.
  All 24+ existing sync call sites (`journal.ts`, `pipeline/index.ts`, the pipeline API route)
  unchanged — the Map stays the hot-path read/write surface, Postgres is a fire-and-forget mirror
  behind it, same pattern as `mirrorToTask`.
- ~~Rate limiting and CSRF defense do not exist anywhere on this branch~~ — **fixed 2026-08-21**
  (`c86b640`): ported `rateLimit.ts` and `auth/csrf.ts` byte-for-byte from
  `origin/feature/adaptive-forecast-and-bedrock-refinement` (both already existed there, fully
  built — porting was the right fix, not a second implementation). Wired into every mutating route
  and every OAG/AviationStack-adjacent search route.
- ~~`server/decisionLedger.ts` and `ranker/decisionLog.ts`'s local JSONL files~~ — **both fixed
  2026-08-21**: migration `0006_decision_ledger.sql` (one generic `decision_ledger` table, `kind`
  discriminator) and migration `0007_ranker_decision_log.sql` (same shape, `kind` = 'shown'|'choice',
  `decision_id` pulled out as a real column since `reconcile.ts`/`train.ts` join on it). Both kept
  every original synchronous `void` public signature — neither had an awaiting call site — so the
  fix needed zero changes at any call site except `train.ts`'s own read path, which now calls
  `loadShownSetsFromDb`/`loadChoicesFromDb` instead of reading the local files directly.
- **Deliberately NOT converted, and this is a judgment call, not an oversight**:
  - `server/oag.ts`'s trial-budget counter (`server/.state/oag-trial-usage.json`) stays local-file.
    Its own header's stated goal is "process-crash-surviving," which a local file already satisfies
    in full — the real gap (sharing one 100-call/14-day allowance across *multiple concurrent
    instances*) doesn't apply to this single-process demo. Converting it would mean writing a real
    atomic check-and-increment (`SELECT ... FOR UPDATE` or an equivalent single-statement guard)
    against a scarce, unrecoverable external quota, for a benefit that isn't real here — the wrong
    place to introduce new complexity right before a demo.
  - `server/notify/push.ts`'s device registry (`server/.state/devices.json`) stays local-file for a
    sharper reason: `tokensFor()` is a **synchronous read that gates `send()`**, and `push.send()`
    runs inside `notify/index.ts`'s `dispatch()`, which `forecast.ts`'s `applyScore` calls under an
    explicit, written invariant — "NOTIFYING MUST NEVER BREAK PREDICTING." Making that read
    Postgres-backed would put a real network dependency (with `db.ts`'s own documented history of
    exhausted connection slots) directly on a path whose entire design point is that it cannot be
    allowed to fail via an external dependency. `wiring.test.ts` also exists specifically to prove
    the notify path resolves cleanly with **zero external config** ("the state a fresh checkout and
    CI are in") — a DB-backed `isConfigured()` would quietly break that guarantee's premise, not
    just its current pass/fail state. Multi-instance token sharing is real for a genuine Amex
    deployment; it isn't the risk that matters for this demo.
  - `globalThis`-scoped counters (`governor.ts`'s supplier ledgers, `statusPoller`'s monthly spend
    counter, `webhooks/subscriptions.ts`'s registration map) — unchanged from the original
    assessment: real for a genuine multi-instance deployment, not relevant to this single-process
    demo.

## Known gaps (current, as of 2026-08-21, this branch)

- ~~No enforced spend/policy gate anywhere in the live path~~ — **the highest-leverage exploit path
  closed 2026-08-21** (`requireOperator` on `POST /api/disruptions` and the ops routes — see the
  audit section above). `server/policy/index.ts` itself (12 rules, default-deny) is STILL unwired
  into `execute()` — deliberately: the live path has no per-alt `Offer` cache carrying the
  carriers/fareRules/supplierType fields the policy module's `Bundle` type expects, and there's no
  real outstanding-exposure tracking to honestly feed `exposure_cap_exceeded` — forcing a wire-up
  with synthesized inputs would make the gate rubber-stamp everything while looking enforced. Real
  remaining gap: a member who legitimately sees rung 3 and stays silent still has no amount-based
  backstop, only informed consent — that trade was a deliberate 2026-08-19 product decision, not
  an oversight, and is documented as such in `documentation/design/03-action-policy.md` §10.
- ~~The `dispatch().delivered` safety defect~~ — **fixed 2026-08-21** (`f71c7aa`): `settleExpired()`
  now awaits rung-3 delivery, grants one 5-minute grace retry, and halts to a human rather than
  booking blind if delivery still can't be confirmed. See "EXECUTE plane" section above.
- ~~The learned ranker cannot learn~~ — **fixed 2026-08-21**: `train.ts` now reconciles resolved
  `RecoveryTask`s against the shown-set log offline (`reconcile.ts`).
- ~~The learned ranker had no automatic trigger~~ — **fixed 2026-08-22**: `train.ts`'s fit
  (`runTrainingPass`) was reachable only via a manual CLI invocation — `weights.ts`'s 4-layer
  `resolveWeights` chain (prior -> MyCa warm start -> global learned -> member learned) was
  architecturally adaptive but operationally static. New `server/pipeline/ranker/schedule.ts`
  mirrors `batchScorer.ts`'s self-starting interval pattern (30 min default, `RANKER_RETRAIN_INTERVAL_MS`
  override, wired into `instrumentation.ts`). Also fixed a real bug this surfaced: `weights.ts`'s
  `getArtifact()` caches `model.json` forever and never re-reads it, so a promoted model would have
  sat on disk unused by the very process that trained it — `schedule.ts` now calls `loadArtifact()`
  after every promotion. **Still cold-started in practice** — no accumulated resolution history
  exists yet on this branch, so `model.json`'s `learnedByStrategy`/`learnedByMember` stay empty and
  every ranking still runs on the hand-set prior + MyCa offsets until real interaction volume
  exists. The loop is now fully wired; it has nothing to learn from yet.
- ~~`@temporalio/client`/`@langchain/*` dead dependencies~~ — **removed 2026-08-21** (all three had
  zero live references), `npm install` clean, `tsc` clean.
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
- ~~P1–P5 personas have zero automated test coverage~~ — **fixed 2026-08-21**:
  `server/domain/personas.test.ts`, 11 tests against the real entitlement/refund core. Found and
  fixed a real bug along the way — `estimateRefund()`'s `overnight` was hardcoded to
  `delayHours >= 8`, which misclassifies P1's own 7h-but-overnight scenario; now accepts an
  optional explicit override. **A separate, larger, NOT-yet-fixed finding surfaced by writing
  these tests**: both live call sites of `estimateRefund` (`views.ts`, `simulation.ts`) hardcode
  `delayHours: 24` rather than a flight's real delay — meaning the live pipeline currently grants
  full statutory duty of care to every disruption regardless of actual delay length, the more
  consequential version of the exact bug class P2/P3 exist to catch. Scoped out of this fix
  deliberately (changes live refund numbers, deserves its own verification pass).
- ~~International demo is four small fixes away~~ — **partially fixed 2026-08-21**: the hotel
  *origination* search (`/api/search/hotels`) now requests the destination's real currency and
  converts back for display; the LHR flagship persona was already seeded (not a gap). **Still
  open**: the live *recovery-flow* hotel search (`pipeline/index.ts`'s `arrangeOvernight`) still
  hardcodes INR — deliberately not touched, see the international-capability row above.
  `US-DOT`/`CARD-TERMS` entitlement bundles still have no persona exercising them.
- DGCA duty-of-care thresholds still carry `deck` evidence tier.
- Payment fully mocked; no live payment integration exists on either lineage.
- Four branches on `origin` not yet reconciled into `demo` (two more merged locally today, not yet
  pushed) — see table above.
- **Local `demo` is several commits ahead of `origin/demo` as of the latest session** — see
  `memory.md`'s 2026-08-21 entries for the full list and rationale; pushed once validated.
