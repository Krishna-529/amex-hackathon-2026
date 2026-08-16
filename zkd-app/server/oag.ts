/**
 * OAG — real flight schedule/status data, used both as a live-inference
 * feature source and, per §5 of documentation/design/02-data-sources-and-apis.md's
 * successor doc, as the substrate Lumo itself is built on (Lumo's own case
 * study says so). We now build the risk model ourselves, so this is not a
 * fallback behind a vendor forecast — it is one of the model's real inputs.
 *
 * Auth: Azure API Management dual-key subscription, header `Subscription-Key`
 * (see https://knowledge.oag.com/docs/flight-info-api-getting-started). Two
 * keys per product (primary/secondary) so either can be rotated without a
 * gap; this client tries primary first and falls back to secondary on
 * 401/403/429 within the same call.
 *
 * TRIAL BUDGET: OAG_FLIGHT_INFO_TRIAL is capped at 100 calls TOTAL over a
 * 14-day window (not per-day, not per-month) — see .env.example. That is
 * small enough that a page-view-driven poll would exhaust it in minutes, so
 * every call here is (a) batched — up to 100 flight numbers per request —
 * and (b) counted against a persisted, process-crash-surviving budget that
 * hard-stops at the cap rather than silently degrading to a guess. Spend it
 * on the batch feature-refresh job (server/engine/riskModel.ts), not on
 * every UI poll — server/engine/forecast.ts's own TTL/in-flight-request
 * cache is what keeps a poll from ever reaching this file directly.
 *
 * Endpoint paths below are grounded against developers.oag.com and
 * knowledge.oag.com as of Aug 2026 (Flight Instances API v2, Master Data
 * Locations/Carriers/Equipment) — VERIFIED LIVE AGAINST THE TRIAL KEY twice:
 *
 * 1. 2026-08-14: `https://api.oag.com/flight-instances/` with `version=2`
 *    returned a real 404 `{"statusCode":404,"message":"Resource not found"}`
 *    — not a 401/403, so `Subscription-Key: <key>` was reaching the gateway
 *    and authenticating fine; the request itself was malformed.
 * 2. 2026-08-14: same base path with `version=v2` (not `2`) returned a real
 *    400 — the endpoint IS reachable once versioned correctly, and OAG's own
 *    validation error told us the actual required shape:
 *    `{"errors":{"":["'CarrierCode', 'ArrivalAirport' or 'DepartureAirport'
 *    should be provided when 'CodeType' is set."],"ArrivalDateTime":["...
 *    must not be empty."],"DepartureDateTime":["... must not be empty."]}}`
 *    — i.e. this endpoint filters by carrier + airport + a departure/arrival
 *    datetime RANGE, not the comma-joined `FlightIdentities` multi-flight
 *    batching the original code here assumed (which the error silently
 *    ignored as an unrecognized param). The "up to 100 flights per call"
 *    batching premise in this file's original design does not hold for this
 *    endpoint shape — batching here means widening the datetime range for
 *    one carrier+airport, not joining many flight numbers into one filter.
 *
 * Two calls spent total confirming this (see trialBudget()) — exact
 * DepartureDateTime/ArrivalDateTime format (ISO range? separate params?)
 * is the next thing to confirm with one more real call before wiring this
 * into the live feature-assembly path.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getOrSet } from './cache';

const FLIGHT_INSTANCES_BASE = 'https://api.oag.com/flight-instances/';
const MASTER_DATA_BASE = 'https://api.oag.com/master-data/';

const STATE_DIR = join(process.cwd(), 'server', '.state');
const TRIAL_STATE_PATH = join(STATE_DIR, 'oag-trial-usage.json');
const TRIAL_CALL_CAP = 100;
const TRIAL_WINDOW_DAYS = 14;

type TrialState = { firstCallAt: number; callsUsed: number };

function loadTrialState(): TrialState {
  try {
    return JSON.parse(readFileSync(TRIAL_STATE_PATH, 'utf-8')) as TrialState;
  } catch {
    return { firstCallAt: 0, callsUsed: 0 };
  }
}

function saveTrialState(s: TrialState) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(TRIAL_STATE_PATH, JSON.stringify(s));
}

export type TrialBudget = { remaining: number; windowExpiresAt: number | null; exhausted: boolean };

/** Read-only budget check — call before any batch job that would spend trial calls. */
export function trialBudget(): TrialBudget {
  const s = loadTrialState();
  if (!s.firstCallAt) return { remaining: TRIAL_CALL_CAP, windowExpiresAt: null, exhausted: false };
  const windowExpiresAt = s.firstCallAt + TRIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() > windowExpiresAt) return { remaining: TRIAL_CALL_CAP, windowExpiresAt: null, exhausted: false };
  const remaining = Math.max(0, TRIAL_CALL_CAP - s.callsUsed);
  return { remaining, windowExpiresAt, exhausted: remaining <= 0 };
}

