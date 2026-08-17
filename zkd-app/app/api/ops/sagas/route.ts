import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/server/auth/guard';
import { listRunningSagas } from '@/server/engine/actExecutor';

export async function GET(req: NextRequest) {
  const g = await requireOperator(req);
  if ('response' in g) return g.response;

  try {
    const sagas = await listRunningSagas();
    return NextResponse.json(sagas);
  } catch (e) {
    // Temporal unreachable (e.g. docker-compose not running locally) —
    // an empty list, not a 500, so the ops console keeps rendering.
    console.error('[api/ops/sagas] failed to list running sagas:', e);
    return NextResponse.json([]);
  }
}
