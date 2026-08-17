import { NextRequest, NextResponse } from 'next/server';
import { reverify } from '@/server/engine/forecast';
import { requireSession } from '@/server/auth/guard';

/**
 * The audit "reverify" action — forces an immediate real re-score (never a
 * cached read) and reports how it compares to what was last shown. See
 * server/engine/forecast.ts's reverify() for what "flagged" means.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const { id } = await params;
  const result = await reverify(id);
  if (!result) return NextResponse.json({ error: 'flight not found or model unreachable' }, { status: 404 });
  return NextResponse.json(result);
}
