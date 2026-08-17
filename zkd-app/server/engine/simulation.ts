/**
 * The simulation engine. This is the one place that decides anything —
 * every API route and every client device is downstream of what happens
 * here. Uses real setTimeout chains (module-level, process-lifetime) so a
 * disruption's lifecycle advances on schedule whether or not any client is
 * currently polling — the whole point of this redesign.
 *
 * `detectDisruption` is the single entry point for "we caught a disruption
 * signal for this flight." The /ops panel calls it manually (a human can't
 * make a real airline cancel a flight on cue for a demo), but the function
 * itself doesn't know or care who called it — a future live AviationStack-
 * status poller would call this exact same function. Only the caller differs.
 *
 * Long-running-process caveat (same tradeoff as server/cache.ts and
 * server/domain/store.ts): this only behaves correctly under `npm run dev` /
 * `npm start` as one continuous Node process. A serverless deployment would
 * spin up fresh isolates per request and these setTimeout chains would not
 * survive between invocations. Not solved here — acceptable for a prototype.
 */
import {
  DECIDE_STEPS, ACT_STEPS, DECIDE_TOTAL, PLAY, FLOOR,
} from '@/lib/recovery';
import { confirmWindow, windowRationale } from '@/lib/confirmWindow';
import { isInternational } from '../airportDirectory';
import { revalidateOffer, type Offer } from '../suppliers';
import { altsForParty } from '../domain/altsForParty';
import { costFor, type PartyCost } from '../domain/pricing';
import { DEFAULT_PER_TRANSACTION_CAP, fetchProfile } from '../myca';
import { money } from '@/lib/time';
import * as store from '../domain/store';
import { ensureSeeded } from '../domain/seed';
import { logOutcome, logSagaStep } from '../decisionLedger';
import { planRecovery } from './planningGraph';
import type { SignalInput } from '@/lib/disruptionKind';
import { startRecoverySaga, awaitExistingSaga } from './actExecutor';
import { deriveIdempotencyKey, type PolicyInput, type RecoveryIntent } from 'zkd-shared';
import type {
  DisruptionEvent, RecoveryTask, DisruptionResolution, Flight, Booking, Step, PreAuthRecord, Passenger,
} from '../domain/types';

export type ResolveAction =
  | { kind: 'approve' }
  | { kind: 'hand-over' }
  | { kind: 'browse' }
  | { kind: 'back' }
  | { kind: 'choose'; altId: string }
  | { kind: 'swap-hotel'; hotelId: string }
  | { kind: 'swap-cab'; cabId: string };

export type RecoveryView = {
  taskId: string | null;
  flightId: string;
  detectedAt: number;
  phase: 'deciding' | 'waiting' | 'choosing' | 'acting' | 'booked' | 'handed';
  /** the real, audit-grade outcome (zkd-shared's TerminalState) — null while
   *  still in flight. `phase` is presentation; this is the source of truth. */
  terminal: import('zkd-shared').TerminalState | null;
  shown: Step[];
  secondsLeft: number;
  /** how long the window was in total, so a progress bar has a denominator */
  windowSeconds: number;
  /** what bounded it — offer expiry, check-in, or the ceiling */
  windowBoundBy: RecoveryTask['windowBoundBy'];
  partySize: number;
  chosenAltId: string;
  chosenHotelId: string;
  chosenCabId: string;
  rejectedAltIds: string[];
  owedNow: number;
  cost: PartyCost;
  note: string | null;
  resolution: DisruptionResolution | null;
};

const ZERO_COST: PartyCost = {
  partySize: 1, fare: 0, rooms: 0, hotel: 0, vehicles: 0, cab: 0, total: 0,
  currency: DEFAULT_PER_TRANSACTION_CAP.currency, cap: DEFAULT_PER_TRANSACTION_CAP.amount, overCap: false,
};

/**
 * The planning graph's classify node needs a SignalInput
 * (lib/disruptionKind.ts) — this project's disruption detection today is
 * either "the /ops console filed a cancellation" or "the flight's own
 * rescheduledToISO is set" (see domain/types.ts's Flight.rescheduledToISO:
 * "true once the carrier moves the flight"), so both real signals already
 * live on the Flight record itself rather than needing new plumbing. A
 * future live status poller would set the same field the same way.
 */
