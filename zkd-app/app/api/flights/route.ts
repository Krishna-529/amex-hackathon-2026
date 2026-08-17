import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toFlightSummary } from '@/server/domain/views';
import { refreshForecast } from '@/server/engine/forecast';
import type { Flight } from '@/server/domain/types';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';

// Deliberately open, per the operator model: /ops has no account of its own,
// and this is the global flight list it needs. It returns no member PII —
// toFlightSummary() without a passengerId omits the `booking` field entirely.
export async function GET() {
  await ensureSeeded();
  const flights = await store.listFlights();
  return NextResponse.json(await Promise.all(flights.map((f) => toFlightSummary(f))));
}

type CreateFlightRequest = {
  code: string; from: string; to: string; depISO: string; durationMin: number;
  aircraft?: string; terminal?: string;
  connectionSlackMinutes?: number | null;
  hasHardConstraint?: boolean;
  passengerIds?: string[];
};

function isCreateFlightBody(v: unknown): v is CreateFlightRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isNonEmptyString(o.code) && isNonEmptyString(o.from) && isNonEmptyString(o.to) &&
    isNonEmptyString(o.depISO) && !Number.isNaN(Date.parse(o.depISO)) &&
    typeof o.durationMin === 'number' && Number.isFinite(o.durationMin) &&
    (o.passengerIds === undefined || Array.isArray(o.passengerIds))
  );
}

export async function POST(req: NextRequest) {
  await ensureSeeded();
  const parsed = await parseJsonBody(req, isCreateFlightBody);
  if ('response' in parsed) return parsed.response;
  const body = parsed.body;
  const id = `f-${Date.now().toString(36)}`;
  const flight: Flight = {
    id, code: body.code, from: body.from, to: body.to, depISO: body.depISO, durationMin: body.durationMin,
    aircraft: body.aircraft, terminal: body.terminal,
    connectionSlackMinutes: body.connectionSlackMinutes ?? null,
    hasHardConstraint: body.hasHardConstraint ?? false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
  await store.createFlight(flight);
  // A flight created through the API is watched exactly like a seeded one — the
  // forecast is fetched on first read rather than being supplied by the caller.
  void refreshForecast(id).catch(() => {});

  for (const passengerId of body.passengerIds ?? []) {
    await store.createBooking({
      flightId: id, passengerId,
      seat: '—', pnr: Math.random().toString(36).slice(2, 8).toUpperCase(), cabin: 'Economy',
    });
  }

  return NextResponse.json(await toFlightSummary(flight));
}
