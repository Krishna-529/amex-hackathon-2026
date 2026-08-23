# 09 · How big is the problem, really — global data and recent incidents

**Why this document exists.** Every other design doc in this repo argues *how* ZKD Concierge
recovers a disrupted member. This one argues *that the problem is worth solving at all* — with
numbers, not the demo's ~11s recovery time as the only evidence. It answers three questions a
judge or sponsor will actually ask: how often does this happen, how bad is it when it does, and
did it just happen to someone big enough that Amex would know the name.

**Evidence tier.** Every figure here is `external` — pulled from IATA, US DOT, DGCA, and press
reporting on named incidents, not from anything in this codebase. Treat it the same way the rest
of this documentation set treats a `commercial` API: real, but not something this repo can
independently verify. Where two sources disagree, the discrepancy is noted rather than picked.

---

## 1. The base rate — this is not a rare event

| Metric | Figure | Source |
|---|---|---|
| Global air passengers, 2024 | **9.5 billion** trips (104% of 2019) | ACI World / ICAO joint report |
| US flight cancellation rate, 2024 | **1.4%** of all flights (up from 1.3% in 2023) | US DOT Air Travel Consumer Report |
| US on-time arrival rate, 2024 | **78.1%** | US DOT |
| Asia-Pacific cancellation rate, 2024 | **2.53%** — over **315,000 flights** cancelled, the largest absolute count of any region | Regional 2024 disruption analysis |
| Latin America cancellation rate, 2024 | **1.46%** — ~42,500 flights | Same |
| Disrupted-passenger delay vs. baseline | Passengers hit by a cancellation or missed connection average **457 minutes** of delay, vs. **16 minutes** for an undisrupted traveller | US GAO passenger-protection reporting |

**Read this row by row, not just the headline percentage.** 1.4% sounds small until it is put next
to 9.5 billion trips a year — even the *lowest* national cancellation rate on record still means
tens of millions of disrupted itineraries annually, each one a member somewhere going from a
16-minute inconvenience to a 7-hour-plus ordeal with no warning. The 457-vs-16-minute gap is the
single number that most directly justifies this project's existence: the entire cost of a
disruption is absorbed in the tail, by the small share of passengers it actually lands on.

**India context**, since this project's design target is Indian domestic aviation:

| Metric | Figure | Source |
|---|---|---|
| Domestic on-time performance at major metros, 2025 peak months | Fell **below 86%** — over 1 in 7 flights delayed | DGCA monthly statistics |
| IndiGo cancellation rate, October 2025 (pre-crisis) | **0.51%** — the lowest among large Indian carriers at the time | DGCA / press reporting |
| IndiGo on-time performance collapse, Oct → Nov 2025 | **84.1% → 67.7%** in one month | DGCA |

The India numbers matter for a specific reason: **the base rate looked fine one month before the
worst domestic disruption event in recent memory.** A system that only reacts to an elevated
cancellation *rate* would have missed this entirely — the crisis in §2 below was a planning
failure, not a weather event, and it arrived with almost no warning to the travelling public.

---

## 2. Three recent incidents — different root causes, same member experience

Chosen to span the causal space this project has to be robust to: a **regulatory/planning**
failure (crew scheduling), a **weather-triggered cascading systems** failure, and a
**third-party IT** failure with zero connection to aviation. All three converge on the same thing
a member actually experiences: little or no notice, and a multi-day scramble to get home.

### 2.1 IndiGo scheduling crisis — India, December 2025

- **Cause**: IndiGo underestimated the crew headcount needed for Phase-2 DGCA Flight Duty Time
  Limitation (FDTL) rules and had a planning gap when the rule took effect.
- **Scale**: Nearly **4,500 flights cancelled** over 10 days (2–12 December 2025), affecting
  **over 1 million (10 lakh) passengers**.
- **Cost**: Over **₹24 crore (~$2.9M)** paid in passenger compensation; DGCA additionally levied a
  record **₹2.45M fine**, imposed an airfare cap during the crisis, and ordered a full refund
  clean-up.
- **Why it matters here**: This is the exact carrier and geography this project targets. It is
  also the cleanest illustration of the detection gap this repo is honest about not having solved
  (`documentation/design/06-experience-kpis.md` §A1) — the disruption was a rolling operational
  collapse, not a single filed cancellation event, and there was no external signal a member-side
  system could have keyed off days in advance.

### 2.2 Southwest Airlines holiday meltdown — United States, December 2022

- **Cause**: A winter storm paralysed Denver and Chicago hub operations; Southwest's manual
  crew-rescheduling process could not keep pace with the cascading disruption and lost track of
  where its own crews were.
- **Scale**: **~17,000 flights cancelled** over the holiday period, stranding **more than 2
  million travellers**.
- **Cost**: Approximately **$1.2 billion** in direct costs (Q4 2022–Q1 2023), a subsequent
  **$140 million federal fine** (the largest of its kind at the time), and **$600 million** paid
  out in refunds and reimbursements.
