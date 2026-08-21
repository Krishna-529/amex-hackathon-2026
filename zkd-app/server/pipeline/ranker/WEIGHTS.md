# Weight card — alternate-flight ranker

*Every number below is read verbatim from `model.json` (v2) or `presets.ts`, the two files
that actually own these values. Every data-provenance claim below is read from the actual
supplier/provider file cited next to it — endpoint, env var, and fallback checked directly
against the source, not summarised from memory.*

## What this ranks

Once a flight is disrupted and hard rules (`applyHardRules` in `score.ts`) have removed anything
that isn't bookable, party-fitting, entitled, or inside the member's deadline, this model orders
what's left. It answers one question: **of the options that are all legal to book, which one
should we actually pick or show first?**

It does not decide *whether* the original flight is cancelled — that's a separate, real,
gradient-boosted model (`zkd-risk-model/`, own card at `zkd-risk-model/MODEL_CARD.md`). This
model only ranks the replacements, and it only ever sees an alternative once six flight sources
have already returned it — see [§3](#3-where-every-candidate-itself-comes-from) before the
per-feature breakdown, because five of the ten features below are just different fields read off
the exact same candidate object, not five independent data pipelines.

## The formula

```
utility(option) = Σ_k  weight_k × feature_k   +   log P(bookable)
rank by utility · softmax(utility) = confidence this is the pick
```

Every `feature_k` is signed so a **larger** number is always more preferred, and every
`weight_k` is clipped to be **non-negative** before use (`enforceMonotone`, `weights.ts`). That
rule is the entire safety guarantee: no matter what a weight's value is, "cheaper", "earlier",
"less downgraded", "fewer stops", "more headroom", and "lower risk" can never rank worse than
their opposite. Direction is never in question; magnitude is what the rest of this document
justifies.

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

Read the diagonal: each strategy's defining feature is its heaviest weight. The bottom five
never vary by strategy — see [§5](#5-why-five-features-never-vary-by-strategy).

---

## 2. Where the six legacy numbers come from

Five of the eight legacy-era weights are not new: they are `server/preferences/presets.ts`'s
pre-existing, previously-argued weights, carried over **exactly**, only rescaled ×6 (a logit
temperature) to work as raw softmax weights instead of a 0–1-normalised average. Verified
numerically against all four strategy rows, not just quoted:

| Criterion | `presets.ts` (sums to 1.00) | ×6 | `model.json` |
|---|---:|---:|---:|
| arrival (earliest_arrival row) | 0.50 | 3.00 | 3.00 ✓ |
| cost (lowest_cost row) | 0.40 | 2.40 | 2.40 ✓ |
| effort (minimize_layovers row) | 0.34 | 2.04 | 2.04 ✓ |
| loyalty (stick_to_preferred_airline row) | 0.30 | 1.80 | 1.80 ✓ |

Every other cell in `arrival`/`cost`/`cabin`/`loyalty`/`effort` across all four rows matches its
`presets.ts` counterpart ×6 to the decimal. `presets.ts`'s own header explains why the shape
exists at all: the member sets one comprehensible knob (`optimization_strategy`) because
*"comparing an overnight-plus-hotel against a same-night two-stop against a carrier-protected
reroute is not a one-dimensional question — a bare enum cannot express 'arrives 4h earlier but
costs money and adds a connection.'"* Porting the numbers, not just the shape, meant the day this
ranker shipped it reproduced the app's existing ranking behaviour exactly — deliberately, so a
learned model was never also a silent behaviour change.

`reliability → stability` is the one legacy value that did **not** port mechanically:
`RELIABILITY_FLOOR = 0.18` scales to `1.08`; the shipped `stability` is `1.20`. See its own
subsection in [§4](#4-feature-by-feature-basis-magnitude-data-source) for why.

---

## 3. Where every candidate itself comes from

Before any feature is computed, a candidate has to exist. Six sources are fanned out
concurrently (`server/suppliers/index.ts`), and **`arrival`, `cost`, `cabin`, and `seats` are
just fields read off whichever of these six produced the candidate** — there is no separate data
pipeline per feature for these four; the pipeline is per *supplier*.

| Supplier | Real endpoint | Auth needed | Without it / dummy behaviour |
|---|---|---|---|
| **Duffel** | `api.duffel.com` (test-mode) | `DUFFEL_ACCESS_TOKEN` | No key → `no-key`, zero offers. **With** a test key, this is real sandbox data, not synthetic — but the sandbox only knows its own dummy routes (e.g. LHR↔JFK); real Indian domestic routes come back genuinely empty. `seatsRemaining` is **hardcoded to `9`** on every offer regardless — Duffel's own sandbox doesn't publish a real count. |
| **Kiwi / Tequila** | Tequila API | `TEQUILA_API_KEY` | No key → `no-key`. The only source with a **real per-offer seat count** (`availability.seats`) when reachable — everything else here is a hardcode or a synthetic count. `cabin` is hardcoded to `'Economy'` (the search response doesn't carry one) and `expiresAt` is left `null` rather than invented, specifically because `confirmWindow.ts` derives the member's whole decision window from that field. |
| **Skyscanner** | RapidAPI mirror, host/path env-driven | `RAPIDAPI_KEY` | No key → `no-key`. Even reachable, every offer is flagged `live: false` — breadth only, `seatsRemaining` fixed at `0` rather than guessed, and it can never win a booking, only fill a gap in what's shown. |
| **Sabre** | `api.cert.sabre.com` (CERT env) | `SABRE_CLIENT_ID` + `SABRE_CLIENT_SECRET` | No creds → empty. With creds, auth genuinely succeeds — but every route/date tried against CERT has returned "No results were found"; the parser is written to degrade to empty on any unexpected shape rather than throw. `expiresAt` is `null` (Sabre ties its ticketing limit to the PNR, not the shop response). |
| **Travelport** | *(none coded)* | — | **Always synthetic**, key or no key — the code path for a present `TRAVELPORT_API_KEY` is currently identical to the no-key path. Generated by `mockFlights.ts`: a deterministic PRNG (`mulberry32`, seeded by an FNV hash of route+date, so the same search always returns the same offers within a process) driving fare/duration off **real route geometry** (`airportDirectory.ts`'s great-circle `distanceKm`, the same function the risk model uses) and a **real carrier reference table** (`mockData/airlines.json` — real IATA codes, names, fleets, illustrative fare bands). Flagged `live: false` on every offer. |
| **TravelFusion** | *(none coded)* | — | Pure stub, always `no-key`, regardless of environment. XML two-phase integration documented in a wiring checklist in the file, never built — an honest absence rather than untested code that looks finished. |

**Currency**: if a fare is quoted outside the card's billing currency, it's converted via
`server/fx.ts` — real ECB daily reference rates from **Frankfurter** (`api.frankfurter.app`,
free, keyless, no fallback-account needed) with a hardcoded `FALLBACK_RATES` table used (and
labelled `stale`) only if that endpoint is unreachable, so a dead rates API can never blank the
option list.

**What this means concretely for a deployment with zero API keys configured**: `arrival`,
`cost`, and `cabin` are computed against **Travelport's synthetic-but-geometrically-real
offers**, since the five real suppliers all degrade to empty without credentials. `seats` in that
same no-key state comes from `mockFlights.ts`'s own generated seat count (see its file for the
exact distribution), not a hardcoded constant.

---

## 4. Feature-by-feature: basis, magnitude, data source

### `arrival` — weight 3.00 (earliest_arrival), down to 1.08 (lowest_cost)

**Basis.** Hours later than the earliest-arriving option in the same candidate set, negated
(`hoursLate = alt.arrivesAt − bestArrival`). An unknown arrival time scores neutral (0), never
best or worst — we cannot penalise what we cannot measure, and refusing to guess is safer than
guessing wrong in either direction.

**Magnitude.** At `3.00` under `earliest_arrival`, this is the single heaviest preference weight
in the entire matrix — more than double `advisoryRisk` (2.50), which is itself the heaviest
*safety* weight. That ordering is deliberate: a member who explicitly chose "get me there
soonest" is stating the one thing they want optimised above all else, including their own money
(cost sits at only 0.60 in that row, a 5:1 ratio). Under `lowest_cost` it drops to `1.08` — still
present, because arrival is never irrelevant, but no longer dominant.

**Data source.** Read directly off the candidate's `arrivesAt` field — see [§3](#3-where-every-candidate-itself-comes-from) for which supplier populated it. No separate feed.

### `cost` — weight 2.40 (lowest_cost), down to 0.60 elsewhere

**Basis.** The fractional premium over the cheapest option actually on the table
(`(fare − cheapestFare) / cheapestFare`), negated and floored at −1 so one freak-expensive
outlier can't compress every other option's cost signal toward zero.

**Magnitude.** `2.40` is the second-heaviest number anywhere in the matrix, trailing only
`advisoryRisk` (2.50) — deliberately, and by a narrow margin. A member who chose `lowest_cost`
is asking to spend less, and the weight says so loudly; but it is capped just under the severe
advisory weight so that even a member optimising purely for price is not, by construction, routed
around a live strike or closure for a marginal saving. See
[§5](#5-why-five-features-never-vary-by-strategy) for the full argument.

**Data source.** `alt.partyFare`, via `costFor()` (`domain/pricing.ts`), traced back to whichever
supplier's `fare`/`total_amount` field produced the candidate — same six-source table as
`arrival`. FX-converted through Frankfurter when the quote isn't already in the card's billing
currency.

### `cabin` — weight 0.48–0.60

**Basis.** Classes below the member's preferred cabin, negated
(`max(0, preferredCabinRank − altCabinRank)`).

**Magnitude.** Held in a narrow band (0.48–0.60) across all four strategies — noticeably lighter
than `arrival` or `cost` in every row, because a cabin drop is a real inconvenience but rarely the
deciding factor in an already-disrupted recovery; the member's actual entitlement ceiling is
enforced upstream as a hard rule (`applyHardRules`), so this feature only ever discriminates among
options that are all *already legal* to book.

**Data source.** Two inputs: `alt.cabin` (supplier-reported — hardcoded `'Economy'` for Kiwi,
real for Duffel sandbox offers, generated by `mockFlights.ts`'s cabin-multiplier table for
Travelport) against `preferredCabinRank`, which comes from **MyCa** — see the `loyalty`
subsection below for MyCa's real-vs-mock behaviour, which is identical here.

### `effort` — weight 0.36–2.04

**Basis.** Extra connections plus an overnight, negated: `−((legs − 1) + overnight)`.

**Magnitude.** `2.04` under `minimize_layovers` is the third-heaviest weight shipped —
proportionally larger than `arrival`'s own boost under `earliest_arrival` (2.04/0.60 ≈ 3.4×
its floor, versus arrival's 3.00/1.08 ≈ 2.8×), because layover count is close to binary in how a
member experiences it: one extra connection is a materially different trip, not a graded
inconvenience the way ten extra minutes of arrival delay is.

**Data source.** Not from a supplier at all — computed structurally. Leg count comes from how
many segments are in the candidate's own `code` (a connection materialised by
`pipeline/compose.ts` names both legs, e.g. `"AI 101 + 6E 202"`); the overnight flag comes from
whether the candidate's `id` was assembled as an overnight bundle
(`id.startsWith('ovn:')`) by the pipeline's own composition logic, itself built from the same
six-supplier searches. No external provider, real or dummy, is queried a second time for this.

### `loyalty` — weight 0.24–1.80

**Basis.** `1` if the candidate's operating carrier is one the member holds status with, else
`0`.

**Magnitude.** `1.80` under `stick_to_preferred_airline` is the strategy's own defining weight —
7.5× its floor value (0.24) elsewhere, the largest strategy-to-strategy swing of any feature in
the matrix, reflecting that "stay on my airline" is otherwise a fairly narrow signal (one
carrier either matches or it doesn't) that needs real weight to actually move a ranking.

**Data source.** The candidate's carrier code (parsed from its own `code` field) against
`preferredCarriers` from **MyCa** (`server/myca.ts`). Real endpoint:
`api.myca.americanexpress.com/v1/members/{id}/travel-profile`, gated on `MYCA_API_KEY`. **No key
is configured in this environment today**, so every member currently reads the single hardcoded
`mockProfile()` fixture — `preferredCarriers: ['AI', '6E']`, `cabinEntitlement: 'Economy'`,
`avoidRedEye: true` — the same three values for every member until real credentials exist. This
is worth stating plainly because it means, right now, the MyCa-sourced features (`loyalty`,
`cabin`'s entitlement half, `redeye`) are not actually personalised member-to-member in a live
run; they will be the moment `MYCA_API_KEY` is set, with no code change required.

### `redeye` — weight 0.60, constant

**Basis.** `−1` only if the candidate is genuinely a red-eye (departs ≥23:00 or arrives before
05:00 local, computed from the candidate's own timestamps via `airportDirectory.ts`'s static
timezone table — not an external API) **and** the member has said they avoid them, else `0`.

**Magnitude.** Set at the same 0.60 as `weatherRisk`, and deliberately no larger: this is a
comfort preference, not a functional or safety concern, so it's sized to be noticeable without
ever being able to overturn a genuine arrival or cost advantage on its own.

**Data source.** Two inputs, neither a live API: the candidate's own departure/arrival instant
(from whichever supplier produced it) converted to local clock time via a static timezone lookup
table, and MyCa's `avoidRedEye` boolean — same mock-vs-real status as `loyalty` above.

### `seats` — weight 0.30, constant

**Basis.** Party headroom beyond the exact count needed
(`min(seats − partySize, 8) / 8`, saturating at 8 spare seats).

**Magnitude.** The lightest weight shipped alongside `redeye` — a tiebreaker among otherwise
comparable options, not a reason to pick a materially worse flight. `applyHardRules` already
guarantees the party fits at the moment of ranking; this only matters because inventory can still
move between search and confirm.

**Data source.** `alt.seats` (supplier-reported — see the wide variance in [§3](#3-where-every-candidate-itself-comes-from): a real count from Kiwi, a hardcoded `9` from Duffel, a fixed
`0` from Skyscanner, a generated count from Travelport's `mockFlights.ts`) minus `partySize`,
which is **the app's own data** — `Booking.travellerIds.length`, read from this app's Postgres
store, not from any external provider.

### `stability` — weight 1.20, constant

**Basis.** The candidate's own historical cancellation propensity by carrier+route, negated
(`−pCancel / 0.05`, so a 5% historical rate reads as a full −1).

**Magnitude.** `1.20` versus the `×6`-scaled `1.08` its predecessor (`RELIABILITY_FLOOR`) would
imply — see [§2](#2-where-the-six-legacy-numbers-come-from) for why it didn't port mechanically.
The short version: the old floor's real job — stopping a fabricated free option from sweeping
every comparison on price — now belongs to `bookability` ([§7](#7-bookability-a-multiplier-never-a-weight)), a multiplier no weight can erode. `stability`'s prior was set slightly above the
old floor's implied value because it now carries genuine information (a real trained model's
output) rather than standing in for a missing rule.

**Data source — not a live call.** `server/pipeline/ranker/cancelRisk.ts` reads two **committed,
local JSON files** produced by `zkd-risk-model/src/train.py` at training time, in this order:

1. `zkd-risk-model/models/entity_rates.json` — the **real** table, trained on 2.4M+ real US
   DOT/BTS + Brazil ANAC historical flights.
2. `zkd-risk-model/models/entity_rates_synthetic.json` — an explicitly labelled **fabricated**
   Indian-market estimate (built by `ingest_india_synthetic.py`), used only where the real table
   has no entry — which is most of the time for Indian domestic carriers/routes, since the real
   table's source data is foreign.
3. If neither table has the carrier or route: a hardcoded `BASE_CANCEL_RATE = 0.02` constant.

The tier actually used is not surfaced in the ranker's output today — a real gap: a member sees
the same `stability` number whether it came from real historical data or a synthetic estimate,
with no visible confidence distinction between the two.

### `weatherRisk` — weight 1.00, constant

**Basis.** Worst live weather severity — ceiling, visibility, gusts, or a significant-weather
hazard code (thunderstorm, icing, snow, fog, volcanic ash, sand) — across the candidate's own
airports (origin, destination, and its connection hub if it has one).

**Magnitude.** Set close to `stability` (1.20) rather than dominating it — both answer a similar
question ("how likely is this option to itself go wrong") from two different evidence sources:
`stability` is a historical average, `weatherRisk` is a live observation. Neither is built to
structurally out-argue the other.

**Data source, real path.** `server/risk/weatherRisk.ts` calls the app's existing `weather.ts` —
**METAR** from NOAA's Aviation Weather Center (`aviationweather.gov/api/data/metar`, free,
keyless) as the primary source, falling back to **Open-Meteo** (`api.open-meteo.com`, free,
keyless) when a station has no recent METAR. Both are genuinely live HTTP calls, no dummy data
involved when reached.

**Gating.** The whole call is behind `process.env.ZKD_LIVE_RISK === '1'` — **off by default**.
With the flag unset (the default in this repo, tests, and any un-configured deployment), this
returns an empty map immediately, no network call is made, and the feature is simply neutral for
every candidate. This was a deliberate choice made when building the feature: the app's other
live integrations (Duffel, Sabre, etc.) gate on missing credentials; this one has no credential
to check (METAR/Open-Meteo are keyless), so an explicit flag stands in for that gate instead, to
keep the demo and test suite deterministic and free of surprise outbound calls.

### `advisoryRisk` — weight 2.50, constant, the heaviest weight shipped

**Basis.** Worst live advisory severity — airspace/airport closures, or strikes/unrest/
geopolitical events — over the candidate's airports or operating carrier.

**Magnitude and why it's the largest number in the file.** This weight exists to answer the
~250-cause disruption taxonomy (weather aside) that the ranker was extended for — strikes,
closures, volcanic ash, war-zone airspace, security threats — collapsed into one signal. These
are the causes most likely to make a "good on paper" option actually undeliverable, so it
outweighs even `lowest_cost`'s own cost weight (2.40). It is **explicitly not a hard filter**: a
`overrideSevereRisk` flag, meant to be set later by an LLM intent layer parsing something like "get
me there no matter what," zeroes this feature's contribution outright — a weight, however heavy,
can always be overridden by an explicit member decision; a hard filter could not have been.

**Data source, real path.** Two independent providers, aggregated by taking the worse of the two
per key (`server/risk/index.ts`):

- **FAA NOTAM** (`server/risk/notam.ts`) — `external-api.faa.gov/notamapi/v1`, needs
  `FAA_NOTAM_CLIENT_ID` + `FAA_NOTAM_CLIENT_SECRET`. Without credentials: empty, regardless of
  the `ZKD_LIVE_RISK` flag. **Covers US airports only** — an Indian airport gets no NOTAM signal
  here at all; an AAI/ICAO source would be needed for India, and isn't wired.
- **GDELT** (`server/risk/gdelt.ts`) — `api.gdeltproject.org`, free, keyless, no credential to
  check. Gated on `ZKD_LIVE_RISK=1` the same way weather is. This is the actual "news" channel —
  the only source here that carries strikes, protests, and geopolitical events, because it indexes
  what's being reported near a place or a carrier's name. It is used as a soft signal on purpose:
  it reports coverage, not a verified incident, which is part of why this whole channel is a
  heavy *weight* rather than an elimination rule.

**Currently live in this environment**: neither. No FAA credentials are configured and
`ZKD_LIVE_RISK` is unset, so `advisoryRisk` is neutral for every candidate today, exactly like
`weatherRisk`. The weight is real and load-bearing the moment either feed is turned on; until
then it's dormant, honestly.

---

## 5. Why five features never vary by strategy

`redeye`, `seats`, `stability`, `weatherRisk`, `advisoryRisk` hold the identical number in all
four rows. This mirrors the reasoning `presets.ts` already states for `RELIABILITY_FLOOR`:
*"No optimisation strategy should be able to talk the agent into an option it cannot actually
book — a member who asked for 'lowest cost' asked to save money, not to be handed a [...] row
with no PNR behind it. Strategy governs which real option wins, never whether an option is
real."*

The same argument extends past bookability to safety and comfort generally: a member who chose
`lowest_cost` is asking the system to spend less of their money, not to accept more risk of being
stranded, or to be put on a red-eye they said they'd rather avoid, in exchange for the last few
rupees. Strategy changes *which acceptable option* wins. It does not change *how much a live
hazard, a party's safety margin, or a stated comfort preference matters* — those are constants
the member did not put up for negotiation when they picked a strategy.

---

## 6. Personalisation on top of the matrix

Before a matrix row is used, three layers resolve (`weights.ts`, `resolveWeights`):

1. **Strategy prior** — the row above, selected by the member's one chosen knob.
2. **MyCa warm start** — added immediately from the member's real (or, today, mock) profile:
   `+0.80` to `loyalty` if the member holds status with any carrier, `+0.80` to `redeye` if they
   avoid them, `+0.40` to `cabin` if entitled above economy. **Basis:** a member is already
   personalised from their very first recovery, with zero interaction history, because MyCa is a
   *stated fact* about them, not an inference that needs data to trust.
3. **Learned deltas** (global, then per-member) — see
   [§8](#8-are-these-numbers-actually-being-trained) for whether this layer is actually live
   today.

Every layer is re-clipped non-negative at the end (`enforceMonotone`), so no personalisation, no
matter how derived, can ever break the "better is never ranked worse" guarantee.

---

## 7. Bookability — a multiplier, never a weight

`P(bookable)` — `0.97` for a live offer with a real expiry, `0.72` for entitled-but-unpriced,
`0.45` for anything else (`bookability.ts`) — enters as `log P` added to the utility, with a
fixed coefficient of exactly `1`. It is **not** in the weight matrix, and it cannot be, by
construction: there is no weight parameter attached to it for training to move. This is what
makes the old `RELIABILITY_FLOOR` policy unnecessary rather than merely enforced — a learned
system can, in principle, learn to undervalue anything that *is* a weight. It cannot learn to
undervalue something that was never a weight in the first place.

---

## 8. Are these numbers actually being trained?

**No, not yet, as shipped.** The architecture (`shrinkToward`, `minDataGlobal`/`minDataMember`
gates, `train.ts`'s L2-to-prior fit) exists and is tested, but two things are still required
before the matrix above will move on its own:

- `logShownSet` (`decisionLog.ts`) fires on every real recovery and records what was shown.
  `logChoice` — the member's actual pick, the other half of a training pair — is defined but
  **not called anywhere in the app**. Zero training pairs exist today.
- `train.ts` is a manual script (`node --experimental-strip-types server/pipeline/ranker/train.ts`).
  Nothing schedules it.

Every number in this document is therefore the *prior* — a deliberately justified starting
point, not yet a fitted result. `learnedByStrategy` and `learnedByMember` in `model.json` are
both `{}`.

---

## 9. Relevance to this product, specifically

Two things about ZKD Concierge make "justified priors, learned later, real-provider-with-honest-
fallback" the right shape for this component, rather than a compromise:

- **The member's card is behind every ranked option.** A ranking that can be wrong in a way
  nobody can explain is not something you put a payment method behind. Every weight above traces
  to either an inherited, previously-argued design decision (`presets.ts`) or a stated reason in
  this document, and every raw feature traces to a named real endpoint plus an explicitly honest
  fallback — never a silent guess. A member, an auditor, or a judge can ask "why did this option
  rank first, and what did it actually know?" and get a real, reconstructible answer.
- **Silence proceeds, on a schedule the member was told about.** `autopilot` consent means an
  unanswered recovery books the top-ranked option without a human in the loop. That makes the
  ranking the thing standing between a disruption and a real charge — which is exactly why
  `advisoryRisk` and `stability` outweigh `cost` even under `lowest_cost`, why bookability sits
  outside the weight matrix where no future learning could erode it, and why every live-data
  feature here is built to degrade to *known-neutral*, never to a guess dressed up as a fact.
