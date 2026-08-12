# Disruption prediction — what we buy, and what we do with it

**ZKD Concierge · Codestreet 2026 / American Express**
Status: design specification. Where a number is a target rather than a measurement, it says so.

---

## 1. What the prediction is actually for

The forecast does **not** decide whether to rebook you. A cancellation is a fact the airline
files; we do not need to predict it to act on it.

It exists for one reason: **to move work off the critical path.** When a flight is flagged at
risk, we spend 42 seconds *in advance* — assembling your trip, searching suppliers, pricing
candidates — so that when the disruption actually lands we need only ~11 seconds instead of 53.

That framing sets the cost of being wrong:

| The forecast says | Reality | What it costs |
|---|---|---|
| High risk | Flight operates | ~102 wasted supplier calls. No member impact. No spend. |
| Above the ask-early threshold, member pre-authorises | Flight operates | **Nothing.** The instruction is conditional — it expires unused and unnoticed. |
| Low risk | Flight cancels | We recover on the cold path — 53 s instead of 11 s. Still recovered. |

**A false positive costs an API call. A false negative costs 42 seconds.** Neither strands anyone.
This is why we can run an imperfect forecast in production and still make a safety claim — the
safety claim rests on the WAIT gate, not on the prediction.

> The one place prediction *does* carry real risk is speculative seat holds. That is governed
> separately — see §6.

---

## 2. We buy the forecast rather than building one

Predicting flight disruption is an existing industry with vendors trained on far more history
than we could assemble. Building our own gradient-boosted model on scraped DGCA data would take
months to reach a worse answer, and would duplicate a product we can simply call.

**The predictive layer is Lumo** (thinklumo.com), as the submission deck has stated since Round 1.
It is a commercial API that reads weather, air-traffic flow, airport congestion and per-carrier
history, and returns per-flight disruption probabilities.

### What Lumo gives us

| Surface | What we use it for |
|---|---|
| Flights API | Per-leg cancellation probability, delay distribution, and connection risk on the onward leg |
| Subscription API | Webhook push on **schedule change and cancellation** — this is what makes reschedule detection possible (§3) |
| Airports API | Airport-level disruption outlook, used as a scarcity hint when a whole hub degrades |

### What it does not give us, and what we do instead

- **No commercial key yet.** `zkd-app/server/lumo.ts` is shaped to the real API and falls back to
  a deterministic mock when `LUMO_API_KEY` is unset. Every response carries `source: 'lumo' | 'mock'`,
  and the UI prints which one it was. Nothing on screen ever claims a mocked number is a vendor one.
- **Its accuracy is a vendor claim.** Until we have back-tested it against outcomes on our own
  routes, the forecast is **advisory**: it decides when we start preparing, never whether we spend.
  No speculative hold is taken on a Lumo number alone (§6).
- **We reconcile against ground truth.** AviationStack (free tier) gives observed status and
  schedule times independently of Lumo, which is both the reschedule fallback and the beginning of
  a back-test corpus.

### Why not our own model on top

We considered blending Lumo with our own features and rejected it for this stage. Two forecasts
combined by an untuned rule is not more accurate than the better one — it is just harder to explain
when it is wrong. Once we have enough outcome data to *measure* a blend, that is a Phase 2
conversation.

---

## 3. What we predict for, beyond cancellation

The original scope was cancellations only, which turned out to be the smaller half of the problem.

| Kind | What actually happened | What it needs |
|---|---|---|
| **Cancellation** | The carrier killed the leg | A replacement flight, plus everything downstream |
| **Reschedule** | The carrier moved the leg | Nothing at all if the connection survives — just the hotel and transfers re-timed |
| **Delay cascade** | The leg is late enough to break something downstream | Depends on whether the connection holds |
| **Diversion** | It is landing somewhere else | Rebuild the trip around where it lands |

**Reschedule is the one that was invisible.** When a carrier moves a flight it also moves its own
schedule, so the delay it reports against the new time is zero. The only way to see it is to diff
the carrier's current published departure against **what the member actually booked** — which is
why `Flight.bookedDepartureAt` exists and why `server/aviationstack.ts` now reads
`departure.scheduled` rather than delay minutes alone.

