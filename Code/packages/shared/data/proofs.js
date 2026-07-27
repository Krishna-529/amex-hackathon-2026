/**
 * Proof registry — the single source of truth for every number across all three sites.
 *
 * tier:
 *   verified  external source we actually retrieved, link given
 *   calc      arithmetic over cited inputs, expression shown
 *   sim       output of iropssim.py at a fixed seed, reproducible
 *   assumed   our input, not a measurement
 *   budget    engineering design target, not an observation
 *   deck      stated in our own Round 1 deck, not independently re-verified
 */

export const TIERS = {
  verified: { label: 'VERIFIED', hue: 'v', blurb: 'External source, retrieved and linked' },
  calc: { label: 'CALC', hue: 'c', blurb: 'Arithmetic over cited inputs' },
  sim: { label: 'SIM', hue: 'c', blurb: 'Simulation output, fixed seed, reproducible' },
  assumed: { label: 'ASSUMED', hue: 'a', blurb: 'Our input. Not a measurement.' },
  budget: { label: 'BUDGET', hue: 'a', blurb: 'Engineering design target' },
  deck: { label: 'DECK', hue: 'a', blurb: 'From our Round 1 deck, not re-verified' },
};

const SIM_RUN = 'iropssim.py · seed 20260726 · N = 250,000 across 39,301 events';

