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
// ACT_STEPS is deliberately no longer imported: the act path is real work now,
// narrated by server/pipeline/narrate.ts. Those constants remain exported from
// lib/recovery.ts as the declared latency BUDGET the pipeline is measured
// against — see the note at the top of that file.
import { DECIDE_STEPS, DECIDE_TOTAL, PLAY, FLOOR } from '@/lib/recovery';
import { confirmWindow, windowRationale } from '@/lib/confirmWindow';
import { isInternational } from '../airportDirectory';
import { revalidateOffer, type Offer } from '../suppliers';
import { altsForParty } from '../domain/altsForParty';
import { costFor, type PartyCost } from '../domain/pricing';
import { money } from '@/lib/time';
import { dispatch } from '../notify';
import { cancelledAlert, aboutToBookAlert } from '../notify/templates';
import { estimateRefund } from '../domain/refund';
import * as store from '../domain/store';
import { ensureSeeded } from '../domain/seed';
import { resolveConsent } from '../preferences/journeyPrefs';
import * as pipeline from '../pipeline';
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
  chosenHotelId: string | null;
  chosenCabId: string | null;
  rejectedAltIds: string[];
  owedNow: number;
  cost: PartyCost;
  note: string | null;
  resolution: DisruptionResolution | null;
  /**
   * Additive, so every existing consumer keeps compiling and rendering.
   * Rides inside this view rather than on a fourth endpoint: the recovery page
   * already polls this at 1500ms, and a separate poll would be a second request
   * per member per 1.5s for data this one can carry.
   */
  pipeline: ReturnType<typeof pipelineSummary> | null;
  /** measured, unlike the ACT_TOTAL/MACHINE_TOTAL budget constants the UI shows beside them */
  timings: { decideSeconds: number; actSeconds: number };
};

/** Indirection so RecoveryView can name the summary type without a circular import. */
function pipelineSummary(flightId: string, passengerId: string) {
  return pipeline.summaryFor(flightId, passengerId);
}

/**
 * What every candidate has been converted into for display and comparison.
 *
 * A constant rather than an awaited MyCa read for the same reason `costOf`
 * below is synchronous: this module runs inside setTimeout-driven state
 * transitions, not request handlers. One mock profile serves every member
 * today, so a constant and a lookup would return the same string.
 */
const BILLING_CURRENCY = 'INR';

const ZERO_COST: PartyCost = {
  partySize: 1, fare: 0, rooms: 0, hotel: 0, vehicles: 0, cab: 0, total: 0,
  currency: BILLING_CURRENCY,
};

function isPlanIntact(flight: Flight, pre: PreAuthRecord): boolean {
  return !!(
    flight.candidates.alts.find((a) => a.id === pre.altId)?.ok
    && flight.candidates.hotels.find((h) => h.id === pre.hotelId)?.ok
    && flight.candidates.cabs.find((c) => c.id === pre.cabId)?.ok
  );
}

/**
 * The billing currency comes from a synchronous constant, not an awaited MyCa
 * fetch: this function runs inside setTimeout-driven state transitions, not a
 * request handler, so it cannot await. Acceptable today because there is one
 * mock profile for every member.
 */
function costOf(flight: Flight, task: Pick<RecoveryTask, 'chosenAltId' | 'chosenHotelId' | 'chosenCabId' | 'partySize'>): PartyCost {
  return costFor(flight, task, task.partySize, BILLING_CURRENCY);
}

/**
 * Who a detection is allowed to act for.
 *
 * Normally everybody on the flight — a carrier cancelling does not cancel it
 * for one passenger. The exception is an UNCORROBORATED member report
 * (server/engine/memberReports.ts): one person saying they are stranded is
 * enough for us to start their own recovery and nowhere near enough to start
 * spending on everyone else's card. Restricting the fan-out is how that
 * asymmetry is enforced, rather than by trusting each call site to remember it.
 *
 * Kept in process memory next to the other simulation state, and read by
 * `finishDecide` after its timer fires.
 */
const restrictedTo = new Map<string, string>();

/**
 * The single entry point for "a disruption was detected on this flight."
 *
 * Async now that the store is Postgres-backed — every caller (the POST
 * /api/disruptions route, the ops console behind it, the status poller, and a
 * corroborated member report) awaits this.
 */
