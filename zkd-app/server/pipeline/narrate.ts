/**
 * What the member reads on each step of the timeline.
 *
 * Moved here from `renderActStepBody` in server/engine/simulation.ts, wording
 * intact. The party-aware branches — listing every seat, one single-use card
 * per ticket, room and vehicle counts from `costFor`, both cab legs — are the
 * best-considered part of that file and there was no reason to rewrite them
 * just because the machinery underneath them became real.
 *
 * Two changes only, both forced by the move:
 *
 *   The switch keys on the saga's own step names rather than `Step.live`, since
 *   the scripted steps that carried that discriminator are retired.
 *
 *   There is no `raw.s` to fall back to, because there is no longer a canned
 *   sentence behind each row. Where the old code returned the scripted string,
 *   this returns a plain statement of what happened instead — which is the
 *   honest replacement, not a shorter one.
 */

import { money } from '@/lib/time';
import { costFor } from '../domain/pricing';
import type { Booking, Flight, RecoveryTask } from '../domain/types';
import type { SagaStepName } from './saga';

export type NarrationContext = {
  flight: Flight;
  task: RecoveryTask;
  booking: Booking;
  cap: { amount: number; currency: string };
  /** true when nothing was actually mutated — the member is owed that fact */
  intentOnly: boolean;
  /**
   * Looked up once by execute() before the saga runs, not here — this
   * function is called synchronously as each saga step completes and the
   * store is now async, so the lookup can't happen inline any more.
   */
  nextLeg: { code: string; to: string } | null;
};

export function narrate(step: SagaStepName, ctx: NarrationContext): string {
  const { flight, task, booking, cap } = ctx;
  const alt = flight.candidates.alts.find((a) => a.id === task.chosenAltId);
  const hotel = flight.candidates.hotels.find((h) => h.id === task.chosenHotelId);
  const cab = flight.candidates.cabs.find((c) => c.id === task.chosenCabId);
  const cost = costFor(flight, task, task.partySize, cap);
  const n = task.partySize;

  switch (step) {
    case 'revalidate': {
      if (!alt) return 'Re-checked the chosen option immediately before committing anything.';
      return `${alt.code} re-checked with the supplier just now — still there, still at the price you were shown. This is the last check before anything is spent.`;
    }

    case 'authorise': {
      if (n <= 1) {
        return `A single-use card locked to ${cost.total ? money(cost.total) : '₹0'} and today's date — exactly the plan you were shown, and it cannot be reused or overspent.`;
      }
      // One card per ticket rather than one aggregate charge. The cap was
      // already checked against the party total before this step ran, so
      // splitting the charge here does not touch the cap decision.
      const per = cost.total ? money(Math.round(cost.total / n)) : '₹0';
      return `${n} single-use cards, one per ticket, each locked to ${per} and today's date — exactly the plan you were shown, and none can be reused or overspent.`;
    }

    case 'flight': {
      if (!alt) return 'Your replacement seat was secured.';
      const held = ctx.intentOnly ? 'held' : 'booked';
      if (n <= 1) {
        return `${alt.code} at ${alt.dep}, seat ${booking.seat} — ${held}. The airline cancelled, so the fare difference is theirs; you pay nothing.`;
      }
      const seatList = booking.seats.map((s) => s.seat).join(', ');
      return `${alt.code} at ${alt.dep}, ${n} seats ${held} — ${seatList}. The airline cancelled, so the fare difference is theirs; you pay nothing.`;
    }

    case 'hotel': {
      if (!hotel) return 'A room was arranged for tonight.';
      if (cost.rooms > 1) return `${hotel.name}, ${cost.rooms} rooms, check-in ${hotel.checkin}. ${hotel.why}.`;
      return `${hotel.name}, check-in ${hotel.checkin}. ${hotel.why}.`;
    }

    case 'ground': {
      if (!cab) return 'A transfer was arranged.';
      const legs = flight.candidates.cabLegs;
      const vehicleLabel = cost.vehicles > 1 ? `${cost.vehicles} × ${cab.kind}` : cab.kind;
      if (legs.length >= 2) {
        return `${vehicleLabel} booked for both legs — ${legs[0].from} → ${legs[0].to} at ${legs[0].pickup}, and back at ${legs[1].pickup}.`;
      }
      if (legs.length === 1) {
        return `${vehicleLabel} booked — ${legs[0].from} → ${legs[0].to} at ${legs[0].pickup}.`;
      }
      return `${vehicleLabel} arranged for the transfer.`;
    }

    case 'dispose':
      return 'Done last, and deliberately outside the rollback chain — a cancellation has no inverse, so it only happens once the replacement is confirmed.';

    case 'onward': {
      const next = ctx.nextLeg;
      if (!next) return 'No onward leg on this booking, so there was nothing further to verify.';
      return `${next.code} to ${next.to} re-checked and still valid — a no-show on this leg can silently void the rest of an itinerary.`;
    }

    case 'notify':
      return 'Push to your phone plus an email with the new boarding pass.';

    default:
      return 'Step completed.';
  }
}
