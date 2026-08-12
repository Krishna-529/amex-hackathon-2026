import { NextRequest, NextResponse } from 'next/server';
import { getState, resolve, classifyState, type DisruptionResolution } from '@/server/disruptionState';
import { confirmWindow, windowRationale } from '@/lib/confirmWindow';
import type { DisruptionKind } from '@/lib/disruptionKind';

export async function GET(req: NextRequest) {
  const flightId = req.nextUrl.searchParams.get('flightId') ?? '';
  return NextResponse.json(getState(flightId));
}

/**
 * Two things can be posted here: the classification of a disruption (which also
 * fixes the member's decision window, once, so every viewer counts down to the
 * same instant), and its eventual resolution.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as
    | { flightId: string; resolution: DisruptionResolution }
    | {
        flightId: string;
        classify: {
          kind: DisruptionKind;
          offerExpiresAt: number | null;
          departureAt: number;
          international: boolean;
        };
      };

  if ('classify' in body) {
    const c = body.classify;
    const w = confirmWindow({
      offerExpiresAt: c.offerExpiresAt,
      departureAt: c.departureAt,
      international: c.international,
    });
    const state = classifyState(body.flightId, c.kind, w.askable ? w.expiresAt : null);
    return NextResponse.json({ ...state, window: w, rationale: windowRationale(w) });
  }

  return NextResponse.json(resolve(body.flightId, body.resolution));
}
