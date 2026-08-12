import { NextRequest, NextResponse } from 'next/server';
import { forecast } from '@/server/lumo';
import { searchInventory, seatsAcross } from '@/server/suppliers';
import { thresholdsFor, bandFor } from '@/lib/thresholds';
import type { ForecastResponse } from '@/lib/apiTypes';

/**
 * The disruption probability, and the thresholds it is judged against.
 *
 * Both halves have to come back together. A probability without its threshold
 * cannot be turned into a decision, and the threshold moves with how much
 * inventory exists — so we count seats here rather than making the client do it.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    flightIata: string;
    from: string;
    to: string;
    date: string;
    minutesToDeparture: number;
    hasHardConstraint: boolean;
  };

  const [forecasts, inventory] = await Promise.all([
    forecast([{ flightIata: body.flightIata, from: body.from, to: body.to, date: body.date }]),
    searchInventory({ origin: body.from, destination: body.to, departureDate: body.date }),
  ]);

  const f = forecasts[0];
  const thresholds = thresholdsFor({
    seatsAvailable: seatsAcross(inventory.offers),
    minutesToDeparture: body.minutesToDeparture,
    hasHardConstraint: body.hasHardConstraint,
    confidence: f.confidence,
  });

  const pct = Math.round(f.cancelProbability * 100);

  const response: ForecastResponse = {
    pct,
    connectionRisk: f.connectionRisk,
    confidence: f.confidence,
    source: f.source,
    thresholds,
    band: bandFor(pct, thresholds),
    asOf: f.asOf,
  };
  return NextResponse.json(response);
}
