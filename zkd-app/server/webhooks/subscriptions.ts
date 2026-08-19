/**
 * Telling a provider where to push, and which flights to watch.
 *
 * ── Deliberately inert until there is somewhere to push to ─────────────────
 *
 * A webhook needs a publicly reachable HTTPS endpoint, and this app runs on
 * localhost:5176 for development — with AGENTS.md explicitly warning against
 * binding 0.0.0.0 on conference Wi-Fi. Rather than couple the whole receiver to
 * a tunnel or a deployment, everything here keys off one variable:
 *
 *   WEBHOOK_PUBLIC_URL unset  → nothing is registered. The receiver, the
 *                               adapters, verification, dedupe and the
 *                               watchdog all still work and are fully
 *                               exercisable with curl against localhost.
 *                               Detection stays on the poller plus member
 *                               reports, and /ops says so in those words.
 *
 *   WEBHOOK_PUBLIC_URL set    → subscriptions are registered against that
 *                               origin, and re-registered whenever it differs
 *                               from the one last used.
 *
 * That last clause is what makes an ephemeral tunnel survivable: a cloudflared
 * URL changes every restart, and a subscription pointing at yesterday's tunnel
 * is worse than no subscription because it looks registered and silently
 * delivers nowhere.
 *
 * **When this is hosted, setting that one variable is the whole job.** Recorded
 * in memory.md so nobody has to rediscover it.
 *
 * ── Why only AeroDataBox is registered here ────────────────────────────────
 *
 * Duffel webhooks are configured once in the Duffel dashboard against an
 * account, not per flight, so there is nothing per-flight to register. And they
 * only fire for orders booked THROUGH Duffel — this app books none today, so
 * the lane is wired and correct and will stay quiet until booking origination
 * exists. OAG has no active subscription (see ./oag.ts).
 */

import * as store from '../domain/store';
import { getThresholdConfig } from '@/lib/thresholdConfig';
import { tierFor } from '../engine/rescoreTiming';
import type { Flight } from '../domain/types';

const AERODATABOX_BASE = 'https://aerodatabox.p.rapidapi.com';

const g = globalThis as typeof globalThis & {
  __zkdWebhookSubs?: Map<string, { url: string; at: number }>;
  __zkdWebhookSubsTimer?: NodeJS.Timeout;
};

function subs(): Map<string, { url: string; at: number }> {
  return (g.__zkdWebhookSubs ??= new Map());
}

/** Where a provider should POST. The token rides in a header we set on the URL's behalf. */
export function receiverUrl(provider: string): string | null {
  const base = process.env.WEBHOOK_PUBLIC_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/api/webhooks/flight-status/${provider}`;
}

/** Which flights are worth a subscription — and worth the credits. */
export function flightsToSubscribe(flights: Flight[], now = Date.now()): Flight[] {
  const cfg = getThresholdConfig();
  return flights.filter((f) => {
    const departsAt = new Date(f.depISO).getTime();
    // Already gone, or too far out to be worth watching yet. Subscriptions are
    // cheap to create but notifications cost a credit each, and a flight three
    // weeks out will generate a lot of schedule noise before it matters.
    if (departsAt < now) return false;
    if (departsAt > now + 3 * 24 * 3_600_000) return false;
    return tierFor(f, cfg, now) !== 'dormant';
  });
}

export function isSubscribed(flightId: string): boolean {
  const url = receiverUrl('aerodatabox');
  const held = subs().get(flightId);
  return !!url && !!held && held.url === url;
}

export function subscriptionCount(): number {
  return subs().size;
}

/**
 * Registers anything not already registered against the CURRENT public URL.
 *
 * Never throws: this runs from startup and from a timer, and a provider being
 * unreachable must degrade detection to the poller rather than take the process
 * down with it.
 */
export async function syncSubscriptions(): Promise<{ registered: number; skipped: string | null }> {
  const url = receiverUrl('aerodatabox');
  if (!url) {
    return {
      registered: 0,
      skipped:
        'WEBHOOK_PUBLIC_URL is not set — no subscriptions registered. The receiver is live and testable locally; detection stays on the poller plus member reports.',
    };
  }

  const key = process.env.AERODATABOX_API_KEY;
  if (!key) return { registered: 0, skipped: 'AERODATABOX_API_KEY is not set' };
  if (!process.env.WEBHOOK_SHARED_SECRET) {
    // Registering without the shared secret would create a subscription this
    // receiver then rejects every delivery from — burning credits to be ignored.
    return { registered: 0, skipped: 'WEBHOOK_SHARED_SECRET is not set — refusing to register an endpoint that would reject its own deliveries' };
  }

  let registered = 0;
  for (const flight of flightsToSubscribe(await store.listFlights())) {
    if (isSubscribed(flight.id)) continue;
    const ok = await registerAerodatabox(flight, url, key).catch(() => false);
    if (ok) {
      subs().set(flight.id, { url, at: Date.now() });
      registered += 1;
    }
  }
  return { registered, skipped: null };
}

async function registerAerodatabox(flight: Flight, url: string, key: string): Promise<boolean> {
  const number = flight.code.replace(/\s+/g, '');
  const res = await fetch(
    `${AERODATABOX_BASE}/subscriptions/webhook/FlightByNumber/${encodeURIComponent(number)}?useCredits=true`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com',
      },
      body: JSON.stringify({
        url,
        // The receiver authenticates on this header (see ./aerodatabox.ts).
        headers: { 'X-ZKD-Webhook-Token': process.env.WEBHOOK_SHARED_SECRET },
        // Two retries. Their credits are charged on SEND, not delivery, so
        // unlimited retries against a briefly-down endpoint is a way to spend
        // an allowance on nothing.
        maxDeliveryRetries: 2,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    console.warn(`[webhook:subscriptions] ${number} registration failed: ${res.status}`);
    return false;
  }
  return true;
}

const SYNC_INTERVAL_MS = 30 * 60_000;

/**
 * Idempotent, matching startBatchScorer and startStatusPoller — Next's dev-mode
 * HMR re-invokes instrumentation.ts's register(), and duplicate subscription
 * loops would double the credit spend.
 */
export function startSubscriptionSync(): void {
  if (g.__zkdWebhookSubsTimer) return;

  const run = async () => {
    try {
      const { registered, skipped } = await syncSubscriptions();
      if (skipped) console.log(`[webhook:subscriptions] ${skipped}`);
      else if (registered > 0) console.log(`[webhook:subscriptions] registered ${registered} flight(s)`);
    } catch (e) {
      console.error('[webhook:subscriptions] sync failed:', e);
    }
  };

  void run();
  g.__zkdWebhookSubsTimer = setInterval(run, SYNC_INTERVAL_MS);
}
