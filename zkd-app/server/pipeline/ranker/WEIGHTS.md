# Weight card — alternate-flight ranker

*Every number below is read verbatim from `model.json` (v2) or `presets.ts`, the two files
that actually own these values. Nothing here is asserted without a line of code behind it.*

## What this ranks

Once a flight is disrupted and hard rules (`applyHardRules` in `score.ts`) have removed anything
that isn't bookable, party-fitting, entitled, or inside the member's deadline, this model orders
what's left. It answers one question: **of the options that are all legal to book, which one
should we actually pick or show first?**

It does not decide *whether* the original flight is cancelled — that's a separate, real,
gradient-boosted model (`zkd-risk-model/`, own card at `zkd-risk-model/MODEL_CARD.md`). This
model only ranks the replacements.

## The formula

```
utility(option) = Σ_k  weight_k × feature_k   +   log P(bookable)
rank by utility · softmax(utility) = confidence this is the pick
```

Every `feature_k` is signed so that a **larger** number is always more preferred, and every
`weight_k` is clipped to be **non-negative** before it is used
(`enforceMonotone`, `weights.ts`). That single rule is the whole safety guarantee: no matter what
a weight's value is, "cheaper", "earlier", "less downgraded", "fewer stops", "more headroom", and
"lower risk" can never be ranked worse than their opposite. A justification for *how much* a
feature matters is below; the *direction* it matters is never in question.

