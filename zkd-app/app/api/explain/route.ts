import { NextRequest, NextResponse } from 'next/server';
import { explain } from '@/server/gemini';
import type { ExplainRequest, ExplainResponse } from '@/lib/apiTypes';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { checkRateLimit } from '@/server/rateLimit';

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
      `where the biggest contributing factor is "${topFactor}". Be reassuring but honest, second person ("your flight").`
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

export async function POST(req: NextRequest) {
  // Added 2026-08-21: this route is deliberately unauthenticated (a member
  // reads an explanation before or after signing in) and calls a real, real-
  // money LLM on every request — previously open to unlimited-volume cost
  // abuse from a single anonymous client.
  const limited = checkRateLimit(req, 'explain', { capacity: 20, refillPerMinute: 10 });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'too many requests, try again shortly' }, { status: 429 });
  }

  const parsed = await parseJsonBody(req, isExplainBody);
  if ('response' in parsed) return parsed.response;
  const text = await explain(promptFor(parsed.body));
  const response: ExplainResponse = { text };
  return NextResponse.json(response);
}
