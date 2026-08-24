import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/server/auth/guard';
import { resetDemo } from '@/server/domain/seed';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { checkRateLimit } from '@/server/rateLimit';

/**
 * DEMO ONLY — restore the whole demo to its seeded state: every seeded flight
 * back to original (forecast/reschedule cleared), any /ops-added flight removed,
 * and all disruption/recovery state wiped. The /ops "Reset demo" button calls
 * this between walkthroughs.
 *
 * `requireOperator`, not `requireSession` — fixed 2026-08-21. Any signed-in
 * member (including a publicly-listed demo login) could previously wipe the
 * whole demo/disruption state for everyone mid-event with one request.
 */
export async function POST(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }
  // Already behind requireOperator above, so this bounds cost/thrash from an
  // authenticated operator, not an attacker. Raised 5→15/min on 2026-08-22 —
  // rehearsing several scenario run-throughs back to back legitimately resets
  // more than once every 12 seconds.
  const limited = checkRateLimit(req, 'ops-demo-reset', { capacity: 15, refillPerMinute: 15 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many requests, try again shortly' }, { status: 429 });
  }

  await resetDemo();
  return NextResponse.json({ ok: true });
}
