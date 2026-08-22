/**
 * Runs once at module load (imported once from store.ts's first consumer).
 * Small, hand-controllable dataset — 5 flights, 5 card members — but nothing
 * about the architecture depends on staying this size: anything the /ops
 * panel creates through the API behaves identically to what's seeded here.
 */
import * as store from './store';
import { ensureReady, withAdvisoryLock, SEED_LOCK_KEY } from './db';
import { hashPassword } from '../auth/passwords';
import { DEMO_ACCOUNTS } from '@/lib/demoAccounts';
import type { Passenger, Flight, FlightForecast, PastFlight, Traveller, Alt } from './types';
import { localDateParts, localTime } from '../airportDirectory';
import { localHourAtAirport, localDateISOAt } from '../deadline';
import { thresholdsFor } from '../engine/thresholds';
import { bandFor, BAND_TONE } from '@/lib/thresholds';
import { getThresholdConfig } from '@/lib/thresholdConfig';
import { refreshAltsNow } from '../engine/altsCache';
import { refreshGroundIfStale } from '../engine/groundCache';

const now = Date.now();
const MIN = 60_000;

/**
 * Demo floor: every UPCOMING flight below is written as an offset from this
 * base, so a departure never lands before the scheduled demo date. Once the
 * real clock passes it, `Math.max` makes it a no-op and offsets go back to
 * being relative to now. Past flights (seedPastFlights) deliberately keep using
 * `now` — history stays relative to the real present.
 */
