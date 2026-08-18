import { NextRequest, NextResponse } from 'next/server';
import { explain } from '@/server/gemini';
import type { ExplainRequest, ExplainResponse } from '@/lib/apiTypes';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';

// Every string interpolated into the LLM prompt below is client-controlled —
// cap length and strip control/prompt-injection-friendly characters before
// it ever reaches promptFor(), rather than trusting free text straight into
// a generated prompt.
const MAX_FIELD_LEN = 80;

function clean(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  // eslint-disable-next-line no-control-regex
  const stripped = v.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, MAX_FIELD_LEN);
}

function isExplainBody(v: unknown): v is ExplainRequest {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.kind === 'risk') {
    return (
      isNonEmptyString(o.flightCode) && isNonEmptyString(o.from) && isNonEmptyString(o.to) &&
      typeof o.pct === 'number' && Number.isFinite(o.pct) && isNonEmptyString(o.topFactor)
    );
  }
  if (o.kind === 'alt') {
    return (
      isNonEmptyString(o.flightCode) && isNonEmptyString(o.altCode) &&
      typeof o.fare === 'number' && Number.isFinite(o.fare) && isNonEmptyString(o.cabin)
    );
  }
  return false;
}

function promptFor(req: ExplainRequest): string {
  if (req.kind === 'risk') {
    const flightCode = clean(req.flightCode) ?? '';
    const from = clean(req.from) ?? '';
    const to = clean(req.to) ?? '';
    const topFactor = clean(req.topFactor) ?? '';
    return (
      `In one short sentence (under 25 words), plain language, no jargon: explain to a traveler why their flight ${flightCode} ` +
      `from ${from} to ${to} has a ${req.pct}% cancellation risk right now, ` +
      // Deliberately no tone instruction beyond "accurate" — this narrates a
      // real calibrated probability and real SHAP factors (see
      // server/engine/riskModel.ts). An instruction to "be reassuring" next
      // to real math is an easy stakeholder objection: it implies the
      // narrative is optimized to soothe rather than to inform. Let the
      // number and the factor speak for themselves; tone is a UI-copy
      // concern, not a prompt-injected one.
      `where the biggest contributing factor is "${topFactor}". Be accurate and neutral in tone, second person ("your flight").`
    );
  }
  const flightCode = clean(req.flightCode) ?? '';
  const altCode = clean(req.altCode) ?? '';
  const cabin = clean(req.cabin) ?? '';
  return (
    `In one short sentence (under 20 words), plain language: explain to a traveler why we're recommending flight ${altCode} ` +
    `(${cabin}, fare ${req.fare}) as their rebooking option for their disrupted flight ${flightCode}. Second person.`
  );
}

// This route just started getting real traffic for the first time (it was
// wired up but had zero callers before topReason/ForecastAudit.tsx started
// calling it for the "top reason" re-phrasing) — a member polling their
// flight every 5s, or several viewers of the same flight, would otherwise
// re-hit Gemini for an unchanged (flightCode, from, to, pct, topFactor)
// tuple. Cache SUCCESSFUL responses only, keyed on the exact request body:
// a real change in pct/topFactor naturally busts the key, and a transient
// Gemini failure is never cached — the next request gets a fresh attempt,
// not a frozen `null` for the next 10 minutes. A local Map, not
// server/cache.ts's getOrSet(), specifically to keep that null-vs-success
// distinction — getOrSet would cache whatever the function returns,
// including a failure.
const EXPLAIN_CACHE_TTL_MS = 10 * 60_000;
const explainCache = new Map<string, { text: string; expiresAt: number }>();

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req, isExplainBody);
  if ('response' in parsed) return parsed.response;

  const cacheKey = JSON.stringify(parsed.body);
  const hit = explainCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json({ text: hit.text } satisfies ExplainResponse);
  }

  const text = await explain(promptFor(parsed.body));
  if (text) explainCache.set(cacheKey, { text, expiresAt: Date.now() + EXPLAIN_CACHE_TTL_MS });
  const response: ExplainResponse = { text };
  return NextResponse.json(response);
}
