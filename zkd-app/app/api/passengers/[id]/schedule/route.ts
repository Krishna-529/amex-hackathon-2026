import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { toFlightSummary } from '@/server/domain/views';
import { requireSelf } from '@/server/auth/guard';
import type { PassengerScheduleResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireSelf(req, id);
  if ('response' in g) return g.response;

  // Independent reads — a member's flights, their past record and their hotel
  // bookings have no ordering dependency on each other.
  const [schedule, past, stays] = await Promise.all([
    store.getScheduleForPassenger(id),
    store.getPastFlights(id),
    store.getStaysForPassenger(id),
  ]);
  const body: PassengerScheduleResponse = {
    passenger: { id: g.passenger.id, displayName: g.passenger.displayName, consent: g.passenger.consent },
    upcoming: await Promise.all(schedule.map(({ flight }) => toFlightSummary(flight, id))),
    past,
    // Hotels the member booked themselves. Carried here rather than on their
    // own endpoint so "my trips" is one request — a stay you cannot see is a
    // booking the member has no reason to believe happened.
    stays,
  };
  return NextResponse.json(body);
}
