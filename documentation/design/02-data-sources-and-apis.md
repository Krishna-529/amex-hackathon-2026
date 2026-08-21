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
| **OAG Flight Instances v2** | Schedules **and** live status — its status text includes `Cancelled`, plus a `scheduleChanged` flag | Poll | Trial key: **100 calls per 14 days, total** | `wired` (search only) |
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

### Detection versus prediction — and does OAG answer it?

Raised in mentor meeting 2. These are two different capabilities and the project currently has
only one of them.

**Prediction** is §2 and `05-cancellation-risk-model.md`: a probability that a flight *will* be
cancelled, produced hours ahead. We have this, self-trained, running.

**Detection** is knowing that a flight *has been* cancelled. As of 2026-08-19 we have this, on
three lanes, webhook-first: `server/webhooks/` (push — Duffel and AeroDataBox adapters live, OAG
deliberately stubbed inert pending a subscription), `server/engine/statusPoller.ts` (poll —
AviationStack, a budget-capped fallback that stands down whenever a live webhook already covers a
flight), and `server/engine/memberReports.ts` (the member — acts for the reporter immediately,
corroborates for everyone else at three independent reports). `detectDisruption` in
`zkd-app/server/engine/simulation.ts` is reachable from all three lanes now, not only from a human
pressing the button in the `/ops` console — that manual trigger still exists, for rehearsal and
for a flight none of the three lanes cover. A dead feed looks exactly like a quiet week, so `/ops`
surfaces per-lane liveness as a heartbeat rather than letting silence pass as good news.

**Does OAG provide the data? Yes.** OAG's Flight Instances v2 response carries a live status field
whose values include `"Cancelled"`, alongside a `scheduleChanged` flag — both already modelled in
`zkd-app/server/oag.ts`, and the endpoint is verified working against our trial key. The status is
present on status-bearing queries and null on a pure schedules query, which is an honest
distinction the client already preserves.

**So capability is not the constraint. Budget is.** `OAG_FLIGHT_INFO_TRIAL` is capped at **100
calls in total across a 14-day window** — not per day, not per month. Detection means watching a
book of flights continuously; 100 calls does not cover one day of that for a single route, let
alone a portfolio. The trial key is correctly spent where it is spent today: OAG is imported in
exactly two places in the app, and neither is a status watcher.

**The decision this leaves open** — a supplier decision before it is an engineering one:

| Option | What it buys | What it costs |
|---|---|---|
| Paid OAG tier | Status we have already integrated and proven against | Commercial quote; unknown |
| AviationStack, already `wired` | ~1-minute poll, free tier exists, independent of the forecaster | 60s of the recovery budget lost to poll latency |
| Cirium / FlightAware push | Seconds, webhook, the industry reference | Enterprise pricing, quote-only |
| Airline NDC direct | Authoritative the moment the cancellation is filed | Commercial agreement per carrier |

The design position above still holds: **push primary, poll as reconciliation.** Whichever
provider is chosen, the poll sweep stays, because a change-feed cannot recover a dropped message
and a missed cancellation fails silently.

Until one of these is bought, the detection lead-time KPI (`A1` in
[`06-experience-kpis.md`](06-experience-kpis.md)) is undefined and every other speed metric is
measured from an arbitrary clock.

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
| **MyCa** (Amex card member app) | Identity, passport, travel preferences, cabin entitlement, card product terms, payment instrument reference | `sandbox` (mocked) |
| **FX reference rates** (`server/fx.ts`) | Daily published rates, so a fare quoted in a supplier's currency can be shown against the card's billing currency. Keyless, cached for the day, with a committed fallback table — a rates outage must never blank the option list | live, no key required |

**The concierge is not the system of record.** Preferences are read from MyCa at recovery time and
no copy is kept — a local copy would drift from the card, and we would rank replacement flights
against entitlements the member no longer holds. Candidates are ranked against MyCa entitlement
rather than hardcoded rules, and anything outside it is surfaced and marked rather than dropped.

**Open, needs Amex input:** when the card member books for someone else, spend authority sits with
the card member while the passport and preferences belong to the traveller. `server/myca.ts` keeps
`cardMember` and `traveller` as separate fields so the answer can be dropped in; the consent rules
for that case are not guessed at.

### Family members' preferences — resolved, and the gap it exposes

Mentor meeting 2 answered half of the question above: **Amex holds travel preference data for
family members**, not only for the card member. We may design against that data existing rather
than working around its absence.

Consent is still open — whose preference wins, and who may authorise spend on whose behalf, is
unchanged from the note above and still needs Amex input.

What the resolution exposes is that **our model has nowhere to put it**. Today:

- `Traveller` (`zkd-app/server/domain/types.ts`) carries identity, date of birth, passport,
  contact, traveller type and per-person loyalty — but no seat, meal, cabin or optimisation
  preference. Loyalty is already per-person; preferences are not.
- The only party-level merge in the system, `unionHotelRulesAcrossParty`
  (`zkd-app/server/preferences/adapt.ts`), unions exactly **one** field across the party:
  accessibility. Its reasoning is sound and worth keeping — accessibility is a fact about a human
  being rather than a taste, so the strictest requirement across the party wins.
- Everything else applies the **card member's** preference to everyone on the ticket. A child who
  needs a specific meal, or a companion who cannot take a red-eye, is invisible to ranking.

Two things follow, and they are ordered:

1. **A merge rule per preference, decided deliberately.** Accessibility unions because it is a
   need. A cabin preference cannot union the same way — the strictest reading would silently
   upgrade the whole party against the card's entitlement. Each preference needs its own rule
   (union / strictest / card-member-wins) written down before any of them is implemented.
2. **A place to hold it** — a preference field on `Traveller`, fed from MyCa.

Doing (2) before (1) would produce a party merge that looks principled and is not. Tracked as an
open action in [`../project/mentor-meetings.md`](../project/mentor-meetings.md).

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