/** Reserves N calls against the trial budget. Throws rather than silently over-spending. */
function reserveTrialCalls(n: number) {
  const usingTrial = !!process.env.OAG_FLIGHT_INFO_TRIAL_PRIMARY_KEY && !process.env.OAG_FLIGHT_INFO_PRIMARY_KEY;
  if (!usingTrial) return; // production key has its own contracted quota, not tracked here
  const s = loadTrialState();
  const now = Date.now();
  const expired = s.firstCallAt && now > s.firstCallAt + TRIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const next: TrialState = expired || !s.firstCallAt ? { firstCallAt: now, callsUsed: 0 } : s;
  if (next.callsUsed + n > TRIAL_CALL_CAP) {
    throw new Error(
      `OAG trial budget exhausted: ${next.callsUsed}/${TRIAL_CALL_CAP} calls used this 14-day window ` +
        `(window ${expired ? 'reset' : 'started'} ${new Date(next.firstCallAt).toISOString()}). ` +
        `Refusing to spend more rather than degrade to a guess.`,
    );
  }
  next.callsUsed += n;
  saveTrialState(next);
}

type KeyPair = { primary?: string; secondary?: string };

function keyPairFor(product: 'FLIGHT_INFO' | 'FLIGHT_INFO_CONNECTIONS' | 'MASTER_DATA'): KeyPair {
  const trial = product === 'FLIGHT_INFO';
  const primary =
    process.env[`OAG_${product}_PRIMARY_KEY`] || (trial ? process.env.OAG_FLIGHT_INFO_TRIAL_PRIMARY_KEY : undefined);
  const secondary =
    process.env[`OAG_${product}_SECONDARY_KEY`] ||
    (trial ? process.env.OAG_FLIGHT_INFO_TRIAL_SECONDARY_KEY : undefined);
  return { primary, secondary };
}

