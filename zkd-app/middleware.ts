import { NextResponse, type NextRequest } from 'next/server';

/**
 * Presence-only redirect. Next middleware runs on the edge runtime by
 * default, where node:crypto's createHmac/scryptSync are unavailable, so this
 * cannot verify the cookie's signature — it can only check that one exists.
 * A forged cookie therefore PASSES this middleware and is rejected by
 * requireSession() in the actual route handler (server/auth/guard.ts), which
 * is where the real authorization boundary is. This file is UX only: it
 * avoids a flash of a page that immediately 401s, nothing more.
 *
 * The cookie name is duplicated from server/auth/session.ts rather than
 * imported — that module pulls in node:crypto at module scope, which the
 * edge bundle cannot include. Keep this literal in sync with SESSION_COOKIE.
 */
const SESSION_COOKIE = 'zkd_session';

export function middleware(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!api|login|ops|_next|favicon.svg).*)'],
};