function signalFor(flight: Flight): SignalInput {
  const bookedDepartureAt = new Date(flight.depISO).getTime();
  if (flight.rescheduledToISO) {
    return {
      status: 'scheduled',
      bookedDepartureAt,
      scheduledDepartureAt: new Date(flight.rescheduledToISO).getTime(),
      delayMinutes: null,
      connectionSlackMinutes: flight.connectionSlackMinutes,
    };
  }
  return {
    status: 'cancelled',
    bookedDepartureAt,
    scheduledDepartureAt: null,
    delayMinutes: null,
    connectionSlackMinutes: flight.connectionSlackMinutes,
  };
}

/**
 * A reschedule the connection survives (task.needsRebooking === false, set
 * by the planning graph's classify node) keeps the original ticket — the
 * consented/autopiloted action is only re-timing the hotel and transfers,
 * never a new seat. 03-action-policy.md §2.1: "Opening a consent window for
 * a free hotel re-timing would be asking permission to spend nothing" — this
 * is what makes that rule real instead of aspirational.
 */
function buildResolution(kind: 'autopilot' | 'approved', task: RecoveryTask, flight: Flight): DisruptionResolution {
  if (!task.needsRebooking) {
    const shiftMinutes = flight.rescheduledToISO
      ? Math.round((new Date(flight.rescheduledToISO).getTime() - new Date(flight.depISO).getTime()) / 60_000)
      : 0;
    return { kind: 're-timed', at: Date.now(), hotelId: task.chosenHotelId, cabId: task.chosenCabId, shiftMinutes };
  }
  return { kind, at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId };
}

function isPlanIntact(flight: Flight, pre: PreAuthRecord): boolean {
  return !!(
    flight.candidates.alts.find((a) => a.id === pre.altId)?.ok
    && flight.candidates.hotels.find((h) => h.id === pre.hotelId)?.ok
    && flight.candidates.cabs.find((c) => c.id === pre.cabId)?.ok
  );
}

/**
 * The cap comes from a synchronous constant, not an awaited MyCa fetch: this
 * function runs inside setTimeout-driven state transitions, not a request
 * handler, so it cannot await. See server/myca.ts DEFAULT_PER_TRANSACTION_CAP
 * for why that is an acceptable simplification today (one mock profile for
 * every member) and what it would take to change.
 */
function costOf(flight: Flight, task: Pick<RecoveryTask, 'chosenAltId' | 'chosenHotelId' | 'chosenCabId' | 'partySize'>): PartyCost {
  return costFor(flight, task, task.partySize, DEFAULT_PER_TRANSACTION_CAP);
}

/** The single entry point for "a disruption was detected on this flight." */
export async function detectDisruption(flightId: string): Promise<DisruptionEvent | null> {
  await ensureSeeded();
  const existing = await store.getDisruptionEvent(flightId);
  if (existing) return existing;

  const flight = await store.getFlight(flightId);
  if (!flight) return null;
  // riskPct/riskBand are already computed and cached by store.createFlight() —
  // this is confirming a real disruption on a flight that was already being
  // watched, not the first time its risk is known.

  const event: DisruptionEvent = { id: `de-${flightId}`, flightId, detectedAt: Date.now(), phase: 'DECIDING' };
  await store.createDisruptionEvent(event);
  logOutcome(flightId, 'cancelled');

  const decideDelayMs = Math.max(FLOOR, DECIDE_TOTAL * PLAY);
  setTimeout(() => { void finishDecide(flightId); }, decideDelayMs);
  return event;
}

async function finishDecide(flightId: string): Promise<void> {
  const event = await store.getDisruptionEvent(flightId);
  const flight = await store.getFlight(flightId);
  if (!event || !flight) return;
  event.phase = 'READY';
  event.decidedAt = Date.now();
  // createDisruptionEvent upserts on flightId — see store.ts's header
  // comment on why re-calling the create* function is the persistence call
  // for this in-place mutation, same pattern as Flight caching below.
  await store.createDisruptionEvent(event);

  for (const booking of await store.getBookingsForFlight(flightId)) {
    void createTaskForBooking(event, flight, booking);
  }
}

