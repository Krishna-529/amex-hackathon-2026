import { NextRequest, NextResponse } from 'next/server';
import { airport, distanceKm, isInternational, jurisdictionFor } from '@/server/airportDirectory';
import { BUNDLES, compensationFor, owed } from '@/lib/entitlement';
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

  // US DOT's "significant change" threshold is 3h domestic but 6h
  // international. Every other regime ignores this flag.
  const international = isInternational(from, to);

  // EU261/UK261 compensation is banded by great-circle distance, so it cannot
  // be read off the bundle alone. Null where the regime has no banded figure —
  // which is NOT the same as zero; see entitlement.ts.
  const a = airport(from);
  const b = airport(to);
  const compensation = a && b ? compensationFor(jurisdiction, distanceKm(a, b)) : null;

  const body: CareResponse = {
    jurisdiction,
    bundleName: bundle.name,
    citation: bundle.citation,
    owed: owed({ jurisdiction, delayHours, overnight, forceMajeure, international }),
    compensation,
    evidenceTier: bundle.evidenceTier,
  };
  return NextResponse.json(body);
}
