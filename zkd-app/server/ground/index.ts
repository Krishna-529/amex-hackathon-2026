/**
 * Ground transfers — the third limb.
 *
 * Uber's sandbox is more capable than an estimate API: it exercises the whole
 * ride-request flow, including cancellation, against real geography without
 * dispatching a real car. That makes ground a genuinely compensable saga step
 * rather than a decorative one, and — via `PUT /sandbox/products/{id}` — it
 * makes the rollback path testable *on demand* instead of by luck.
 *
 * ── Ground failure must not roll back the trip ─────────────────────────────
 *
 * Only the flight and the hotel are trip-critical. A member with a seat and a
 * bed but no cab has a recoverable inconvenience; tearing up their confirmed
 * flight and hotel because a sandbox rideshare declined would be a far worse
 * outcome than the problem it "solves". So a ground failure degrades — the run
 * still reaches CONFIRMED, with an orphan recorded and a note saying plainly
 * what did not happen. That policy lives in the saga; this module's job is to
 * report honestly enough for the saga to apply it.
 *
 * ── Auth ───────────────────────────────────────────────────────────────────
 *
 * OAuth2 client credentials, not a static key — cached the same way
 * server/suppliers/sabre.ts caches its token. `UBER_API_HOST` defaults to the
 * sandbox so production is never one typo away.
 */

import { getOrSet, invalidate } from '../cache';
import { withBudget, noteOutcome } from '../governor';
import type { Money } from '../suppliers/types';
import type { CabOpt } from '../domain/types';
import type { GroundRules } from '../preferences/adapt';

export type GroundSupplierId = 'uber' | 'privatecar';
export type GroundStatus = 'ok' | 'empty' | 'no-key' | 'error' | 'rate-limited';

export type GroundOffer = {
  id: string;
  supplier: GroundSupplierId;
  /** the product/class handle a request is placed against */
  supplierProductId: string;
  kind: string;
  seats: number;
  /** minutes until pickup, as quoted; null when the source does not say */
  etaMinutes: number | null;
  price: Money;
  /** true when this can actually be requested and cancelled */
  live: boolean;
  why: string;
};

export type GroundSearchParams = {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  /** how many people travel together — a family of four rules out a hatchback */
  seatsNeeded: number;
  currency: string;
  lane?: 'refresh' | 'confirm';
};

export type GroundSearchResult = {
  offers: GroundOffer[];
  sources: Partial<Record<GroundSupplierId, GroundStatus>>;
};

const HOST = () => process.env.UBER_API_HOST ?? 'https://sandbox-api.uber.com';

