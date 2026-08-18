import { NextRequest, NextResponse } from 'next/server';
import { getRecoveryView } from '@/server/engine/simulation';
import { refineWithPreference } from '@/server/engine/refine';
import { requireSession } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { consumeToken } from '@/server/rateLimit';

/**
 * Separate from ../consent/route.ts deliberately: resolveTask() (behind
 * consent) is fully synchronous, but this needs to `await` a real LLM
 * call — see server/engine/refine.ts. consent/route.ts's own isResolveBody
 * already rejects an unrecognized 'refine' action kind (its SIMPLE_KINDS
 * allowlist doesn't include it), so there's no risk of the two routes
 * fighting over the same action.
 *
 * Rate-limited per member (not per IP — the abuse surface here is a real
 * LLM call, occasionally a real supplier fan-out, both billed per
 * account, not per network address). Tighter than reverify's 5/1 (the
 * closest precedent, app/api/flights/[id]/reverify/route.ts) since this is
 * strictly more expensive per call.
 */
const REFINE_RATE_LIMIT = { capacity: 4, refillPerMinute: 1 };

function isRefineBody(v: unknown): v is { prompt: string } {
  return typeof v === 'object' && v !== null && isNonEmptyString((v as Record<string, unknown>).prompt);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ flightId: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }

  const limited = consumeToken(`refine:${g.passenger.id}`, REFINE_RATE_LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many refine requests — please slow down.', retryAfterMs: limited.retryAfterMs },
      { status: 429 },
    );
  }

  const { flightId } = await params;
  const parsed = await parseJsonBody(req, isRefineBody);
  if ('response' in parsed) return parsed.response;

  await refineWithPreference(flightId, g.passenger.id, parsed.body.prompt);
  return NextResponse.json(await getRecoveryView(flightId, g.passenger.id));
}
