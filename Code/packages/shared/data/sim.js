/** Monte Carlo results — produced by iropssim.py, seed 20260726, N = 250,000 / 39,301 events. */

export const RUN = { seed: 20260726, n: 250000, events: 39301, script: 'iropssim.py' };

export const OUTCOMES = [
  { key: 'A', proof: 'sim-outcome-a', label: 'Same-day, commitment kept', short: 'On time', tone: 'c1' },
  { key: 'B', proof: 'sim-outcome-b', label: 'Same-day, arrives late', short: 'Late', tone: 'c2' },
  { key: 'C', proof: 'sim-outcome-c', label: 'Next day + duty of care', short: 'Next day', tone: 'c3' },
  { key: 'D', proof: 'sim-outcome-d', label: 'Escalated to a human', short: 'Human', tone: 'c4' },
];

export const SCENARIOS = [
  {
    id: 'all',
    label: 'All cases',
    blurb: 'Blended across both regimes',
    A: 52.76, B: 12.75, C: 27.68, D: 6.81,
    sameDay: 65.51, closed: 93.19, medianDelay: 6.0, p90Delay: 10.5,
  },
  {
    id: 'isolated',
    label: 'Isolated',
    blurb: 'Ordinary day, one flight cancels',
    A: 67.49, B: 13.73, C: 14.82, D: 3.96,
    sameDay: 81.22, closed: 96.04, medianDelay: 6.0, p90Delay: null,
    proof: 'sim-regime-isolated',
  },
  {
    id: 'systemic',
    label: 'Systemic',
    blurb: 'Dec-2025-scale mass cancellation',
    A: 27.59, B: 10.96, C: 49.71, D: 11.75,
    sameDay: 38.55, closed: 88.25, medianDelay: 9.0, p90Delay: null,
    proof: 'sim-regime-systemic',
  },
];

export const BASELINE_SAME_DAY = 66.15;

export const SENSITIVITY = [
  { label: '25% share + no portfolio', sameDay: 4.57, delta: -61.58, proof: 'sens-worst' },
  { label: 'No portfolio — one flight for all', sameDay: 27.52, delta: -38.63, proof: 'sens-portfolio' },
  { label: 'Heavy self-contention (25% share)', sameDay: 29.23, delta: -36.92, proof: 'sens-worst' },
  { label: 'Single-carrier access only', sameDay: 40.61, delta: -25.54, proof: 'sens-access' },
  { label: 'No prediction lead at all', sameDay: 51.40, delta: -14.75, proof: 'sens-prediction' },
  { label: 'Perfect prediction lead', sameDay: 77.50, delta: 11.35, proof: 'sens-prediction' },
  { label: 'Low self-contention (2% share)', sameDay: 77.37, delta: 11.22, proof: null },
  { label: 'Full multi-supplier access', sameDay: 72.25, delta: 6.10, proof: 'sens-access' },
];

export const METRICS = [
  {
    name: 'Same-day recovery, commitment kept',
    primary: true,
    definition: 'Seat secured same day AND the traveller’s hard constraint held',
    target: '≥ 50%', modelled: '52.8%', proof: 'sim-outcome-a',
  },
  {
    name: 'Same-day recovery, any seat',
    definition: 'Confirmed same-day alternative, onward legs repaired if late',
    target: '≥ 60%', modelled: '65.5%', proof: 'sim-same-day',
  },
  {
    name: 'Closed without a human',
    definition: 'Resolved automatically, including next-day + duty of care',
    target: '≥ 60%', modelled: '93.2%', proof: 'sim-closed-no-human',
  },
  {
    name: 'Confirmed recovery latency',
    definition: 'Carrier event → confirmed alternative, on the prepared path',
    target: '~10 s', modelled: 'design budget', proof: 'latency-budget',
  },
  {
    name: 'Policy adherence',
    hard: true,
    definition: 'Actions carrying an OPA allow decision',
    target: '100%', modelled: 'hard gate', proof: 'opa-latency',
  },
  {
    name: 'Hallucinated bookings',
    hard: true,
    definition: 'Bookings without a valid supplier offer ID',
    target: '0', modelled: 'by construction', proof: null,
  },
  {
    name: 'Charges on a failed prediction',
    hard: true,
    definition: 'Fees incurred on a prediction that did not materialise',
    target: '0', modelled: 'by construction', proof: 'hold-ttl',
  },
  {
    name: 'Hold conversion rate',
    definition: 'Holds ticketed ÷ holds placed, per carrier',
    target: '≥ 85%', modelled: 'governance gate', proof: 'churn-governance',
  },
];

