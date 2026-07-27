# Cancellation Prediction — the model

**ZKD Concierge · Codestreet 2026 / American Express**
Status: design specification. Where a number is a target rather than a measurement, it says so.

---

## 1. What the model is actually for

The model does **not** decide whether to rebook you. A cancellation is a fact the airline
files; we do not need to predict it to act on it.

The model exists for one reason: **to move work off the critical path.** When it says a flight is
at risk, we spend 42 seconds *in advance* — assembling your trip, searching suppliers, pricing
candidates — so that when the cancellation actually lands we need only ~11 seconds instead of 53.

That framing matters, because it sets the cost of being wrong:

| The model says | Reality | What it costs |
|---|---|---|
| High risk | Flight operates | ~102 wasted supplier calls. No member impact. No spend. |
| ≥80%, member pre-authorises | Flight operates | **Nothing.** The instruction is conditional — it expires unused and unnoticed. |
| Low risk | Flight cancels | We recover on the cold path — 53 s instead of 11 s. Still recovered. |

**A false positive costs an API call. A false negative costs 42 seconds.** Neither strands anyone.
This is why we can run an imperfect model in production and still make a safety claim — the
safety claim rests on the WAIT gate, not on the prediction.

> The one place prediction *does* carry real risk is speculative seat holds. That is governed
> separately — see §6.

---

## 2. The prediction target

**P(cancellation | flight, t)** — the probability that a specific flight leg is cancelled,
estimated at time *t* before scheduled departure.

- **Unit of prediction:** one flight leg (carrier + number + date + origin).
- **Horizon:** re-scored continuously from T-24h to T-0. The estimate is not a single number;
  it is a curve that sharpens as departure approaches.
- **Label:** cancellation as filed by the carrier in the schedule feed. Diversions and
  return-to-gate are *not* labelled as cancellations — they are a separate class we do not model yet.

### Why a delay-ratio trigger sits alongside it

The live system does **not** wait for `P > threshold` to declare a disruption. It acts on a
**delay-to-departure ratio crossing** — a deterministic rule on observed delay, not a model output.

```
delay_ratio = accumulated_delay_minutes / minutes_until_scheduled_departure
```

Crossing the threshold is the WATCH trigger. The model runs *earlier* and *alongside*, to decide
who deserves the 42 seconds of preparation. Keeping these separate matters: a deterministic
trigger cannot silently drift the way a model can.

---

## 3. Features

Five families. Each is a real, obtainable signal — §4 names the API for each.

### 3.1 Weather at origin and destination — weight ~34%

The single largest driver of cancellation in Indian domestic aviation.

| Feature | Source | Notes |
|---|---|---|
| `origin_visibility_m` | METAR | Below CAT-I minima ⇒ sharp non-linearity |
| `origin_wind_gust_kt` | METAR / TAF | Crosswind component vs runway heading |
| `origin_cb_within_20nm` | Radar / SIGMET | Thunderstorm cells near the terminal area |
| `dest_*` | same, for arrival | A flight cancels for weather at the *far* end too |
| `fog_season_flag` | derived | Dec–Jan north India; interacts strongly with visibility |

Visibility is not linear. Model it as bucketed thresholds against published CAT-I/II/III minima
for that specific runway, not as raw metres.

### 3.2 Aircraft rotation — weight ~26%

The aircraft scheduled to fly you is, right now, somewhere else. If it is late there, it is late here.

| Feature | Source |
|---|---|
| `inbound_delay_min` | Live flight status on the inbound leg (tail-number linked) |
| `rotation_slack_min` | Scheduled ground time minus minimum turn time for the type |
| `inbound_legs_remaining` | How many hops before it reaches you — error compounds |
| `tail_swap_available` | Does the carrier have spare metal at that station |

`rotation_slack_min < 0` is the strongest single non-weather predictor we expect to find. A tight
turn on a already-late inbound is how a cancellation is *made*, not merely forecast.

### 3.3 Airport congestion — weight ~18%

| Feature | Source |
|---|---|
| `departures_in_slot` | Scheduled movements in the ±30 min bank |
| `current_ground_delay_program` | ATC flow restriction in force |
| `stand_availability` | Where published |

### 3.4 Route and carrier history — weight ~14%

| Feature | Source |
|---|---|
| `route_cancel_rate_90d` | DGCA monthly + our own observed history |
| `carrier_cancel_rate_90d` | DGCA publishes this per airline |
| `seasonal_route_rate` | Same route, same month, prior years |