Classification lives in `zkd-app/lib/disruptionKind.ts`. A schedule move under 15 minutes is noise.
A move that still makes the onward connection triggers Pipeline 3 (Cascading Logistics) **without**
Pipeline 1 — no new ticket, no consent window, because nothing is being spent.

---

## 4. Adaptive thresholds

The old design had fixed bands at 25 / 55 / 80%. That assumes the cost of waiting is constant
across flights, and it is not.

If three seats remain on the entire route and departure is in an hour, waiting for more certainty
costs the member the seat. If there are forty seats and they fly tomorrow, hurrying buys nothing.
So the threshold moves:

```
threshold = base × scarcity × urgency × criticality ÷ confidence
```

| Factor | Direction | Why |
|---|---|---|
| `scarcity` | Fewer seats across all suppliers ⇒ act earlier | The option disappears while we deliberate |
| `urgency` | Closer to departure ⇒ act earlier | Time is the other thing you cannot buy back |
| `criticality` | Hard onward constraint ⇒ act earlier | A broken connection costs more than a wasted search |
| `confidence` | Lower forecast confidence ⇒ demand **more** | An uncertain forecast has to clear a higher bar |

Implemented in `zkd-app/lib/thresholds.ts`, clamped to a stated floor and ceiling so it cannot
drift somewhere absurd, and returned **with its inputs** so the decision ledger can reconstruct why
a band fired. An adaptive threshold nobody can replay after the fact is not auditable.

The scarcity input is real, not notional: it is the seat count across every supplier in §7.

---

## 5. What we do at each band

| Band | What the system does | What the member sees |
|---|---|---|
| **Watch** | Monitor only. | A green figure on the flight. No notification. |
| **Prepare** | Assemble trip context, run the per-route coordinator reshop, price candidates warm. No booking, no spend, no hold. | An amber figure. Still no notification — nothing has happened to them yet. |
| **Hold gate** | Prepare, plus evaluate the hold gate (§6), pre-position duty-of-care options, pre-compute the policy verdict on every candidate. | A red figure and the line *"we have backup seats identified."* |
| **Ask early** | **Go and ask now, while there is still time to think.** Present the full plan — flight, room, both cab legs, exact amount — and collect a *conditional* instruction. | A notification: *"AI 2803 looks like it will cancel — 83%. Tell us now what you'd want."* |
| **Carrier acts** | ACT. Allocation → policy gate → derived confirmation window → saga. | The notification. |

**Only two things notify: an actual disruption, and crossing the ask-early threshold.** Below it a
probability is not news a member can act on, and a product that cries wolf gets muted — after which
it cannot help at all. At the threshold the calculus inverts: the ask is not *"your flight is
cancelled"* but *"what would you like if it is?"* — a question they have hours to answer.

### 5.1 Pre-authorisation — the point of predicting at all

WARM moves the *searching* off the critical path; pre-authorisation moves the **consent** off it too
— the one part of a recovery that must otherwise wait for a human.

| | Without pre-auth | With pre-auth |
|---|---|---|
| Cancellation lands | Notify, open the window | **Execute immediately** |
| Member's thinking time | Minutes, under pressure | Hours, calm |
| Human in the critical path | Yes | **No** |
| Machine time | ~11 s | ~11 s |

The authorisation is **conditional and specific**. It fires only if the flight actually cancels, and
only for the plan they were shown. If any part of that plan is gone by then it **does not carry
over** — we fall back to asking. Silently substituting a plan the member never saw would break the
single promise the architecture rests on: *we can never spend beyond what we showed you.*

Not answering is safe and costs nothing: it falls back to the confirmation window (§8).

---

## 6. The hold gate — where prediction carries real risk

Preparing is free. **Holding a seat is not.** A speculative hold removes inventory from the market,
and a hold that expires unticketed damages the distribution relationship that makes the product
possible.

A speculative hold is taken **only** when both hold:

