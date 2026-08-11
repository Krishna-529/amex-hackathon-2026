import { NextRequest, NextResponse } from 'next/server';
import { getState, resolve, type DisruptionResolution } from '@/server/disruptionState';

export async function GET(req: NextRequest) {
  const flightId = req.nextUrl.searchParams.get('flightId') ?? '';
  return NextResponse.json(getState(flightId));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { flightId: string; resolution: DisruptionResolution };
  return NextResponse.json(resolve(body.flightId, body.resolution));
}