### 3.5 Time of day — weight ~8%

Delay accumulates through the operating day. A 06:00 departure starts from a clean slate; a 21:00
departure inherits every disruption since morning.

| Feature | Source |
|---|---|
| `hours_since_first_bank` | Derived from schedule |
| `carrier_otp_by_hour` | Derived from observed history |

---

## 4. How the probability is computed

### 4.1 Production model — gradient-boosted trees

This is a **tabular** problem: dozens of numeric and categorical features, strong non-linearities
(visibility minima), strong interactions (fog × time-of-day, rotation slack × tail availability).
That is precisely where gradient-boosted decision trees beat both linear models and neural nets.

- **Algorithm:** LightGBM (or XGBoost), binary objective, ~400–800 trees, depth 6–8.
- **Hardware:** CPU. **No GPU is required** — see `03-infrastructure-and-cost.md`.
- **Scoring cadence:** batch, every 10 minutes, across all flights in the active window; plus an
  event-triggered re-score when a material feature changes (new METAR, inbound delay update).
- **Calibration:** isotonic regression on a held-out set. Untreated, GBDT outputs are *not*
  probabilities — and we surface a percentage to members, so calibration is not optional. A
  flight we call "70%" must cancel about 70% of the time.
- **Validation:** time-based split, never random. Train on months 1–9, validate 10, test 11–12.
  Random splits leak weather across the split and produce a model that looks excellent and is useless.

**Metrics we hold ourselves to:**

| Metric | Why this one |
|---|---|
| **PR-AUC** | Cancellations are rare (~1–2% of legs). ROC-AUC flatters badly on imbalanced data. |
| **Brier score** | Are the probabilities honest, not just correctly ordered |
| **Reliability curve** | Plotted per decile — the direct test of the number we show members |
| **Recall @ 24h / 6h / 2h** | Lead time is the product. A correct call 10 minutes out is worth little |

### 4.2 The prototype's transparent model

The demo does not ship a trained model — we have no historical corpus yet. It uses an explicit
**weighted linear sum** so every number on screen is inspectable:

```
P = Σ (weight_i × severity_i)     severity ∈ [0,1], Σ weight = 100
```

Implemented in `zkd-app/lib/risk.ts`. It is deliberately simple, deliberately visible, and each
factor's contribution is shown to the member as its own bar. **This is a stand-in for the GBDT,
not a claim about accuracy** — its purpose is to make the *shape* of the reasoning legible.

### 4.3 Cold start

We will not have labelled history on day one.

1. **Phase 0 — heuristic.** Ship the weighted sum above, with weights set from published DGCA
   cause-of-cancellation splits. Log every prediction and every outcome.
2. **Phase 1 — supervised, ~3 months in.** Train the GBDT on accumulated observations once we
   have enough positives (target: ≥5,000 cancellation events).
3. **Phase 2 — continuous.** Retrain weekly, shadow-score against the incumbent, promote only on
   a PR-AUC and calibration improvement on the held-out period.

Until Phase 1, **the displayed percentage carries a "modelled estimate" caveat** and speculative
holds stay disabled (§6).

---

## 5. What we do with the probability

Bands drive behaviour. The thresholds below are the initial policy and are expected to move once
calibration data exists.

| P(cancel) | Band | What the system does | What the member sees |
|---|---|---|---|
| **< 25%** | Low | Monitor only. Re-score every 10 min. | A green figure on the flight. No notification. |
| **25–55%** | Moderate | **Begin WARM**: assemble trip context, run the per-route coordinator reshop, price and hold candidates warm. No booking, no spend, no hold. | An amber figure. Still no notification — nothing has happened to them yet. |
| **55–80%** | High | WARM plus: evaluate the **hold gate** (§6); pre-position duty-of-care options; pre-compute the policy verdict on every candidate. | A red figure and the line *"we have backup seats identified."* |
| **≥ 80%** | Pre-authorise | **Go and ask now, while there is still time to think.** Present the full plan — flight, room, both cab legs, and the exact amount — and collect a *conditional* instruction. | A notification: *"AI 2803 looks like it will cancel — 83%. Tell us now what you'd want."* |
| **Any** | Delay-ratio crossing | WATCH fires regardless of P. This is deterministic and does not consult the model. | Nothing yet — the phone stays silent. |
| **Any** | Carrier files cancellation | ACT. Allocation → policy gate → 90-second consent window → saga. | The notification. |