async function createTaskForBooking(event: DisruptionEvent, flight: Flight, booking: Booking) {
  const passenger = await store.getPassenger(booking.passengerId);
  if (!passenger) return;
  const preAuth = await store.getPreAuth(flight.id, passenger.id);
  const planIntact = preAuth ? isPlanIntact(flight, preAuth) : false;

  const task: RecoveryTask = {
    id: await store.nextTaskId(),
    disruptionEventId: event.id,
    flightId: flight.id,
    bookingId: booking.id,
    passengerId: passenger.id,
    phase: 'waiting',
    terminal: null,
    needsRebooking: true,
    partySize: store.partySize(booking),
    windowExpiresAt: 0,
    windowBoundBy: 'floor',
    chosenAltId: '',
    chosenHotelId: '',
    chosenCabId: '',
    rejectedAltIds: [],
    shown: [...DECIDE_STEPS],
    note: null,
    resolution: null,
  };

  if (preAuth && planIntact) {
    task.chosenAltId = preAuth.altId;
    task.chosenHotelId = preAuth.hotelId;
    task.chosenCabId = preAuth.cabId;
    task.note = 'You authorised this in advance, so there was no window to wait for — we acted the moment the airline filed.';
    task.phase = 'acting';
    await store.setRecoveryTask(task);
    await scheduleAct(flight.id, passenger.id);
    return;
  }

  if (preAuth && !planIntact) {
    task.note = 'You had authorised a plan, but part of it is no longer available. We are not substituting something you never saw — over to you.';
  }

  // Layer A's read-only planning graph (server/engine/planningGraph.ts):
  // classifies the disruption, then one specialist per leg proposes a
  // candidate — carrier-owed seats first (party-aware, via altsForParty),
  // never a market alt that can't seat the whole party. A reschedule the
  // connection survives comes back with needsRebooking=false and no chosen
  // seat at all — nothing to consent to, only hotel/ground re-timing.
  const plan = await planRecovery({
    flight, partySize: task.partySize, rejectedAltIds: task.rejectedAltIds, signal: signalFor(flight),
  });
  task.needsRebooking = plan.needsRebooking;
  task.chosenAltId = plan.chosenAltId ?? '';
  task.chosenHotelId = plan.chosenHotelId ?? '';
  task.chosenCabId = plan.chosenCabId ?? '';

  // Autopilot has no one to wait for. The derived window below exists to give
  // a human enough time to notice a push, think and answer it — standing
  // consent already answered that question, so we re-validate the pick
  // against real inventory (the same check a human's explicit approve gets)
  // and act immediately, exactly like the preAuth-and-intact branch above.
  // Only 'ask' consent still needs the window that follows this block.
  if (passenger.consent === 'autopilot') {
    const cost = costOf(flight, task);
    if (cost.overCap) {
      // The per-transaction cap is the card's actual authorisation limit, not
      // a consent preference — the one rule autopilot cannot spend past.
      task.note = `This would cost ${money(cost.total)}, over your ${money(cost.cap)} single-transaction cap — so we stopped, regardless of your standing permission. Nothing was booked and nothing was charged. Your seats are still held.`;
      await store.setRecoveryTask(task);
      await finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
      return;
    }
    const switched = task.needsRebooking ? await revalidateChoice(task, flight) : null;
    task.note = switched ?? "Autopilot is your standing permission, so we went ahead the moment the airline filed — there was no one to wait for.";
    await store.setRecoveryTask(task);
    await finalizeResolution(task, buildResolution('autopilot', task, flight));
    return;
  }

  // How long they get is not a constant. It is the supplier's own guarantee on
  // the fare we are about to show them, minus the time we need to book inside
  // it — so it can be defended rather than merely chosen.
  const chosen = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  const win = confirmWindow({
    offerExpiresAt: chosen?.expiresAt ?? null,
    departureAt: new Date(flight.depISO).getTime(),
    international: isInternational(flight.from, flight.to),
  });
  task.windowBoundBy = win.boundBy;

  if (!win.askable) {
    // Too little time for a push to arrive, be noticed and be answered. Asking
    // would be theatre, so consent tier decides alone — the same rule that
    // applies when a real window runs out unanswered.
    task.windowExpiresAt = 0;
    task.note = 'There was too little time left to ask, so your standing permission decided this one.';
    await store.setRecoveryTask(task);
    void settleExpired(flight.id, passenger.id);
    return;
  }

  task.windowExpiresAt = win.expiresAt;
  task.note = windowRationale(win);
  await store.setRecoveryTask(task);
  setTimeout(() => { void settleExpired(flight.id, passenger.id); }, win.seconds * 1000);
}

/**
 * The window ran out with nobody having acted — resolves it on schedule
 * regardless of whether anyone is watching. Consent tier here is always
 * 'ask': autopilot never reaches this function — it resolves immediately in
 * createTaskForBooking, with no window to expire.
 */
