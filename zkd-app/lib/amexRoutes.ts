/**
 * The three routes redesigned to look like American Express's own travel
 * site (home/search, sign-in, and the upcoming-flights list). Exact-path
 * matching on purpose — '/flights' is in scope, '/flights/[id]' is not, so
 * this must not be a startsWith check.
 */
export const AMEX_ROUTES = new Set(['/', '/login', '/flights']);

export function isAmexRoute(pathname: string): boolean {
  return AMEX_ROUTES.has(pathname);
}
