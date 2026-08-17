import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { refreshForecast } from '@/server/engine/forecast';
import { toFlightSummary } from '@/server/domain/views';
import type { Flight, Consent } from '@/server/domain/types';

/**
 * The member booking a flight they found in search.
 *
 * Separate from POST /api/flights, which is the OPERATOR's endpoint and takes
 * an arbitrary `passengerIds` list. That is fine for /ops, which has no account
 * of its own, but it must never be the member path: a body-supplied passenger
 * id would let anyone attach a booking to someone else's account and start
 * receiving that person's disruption alerts. Here the passenger is always the
 * session's, per server/auth/guard.ts.
 *
 * This is where a booking ENTERS the system. Everything downstream — the risk
 * score, the band, the alternatives, the alert — already worked; until now
 * every PNR was seeded, which is the "no self-serve booking" gap the
 * submission documents. What is real: the flight itself, from OAG. What is
 * not: the money. No fare is charged and none is invented, and the PNR is
 * generated locally rather than by an airline.
 */

type Body = {
  /** real OAG-sourced flight identity */
  code: string;
  from: string;
  to: string;
  /** absolute instant of departure */
  depISO: string;
  durationMin: number;
  aircraft?: string;
  terminal?: string;
  cabin?: string;
  /** "I must be there by" — optional, and a real instant when given */
  hardDeadlineISO?: string | null;
  /** autopilot | ask, captured at booking time rather than left to /settings */
  consent?: Consent;
};

function isBody(v: unknown): v is Body {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isNonEmptyString(o.code) &&
    isNonEmptyString(o.from) &&
    isNonEmptyString(o.to) &&
    isNonEmptyString(o.depISO) &&
    !Number.isNaN(Date.parse(o.depISO as string)) &&
    typeof o.durationMin === 'number' &&
    Number.isFinite(o.durationMin) &&
    o.durationMin > 0
  );
}

export async function POST(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const parsed = await parseJsonBody(req, isBody);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;

  const deadline = body.hardDeadlineISO?.trim() || null;
  if (deadline && Number.isNaN(Date.parse(deadline))) {
    return NextResponse.json({ error: 'hardDeadlineISO is not a date' }, { status: 400 });
  }
  // A deadline before the flight even lands is a data-entry mistake, and
  // accepting it would disqualify every alternative and leave the member with
  // an empty recovery screen and no explanation.
  const arrivesAt = Date.parse(body.depISO) + body.durationMin * 60_000;
  if (deadline && Date.parse(deadline) < arrivesAt) {
    return NextResponse.json(
      { error: 'that deadline is before this flight even arrives' },
      { status: 400 },
    );
  }

  // Deterministic id from the real flight identity, so booking the same OAG
  // flight twice (a second traveller, a re-run of the demo) reuses one Flight
  // rather than creating a duplicate the scorer would then score twice.
  const id = `f-${body.code.replace(/\s+/g, '').toLowerCase()}-${body.depISO.slice(0, 10)}`;

  const existing = await store.getFlight(id);
  const flight: Flight = existing ?? {
    id,
    code: body.code,
    from: body.from.toUpperCase(),
    to: body.to.toUpperCase(),
    depISO: body.depISO,
    durationMin: body.durationMin,
    aircraft: body.aircraft,
    terminal: body.terminal,
    connectionSlackMinutes: null,
    hardDeadlineISO: deadline,
    hasHardConstraint: !!deadline,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };

  // A deadline given on a later booking still applies to the flight — the
  // earliest one wins, since it is the tightest thing we must satisfy.
  if (existing && deadline) {
    const current = existing.hardDeadlineISO ? Date.parse(existing.hardDeadlineISO) : Infinity;
    if (Date.parse(deadline) < current) {
      flight.hardDeadlineISO = deadline;
      flight.hasHardConstraint = true;
    }
  }

  await store.createFlight(flight);

  // Idempotent per passenger per flight. Confirming twice — a double-click, an
  // impatient retry, a re-run of the demo — otherwise issues a SECOND PNR on
  // the same flight, which then shows the member two identical trips and makes
  // the flight look doubly-booked to everything counting passengers on it.
  // Observed live before this guard existed.
  const already = (await store.getBookingsForFlight(flight.id)).find(
    (b) => b.passengerId === g.passenger.id,
  );
  if (already) {
    return NextResponse.json(await toFlightSummary(flight, g.passenger.id), { status: 200 });
  }

  // Party size is NOT a field on a Booking — store.createBooking derives it
  // from the travellers it creates, and store.partySize() counts them. Booking
  // for companions therefore means creating real Traveller records (an airline
  // will not reissue a ticket without a name, DOB and document per person),
  // which the search UI does not collect. So this books the card member alone
  // rather than recording a party size that nothing downstream would honour.
  await store.createBooking({
    flightId: flight.id,
    passengerId: g.passenger.id,
    seat: '—',
    pnr: pnr(),
    cabin: body.cabin ?? 'Economy',
  });

  // Captured at booking because that is when the member is actually thinking
  // about this trip. /settings remains where they change it later.
  if (body.consent === 'autopilot' || body.consent === 'ask') {
    await store.updateConsent(g.passenger.id, body.consent);
  }

  // Score it now so the flight is never shown with an empty risk panel.
  // Fire-and-forget: the model being slow or down must not fail a booking that
  // has already been made.
  void refreshForecast(flight.id).catch(() => {});

  return NextResponse.json(await toFlightSummary(flight, g.passenger.id), { status: 201 });
}

/** Locally generated — no airline issues this. Ambiguous characters removed so
 *  a member reading it off a screen onto a phone call gets it right. */
function pnr(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