async function settleExpired(flightId: string, passengerId: string) {
  const task = await store.getRecoveryTask(flightId, passengerId);
  const flight = await store.getFlight(flightId);
  const passenger = await store.getPassenger(passengerId);
  if (!task || !flight || !passenger || task.resolution || task.phase !== 'waiting') return;

  const cost = costOf(flight, task);
  let resolution: DisruptionResolution;
  // Silence means different things depending on what was asked for — but consent
  // gates SPENDING, not care. If the recovery costs nothing there is nothing to
  // consent to, and stranding someone because they didn't pick up is worse.
  if (cost.overCap) {
    task.note = `This would cost ${money(cost.total)}, over your ${money(cost.cap)} single-transaction cap — so we stopped, regardless of your standing permission. Nothing was booked and nothing was charged. Your seats are still held.`;
    resolution = { kind: 'handed-over', at: Date.now() };
  } else if (cost.total === 0) {
    const switched = task.needsRebooking ? await revalidateChoice(task, flight) : null;
    task.note = switched ?? "You didn't answer. This costs you nothing, so we booked it rather than leave you stranded — there was no spend to ask about.";
    resolution = buildResolution('autopilot', task, flight);
  } else {
    task.note = `You didn't answer, and this one would cost you ${money(cost.total)} — so we stopped. Nothing was booked and nothing was charged. Your seats are still held.`;
    resolution = { kind: 'handed-over', at: Date.now() };
  }
  await finalizeResolution(task, resolution);
}

async function finalizeResolution(task: RecoveryTask, resolution: DisruptionResolution): Promise<void> {
  if (task.resolution) { await store.setRecoveryTask(task); return; } // first wins
  task.resolution = resolution;

  if (resolution.kind === 'handed-over') {
    // Both "take the wheel" and "this would cost, and standing permission
    // doesn't cover it" land here — in both cases a feasible plan exists (or
    // existed) but a human decides next, before anything was spent. That is
    // exactly ESCALATED (03-action-policy.md §7's terminal-state table).
    task.phase = 'handed';
    task.terminal = 'ESCALATED';
    await store.setRecoveryTask(task);
    return;
  }

  // A reschedule the connection survives keeps the original ticket — only the
  // hotel and transfers move. No new seat, and nothing to consent to, and
  // nothing crosses the ACT irreversibility boundary the real saga exists to
  // guard — the existing narrated steps are an acceptable simplification for
  // this specific free, no-new-booking path.
  if (resolution.kind === 're-timed') {
    task.chosenHotelId = resolution.hotelId;
    task.chosenCabId = resolution.cabId;
    task.phase = 'acting';
    await store.setRecoveryTask(task);
    await scheduleAct(task.flightId, task.passengerId);
    return;
  }

  task.chosenAltId = resolution.altId;
  task.chosenHotelId = resolution.hotelId;
  task.chosenCabId = resolution.cabId;
  task.phase = 'acting';
  await store.setRecoveryTask(task);
  await runRecoverySaga(task.flightId, task.passengerId);
}

/**
 * `nextLeg` is passed in rather than fetched here: this is called once per
 * rendered step inside scheduleAct's run() loop, and getNextLeg is now an
 * async store read — computing it once outside the loop (in scheduleAct)
 * and threading it through avoids both an awkward async switch statement
 * and a redundant query per step.
 */
function renderActStepBody(raw: Step, task: RecoveryTask, flight: Flight, booking: Booking, nextLeg: { booking: Booking; flight: Flight } | null): string {
  const alt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  const hotel = flight.candidates.hotels.find((h) => h.id === task.chosenHotelId);
  const cab = flight.candidates.cabs.find((c) => c.id === task.chosenCabId);
  const cost = costOf(flight, task);
  const n = task.partySize;
  switch (raw.live) {
    case 'seat': {
      if (!alt) return raw.s;
      if (n <= 1) return `${alt.code} at ${alt.dep}, seat ${booking.seat}. The airline cancelled, so the fare difference is theirs — you pay nothing.`;
      const seatList = booking.seats.map((s) => s.seat).join(', ');
      return `${alt.code} at ${alt.dep}, ${n} seats — ${seatList}. The airline cancelled, so the fare difference is theirs — you pay nothing.`;
    }
    case 'van': {
      if (n <= 1) {
        return `A single-use card locked to ${cost.total ? money(cost.total) : '₹0'} and today's date — exactly the plan you were shown, and it cannot be reused or overspent.`;
      }
      // Issued one card per ticket rather than a single aggregate charge — the
      // cap was already checked against the party total before this step ever
      // runs, so splitting the charge here does not touch the cap decision.
      const per = cost.total ? money(Math.round(cost.total / n)) : '₹0';
      return `${n} single-use cards, one per ticket, each locked to ${per} and today's date — exactly the plan you were shown, and none can be reused or overspent.`;
    }
    case 'hotel': {
      if (!hotel) return raw.s;
      if (cost.rooms > 1) return `${hotel.name}, ${cost.rooms} rooms, check-in ${hotel.checkin}. ${hotel.why}.`;
      return `${hotel.name}, check-in ${hotel.checkin}. ${hotel.why}.`;
    }
    case 'cab': {
      if (!cab) return raw.s;
      const legs = flight.candidates.cabLegs;
      const vehicleLabel = cost.vehicles > 1 ? `${cost.vehicles} × ${cab.kind}` : cab.kind;
      if (legs.length >= 2) return `${vehicleLabel} booked for both legs — ${legs[0].from} → ${legs[0].to} at ${legs[0].pickup}, and back at ${legs[1].pickup}.`;
      if (legs.length === 1) return `${vehicleLabel} booked — ${legs[0].from} → ${legs[0].to} at ${legs[0].pickup}.`;
      return raw.s;
    }
    case 'onward': {
      if (!nextLeg) return raw.s;
      return `${nextLeg.flight.code} to ${nextLeg.flight.to} re-checked and still valid — a no-show on this leg can silently void the rest of an itinerary.`;
    }
    default:
      return raw.s;
  }
}

