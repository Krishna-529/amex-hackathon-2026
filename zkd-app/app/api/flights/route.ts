import { NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { ensureSeeded } from '@/server/domain/seed';
import { toFlightSummary } from '@/server/domain/views';

// Deliberately open, per the operator model: /ops has no account of its own,
// and this is the global flight list it needs. It returns no member PII —
// toFlightSummary() without a passengerId omits the `booking` field entirely.
export async function GET() {
  await ensureSeeded();
  const flights = await store.listFlights();
  return NextResponse.json(await Promise.all(flights.map((f) => toFlightSummary(f))));
}
