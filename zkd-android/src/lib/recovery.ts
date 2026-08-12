/**
 * Latency comes from the spec's budget, not from vibes.
 *
 *   53 s cold path. 42 s of it — ingest 3 + assembly 5 + supplier fan-out 34 —
 *   runs BEFORE the cancellation, during WARM, off the critical path. That
 *   leaves ~11 s at the carrier event, and it is dominated by the four supplier
 *   mutations. Negotiation is cheap because it iterates a candidate set already
 *   in memory with zero new supplier calls.
 *
 * Totals are summed from the steps below, never asserted separately.
 */

export type Step = { n: string; d: number; s: string; live?: 'seat' | 'onward' | 'hotel' | 'cab' | 'van' };

export const WARM_STEPS: Step[] = [
  {
    n: 'Signal picked up',
    d: 3,
    s: 'Delay-to-departure ratio crossed threshold on AI 2803. Duplicate feeds deduped at the edge.',
  },
  {
    n: 'Your trip assembled',
    d: 5,
    s: "PNR, trip graph, benefit entitlement and travel window pulled together. Your DEL→LHR leg and tonight's Delhi hotel both hang off this flight.",
  },
  {
    n: 'Suppliers searched',
    d: 34,
    s: 'One coordinator reshop covering everyone on MAA→DEL, not one per passenger — 300 calls collapse to 102. Candidates priced and held warm: no booking, no spend, nothing you could be charged for.',
  },
];

/** everything up to the point a human could still object */
export const DECIDE_STEPS: Step[] = [
  {
    n: 'Cancellation confirmed',
    d: 0.4,
    s: 'The airline filed it. We already had the alternatives, so this is the first moment anything irreversible could happen.',
  },
  {
    n: 'Allocated and negotiated',
    d: 0.6,
    s: 'Min-cost assignment across the portfolio, then 3 negotiation rounds against your hotel and connection — all over the candidate set already in memory, so zero new supplier calls. That is the only reason three rounds cost 0.6 s instead of 100.',
  },
  {
    n: 'Policy gate',
    d: 0.01,
    s: 'Every candidate evaluated against your entitlement, cabin ceiling and travel window. Default deny — nothing executes without an explicit allow. Runs in-process, so ~1 ms.',
  },
];

/** everything after consent — this is the irreversible half */
export const ACT_STEPS: Step[] = [
  {
    n: 'Payment authorised',
    d: 0.9,
    // body is live: the card is locked to the amount the member actually chose
    s: '',
    live: 'van',
  },
  { n: 'Seat booked', d: 3.4, s: '', live: 'seat' },
  { n: 'Hotel moved', d: 2.6, s: '', live: 'hotel' },
  { n: 'Cab re-booked', d: 1.5, s: '', live: 'cab' },
  {
    n: 'Original ticket disposed',
    d: 1.1,
    s: 'Done last, and deliberately outside the rollback chain — a cancellation has no inverse, so it only happens once the replacement is confirmed.',
  },
  { n: 'Onward leg verified', d: 0.6, s: '', live: 'onward' },
  {
    n: 'You were notified',
    d: 0.3,
    s: 'Push to your phone plus an email with the new boarding pass.',
  },
];

const sum = (xs: Step[]) => xs.reduce((a, s) => a + s.d, 0);

export const WARM_TOTAL = sum(WARM_STEPS);
export const DECIDE_TOTAL = sum(DECIDE_STEPS);
export const ACT_TOTAL = sum(ACT_STEPS);
export const MACHINE_TOTAL = DECIDE_TOTAL + ACT_TOTAL;

/**
 * The member's window to object.
 *
 * The web app derives this per disruption from the supplier's own offer expiry
 * minus the time needed to book inside it (see zkd-app/lib/confirmWindow.ts) —
 * a fare is guaranteed only until a stated moment, and that guarantee is what
 * makes the length defensible instead of guessed.
 *
 * This build has no backend and therefore no live offer to read an expiry from,
 * so it carries a representative derived value: ten minutes, which is what the
 * web app produces for a typical disruption bounded by its ceiling. It is a
 * fixture standing in for a computation, not a return to the old flat 90 s.
 */
export const CONFIRM_WINDOW_SECONDS = 10 * 60;

export type Consent = 'autopilot' | 'ask';


/**
 * Pre-authorisation.
 *
 * Above a per-flight threshold (see lib/forecast.ts — it adapts to how many seats
 * are left and how close departure is, rather than sitting at a flat 80%) we stop
 * treating consent as something to collect in a panic and go and ask while there
 * is still time to think. If they answer, the cancellation needs no window at all.
 *
 * The authorisation is CONDITIONAL and SPECIFIC: it fires only if the flight
 * actually cancels, and only for the plan they were shown. If that plan is no
 * longer available we fall back to asking — silently substituting a different
 * plan would break the one promise the whole system rests on.
 */
export type PreAuth = {
  flightId: string;
  altId: string;
  hotelId: string;
  cabId: string;
  owed: number;
  grantedAt: number;
};