**Only two things in this table notify: an actual disruption, and crossing 80%.** Below 80% a
probability is not news a member can act on, and a product that cries wolf at 60% gets muted —
after which it cannot help at all. At 80% the calculus inverts: the event is genuinely likely, and
the ask is not *"your flight is cancelled"* but *"what would you like if it is?"* — a question they
have hours to answer instead of ninety seconds.

### 5.1 Pre-authorisation — the point of predicting at all

This is what the model is really for. WARM moves the *searching* off the critical path;
pre-authorisation moves the **consent** off it too — the one part of a recovery that must otherwise
wait for a human.

If the member answers:

| | Without pre-auth | With pre-auth |
|---|---|---|
| Cancellation lands | Notify, open 90 s window | **Execute immediately** |
| Member's thinking time | 90 seconds, under pressure | Hours, calm |
| Human in the critical path | Yes | **No** |
| Machine time | ~11 s | ~11 s |

The authorisation is **conditional and specific**. It fires only if the flight actually cancels,
and only for the plan they were shown. If any part of that plan is gone by then, the authorisation
**does not carry over** — we fall back to asking. Silently substituting a plan the member never saw
would break the single promise the architecture rests on: *we can never spend beyond what we showed
you.*

Not answering is safe and costs nothing: it simply falls back to the 90-second window.

### 5.1 Why bands and not a single threshold

A single cutoff forces one decision. Bands let the *cost* of the action match the *confidence*:
preparing costs API quota, holding costs churn budget and inventory externality, booking costs
money. Each escalation demands more confidence than the last.

---

## 6. The hold gate — where prediction carries real risk

Preparing is free. **Holding a seat is not.** A speculative hold removes inventory from the market,
and a hold that expires unticketed damages the distribution relationship that makes the whole
product possible.

A speculative hold is taken **only** when both hold:

```
hold_TTL > expected_time_to_announcement
AND
P(cancel) × value_of_seat > cost_of_hold + inventory_externality
```

The first condition is why prediction confidence alone is not sufficient: a hold that expires
before the carrier decides returns the seat to a market that clears in seconds — you lose the
seat *and* your place in the queue. **Re-holding is not renewal.**

### Churn governance

```
hold_conversion = holds ticketed ÷ holds placed     target ≥ 85%, per carrier
```

Below the floor, speculative holding for that carrier **auto-disables**. This is the mechanism
that makes model quality self-limiting: a badly calibrated model churns, churn conversion falls,
holding switches itself off, and the system degrades to warm-candidates-only rather than
degrading the airline relationship. **Prediction precision *is* hold conversion.**

---

## 7. Honest limitations

Stated plainly, because a judge will find them.

1. **No trained model yet.** The prototype ships a transparent weighted sum. Accuracy claims are
   deferred to Phase 1 and will be earned on held-out data, not asserted.
2. **We do not model diversions or return-to-gate.** Both strand a member as effectively as a
   cancellation. Out of scope for v1 and stated as such.
3. **Cross-route correlation is approximated.** A Delhi closure cancels every route into Delhi at
   once; we capture this with a scarcity multiplier rather than a proper network model. The
   Monte Carlo in `iropssim.py` shares this limitation.
4. **Fare and policy availability is not modelled.** A seat that exists is treated as bookable,
   when it may be out of fare policy or priced beyond what the policy layer allows.
5. **API failure is not modelled** — rate-limit rejections, timeouts, circuit-breaker openings.
   Given that supplier rate limits are our binding constraint, this is the most important gap.
6. **Tail-number linkage is the hardest data problem.** Rotation is our second-heaviest feature
   and it depends on reliably knowing which airframe flies your leg. Coverage varies by carrier;
   where we cannot link the tail, that feature degrades to a route-level prior.

---

## 8. What the member is shown, and why

The percentage is displayed with its **five contributing factors, each as its own bar with a
plain-language note.** Not because it is pretty — because an unexplained number invites exactly
one question, and we would rather answer it on the screen than in a support call.

Two rules govern the display:

- **Never show a probability without its drivers.** "60%" alone is a horoscope.
- **Never let the number imply an action the member must take.** They granted standing permission
  precisely so they would not have to watch a number.

---

## See also

- `02-data-sources-and-apis.md` — every API behind every feature, with quotas and costs
- `03-infrastructure-and-cost.md` — why there is no GPU on the critical path
- `04-action-policy.md` — the full decision table from detection through settlement
