import { NextRequest, NextResponse } from 'next/server';
import { searchHotels } from '@/lib/server/liteapi';
import type { HotelsResponse } from '@/lib/apiTypes';

export async function GET(req: NextRequest) {
  const cityName = req.nextUrl.searchParams.get('city') ?? '';
  const checkin = req.nextUrl.searchParams.get('checkin') ?? '';
  const checkout = req.nextUrl.searchParams.get('checkout') ?? '';

  const hotels = await searchHotels({ cityName, countryCode: 'IN', checkin, checkout });
  const body: HotelsResponse = { hotels, source: hotels.length > 0 ? 'ok' : 'empty' };
  return NextResponse.json(body);
}