async function scheduleAct(flightId: string, passengerId: string): Promise<void> {
  const flight = await store.getFlight(flightId);
  const bookings = await store.getBookingsForFlight(flightId);
  const booking = bookings.find((b) => b.passengerId === passengerId);
  if (!flight || !booking) return;
  // Omit the "onward leg" step entirely when this passenger has no connection —
  // unlike the old single-flight version, this is no longer unconditional.
  const nextLeg = await store.getNextLeg(booking.id);
  const steps = ACT_STEPS.filter((s) => s.live !== 'onward' || nextLeg !== null);

  let i = 0;
  const run = async (): Promise<void> => {
    const task = await store.getRecoveryTask(flightId, passengerId);
    if (!task) return;
    if (i >= steps.length) { task.phase = 'booked'; task.terminal = 'CONFIRMED'; await store.setRecoveryTask(task); return; }
    const raw = steps[i];
    const rendered: Step = { ...raw, s: renderActStepBody(raw, task, flight, booking, nextLeg) };
    task.shown = [...task.shown, rendered];
    await store.setRecoveryTask(task);
    i += 1;
    setTimeout(() => { void run(); }, Math.max(FLOOR, raw.d * PLAY));
  };
  // Await only the first step: it should be visible immediately, same as
  // before. Later steps are scheduled via setTimeout and stay fire-and-forget
  // — scheduleAct's caller shouldn't block on the whole multi-step animation.
  await run();
}

const CABIN_RANK: Record<string, number> = { Economy: 0, 'Premium Economy': 1, Business: 2, First: 3 };

/**
 * ACT, for real. This is the only place in zkd-app that starts a Temporal
 * workflow — everything before it is reversible, everything from here on
 * is the real saga running in zkd-execute (see
 * documentation/architecture/execution-plane.md). Builds the
 * RecoveryIntent boundary contract (zkd-shared), starts the saga keyed by
 * an idempotency key derived from the business entity (never this run —
 * 03-action-policy.md §6), and maps the real SagaResult onto the member-
 * facing phase and the audit-grade terminal state.
 */
