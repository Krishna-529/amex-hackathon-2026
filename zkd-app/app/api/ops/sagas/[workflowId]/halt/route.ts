import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/server/auth/guard';
import { isSameOriginRequest } from '@/server/auth/csrf';
import { checkRateLimit } from '@/server/rateLimit';
import { haltRecoverySaga } from '@/server/engine/actExecutor';

/**
 * The operator kill switch: requests cancellation of an in-flight recovery
 * saga. See server/engine/actExecutor.ts's haltRecoverySaga for why this is
 * a real Temporal cancellation (routing through the saga's own compensation
 * path), not a UI-only "hide this row" action.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'cross-site request rejected' }, { status: 403 });
  }
  // A halt is rare and deliberate — this limit exists only to stop a
  // scripting mistake (e.g. a UI bug looping the call) from hammering
  // Temporal, not to throttle a real operator.
  const limited = checkRateLimit(req, 'saga-halt', { capacity: 10, refillPerMinute: 10 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many requests, try again shortly' }, { status: 429 });
  }

  const { workflowId } = await params;
  try {
    await haltRecoverySaga(workflowId);
  } catch (e) {
    console.error(`[api/ops/sagas/${workflowId}/halt] failed:`, e);
    return NextResponse.json({ error: 'could not halt this saga' }, { status: 502 });
  }

  // Not separately ledgered here: the cancellation this triggers routes
  // through recoverySaga.ts's normal catch block, which produces a real
  // ROLLED_BACK SagaResult exactly like an activity failure would — the
  // existing settlement path (wherever handle.result() is awaited) is what
  // records that outcome, not a second, differently-shaped entry invented
  // at the point of the halt request itself.
  return NextResponse.json({ ok: true });
}