```
hold_TTL > expected_time_to_announcement
AND
P(cancel) × value_of_seat > cost_of_hold + inventory_externality
```

The first condition is why confidence alone is not sufficient: a hold that expires before the
carrier decides returns the seat to a market that clears in seconds — you lose the seat *and* your
place in the queue. **Re-holding is not renewal.**

### Churn governance

```
hold_conversion = holds ticketed ÷ holds placed     target ≥ 85%, per carrier
```

Below the floor, speculative holding for that carrier **auto-disables**. This is what makes forecast
quality self-limiting: a badly calibrated forecast churns, conversion falls, holding switches itself
off, and the system degrades to warm-candidates-only rather than degrading the airline relationship.
**Forecast precision *is* hold conversion** — and it is also our back-test signal, because
conversion is measured against outcomes we observe ourselves rather than accuracy the vendor claims.

---

## 7. Inventory: two to three sources, never one

A single GDS does not carry enough of the market to recover a trip from, and the deck's own
principle is to *abstract the supplier so no single GDS is load-bearing*.

| Source | Status | Notes |
|---|---|---|
| **Duffel** | Live sandbox | NDC aggregator. The only source giving a real per-offer `expires_at`, which §8 depends on |
| **Sabre** | Live cert, unpopulated | Authenticates; cert returns no results on tested routes. Degrades to empty, not error |
| **Travelport** | Behind the interface, synthetic | The alternative GDS once Amadeus was decommissioned. Flagged `live: false` and never presented as bookable |
| Amadeus Self-Service | **Dead** | Portal decommissioned 17 Jul 2026. Never cite it as available |

`zkd-app/server/suppliers/` fans out with `Promise.allSettled`, normalises to one offer shape
carrying **currency** and **expiry**, de-duplicates the same physical flight arriving from two
sources, and reports per-source status so the UI can say what it actually looked at. A dead source
degrades the result rather than failing it.

---

## 8. The confirmation window

The old design gave the member a flat 90 seconds. Nothing in the codebase or these documents could
defend that number, and 90 seconds is not long enough for a person to read a plan and decide.

The window is now **derived from the supplier's own promise**:

```
window = clamp( (offer.expires_at − now) − exec_budget − network_margin,
                FLOOR, min(CEILING, time_to_departure − checkin_cutoff) )
```

When a supplier quotes a fare it guarantees that price until a stated moment. The member's window
is that guarantee minus the time we need to book inside it. It typically lands between 5 and 20
minutes rather than 90 seconds, and — crucially — it can be defended when a judge asks why.

- **FLOOR (2 min)** — below this the ask is theatre. A push has to arrive, be noticed and be
  answered. Under the floor we do not ask: consent tier decides alone (autopilot acts; ask-me-first
  acts if the recovery is free, escalates if it costs). *This floor is a stated assumption and
  should be replaced by measured push-to-first-interaction latency.*
- **CEILING (20 min)** — the offer's expiry is the supplier's promise, not the market's.
- **check-in cutoff** — 45 min domestic, 60 international. A window that outlives check-in is useless.

### Why a longer window is safe: re-validation

The obvious objection is that a longer window means the seat gets sold while the member deliberates.
We do not solve that by rushing them. **At the moment of confirm — and not before — we re-check that
exact offer with the supplier.** If it is gone we do not fail: we present the next ranked candidate
from the portfolio immediately.

This is the design's own principle made real: consent is *to the outcome, not to a seat*. It is
implemented in `server/suppliers/index.ts` (`revalidateOffer`, `firstBookable`) and verified
end-to-end against live Duffel inventory — a sold offer cascades to the next flight rather than
erroring.

A re-check that cannot reach the supplier returns `unknown`, which is deliberately **not** treated
as available. A source we could not verify is a source we cannot promise.

---

## 9. Where the member's preferences come from

Preferences, entitlement and payment come from **MyCa**, the card member app —
`zkd-app/server/myca.ts`. The concierge is not the system of record and keeps no copy.

This matters beyond tidiness: ranking a replacement means knowing the cabin the member is entitled
to and the cap on a single transaction. A local copy would drift from the card, and we would rank
against entitlements they no longer have.