async function callWithKeyRotation(url: string, pair: KeyPair): Promise<Response> {
  if (!pair.primary && !pair.secondary) throw new Error('no OAG subscription key configured for this product');
  const keys = [pair.primary, pair.secondary].filter((k): k is string => !!k);
  let last: Response | null = null;
  for (const key of keys) {
    const res = await fetch(url, { headers: { 'Subscription-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (res.ok) return res;
    if (![401, 403, 429].includes(res.status)) return res; // real error — don't mask it by rotating
    last = res;
  }
  return last!;
}

export type OagFlightInstance = {
  carrierIata: string;
  flightNumber: string;
  departureDate: string;
  origin: string;
  destination: string;
  /** OAG's own status text, e.g. "Cancelled", "Scheduled", "Departed" */
  status: string | null;
  scheduledDepartureUtc: string | null;
  estimatedDepartureUtc: string | null;
  actualDepartureUtc: string | null;
  aircraftType: string | null;
  tailNumber: string | null;
  /** true when OAG's schedule-change flag differs from the originally filed schedule */
  scheduleChanged: boolean;
};

/**
 * Batches multiple flights into as few calls as the endpoint's real query
 * shape allows. NOT YET WIRED TO A WORKING CALL: two real trial calls this
 * session confirmed `version=v2` fixes the routing (see header), and that
 * this endpoint filters by CarrierCode + DepartureAirport/ArrivalAirport +
 * a DepartureDateTime/ArrivalDateTime range — not the comma-joined
 * FlightIdentities list this function was originally written against. That
 * means the "up to 100 flight numbers in one call" batching this function's
 * name promises isn't how this endpoint actually batches (it appears to
 * batch by widening the datetime range for one carrier+airport instead).
 * Throws a real, specific error rather than sending a request already known
 * to be shaped wrong — the exact datetime-range param format is the next
 * thing to confirm with one more real trial call before this can return
 * real data.
 */
export async function flightInstancesBatch(
  _requests: { carrierIata: string; flightNumber: string; departureDate: string }[],
): Promise<OagFlightInstance[]> {
  throw new Error(
    'OAG Flight Instances query shape unconfirmed beyond version=v2 — needs CarrierCode + ' +
      'DepartureAirport/ArrivalAirport + a DepartureDateTime/ArrivalDateTime range, not the ' +
      'FlightIdentities list this function assumed. See server/oag.ts header for the real ' +
      '400 response that revealed this. Confirm the exact datetime-range format with one more ' +
      'real trial call before re-enabling this function.',
  );
}

type RawInstance = {
  carrier?: { iata?: string };
  flightNumber?: string;
  departureDate?: { local?: string };
  departure?: { airport?: { iata?: string }; scheduledTime?: { utc?: string }; estimatedTime?: { utc?: string }; actualTime?: { utc?: string } };
  arrival?: { airport?: { iata?: string } };
  status?: { flightStatus?: string; scheduleChanged?: boolean };
  aircraftType?: { iata?: string };
  registration?: string;
};

function parseInstance(raw: unknown): OagFlightInstance | null {
  const r = raw as RawInstance;
  if (!r.carrier?.iata || !r.flightNumber) return null;
  return {
    carrierIata: r.carrier.iata,
    flightNumber: r.flightNumber,
    departureDate: r.departureDate?.local ?? '',
    origin: r.departure?.airport?.iata ?? '',
    destination: r.arrival?.airport?.iata ?? '',
    status: r.status?.flightStatus ?? null,
    scheduledDepartureUtc: r.departure?.scheduledTime?.utc ?? null,
    estimatedDepartureUtc: r.departure?.estimatedTime?.utc ?? null,
    actualDepartureUtc: r.departure?.actualTime?.utc ?? null,
    aircraftType: r.aircraftType?.iata ?? null,
    tailNumber: r.registration ?? null,
    scheduleChanged: !!r.status?.scheduleChanged,
  };
}

export type OagAirportRef = {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
};

/** Master Data Locations — reference data only, cached hard since it barely changes. */
export async function masterDataAirport(iata: string): Promise<OagAirportRef | null> {
  const pair = keyPairFor('MASTER_DATA');
  if (!pair.primary && !pair.secondary) return null;
  return getOrSet(`oag:airport:${iata}`, 7 * 24 * 60 * 60 * 1000, async () => {
    const url = `${MASTER_DATA_BASE}airports?codeType=IATA&code=${encodeURIComponent(iata)}&version=2`;
    const res = await callWithKeyRotation(url, pair);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: RawAirport[] };
    const a = json.data?.[0];
    if (!a) return null;
    return {
      iata: a.airportCode ?? iata,
      icao: a.icaoCode ?? null,
      name: a.name ?? '',
      city: a.address?.cityName ?? '',
      country: a.address?.countryName ?? '',
      lat: a.geoCode?.latitude ?? null,
      lon: a.geoCode?.longitude ?? null,
    };
  }).catch(() => null);
}

type RawAirport = {
  airportCode?: string;
  icaoCode?: string;
  name?: string;
  address?: { cityName?: string; countryName?: string };
  geoCode?: { latitude?: number; longitude?: number };
};
