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
| **AviationStack** | Status + schedules incl. **scheduled/estimated departure times** | Poll, ~1 min | Free 100/mo; ~$50/mo for 10k | `wired` |
| **Lumo Subscription API** | Webhook push on **schedule change** and cancellation | Push | Commercial | `sandbox` (mocked) |
| **Airline NDC / direct** | Authoritative cancellation the moment it is filed | Push | Commercial | `commercial` |

**Schedule times, not just delay minutes.** A reschedule is a change to the *schedule*, so the
carrier's reported delay against the new time reads as zero. Detecting one requires the published
`departure.scheduled` diffed against **what the member actually booked**. This is why
`server/aviationstack.ts` reads scheduled and estimated times, and why the booked departure is kept
as a fixed reference point on every Flight.

**Design position.** Poll-only detection is not good enough — a 60-second poll means up to 60
seconds of the recovery budget gone before we start. Target architecture is **push (webhook)
primary, poll as reconciliation**:

- **Push** from Cirium or FlightAware for flights in the active window.
- **Poll sweep** every 5 minutes over the same window as a backstop.

> The sweep is not redundancy theatre. A change-feed cannot recover a *dropped* message — and a
> missed cancellation is indistinguishable from a healthy trip, so it fails silently. The periodic
> reconcile is what makes the feed's misses recoverable.

**Tail-number linkage** used to be our hard problem, because rotation was our second-heaviest
feature. It is now the *forecaster's* problem — see §2.

---

## 2. Disruption prediction — bought, not built

| Provider | What it gives | Cost | Status |
|---|---|---|---|
| **Lumo (thinklumo.com)** | Per-leg cancellation probability, delay distribution, connection risk, airport outlook, schedule-change webhooks | Commercial | `sandbox` (adapter shaped to the real API, deterministic mock without a key) |

**We no longer consume weather, congestion or rotation feeds directly.** Those are inputs to a
disruption forecast, and forecasting is an existing industry trained on far more history than we
could assemble. Re-deriving visibility minima, crosswind components and tail rotation ourselves
would take months to produce a worse answer than a vendor already sells.

| Removed | Why |
|---|---|
| NOAA Aviation Weather Center | Weather is a Lumo input, not ours |
| Open-Meteo | Same, and it was a consumer feed standing in for aviation data |
| OpenSky Network | Aircraft counts near an airport were an honest proxy for congestion and rotation — but a proxy for something the vendor measures properly |

**AviationStack stays**, because it gives us observed outcomes independent of the forecaster. That
independence is what makes it both the reschedule fallback and the beginning of a back-test corpus.

### The honesty constraint

Every forecast response carries a `source` of `lumo` or `mock`, surfaced in the UI. Until a
commercial key exists everything is mocked and says so. Until the forecast is back-tested against
outcomes on our own routes it is **advisory**: it decides when preparation starts, never whether
money moves.

---

## 3. Historical baselines

| Provider | What it gives | Cost | Status |
|---|---|---|---|
| **DGCA monthly reports** | Per-carrier cancellation rate + cause split. Context for the deck's problem framing. | Free | `identified` |
| **Our own observations** | Every forecast and outcome we log from day one | — | `wired` |

Our own log is the one that matters — not to train a model, but to **back-test the vendor's**. Hold
conversion (`01-prediction-model.md` §6) is the measurable form of that: it scores forecast
precision against outcomes we observe ourselves rather than accuracy the vendor claims.

---

## 4. Booking and inventory — where the money moves

| Provider | What it gives | Notes | Status |
|---|---|---|---|
| **Duffel** | Search, book **and cancel** in sandbox. Real round trip. Carries a per-offer `expires_at`. | Makes the rollback demo real rather than narrated — and its offer expiry is what the confirmation window is derived from | `wired` |
| **Sabre Dev Studio** | Shop, price, book; broad Indian carrier coverage | Authenticates against cert; every route tried returns no results. Degrades to empty, never blocks the others | `wired` (unpopulated) |
| **Amadeus Self-Service** | — | **Decommissioned 17 Jul 2026. Do not reference it as available.** | ✗ |
| **Airline NDC direct** | Best fares, best change rights, no GDS surcharge | Per-carrier commercial agreement | `commercial` |
| **Travelport** | The alternative GDS after Amadeus was decommissioned | Behind the same interface, returning synthetic inventory flagged non-live. Never presented as bookable | `sandbox` |

**Abstract the supplier.** Implemented in `zkd-app/server/suppliers/` — one `searchInventory()` fans
out with `Promise.allSettled`, normalises to a single offer shape carrying **currency** and
**expiry**, de-duplicates the same physical flight arriving from two sources, and reports per-source
status so the UI can say what it actually looked at. A dead source degrades the result rather than
failing it.

The union of sources also feeds the scarcity input to the adaptive thresholds — seat counts across
every supplier are what make “act earlier when there is less left” implementable.

