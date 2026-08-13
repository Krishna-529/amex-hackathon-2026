import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toFlightSummary } from '@/server/domain/views';
import { refreshForecast } from '@/server/engine/forecast';
import type { Flight } from '@/server/domain/types';

export async function GET(req: NextRequest) {
  ensureSeeded();
  const passengerId = req.nextUrl.searchParams.get('passengerId');
  if (passengerId) {
    const schedule = store.getScheduleForPassenger(passengerId);
    return NextResponse.json(schedule.map(({ flight }) => toFlightSummary(flight, passengerId)));
  }
  return NextResponse.json(store.listFlights().map((f) => toFlightSummary(f)));
}

type CreateFlightRequest = {
  code: string; from: string; to: string; depISO: string; durationMin: number;
  aircraft?: string; terminal?: string;
  connectionSlackMinutes?: number | null;
  hasHardConstraint?: boolean;
  passengerIds?: string[];
};

export async function POST(req: NextRequest) {
  ensureSeeded();
  const body = (await req.json()) as CreateFlightRequest;
  const id = `f-${Date.now().toString(36)}`;
  const flight: Flight = {
    id, code: body.code, from: body.from, to: body.to, depISO: body.depISO, durationMin: body.durationMin,
    aircraft: body.aircraft, terminal: body.terminal,
    connectionSlackMinutes: body.connectionSlackMinutes ?? null,
    hasHardConstraint: body.hasHardConstraint ?? false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
  store.createFlight(flight);
  // A flight created through the API is watched exactly like a seeded one — the
  // forecast is fetched on first read rather than being supplied by the caller.
  void refreshForecast(id).catch(() => {});

  for (const passengerId of body.passengerIds ?? []) {
    store.createBooking({
      flightId: id, passengerId,
      seat: '—', pnr: Math.random().toString(36).slice(2, 8).toUpperCase(), cabin: 'Economy',
    });
  }

  return NextResponse.json(toFlightSummary(flight));
}
