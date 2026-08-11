import { NextRequest, NextResponse } from 'next/server';
import { explain } from '@/lib/server/gemini';
import type { ExplainRequest, ExplainResponse } from '@/lib/apiTypes';

function promptFor(req: ExplainRequest): string {
  if (req.kind === 'risk') {
    return (
      `In one short sentence (under 25 words), plain language, no jargon: explain to a traveler why their flight ${req.flightCode} ` +
      `from ${req.from} to ${req.to} has a ${req.pct}% cancellation risk right now, ` +
      `where the biggest contributing factor is "${req.topFactor}". Be reassuring but honest, second person ("your flight").`
    );
  }
  return (
    `In one short sentence (under 20 words), plain language: explain to a traveler why we're recommending flight ${req.altCode} ` +
    `(${req.cabin}, fare ${req.fare}) as their rebooking option for their disrupted flight ${req.flightCode}. Second person.`
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ExplainRequest;
  const text = await explain(promptFor(body));
  const response: ExplainResponse = { text };
  return NextResponse.json(response);
}
