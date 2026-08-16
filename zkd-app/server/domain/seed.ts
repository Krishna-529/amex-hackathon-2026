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
import type { Passenger, Flight, PastFlight, Traveller } from './types';

const now = Date.now();
const MIN = 60_000;
const iso = (offsetMin: number) => new Date(now + offsetMin * MIN).toISOString();
const hhmm = (offsetMin: number) => {
  const d = new Date(now + offsetMin * MIN);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Real max-risk feature profile the model actually produces, found by
 * grid-scoring 168,000 real feature combinations through the live scorer
 * (zkd-risk-model/src/score_distribution.py, restricted to the current real
 * month): late Sunday-night red-eye departure. Computed dynamically (next
 * real Sunday from whenever the server actually boots, not a hardcoded
 * date) so this stays a real, upcoming flight no matter when `npm run dev`
 * actually starts — see documentation/design/05-cancellation-risk-model.md §7.
 */
function nextSundayAt22UTC(fromMs: number): number {
  const d = new Date(fromMs);
  d.setUTCHours(22, 0, 0, 0);
  if (d.getTime() <= fromMs) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
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

async function seedFlights() {
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
      id: 'u4', code: '6E 6155', from: 'BOM', to: 'GOI',
      depISO: new Date(nextSundayAt22UTC(now)).toISOString(), durationMin: 90,
      aircraft: 'A320neo', terminal: 'T2',
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    },
  ];
  for (const f of flights) await store.createFlight(f);
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
  const b1 = await store.createBooking({ flightId: 'u1', passengerId: 'p-priya', seat: '14C', pnr: 'QK7R2M', cabin: 'Economy' });
  const b2 = await store.createBooking({ flightId: 'u2', passengerId: 'p-priya', seat: '22A', pnr: 'QK7R2M', cabin: 'Economy' });
  await store.createItinerary('p-priya', [b1.id, b2.id]); // MAA→DEL→LHR, the layover/connection case
  await store.createBooking({ flightId: 'u3', passengerId: 'p-priya', seat: '8F', pnr: 'LP4XZ1', cabin: 'Economy' });
  await store.createBooking({ flightId: 'u4', passengerId: 'p-priya', seat: '11A', pnr: 'GV3K9R', cabin: 'Economy' });

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
    travellerIds: [fatima.id, friend1.id, friend2.id],
    seats: [{ travellerId: fatima.id, seat: '9A' }, { travellerId: friend1.id, seat: '9B' }, { travellerId: friend2.id, seat: '9C' }],
  });

  await store.createBooking({ flightId: 'f-depth', passengerId: 'p-ananya', seat: '6D', pnr: 'AZ2N7Q', cabin: 'Economy' });
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
