/**
 * Four scenarios. Every one books the COMPLETE trip — flight, hotel and cab. Nothing missed.
 * They differ on the consent mode and on what the recovery costs the Card Member.
 *
 * The travel window (earliest start / latest end) is a hard constraint the allocator optimises
 * inside. It is also what decides whether a next-day recovery is an acceptable outcome or a
 * failure — same system, same inventory, opposite verdicts.
 */

export const CONSENT_MODES = {
  humanLoop: { key: 'humanLoop', tier: 'B', label: 'Human in the loop', tone: 'c2',
    blurb: 'The agent plans, holds and presents. Nothing is confirmed and nothing is paid until the Card Member approves.' },
  wallet: { key: 'wallet', tier: 'A', label: 'Consent given · wallet', tone: 'c3',
    blurb: 'Full autopilot. The agent acts and narrates, and settles the cost from the linked wallet through a single-use virtual account number.' },
  zeroCharge: { key: 'zeroCharge', tier: 'A', label: 'Consent given · no charges', tone: 'c1',
    blurb: 'Full autopilot, and the recovery costs the member nothing because the carrier owes all of it.' },
  cannotBook: { key: 'cannotBook', tier: 'A', label: 'Consent given · could not book', tone: 'c4',
    blurb: 'Consent in hand and the inventory is gone anyway. The honest failure case.' },
};

