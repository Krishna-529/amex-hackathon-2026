import { NextRequest, NextResponse } from 'next/server';
import * as store from '@/server/domain/store';
import { requireSelf } from '@/server/auth/guard';
import { parseJsonBody } from '@/server/jsonBody';
import type { OptimizationStrategy } from '@/server/preferences/schema';

const STRATEGIES: OptimizationStrategy[] = [
  'earliest_arrival', 'stick_to_preferred_airline', 'minimize_layovers', 'lowest_cost',
];

/**
 * The two fields a member may change about themselves, validated as a closed
 * set rather than merged wholesale. Exactly one must be present: a PATCH that
 * names neither is a malformed request, not a silent no-op that still answers
 * 200 as though something had been saved.
 */
type PassengerPatch = { consent: 'autopilot' | 'ask' } | { strategy: OptimizationStrategy };

function isPassengerPatch(v: unknown): v is PassengerPatch {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { consent?: unknown; strategy?: unknown };
  const hasConsent = o.consent !== undefined;
  const hasStrategy = o.strategy !== undefined;
  if (hasConsent === hasStrategy) return false;
  if (hasConsent) return o.consent === 'autopilot' || o.consent === 'ask';
  return STRATEGIES.includes(o.strategy as OptimizationStrategy);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireSelf(req, id);
  if ('response' in g) return g.response;
  return NextResponse.json(g.passenger);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireSelf(req, id);
  if ('response' in g) return g.response;
  const parsed = await parseJsonBody(req, isPassengerPatch);
  if ('response' in parsed) return parsed.response;
  const p = ('consent' in parsed.body
    ? await store.updateConsent(id, parsed.body.consent)
    : await store.updateStrategy(id, parsed.body.strategy))!;
  return NextResponse.json({
    id: p.id, displayName: p.displayName, consent: p.consent, strategy: p.strategy ?? null,
  });
}
