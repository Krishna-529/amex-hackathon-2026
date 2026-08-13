/**
 * A diagnostic/manual search endpoint — free-form from/to/date, not tied to a
 * seeded Flight. server/engine/altsCache.ts is the path that actually feeds
 * `Flight.candidates.alts` on every page read; this route shares its
 * conversion logic (server/domain/altsFromOffers.ts) but does its own search,
 * useful for probing what a route returns without a Flight id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchInventory, seatsAcross } from '@/server/suppliers';
import { fetchProfile } from '@/server/myca';
import { offersToAlts } from '@/server/domain/altsFromOffers';
import type { AltsResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.searchParams.get('from') ?? '';
  const destination = req.nextUrl.searchParams.get('to') ?? '';
  const departureDate = req.nextUrl.searchParams.get('date') ?? '';
  const cabin = req.nextUrl.searchParams.get('cabin') ?? undefined;

  const [{ offers, sources }, profile] = await Promise.all([
    searchInventory({ origin, destination, departureDate, cabin }),
    fetchProfile('demo'),
  ]);

  const body: AltsResponse = {
    alts: offersToAlts(offers, origin, destination, profile.preferences.cabinEntitlement, profile.preferences.perTransactionCap),
    offers,
    seatsAvailable: seatsAcross(offers),
    sources,
  };
  return NextResponse.json(body);
}