Bookability sits outside the sum entirely — see [§6](#6-bookability-a-multiplier-never-a-weight).

---

## 1. The weight matrix, as shipped

| Feature | earliest_arrival | stick_to_preferred_airline | minimize_layovers | lowest_cost |
|---|---:|---:|---:|---:|
| arrival | **3.00** | 1.44 | 1.56 | 1.08 |
| cost | 0.60 | 0.72 | 0.60 | **2.40** |
| cabin | 0.48 | 0.60 | 0.48 | 0.60 |
| effort | 0.60 | 0.36 | **2.04** | 0.60 |
| loyalty | 0.24 | **1.80** | 0.24 | 0.24 |
| redeye | 0.60 | 0.60 | 0.60 | 0.60 |
| seats | 0.30 | 0.30 | 0.30 | 0.30 |
| stability | 1.20 | 1.20 | 1.20 | 1.20 |
| weatherRisk | 1.00 | 1.00 | 1.00 | 1.00 |
| advisoryRisk | **2.50** | 2.50 | 2.50 | 2.50 |

Read the diagonal: each strategy's defining feature is its heaviest weight. Five features
(`redeye`, `seats`, `stability`, `weatherRisk`, `advisoryRisk`) are held **identical across every
strategy**, on purpose — see [§4](#4-why-five-features-never-vary-by-strategy).

---

## 2. Where the six original numbers come from

Five of the eight legacy-era weights (`arrival`, `cost`, `cabin`, `loyalty`, `effort`) are not
new numbers. They are `server/preferences/presets.ts`'s pre-existing, hand-argued weights —
the ones the app used **before** any of this ranker existed — carried over unchanged in
direction and relative size, only rescaled by a constant factor of **×6** (a logit temperature)
so they work as raw weights on a softmax instead of as a 0–1-normalised weighted average:

| Criterion | `presets.ts` (sums to 1.00) | `model.json` (×6) |
|---|---:|---:|
| arrival | 0.50 | 3.00 |
| cost | 0.10 | 0.60 |
| cabin | 0.08 | 0.48 |
| loyalty | 0.04 | 0.24 |
| effort | 0.10 | 0.60 |

*(shown for `earliest_arrival`; the other three strategy rows scale identically — check any
column above against `presets.ts` and it matches exactly, ×6.)*

**Why this matters for justification, not just arithmetic:** it means five of the ten weights
inherited a real design argument rather than being invented for this ranker. `presets.ts`'s own
header states the reasoning directly — the member sets one comprehensible knob
(`optimization_strategy`); the six-criterion comparison behind it exists because *"comparing an
overnight-plus-hotel against a same-night two-stop against a carrier-protected reroute is not a
one-dimensional question — a bare enum cannot express 'arrives 4h earlier but costs money and adds
a connection.'"* Porting the numbers, not just the shape, means the day the ranker shipped it
reproduced exactly the ranking behaviour the app already had — a deliberate choice, so that
adding a learned model was never also a silent behaviour change.

Reliability → `stability` is the one legacy value that did **not** carry over mechanically:
`presets.ts`'s `RELIABILITY_FLOOR = 0.18` would scale to `1.08`; the shipped `stability` prior is
`1.20`. The reason is architectural, not arithmetic: in the old scorer, reliability was *itself*
the only thing standing between the model and a fabricated free option
(`carrierProtectedAlt`, `fare: 0`) sweeping every comparison on price. That fabricated option is
gone (removed 2026-08-19), and its job — "never let something we can't book win on price alone" —
now belongs to [bookability](#6-bookability-a-multiplier-never-a-weight), a multiplier no training
can erode. `stability` was freed to mean something narrower and more honest: *this specific
alternate's own historical cancellation propensity*, sourced from a real trained model rather than
a policy floor, and its prior was set slightly above the old floor's implied value because it now
carries real information (a route/carrier's actual track record) rather than standing in for a
missing hard rule.

---

## 3. The four features that have no legacy precedent

Four features were added while building this ranker and never existed in `presets.ts`. Each is
justified on its own, because there is no inherited number to point to.

### `redeye` — weight 0.60, constant

**Basis:** a direct MyCa preference (`avoidRedEye: boolean`), combined with whether the specific
candidate is actually a red-eye (departs late night / arrives small hours —
`isRedEye`, `features.ts`). It is zero for any member who hasn't said they mind, and zero for any
flight that isn't actually a red-eye — so the weight only ever activates for the exact member/
option pair it should.

**Relevance:** comfort, not function. It's set at the same magnitude as `stability` and
`weatherRisk` — noticeable, but never large enough to overturn a real arrival or cost advantage on
its own. A member who explicitly said they'd rather not fly overnight deserves that respected, not
overridden by a half-hour of extra sleep-schedule savings.

### `seats` — weight 0.30, constant

**Basis:** headroom beyond the exact party size (`seatsSpare = seats − partySize`, saturating at
8). This is a party-safety margin, not a preference: three seats left on a five-person party's
flight is a materially riskier booking than thirty seats left, even though `applyHardRules`
already guarantees the party fits at booking time — inventory can still move between search and
confirm.

**Relevance:** deliberately the lightest weight in the whole matrix alongside `redeye`. It's a
tiebreaker among options that are all otherwise fine, not a reason to pick a worse flight.

### `weatherRisk` — weight 1.00, constant

**Basis:** the worst live weather severity across the candidate's own airports — origin,
destination, and (for a connection) its hub — read from real METAR/SIGMET data
(`server/risk/weatherRisk.ts`). Ceiling, visibility, gusts and hazard codes (thunderstorm,
icing, snow, fog, volcanic ash, sand) are mapped to a single [0,1] severity, taking the worst of
the four.

**Relevance:** matches `stability`'s weight (1.20) closely rather than dominating it, because both
answer a similar underlying question — "how likely is this specific option to itself go wrong" —
from two different evidence sources: `stability` is a historical average, `weatherRisk` is a live
observation. Neither should structurally out-argue the other; they're set to comparable magnitude
on purpose.

### `advisoryRisk` — weight 2.50, constant, **the heaviest weight shipped**

**Basis:** the worst live advisory severity — airport/airspace closures via FAA NOTAM, or
strikes/unrest/geopolitical events via GDELT news — over the candidate's airports or operating
carrier (`server/risk/notam.ts`, `server/risk/gdelt.ts`). If either channel is off, absent, or the
region is uncovered, the feature is simply zero — never a guess.

**Relevance and justification for being the heaviest number in the file:** this weight exists to
answer the ~250-cause disruption taxonomy the ranker was extended for — strikes, closures,
volcanic ash, war-zone airspace, security threats — collapsed into one signal. These are the
causes most likely to make a "good on paper" option actually undeliverable, so it outweighs even
`lowest_cost`'s own cost weight (2.40). It is **explicitly not a hard filter**: a candidate under a
severe advisory can still be booked if the member insists — a per-request `overrideSevereRisk`
flag, meant to be set by a future LLM intent layer parsing something like "get me there no matter
what," zeroes this feature's contribution outright. A weight, however heavy, can always be
overridden by an explicit member decision; a hard filter could not.

---

## 4. Why five features never vary by strategy

`redeye`, `seats`, `stability`, `weatherRisk`, `advisoryRisk` hold the exact same number in all
four rows of the matrix. This mirrors the reasoning `presets.ts` already states for
`RELIABILITY_FLOOR`: *"No optimisation strategy should be able to talk the agent into an option it
cannot actually book — a member who asked for 'lowest cost' asked to save money, not to be handed
a [...] row with no PNR behind it. Strategy governs which real option wins, never whether an
option is real."*

The same argument extends past bookability to safety and comfort generally: a member who chose
`lowest_cost` is asking the system to spend less of their money, not to accept more risk of being
stranded, or to be put on a red-eye they said they'd rather avoid, in exchange for the last few
rupees. Strategy is allowed to change *which acceptable option* wins. It is not allowed to change
*how much a live hazard, a party's safety margin, or a stated comfort preference matters* — those
are treated as constants the member did not put up for negotiation when they picked a strategy.

---

## 5. Personalisation on top of the matrix

Before the matrix row is used, three layers of resolution run (`weights.ts`, `resolveWeights`):

1. **Strategy prior** — the row above, selected by the member's one chosen knob.
2. **MyCa warm start** — added immediately, from the member's real profile, not learned:
   - `+0.80` to `loyalty` if the member holds status with any carrier
   - `+0.80` to `redeye` if the member has said they avoid them
   - `+0.40` to `cabin` if the member is entitled above economy

   **Basis:** a member is already personalised from their very first recovery, with zero
   interaction history, because MyCa is a *stated fact* about them, not an inference that needs
   data to trust.
3. **Learned deltas** (global, then per-member) — see [§7](#7-are-these-numbers-actually-being-trained)
   for whether this layer is actually live today.

Every layer is re-clipped non-negative at the end (`enforceMonotone`), so no personalisation, no
matter how it was derived, can ever break the "better is never ranked worse" guarantee.

---

## 6. Bookability — a multiplier, never a weight

`P(bookable)` — `0.97` for a live offer with a real expiry, `0.72` for entitled-but-unpriced,
`0.45` for anything else (`bookability.ts`) — enters as `log P` added to the utility, with a fixed
coefficient of exactly `1`. It is **not** in the weight matrix above, and it cannot be, by
construction: there is no weight parameter attached to it for training to move. This is
deliberate — it's what makes the old `RELIABILITY_FLOOR` policy ("no strategy may value
bookability below this floor") unnecessary rather than merely enforced. A learned system can, in
principle, learn to undervalue anything that *is* a weight. It cannot learn to undervalue
something that was never a weight in the first place.

---

## 7. Are these numbers actually being trained?

**No, not yet, as shipped.** This is stated plainly because the architecture (`shrinkToward`,
`minDataGlobal`/`minDataMember` gates, `train.ts`'s L2-to-prior fit) exists and is tested, but two
things are still required before the matrix above will ever move on its own:

- `logShownSet` (`decisionLog.ts`) fires on every real recovery and records what was shown.
  `logChoice` — the member's actual pick, the other half of a training pair — is defined but
  **not called anywhere in the app**. Zero training pairs exist today.
- `train.ts` is a manual script (`node --experimental-strip-types server/pipeline/ranker/train.ts`).
  Nothing schedules it.

Every number in this document is therefore the *prior* — a deliberately justified starting point,
not yet a fitted result. `learnedByStrategy` and `learnedByMember` in `model.json` are both `{}`.

---

## 8. Relevance to this product, specifically

Two things about ZKD Concierge make "justified priors, learned later" the right shape for this
component, rather than a compromise:

- **The member's card is behind every ranked option.** A ranking that can be wrong in a way
  nobody can explain is not something you put a payment method behind. Every weight above traces
  to either an inherited, previously-argued design decision (`presets.ts`) or a stated reason in
  this document — so a member, an auditor, or a judge can ask "why did this option rank first?"
  and get `contributions = weight_k × feature_k` as a real, reconstructible answer
  (`explain()`, `score.ts`), not "the model decided."
- **Silence proceeds, on a schedule the member was told about.** `autopilot` consent means an
  unanswered recovery books the top-ranked option without a human in the loop. That makes the
  ranking the thing standing between a disruption and a real charge — which is exactly why
  `advisoryRisk` and `stability` outweigh `cost` even under `lowest_cost`, and why bookability sits
  outside the weight matrix where no amount of future learning could erode it.
