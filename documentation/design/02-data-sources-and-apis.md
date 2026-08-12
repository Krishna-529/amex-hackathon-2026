# Data sources & APIs

**ZKD Concierge · Codestreet 2026 / American Express**

Every signal the model consumes and every system the agent writes to. Pricing and quota figures
are as published at time of writing and must be re-checked before committing — they change.

**Status key:** `wired` = called in the prototype · `sandbox` = credentials obtained, mocked
behind a contract test · `identified` = chosen, not yet integrated · `commercial` = requires a
partnership Amex would have to open.

---

## 1. Flight status and schedules — the disruption trigger

The most important feed in the system. Everything else is secondary.

| Provider | What it gives | Latency | Cost | Status |
|---|---|---|---|---|
| **Cirium (FlightStats)** | Schedules, status, cancellations, tail linkage. The industry reference. | Push webhook, seconds | Enterprise, quote-only | `identified` |
| **FlightAware AeroAPI** | Status, position, tail-number linkage, alerts | Push alerts, ~seconds | ~$0.002–0.02/query; tiered | `identified` |
| **AviationStack** | Status + schedules, real-time flag | Poll, ~1 min | Free 100/mo; ~$50/mo for 10k | `sandbox` |
| **OpenSky Network** | ADS-B positions, free, research-friendly | Poll, 5–10 s | Free (rate-limited) | `sandbox` |
| **Airline NDC / direct** | Authoritative cancellation the moment it is filed | Push | Commercial | `commercial` |

**Design position.** Poll-only detection is not good enough — a 60-second poll means up to 60
seconds of the recovery budget gone before we start. Target architecture is **push (webhook)
primary, poll as reconciliation**:

- **Push** from Cirium or FlightAware for flights in the active window.
- **Poll sweep** every 5 minutes over the same window as a backstop.

> The sweep is not redundancy theatre. A change-feed cannot recover a *dropped* message — and a
> missed cancellation is indistinguishable from a healthy trip, so it fails silently. The periodic
> reconcile is what makes the feed's misses recoverable.

**Tail-number linkage** is the hard part. Rotation is our second-heaviest feature and it requires
knowing which airframe operates your leg. Cirium and FlightAware both expose it; free tiers
generally do not. Where linkage is unavailable the rotation feature degrades to a route-level prior.

---

## 2. Weather — the heaviest feature

| Provider | What it gives | Cost | Status |
|---|---|---|---|
| **NOAA Aviation Weather Center** | METAR, TAF, SIGMET, PIREP. Authoritative, free, no key. | Free | `identified` |
| **IMD (India Meteorological Dept)** | Indian aerodrome forecasts and warnings | Free / MoU | `identified` |
| **OpenWeatherMap** | General forecast, useful for destination-city context | Free 1k/day; ~$40/mo | `sandbox` |
| **Tomorrow.io** | Aviation-specific nowcasting, thunderstorm cells | Paid | `identified` |
| **RainViewer / IMD radar** | Convective cells near the terminal area | Free tier | `identified` |

**Use METAR/TAF, not consumer weather.** A consumer API tells you it is raining. Aviation
cancellations turn on **visibility against published runway minima** and **crosswind component
against runway heading** — quantities only aviation feeds carry. Parsing raw METAR is a solved
problem (`python-metar`, `metar-taf-parser`).

---

## 3. Airport congestion and ATC flow

| Provider | What it gives | Cost | Status |
|---|---|---|---|
| **AAI / DGCA** | Indian airport movement statistics, ground delay programmes | Free, published | `identified` |
| **Eurocontrol NM B2B** | Flow restrictions (European legs) | Free with registration | `identified` |
| **Derived from schedules** | Movements in the ±30 min departure bank | — | `wired` (computable from §1) |

Much of congestion is derivable from the schedule feed we already pay for. Compute it before
buying it.

---

## 4. Historical baselines

| Provider | What it gives | Cost | Status |
|---|---|---|---|
| **DGCA monthly reports** | Per-carrier cancellation rate + cause split (weather / technical / commercial). The basis for our initial feature weights. | Free | `identified` |
| **Cirium historical** | Per-route, per-season on-time and cancellation history | Enterprise | `identified` |
| **Our own observations** | Every prediction and outcome we log from day one | — | `wired` |

Our own log is the one that matters. It is the only corpus that will ever match our exact feature
set, and it is why prediction/outcome logging is in the system from Phase 0.

---

## 5. Booking and inventory — where the money moves

| Provider | What it gives | Notes | Status |
|---|---|---|---|
| **Duffel** | Search, book **and cancel** in sandbox. Real round trip. | This is what makes the rollback demo real rather than narrated | `sandbox` |
| **Sabre Dev Studio** | Shop, price, book; broad Indian carrier coverage | Free self-serve tier; onboarding is the top ask | `sandbox` |
| **Amadeus Self-Service** | — | **Decommissioned 17 Jul 2026. Do not reference it as available.** | ✗ |
| **Airline NDC direct** | Best fares, best change rights, no GDS surcharge | Per-carrier commercial agreement | `commercial` |
| **Travelport** | Alternative GDS | Commercial | `identified` |

