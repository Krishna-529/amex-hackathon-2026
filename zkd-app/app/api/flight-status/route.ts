import { NextRequest, NextResponse } from 'next/server';
import { lookupFlightStatus } from '@/lib/server/aviationstack';
import type { FlightStatusResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest) {
  const flightIata = req.nextUrl.searchParams.get('flightIata') ?? '';
  const match = await lookupFlightStatus(flightIata);
  const body: FlightStatusResponse = { status: match ? 'ok' : 'empty', match };
  return NextResponse.json(body);
}
