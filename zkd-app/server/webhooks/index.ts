/**
 * The webhook front door.
 *
 * ── What this replaces, and what it does not ───────────────────────────────
 *
 * `server/engine/statusPoller.ts` asks AviationStack whether anything has
 * happened. That was the best available answer while AviationStack was the only
 * status source, and it has a hard ceiling: **AviationStack is a pull API with
 * no webhook support at all**, so the poller is not an interim shortcut that
 * could be tuned — it is the maximum that vendor can do. 100 calls a month buys
 * a couple of near-departure flights checked every five minutes.
 *
 * A push feed inverts the economics: nothing is spent while nothing happens,
 * every subscribed flight is watched rather than the two most urgent, and the
 * signal arrives in seconds.
 *
 * **It does not replace the other two lanes**, and that is deliberate. Three
 * imperfect detectors covering each other's gaps is the honest architecture:
 * the webhook is fastest but can silently stop; the poller is bounded but
 * self-driven; the member standing at the gate is the only one that works when
 * both feeds are wrong. What changes here is the ordering, not the roster.
 *
 * ── The failure mode this file is most worried about ───────────────────────
 *
 * **A dead webhook looks exactly like a quiet week.** If a subscription lapses,
 * credits run out, or the registered URL stops resolving, the observable
 * behaviour is "no cancellations arrived" — which is also what a good week
 * looks like. We would find out from a stranded member.
 *
 * So delivery is treated as a heartbeat, not just a trigger: `lastDeliveryAt`
 * is recorded per provider, `health()` reports the lane as degraded once that
 * goes stale, and the poller reads that to decide whether to stand down or take
 * over. This is the same lesson the notification ladder learned in the outbound
 * direction — an undeliverable channel is a safety defect, not a cosmetic one —
 * applied to the inbound one.
 */

import { classify } from '@/lib/disruptionKind';
import * as store from '../domain/store';
import { triggerEventRescore } from '../engine/forecast';
import { detectDisruption } from '../engine/simulation';
import { duffelAdapter } from './duffel';
import { aerodataboxAdapter } from './aerodatabox';
import { oagAdapter } from './oag';
import type { Adapter, DeliveryResult, NormalisedFlightEvent, WebhookProvider } from './types';

export type { WebhookProvider, DeliveryResult, NormalisedFlightEvent } from './types';

const ADAPTERS: Record<WebhookProvider, Adapter> = {
  duffel: duffelAdapter,
  aerodatabox: aerodataboxAdapter,
  oag: oagAdapter,
};

export function adapterFor(provider: string): Adapter | null {
  return ADAPTERS[provider as WebhookProvider] ?? null;
}

/**
 * Deliveries already processed.
 *
 * Bounded, because this is a long-lived process and an unbounded Set keyed by
 * every delivery id we have ever seen is a slow leak. The window only has to
 * outlast a provider's retry schedule — minutes, not days — so a few thousand
 * ids is generous.
 *
 * Same process-lifetime caveat as server/cache.ts: a restart forgets, and the
 * consequence is bounded. A re-processed cancellation is absorbed downstream
 * because `detectDisruption` is idempotent — it returns the existing event
 * rather than starting a second recovery. Dedupe here is an optimisation and a
 * clean audit trail; the real protection is that the thing it guards cannot be
 * done twice anyway.
 */
type ProviderHealth = { lastDeliveryAt: number | null; deliveries: number; matched: number };

const SEEN_LIMIT = 5000;

/**
 * ── Why this state hangs off globalThis ────────────────────────────────────
 *
 * Because module-level state is NOT shared between route handlers here, and
 * that was found the hard way: three deliveries were accepted and acted on by
 * the webhook route, and `/api/pipeline/health` still reported zero. Next
 * bundles each route separately, so `server/webhooks/index.ts` was instantiated
 * twice — the receiver incremented one set of counters and the health endpoint
 * read another.
 *
 * The consequence is worse than a wrong number on a dashboard. The whole point
 * of the heartbeat is that a dead feed must not look like a quiet week; a
 * heartbeat the health endpoint cannot see reports every provider as stale
 * forever, so the poller would never stand down and — far worse — an operator
 * reading "STALE" on a perfectly healthy feed learns to ignore the one
 * indicator built to be trusted.
 *
 * `globalThis` is the same escape hatch `server/engine/batchScorer.ts`,
 * `statusPoller.ts` and `subscriptions.ts` already use for their timers, for
 * exactly this reason. Unit tests import one instance and never see the split,
 * which is precisely why this needed a running server to catch.
 */
