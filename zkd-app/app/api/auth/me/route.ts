import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/guard';

// Identity is read fresh on every call, never cached — a stale "who am I"
// would defeat sign-out and any future consent change.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = requireSession(req);
  if ('response' in g) return g.response;
  const { id, displayName, consent } = g.passenger;
  return NextResponse.json({ id, displayName, consent });
}
