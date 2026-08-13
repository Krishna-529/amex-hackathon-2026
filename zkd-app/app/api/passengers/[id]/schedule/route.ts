import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { toFlightSummary } from '@/server/domain/views';
import { requireSelf } from '@/server/auth/guard';
import type { PassengerScheduleResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = requireSelf(req, id);
  if ('response' in g) return g.response;

  const schedule = store.getScheduleForPassenger(id);
  const body: PassengerScheduleResponse = {
    passenger: { id: g.passenger.id, displayName: g.passenger.displayName, consent: g.passenger.consent },
    upcoming: schedule.map(({ flight }) => toFlightSummary(flight, id)),
    past: store.getPastFlights(id),
  };
  return NextResponse.json(body);
}