type WebhookState = {
  seen: Map<string, number>;
  health: Record<WebhookProvider, ProviderHealth>;
};

const gw = globalThis as typeof globalThis & { __zkdWebhookState?: WebhookState };

function state(): WebhookState {
  return (gw.__zkdWebhookState ??= {
    seen: new Map(),
    health: {
      duffel: { lastDeliveryAt: null, deliveries: 0, matched: 0 },
      aerodatabox: { lastDeliveryAt: null, deliveries: 0, matched: 0 },
      oag: { lastDeliveryAt: null, deliveries: 0, matched: 0 },
    },
  });
}

function remember(key: string): boolean {
  const { seen } = state();
  if (seen.has(key)) return false;
  seen.set(key, Date.now());
  if (seen.size > SEEN_LIMIT) {
    // Oldest first — Map preserves insertion order, so this is just the head.
    const excess = seen.size - SEEN_LIMIT;
    let i = 0;
    for (const k of seen.keys()) {
      if (i++ >= excess) break;
      seen.delete(k);
    }
  }
  return true;
}

/* ── heartbeat ───────────────────────────────────────────────────────────── */

/**
 * How long a registered provider may stay silent before we stop trusting it.
 *
 * Six hours is not "how often we expect a cancellation" — it is how long we are
 * willing to be unable to tell the difference between a healthy quiet feed and
 * a dead one. Providers that support a periodic keepalive should use it; for
 * those that do not, this is a deliberately blunt instrument whose only job is
 * to make silence visible on /ops rather than invisible.
 */
export const HEARTBEAT_STALE_MS = 6 * 60 * 60_000;

export type WebhookLaneStatus = {
  /** false when WEBHOOK_PUBLIC_URL is unset — nothing is registered anywhere */
  registered: boolean;
  /** why not, when not */
  reason: string | null;
  providers: {
    provider: WebhookProvider;
    configured: boolean;
    lastDeliveryAt: number | null;
    deliveries: number;
    matched: number;
    stale: boolean;
  }[];
  /** true when the webhook lane can be relied on as primary detection */
  primary: boolean;
};

function isConfigured(p: WebhookProvider): boolean {
  if (p === 'duffel') return !!process.env.DUFFEL_WEBHOOK_SECRET;
  if (p === 'aerodatabox') return !!process.env.AERODATABOX_API_KEY && !!process.env.WEBHOOK_SHARED_SECRET;
  return false; // OAG: no active subscription — see ./oag.ts
}

/**
 * What /ops shows, and what the poller reads to decide whether to stand down.
 *
 * `primary` is deliberately conservative: a provider that has never delivered
 * anything is NOT counted as healthy, because "registered but never heard from"
 * is the exact state a misconfigured subscription sits in. The lane has to earn
 * primary by actually delivering something.
 */
export function laneStatus(now = Date.now()): WebhookLaneStatus {
  const publicUrl = process.env.WEBHOOK_PUBLIC_URL;
  const { health } = state();
  const providers = (Object.keys(ADAPTERS) as WebhookProvider[]).map((provider) => {
    const h = health[provider];
    return {
      provider,
      configured: isConfigured(provider),
      lastDeliveryAt: h.lastDeliveryAt,
      deliveries: h.deliveries,
      matched: h.matched,
      stale: h.lastDeliveryAt === null || now - h.lastDeliveryAt > HEARTBEAT_STALE_MS,
    };
  });

  return {
    registered: !!publicUrl,
    reason: publicUrl
      ? null
      : 'WEBHOOK_PUBLIC_URL is not set — the receiver is live but no subscriptions are registered, so detection is still polling plus member reports.',
    providers,
    primary: !!publicUrl && providers.some((p) => p.configured && !p.stale),
  };
}

/** Test seam, and used by /ops after a manual replay. */
export function _resetWebhookState(): void {
  const s = state();
  s.seen.clear();
  for (const k of Object.keys(s.health) as WebhookProvider[]) {
    s.health[k] = { lastDeliveryAt: null, deliveries: 0, matched: 0 };
  }
}

/* ── handling a delivery ─────────────────────────────────────────────────── */

