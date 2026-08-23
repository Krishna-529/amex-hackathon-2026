# Ranking Engine

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## The trap: which file is actually live

**`zkd-app/lib/ranking.ts` is not the ranker.** It exports `costsFor`/`compareCandidates`/`rank` over a `netEconomic` vs. `memberVisible` cost split, and reads as a plausible, well-commented ranking module — which is exactly what makes it dangerous to find first.

Grepping the whole `zkd-app/` tree for `lib/ranking` turns up four hits, and none of them is a real application call site:

- `zkd-app/tests/ranking.test.ts` — the only file that actually imports `costsFor`/`rank` from `@/lib/ranking`. It is written for Node's own test runner (`import { test } from 'node:test'`), not vitest, and `vitest.config.ts` explicitly excludes the whole `tests/**` directory (see its comment: vitest *would* run these 79 assertions and they pass, but reports them as 7 "no test suite found" failures because it doesn't recognise `node:test`'s registration style — so it's excluded rather than reported wrong). There is also no npm script that runs `node --test tests/` successfully today: it dies on `MODULE_NOT_FOUND` because the `@/` path alias has no resolver under `node:test`. So `lib/ranking.ts`'s only exerciser cannot currently run through any command in `package.json`.
- `zkd-app/server/ledger/reconciliation.ts` and `zkd-app/server/suppliers/types.ts` — one-line **comments** pointing at `lib/ranking.ts` for context, not imports.

No file under `app/`, `server/` (outside that one comment), or any live page imports `costsFor`, `compareCandidates`, or `rank` from `lib/ranking.ts`. It is dead code with an orphaned test.

