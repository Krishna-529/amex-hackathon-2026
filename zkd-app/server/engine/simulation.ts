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
import { DEFAULT_PER_TRANSACTION_CAP } from '../myca';
import { money } from '@/lib/time';
import * as store from '../domain/store';
import { ensureSeeded } from '../domain/seed';
import type {
  DisruptionEvent, RecoveryTask, DisruptionResolution, Flight, Booking, Step, PreAuthRecord,
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
export function detectDisruption(flightId: string): DisruptionEvent | null {
  ensureSeeded();
  const existing = store.getDisruptionEvent(flightId);
  if (existing) return existing;

  const flight = store.getFlight(flightId);
  if (!flight) return null;
  // riskPct/riskBand are already computed and cached by store.createFlight() —
  // this is confirming a real disruption on a flight that was already being
  // watched, not the first time its risk is known.

  const event: DisruptionEvent = { id: `de-${flightId}`, flightId, detectedAt: Date.now(), phase: 'DECIDING' };
  store.createDisruptionEvent(event);

  const decideDelayMs = Math.max(FLOOR, DECIDE_TOTAL * PLAY);
  setTimeout(() => finishDecide(flightId), decideDelayMs);
  return event;
}

function finishDecide(flightId: string) {
  const event = store.getDisruptionEvent(flightId);
  const flight = store.getFlight(flightId);
  if (!event || !flight) return;
  event.phase = 'READY';
  event.decidedAt = Date.now();

  for (const booking of store.getBookingsForFlight(flightId)) {
    void createTaskForBooking(event, flight, booking);
  }
}

async function createTaskForBooking(event: DisruptionEvent, flight: Flight, booking: Booking) {
  const passenger = store.getPassenger(booking.passengerId);
  if (!passenger) return;
  const preAuth = store.getPreAuth(flight.id, passenger.id);
  const planIntact = preAuth ? isPlanIntact(flight, preAuth) : false;

  const task: RecoveryTask = {
    id: store.nextTaskId(),
    disruptionEventId: event.id,
    flightId: flight.id,
    bookingId: booking.id,
    passengerId: passenger.id,
    phase: 'waiting',
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
    store.setRecoveryTask(task);
    scheduleAct(flight.id, passenger.id);
    return;
  }

  if (preAuth && !planIntact) {
    task.note = 'You had authorised a plan, but part of it is no longer available. We are not substituting something you never saw — over to you.';
  }

  // Party-aware default: prefer what the carrier owes the whole party over a
  // market seat we would have to buy, and never default to a market alt that
  // cannot actually seat everyone on this PNR.
  const partyAlts = altsForParty(flight.candidates.alts, task.partySize);
  const defaultAlt = partyAlts.find((a) => a.kind === 'carrier-protected' && a.ok)
    ?? partyAlts.find((a) => a.ok)
    ?? partyAlts[0];
  task.chosenAltId = defaultAlt?.id ?? '';
  task.chosenHotelId = flight.candidates.hotels[0]?.id ?? '';
  task.chosenCabId = flight.candidates.cabs[0]?.id ?? '';

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
      store.setRecoveryTask(task);
      finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
      return;
    }
    const switched = await revalidateChoice(task, flight);
    task.note = switched ?? "Autopilot is your standing permission, so we went ahead the moment the airline filed — there was no one to wait for.";
    store.setRecoveryTask(task);
    finalizeResolution(task, {
      kind: 'autopilot', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId,
    });
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
    store.setRecoveryTask(task);
    void settleExpired(flight.id, passenger.id);
    return;
  }

  task.windowExpiresAt = win.expiresAt;
  task.note = windowRationale(win);
  store.setRecoveryTask(task);
  setTimeout(() => { void settleExpired(flight.id, passenger.id); }, win.seconds * 1000);
}

/**
 * The window ran out with nobody having acted — resolves it on schedule
 * regardless of whether anyone is watching. Consent tier here is always
 * 'ask': autopilot never reaches this function — it resolves immediately in
 * createTaskForBooking, with no window to expire.
 */
async function settleExpired(flightId: string, passengerId: string) {
  const task = store.getRecoveryTask(flightId, passengerId);
  const flight = store.getFlight(flightId);
  const passenger = store.getPassenger(passengerId);
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
    const switched = await revalidateChoice(task, flight);
    task.note = switched ?? "You didn't answer. This costs you nothing, so we booked it rather than leave you stranded — there was no spend to ask about.";
    resolution = { kind: 'autopilot', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId };
  } else {
    task.note = `You didn't answer, and this one would cost you ${money(cost.total)} — so we stopped. Nothing was booked and nothing was charged. Your seats are still held.`;
    resolution = { kind: 'handed-over', at: Date.now() };
  }
  finalizeResolution(task, resolution);
}

function finalizeResolution(task: RecoveryTask, resolution: DisruptionResolution) {
  if (task.resolution) { store.setRecoveryTask(task); return; } // first wins
  task.resolution = resolution;

  if (resolution.kind === 'handed-over') {
    task.phase = 'handed';
    store.setRecoveryTask(task);
    return;
  }

  // A reschedule the connection survives keeps the original ticket — only the
  // hotel and transfers move. No new seat, and nothing to consent to.
  if (resolution.kind === 're-timed') {
    task.chosenHotelId = resolution.hotelId;
    task.chosenCabId = resolution.cabId;
    task.phase = 'acting';
    store.setRecoveryTask(task);
    scheduleAct(task.flightId, task.passengerId);
    return;
  }

  task.chosenAltId = resolution.altId;
  task.chosenHotelId = resolution.hotelId;
  task.chosenCabId = resolution.cabId;
  task.phase = 'acting';
  store.setRecoveryTask(task);
  scheduleAct(task.flightId, task.passengerId);
}