/**
 * Verify → dedupe → normalise → act.
 *
 * Never throws. The route awaits this while holding an open connection to a
 * provider that will retry on anything non-2xx, and an exception escaping here
 * would turn one bad payload into an indefinite retry loop.
 */
export async function handleDelivery(
  provider: string,
  rawBody: string,
  headers: Headers,
): Promise<DeliveryResult> {
  const adapter = adapterFor(provider);
  if (!adapter) return { ok: false, matched: false, duplicate: false, detail: `unknown provider "${provider}"` };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, matched: false, duplicate: false, detail: 'body was not JSON' };
  }

  const h = state().health[adapter.provider];
  h.lastDeliveryAt = Date.now();
  h.deliveries += 1;

  const id = adapter.deliveryId(payload) ?? `${adapter.provider}:${simpleHash(rawBody)}`;
  if (!remember(`${adapter.provider}:${id}`)) {
    return { ok: true, matched: false, duplicate: true, detail: `duplicate delivery ${id}` };
  }

  const events = adapter.normalise(payload);
  if (events.length === 0) {
    return { ok: true, matched: false, duplicate: false, detail: 'nothing disruption-shaped in this delivery' };
  }

  let matched = 0;
  const notes: string[] = [];
  for (const event of events) {
    const outcome = await act(event).catch((e) => `error: ${e instanceof Error ? e.message : String(e)}`);
    if (outcome.startsWith('acted')) matched += 1;
    notes.push(outcome);
  }
  h.matched += matched;

  return {
    ok: true,
    matched: matched > 0,
    duplicate: false,
    detail: notes.join('; '),
  };
}

/**
 * One normalised event against our own bookings.
 *
 * Everything below the resolution step is the machinery the status poller
 * already uses — `classify()` against the BOOKED departure, an event rescore,
 * then `detectDisruption`. Reused rather than reimplemented, so the two lanes
 * cannot drift into disagreeing about what counts as a cancellation.
 */
async function act(event: NormalisedFlightEvent): Promise<string> {
  const flight = await resolveFlight(event);
  if (!flight) return `no tracked flight matches ${event.flightCode}`;

  const classification = classify({
    status: event.status,
    // The BOOKED departure, not the current one. A carrier that moves a flight
    // also moves its own schedule, so the delay it reports against the new time
    // is zero — diffing against what the member actually booked is the only way
    // a reschedule is visible at all.
    bookedDepartureAt: new Date(flight.depISO).getTime(),
    scheduledDepartureAt: event.scheduledDepartureAt,
    delayMinutes: event.delayMinutes,
    connectionSlackMinutes: flight.connectionSlackMinutes,
  });

  if (classification.kind === 'none') return `acted: ${flight.code} — no disruption in this change`;

  triggerEventRescore(flight.id);

  // Only a cancellation starts a recovery. A reschedule or a delay-cascade
  // moves the forecast and may well escalate the band into an alert, but it is
  // not a cancelled flight — and treating it as one spends money on an aircraft
  // that is still going to fly.
  if (classification.kind !== 'cancellation') {
    return `acted: ${flight.code} — ${classification.kind}, rescored`;
  }

  await detectDisruption(flight.id);
  return `acted: ${flight.code} — cancellation, recovery started`;
}

/**
 * Which of our flights a provider is talking about.
 *
 * Flight codes are reused daily, so a code alone is ambiguous: "6E 5231" is a
 * different aircraft every day of the week. The departure date disambiguates,
 * and where the provider gave us one it is required to match. Where it did not,
 * we fall back to the single upcoming flight with that code — and refuse rather
 * than guess if there is more than one, because acting on the wrong day's
 * flight would cancel a trip that is still going ahead.
 */
async function resolveFlight(event: NormalisedFlightEvent) {
  const wanted = normaliseCode(event.flightCode);
  const flights = (await store.listFlights()).filter((f) => normaliseCode(f.code) === wanted);
  if (flights.length === 0) return null;

  if (event.departureDate) {
    const onDate = flights.filter((f) => f.depISO.slice(0, 10) === event.departureDate);
    if (onDate.length === 1) return onDate[0];
    if (onDate.length > 1) return null;
  }

  const upcoming = flights.filter((f) => new Date(f.depISO).getTime() > Date.now() - 6 * 3_600_000);
  return upcoming.length === 1 ? upcoming[0] : null;
}

/** "6E 5231", "6E5231" and "6e 5231" are the same flight to every provider but us. */
function normaliseCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