**The live path is `server/pipeline/score.ts`, which calls into `server/pipeline/ranker/`.** Confirmed by tracing actual callers: `server/pipeline/index.ts` (the saga's own evaluation step) and `app/api/flights/[id]/intent/route.ts` (the LLM free-text intent preview) both import `applyHardRules` / `rankAlts` / `ScoreContext` from `./score` / `@/server/pipeline/score`, and `score.ts` in turn imports `rankByModel` from `./ranker/index.ts`. This is the module every UI screen's ranking, ordering, and "why we picked this" sentence ultimately traces back to.

## What this component does

Given a set of candidate rebooking alternatives that have already survived the hard-rule filters, this component orders them for one member and produces the human-readable explanation shown under each option. Ranking is a learned conditional-logit (discrete-choice) model — not a hand-set weighted sum — whose weight vector is resolved per-request from a chain of increasingly specific evidence (strategy prior → MyCa warm start → global learned weights → this member's own learned weights), and whose output doubles as the training signal for its own future retraining.

## Where it lives

| File | Purpose |
|---|---|
| `server/pipeline/score.ts` | Public surface the rest of the pipeline calls: `applyHardRules` (safety filters that run *before* scoring) and `rankAlts` (ranks the survivors, then projects the model's output back into the legacy `OptionScore` shape — `parts`/`weights`/`total`/`notes` — that the UI and journal already consume). Owns `explain()`, the per-option "why" sentence. |
| `server/pipeline/ranker/index.ts` | `rankByModel` — the ranker's own public entrypoint. Builds the shared feature context, featurises every candidate, resolves the member's weight vector, scores the set, applies (default-off) near-tie exploration, and fire-and-forgets the shown-set log. |
| `server/pipeline/ranker/features.ts` | The one place a candidate becomes numbers — `featurise()`. Ten raw, signed features, all oriented so a higher value is "more preferred" and every weight can therefore be safely clipped non-negative. Also `carriersOf()` (every leg's carrier codes) and `touchedAirports()`. |
| `server/pipeline/ranker/weights.ts` | `resolveWeights` — the four-link chain (prior → MyCa offsets → global learned → member learned), each learned link gated by a hard `minData` floor and blended in by empirical-Bayes shrinkage. `enforceMonotone` clips every monotone feature's weight to ≥ 0 no matter what a training run or a hand-edited artifact says. Also the artifact loader/cache (`getArtifact`/`loadArtifact`). |
| `server/pipeline/ranker/model.ts` | The conditional-logit math itself: `dot()`, `contributionsOf()`, and `scoreSet()` — utilities, the softmax choice probability, and a deterministic cost/arrival/seats tiebreak for exact ties. Carries its own non-finite-utility guard independent of `features.ts`'s. |
| `server/pipeline/ranker/bookability.ts` | `bookabilityOf` / `bookabilityOffset` — P(this offer is still bookable when we try to ticket it), entering the utility as a fixed `log P(bookable)` offset rather than a competing learned weight. |
| `server/pipeline/ranker/cancelRisk.ts` | `cancelRiskOf` — a cheap, synchronous P(this *alternate* itself gets cancelled), read from the trained cancellation model's own committed historical-rate tables (real → synthetic Indian → global prior), never a live `serve.py` round-trip per candidate. |
| `server/pipeline/ranker/explore.ts` | `applyExploration` — near-tie adjacent-pair swapping for offline-evaluation data, off by default (`epsilon: 0.0` in the shipped artifact). |
| `server/pipeline/ranker/decisionLog.ts` | `logShownSet` / `logChoice` and their Postgres-backed readers — the durable record of what was shown (every candidate's full feature vector, at the moment it was shown) and, separately, of any directly-logged choice. |
| `server/pipeline/ranker/reconcile.ts` | `reconcileChoices` — pure, DB-free join of a resolved `RecoveryTask.resolution` back onto the most recent matching shown-set log entry, by `(flightId, memberId)` and timing, to manufacture real training pairs without any new write on the live consent/spend path. |
| `server/pipeline/ranker/train.ts` | `runTrainingPass` — the offline fit: conditional-logit maximum likelihood with L2-to-prior regularisation and monotone projection, per-strategy, promoted only if it beats the incumbent's held-out negative log-likelihood. Also the CLI entrypoint (`node --experimental-strip-types server/pipeline/ranker/train.ts`). |
| `server/pipeline/ranker/schedule.ts` | `startRankerTrainer` — the automatic recurring trigger for `runTrainingPass` (added 2026-08-22), self-starting interval (default 30 min, `RANKER_RETRAIN_INTERVAL_MS` override), idempotent under HMR via a `globalThis` guard, reloads the artifact into the serving cache after a promotion. |
| `server/pipeline/ranker/types.ts` | Shared types: `FEATURES`, `FeatureVector`, `WeightVector`, `RankerArtifact` (the persisted shape), `ModelScored`. |
| `server/pipeline/ranker/model.json` | The persisted artifact `train.ts` writes and `weights.ts` reads — see "State it owns" below. |
| `server/domain/altsForParty.ts` | `altsForParty` — turns raw stored `Alt`s into `PartyAlt`s (adds `fitsParty`/`partyFare`), and is the actual fabrication guard on every live decision-making call site (`looksFabricated`, not a function literally named `dropFabricatedAlts` — that name belongs to the display-only guard in `server/domain/views.ts`, which this file's own comment says was NOT reached by decision-making call sites before 2026-08-21). |
| `server/domain/altsFromOffers.ts` | `offersToAlts` — turns real supplier `Offer`s into `Alt`s, one FX rate per search. Feeds both the live alts cache and the manual `/api/alts` route. Cabin entitlement is the only thing left that can mark an option `ok: false` here; the per-transaction cap and the currency-conversion refusal were both removed 2026-08-19. |
| `app/api/alts/route.ts` | A diagnostic/manual search endpoint (`from`/`to`/`date`/`cabin` query params) — exercises `offersToAlts` directly, outside any seeded `Flight`, for probing supplier results. Not on the ranking path itself. |
| `lib/ranking.ts` | **Dead code.** See the trap section above. |

## How it works

### Hard rules vs. scoring

`applyHardRules` (in `score.ts`) runs first, over the `PartyAlt[]` that `altsForParty` has already sanitised. Six checks, each a disqualification with a recorded reason, never a score penalty:

1. **Avoid-airlines** — every leg's carrier via `carriersOf()` (shared with the ranker's own features), not just the first. The file's own comment documents the bug this replaced: checking only `code.split(/\s+/)[0]` meant a blocked carrier operating a connection's *second* leg was invisible to the rule. Fixed 2026-08-21.
2. **Hard deadline** (`flight.hardDeadlineISO`) — an arrival after it is disqualified, not discounted. An *unknown* arrival time is not removed (can't prove it misses the deadline).
3. **Earliest departure** (`flight.earliestDepartISO`) — symmetric lower bound, same discipline.
4. **Party fit** (`fitsParty`) — never split a party across flights.
5. **Cabin downgrade** — filtered when `allowCabinDowngrade` is false and the alt's cabin ranks below the preferred cabin.
6. **Card policy verdict** (`alt.ok`) — MyCa's own entitlement check. Added 2026-08-19 specifically because nothing previously filtered on `ok`, and the per-transaction spend cap (removed the same day) had been the only other backstop against an out-of-entitlement fare getting auto-booked.

Everything that survives is handed to `rankAlts`, which delegates the actual ordering to `rankByModel` and then reshapes the model's output into the legacy `OptionScore` display shape (`parts`, `weights`, `total`, `notes`) so nothing downstream of the ranker had to change when the hand-set scorer was replaced.

### The discrete-choice model

The model is a conditional logit (McFadden): each candidate `i` gets a utility `v_i = w · phi_i + log P(bookable_i)`, and the probability of being chosen from the shown set is the softmax over those utilities (`server/pipeline/ranker/model.ts`). Conditional logit was chosen over a pairwise ranker because it matches the actual decision shape (one choice from a presented set, and "we ranked it first and they took it" is itself an observation), and its fitted coefficients drop straight back into the artifact as inspectable weights. The file documents IIA (independence of irrelevant alternatives — two near-identical flights split each other's apparent share) as a known, accepted limitation rather than something worked around; nested/mixed logit is named as a future step requiring more data than exists today.

**Ten features** (`server/pipeline/ranker/features.ts`), every one raw, signed, and oriented so higher is always more preferred: `arrival`, `cost`, `cabin`, `effort`, `loyalty`, `redeye`, `seats`, `stability` (the alt's own cancellation risk, from `cancelRisk.ts`), `weatherRisk`, and `advisoryRisk` (both live-feed features, `server/risk/`, off unless `ZKD_LIVE_RISK=1`). `loyalty` and `stability`/`weatherRisk`/`advisoryRisk` are computed over **every leg** of a connection via `carriersOf()`/`touchedAirports()`, not just the first — the file's header and `score.test.ts` both call out that this was previously first-leg-only and is a fixed bug (2026-08-21). MyCa is load-bearing at the feature level, not only the weight level: `cabin`, `loyalty`, and `redeye` are computed directly from the member's MyCa profile.

**Weight resolution** (`server/pipeline/ranker/weights.ts`, `resolveWeights`), weakest evidence first:
1. **Strategy prior** — the old hand-set presets, ported into feature space (`model.json`'s `priorByStrategy`), one vector per `optimization_strategy`.
2. **MyCa warm start** (`applyMycaOffsets`) — additive bumps to `loyalty`/`redeye`/`cabin` from the member's own MyCa profile (status carriers held, red-eye aversion, premium entitlement). This is why the model doesn't need interaction history to be personalised from the first recovery.
3. **Global learned** — a vector fitted across all members on a strategy, blended over (1)+(2) by `shrinkToward` (empirical-Bayes, `w = (n·learned + k·prior)/(n+k)`), gated by `minDataGlobal` (200 in the shipped artifact) below which it's ignored entirely.
4. **Member learned** — this member's own fitted vector, blended over whatever (3) produced, gated by `minDataMember` (25).

`enforceMonotone` is the last step of every resolution: every feature in `monotoneNonNegative` (all ten, in the shipped artifact) is clipped to `max(0, w)`. This is asserted at read time regardless of what training produced — "cheaper/earlier/less-downgrade is never ranked worse" holds even against a bad fit or a hand-edited artifact.

**Bookability is a fixed offset, not a weight** (`bookability.ts`, `model.ts`): `v_i = w·phi_i + log P(bookable_i)`, coefficient fixed at 1 and never learned. The design note explains why this replaced the old `RELIABILITY_FLOOR`: with bookability as a multiplicative (offset, in log form) term, no volume of "member liked the cheap unbookable option" training data can teach the model to prefer something it can't actually book. `P(bookable)` itself starts from a tiered prior (`liveWithExpiry` 0.97 / `okNoExpiry` 0.72 / `other` 0.45) and shrinks toward a per-supplier learned rate as `revalidateOffer` outcomes accumulate via `train.ts`'s `learnBookability`.

**Deterministic tiebreak**: exact utility ties (e.g. a clipped-to-zero weight) fall to cheaper, then earlier, then more spare seats — `model.ts`'s `scoreSet` sort — so the monotonicity guarantee holds even in a tie, not just strictly.

### Continual learning loop

1. **Shown-set logging** — `rankByModel` calls `logShownSet` (fire-and-forget, Postgres, `ranker_decision_log` table) on every live ranking call, recording the full feature vector, bookability, utility, rank, and propensity of every candidate shown. This is real and runs on every recovery today.
2. **Offline reconciliation** — `reconcile.ts`'s `reconcileChoices` joins a resolved `RecoveryTask.resolution` (kind `autopilot`/`approved`, which carry an `altId`) to the most recent shown-set log entry for the same `(flightId, memberId)` that precedes the resolution and actually contains the chosen alt. Deliberately DB-free and offline — the design explicitly avoided wiring `logChoice` into the live consent/spend path (`simulation.ts`) to keep that path's surface small, in favor of joining afterward, out of the request path, against data that already exists (`RecoveryTask.resolution`).
3. **Training** — `train.ts`'s `runTrainingPass` merges reconciled choices with any directly-logged ones (`logChoice` is exposed but nothing currently calls it in production, so today reconciliation is the only source of training pairs), builds `Observation`s per strategy, and fits each with projected gradient descent (L2-to-prior + monotone clipping at every step). A fit is only promoted if it beats the current incumbent's held-out negative log-likelihood on a deterministic 70/30 split, and only if the strategy has ≥ `minDataGlobal` observations.
4. **Automatic retrain schedule** — `schedule.ts`'s `startRankerTrainer`, added 2026-08-22, mirrors `batchScorer.ts`'s self-starting-interval pattern: ticks immediately at startup and then every `RANKER_RETRAIN_INTERVAL_MS` (default 30 minutes), idempotent via a `globalThis` guard so Next dev-mode HMR can't spawn duplicate timers. Before this file existed, `runTrainingPass` had **no automatic trigger at all** — only the manual CLI script — so interaction data could accumulate in Postgres indefinitely with nothing ever learning from it. That gap is what this closes.
5. **Artifact reload** — on a promotion, `schedule.ts` calls `loadArtifact()` to force `weights.ts`'s in-process cache to re-read the freshly-written `model.json`; without this the training process's own cache would keep serving the old vector until a restart (`getArtifact()` never re-stats the file on its own).

**What's real and running today**: the logging, the reconciliation join, the trainer's math, and the scheduled trigger are all wired and exercised by tests. **What's cold-started**: the shipped `model.json` (`version: 2`, `trainedAt: 2026-08-21`) has `learnedByStrategy: {}` and `learnedByMember: {}` — nothing has been fitted on real member data yet. Every ranking today runs on the strategy prior + MyCa warm start only; the global/member learned layers are architecturally live but have never had enough logged interaction data to clear `minDataGlobal`/`minDataMember` and actually engage.

### Exploration

`explore.ts`'s `applyExploration` only ever swaps **adjacent** ranks whose utility gap is below `nearTieDelta` (0.05 in the shipped artifact) — options the model's own math already treats as interchangeable, so a swap costs the member nothing (both have already passed every hard rule). The swap probability is `epsilon`, and the shipped artifact has **`epsilon: 0.0`** (confirmed directly in `model.json`'s `explore` block) — so in production today `applyExploration`'s early-return path always fires: every candidate keeps its model rank, every propensity is exactly 1, and no swap ever happens. Each candidate's `propensity` (probability that specific ordering was shown) is still recorded either way, for future inverse-propensity-weighted offline evaluation. The file's own comment explains why online A/B-style exploration is rejected outright for this domain: showing a member a worse flight to see whether they take it has a cost measured in missed connections, not a lower engagement metric — and notes that un-engineered exploration (members overriding the top rank on their own) still teaches the model even with epsilon at 0.

## Interfaces

### Inbound — who calls this, and how

| Caller | What it calls | Why |
|---|---|---|
| `server/pipeline/index.ts` | `applyHardRules` then `rankAlts` (from `./score`) | The saga's own evaluation step during a live recovery — the ranked top option becomes the recovery's plan. |
| `app/api/flights/[id]/intent/route.ts` | `applyHardRules` then `rankAlts` (from `@/server/pipeline/score`) | The LLM free-text intent layer's preview: re-ranks against a copy of the flight with a member-stated deadline applied, without persisting it until confirmed. |
| Display layer (`app/flights/[id]/page.tsx` and downstream UI) | Reads the `OptionScore` (`parts`/`weights`/`total`/`notes`) that `rankAlts` already produced | Never calls the ranker directly — consumes the shape `score.ts` projects the model's output into, unchanged in character from the pre-2026-08-20 hand-set scorer. |

### Outbound — what this calls, and why

| Callee | Why |
|---|---|
| `server/pipeline/ranker/cancelRisk.ts` (`cancelRiskOf`) | Feeds the `stability` feature — the alternate's own cancellation risk, read from the trained XGBoost cancellation model's committed historical-rate tables, synchronously and at zero network cost (never a live `serve.py` call per candidate). |
| `server/domain/pricing.ts` (`costFor`) | Called once per alt by `score.ts`'s `rankAlts` to get the party total, shared with the ranker (via `partyTotalById`) so the pipeline and the ranker agree on "what this costs." |
| `server/domain/altsForParty.ts` (`altsForParty`) | Upstream of both `score.ts` call sites — sanitises raw `Alt[]` into `PartyAlt[]` (seat/fare validity, fabrication guard) before hard rules or ranking ever see them. |
| `server/risk/` (via `resolveRiskMaps`, called by `server/pipeline/index.ts`) | Supplies `weatherByAirport`/`advisoryByAirport`/`advisoryByCarrier` into `ScoreContext`, feeding the `weatherRisk`/`advisoryRisk` features. |
| `server/domain/db.ts` (`sql`, `ensureReady`) | `decisionLog.ts`'s Postgres-backed shown-set/choice log, and `reconcile.ts`/`train.ts`'s reads of resolved `RecoveryTask`s via `server/domain/store.ts`. |

## State it owns

- **`server/pipeline/ranker/model.json`** — the persisted `RankerArtifact`: feature scales, monotonicity list, per-strategy priors, MyCa offset constants, bookability priors/learned-per-supplier rates, shrinkage constants (`pseudoCountGlobal`/`pseudoCountMember`/`minDataGlobal`/`minDataMember`/`l2ToPrior`), the exploration config (`epsilon`/`nearTieDelta`), and the learned vectors themselves (`learnedByStrategy`, `learnedByMember`, and their observation `counts`). `train.ts` is the only writer; `weights.ts` is the reader, with an in-memory cache (`getArtifact`) that only refreshes via an explicit `loadArtifact()` call (from `schedule.ts` after a promotion, or a test).
- **`ranker_decision_log`** (Postgres, migration 0007) — one generic table with a `kind` discriminator (`'shown' | 'choice'`), holding every shown-set (full feature vectors, keyed by decision id) and any directly-logged choice. Replaced two local JSONL files under `server/.state/` on 2026-08-21, for the same "true on one instance, false the moment a second one exists" reason `decisionLedger.ts` was moved off JSONL in migration 0006.
- No other cache: `bookabilityOf`/`cancelRiskOf` read static tables (the artifact itself, and `zkd-risk-model/models/entity_rates*.json`) with in-process memoisation but no independent persisted state of their own.

## Real vs. simulated vs. mocked

Nothing here is mocked. The mechanism — feature extraction, weight resolution, monotone conditional-logit scoring, bookability-as-offset, shown-set logging, offline reconciliation, the trainer's math, and the automatic retrain schedule — is fully real and wired, and covered by tests exercising it directly (not stubbed). The one honest caveat is **cold start**: the shipped `model.json` has empty `learnedByStrategy`/`learnedByMember` and `version: 2`, so today every ranking decision runs on the strategy prior plus MyCa warm start only. The learned layers will engage automatically the first time a strategy accumulates `minDataGlobal` (200) reconciled observations and clears the held-out promotion bar — nothing further needs to be built for that to happen, only real interaction volume.

## Failure modes & concurrency

| Failure | Guard | Where |
|---|---|---|
| NaN/undefined feature value for one candidate (malformed fare/seats/timestamp from a supplier) | `sanitize()` coerces any non-finite feature to 0 (the neutral value every feature is designed around) before it can reach `dot()`. Without it, `Math.max(...utilities)` in the softmax would go NaN and poison every *other* candidate's choice probability too, not just the broken one's. | `features.ts`'s `featurise` → `sanitize` |
| A non-finite utility slipping past the featuriser anyway (e.g. a future feature added without going through `sanitize`) | Second, independent guard: a non-finite utility is logged (`console.error`) and pinned to `-1e9` — ranked last, never dropped, never allowed to poison the set's max. | `model.ts`'s `scoreSet` |
| Fabricated leftover rows (`kind !== 'market'`, or the old `carrierProtectedAlt()`'s `fare:0/seats:99` signature) surviving in Postgres from before the 2026-08-19 fix, pinned to an in-flight recovery | `looksFabricated()` runs inside `altsForParty` itself — the one function every live decision-making call site passes through (`pipeline/index.ts`, `simulation.ts`, the intent route), not only the member-facing read path (`views.ts`'s `dropFabricatedAlts`, which alone would have hidden it from the *screen* while leaving it live for the *pipeline*). Fixed 2026-08-21. | `server/domain/altsForParty.ts` |
| A NaN/negative fare, or a NaN/negative seat count, from a real supplier | Seats coerced to 0 (safe floor); fare is **disqualified outright** (`ok: false`), never coerced to 0 — the file's comment cites the 2026-08-19 fabricated-`fare:0` incident as the reason a broken fare must never silently become a free-looking option. | `altsForParty.ts` |
| The shared display aggregates (`bestArrival`, the cost `band`) themselves going NaN if every candidate's own value were broken | `Number.isFinite` filters before `Math.min`/`Math.max`; an all-broken set falls back to a zero-width band, which `costPart`'s own `span <= 0` branch already treats safely (everyone scores 1). | `score.ts`'s `rankAlts` |
| A ranked candidate's own cost/arrival still non-finite despite clean shared aggregates | `round3` is the last checkpoint: any non-finite output value renders as 0 ("worst on this axis") rather than `NaN%` or a broken UI bar. | `score.ts`'s `round3`/`roundAll` |
| Postgres unreachable during scheduled retraining | `loadResolvedChoicesFromDb` catches and logs a warning, returning `[]` rather than throwing — a training tick on a machine without `DATABASE_URL`, or during a DB blip, degrades to whatever `loadChoicesFromDb` separately returns instead of crashing the scheduled job. `schedule.ts`'s own tick also wraps `runTrainingPass()` in try/catch and reschedules regardless of outcome. | `train.ts`'s `loadResolvedChoicesFromDb`; `schedule.ts`'s `tick` |
| Concurrent/duplicate retrain timers under Next dev-mode HMR | A `globalThis.__zkdRankerTrainerStarted` guard makes a second `startRankerTrainer()` call a no-op. | `schedule.ts` |
| Missing cancellation-risk tables on a checkout that hasn't built the risk model | `cancelRiskOf` falls back to `BASE_CANCEL_RATE` (0.02) when neither the real nor synthetic rate table is on disk — `stability` becomes a constant and ranking is otherwise unaffected, not an error. | `cancelRisk.ts` |
| Exploration propensity left unset for the last element of a near-tie chain | Historical bug (documented in the file): the old loop never wrote `out[i+1]`'s propensity for an interior pair, relying on the next iteration — which doesn't exist for the last element. Fixed by initialising every propensity to a loud sentinel (`-1`, not a silently-plausible `1`) and a final sweep that only fills genuinely untouched entries. Moot at `epsilon: 0` today, but load-bearing the moment exploration is turned on. | `explore.ts` |

## Tests

- `server/pipeline/score.test.ts` — vitest, CI-visible. Covers `applyHardRules`'s avoid-airlines-every-leg fix, `rankAlts`'s loyalty-credits-every-leg and cancellation-risk-worst-leg fixes, the NaN-fare/NaN-arrival non-contamination guarantees, and empty/single-candidate sanity. The file's own header notes this suite didn't exist before 2026-08-21 — the only prior executable checks lived in `verify.ts`, which `npm run verify` runs but CI does not.
- `server/pipeline/ranker/ranker.test.ts` — vitest. Exercises monotonicity under arbitrary weights, MyCa personalising day one, bookability being un-out-learnable, shrinkage resisting thin data, and the trainer both recovering a real signal and refusing to promote noise.
- `server/domain/altsForParty.test.ts` — vitest. Seat sanitisation (negative/NaN/fractional), fare disqualification (NaN/negative never coerced to free), and the fabricated-row signature (`fare:0 && seats>=99`, or `kind !== 'market'`) being caught without false-positiving on a genuine free reissue or a genuinely large aircraft.
- **Real gap**: `lib/ranking.ts`'s own test (`tests/ranking.test.ts`) cannot run through any `npm` script today (excluded from vitest, and `node --test` fails on the `@/` alias) — moot for correctness since that module isn't on the live path, but it means even the dead module's 79 assertions aren't reported by anything. No test exercises `schedule.ts`'s timer/interval machinery itself (only `intervalMs()`'s env-parsing is separated out for testability); the interval loop's actual behaviour under a live Postgres is implicitly exercised, not unit-tested.

## See also

- [03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md)
- [05-orchestration-and-execution.md](05-orchestration-and-execution.md)
- [09-domain-and-persistence.md](09-domain-and-persistence.md)
