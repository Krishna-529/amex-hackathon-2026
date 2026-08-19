/**
 * OAG Flight Info Alerts — the interface, without the subscription.
 *
 * ── Why a stub is worth committing ─────────────────────────────────────────
 *
 * OAG is the best long-term fit for this product and the one we are closest to
 * technically. Flight Info Alerts pushes schedule and status changes over HTTP
 * POST to an HTTPS endpoint, filtered by flight, carrier or airport — and
 * `server/oag.ts` already carries working OAG auth, with Azure APIM
 * `Subscription-Key` headers, dual-key rotation and trial/production tiering.
 * Adding OAG later should be a config change, not a rewrite, and that is only
 * true if the seam exists now.
 *
 * ── Why it is not wired ────────────────────────────────────────────────────
 *
 * Flight Info Alerts is a **separate product** from the Flight Info API, with no
 * published pricing and a sales conversation in front of it. And per memory.md
 * (2026-08-17), our configured OAG *production* key is not an active
 * subscription at all — the trial key is what answers 200 today. Wiring a live
 * alert subscription against that would fail in a way that looks like a code
 * bug rather than a commercial one.
 *
 * So this adapter is honest about its state: it verifies nothing, normalises
 * nothing, and `isConfigured()` in ./index.ts reports it as unconfigured, which
 * keeps it out of the `primary` health calculation. It cannot silently appear
 * to work.
 *
 * ── What to fill in when the subscription lands ────────────────────────────
 *
 * 1. `verify` — OAG HTTP Push authenticates the receiver rather than signing
 *    the body, so this will most likely be `verifySharedSecret` against the
 *    token in the registered URL, exactly like ./aerodatabox.ts.
 * 2. `normalise` — map OAG's status/schedule event onto NormalisedFlightEvent.
 *    Reuse `parseInstance`'s hard-won lesson in server/oag.ts: v2 splits an
 *    instant across sibling `date` and `time` objects each carrying BOTH local
 *    and utc values, and pairing `date.local` with `time.utc` shifts a flight by
 *    a day. Build the instant from one consistent side.
 * 3. `deliveryId` — use whatever event id the push carries; fall back to the
 *    registry's payload hash if there is none.
 */

import type { Adapter } from './types';

export const oagAdapter: Adapter = {
  provider: 'oag',

  verify() {
    return {
      ok: false,
      reason:
        'OAG Flight Info Alerts is not subscribed — it is a separate product from the Flight Info API this repo already calls. See this file’s header.',
    };
  },

  deliveryId() {
    return null;
  },

  normalise() {
    return [];
  },
};