async function runRecoverySaga(flightId: string, passengerId: string): Promise<void> {
  const flight = await store.getFlight(flightId);
  const bookings = await store.getBookingsForFlight(flightId);
  const booking = bookings.find((b) => b.passengerId === passengerId);
  const passenger = await store.getPassenger(passengerId);
  const task = await store.getRecoveryTask(flightId, passengerId);
  if (!flight || !booking || !passenger || !task) return;

  const alt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  if (!alt) {
    // The planning graph never should have chosen an id that isn't in the
    // portfolio — if it happens anyway, this is a feasible-set-empty case,
    // not a booking to attempt.
    task.phase = 'handed';
    task.terminal = 'ESCALATED';
    task.note = 'No bookable candidate survived to the moment of booking — over to a human.';
    await store.setRecoveryTask(task);
    return;
  }

  const hotel = flight.candidates.hotels.find((h) => h.id === task.chosenHotelId) ?? null;
  const cab = flight.candidates.cabs.find((c) => c.id === task.chosenCabId) ?? null;
  const cost = costOf(flight, task);
  const profile = await fetchProfile(passenger.id);

  const idempotencyKey = deriveIdempotencyKey({
    pnr: booking.pnr, segment: flight.id, memberId: passenger.id, intent: 'recover-cancellation',
  });

  const nameParts = passenger.legalName.split(' ');
  const policyInput: PolicyInput = {
    consent: passenger.consent,
    originalFlightOperated: task.needsRebooking === false, // placeholder for the rare re-timed-but-still-charged edge case; the common re-timed path never reaches this function at all
    offerId: alt.id,
    rejectedOfferIds: task.rejectedAltIds,
    cabinRank: CABIN_RANK[alt.cabin] ?? 0,
    cabinEntitlementRank: CABIN_RANK[profile.preferences.cabinEntitlement] ?? 0,
    fareDelta: cost.total,
    fareDeltaCap: cost.cap,
    departureAtMs: new Date(flight.rescheduledToISO ?? flight.depISO).getTime(),
    // No explicit member-stated travel window exists in this build (Booking/
    // Passenger carry no such field) — defaulting to a generous 7-day window
    // rather than guessing a narrower one that could wrongly deny a real
    // recovery. Documented gap, not a silent guess: see
    // documentation/architecture/execution-plane.md.
    travelWindowStartMs: Date.now() - 24 * 3600_000,
    travelWindowEndMs: Date.now() + 7 * 24 * 3600_000,
    seatsAvailable: alt.seats,
    partySize: task.partySize,
  };

  const intent: RecoveryIntent = {
    idempotencyKey,
    pnr: booking.pnr,
    originalBookingId: booking.id,
    memberId: passenger.id,
    partySize: task.partySize,
    travellerIds: booking.travellerIds,
    passenger: {
      givenName: nameParts[0] ?? passenger.displayName,
      familyName: nameParts.slice(1).join(' ') || passenger.displayName,
      dob: passenger.dob,
      gender: passenger.gender.toLowerCase().startsWith('f') ? 'f' : 'm',
      email: passenger.contact.email,
      phoneNumber: passenger.contact.phone,
    },
    consent: passenger.consent,
    disposition: task.needsRebooking ? 'involuntary' : 'voluntary',
    flight: {
      supplier: (alt.supplier as RecoveryIntent['flight']['supplier']) ?? 'sabre',
      supplierOfferId: alt.supplierOfferId ?? alt.id,
      flightCode: alt.code,
      from: flight.from,
      to: flight.to,
      departsAtMs: new Date(flight.rescheduledToISO ?? flight.depISO).getTime(),
      cabin: alt.cabin,
      price: { amount: alt.fare, currency: alt.currency },
      expiresAtMs: alt.expiresAt,
    },
    hotel: hotel
      ? { supplierOfferId: hotel.id, name: hotel.name, checkin: hotel.checkin, rooms: cost.rooms, rate: { amount: hotel.rate, currency: hotel.currency } }
      : null,
    ground: cab
      ? {
          supplierOfferId: cab.id, kind: cab.kind, vehicles: cost.vehicles,
          legs: flight.candidates.cabLegs.map((l) => ({ from: l.from, to: l.to, pickupISO: l.pickup })),
          extra: { amount: cab.extra, currency: cab.currency },
        }
      : null,
    perTransactionCap: { amount: cost.cap, currency: cost.currency },
    policyInput,
    callbackUrl: null,
    requestedAt: Date.now(),
  };

  try {
    // A retry against the same business entity (same pnr/segment/member/
    // intent — e.g. after a transient error, or this exact request racing
    // itself) hits Temporal's own REJECT_DUPLICATE guard rather than a fresh
    // start. That is correct — it MUST NOT silently start a second real
    // booking (03-action-policy.md §6) — but the right response is to fetch
    // the ORIGINAL attempt's real outcome, not treat "already started" as a
    // failure and escalate a booking that may have already succeeded.
    let result;
    try {
      result = await startRecoverySaga(intent);
    } catch (e) {
      if (e instanceof Error && /already started/i.test(e.message)) {
        result = await awaitExistingSaga(idempotencyKey);
      } else {
        throw e;
      }
    }
    for (const step of result.steps) logSagaStep({ idempotencyKey, ...step });

    const rendered: Step[] = result.steps
      .filter((s) => s.kind === 'forward' && s.outcome === 'ok')
      .map((s) => ({ n: SAGA_STEP_LABEL[s.step] ?? s.step, d: 0, s: SAGA_STEP_LABEL[s.step] ?? s.step }));

    const refreshed = await store.getRecoveryTask(flightId, passengerId);
    if (!refreshed) return;
    refreshed.shown = [...refreshed.shown, ...rendered];
    refreshed.terminal = result.terminal;

    if (result.terminal === 'CONFIRMED') {
      refreshed.phase = 'booked';
      refreshed.note = 'Booked, for real — the saga confirmed every step and disposed the original ticket last.';
    } else {
      refreshed.phase = 'handed';
      refreshed.note = `The booking could not complete (${result.failureReason ?? 'saga failed'}) — everything that was reserved has been released. Over to a human.`;
    }
    await store.setRecoveryTask(refreshed);
  } catch (e) {
    // The execution plane itself was unreachable (Temporal down, etc.) —
    // nothing was spent, because nothing ever started. Escalate rather than
    // leave the member's task hanging in 'acting' forever.
    const refreshed = await store.getRecoveryTask(flightId, passengerId);
    if (!refreshed) return;
    refreshed.phase = 'handed';
    refreshed.terminal = 'ESCALATED';
    refreshed.note = `Could not reach the booking system (${e instanceof Error ? e.message : 'unknown error'}) — nothing was booked or charged. Over to a human.`;
    await store.setRecoveryTask(refreshed);
  }
}