Candidates are ranked against those preferences rather than hardcoded rules. A candidate outside
entitlement is surfaced and marked, never silently dropped — the member is allowed to see what was
ruled out and why.

**Open question, deliberately unresolved:** when the card member books for someone else, spend
authority sits with the card member while the passport and preferences belong to the traveller. The
types in `server/myca.ts` keep `cardMember` and `traveller` separate so the answer can be dropped
in, but the consent rules for that case are not guessed at here.

---

## 10. International

The product was India-only in ways that were not obvious until we looked:

| Was | Now |
|---|---|
| 7 hand-written airports | 6,072 IATA airports with country and **IANA timezone** (`server/airportDirectory.ts`) |
| Fares as bare numbers | Every money value carries its currency |
| `currency: 'INR'`, `guestNationality: 'IN'` hardcoded in hotel search | Both from the MyCa profile |
| DGCA duty of care only | Jurisdiction bundles: DGCA (India), EU261 (EU/UK), card terms elsewhere |

Timezone is not optional once routes cross zones: reschedule detection diffs departure times, and
comparing a Chennai clock with a London one produces a nine-hour "delay" that never happened.

Entitlement is data, not code (`lib/entitlement.ts`) — the deck's own claim, now true. The engine
looks up a bundle and reads thresholds off it; it does not know which country it is in. Two bundles
prove the engine is jurisdiction-neutral; more is a data exercise.

**Known gap:** EU261 attaches to departures from the EU/UK on any carrier and to arrivals on an EU
carrier. We do not model carrier nationality, so we apply the departure rule — the one that always
holds — and under-claim on the arrival case.

**Known gap:** the per-transaction cap is set in the card's billing currency and we hold no FX
rates, so a fare quoted in another currency cannot be compared to it. Those candidates are marked
as needing conversion rather than silently approved or silently blocked.

---

## 11. Honest limitations

Stated plainly, because a judge will find them.

1. **No commercial Lumo key.** The adapter is shaped to the real API; every response is labelled
   `mock` until a key exists. Accuracy claims are the vendor's and are not repeated as ours.
2. **The forecast has not been back-tested on our routes.** It is advisory. It moves work earlier
   and authorises nothing.
3. **Demo fixtures are pinned.** The three flights in the walkthrough carry fixed probabilities so
   the scenario is reachable; they still report `source: 'mock'`.
4. **Diversions are classified but not handled end-to-end.** The taxonomy has a slot; the recovery
   path for "it landed somewhere else" is not built.
5. **Cross-route correlation is approximated.** A Delhi closure cancels every route into Delhi at
   once; we capture this with a scarcity multiplier rather than a network model. `iropssim.py`
   shares this limitation.
6. **API failure is not modelled** — rate-limit rejections, timeouts, circuit-breaker openings.
   Given that supplier rate limits are our binding constraint, this is the most important gap.
7. **Sabre cert returns no inventory**, so the multi-source claim rests on Duffel plus synthetic
   Travelport. The abstraction is proven; the third real source is not.
8. **The confirmation-window floor is assumed, not measured.** It should come from real
   push-to-interaction telemetry.
9. **Payment is mocked.** vPayment single-use issuance is a contract test behind the mock.

---

## 12. What the member is shown, and why

The probability is displayed **with its source and the thresholds it is judged against**. The old
design showed five invented factor bars; those are gone, because presenting fabricated weights next
to a vendor probability would be the same dishonesty in a new place.

Three rules govern the display:

- **Never show a probability without saying where it came from.** A number whose origin is hidden
  is a horoscope.
- **Never show a mocked number as a real one.** `source` is on screen.
- **Never let the number imply an action the member must take.** They granted standing permission
  precisely so they would not have to watch a number.

---

## See also

- `02-data-sources-and-apis.md` — every API behind every feature, with quotas and costs
- `03-action-policy.md` — the full decision table from detection through settlement
- `04-infrastructure-and-cost.md` — why there is no GPU on the critical path