**Abstract the supplier.** No single GDS may become load-bearing — coverage differs by carrier and
any one of them can change terms. The agent talks to a supplier-neutral interface.

### The commercial ask

Automatic re-accommodation works best when inventory can be **held briefly while the member has
their 90 seconds**. Today that is a fare-rule and GDS-policy question that varies per carrier.
An **Amex-negotiated hold arrangement with partner airlines** would convert our weakest mechanism
(hold gate + churn governance) into our strongest. This is a partnership ask, not an engineering
task — it belongs in the commercial section of the deck.

---

## 6. Hotels and ground

| Provider | What it gives | Cost | Status |
|---|---|---|---|
| **LiteAPI** | Hotel search + book + cancel in sandbox | Free sandbox | `sandbox` |
| **Booking.com Demand API** | Broad inventory | Partner agreement | `identified` |
| **HotelBeds / Expedia Rapid** | Bed-bank inventory, good for airport hotels | Commercial | `identified` |
| **Uber / Ola API** | Airport transfers, scheduled rides | Partner | `identified` |
| **Local ground handlers** | Per-airport transfer desks | Commercial | `identified` |

Hotel and ground are **derived bookings** — neither can be searched until the replacement flight
is chosen, because the anchor city depends on it. That dependency is enforced in the agent
contract: a hotel task without a `flight_offer_id` is malformed.

---

## 7. Payment

| Provider | What it gives | Status |
|---|---|---|
| **Amex vPayment / ACE** | Single-use virtual account number, locked to amount **and** date | `commercial` (select devs; mocked behind a contract test) |
| **Stripe Issuing** | Equivalent single-use card, useful as a fallback demonstration | `identified` |

The VAN is the security story: **it cannot be reused or overspent**, so even a fully compromised
agent cannot exceed the plan it presented to the member. Any payment provider we use must support
amount-and-date-locked single-use credentials, or the safety claim weakens to a policy promise.

The 90-second quiet window maps onto the **RBI Additional Factor of Authentication e-mandate**
framework as a recognised pre-debit notification. That is a regulatory alignment, and worth
stating explicitly to a financial-services judge.

---

## 8. Notifications

| Provider | What it gives | Status |
|---|---|---|
| **FCM v1** | Android + iOS push | `wired` (Android app) |
| **APNs** | iOS | `identified` |
| **Twilio / MSG91** | SMS fallback when the app is uninstalled or push is throttled | `identified` |
| **SendGrid / SES** | Email with the reissued boarding pass | `identified` |

**iOS throttles data-only pushes.** A disruption alert must be a **hybrid notification +
data payload at `apns-priority: 10`**, not data-only, or it may simply not arrive — and the push
is the only thing most members will ever see of this product.

On Android the disruption alert uses a **dedicated MAX-importance channel** with vibration and
action buttons, separate from the DEFAULT-importance channel used for confirmations. Same product,
different urgency, and the member can mute one without losing the other.

---

## 9. Compliance

| What | Applies to |
|---|---|
| **DPDP Act 2023** | PNR, passport, payment data. Purpose limitation, storage limitation, breach notification. |
| **DGCA CAR Section 3, Series M, Part IV** | Duty of care — meals ≥2 h, hotel + transfer ≥6 h with overnight, alternate flight or refund ≥6 h. Cancellation compensation slabs ₹5,000 / ₹7,500 / ₹10,000 by block time, or the booked fare, whichever is less. Force majeure removes the cash component, never the duty of care. |
| **RBI AFA / e-mandate** | The 90-second pre-debit notification |
| **PCI-DSS** | We hold no PAN or CVV — single-use VANs only, which materially narrows scope |

> **Verification note.** The DGCA thresholds above carry evidence tier `deck` — they are taken
> from the Round 1 submission and the primary CAR text has **not** been re-retrieved for this
> build. They must be reconciled against the current CAR before production. Stated here rather
> than quietly assumed.

---

## 10. What the critical path actually depends on

Ranked by what breaks the product if it goes away:

1. **Flight status push feed** — without it there is no trigger and no product.
2. **Booking API with cancel** — without a real cancel, the rollback story is narrated, not demonstrated.
3. **Single-use payment credential** — without it, "cannot overspend" is a promise rather than a control.
4. **Push notification transport** — without it we act invisibly, which members experience as spooky rather than helpful.
5. Weather, congestion, history — these improve *lead time*, not correctness. Losing them degrades us to the 53-second cold path. Everyone still gets recovered.

That ranking is deliberate: **the model is fourth-order.** It buys speed. The safety and
correctness of the system rest on the policy gate, the consent window and the saga — none of
which consult a probability.