export const ASSUMPTIONS = [
  {
    name: 'Carrier auto-rebook consumption', value: '45–70% reactive\n25–50% predicted', influential: true,
    basis: 'The carrier’s own IROPS engine re-accommodates its passengers before third parties see inventory. We could not source a rate. This is our most influential unsourced input.',
    impact: 'not isolated', impactNote: 'confounded with access',
  },
  {
    name: 'Cross-carrier access', value: '60–80%',
    basis: 'Share of route alternatives we can actually transact on through a multi-supplier abstraction rather than one GDS.',
    impact: '−25.5 pts', impactNote: 'at 30% access', bad: true, proof: 'sens-access',
  },
  {
    name: 'Our share of displaced passengers', value: '2–6%',
    basis: 'A premium card cohort is a small slice of any given flight. Deliberately realistic — low share is what keeps self-contention manageable.',
    impact: '−36.9 pts', impactNote: 'at 25% share', bad: true, proof: 'sens-worst',
  },
  {
    name: 'Prediction lead available', value: '55% of events',
    basis: 'Weather and rotational disruptions are forecastable; technical, ATC and crew events largely are not.',
    impact: '−14.8 pts', impactNote: 'at zero lead', bad: true, proof: 'sens-prediction',
  },
  { name: 'Seats per aircraft', value: '180', basis: 'A320/737 family dominates Indian domestic narrowbody operations.', impact: 'low' },
  { name: 'Load factor', value: '87% normal\n92% systemic', basis: 'Indian domestic load factors run high; a systemic event pushes them higher as displaced passengers absorb remaining inventory.', impact: 'moderate', impactNote: 'sets the seat pool' },
  { name: 'Systemic-event share', value: '35% of cases', basis: 'Blend of ordinary single-flight cancellations and mass events. Reported separately by regime precisely because this split is arbitrary.', impact: 'reported split', impactNote: '81.2% vs 38.6%' },
  { name: 'Route thickness mix', value: '30 / 45 / 25%', basis: 'Trunk routes carry 8–14 alternatives in the recovery window, thin routes 1–3. Representative of the network, not drawn from route-level DGCA data.', impact: 'moderate' },
  { name: 'Alternative spacing', value: '1.5 / 3 / 7 h', basis: 'Hours between usable alternatives by route class. Drives the delay distribution directly.', impact: 'moderate', impactNote: 'median 6.0 h out' },
  { name: 'Other-agent demand', value: '10–30%', basis: 'Inventory consumed by other agencies and direct bookers before we transact.', impact: 'low–moderate' },
  { name: 'Hard-constraint incidence', value: '30% of travellers', basis: 'Proportion with a binding onward connection or time commitment. Splits outcome A from B.', impact: 'shifts A↔B', impactNote: 'not the total' },
  { name: 'Slack before commitment breaks', value: '2–8 h hard\n6–24 h soft', basis: 'How late a traveller can arrive before the trip’s purpose fails. Derived from their stated travel window.', impact: 'shifts A↔B' },
  { name: 'Intrinsically complex cases', value: '4%', basis: 'Multi-city, visa, unaccompanied minors, medical, special assistance — always a human, regardless of inventory.', impact: 'floors D', impactNote: 'at 4%' },
  { name: 'Same-day cutoff', value: '12 h', basis: 'Beyond this a recovery is not meaningfully same-day; it becomes an overnight case with hotel and duty of care.', impact: 'definitional', impactNote: 'moves A+B ↔ C' },
];

export const NOT_MODELLED = [
  'Fare and policy availability — a seat that exists is treated as bookable, when in reality it may be out of fare policy or priced beyond what OPA allows.',
  'API failure — rate-limit rejections, timeouts and circuit-breaker openings are not simulated.',
  'Cross-route correlation — a Delhi weather closure disrupts every route into Delhi at once; we capture this with a scarcity multiplier rather than a network model.',
];
