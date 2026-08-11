import { NextRequest, NextResponse } from 'next/server';
import { searchDuffelAlts } from '@/lib/server/duffel';
import { searchSabreAlts } from '@/lib/server/sabre';
import type { AltsResponse, SourceStatus } from '@/lib/apiTypes';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.searchParams.get('from') ?? '';
  const destination = req.nextUrl.searchParams.get('to') ?? '';
  const departureDate = req.nextUrl.searchParams.get('date') ?? '';
  const cabin = req.nextUrl.searchParams.get('cabin') ?? undefined;

  const [duffelResult, sabreResult] = await Promise.allSettled([
    searchDuffelAlts({ origin, destination, departureDate, cabin }),
    searchSabreAlts({ origin, destination, departureDate }),
  ]);

  const duffelAlts = duffelResult.status === 'fulfilled' ? duffelResult.value : [];
  const sabreAlts = sabreResult.status === 'fulfilled' ? sabreResult.value : [];

  const statusOf = (settled: PromiseSettledResult<unknown[]>): SourceStatus =>
    settled.status === 'rejected' ? 'error' : settled.value.length > 0 ? 'ok' : 'empty';

  const alts = [...duffelAlts, ...sabreAlts].sort((a, b) => a.fare - b.fare);

  const body: AltsResponse = {
    alts,
    sources: { duffel: statusOf(duffelResult), sabre: statusOf(sabreResult) },
  };
  return NextResponse.json(body);
}
