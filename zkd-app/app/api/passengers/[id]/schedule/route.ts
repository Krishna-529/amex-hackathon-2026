import { NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toFlightSummary } from '@/server/domain/views';
import type { PassengerScheduleResponse } from '@/lib/apiTypes';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  ensureSeeded();
  const { id } = await params;
  const passenger = store.getPassenger(id);
  if (!passenger) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const schedule = store.getScheduleForPassenger(id);
  const body: PassengerScheduleResponse = {
    passenger: { id: passenger.id, displayName: passenger.displayName, consent: passenger.consent },
    upcoming: schedule.map(({ flight }) => toFlightSummary(flight, id)),
    past: store.getPastFlights(id),
  };
  return NextResponse.json(body);
}
