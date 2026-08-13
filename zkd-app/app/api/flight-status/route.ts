import { NextRequest, NextResponse } from 'next/server';
import { lookupFlightStatus } from '@/server/aviationstack';
import { classify } from '@/lib/disruptionKind';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import type { FlightStatusResponse } from '@/lib/apiTypes';

/**
 * Live status, classified against what the member actually booked.
 *
 * The classification cannot happen without the booked departure: a carrier that
 * moves a flight also moves its own schedule, so the delay it reports against
 * the new time is zero. Only the diff against what was booked shows a
 * reschedule — which is why `flightId` is the preferred way to call this, so the
 * booked time comes from our own record rather than the caller's claim.
 */
export async function GET(req: NextRequest) {
  ensureSeeded();
  const flightId = req.nextUrl.searchParams.get('flightId');
  const flight = flightId ? store.getFlight(flightId) : undefined;

  const flightIata =
    req.nextUrl.searchParams.get('flightIata') ?? flight?.code.replace(/\s+/g, '') ?? '';
  const bookedAt = flight
    ? new Date(flight.depISO).getTime()
    : Number(req.nextUrl.searchParams.get('bookedAt') ?? '0');
  const slackParam = req.nextUrl.searchParams.get('slack');
  const connectionSlackMinutes = flight
    ? flight.connectionSlackMinutes
    : slackParam === null || slackParam === ''
      ? null
      : Number(slackParam);

  const match = await lookupFlightStatus(flightIata);

  const classification =
    match && bookedAt
      ? classify({
          status: match.flightStatus,
          bookedDepartureAt: bookedAt,
          scheduledDepartureAt: match.depScheduledAt,
          delayMinutes: match.depDelayMin,
          connectionSlackMinutes,
        })
      : null;

  const body: FlightStatusResponse = {
    status: match ? 'ok' : 'empty',
    match,
    classification,
  };
  return NextResponse.json(body);
}