const SAGA_STEP_LABEL: Record<string, string> = {
  reserveVAN: 'Payment authorised',
  bookFlight: 'Seat booked',
  bookHotel: 'Hotel moved',
  bookGround: 'Cab re-booked',
  disposeOriginal: 'Original ticket disposed',
};

/**
 * The last check before anything is spent.
 *
 * The member may have spent minutes on this screen and inventory does not wait
 * for them. Rather than shortening the window until nobody can answer it, we
 * confirm the seat is still there at the moment of spend — and if it is gone we
 * move to the next candidate that still works. What they consented to was the
 * outcome, not one specific seat.
 *
 * A candidate we cannot re-check (no supplier handle, or the supplier did not
 * answer) is left alone rather than blocked: this is a demo whose seeded
 * inventory has no real supplier behind it, and refusing to book those would
 * make the whole flow unreachable. Only a confirmed `gone` triggers a switch.
 */
async function revalidateChoice(task: RecoveryTask, flight: Flight): Promise<string | null> {
  const chosen = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  if (!chosen?.supplier || !chosen.supplierOfferId) return null;

  const asOffer = {
    id: chosen.id,
    supplier: chosen.supplier as Offer['supplier'],
    supplierOfferId: chosen.supplierOfferId,
    flightCode: chosen.code,
    from: flight.from,
    to: flight.to,
    departsAt: new Date(flight.depISO).getTime(),
    arrivesAt: new Date(flight.depISO).getTime(),
    cabin: chosen.cabin,
    seatsRemaining: chosen.seats,
    price: { amount: chosen.fare, currency: chosen.currency },
    expiresAt: chosen.expiresAt,
    live: true,
  } satisfies Offer;

  const result = await revalidateOffer(asOffer);
  if (result.state !== 'gone') return null;

  // Party-aware: cascading to a market alt that cannot seat the whole PNR
  // would silently split the party, which is exactly what altsForParty exists
  // to prevent.
  const partyAlts = altsForParty(flight.candidates.alts, task.partySize);
  const next = partyAlts.find((a) => a.ok && a.id !== chosen.id);
  if (!next) return null;

  task.rejectedAltIds = task.rejectedAltIds.includes(chosen.id)
    ? task.rejectedAltIds
    : [...task.rejectedAltIds, chosen.id];
  task.chosenAltId = next.id;
  return `${chosen.code} went while you were deciding, so we booked ${next.code} instead — it still keeps your trip together.`;
}

