import { NextResponse } from 'next/server';
import { fetchProfile, NEVER_STORED } from '@/server/myca';

/**
 * The member's travel profile, read from MyCa at request time and never cached
 * here. If the card changes an entitlement, the next recovery uses the new one.
 */
export async function GET() {
  const profile = await fetchProfile('demo');
  return NextResponse.json({ profile, neverStored: NEVER_STORED });
}
