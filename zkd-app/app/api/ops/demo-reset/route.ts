import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/guard';
import { resetDemo } from '@/server/domain/seed';

/**
 * DEMO ONLY — restore the whole demo to its seeded state: every seeded flight
 * back to original (forecast/reschedule cleared), any /ops-added flight removed,
 * and all disruption/recovery state wiped. The /ops "Reset demo" button calls
 * this between walkthroughs.
 */
export async function POST(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  await resetDemo();
  return NextResponse.json({ ok: true });
}