/** Member actions — approve / hand over / browse alternatives / choose / swap / go back. */
export async function resolveTask(
  flightId: string,
  passengerId: string,
  action: ResolveAction,
): Promise<RecoveryTask | null> {
  const task = await store.getRecoveryTask(flightId, passengerId);
  if (!task) return null;
  if (task.resolution) return task; // already resolved — no further action changes anything

  switch (action.kind) {
    case 'browse':
      task.phase = 'choosing';
      task.note = 'You stepped in, so the clock is held. Nothing proceeds while you are deciding.';
      break;
    case 'back':
      task.phase = 'waiting';
      break;
    case 'choose': {
      // Reject server-side, not just in the UI: "we will not split your
      // party across flights" is a system guarantee, not a rendering choice.
      const flight = await store.getFlight(flightId);
      const picked = flight && altsForParty(flight.candidates.alts, task.partySize).find((a) => a.id === action.altId);
      if (!picked?.fitsParty) {
        task.note = picked?.why ?? 'That option is no longer available.';
        break;
      }
      if (task.chosenAltId !== action.altId && task.chosenAltId) {
        task.rejectedAltIds = task.rejectedAltIds.includes(task.chosenAltId)
          ? task.rejectedAltIds
          : [...task.rejectedAltIds, task.chosenAltId];
      }
      task.chosenAltId = action.altId;
      task.note = 'Swapped. The one we had picked is now permanently excluded — it can never be re-proposed.';
      task.phase = 'waiting';
      break;
    }
    case 'swap-hotel': {
      const flight = await store.getFlight(flightId);
      const hotel = flight?.candidates.hotels.find((h) => h.id === action.hotelId);
      task.chosenHotelId = action.hotelId;
      task.note = hotel ? `Room swapped to ${hotel.name}.` : task.note;
      break;
    }
    case 'swap-cab': {
      const flight = await store.getFlight(flightId);
      const cab = flight?.candidates.cabs.find((c) => c.id === action.cabId);
      task.chosenCabId = action.cabId;
      task.note = cab ? `Cab swapped to ${cab.kind}.` : task.note;
      break;
    }
    case 'approve': {
      const flight = await store.getFlight(flightId);
      if (!flight) return task;

      // The cap is the card's actual authorisation limit, not a consent
      // preference — it has to hold whether the member clicked approve or
      // stayed silent. Checking it only in the silent-timeout path would let
      // an explicit click spend past what the card can actually authorise.
      const preApproveCost = costOf(flight, task);
      if (preApproveCost.overCap) {
        task.note = `This would cost ${money(preApproveCost.total)}, over your ${money(preApproveCost.cap)} single-transaction cap — so we could not go ahead. Nothing was booked and nothing was charged. Your seats are still held.`;
        await finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
        return (await store.getRecoveryTask(flightId, passengerId)) ?? task;
      }

      const switched = task.needsRebooking ? await revalidateChoice(task, flight) : null;
      task.note = switched ?? 'You approved it, so we went straight through.';
      await finalizeResolution(task, buildResolution('approved', task, flight));
      return (await store.getRecoveryTask(flightId, passengerId)) ?? task;
    }
    case 'hand-over': {
      task.note = 'You took the wheel. We stopped immediately — nothing confirmed, nothing paid, and your held seats stay held.';
      await finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
      return (await store.getRecoveryTask(flightId, passengerId)) ?? task;
    }
  }
  await store.setRecoveryTask(task);
  return task;
}

/** Assembles the response shape a passenger's device polls — everything app/recovery/[id]/page.tsx needs to render, computed here, not on the client. */
export async function getRecoveryView(flightId: string, passengerId: string): Promise<RecoveryView | null> {
  await ensureSeeded();
  const event = await store.getDisruptionEvent(flightId);
  if (!event) return null;
  const flight = await store.getFlight(flightId);
  if (!flight) return null;

  if (event.phase === 'DECIDING') {
    return {
      taskId: null, flightId, detectedAt: event.detectedAt, phase: 'deciding', terminal: null,
      shown: [], secondsLeft: 0, windowSeconds: 0, windowBoundBy: 'ceiling', partySize: 1,
      chosenAltId: '', chosenHotelId: '', chosenCabId: '', rejectedAltIds: [],
      owedNow: 0, cost: ZERO_COST, note: null, resolution: null,
    };
  }

  const task = await store.getRecoveryTask(flightId, passengerId);
  if (!task) return null; // this passenger has no booking on this flight

  const secondsLeft = task.phase === 'waiting'
    ? Math.max(0, Math.ceil((task.windowExpiresAt - Date.now()) / 1000))
    : 0;
  const windowSeconds = task.windowExpiresAt
    ? Math.max(1, Math.round((task.windowExpiresAt - event.detectedAt) / 1000))
    : 0;
  const cost = costOf(flight, task);

  return {
    taskId: task.id, flightId, detectedAt: event.detectedAt, phase: task.phase, terminal: task.terminal,
    shown: task.shown, secondsLeft, windowSeconds, windowBoundBy: task.windowBoundBy, partySize: task.partySize,
    chosenAltId: task.chosenAltId, chosenHotelId: task.chosenHotelId, chosenCabId: task.chosenCabId,
    rejectedAltIds: task.rejectedAltIds,
    owedNow: cost.total, cost, note: task.note, resolution: task.resolution,
  };
}