function renderActStepBody(raw: Step, task: RecoveryTask, flight: Flight, booking: Booking): string {
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
      const next = store.getNextLeg(booking.id);
      if (!next) return raw.s;
      return `${next.flight.code} to ${next.flight.to} re-checked and still valid — a no-show on this leg can silently void the rest of an itinerary.`;
    }
    default:
      return raw.s;
  }
}

function scheduleAct(flightId: string, passengerId: string) {
  const flight = store.getFlight(flightId);
  const booking = store.getBookingsForFlight(flightId).find((b) => b.passengerId === passengerId);
  if (!flight || !booking) return;
  // Omit the "onward leg" step entirely when this passenger has no connection —
  // unlike the old single-flight version, this is no longer unconditional.
  const steps = ACT_STEPS.filter((s) => s.live !== 'onward' || store.getNextLeg(booking.id) !== null);

  let i = 0;
  const run = () => {
    const task = store.getRecoveryTask(flightId, passengerId);
    if (!task) return;
    if (i >= steps.length) { task.phase = 'booked'; store.setRecoveryTask(task); return; }
    const raw = steps[i];
    const rendered: Step = { ...raw, s: renderActStepBody(raw, task, flight, booking) };
    task.shown = [...task.shown, rendered];
    store.setRecoveryTask(task);
    i += 1;
    setTimeout(run, Math.max(FLOOR, raw.d * PLAY));
  };
  run();
}

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
  const task = store.getRecoveryTask(flightId, passengerId);
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
      const flight = store.getFlight(flightId);
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
      const flight = store.getFlight(flightId);
      const hotel = flight?.candidates.hotels.find((h) => h.id === action.hotelId);
      task.chosenHotelId = action.hotelId;
      task.note = hotel ? `Room swapped to ${hotel.name}.` : task.note;
      break;
    }
    case 'swap-cab': {
      const flight = store.getFlight(flightId);
      const cab = flight?.candidates.cabs.find((c) => c.id === action.cabId);
      task.chosenCabId = action.cabId;
      task.note = cab ? `Cab swapped to ${cab.kind}.` : task.note;
      break;
    }
    case 'approve': {
      const flight = store.getFlight(flightId);
      if (!flight) return task;

      // The cap is the card's actual authorisation limit, not a consent
      // preference — it has to hold whether the member clicked approve or
      // stayed silent. Checking it only in the silent-timeout path would let
      // an explicit click spend past what the card can actually authorise.
      const preApproveCost = costOf(flight, task);
      if (preApproveCost.overCap) {
        task.note = `This would cost ${money(preApproveCost.total)}, over your ${money(preApproveCost.cap)} single-transaction cap — so we could not go ahead. Nothing was booked and nothing was charged. Your seats are still held.`;
        finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
        return store.getRecoveryTask(flightId, passengerId) ?? task;
      }

      const switched = await revalidateChoice(task, flight);
      task.note = switched ?? 'You approved it, so we went straight through.';
      finalizeResolution(task, { kind: 'approved', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId });
      return store.getRecoveryTask(flightId, passengerId) ?? task;
    }
    case 'hand-over': {
      task.note = 'You took the wheel. We stopped immediately — nothing confirmed, nothing paid, and your held seats stay held.';
      finalizeResolution(task, { kind: 'handed-over', at: Date.now() });
      return store.getRecoveryTask(flightId, passengerId) ?? task;
    }
  }
  store.setRecoveryTask(task);
  return task;
}

/** Assembles the response shape a passenger's device polls — everything app/recovery/[id]/page.tsx needs to render, computed here, not on the client. */
export function getRecoveryView(flightId: string, passengerId: string): RecoveryView | null {
  ensureSeeded();
  const event = store.getDisruptionEvent(flightId);
  if (!event) return null;
  const flight = store.getFlight(flightId);
  if (!flight) return null;

  if (event.phase === 'DECIDING') {
    return {
      taskId: null, flightId, detectedAt: event.detectedAt, phase: 'deciding',
      shown: [], secondsLeft: 0, windowSeconds: 0, windowBoundBy: 'ceiling', partySize: 1,
      chosenAltId: '', chosenHotelId: '', chosenCabId: '', rejectedAltIds: [],
      owedNow: 0, cost: ZERO_COST, note: null, resolution: null,
    };
  }

  const task = store.getRecoveryTask(flightId, passengerId);
  if (!task) return null; // this passenger has no booking on this flight

  const secondsLeft = task.phase === 'waiting'
    ? Math.max(0, Math.ceil((task.windowExpiresAt - Date.now()) / 1000))
    : 0;
  const windowSeconds = task.windowExpiresAt
    ? Math.max(1, Math.round((task.windowExpiresAt - event.detectedAt) / 1000))
    : 0;
  const cost = costOf(flight, task);

  return {
    taskId: task.id, flightId, detectedAt: event.detectedAt, phase: task.phase,
    shown: task.shown, secondsLeft, windowSeconds, windowBoundBy: task.windowBoundBy, partySize: task.partySize,
    chosenAltId: task.chosenAltId, chosenHotelId: task.chosenHotelId, chosenCabId: task.chosenCabId,
    rejectedAltIds: task.rejectedAltIds,
    owedNow: cost.total, cost, note: task.note, resolution: task.resolution,
  };
}