export const PERSONAS = [
  /* ------------------------------------------------------------------ 1 */
  {
    id: 'priya',
    name: 'Priya Menon',
    mode: 'zeroCharge',
    headline: 'The carrier cancelled, so the carrier pays',
    route: ['MAA', 'DEL', 'LHR'],
    routeLabel: 'Chennai → Delhi → London',
    purpose: 'Board meeting in London the next morning',
    window: { earliest: '26 Jul, 07:00', latest: '27 Jul, 09:00', slackHours: 3, tight: true },
    windowNote: 'A narrow window. She cannot absorb a day — which is what makes a next-day recovery a failure for her and an acceptable outcome for Rohit.',
    booked: { flight: true, hotel: true, cab: true },
    disruption: { flight: 'AI2803', at: '06:12', kind: 'Cancelled by carrier', delayHours: 7, overnight: true },
    timeline: [
      { t: '−02:40', phase: 'WATCH', text: 'Inbound aircraft running late. Delay-to-departure ratio crosses threshold. Her ticket is untouched, her phone is silent.', cost: 'free' },
      { t: '−02:38', phase: 'WARM', text: 'Context assembled: PNR, trip DAG, entitlement, hard constraint. Coordinator runs ONE reshop for every affected member on MAA→DEL.', cost: 'free' },
      { t: '−02:36', phase: 'ASK', text: '“If this is cancelled, shall we get you to Delhi in time for your London leg?” — the outcome, never a flight number.', cost: 'free' },
      { t: '−02:35', phase: 'WAIT', text: 'Consent captured. hold_TTL does not span the gap to announcement, so no speculative hold is placed. Candidates stay warm.', cost: 'free' },
      { t: '06:12', phase: 'ACT', text: 'Carrier cancels. Min-cost assignment across the portfolio. OPA confirms the disposition is INVOLUNTARY.', cost: 'free' },
      { t: '06:12:10', phase: 'ACT', text: 'Alternative confirmed, hotel re-accommodated, transfer reset. Original disposed as an involuntary reroute — last, after the replacement was confirmed.', cost: 'free' },
      { t: '06:12:11', phase: 'VERIFY', text: 'DEL→LHR segment checked and intact. A no-show on the first leg could have silently cancelled it.', cost: 'free' },
      { t: '06:13', phase: 'CLAIM', text: 'Delay exceeds 6 h and crosses an overnight window — meals, hotel and transfer are all owed by the carrier. Claimed, not charged.', cost: 'airline' },
    ],
    costs: [
      { item: 'Fare difference', amount: 0, payer: 'airline', why: 'Involuntary reroute — she did not choose to leave' },
      { item: 'Hotel night', amount: 0, payer: 'airline', why: 'Delay ≥ 6 h with an overnight window' },
      { item: 'Airport transfer', amount: 0, payer: 'airline', why: 'Owed alongside the hotel' },
      { item: 'Meals', amount: 0, payer: 'airline', why: 'Delay ≥ 2 h' },
    ],
    outcome: { verdict: 'A', label: 'Same-day, commitment kept', good: true,
      text: 'On the next flight that makes London, hotel moved, car reset, and every rupee of it on the carrier’s account. She made the board meeting.' },
    proofs: ['dgca-care-thresholds', 'latency-budget', 'sim-outcome-a'],
  },

  /* ------------------------------------------------------------------ 2 */
  {
    id: 'arjun',
    name: 'Arjun Nair',
    mode: 'humanLoop',
    headline: 'Under the threshold, so the cost is his — and he decides',
    route: ['BOM', 'DEL', 'SIN'],
    routeLabel: 'Mumbai → Delhi → Singapore',
    purpose: 'Client pitch in Singapore',
    window: { earliest: '12 Aug, 06:00', latest: '16 Aug, 22:00', slackHours: 9, tight: false },
    windowNote: 'A generous window, which widens the portfolio — the allocator can consider options a tighter constraint would have excluded.',
    booked: { flight: true, hotel: true, cab: true },
    disruption: { flight: '6E-5192', at: '07:40', kind: 'Delayed 4 h — misses the Singapore connection', delayHours: 4, overnight: false },
    timeline: [
      { t: '−01:10', phase: 'WATCH', text: 'Rotational delay detected. The Delhi connection is now at risk even though the Mumbai leg will operate.', cost: 'free' },
      { t: '−01:08', phase: 'WARM', text: 'Coordinator reshops the route once. A portfolio of three viable recoveries is built and priced.', cost: 'free' },
      { t: '−01:05', phase: 'ASK', text: 'Tier B: the agent presents all three with full costs and a “why” chip on each. Nothing is held to a card.', cost: 'free' },
      { t: '−00:56', phase: 'WAIT', text: 'Arjun takes 9 minutes to choose. Holds stay live throughout — this is what the tentative-hold model buys.', cost: 'free' },
      { t: '−00:55', phase: 'ACT', text: 'He approves option 2. Only now does the saga execute: flight, hotel, cab, each with its compensation registered first.', cost: 'member' },
      { t: '−00:54', phase: 'VERIFY', text: 'Onward DEL→SIN segment confirmed intact.', cost: 'free' },
      { t: '−00:54', phase: 'CLAIM', text: 'Delay is 4 h — over the 2 h meals threshold, under the 6 h hotel threshold. Meals claimed from the carrier; the hotel is genuinely his cost.', cost: 'split' },
    ],
    costs: [
      { item: 'Fare difference', amount: 3200, payer: 'member', why: 'Voluntary change — the original flight did operate' },
      { item: 'Hotel night', amount: 4500, payer: 'member', why: 'Delay is 4 h, under the 6 h threshold — not owed' },
      { item: 'Airport transfer', amount: 800, payer: 'member', why: 'Not owed at this delay band' },
      { item: 'Meals', amount: 0, payer: 'airline', why: 'Delay ≥ 2 h' },
    ],
    outcome: { verdict: 'A', label: 'Same-day, commitment kept', good: true,
      text: 'Approved in 9 minutes and executed in under a minute. He made the pitch — and he knew the price before a rupee moved, because nothing was charged until he said so.' },
    proofs: ['dgca-care-thresholds', 'hold-ttl', 'sim-outcome-a'],
  },

  /* ------------------------------------------------------------------ 3 */
  {
    id: 'fatima',
    name: 'Fatima Sheikh',
    mode: 'wallet',
    headline: 'Autopilot, peak season, and the wallet settles it',
    route: ['CCU', 'DEL', 'DXB'],
    routeLabel: 'Kolkata → Delhi → Dubai',
    purpose: 'Family wedding in Dubai',
    window: { earliest: '02 Sep, 05:00', latest: '06 Sep, 23:00', slackHours: 6, tight: false },
    windowNote: 'Peak season on a thick route: alternatives exist but they are priced. The window is wide enough that the allocator could have waited — it did not need to.',
    booked: { flight: true, hotel: true, cab: true },
    disruption: { flight: '6E-6402', at: '05:50', kind: 'Cancelled — but a fare-difference alternative only', delayHours: 5, overnight: false },
    timeline: [
      { t: '−03:20', phase: 'WATCH', text: 'Cancellation risk rises on a saturated peak-season route.', cost: 'free' },
      { t: '−03:18', phase: 'WARM', text: 'Portfolio built. Every same-carrier option is gone; the reachable alternatives are on other carriers and cost more.', cost: 'free' },
      { t: '−03:15', phase: 'ASK', text: 'Consent already standing at tier A with a declared per-transaction cap. No new approval needed inside the cap.', cost: 'free' },
      { t: '05:50', phase: 'ACT', text: 'Carrier cancels. Notification fires: “cancelled — rebooking you now, ₹11,300, tap to take the wheel.” 90-second quiet window opens.', cost: 'free' },
      { t: '05:51:30', phase: 'ACT', text: 'Quiet window closes with no objection. vPayment issues a VAN locked to ₹11,300 and to today’s date — it cannot be reused or overspent.', cost: 'member' },
      { t: '05:51:40', phase: 'ACT', text: 'Flight, hotel and cab confirmed as one distributed transaction. Original disposed last.', cost: 'member' },
      { t: '05:51:41', phase: 'VERIFY', text: 'DEL→DXB segment intact.', cost: 'free' },
      { t: '05:52', phase: 'CLAIM', text: 'Delay band gives meals only. Claimed from the carrier. The fare difference is genuinely hers and is itemised as such.', cost: 'split' },
    ],
    costs: [
      { item: 'Fare difference', amount: 6000, payer: 'member', why: 'Other-carrier alternative at peak pricing' },
      { item: 'Hotel night', amount: 4500, payer: 'member', why: 'Under the 6 h overnight threshold' },
      { item: 'Airport transfer', amount: 800, payer: 'member', why: 'Not owed at this delay band' },
      { item: 'Meals', amount: 0, payer: 'airline', why: 'Delay ≥ 2 h' },
    ],
    walletNote: 'Settled from the linked wallet via a single-use virtual account number capped at ₹11,300 and dated to today. Even a compromised agent cannot spend more than the plan it presented.',
    outcome: { verdict: 'A', label: 'Same-day, commitment kept', good: true,
      text: 'Ninety seconds of quiet, ten seconds of execution, one notification with the full breakdown. She never opened the app.' },
    proofs: ['dgca-care-thresholds', 'latency-budget', 'opa-latency'],
  },

  /* ------------------------------------------------------------------ 4 */
  {
    id: 'rohit',
    name: 'Rohit Bansal',
    mode: 'cannotBook',
    headline: 'Consent in hand, and the inventory is gone anyway',
    route: ['DEL', 'GAU'],
    routeLabel: 'Delhi → Guwahati',
    purpose: 'Visiting family',
    window: { earliest: '03 Dec, 04:00', latest: '05 Dec, 23:00', slackHours: 26, tight: false },
    windowNote: 'A wide window is what turns this from a failure into an acceptable outcome. Had Rohit needed to arrive today, this same recovery would have been an escalation.',
    booked: { flight: true, hotel: true, cab: true },
    disruption: { flight: '6E-2117', at: '06:30', kind: 'Cancelled in a systemic event — Delhi weather closure', delayHours: 19, overnight: true },
    timeline: [
      { t: '−04:00', phase: 'WATCH', text: 'Delhi weather deteriorating. This is not one flight — it is every route out of Delhi at once.', cost: 'free' },
      { t: '−03:55', phase: 'WARM', text: 'Coordinator reshops DEL→GAU. A thin route: only two frequencies remain in the window, and both are filling from other cancellations.', cost: 'free' },
      { t: '−03:50', phase: 'ASK', text: 'Consent captured against the outcome — “get me to Guwahati” — not against a flight we might not win.', cost: 'free' },
      { t: '06:30', phase: 'ACT', text: 'Carrier cancels. Allocation runs. Both same-day alternatives are exhausted before our block is reached — the carrier’s own re-accommodation consumed them first.', cost: 'free' },
      { t: '06:30:12', phase: 'ACT', text: 'No same-day seat exists that we can reach. The system does not retry into a wall — it changes objective.', cost: 'free' },
      { t: '06:31', phase: 'CLAIM', text: 'Delay exceeds 6 h across an overnight window. Hotel, transfer and meals are all owed by the carrier. Claimed immediately.', cost: 'airline' },
      { t: '06:31', phase: 'ACT', text: 'Next-day flight booked within his stated window. Hotel and cab re-arranged around the new departure.', cost: 'airline' },
      { t: '06:32', phase: 'ESCALATE', text: 'Handed to a human with the full context attached — what was tried, what was exhausted, what is owed. He never re-explains.', cost: 'free' },
    ],
    costs: [
      { item: 'Fare difference', amount: 0, payer: 'airline', why: 'Involuntary — carrier cancelled' },
      { item: 'Hotel night', amount: 0, payer: 'airline', why: 'Delay ≥ 6 h with an overnight window' },
      { item: 'Airport transfer', amount: 0, payer: 'airline', why: 'Owed alongside the hotel' },
      { item: 'Meals', amount: 0, payer: 'airline', why: 'Delay ≥ 2 h' },
    ],
    outcome: { verdict: 'C', label: 'Next day + duty of care', good: false,
      text: 'We could not get him out today, and we said so plainly rather than dressing it up. He lost a day. He paid nothing, everything he was owed was claimed without him asking, and a human picked it up with the full history already loaded.' },
    honest: 'This is 27.68% of members in the blended model — and 49.71% in a systemic event. It is the single most common non-ideal outcome, which is exactly why it is one of the four and not hidden.',
    proofs: ['sim-outcome-c', 'sim-regime-systemic', 'dgca-care-thresholds', 'sens-worst'],
  },
];

export const getPersona = (id) => PERSONAS.find((p) => p.id === id) || null;
