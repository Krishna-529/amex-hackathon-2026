import { NextRequest, NextResponse } from 'next/server';
import { jurisdictionFor } from '@/server/airportDirectory';
import { BUNDLES, owed } from '@/lib/entitlement';
import type { CareResponse } from '@/lib/apiTypes';

/**
 * What the traveller is owed, under whichever regime governs this route. The
 * engine does not know which country it is in — it looks up a bundle and reads
 * the thresholds off it.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';
  const delayHours = Number(req.nextUrl.searchParams.get('delayHours') ?? '0');
  const overnight = req.nextUrl.searchParams.get('overnight') === '1';
  const forceMajeure = req.nextUrl.searchParams.get('forceMajeure') === '1';

  const jurisdiction = jurisdictionFor(from, to);
  const bundle = BUNDLES[jurisdiction];

  const body: CareResponse = {
    jurisdiction,
    bundleName: bundle.name,
    citation: bundle.citation,
    owed: owed({ jurisdiction, delayHours, overnight, forceMajeure }),
  };
  return NextResponse.json(body);
}