export const PROOFS = {
  /* ---------------- verified externals ---------------- */
  'otp-may-2026': {
    tier: 'verified',
    value: '17.2%',
    claim: 'Share of flights arriving late (IndiGo, 10 major airports, May 2026)',
    formula: `100% − OTP
= 100% − 82.8%
= 17.2%`,
    note:
      'The 82.8% is IndiGo’s May 2026 on-time performance across ten major airports. IndiGo was the BEST performer that month — Akasa Air 78.3%, Air India Group 74.5% — so applying its rate market-wide understates disruption. We keep it because it is conservative, and we say so rather than implying it is a market average.',
    inputs: ['IndiGo OTP 82.8% (verified)', 'Akasa 78.3%', 'Air India Group 74.5%'],
    sources: [
      {
        label: 'Business Standard — DGCA May 2026 data',
        url: 'https://www.business-standard.com/markets/news/dgca-may-data-soaring-oil-prices-drag-interglobe-aviation-shares-3-126070800376_1.html',
      },
    ],
  },

  'indigo-dec-2025': {
    tier: 'verified',
    value: '3 lakh / 72 h',
    claim: 'Our burst design target — the December 2025 IndiGo scheduling crisis',
    formula: `3,00,000 passengers ÷ 72 h
= 4,167 per hour
= 1.16 disruptions per second`,
    note:
      'IndiGo cancelled 2,507 flights and delayed 1,852 between 3–5 December 2025, stranding over three lakh passengers. DGCA imposed a ₹22.20 crore penalty and required a ₹50 crore bank guarantee. We size the system for that day, not for an average Tuesday.',
    inputs: ['2,507 cancellations', '1,852 delays', '3–5 Dec 2025', '₹22.20 cr penalty'],
    sources: [
      {
        label: 'All India Radio (Government of India)',
        url: 'https://www.newsonair.gov.in/dgca-imposes-over-rs-22-crore-fine-on-indigo-airlines-following-large-scale-delays-cancellations-of-flights-last-month/',
      },
      {
        label: 'The Tribune',
        url: 'https://www.tribuneindia.com/news/business/dgca-imposes-rs-22-20-crore-penalty-on-indigo-over-december-2025-flight-disruption/',
      },
      {
        label: 'Outlook Business',
        url: 'https://www.outlookbusiness.com/corporate/dgca-penalty-indigo-december-flight-disruptions',
      },
      {
        label: '2025 IndiGo scheduling crisis — overview',
        url: 'https://en.wikipedia.org/wiki/2025_IndiGo_scheduling_crisis',
      },
    ],
  },

  'dgca-april-2026': {
    tier: 'verified',
    value: '₹4.45 cr',
    claim: 'Carrier spend on passenger facilitation and compensation, April 2026',
    formula: `facilitation   ₹2.41 cr
compensation   ₹2.04 cr
             ─────────
combined       ₹4.45 cr`,
    note:
      'Our Round 1 deck quoted ₹4.24 cr for May 2026 labelled “facilitation”. April 2026 — the nearest month we could independently retrieve — reports these as TWO separate line items. Our single figure is probably the combined measure, mislabelled. We flag the ambiguity rather than resolve it silently. April also: 1.38 cr flyers, 1.35 lakh delay-affected, 77,065 cancellation-affected.',
    inputs: ['₹2.41 cr facilitation', '₹2.04 cr compensation', '1.35 L delay-affected', '77,065 cancellation-affected'],
    sources: [
      {
        label: 'April 2026 DGCA data as reported',
        url: 'https://www.oneindia.com/india/dgca-data-shows-domestic-air-traffic-down-4-2-in-april-indigo-strengthens-market-dominance-8104885.html',
      },
      {
        label: 'DGCA monthly statistics portal (primary)',
        url: 'https://www.dgca.gov.in/digigov-portal/?page=monthlyStatistics%2F259%2F4751%2Fhtml&main259%2F4184%2Fservicename=',
      },
    ],
  },

  'domestic-traffic': {
    tier: 'verified',
    value: '16.4 cr',
    claim: 'Indian domestic air passengers, FY2024-25',
    formula: `CY2024       16.13 cr   (+6.12% YoY)
FY2024-25   ≈16.54 cr   (+7.6% YoY)
our figure   16.4 cr    — within range`,
    note:
      'Independent sources give 16.13 crore for calendar year 2024 and roughly 16.54 crore for FY2024-25. Our 16.4 cr sits between the two, so it is consistent — but the exact value depends on whether the period is the calendar or the fiscal year. We state the range rather than a false precision.',
    inputs: ['161.3 mn CY2024', '≈165.4 mn FY2024-25'],
    sources: [
      {
        label: 'Business Standard — CY2024, 161.3 mn',
        url: 'https://www.business-standard.com/industry/news/domestic-air-passenger-traffic-in-india-jumps-by-6-12-to-161-3-mn-in-2024-125012201413_1.html',
      },
      { label: 'IBEF', url: 'https://www.ibef.org/news/domestic-air-passenger-traffic-in-india-jumps-by-6-12-to-161-3-million-in-2024' },
    ],
  },

  /* ---------------- simulation outputs ---------------- */
  'sim-outcome-a': {
    tier: 'sim',
    value: '52.76%',
    claim: 'Outcome A — same-day seat secured AND the traveller’s hard constraint held',
    formula: `A ÷ N × 100
= 131,900 ÷ 250,000 × 100
= 52.76%`,
    note: 'The primary metric. A seat that arrives too late to matter is counted as B, not A.',
    inputs: [SIM_RUN],
    reproduce: 'python iropssim.py',
  },
  'sim-outcome-b': {
    tier: 'sim',
    value: '12.75%',
    claim: 'Outcome B — same-day seat secured, but arrives past the traveller’s slack',
    formula: `B ÷ N × 100
= 31,875 ÷ 250,000 × 100
= 12.75%`,
    note: 'Recovered, but the onward leg or commitment needed repairing too.',
    inputs: [SIM_RUN],
    reproduce: 'python iropssim.py',
  },
  'sim-outcome-c': {
    tier: 'sim',
    value: '27.68%',
    claim: 'Outcome C — no reachable same-day seat; next-day flight + hotel + duty of care',
    formula: `C ÷ N × 100
= 69,200 ÷ 250,000 × 100
= 27.68%`,
    note:
      'This path is why Pipeline 05 is not optional. In a systemic event it absorbs 49.71% of all members — half the book.',
    inputs: [SIM_RUN],
    reproduce: 'python iropssim.py',
  },
  'sim-outcome-d': {
    tier: 'sim',
    value: '6.81%',
    claim: 'Outcome D — escalated to a human',
    formula: `D ÷ N × 100
= 17,025 ÷ 250,000 × 100
= 6.81%`,
    note:
      'Floored at 4% by intrinsically complex cases — multi-city, visa, unaccompanied minors, medical, special assistance — which always go to a human regardless of inventory. The remaining ~2.8% is capacity-driven.',
    inputs: [SIM_RUN, 'p_intrinsically_complex = 0.04'],
    reproduce: 'python iropssim.py',
  },
  'sim-same-day': {
    tier: 'calc',
    value: '65.51%',
    claim: 'Same-day recovery — any confirmed same-day seat',
    formula: `A + B
= 52.76% + 12.75%
= 65.51%`,
    note: 'Our headline metric, because unlike closed-without-human it actually discriminates: it spans 4.6% to 81.2% across the sensitivity sweep.',
    inputs: ['sim-outcome-a', 'sim-outcome-b'],
  },
  'sim-closed-no-human': {
    tier: 'calc',
    value: '93.19%',
    claim: 'Closed without a human — resolved automatically, including the next-day path',
    formula: `100 − D
= 100 − 6.81
= 93.19%`,
    note:
      'Clears the ≥60% target from our Round 1 deck comfortably — but it moves only between 92.8% and 93.5% across EVERY sensitivity configuration, including deliberately broken ones. A metric that passes even when the system is misbuilt cannot tell us whether we are improving. We report it as a secondary floor.',
    inputs: ['sim-outcome-d'],
  },
  'sim-regime-isolated': {
    tier: 'sim',
    value: '81.22%',
    claim: 'Same-day recovery in an isolated disruption (ordinary day, one flight cancels)',
    formula: `A + B  (isolated regime)
= 67.49% + 13.73%
= 81.22%`,
    inputs: [`${SIM_RUN} · p_systemic forced to 0.0`],
    reproduce: 'python iropssim.py',
  },
  'sim-regime-systemic': {
    tier: 'sim',
    value: '38.55%',
    claim: 'Same-day recovery in a systemic event (Dec-2025-scale mass cancellation)',
    formula: `A + B  (systemic regime)
= 27.59% + 10.96%
= 38.55%`,
    note:
      'The case we built the system for, and the one a blended average hides. Alternatives are themselves saturated, so the duty-of-care path carries half the members.',
    inputs: [`${SIM_RUN} · p_systemic forced to 1.0`],
    reproduce: 'python iropssim.py',
  },
  'sim-stability': {
    tier: 'sim',
    value: '±0.4 pts',
    claim: 'Seed-to-seed stability of the headline figure',
    formula: `12 independent seeds × 40,000 cases
mean   93.29%
sd      0.177
range  92.96 – 93.68`,
    note:
      'The simulation is stable. This says nothing about whether the assumptions are right — the sensitivity table is the honest uncertainty statement, not this.',
    inputs: [SIM_RUN],
    reproduce: 'python iropssim.py',
  },

  /* ---------------- sensitivity levers ---------------- */
  'sens-portfolio': {
    tier: 'sim',
    value: '38.63 pts',
    claim: 'Value of portfolio allocation — the single largest lever measured',
    formula: `baseline same-day       66.15%
no-portfolio same-day   27.52%
                      ─────────
difference              38.63 pts`,
    note:
      'Both runs at seed 20260726+13, N = 120,000, identical in every parameter except portfolio=False, which restricts allocation to the single best alternative. This is worth 3.4× prediction lead.',
    inputs: ['portfolio=True vs False'],
    reproduce: 'python iropssim.py',
  },
  'sens-access': {
    tier: 'sim',
    value: '25.54 pts',
    claim: 'Value of multi-supplier access versus a single carrier',
    formula: `baseline (60–80% access)  66.15%
single-carrier (30%)      40.61%
                        ─────────
difference                25.54 pts`,
    note: 'Only cross_carrier_access changes, held at 0.30 instead of drawn from 0.60–0.80.',
    inputs: ['cross_carrier_access'],
    reproduce: 'python iropssim.py',
  },
  'sens-prediction': {
    tier: 'sim',
    value: '11.35 pts',
    claim: 'Value of prediction lead time',
    formula: `perfect lead   77.50%
baseline       66.15%
             ─────────
gain           11.35 pts

zero lead      51.40%  →  −14.75 pts
full span                  26.10 pts`,
    note:
      'Real, but well behind allocation. This is the second reason we build Pipeline 01 before the Predictive Watcher despite P2 ranking first on RICE — the first being that P2 without P1 is simply Lumo.',
    inputs: ['p_prediction_lead 0.0 / 0.55 / 1.0'],
    reproduce: 'python iropssim.py',
  },
  'sens-worst': {
    tier: 'sim',
    value: '4.57%',
    claim: 'Worst configuration measured — high share, no portfolio',
    formula: `our_share  = 0.25
portfolio  = False
same-day   = 4.57%

vs baseline  66.15%
degradation  61.58 pts`,
    note:
      'A hundred members all pointed at the same alternative. Ninety-five queue for a seat already gone. This is what the naive design produces, and it is entirely self-inflicted. Portfolio ON at the same share recovers to 29.23% — diversification alone is worth 24.7 points before share is even controlled.',
    inputs: ['our_share=0.25', 'portfolio=False'],
    reproduce: 'python iropssim.py',
  },

  /* ---------------- derived engineering ---------------- */
  'temporal-write-load': {
    tier: 'calc',
    value: '~58 writes/s',
    claim: 'Temporal persistence write load at our burst design target',
    formula: `disruptions   3,00,000 over 72 h
saga size     ~6 activities ≈ 50 history events

300,000 × 50 ÷ 259,200 s
= 57.87 writes / second  (average)
≈ 1,157 writes / second  (20× burst)`,
    note:
      'A single well-provisioned PostgreSQL handles this without strain. The database is nowhere near the bottleneck — supplier rate limits are. This is why we do not shard: the arithmetic is a stronger answer than a sharding scheme.',
    inputs: ['indigo-dec-2025', '~50 history events per saga'],
  },
  'api-call-collapse': {
    tier: 'calc',
    value: '300 → 201',
    claim: 'API calls for 100 affected members on one cancelled route',
    formula: `naive                 100 search + 100 hold + 100 ticket = 300
coordinator             1 search + 100 hold + 100 ticket = 201   ← defensible
with a group allotment  1 search +   1 block + 100 ticket = 102   ← requires an agreement

reduction = 33% today, 66% with a carrier agreement`,
    note:
      'CORRECTED. We previously stated 102 without qualification. A hold is a named booking — it cannot be placed anonymously through any self-service API — so 100 members means 100 holds unless we have a negotiated group allotment, which we do not. The search collapse from 100 to 1 is real either way; the hold collapse is not. Ticketing never collapses: every passenger needs their own ticket issued, and that is not an optimisation problem.',
    inputs: ['100 affected members', 'one disrupted route', 'no group allotment in place'],
  },

  'one-booking-invariant': {
    tier: 'verified',
    value: '≤ 1',
    claim: 'A passenger may hold at most one live booking for a given travel date',
    formula: `∀ passenger p, ∀ date d:
    | { live bookings for p on d } | ≤ 1

where "live" = held (unticketed) OR ticketed`,
    note:
      'This is a distribution constraint, not a preference. A hold is a named booking — a PNR or an NDC order carrying the passenger. Two live bookings for the same passenger on the same day is a duplicate booking, which carriers detect with automated sweeps and cancel, and which sits alongside churning and fictitious names as a named ADM violation. Placeholder names are not a workaround; fictitious bookings are themselves a violation. The consequence is structural: we cannot hold an alternative while the original is still live, so speculative pre-holding is impossible rather than merely unwise. Re-accommodation after a carrier cancellation is NOT a duplicate — the original segment has no operating flight.',
    inputs: ['GDS PNR model — hold is a ticketing time limit on a named record',
             'NDC order model — hold order requires passenger details',
             'Anonymous held inventory exists only as negotiated group allotment'],
    sources: [
      { label: 'DGCA — carrier and agency conduct (primary text not re-retrieved)',
        url: 'https://www.dgca.gov.in/digigov-portal/?page=4264%2F4206%2Fsericename' },
    ],
  },
  'burst-rate': {
    tier: 'calc',
    value: '1.16 / s',
    claim: 'Average disruption arrival rate at the burst design target',
    formula: `3,00,000 ÷ (72 × 3600) s
= 3,00,000 ÷ 259,200
= 1.157 per second`,
    note: 'Not one million concurrent anything. Sizing the system against the real event shape is what keeps the infrastructure honest.',
    inputs: ['indigo-dec-2025'],
  },
  'pool-a': {
    tier: 'calc',
    value: '$42,116',
    claim: 'Contact-deflection value per 100,000 protected trips per year',
    formula: `100,000 trips
× 17.2%  arrive late          =  17,200
× 35%    contact call centre  =   6,020
× 60%    deflected            =   3,612
× $11.66 saved each
= $42,116`,
    note:
      'Arithmetic verified end to end. The 35% contact rate and 60% deflection are assumptions and our Round 1 deck marks them amber. The $11.66 is a Gartner global benchmark, flagged as an upper bound pending Amex India telemetry.',
    inputs: ['otp-may-2026', '35% contact rate (assumed)', '60% deflection (target)', '$11.66 (Gartner)'],
  },
  'pool-b-gap': {
    tier: 'calc',
    value: '~45%',
    claim: 'Unstated capture rate implied by our Round 1 deck’s Pool B figure',
    formula: `basket = ₹6,000 + ₹4,500 + ₹800 = ₹11,300
17,200 disrupted × ₹11,300 = ₹19.4 cr

deck states                   ₹8.7 cr
implied capture = 8.7 ÷ 19.4 = 44.8%`,
    note:
      'In a deck whose credibility play is “the arithmetic, in full”, Pool B is the one number that does not show its derivation. We surface the implied rate rather than leave it buried. Separately: 17.2% is a per-flight rate applied to per-trip counts — a two-leg trip is nearer 31%, so Pool A may be understated.',
    inputs: ['₹11,300 basket', '17,200 disrupted trips', '₹8.7 cr stated'],
  },

  /* ---------------- design budgets ---------------- */
  'latency-budget': {
    tier: 'budget',
    value: '~10 s',
    claim: 'Confirmed recovery latency on the prepared path',
    formula: `full cold path (Round 1 deck)     P95 53 s
  signal ingest         3 s
  context assembly      5 s
  supplier fan-out     34 s   ← done in advance
  policy eval (OPA)   ~0 s
  rank and explain      9 s   ← done in advance
  serialise and render  2 s

prepared in advance:  3 + 5 + 34 = 42 s
remaining at carrier event: 53 − 42 ≈ 11 s`,
    note:
      'An engineering budget, not a measurement — exactly as our Round 1 deck stated for its own latency figures. Prediction earns its keep here: it moves work off the critical path rather than taking booking risk early.',
    inputs: ['Round 1 deck slide 7 latency budget'],
  },
  'opa-latency': {
    tier: 'budget',
    value: '~1 ms',
    claim: 'Policy evaluation cost with OPA as a sidecar rather than a remote decision point',
    formula: `remote PDP (as originally budgeted)   200 ms   = 0.4% of budget
sidecar / in-process library          ~1 ms   = 0.002%

improvement ≈ 100×`,
    note:
      'Our Round 1 deck budgeted 0.2 s, which implies a network round trip and puts a remote dependency on the critical path of the one component meant to be unbypassable. As a sidecar it also has no network failure mode.',
    inputs: ['OPA policy of this size'],
  },
  'dgca-care-thresholds': {
    tier: 'deck',
    value: '2 h / 6 h',
    claim: 'DGCA duty-of-care thresholds compiled into Rego',
    formula: `delay ≥ 2 h                    → meals
delay ≥ 6 h AND overnight     → hotel + transfer
delay ≥ 6 h                   → alternate flight or refund
cancellation slab             → ₹5,000 / ₹7,500 / ₹10,000
                                by block time, or the booked
                                fare, whichever is less
force majeure removes CASH, never the duty of care`,
    note:
      'DGCA CAR Section 3, Series M, Part IV, as cited in our Round 1 deck. We have NOT re-retrieved the primary CAR text for this build — these rules must be reconciled against the current text before production.',
    inputs: ['Round 1 deck slide 6'],
    sources: [
      { label: 'DGCA — Directorate General of Civil Aviation', url: 'https://www.dgca.gov.in/digigov-portal/?page=4264%2F4206%2Fsericename' },
    ],
  },
  'hold-ttl': {
    tier: 'assumed',
    value: 'per-offer',
    claim: 'hold_TTL — how long a supplier keeps an unticketed seat before auto-release',
    formula: `hold only if
    hold_TTL > expected_time_to_announcement
AND P(cancel) × value_of_seat
      > cost_of_hold + inventory_externality`,
    note:
      'Three clocks are routinely conflated: hold_TTL (how long the SEAT is held), offer_expiry (how long the PRICE is guaranteed), and time_to_announcement (how long until the carrier decides). Re-holding is NOT renewal — an expired hold returns the seat to a market that clears in seconds, so you lose your seat and race for a worse one. This is an architectural gate, NOT a simulated parameter: it does not appear in PARAMS and the Monte Carlo never varied it.',
    inputs: ['Carrier- and fare-dependent. Real values require live Duffel/Sabre access.'],
  },
  'churn-governance': {
    tier: 'assumed',
    value: '≥ 85%',
    claim: 'Hold conversion rate — the metric that keeps supplier access alive',
    formula: `conversion = holds ticketed ÷ holds placed   (per carrier)

below threshold → speculative holding for that
                  carrier auto-disables`,
    note:
      'Repeatedly holding and releasing without ticketing is churning, policed via agency debit memos, contracted look-to-book ratios and passive-segment fees. Our prediction precision IS our hold conversion rate — at 30% precision we would be churning at scale and would lose distribution access, which ends the product rather than degrading it. The 85% threshold is ours; the contracted limits are per-carrier and not yet known to us.',
    inputs: ['Not sourced — requires GDS contract terms'],
  },
};

export const proofIds = Object.keys(PROOFS);
export const getProof = (id) => PROOFS[id] || null;
