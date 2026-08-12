import { NextRequest, NextResponse } from 'next/server';
import { lookupFlightStatus } from '@/server/aviationstack';
import { classify } from '@/lib/disruptionKind';
import type { FlightStatusResponse } from '@/lib/apiTypes';

/**
 * Live status, classified against what the member actually booked.
 *
 * The classification cannot happen without `bookedAt`: a carrier that moves a
 * flight also moves its own schedule, so the delay it reports against the new
 * time is zero. Only the diff against the booked departure shows a reschedule.
 */
export async function GET(req: NextRequest) {
  const flightIata = req.nextUrl.searchParams.get('flightIata') ?? '';
  const bookedAt = Number(req.nextUrl.searchParams.get('bookedAt') ?? '0');
  const slackParam = req.nextUrl.searchParams.get('slack');
  const connectionSlackMinutes = slackParam === null || slackParam === '' ? null : Number(slackParam);

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