- **Why it matters here**: The single clearest real-world case for **pre-caching before
  cancellation is confirmed** (this project's `A4` KPI, `documentation/design/06-experience-kpis.md`
  §A) — Southwest's own system could not re-accommodate fast enough once the cascade started, and
  every hour of delay in rebooking compounded the next passenger's options disappearing.

### 2.3 CrowdStrike-triggered global outage — worldwide, July 2024

- **Cause**: A faulty CrowdStrike Falcon Sensor update crashed roughly **8.5 million** Windows
  systems worldwide — an IT failure with no connection to weather, crew planning, or aviation
  regulation at all.
- **Scale**: **4,000+ cancellations and 35,500+ delays worldwide** on day one alone (per
  FlightAware); Delta Air Lines was hit hardest with **over 7,000 flights cancelled**, affecting
  **1.3 million passengers**, with disruption still cascading five days later.
- **Cost**: Delta alone faced a US DOT investigation over the scale and duration of the fallout.
- **Why it matters here**: This is the strongest argument that the disruption trigger has to be
  **carrier-and-cause-agnostic**. A prediction model trained only on weather and airline rolling
  delays (as this project's model is — see `documentation/design/05-cancellation-risk-model.md`)
  would not have seen this coming either; the honest conclusion is that *detection* (§A1) matters
  more than *prediction* for exactly the failure modes with the largest blast radius.

---

## 3. What this means for the KPI set

This document doesn't add a KPI — it argues for the ones `documentation/design/06-experience-kpis.md`
and `06a-amex-kpi-mapping.md` already flag as the biggest gaps:

- **A1 Detection lead time** (`ABSENT`). All three incidents above show why this cannot wait for a
  clean single-flight cancellation signal — IndiGo's was a rolling multi-day collapse, Southwest's
  was a cascading systems failure, and CrowdStrike's had no aviation-specific signal at all.
- **E4 Post-recovery CSAT/NPS** (`ABSENT`). The 457-vs-16-minute delay gap in §1 is the reason this
  matters: the member experience during an incident like these three is categorically different
  from an on-time trip, and nothing in the product asks the member how it felt.
- **A4 Pre-emptive share** (`PARTIAL`). Southwest's meltdown is the sharpest illustration of why
  pre-caching before confirmation — not after — is the thing that actually helps once a
  disruption starts cascading.

## What this document deliberately does not do

- **No claim that ZKD Concierge would have prevented any of these three incidents.** Detection
  lead time is `ABSENT` in this system today; the honest claim is narrower — that these incidents
  demonstrate the problem is real, frequent, and not niche, not that the current build already
  solves it.
- **No revenue framing.** These figures justify the *experience* cost of disruption, consistent
  with the standing objective in `CLAUDE.md` and `06-experience-kpis.md` — they are not used here
  to argue a market-size or attachment-rate case.

---

## Sources

- [IATA — 2024 World Air Transport Statistics Report](https://www.iata.org/en/pressroom/2025-releases/2025-08-04-01/)
- [ACI World–ICAO Joint Passenger Traffic Report](https://aci.aero/2025/01/28/joint-aci-world-icao-passenger-traffic-report-trends-and-outlook/)
- [US DOT — Air Travel Consumer Report, December 2024 / Full Year 2024](https://www.transportation.gov/briefing-room/air-travel-consumer-report-december-2024-full-year-2024-numbers)
- [US GAO-23-105524 — Airline Passenger Protections: Observations on Flight Delays and Cancellations](https://www.gao.gov/products/gao-23-105524)
- [Wikipedia — 2025 IndiGo scheduling crisis](https://en.wikipedia.org/wiki/2025_IndiGo_scheduling_crisis)
- [Gulf News — IndiGo cancels 550 flights after pilot rest rules exceed crew forecasts](https://gulfnews.com/business/aviation/indigo-cancels-550-flights-after-pilot-rest-rules-exceed-crew-forecasts-at-mumbai-bengaluru-hubs-1.500369820)
- [MarketScreener — India fines IndiGo record $2.45 million over mass flight cancellations](https://www.marketscreener.com/news/india-fines-indigo-record-2-45-million-over-mass-flight-cancellations-ce7e58dfdd8bf325)
- [CNN — Southwest hit by record $140 million fine for holiday service meltdown](https://www.cnn.com/2023/12/18/business/southwest-fine-canceled-flights/index.html)
- [CBS News — Southwest holiday meltdown cost the company $800 million (federal investigation)](https://www.cbsnews.com/news/southwest-airlines-federal-investigation-holiday-debacle-stranded-millions/)
- [Wikipedia — 2024 Delta Air Lines disruption](https://en.wikipedia.org/wiki/2024_Delta_Air_Lines_disruption)
- [Euronews — CrowdStrike chaos: why did the global IT outage ground so many planes](https://www.euronews.com/travel/2024/07/23/crowdstrike-chaos-why-did-the-global-it-outage-ground-so-many-planes-last-week)
