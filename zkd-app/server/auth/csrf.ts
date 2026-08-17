/**
 * Second layer of CSRF defense on top of the session cookie's `sameSite:
 * lax`. `lax` blocks a cross-site <form> POST from carrying the cookie, but
 * it's the only defense today, and this app's mutating routes are
 * payment-adjacent (consent, pre-auth, disruption triggers). This adds an
 * explicit Origin check — cheap, no new dependency, and it degrades safely:
 * a same-origin fetch() always sends Origin, so this never breaks the real
 * app, only a cross-site forged request.
 */
import type { NextRequest } from 'next/server';

export function isSameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  // No Origin header at all (e.g. a same-site top-level navigation, or some
  // non-browser clients) — don't false-positive-reject those; sameSite=lax
  // already covers the cross-site-form case this would otherwise catch.
  if (!origin) return true;

  const host = req.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
