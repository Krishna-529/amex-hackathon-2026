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
/** Duplicated from server/auth/opsSession.ts for the same edge-runtime
 *  reason SESSION_COOKIE is duplicated above — keep in sync with OPS_COOKIE. */
const OPS_COOKIE = 'zkd_ops_session';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/ops')) {
    if (pathname === '/ops/login') return NextResponse.next();
    if (req.cookies.has(OPS_COOKIE)) return NextResponse.next();
    return NextResponse.redirect(new URL('/ops/login', req.url));
  }

  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', req.url));
}

/**
 * The trailing `|.*\..*` excludes any path with a file extension — every
 * static asset under public/ (fonts, brand icons, favicon) — not just the
 * two that happened to get named here before. Without it, an unauthenticated
 * request for e.g. /fonts/geist.woff2 gets redirected to /login and the
 * browser tries to parse the login page's HTML as a font.
 *
 * `/ops` now runs through middleware() above (previously excluded entirely)
 * so an unauthenticated request for the operator console gets redirected to
 * /ops/login instead of rendering the page and 401ing on first fetch. `api`
 * stays excluded: it cannot verify cookie signatures here (see the module
 * comment) and each route already self-guards via requireSession/
 * requireOperator, which is the real boundary either way.
 */
export const config = {
  matcher: ['/((?!api|login|_next|.*\\..*).*)'],
};
