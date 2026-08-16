import { NextRequest, NextResponse } from 'next/server';

export type BodyResult<T> = { body: T } | { response: NextResponse };

/**
 * Parses and shape-validates a JSON request body, matching the same
 * `{response}`-early-return pattern server/auth/guard.ts already uses for
 * auth failures — malformed JSON or a body that fails its shape check
 * becomes a real 400, not an unhandled 500 from `(await req.json()) as T`
 * trusting whatever the client sent.
 */
export async function parseJsonBody<T>(
  req: NextRequest,
  isValid: (v: unknown) => v is T,
): Promise<BodyResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }) };
  }
  if (!isValid(raw)) {
    return { response: NextResponse.json({ error: 'malformed request body' }, { status: 400 }) };
  }
  return { body: raw };
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
