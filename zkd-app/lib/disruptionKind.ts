/**
 * What kind of disruption is this, and which pipelines does it wake?
 *
 * The old model assumed every disruption was a cancellation ending in a
 * rebooking. Most are not. A flight moved by ninety minutes that still makes
 * your connection needs no new ticket at all — it needs the hotel check-in and
 * both cab legs re-timed. Treating that as a cancellation would rebook someone
 * who did not need rebooking; treating it as nothing would leave them with a car
 * arriving at the wrong hour.
 */

export type DisruptionKind = 'cancellation' | 'reschedule' | 'delay-cascade' | 'diversion' | 'none';

export type SignalInput = {
  /** what the carrier currently says the flight is doing */
  status: string | null;
  /** epoch ms the member booked */
  bookedDepartureAt: number;
  /** epoch ms the carrier now publishes, if it differs */
  scheduledDepartureAt: number | null;
  /** live delay against the current schedule */
  delayMinutes: number | null;
  /** minutes of slack before the onward leg is missed; null when there is no onward leg */
  connectionSlackMinutes: number | null;
};

/** A schedule move smaller than this is noise, not a reschedule worth telling anyone about. */
const RESCHEDULE_THRESHOLD_MINUTES = 15;

/** Delay big enough that downstream bookings are wrong even if the flight operates. */
const CASCADE_THRESHOLD_MINUTES = 60;

export type Classification = {
  kind: DisruptionKind;
  /** how far the departure moved, signed: positive is later */
  shiftMinutes: number;
  /** the onward leg no longer connects */
  breaksConnection: boolean;
  /** a replacement flight is required */
  needsRebooking: boolean;
  /** hotel, transfers and check-in times need recomputing */
  needsRetiming: boolean;
  /** could this be settled without spending the member's money */
  freeToFix: boolean;
};

export function classify(input: SignalInput): Classification {
  const status = (input.status ?? '').toLowerCase();

  const shiftMinutes = input.scheduledDepartureAt
    ? Math.round((input.scheduledDepartureAt - input.bookedDepartureAt) / 60_000)
    : (input.delayMinutes ?? 0);

  const breaksConnection =
    input.connectionSlackMinutes !== null && shiftMinutes > input.connectionSlackMinutes;

  if (status.includes('cancel')) {
    return {
      kind: 'cancellation',
      shiftMinutes,
      breaksConnection,
      needsRebooking: true,
      needsRetiming: true,
      freeToFix: true, // an involuntary cancellation is the carrier's to pay for
    };
  }

  if (status.includes('divert')) {
    return {
      kind: 'diversion',
      shiftMinutes,
      breaksConnection: true,
      needsRebooking: true,
      needsRetiming: true,
      freeToFix: true,
    };
  }

  if (Math.abs(shiftMinutes) >= RESCHEDULE_THRESHOLD_MINUTES && input.scheduledDepartureAt) {
    // The carrier moved the flight. Only a broken connection needs a new ticket.
    return {
      kind: 'reschedule',
      shiftMinutes,
      breaksConnection,
      needsRebooking: breaksConnection,
      needsRetiming: true,
      freeToFix: true,
    };
  }

  if ((input.delayMinutes ?? 0) >= CASCADE_THRESHOLD_MINUTES) {
    return {
      kind: 'delay-cascade',
      shiftMinutes,
      breaksConnection,
      needsRebooking: breaksConnection,
      needsRetiming: true,
      freeToFix: true,
    };
  }

  return {
    kind: 'none',
    shiftMinutes,
    breaksConnection: false,
    needsRebooking: false,
    needsRetiming: false,
    freeToFix: true,
  };
}

export const KIND_LABEL: Record<DisruptionKind, string> = {
  cancellation: 'Cancelled',
  reschedule: 'Rescheduled',
  'delay-cascade': 'Delayed',
  diversion: 'Diverted',
  none: 'On schedule',
};

export function kindSay(c: Classification): string {
  switch (c.kind) {
    case 'cancellation':
      return 'The airline cancelled this flight. We are moving you onto the best alternative that keeps your trip together.';
    case 'diversion':
      return 'This flight is being diverted. We are rebuilding the rest of your trip around where you will actually land.';
    case 'reschedule': {
      const dir = c.shiftMinutes > 0 ? 'later' : 'earlier';
      const by = `${Math.abs(c.shiftMinutes)} min ${dir}`;
      return c.breaksConnection
        ? `The airline moved this flight ${by}, which breaks your onward connection — so we are finding you a different seat.`
        : `The airline moved this flight ${by}. Your connection still works, so we are only re-timing your hotel and transfers.`;
    }
    case 'delay-cascade':
      return c.breaksConnection
        ? 'This flight is delayed enough to miss your connection. We are finding you a different onward seat.'
        : 'This flight is running late. Your connection holds, so we are re-timing your hotel and transfers.';
    default:
      return 'Nothing has changed on this flight.';
  }
}
