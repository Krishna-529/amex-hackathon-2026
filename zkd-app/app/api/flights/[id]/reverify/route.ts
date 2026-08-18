import { NextRequest, NextResponse } from 'next/server';
import { reverify } from '@/server/engine/forecast';
import { requireSession } from '@/server/auth/guard';
import { consumeToken } from '@/server/rateLimit';

/**
 * The audit "reverify" action — forces an immediate real re-score (never a
 * cached read) and reports how it compares to what was last shown. See
 * server/engine/forecast.ts's reverify() for what "flagged" means.
 *
 * Rate-limited per member (not per IP, unlike most other rate-limited routes
 * — see server/rateLimit.ts's checkRateLimit — because the thing being
 * protected here is a real bypass of the forecast TTL straight to the real
 * scorer, an abuse surface that's per-account, not per-network-address).
 * 5-burst / 1-per-minute-sustained: generous enough for "let me double-check
 * a couple of flights right now," tight enough that unlimited manual
 * refreshing can't undercut the whole point of neighbor smoothing
 * (server/engine/neighborSmoothing.ts) reducing real model-call volume.
 */
const REVERIFY_RATE_LIMIT = { capacity: 5, refillPerMinute: 1 };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const limited = consumeToken(`reverify:${g.passenger.id}`, REVERIFY_RATE_LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many reverify requests — please slow down.', retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  const { id } = await params;
  const result = await reverify(id);
  if (!result) return NextResponse.json({ error: 'flight not found or model unreachable' }, { status: 404 });
  return NextResponse.json(result);
}