### Re-validation before spend

`revalidateOffer()` re-checks a chosen offer with its supplier at the moment of confirm, and
`firstBookable()` walks the ranked portfolio when it is gone. A source we cannot re-check returns
`unknown`, which is **not** treated as available — we cannot promise what we could not verify.

### The commercial ask

We cannot hold inventory: a passenger cannot hold two flight tickets, so a speculative hold on a
replacement seat is a duplicate booking that carriers cancel. We therefore refresh continuously
instead, and race for the seat at the carrier event.

An **Amex-negotiated arrangement with partner airlines** — a named-account option to hold a seat
against a card member's existing ticket without tripping duplicate detection — would remove that
race entirely. It is the single change that would most improve same-day recovery, and it is a
partnership ask, not an engineering task. It belongs in the commercial section of the deck.

---

## 5. Hotels and ground

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

## 6. Member profile, preferences and payment

| Provider | What it gives | Status |
|---|---|---|
| **MyCa** (Amex card member app) | Identity, passport, travel preferences, cabin entitlement, per-transaction cap, card product terms, payment instrument reference | `sandbox` (mocked) |

**The concierge is not the system of record.** Preferences are read from MyCa at recovery time and
no copy is kept — a local copy would drift from the card, and we would rank replacement flights
against entitlements the member no longer holds. Candidates are ranked against MyCa entitlement
rather than hardcoded rules, and anything outside it is surfaced and marked rather than dropped.

**Open, needs Amex input:** when the card member books for someone else, spend authority sits with
the card member while the passport and preferences belong to the traveller. `server/myca.ts` keeps
`cardMember` and `traveller` as separate fields so the answer can be dropped in; the consent rules
for that case are not guessed at.

---

## 7. Airports and jurisdictions

| Source | What it gives | Status |
|---|---|---|
| **OpenFlights airport dataset** | 6,072 airports with IATA/ICAO, city, country and IANA timezone | `wired` |

This replaced a hand-written table of seven airports, which was the hard blocker on operating
outside one Indian route. Timezone is the load-bearing field: reschedule detection diffs departure
times, and comparing a Chennai clock against a London one invents a nine-hour delay.

Duty of care is selected by route jurisdiction — DGCA (India), EU261 (EU/UK), card benefit terms
elsewhere. Entitlement is data, not code (`lib/entitlement.ts`).

---

## 8. Payment

| Provider | What it gives | Status |
|---|---|---|
| **Amex vPayment / ACE** | Single-use virtual account number, locked to amount **and** date | `commercial` (select devs; mocked behind a contract test) |
| **Stripe Issuing** | Equivalent single-use card, useful as a fallback demonstration | `identified` |

The VAN is the security story: **it cannot be reused or overspent**, so even a fully compromised
agent cannot exceed the plan it presented to the member. Any payment provider we use must support
amount-and-date-locked single-use credentials, or the safety claim weakens to a policy promise.

The quiet window maps onto the **RBI Additional Factor of Authentication e-mandate**
framework as a recognised pre-debit notification. That is a regulatory alignment, and worth
stating explicitly to a financial-services judge.

---

## 9. Notifications

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

## 10. Compliance

| What | Applies to |
|---|---|
| **DPDP Act 2023** | PNR, passport, payment data. Purpose limitation, storage limitation, breach notification. |
| **DGCA CAR Section 3, Series M, Part IV** | Duty of care — meals ≥2 h, hotel + transfer ≥6 h with overnight, alternate flight or refund ≥6 h. Cancellation compensation slabs ₹5,000 / ₹7,500 / ₹10,000 by block time, or the booked fare, whichever is less. Force majeure removes the cash component, never the duty of care. |
| **RBI AFA / e-mandate** | The pre-debit notification and its quiet window |
| **PCI-DSS** | We hold no PAN or CVV — single-use VANs only, which materially narrows scope |

> **Verification note.** The DGCA thresholds above carry evidence tier `deck` — they are taken
> from the Round 1 submission and the primary CAR text has **not** been re-retrieved for this
> build. They must be reconciled against the current CAR before production. Stated here rather
> than quietly assumed.

---

## 11. What the critical path actually depends on

Ranked by what breaks the product if it goes away:

1. **Flight status push feed** — without it there is no trigger and no product.
2. **Booking API with cancel** — without a real cancel, the rollback story is narrated, not demonstrated.
3. **Single-use payment credential** — without it, "cannot overspend" is a promise rather than a control.
4. **Push notification transport** — without it we act invisibly, which members experience as spooky rather than helpful.
5. Weather, congestion, history — these improve *lead time*, not correctness. Losing them degrades us to the 53-second cold path. Everyone still gets recovered.

That ranking is deliberate: **the model is fourth-order.** It buys speed. The safety and
correctness of the system rest on the policy gate, the consent window and the saga — none of
which consult a probability.