const DEMO_FLOOR = new Date(2026, 7, 25, 6, 0, 0).getTime(); // 25 Aug 2026, 06:00 local
const demoBase = Math.max(now, DEMO_FLOOR);
const iso = (offsetMin: number) => new Date(demoBase + offsetMin * MIN).toISOString();
const hhmm = (offsetMin: number) => {
  const d = new Date(demoBase + offsetMin * MIN);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Real max-risk feature profile the model actually produces: a late Sunday
 * EVENING departure, in the ORIGIN AIRPORT'S OWN LOCAL TIME. Computed
 * dynamically from whenever the server boots, so it stays a real upcoming
 * flight — see documentation/design/05-cancellation-risk-model.md §7.
 *
 * ── This used to be nextSundayAt22UTC(), and that was wrong ───────────────
 *
 * `hour_of_day` is trained on the origin airport's local wall clock
 * (riskModel.ts's assembleFeatures says so explicitly, via localDateParts).
 * Setting 22:00 UTC therefore produced 03:30 in Mumbai — hour 3, which the
 * model scores as a LOW-risk hour. Verified against the live scorer, holding
 * every other feature fixed:
 *
 *     local hour 02 / 06 / 12  ->  2.8%   riskScore 31
 *     local hour 18            ->  5.2%   riskScore 78
 *     local hour 22            ->  5.3%   riskScore 81
 *
 * So the seeded "max-risk" flight was sitting in the model's quietest hours
 * while its comment claimed the opposite, and u4 had silently decayed from
 * the documented ~8% / hold-gate to 3% / watch. Fixed by resolving the local
 * hour through the airport's own timezone.
 */
function nextSundayEveningAt(iata: string, localHour: number, fromMs: number): number {
  // Walk forward a day at a time and ask the airport directory what instant
  // corresponds to `localHour` on that date, rather than doing arithmetic on
  // UTC — the offset is a property of the instant (DST), not of the zone.
  const d = new Date(fromMs);
  for (let i = 0; i < 14; i++) {
    const probe = new Date(d.getTime() + i * 86_400_000);
    const date = localDateISOAt(iata, probe.getTime());
    const at = localHourAtAirport(iata, date, localHour);
    if (at > fromMs && localDateParts(iata, at).dayOfWeek === 0) return at;
  }
  // Unreachable in practice (a Sunday always falls inside 14 days); fall back
  // to a week out rather than throwing during seeding.
  return fromMs + 7 * 86_400_000;
}

/**
 * Memoized per-process so concurrent callers in THIS process share one seed
 * run (same guard the old `let seeded = false` gave). That alone is not
 * enough once the store is a shared database, though: two ECS tasks can
 * each start this promise at the same moment, and each has its own
 * memoized promise. The advisory lock in doSeed() below is what stops a
 * second process from actually re-inserting the demo data once a first
 * process has already claimed it — see that function's comment.
 */
let seedPromise: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  if (!seedPromise) seedPromise = doSeed();
  return seedPromise;
}

/**
 * Seed data uses fixed ids for flights/passengers/credentials (upsert-safe
 * by construction — re-running seedFlights/seedPassengers/seedCredentials
 * is idempotent), but bookings/itineraries/travellers are minted from a
 * shared Postgres sequence and plain-inserted with no natural key to
 * de-duplicate on. Two processes each running the full seed once would
 * therefore create two distinct sets of demo bookings. The advisory lock
 * here (same primitive server/domain/db.ts's migration runner uses) makes
 * "did the seed already happen" an atomic check-and-claim across every
 * process sharing this database: the loser blocks until the winner has
 * fully finished, then sees `seed_state` already populated and returns
 * without seeding a second time.
 */
async function doSeed(): Promise<void> {
  // Migrations first: withAdvisoryLock's own connection is reserved purely
  // for the lock/unlock pair and the seed_state read/write below — it must
  // not be the thing that also creates seed_state, or this races
  // runMigrations() over which one creates the schema first. ensureReady()
  // is memoized, so this is a no-op if a store.* call already triggered it.
  await ensureReady();

  await withAdvisoryLock(SEED_LOCK_KEY, async (q) => {
    const [{ exists: alreadySeeded }] = await q<{ exists: boolean }[]>`
      select exists(select 1 from seed_state where id = 'seeded') as exists
    `;
    if (alreadySeeded) return;

    await seedPassengers();
    await seedCredentials();
    await seedFlights();
    await seedBookingsAndItineraries();
    await seedPastFlights();

    await q`insert into seed_state (id) values ('seeded') on conflict do nothing`;
  });
}

/**
 * One password per card member, hashed here at seed time from the plaintext
 * list in lib/demoAccounts.ts (kept client-safe so the login page can display
 * it too — see that file for why plaintext-at-seed-time is fine for a store
 * this demo/pilot reseeds from scratch, and not a template for real
 * provisioning).
 */
async function seedCredentials() {
  for (const c of DEMO_ACCOUNTS) {
    await store.createCredential({ passengerId: c.passengerId, email: c.email, passwordHash: hashPassword(c.password) });
  }
}

async function seedPassengers() {
  const base = (over: Partial<Passenger> & Pick<Passenger, 'id' | 'displayName' | 'legalName'>): Passenger => ({
    dob: '—', gender: '—', nationality: 'Indian',
    passport: { number: 'Z••••••21', expiry: 'Sep 2031', issued: 'India' },
    contact: { email: 'member@•••••.com', phone: '+91 ••••• 0000' },
    consent: 'autopilot',
    loyalty: [], prefs: [{ k: 'Cabin entitlement', v: 'Economy' }, { k: 'Per-transaction cap', v: '₹25,000' }],
    payment: { card: 'Amex Platinum •••• •••• •••• 1008', method: 'Single-use virtual card per booking' },
    ...over,
  });

  await store.createPassenger(base({
    id: 'p-priya', displayName: 'Priya S.', legalName: 'PRIYA RAMESH SUNDARAM', dob: '14 Mar 1988', gender: 'Female',
    loyalty: [{ airline: 'Air India · Maharaja Club', number: 'AI••••8802', tier: 'Gold' }, { airline: 'IndiGo · 6E Rewards', number: '6E••••1173', tier: '—' }],
    prefs: [{ k: 'Seat', v: 'Aisle, forward cabin' }, { k: 'Meal', v: 'Vegetarian (AVML)' }, { k: 'Cabin entitlement', v: 'Economy' }, { k: 'Per-transaction cap', v: '₹25,000' }],
  }));
  await store.createPassenger(base({ id: 'p-arjun', displayName: 'Arjun M.', legalName: 'ARJUN MEHTA', dob: '02 Jul 1991', gender: 'Male' }));
  await store.createPassenger(base({ id: 'p-fatima', displayName: 'Fatima S.', legalName: 'FATIMA SHEIKH', dob: '19 Nov 1994', gender: 'Female' }));
  await store.createPassenger(base({ id: 'p-rohan', displayName: 'Rohan V.', legalName: 'ROHAN VERMA', dob: '30 Jan 1985', gender: 'Male' }));
  await store.createPassenger(base({ id: 'p-ananya', displayName: 'Ananya I.', legalName: 'ANANYA IYER', dob: '08 Sep 1997', gender: 'Female' }));
}

/**
 * Mock alternative inventory for the demo.
 *
 * In a real deployment `candidates.alts` stays [] in the seed and is filled
 * live from a supplier search (the /ops "Warm" button, or the risk-gated
 * pre-fetch). A demo has no supplier keys, so without this every triggered
 * flight would recover with nothing to book — no options, no refund/delta/
 * new-cost arithmetic, and the saga stalls at the policy gate with nothing to
 * act on. Seeding realistic options makes "trigger any flight" produce a full,
 * honest recovery: each option's `fare` is the new cost, refund.ts computes
 * what comes back, and the member decides on the delta between them.
 *
 * Positioned relative to each flight's OWN departure (so alts sit after the
 * cancelled one) and priced in INR. `ok:false` marks an option the card's
 * policy rules out (cabin/cap); seats below a party size are filtered per-party
 * downstream (altsForParty), which is why the party cases carry a small-seat
 * option too.
 */
type AltSpec = {
  code: string;
  laterMin: number;
  durationMin: number;
  cabin?: string;
  seats: number;
  fare: number;
  ok?: boolean;
  why: string;
};

const ALT_SPECS: Record<string, AltSpec[]> = {
  u1: [
    { code: 'AI 2841', laterMin: 180, durationMin: 155, seats: 7, fare: 8200, why: 'Next full-service seat on your route, ~3h later' },
    { code: '6E 6178', laterMin: 300, durationMin: 150, seats: 9, fare: 7350, why: 'Cheapest seat that still lands the same night' },
    { code: 'UK 828', laterMin: 240, durationMin: 145, cabin: 'Business', seats: 4, fare: 15200, ok: false, why: 'Business fare — above your Economy entitlement' },
  ],
  u2: [
    { code: 'AI 111', laterMin: 300, durationMin: 560, seats: 5, fare: 51500, why: 'Same-day direct to London, ~5h later' },
    { code: 'UK 17', laterMin: 720, durationMin: 550, seats: 6, fare: 47900, why: 'Cheapest same-day direct' },
    { code: 'BA 142', laterMin: 180, durationMin: 545, cabin: 'Business', seats: 3, fare: 92000, ok: false, why: 'Business fare — above your per-transaction cap' },
  ],
  u3: [
    { code: '6E 5201', laterMin: 150, durationMin: 130, seats: 9, fare: 6300, why: 'Next 6E on the route' },
    { code: 'AI 866', laterMin: 240, durationMin: 135, seats: 6, fare: 6850, why: 'Full-service, ~4h later' },
    { code: 'SG 8172', laterMin: 360, durationMin: 140, seats: 8, fare: 5600, why: 'Cheapest evening option' },
  ],
  'f-multi': [
    { code: 'AI 505', laterMin: 180, durationMin: 165, seats: 7, fare: 7100, why: 'Seven seats — fits the whole party of six together' },
    { code: '6E 6902', laterMin: 300, durationMin: 160, seats: 9, fare: 6600, why: 'Cheapest option with six seats together' },
    { code: 'UK 862', laterMin: 120, durationMin: 170, seats: 3, fare: 11330, why: 'Only three seats left — fits a small party, not six' },
  ],
  'f-depth': [
    { code: '6E 245', laterMin: 180, durationMin: 80, seats: 9, fare: 4200, why: 'Next hop back to Chennai' },
    { code: 'IX 2478', laterMin: 300, durationMin: 85, seats: 6, fare: 3900, why: 'Cheapest evening seat' },
  ],
  u4: [
    { code: '6E 456', laterMin: 180, durationMin: 90, seats: 8, fare: 5400, why: 'Next flight to Goa' },
    { code: 'AI 673', laterMin: 300, durationMin: 95, seats: 6, fare: 5950, why: 'Full-service, ~5h later' },
  ],
  u5: [
    { code: '6E 2795', laterMin: 150, durationMin: 130, seats: 7, fare: 8600, why: 'Next available seat on the route' },
    { code: 'UK 995', laterMin: 300, durationMin: 125, seats: 5, fare: 9200, why: 'Full-service alternative' },
  ],
  u6: [
    { code: 'AI 507', laterMin: 180, durationMin: 165, cabin: 'Premium Economy', seats: 4, fare: 15200, why: 'Same Premium Economy cabin you booked' },
    { code: '6E 6908', laterMin: 300, durationMin: 160, seats: 9, fare: 9800, why: 'Economy — a cabin down, but far cheaper' },
  ],
};

/** Build a flight's mock alternatives from ALT_SPECS, positioned after its own
 *  departure and rendered in each airport's local clock. */
function buildAlts(f: Flight): Alt[] {
  const specs = ALT_SPECS[f.id];
  if (!specs) return [];
  const origDep = Date.parse(f.depISO);
  return specs.map((s, i) => {
    const departsAt = origDep + s.laterMin * MIN;
    const arrivesAt = departsAt + s.durationMin * MIN;
    return {
      id: `${f.id}-alt${i + 1}`,
      code: s.code,
      dep: localTime(f.from, departsAt),
      arr: localTime(f.to, arrivesAt),
      departsAt,
      arrivesAt,
      cabin: s.cabin ?? 'Economy',
      seats: s.seats,
      fare: s.fare,
      currency: 'INR',
      kind: 'market',
      ok: s.ok ?? true,
      why: s.why,
      expiresAt: now + 4 * 60 * MIN,
    };
  });
}

/**
 * A realistic, guaranteed-visible starting risk score for a booked flight —
 * shown the instant a member logs in, before the live model or the risk-model
 * service has necessarily even answered yet. This is deliberately the SAME
 * mechanism `/ops`'s "Ramp risk" control already uses
 * (`app/api/flights/[id]/demo-risk/route.ts`) — `modelVersion: 'demo-override'`
 * — not a second, parallel way of faking a score. Two consequences follow
 * from reusing that exact tag, both intentional:
 *
 *   1. `isDemoPinned()` (server/engine/forecast.ts) already makes every
 *      rescore path — the on-demand read, the interval batch scorer, the
 *      startup warm pass — leave a pinned forecast alone. A seeded baseline
 *      therefore survives exactly as an operator-set ramp already does: it
 *      changes only when `/ops` changes it (a fresh "Ramp risk" call, an
 *      actual disruption trigger) or `resetDemo()` re-seeds the flight.
 *   2. The member-facing UI and the audit panel keep showing this honestly —
 *      `ForecastAudit` never claims a pinned score is a live model read, and
 *      neither does this. A seeded baseline is a presenter's starting
 *      position, not a substitute for the real, self-trained model, which is
 *      still what every subsequent score comes from once a flight is
 *      unpinned.
 *
 * The pct/riskScore pairs below are not invented out of range: they sit
 * inside the real model's own observed distribution (p50 ~3%, p90 ~6.5%,
 * p99 ~9.7% — see zkd-risk-model/reports/score_distribution.json) rather
 * than a dramatized number no live prediction has ever actually produced.
 * u4/u5/u6 match the real measured score for their engineered late-Sunday
 * profile (see the comment above their definitions) — hardcoding them here
 * only removes the dependency on the risk-model service being reachable at
 * the exact moment a judge opens the app, it does not change the story.
 */
function seedForecast(flight: Pick<Flight, 'id' | 'depISO' | 'hasHardConstraint'>, opts: { pct: number; riskScore: number; partySize?: number }): FlightForecast {
  const departsAt = new Date(flight.depISO).getTime();
  const thresholds = thresholdsFor({
    seatsAvailable: 12, // no supplier search has run yet at seed time — same fallback demo-risk/route.ts uses
    partySize: opts.partySize ?? 1,
    minutesToDeparture: Math.max(0, Math.round((departsAt - now) / MIN)),
    hasHardConstraint: flight.hasHardConstraint,
    confidence: 0.8,
  });
  const band = bandFor(opts.pct, thresholds);
  return {
    pct: opts.pct,
    band,
    tone: BAND_TONE[band],
    connectionRisk: null,
    confidence: 0.8,
    source: 'internal-ml',
    modelVersion: 'demo-override',
    riskScore: opts.riskScore,
    thresholds,
    asOf: now,
  };
}

/** Per-flight starting point, chosen once here rather than left to whatever
 *  the live model happens to say at the moment someone is watching. See
 *  seedForecast's header for why these specific numbers and why they stay
 *  put until an /ops action moves them. */
const SEED_FORECASTS: Record<string, { pct: number; riskScore: number; partySize?: number }> = {
  u1: { pct: 6, riskScore: 64 },        // the flagship leg — visibly amber ("prepare") from the first login, matches its real hard-constraint-lowered threshold
  u2: { pct: 2, riskScore: 22 },        // the London leg itself — quiet; it's u1's connection that's at risk, not this one
  u3: { pct: 2, riskScore: 20 },        // ordinary domestic sector
  'f-multi': { pct: 4, riskScore: 45, partySize: 6 }, // party of six — scarcity read against the largest party on the flight
  'f-depth': { pct: 2, riskScore: 18 },
  u4: { pct: 8, riskScore: 95 },        // matches the real measured score for this engineered late-Sunday profile — see comment below
  u5: { pct: 8, riskScore: 95 },
  u6: { pct: 8, riskScore: 95 },        // hasHardConstraint lowers this flight's own bar further, same real story as before
};

export function buildDemoFlights(): Flight[] {
  const flights: Flight[] = [
    {
      // The flagship — the route the whole walkthrough is built around.
      id: 'u1', code: 'AI 2803', from: 'MAA', to: 'DEL', depISO: iso(168), durationMin: 160,
      aircraft: 'A320neo', terminal: 'T1',
      // Feeds the London leg 380 min later; 160 in the air leaves 220 of slack.
      connectionSlackMinutes: 220, hasHardConstraint: true,
      candidates: {
        // Alternatives are no longer seeded — server/engine/altsCache.ts fetches
        // them live from Duffel/Sabre/Travelport the first time this flight is
        // viewed, and caches them here exactly like the forecast is cached.
        alts: [],
        hotels: [
          { id: 'h1', name: 'Andaz Delhi Aerocity', area: 'Aerocity · 8 min from T3', checkin: '16:30', rate: 0, extra: 0, currency: 'INR', ok: true, walk: 'Your existing booking, re-timed', why: 'Same property, same rate — we only moved the check-in time' },
          { id: 'h2', name: 'Roseate House', area: 'Aerocity · 10 min from T3', checkin: '17:00', rate: 0, extra: 2400, currency: 'INR', ok: true, walk: 'New booking', why: 'Airline-covered up to your entitlement; ₹2,400 over' },
          { id: 'h3', name: 'The Leela Palace', area: 'Chanakyapuri · 40 min from T3', checkin: '17:00', rate: 0, extra: 14800, currency: 'INR', ok: false, walk: 'New booking', why: 'Beyond the duty-of-care rate the airline will reimburse' },
        ],
        cabs: [
          { id: 'c1', kind: 'Sedan', seats: 3, extra: 0, currency: 'INR', ok: true, why: 'Within the transfer allowance the airline reimburses' },
          { id: 'c2', kind: 'SUV', seats: 6, extra: 900, currency: 'INR', ok: true, why: 'More boot space for your London bags · ₹900 over the allowance' },
          { id: 'c3', kind: 'Chauffeured luxury', seats: 3, extra: 6200, currency: 'INR', ok: false, why: 'Beyond the transfer allowance the airline will reimburse' },
        ],
        cabLegs: [
          { id: 'l1', from: 'DEL T3', to: 'Andaz Aerocity', pickup: hhmm(168 + 320), note: 'Re-timed around your new arrival' },
          { id: 'l2', from: 'Andaz Aerocity', to: 'DEL T3', pickup: '09:40', note: 'Re-timed for your London departure' },
        ],
      },
    },
    {
      id: 'u2', code: 'AI 2201', from: 'DEL', to: 'LHR', depISO: iso(168 + 380), durationMin: 555,
      aircraft: 'B787-9', terminal: 'T3',
      connectionSlackMinutes: null, hasHardConstraint: true,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
    {
      id: 'u3', code: '6E 5192', from: 'BOM', to: 'DEL', depISO: iso(168 - 60 + 24 * 60 * 17), durationMin: 135,
      aircraft: 'A320', terminal: 'T2',
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
    {
      // Party case: Arjun's party of 6 and Rohan's party of 2 on the same
      // flight, each with their own PNR and their own recovery task. The 3-seat
      // market alt fits Rohan's party and does not fit Arjun's — that mismatch
      // is the reason two classes of alternative exist at all (see
      // server/domain/altsForParty.ts).
      id: 'f-multi', code: 'AI 401', from: 'DEL', to: 'BLR', depISO: iso(300), durationMin: 170,
      aircraft: 'A321neo', terminal: 'T3',
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: {
        // Same as u1 — fetched live, not seeded. This flight is the party-size
        // test case (Arjun's 6 vs Rohan's 2 sharing one flight), which now
        // depends on however many seats real supplier inventory actually
        // returns for DEL→BLR, not a hand-picked seat count.
        alts: [],
        hotels: [
          { id: 'mh1', name: 'Ibis Bengaluru Airport', area: 'Airport area · 12 min', checkin: '18:00', rate: 0, extra: 0, currency: 'INR', ok: true, walk: 'New booking', why: 'Within the duty-of-care rate' },
          { id: 'mh2', name: 'Trinity Hometel', area: 'Airport area · 15 min', checkin: '18:00', rate: 0, extra: 2400, currency: 'INR', ok: true, walk: 'New booking', why: 'Airline-covered up to your entitlement; ₹2,400 over per room' },
        ],
        cabs: [
          { id: 'mc1', kind: 'Sedan', seats: 3, extra: 0, currency: 'INR', ok: true, why: 'Within the transfer allowance the airline reimburses' },
          { id: 'mc2', kind: 'SUV', seats: 6, extra: 900, currency: 'INR', ok: true, why: 'One vehicle for the whole party · ₹900 over the allowance' },
        ],
        cabLegs: [
          { id: 'ml1', from: 'BLR T2', to: 'Ibis Bengaluru Airport', pickup: hhmm(300 + 280), note: 'Re-timed around new arrival' },
        ],
      },
    },
    {
      id: 'f-depth', code: '6E 234', from: 'BLR', to: 'MAA', depISO: iso(420), durationMin: 80,
      aircraft: 'A320', terminal: 'T1',
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
    {
      // The genuinely high-risk case, not a fabricated one: late-Sunday-night
      // red-eye is the real max-risk profile score_distribution.py's grid
      // found for the current model (retrained 2026-08-16, see
      // documentation/design/05-cancellation-risk-model.md §1) — this exact
      // combination (month/day-of-week/hour, real BOM->GOI great-circle
      // distance, real scheduled duration) scores ~8% through the live
      // model, the only seeded flight that clears 'hold-gate' under the
      // recalibrated real-percentile thresholds (config/risk-thresholds.json)
      // even in the hardest-to-cross case (ample seats, far from departure,
      // no hard constraint). u1/f-multi (both hasHardConstraint) score ~6%
      // and land at 'prepare' — a real, adaptively-lowered bar for a genuine
      // connection risk, not the same tier as u4's raw probability. The rest
      // score ~3% and stay at 'watch'. u4 is the one that shows the action
      // ladder, the pre-cache trigger, and the audit panel actually firing
      // on a real score, not a hand-picked probability.
      //
      // Measured 2026-08-18 after the local-hour fix: 8% / riskScore 95 /
      // hold-gate. It had decayed to 3% / watch while the helper was setting
      // 22:00 UTC (= 03:30 IST, one of the model's QUIETEST hours) — see
      // nextSundayEveningAt above.
      id: 'u4', code: '6E 6155', from: 'BOM', to: 'GOI',
      depISO: new Date(nextSundayEveningAt('BOM', 22, demoBase)).toISOString(), durationMin: 90,
      aircraft: 'A320neo', terminal: 'T2',
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
    {
      /**
       * Two more flights on the same real max-risk profile as u4 — Sunday
       * evening, local time — so the high-risk path is not a single flight
       * that a demo can miss.
       *
       * Every number these produce is the model's own. They are engineered in
       * the sense that their FEATURES sit where the model already says risk is
       * highest (Sunday, late local evening, short domestic sector), not in the
       * sense that any score is written down. Measured 2026-08-18: both land at
       * 8% / riskScore 95 / hold-gate, comfortably past
       * config/risk-thresholds.json's altCache.prefetchAtOrAboveRiskScore of
       * 75, which is what actually triggers alternative pre-fetching.
       */
      id: 'u5', code: '6E 2789', from: 'BOM', to: 'DEL',
      depISO: new Date(nextSundayEveningAt('BOM', 21, demoBase)).toISOString(), durationMin: 130,
      aircraft: 'A321neo', terminal: 'T2',
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
    {
      // Same profile again, with a hard constraint on top. hasHardConstraint
      // lowers this flight's OWN adaptive thresholds (lib/thresholds.ts), so it
      // should reach a higher band than u4/u5 on an identical raw probability —
      // which is the point worth showing: the bar moves per flight, it is not a
      // fixed 80.
      id: 'u6', code: 'AI 2984', from: 'DEL', to: 'BLR',
      depISO: new Date(nextSundayEveningAt('DEL', 22, demoBase)).toISOString(), durationMin: 165,
      aircraft: 'A320neo', terminal: 'T3',
      connectionSlackMinutes: 55, hasHardConstraint: true,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
  ];
  // Alternatives are NOT seeded onto flights. They are searched only when the
  // risk gate fires — a threshold crossing (real high-risk or the /ops Ramp),
  // a manual Warm, or an actual cancellation — exactly as production behaves.
  // Seeding them made "find alternatives" show on low-risk flights before any
  // crossing, which is wrong. The supplier layer (server/suppliers) is the
  // single source of alternatives now.
  //
  // Forecasts ARE seeded, deliberately, unlike alts — see seedForecast's
  // header. A member's very first view must show a real-looking number, not
  // "—" while the risk-model service warms up.
  for (const f of flights) {
    const spec = SEED_FORECASTS[f.id];
    if (spec) f.forecast = seedForecast(f, spec);
  }
  return flights;
}

/**
 * A real threshold crossing (and /ops "Ramp risk") both fire the same
 * prefetch — see triggerAltPrefetchIfWarranted in server/engine/forecast.ts.
 * A pinned seed forecast skips applyScore() entirely (that's the whole point
 * of the pin), so without this a high-riskScore seeded flight would show "we
 * have backup seats identified" copy with nothing actually cached yet.
 * Mirrors demo-risk/route.ts's own post-write refresh call. Shared by the
 * initial seed and resetDemo() so a demo reset doesn't regress this.
 */
async function prefetchIfAboveGate(f: Flight): Promise<void> {
  const gate = getThresholdConfig().altCache.prefetchAtOrAboveRiskScore;
  if ((f.forecast?.riskScore ?? 0) < gate) return;
  await refreshAltsNow(f.id, 'seeded above the pre-fetch gate').catch(() => {});
  refreshGroundIfStale(f);
}

async function seedFlights() {
  for (const f of buildDemoFlights()) {
    await store.createFlight(f);
    await prefetchIfAboveGate(f);
  }
}

/**
 * Demo reset — restore every seeded flight to its original state (clearing any
 * forecast, warmed candidates or reschedule), delete anything added through the
 * /ops console, and wipe all disruption/recovery state. Bookings and history are
 * static and left in place. Reuses buildDemoFlights() so "original" always means
 * exactly what the seed produces.
 */
export async function resetDemo(): Promise<void> {
  await ensureReady();
  const flights = buildDemoFlights();
  const seededIds = new Set(flights.map((f) => f.id));
  for (const f of flights) {
    await store.createFlight(f);
    await prefetchIfAboveGate(f);
  }
  for (const f of await store.listFlights()) {
    if (!seededIds.has(f.id)) await store.deleteFlight(f.id);
  }
  await store.clearDisruptionState();
}

/** A companion traveller who is not a card member — a full passenger-style
 *  record because an airline will not reissue a ticket without one, but with
 *  no `passengerId` and therefore no login. */
function companion(o: Pick<Traveller, 'displayName' | 'legalName' | 'dob' | 'gender' | 'type'>): Omit<Traveller, 'id'> {
  return {
    passengerId: null,
    nationality: 'Indian',
    passport: { number: 'Z••••••••', expiry: '—', issued: 'India' },
    contact: { email: '—', phone: '—' },
    loyalty: [],
    ...o,
  };
}

/** The card member's own traveller record, mirroring their Passenger entry. */
async function cardMemberTraveller(passengerId: string): Promise<Omit<Traveller, 'id'>> {
  const p = (await store.getPassenger(passengerId))!;
  return {
    passengerId,
    displayName: p.displayName, legalName: p.legalName, dob: p.dob, gender: p.gender,
    nationality: p.nationality, passport: p.passport, contact: p.contact,
    type: 'adult', loyalty: p.loyalty,
  };
}

async function seedBookingsAndItineraries() {
  const b1 = await store.createBooking({ flightId: 'u1', passengerId: 'p-priya', seat: '14C', pnr: 'QK7R2M', cabin: 'Economy',
    farePaid: { amount: 7450, currency: 'INR' },
    fareBasis: 'partially-refundable', });
  const b2 = await store.createBooking({ flightId: 'u2', passengerId: 'p-priya', seat: '22A', pnr: 'QK7R2M', cabin: 'Economy',
    farePaid: { amount: 48200, currency: 'INR' },
    fareBasis: 'refundable', });
  await store.createItinerary('p-priya', [b1.id, b2.id]); // MAA→DEL→LHR, the layover/connection case
  await store.createBooking({ flightId: 'u3', passengerId: 'p-priya', seat: '8F', pnr: 'LP4XZ1', cabin: 'Economy',
    farePaid: { amount: 5980, currency: 'INR' },
    fareBasis: 'non-refundable', });
  await store.createBooking({ flightId: 'u4', passengerId: 'p-priya', seat: '11A', pnr: 'GV3K9R', cabin: 'Economy',
    farePaid: { amount: 6720, currency: 'INR' },
    fareBasis: 'partially-refundable', });
  // The two extra high-risk flights, so the pre-fetch/consent path has more
  // than one chance to fire in a walkthrough.
  await store.createBooking({ flightId: 'u5', passengerId: 'p-priya', seat: '9C', pnr: 'HT6M2B', cabin: 'Economy',
    farePaid: { amount: 8310, currency: 'INR' },
    fareBasis: 'partially-refundable', });
  await store.createBooking({ flightId: 'u6', passengerId: 'p-priya', seat: '4A', pnr: 'RN8W5D', cabin: 'Premium Economy',
    farePaid: { amount: 14900, currency: 'INR' },
    fareBasis: 'refundable', });

  // Arjun's party of 6 — himself, his spouse, two children, two grandparents.
  const arjun = await store.createTraveller(await cardMemberTraveller('p-arjun'));
  const spouse = await store.createTraveller(companion({ displayName: 'Meera M.', legalName: 'MEERA MEHTA', dob: '11 Sep 1992', gender: 'Female', type: 'adult' }));
  const child1 = await store.createTraveller(companion({ displayName: 'Aarav M.', legalName: 'AARAV MEHTA', dob: '04 Apr 2016', gender: 'Male', type: 'child' }));
  const child2 = await store.createTraveller(companion({ displayName: 'Diya M.', legalName: 'DIYA MEHTA', dob: '19 Jan 2019', gender: 'Female', type: 'child' }));
  const grandpa = await store.createTraveller(companion({ displayName: 'Suresh M.', legalName: 'SURESH MEHTA', dob: '02 Feb 1958', gender: 'Male', type: 'adult' }));
  const grandma = await store.createTraveller(companion({ displayName: 'Lakshmi M.', legalName: 'LAKSHMI MEHTA', dob: '17 May 1960', gender: 'Female', type: 'adult' }));
  const arjunTravellerIds = [arjun.id, spouse.id, child1.id, child2.id, grandpa.id, grandma.id];
  await store.createBooking({
    flightId: 'f-multi', passengerId: 'p-arjun', seat: '12A', pnr: 'MX9F2K', cabin: 'Economy',
    farePaid: { amount: 6450, currency: 'INR' },
    fareBasis: 'partially-refundable',
    travellerIds: arjunTravellerIds,
    seats: [
      { travellerId: arjun.id, seat: '12A' }, { travellerId: spouse.id, seat: '12B' },
      { travellerId: child1.id, seat: '12C' }, { travellerId: child2.id, seat: '12D' },
      { travellerId: grandpa.id, seat: '12E' }, { travellerId: grandma.id, seat: '12F' },
    ],
  });

  // Rohan's party of 2 — himself and a partner. Same flight, independent PNR,
  // independent recovery task: the 3-seat market alt fits this party even
  // though it does not fit Arjun's.
  const rohan = await store.createTraveller(await cardMemberTraveller('p-rohan'));
  const partner = await store.createTraveller(companion({ displayName: 'Kabir N.', legalName: 'KABIR NAIR', dob: '23 Aug 1987', gender: 'Male', type: 'adult' }));
  await store.createBooking({
    flightId: 'f-multi', passengerId: 'p-rohan', seat: '14C', pnr: 'RT4H8P', cabin: 'Economy',
    // A different PNR on the same flight, bought later and dearer — so the
    // refund arithmetic differs between two members on one aircraft, which is
    // exactly the case a single flat "the airline owes you" row used to hide.
    farePaid: { amount: 9180, currency: 'INR' },
    fareBasis: 'non-refundable',
    travellerIds: [rohan.id, partner.id],
    seats: [{ travellerId: rohan.id, seat: '14C' }, { travellerId: partner.id, seat: '14D' }],
  });

  // Fatima's party of 3. Previously shared Arjun's PNR on f-multi — two card
  // members cannot own one PNR under this model, so she moves to her own
  // flight and her own booking.
  const fatima = await store.createTraveller(await cardMemberTraveller('p-fatima'));
  const friend1 = await store.createTraveller(companion({ displayName: 'Zoya S.', legalName: 'ZOYA SHEIKH', dob: '05 Jun 1993', gender: 'Female', type: 'adult' }));
  const friend2 = await store.createTraveller(companion({ displayName: 'Imran S.', legalName: 'IMRAN SHEIKH', dob: '14 Oct 1990', gender: 'Male', type: 'adult' }));
  await store.createBooking({
    flightId: 'f-depth', passengerId: 'p-fatima', seat: '9A', pnr: 'FS3K9L', cabin: 'Economy',
    farePaid: { amount: 5240, currency: 'INR' },
    fareBasis: 'non-refundable',
    travellerIds: [fatima.id, friend1.id, friend2.id],
    seats: [{ travellerId: fatima.id, seat: '9A' }, { travellerId: friend1.id, seat: '9B' }, { travellerId: friend2.id, seat: '9C' }],
  });

  await store.createBooking({ flightId: 'f-depth', passengerId: 'p-ananya', seat: '6D', pnr: 'AZ2N7Q', cabin: 'Economy',
    farePaid: { amount: 5240, currency: 'INR' },
    fareBasis: 'non-refundable', });
}

async function seedPastFlights() {
  const days = (n: number) => new Date(now - n * 24 * 60 * MIN);
  const label = (d: Date) => `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
  const mk = (o: { id: string; code: string; from: string; to: string; dep: string; arr: string; dur: string; ago: number; outcome: PastFlight['outcome']; detail: string; recovered?: string }): PastFlight => ({
    id: o.id, code: o.code, from: o.from, to: o.to, dep: o.dep, arr: o.arr, dur: o.dur,
    date: `${o.ago} days ago`, exact: label(days(o.ago)), outcome: o.outcome, detail: o.detail, recovered: o.recovered,
  });

  await store.setPastFlights('p-priya', [
    mk({ id: 'p1', code: '6E 6402', from: 'CCU', to: 'DEL', dep: '05:00', arr: '07:20', dur: '2h 20m', ago: 47, outcome: 'cancelled', detail: 'Cancelled 50 minutes before departure · rebooked automatically', recovered: 'We put you on 6E 812 three hours later and the airline covered the fare.' }),
    mk({ id: 'p2', code: 'AI 803', from: 'DEL', to: 'BLR', dep: '18:30', arr: '21:15', dur: '2h 45m', ago: 66, outcome: 'delayed', detail: 'Departed 2h 10m late' }),
    mk({ id: 'p3', code: 'UK 996', from: 'BLR', to: 'DEL', dep: '07:45', arr: '10:30', dur: '2h 45m', ago: 69, outcome: 'ontime', detail: 'On time' }),
    mk({ id: 'p4', code: '6E 2117', from: 'DEL', to: 'GAU', dep: '06:00', arr: '08:30', dur: '2h 30m', ago: 236, outcome: 'cancelled', detail: 'Delhi weather closure', recovered: 'No same-day seat existed. We booked you a hotel and the first flight next morning.' }),
    mk({ id: 'p5', code: 'AI 2803', from: 'MAA', to: 'DEL', dep: '07:00', arr: '09:40', dur: '2h 40m', ago: 250, outcome: 'ontime', detail: 'On time' }),
    mk({ id: 'p6', code: 'SG 8169', from: 'DEL', to: 'MAA', dep: '21:10', arr: '23:55', dur: '2h 45m', ago: 267, outcome: 'delayed', detail: 'Departed 55m late' }),
    mk({ id: 'p7', code: 'AI 2803', from: 'MAA', to: 'DEL', dep: '07:00', arr: '09:40', dur: '2h 40m', ago: 322, outcome: 'ontime', detail: 'On time' }),
    mk({ id: 'p8', code: '6E 5192', from: 'BOM', to: 'DEL', dep: '06:00', arr: '08:15', dur: '2h 15m', ago: 401, outcome: 'ontime', detail: 'On time' }),
  ]);
}

// Kicked once when this module is first imported, fire-and-forget: the
// memoized seedPromise (and, across processes, the seed_state row under an
// advisory lock — see doSeed() above) is what actually protects against
// double-seeding, including Next.js dev-mode module re-evaluation (HMR)
// re-running this. Every real consumer still calls `await ensureSeeded()`
// itself before touching the store, so this early kick is purely a warm-start
// optimization, not the correctness mechanism.
void ensureSeeded().catch((e) => console.error('[seed] ensureSeeded failed:', e));