export async function detectDisruption(
  flightId: string,
  opts: { onlyForPassengerId?: string } = {},
): Promise<DisruptionEvent | null> {
  await ensureSeeded();
  const existing = await store.getDisruptionEvent(flightId);
  if (existing) return existing;

  const flight = await store.getFlight(flightId);
  if (!flight) return null;
  // riskPct/riskBand are already computed and cached by store.createFlight() —
  // this is confirming a real disruption on a flight that was already being
  // watched, not the first time its risk is known.

  if (opts.onlyForPassengerId) restrictedTo.set(flightId, opts.onlyForPassengerId);
  else restrictedTo.delete(flightId);

  const event: DisruptionEvent = { id: `de-${flightId}`, flightId, detectedAt: Date.now(), phase: 'DECIDING' };
  await store.createDisruptionEvent(event);

  // Start the real search immediately, racing the decide timer below rather
  // than waiting for it. onDisruptionDetected is synchronous and never throws
  // (see its own module header) — it is void-called and catches everything
  // internally, so nothing in there may take this route down with it.
  pipeline.onDisruptionDetected(flightId);

  const decideDelayMs = Math.max(FLOOR, DECIDE_TOTAL * PLAY);
  setTimeout(() => { void finishDecide(flightId); }, decideDelayMs);
  return event;
}

async function finishDecide(flightId: string) {
  const event = await store.getDisruptionEvent(flightId);
  const flight = await store.getFlight(flightId);
  if (!event || !flight) return;
  event.phase = 'READY';
  event.decidedAt = Date.now();
  await store.createDisruptionEvent(event);

  const only = restrictedTo.get(flightId);
  const bookings = (await store.getBookingsForFlight(flightId))
    .filter((b) => !only || b.passengerId === only);
  for (const booking of bookings) {
    void createTaskForBooking(event, flight, booking);
  }
}

/**
 * Lift a restriction and run the recovery for everyone still waiting.
 *
 * Called when a member report that started as one person's word is later
 * corroborated — by other passengers, by the carrier's own feed, or by an
 * operator. The passengers already handled are skipped by
 * `createTaskForBooking`'s own idempotence, so this is safe to call more than
 * once for the same flight.
 */
export async function widenDetection(flightId: string): Promise<void> {
  restrictedTo.delete(flightId);
  const event = await store.getDisruptionEvent(flightId);
  const flight = await store.getFlight(flightId);
  if (!event || !flight) return;
  if (event.phase === 'DECIDING') return; // finishDecide will fan out on its own

  for (const booking of await store.getBookingsForFlight(flightId)) {
    if (await store.getRecoveryTask(flightId, booking.passengerId)) continue;
    void createTaskForBooking(event, flight, booking);
  }
}

