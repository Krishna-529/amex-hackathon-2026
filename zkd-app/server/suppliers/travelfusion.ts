/**
 * TravelFusion — a registered seam, deliberately not an implementation.
 *
 * TravelFusion has no self-serve free tier: access needs a commercial demo
 * agreement and a login we do not hold. Writing a full client against their
 * published XML surface would produce several hundred lines that have never
 * executed once — and untested integration code is worse than an honest stub,
 * because it *looks* finished. It would sit in the registry reporting `error`
 * on some malformed request nobody could debug without credentials, and the
 * next person would waste a day deciding whether it ever worked.
 *
 * So this returns `no-key` and degrades exactly the way `sabre` and
 * `travelport` already do. `searchInventory` records the per-source status,
 * the UI can honestly say what it looked at, and nothing else changes.
 *
 * ── WIRING CHECKLIST (for whoever gets credentials) ────────────────────────
 *
 *   1. env: TRAVELFUSION_LOGIN_ID, TRAVELFUSION_PASSWORD, TRAVELFUSION_XML_URL
 *
 *   2. TravelFusion is **XML over HTTP**, not JSON. Every other supplier in
 *      this directory is JSON, so this one needs an XML parser — do not
 *      hand-roll it with regex.
 *
 *   3. The search is **asynchronous and two-phase**:
 *        POST <Login>          -> LoginId
 *        POST <StartRouting>   -> RoutingId
 *        POST <CheckRouting>   -> poll until Completed=true
 *      That is a **two-call minimum per search**, so it must be registered with
 *      the governor as `callsPerRefresh: 2` — see sustainableIntervalMs() in
 *      server/governor.ts. Registering it as 1 would silently halve the
 *      interval the limiter thinks it is enforcing.
 *
 *   4. Booking is likewise two-phase: <StartBooking> / <CheckBooking>.
 *
 *   5. `live` is **per-supplier, not per-integration** — TravelFusion fronts a
 *      per-account list of underlying carriers, some bookable and some
 *      search-only. Mark each returned offer accordingly rather than assuming
 *      the whole source is one or the other, or the saga will try to commit
 *      something it cannot cancel.
 *
 *   6. Only then flip off `no-key` and implement a real `revalidate`. Until
 *      step 5 is honoured, leave revalidate returning `unknown` — the house
 *      rule in ./index.ts is that a source we cannot re-check is a source we
 *      cannot promise.
 */

import type { Supplier, SupplierStatus } from './types';

export const travelfusion: Supplier = {
  id: 'travelfusion',

  async search() {
    // Not gated on an env var: even with credentials present there is no client
    // behind this, and reporting `no-key` when a key exists would be a lie of a
    // different kind. The checklist above is the gate.
    return { offers: [], status: 'no-key' as SupplierStatus };
  },

  async revalidate() {
    return { state: 'unknown' };
  },
};
