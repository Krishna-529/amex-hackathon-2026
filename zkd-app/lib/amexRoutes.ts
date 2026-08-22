/**
 * The routes redesigned to look like American Express's own travel site.
 *
 * Two matching rules, deliberately kept separate rather than collapsed into one
 * `startsWith`:
 *
 * - EXACT for the standalone pages (`/`, `/login`, `/flights`). A prefix match
 *   on `/` would catch every route in the app.
 * - PREFIX for `/flights/<id>`, the flight-detail page. It is the screen a
 *   member lands on straight from the skinned list, so leaving it dark made the
 *   transition jarring — you clicked a white Amex row and got a dark glass page.
 *
 * The prefix arm is written as `/flights/` WITH the trailing slash so it cannot
 * accidentally match a future sibling like `/flights-archive`, and everything
 * under it (`/flights/u1`, and any deeper segment added later) is in scope.
 *
 * Every OTHER route — `/recovery/[id]`, `/profile`,
 * `/settings`, `/history`, `/ops` — keeps the original dark
 * glass theme. That is a real decision, not an omission: `/ops` is an operator
 * console rather than a member screen, and the recovery flow's urgency reads
 * better dark.
 */
export const AMEX_ROUTES = new Set([
  '/', '/login', '/flights',
  // Every member-facing page carries the light Amex skin so the experience is
  // consistent end to end. Only /ops (the operator console) stays dark.
  '/history', '/profile', '/settings', '/prepare',
]);

/** Routes whose entire subtree is skinned. Trailing slash is load-bearing.
 *  `/recovery/` and `/prepare/` are skinned too so the member stays on the
 *  light Amex theme through those flows instead of jumping to the dark glass. */
const AMEX_PREFIXES = ['/flights/', '/recovery/', '/prepare/'];

export function isAmexRoute(pathname: string): boolean {
  if (AMEX_ROUTES.has(pathname)) return true;
  return AMEX_PREFIXES.some((p) => pathname.startsWith(p));
}