async function createTaskForBooking(event: DisruptionEvent, flight: Flight, booking: Booking) {
  const passenger = await store.getPassenger(booking.passengerId);
  if (!passenger) return;

  // ── Rung 2 of the notification ladder ────────────────────────────────────
  //
  // Fired here rather than after the plan is chosen, and deliberately not
  // awaited. The member finding out from us before they find out from a
  // departure board is most of the product's felt value, and it must not wait
  // on a supplier search — nor may a dead notification channel delay a
  // recovery. `dispatch` cannot reject by construction (server/notify/index.ts).
  const partyAltsNow = altsForParty(flight.candidates.alts, store.partySize(booking));
  const leader = partyAltsNow.find((a) => a.ok);
  void dispatch(
    cancelledAlert({
      flightId: flight.id,
      passengerId: passenger.id,
      code: flight.code,
      from: flight.from,
      to: flight.to,
      optionCount: partyAltsNow.filter((a) => a.ok).length,
      topOption: leader ? { code: leader.code, arr: leader.arr } : null,
    }),
  );

  const preAuth = await store.getPreAuth(flight.id, passenger.id);
  const planIntact = preAuth ? isPlanIntact(flight, preAuth) : false;

  // The consent that governs THIS flight: the member's per-flight override if
  // they set one before departure, otherwise their standing profile consent.
  // This is the human-in-the-loop-vs-autonomous choice — a member on global
  // autopilot can ask to be consulted for one important flight, and vice versa.
  const journeyPrefs = await store.getJourneyPrefs(flight.id, passenger.id);
  const consent = resolveConsent(passenger.consent, journeyPrefs?.consent);

  const task: RecoveryTask = {
    id: await store.nextTaskId(),
    disruptionEventId: event.id,
    flightId: flight.id,
    bookingId: booking.id,
    passengerId: passenger.id,
    phase: 'waiting',
    // No execution-plane integration in this branch (see the field's own
    // comment in domain/types.ts) — always null here, same as every other
    // consumer of this type today.
    terminal: null,
    // This pipeline always proposes a new alt by default (see chosenAltId
    // below) — the 're-timed, no new seat' case is a resolution *kind* that
    // can still be chosen later (finalizeResolution), not a starting state.
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
    // Pre-authorisation IS consent, given earlier and for exactly this plan, so
    // this crosses the gate straight away. `task.resolution` is deliberately
    // left as it was — this branch has never set it, and changing that here
    // would alter what every existing consumer sees for pre-authorised
    // recoveries, which is not this change's business.
    void pipeline.execute(task, {
      kind: 'approved',
      at: Date.now(),
      altId: preAuth.altId,
      hotelId: preAuth.hotelId,
      cabId: preAuth.cabId,
    });
    return;
  }

  if (preAuth && !planIntact) {
    task.note = 'You had authorised a plan, but part of it is no longer available. We are not substituting something you never saw — over to you.';
  }

  // Party-aware default: prefer what the carrier owes the whole party over a
  // market seat we would have to buy, and never default to a market alt that
  // cannot actually seat everyone on this PNR.
  const partyAlts = altsForParty(flight.candidates.alts, task.partySize);

  // Prefer what the pipeline actually scored, if it has finished. It reads
  // synchronously and returns null when it has not — so a slow supplier delays
  // nothing and the heuristic below still decides. The pipeline's answer is
  // strictly better informed (it applied the member's hard rules and their
  // optimisation strategy), but it is never allowed to be a blocker.
  const preferred = pipeline.preferredPlan(flight.id, passenger.id);
  const preferredAlt = preferred
    ? partyAlts.find((a) => a.id === preferred.altId && a.ok)
    : undefined;

  // The carrier-protected fallback that used to sit between these two lines is
  // gone with the kind itself (2026-08-19). It made autopilot's default pick a
  // fabricated row — the one option nobody had confirmed existed. The fallback
  // is now simply the first genuinely bookable alternative.
  const defaultAlt = preferredAlt
    ?? partyAlts.find((a) => a.ok)
    ?? partyAlts[0];
  task.chosenAltId = defaultAlt?.id ?? '';
  task.chosenHotelId = preferred?.hotelId || flight.candidates.hotels[0]?.id || '';
  task.chosenCabId = preferred?.cabId || flight.candidates.cabs[0]?.id || '';

  // Autopilot has no one to wait for. The derived window below exists to give
  // a human enough time to notice a push, think and answer it — standing
  // consent already answered that question, so we re-validate the pick
  // against real inventory (the same check a human's explicit approve gets)
  // and act immediately, exactly like the preAuth-and-intact branch above.
  // Only 'ask' consent still needs the window that follows this block.
  if (consent === 'autopilot') {
    const switched = await revalidateChoice(task, flight);
    task.note = switched ?? "Autopilot is your standing permission, so we went ahead the moment the airline filed — there was no one to wait for.";
    await store.setRecoveryTask(task);
    await finalizeResolution(task, {
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
    await store.setRecoveryTask(task);
    void settleExpired(flight.id, passenger.id);
    return;
  }

  task.windowExpiresAt = win.expiresAt;
  task.note = windowRationale(win);
  await store.setRecoveryTask(task);

  // ── Rung 3: the message that replaced the spend ceiling ──────────────────
  //
  // This is the last point at which a member can stop a charge, so it states
  // the exact amount and the exact deadline. The figure quoted is the DELTA
  // after the expected refund on their original ticket, not the gross fare —
  // announcing ₹18,000 when ₹14,000 of it is coming straight back would be
  // true and misleading, and this message only works if it is neither.
  //
  // Not awaited, for the same reason as rung 2: the window is already running
  // and a slow provider must not eat into the member's thinking time.
  const spend = costOf(flight, task);
  const chosenAlt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  const refund = estimateRefund({
    flight, booking, cancelledBy: 'carrier', delayHours: 24,
  });
  const delta = spend.total - (refund.known && refund.currency === spend.currency ? refund.total : 0);
  void dispatch(
    aboutToBookAlert({
      flightId: flight.id,
      passengerId: passenger.id,
      code: flight.code,
      altCode: chosenAlt?.code ?? 'the best option we found',
      altArrives: chosenAlt?.arr ?? '—',
      deltaDisplay: money(Math.max(0, delta)),
      free: delta <= 0,
      minutes: Math.max(1, Math.round(win.seconds / 60)),
    }),
  );

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

  // ── Silence now proceeds, and that is a deliberate reversal ──────────────
  //
  // This branch used to stop whenever a recovery cost the member anything: no
  // answer plus a price meant hand over. The reasoning was sound while there
  // was a spend ceiling behind it, and it produced the wrong outcome anyway —
  // the member most likely to miss a notification is the one already on a
  // plane, in a queue, or asleep, and "we stopped because you didn't reply" is
  // of no use to someone stranded at 1 a.m.
  //
  // What replaced it is not silence-equals-consent. It is a ladder: the member
  // is told the risk crossed, told the moment it cancelled, and told exactly
  // what is about to be spent with a window to stop it, before anything is
  // charged (server/notify/templates.ts). Proceeding is the last rung, not the
  // first. This matches the frozen canon's Tier A mechanics — notify, quiet
  // window, proceed if silent.
  //
  // The load-bearing assumption is that the alerts ACTUALLY ARRIVE. That makes
  // an undeliverable channel a genuine safety defect rather than a cosmetic
  // one, which is why dispatch results are written to the decision ledger and
  // surfaced on /ops.
  const switched = await revalidateChoice(task, flight);
  task.note = switched ?? (cost.total === 0
    ? "You didn't answer. This costs you nothing, so we booked it rather than leave you stranded."
    : `You didn't answer, so we went ahead with the plan we showed you — ${money(cost.total)}, charged to your Amex. Nothing was booked until this window closed.`);
  await finalizeResolution(task, {
    kind: 'autopilot', at: Date.now(),
    altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId,
  });
}

async function finalizeResolution(task: RecoveryTask, resolution: DisruptionResolution) {
  if (task.resolution) { await store.setRecoveryTask(task); return; } // first wins
  task.resolution = resolution;

  if (resolution.kind === 'handed-over') {
    task.phase = 'handed';
    await store.setRecoveryTask(task);
    return;
  }

  // A reschedule the connection survives keeps the original ticket — only the
  // hotel and transfers move. No new seat, and nothing to consent to.
  if (resolution.kind === 're-timed') {
    task.chosenHotelId = resolution.hotelId;
    task.chosenCabId = resolution.cabId;
    task.phase = 'acting';
    await store.setRecoveryTask(task);
    void pipeline.execute(task, resolution);
    return;
  }

  task.chosenAltId = resolution.altId;
  task.chosenHotelId = resolution.hotelId;
  task.chosenCabId = resolution.cabId;
  task.phase = 'acting';
  await store.setRecoveryTask(task);
  // The act path is the pipeline's now. `phase = 'acting'` is still set here
  // and immediately before, so the UI's transition is unchanged; what differs
  // is that the steps which follow are real work rather than a scripted reveal.
  void pipeline.execute(task, resolution);
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

      const switched = await revalidateChoice(task, flight);
      task.note = switched ?? 'You approved it, so we went straight through.';
      await finalizeResolution(task, { kind: 'approved', at: Date.now(), altId: task.chosenAltId, hotelId: task.chosenHotelId, cabId: task.chosenCabId });
      return (await store.getRecoveryTask(flightId, passengerId)) ?? task;
    }
    case 'hand-over': {
      task.note = 'You took the wheel. We stopped immediately — nothing confirmed, nothing paid, and your original booking is untouched.';
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
      taskId: null, flightId, detectedAt: event.detectedAt, phase: 'deciding',
      shown: [], secondsLeft: 0, windowSeconds: 0, windowBoundBy: 'ceiling', partySize: 1,
      chosenAltId: '', chosenHotelId: '', chosenCabId: '', rejectedAltIds: [],
      owedNow: 0, cost: ZERO_COST, note: null, resolution: null,
      pipeline: pipelineSummary(flightId, passengerId),
      timings: { decideSeconds: 0, actSeconds: 0 },
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
  const summary = pipelineSummary(flightId, passengerId);

  return {
    taskId: task.id, flightId, detectedAt: event.detectedAt, phase: task.phase,
    shown: task.shown, secondsLeft, windowSeconds, windowBoundBy: task.windowBoundBy, partySize: task.partySize,
    chosenAltId: task.chosenAltId, chosenHotelId: task.chosenHotelId, chosenCabId: task.chosenCabId,
    rejectedAltIds: task.rejectedAltIds,
    owedNow: cost.total, cost, note: task.note, resolution: task.resolution,
    pipeline: summary,
    timings: summary?.timings ?? { decideSeconds: 0, actSeconds: 0 },
  };
}
