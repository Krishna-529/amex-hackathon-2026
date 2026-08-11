import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toFlightSummary } from '@/server/domain/views';
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
  signals?: { weather: number; rotation: number; congestion: number; record: number; slot: number };
  passengerIds?: string[];
};

export async function POST(req: NextRequest) {
  ensureSeeded();
  const body = (await req.json()) as CreateFlightRequest;
  const id = `f-${Date.now().toString(36)}`;
  const flight: Flight = {
    id, code: body.code, from: body.from, to: body.to, depISO: body.depISO, durationMin: body.durationMin,
    aircraft: body.aircraft, terminal: body.terminal,
    signals: body.signals ?? { weather: 0.4, rotation: 0.35, congestion: 0.4, record: 0.2, slot: 0.3 },
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
  store.createFlight(flight);

  for (const passengerId of body.passengerIds ?? []) {
    store.createBooking({
      flightId: id, passengerId,
      seat: '—', pnr: Math.random().toString(36).slice(2, 8).toUpperCase(), cabin: 'Economy',
    });
  }

  return NextResponse.json(toFlightSummary(flight));
}
