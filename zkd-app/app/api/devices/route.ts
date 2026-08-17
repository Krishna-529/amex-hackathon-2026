import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/guard';
import { parseJsonBody, isNonEmptyString } from '@/server/jsonBody';
import { registerDevice, forgetDevice, isExpoToken } from '@/server/notify';

/**
 * Where the Android app hands over its Expo push token.
 *
 * Bound to the SESSION's passenger, never to a passengerId in the body — a
 * body-supplied id would let anyone register their own device against another
 * member's flights and receive that member's disruption alerts, which are not
 * anonymous (they name the route, the time and the risk). Same rule the rest
 * of the protected routes follow via requireSession; see server/auth/guard.ts.
 *
 * Call it after `setupNotifications()` in zkd-android/src/notify.ts, once the
 * permission prompt has been accepted and a token actually exists.
 */

type Body = { token: string };

function isBody(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && isNonEmptyString((v as Record<string, unknown>).token);
}

export async function POST(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const parsed = await parseJsonBody(req, isBody);
  if ('response' in parsed) return parsed.response;

  const token = parsed.body.token.trim();
  // Reject anything that isn't Expo-shaped rather than storing it and
  // discovering on the first real disruption that the token was junk.
  if (!isExpoToken(token)) {
    return NextResponse.json({ error: 'not an Expo push token' }, { status: 400 });
  }

  registerDevice(token, g.passenger.id);
  return NextResponse.json({ ok: true });
}

/** Sign-out / notifications-off. Silent on an unknown token — deregistering
 *  something already gone is the state the caller wanted either way. */
export async function DELETE(req: NextRequest) {
  const g = await requireSession(req);
  if ('response' in g) return g.response;

  const parsed = await parseJsonBody(req, isBody);
  if ('response' in parsed) return parsed.response;

  forgetDevice(parsed.body.token.trim());
  return NextResponse.json({ ok: true });
}