async function uberToken(): Promise<string | null> {
  const id = process.env.UBER_CLIENT_ID;
  const secret = process.env.UBER_CLIENT_SECRET;
  if (!id || !secret) return null;

  return getOrSet('uber:token', 25 * 60 * 1000, async () => {
    const res = await fetch('https://login.uber.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: 'client_credentials',
        scope: 'request',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`uber token ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('uber token: no access_token');
    return json.access_token;
  }).catch(() => null);
}

/**
 * Every Uber request goes through here rather than calling `fetch` with a
 * captured token, specifically so a stale-but-cached token can be recovered
 * from mid-run.
 *
 * `uberToken()` caches for 25 minutes, but that is our guess at the token's
 * life, not the vendor's guarantee — a token can be rejected before its TTL if
 * it was revoked, clock-skewed, or rotated on Uber's side. Without this, that
 * shows up as a plain 401 partway through HOLD_PENDING or the saga's ground
 * step, `noteOutcome` reads it as a provider failure and starts exponential
 * backoff, and the member's cab search is throttled for up to a minute over
 * what was actually a one-line cache problem.
 *
 * On a 401, the cached token is evicted and exactly one fresh attempt is made.
 * A second 401 after a genuinely new token means the credential itself is bad,
 * not merely stale — that one is allowed to fall through to the caller's
 * normal error handling (and does get to trip the governor's backoff, correctly).
 */
async function uberFetch(url: URL | string, init: RequestInit = {}, retrying = false): Promise<Response> {
  const token = await uberToken();
  if (!token) throw new Error('no uber credentials configured');

  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(10000),
  });

  if (res.status === 401 && !retrying) {
    invalidate('uber:token');
    return uberFetch(url, init, true);
  }
  return res;
}

type UberPrice = {
  product_id?: string;
  display_name?: string;
  low_estimate?: number;
  high_estimate?: number;
  currency_code?: string;
  surge_multiplier?: number;
};

type UberTime = { product_id?: string; estimate?: number };

/** Uber does not return capacity on an estimate; these are the published counts. */
function seatsFor(displayName: string): number {
  const n = displayName.toLowerCase();
  if (n.includes('xl') || n.includes('suv') || n.includes('van')) return 6;
  if (n.includes('auto') || n.includes('moto') || n.includes('bike')) return 1;
  return 4;
}

async function uberSearch(p: GroundSearchParams): Promise<{ offers: GroundOffer[]; status: GroundStatus }> {
  // Fast no-key path before spending anything — uberFetch would also refuse,
  // but there is no reason to enter withBudget's accounting for a call that
  // was never going to happen.
  const token = await uberToken();
  if (!token) return { offers: [], status: 'no-key' };

  return withBudget(
    'uber',
    p.lane ?? 'refresh',
    1,
    async () => {
      const priceUrl = new URL(`${HOST()}/v1.2/estimates/price`);
      priceUrl.searchParams.set('start_latitude', String(p.fromLat));
      priceUrl.searchParams.set('start_longitude', String(p.fromLon));
      priceUrl.searchParams.set('end_latitude', String(p.toLat));
      priceUrl.searchParams.set('end_longitude', String(p.toLon));

      const timeUrl = new URL(`${HOST()}/v1.2/estimates/time`);
      timeUrl.searchParams.set('start_latitude', String(p.fromLat));
      timeUrl.searchParams.set('start_longitude', String(p.fromLon));

      const langHeader = { 'Accept-Language': 'en_US' };
      const [priceRes, timeRes] = await Promise.all([
        uberFetch(priceUrl, { headers: langHeader }),
        uberFetch(timeUrl, { headers: langHeader }),
      ]);
      if (!priceRes.ok) {
        noteOutcome('uber', { ok: false, status: priceRes.status });
        return { offers: [], status: 'error' as GroundStatus };
      }

      const priceJson = (await priceRes.json()) as { prices?: UberPrice[] };
      const timeJson = timeRes.ok ? ((await timeRes.json()) as { times?: UberTime[] }) : { times: [] };
      const etaBy = new Map((timeJson.times ?? []).map((t) => [t.product_id, t.estimate]));

      const offers = (priceJson.prices ?? [])
        .map((row): GroundOffer | null => {
          if (!row.product_id || !row.display_name) return null;
          // Take the HIGH estimate. A range shown to a member becomes the number
          // they remember, and a single-use card issued for too little fails at
          // the worst possible moment.
          const amount = row.high_estimate ?? row.low_estimate;
          if (amount === undefined) return null;
          const eta = etaBy.get(row.product_id);
          const surge = row.surge_multiplier ?? 1;
          return {
            id: `uber:${row.product_id}`,
            supplier: 'uber',
            supplierProductId: row.product_id,
            kind: row.display_name,
            seats: seatsFor(row.display_name),
            etaMinutes: typeof eta === 'number' ? Math.round(eta / 60) : null,
            price: { amount: Math.round(amount), currency: row.currency_code ?? p.currency },
            live: true,
            why: surge > 1
              ? `${row.display_name} — ${surge}x surge in effect, priced at the top of the quoted range`
              : `${row.display_name} — sandbox request, cancellable, no real-world trip`,
          };
        })
        .filter((o): o is GroundOffer => o !== null)
        .filter((o) => o.seats >= p.seatsNeeded);

      return { offers, status: (offers.length ? 'ok' : 'empty') as GroundStatus };
    },
    () => ({ offers: [], status: 'rate-limited' as GroundStatus }),
  ).catch(() => ({ offers: [], status: 'error' as GroundStatus }));
}

/**
 * Deterministic mocked aggregator.
 *
 * Exists because Uber returns no products on many Indian domestic routes, and
 * server/domain/pricing.ts divides by `cab.seats` to compute how many vehicles
 * a party needs — an empty ground list silently breaks the party-of-six path.
 * Same FNV-hash construction as server/suppliers/travelport.ts so a route
 * prices the same way twice, and `live: false` so it can never be committed
 * against or falsely compensated.
 */
function privateCarSearch(p: GroundSearchParams): { offers: GroundOffer[]; status: GroundStatus } {
  const h = hash(`${p.fromLat.toFixed(2)}:${p.toLat.toFixed(2)}:${p.seatsNeeded}`);
  const base = 700 + (h % 900);

  const classes: { kind: string; seats: number; mult: number }[] = [
    { kind: 'Private sedan', seats: 4, mult: 1 },
    { kind: 'Private SUV', seats: 6, mult: 1.45 },
    { kind: 'Shared van', seats: 8, mult: 1.8 },
  ];

  const offers = classes
    .filter((c) => c.seats >= p.seatsNeeded)
    .map((c) => ({
      id: `privatecar:${c.kind.toLowerCase().replace(/\s+/g, '-')}`,
      supplier: 'privatecar' as const,
      supplierProductId: c.kind,
      kind: c.kind,
      seats: c.seats,
      etaMinutes: 25 + (h % 20),
      price: { amount: Math.round(base * c.mult), currency: p.currency },
      live: false,
      why: 'Indicative private-hire quote — no aggregator is wired, so this is a placeholder the agent will not book',
    }));

  return { offers, status: offers.length ? 'ok' : 'empty' };
}

/**
 * Waterfall over the member's stated `provider_hierarchy`.
 *
 * Providers we have not registered (lyft, mozio, karhoo, blacklane) are
 * skipped rather than treated as errors — the list expresses intent, not a
 * manifest of what exists here. The private-car mock always runs last so the
 * party-size maths has something to work with on routes Uber does not cover.
 */
export async function searchGround(
  params: GroundSearchParams,
  rules?: GroundRules,
): Promise<GroundSearchResult> {
  const order = rules?.providerHierarchy ?? ['uber'];
  const sources: GroundSearchResult['sources'] = {};
  const all: GroundOffer[] = [];

  for (const provider of order) {
    if (provider !== 'uber') continue; // not registered here; silently skipped
    const r = await uberSearch(params);
    sources.uber = r.status;
    all.push(...r.offers);
    // A live, bookable set is enough — do not spend budget on a fallback we
    // would rank below it anyway.
    if (r.offers.length > 0) break;
  }

  if (all.length === 0) {
    const fallback = privateCarSearch(params);
    sources.privatecar = fallback.status;
    all.push(...fallback.offers);
  }

  const tierRank = (kind: string, tier: GroundRules['vehicleTier'] | undefined) => {
    if (!tier || tier === 'standard') return 0;
    const k = kind.toLowerCase();
    if (tier === 'xl') return /xl|suv|van/.test(k) ? -1 : 0;
    if (tier === 'luxury') return /lux|black|premier/.test(k) ? -1 : 0;
    if (tier === 'eco') return /green|eco|electric/.test(k) ? -1 : 0;
    return 0;
  };

  // Bookable first, then the member's tier, then soonest, then cheapest.
  // Cheapest-first would rank an unbookable placeholder above a real ride.
  const offers = all.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const t = tierRank(a.kind, rules?.vehicleTier) - tierRank(b.kind, rules?.vehicleTier);
    if (t !== 0) return t;
    return (a.etaMinutes ?? 30) - (b.etaMinutes ?? 30) || a.price.amount - b.price.amount;
  });

  return { offers, sources };
}

/** Drops options above the member's separate ground budget. */
export function withinGroundCap(
  offers: GroundOffer[],
  cap: { amount: number; currency: string } | null,
): GroundOffer[] {
  if (!cap || cap.amount <= 0) return offers;
  // Different currency means we cannot compare, and the repo does not invent
  // rates. Keep the option and let the consent gate decide.
  return offers.filter((o) => o.price.currency !== cap.currency || o.price.amount <= cap.amount);
}

export function toCabOpt(o: GroundOffer): CabOpt {
  return {
    id: o.id,
    kind: o.kind,
    seats: o.seats,
    extra: o.price.amount,
    currency: o.price.currency,
    ok: o.live,
    why: o.why,
  };
}

// ── Sandbox failure injection ──────────────────────────────────────────────

/**
 * Drives `PUT /sandbox/products/{product_id}` to make the rollback path
 * testable deliberately rather than by luck.
 *
 * Setting `drivers_available: false` makes the ground step fail on demand,
 * which is how the two-tier failure policy gets proven: the run must still
 * reach CONFIRMED with an orphan, and the flight and hotel must NOT be rolled
 * back. `surge_multiplier` exercises the party-cost path against the member's
 * cap.
 *
 * Refuses to run against anything but a sandbox host — this endpoint does not
 * exist in production, and an accidental call there is not a scenario worth
 * being one typo away from.
 */
export async function injectSandboxScenario(
  productId: string,
  scenario: { surge_multiplier?: number; drivers_available?: boolean },
): Promise<{ ok: boolean; detail: string }> {
  const host = HOST();
  if (!host.includes('sandbox')) {
    return { ok: false, detail: 'refused: UBER_API_HOST is not a sandbox host' };
  }
  const token = await uberToken();
  if (!token) return { ok: false, detail: 'no uber credentials configured' };

  try {
    const res = await uberFetch(`${host}/v1.2/sandbox/products/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario),
    });
    return res.ok
      ? { ok: true, detail: `sandbox product ${productId} set to ${JSON.stringify(scenario)}` }
      : { ok: false, detail: `uber returned ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
