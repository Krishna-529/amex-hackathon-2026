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
 * 3. 2026-08-17: RESOLVED, with a real 200. The datetime format is ISO-8601
 *    INTERVAL notation in a single param — slash-separated, not a From/To
 *    pair. `DepartureDateTime` accepts `2026-08-24`, `2026-08-01/2026-08-30`,
 *    `2026-08-24T15:00` or `2026-08-24T15:00/2026-08-24T16:00`. `CodeType` is
 *    mandatory whenever an airport or carrier is named, and `FlightType` no
 *    longer defaults to Scheduled in v2 (both per OAG's own v1→v2 migration
 *    guide). A route query — DepartureAirport + ArrivalAirport + CodeType=IATA
 *    + DepartureDateTime — returned 10 real BOM→DEL instances with real
 *    terminals, times, aircraft types and great-circle distances. That is the
 *    shape flightInstancesByRoute() below sends.
 *
 *    The same call also proved the configured PRODUCTION key is not an active
 *    subscription (real 401) while the TRIAL key answers 200 — which is why
 *    keyPairFor() now falls back across tiers instead of trusting that a
 *    configured production key works. See its header.
 *
 * flightInstancesBatch() below still throws: its per-flight batching premise
 * is genuinely unsupported by this endpoint, and it has no caller. Route
 * search is the query this API actually wants.
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

/**
 * Records N calls against the trial budget. Throws rather than over-spending.
 *
 * Called only once a TRIAL key has actually been used — see callWithKeyRotation.
 * It used to be called up front and skipped entirely whenever a production key
 * was present, which was wrong in the exact situation this repo is in: a
 * production key that is configured but not yet an active subscription. That
 * combination disabled budget tracking while every real call still came out of
 * the trial allowance. Production keys have their own contracted quota and are
 * still not counted here — but now that is decided by which key answered, not
 * by which key happens to be set.
 */
function recordTrialCall(n: number) {
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

type Tier = 'prod' | 'trial';
type SubscriptionKey = { key: string; tier: Tier };
type KeyPair = SubscriptionKey[];

/**
 * Every usable key for this product, best first: production primary/secondary,
 * then the trial pair as a genuine fallback.
 *
 * The trial keys used to be reachable ONLY when no production key was set, on
 * the assumption that a configured production key is a working one. Verified
 * false here on 2026-08-17: the configured production key returns a real 401
 * ("invalid subscription key... active subscription") while the trial key
 * returns a real 200 on the same URL. Under the old logic that combination
 * made every Flight Info call fail with a working key sitting unused in the
 * environment. Rotation now walks tiers, so an unapproved production key
 * degrades to the trial allowance instead of taking the product down.
 */
function keyPairFor(product: 'FLIGHT_INFO' | 'FLIGHT_INFO_CONNECTIONS' | 'MASTER_DATA'): KeyPair {
  const out: KeyPair = [];
  const push = (key: string | undefined, tier: Tier) => {
    if (key) out.push({ key, tier });
  };
  push(process.env[`OAG_${product}_PRIMARY_KEY`], 'prod');
  push(process.env[`OAG_${product}_SECONDARY_KEY`], 'prod');
  if (product === 'FLIGHT_INFO') {
    push(process.env.OAG_FLIGHT_INFO_TRIAL_PRIMARY_KEY, 'trial');
    push(process.env.OAG_FLIGHT_INFO_TRIAL_SECONDARY_KEY, 'trial');
  }
  return out;
}

/**
 * Tries each key in turn, rotating only on the statuses that mean "this key",
 * never on a real error — masking a 400 by retrying it with another key is how
 * a malformed query burns the whole allowance.
 *
 * A trial key is charged against the local budget the moment it is used, hit or
 * miss: OAG counts a rejected request the same way we do. The budget is checked
 * BEFORE spending, so an exhausted allowance refuses rather than degrading to a
 * guess — but only when the remaining candidates are all trial keys.
 */
async function callWithKeyRotation(url: string, pair: KeyPair): Promise<Response> {
  if (pair.length === 0) throw new Error('no OAG subscription key configured for this product');
  let last: Response | null = null;
  for (const { key, tier } of pair) {
    if (tier === 'trial') {
      const budget = trialBudget();
      if (budget.exhausted) {
        if (last) return last;
        throw new Error(
          `OAG trial budget exhausted: ${TRIAL_CALL_CAP}/${TRIAL_CALL_CAP} calls used this 14-day window. ` +
            `Refusing to spend more rather than degrade to a guess.`,
        );
      }
      recordTrialCall(1);
    }
    const res = await fetch(url, { headers: { 'Subscription-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (res.ok) return res;
    if (![401, 403, 429].includes(res.status)) return res; // real error — don't mask it by rotating
    last = res;
  }
  return last!;
}

export type OagFlightInstance = {
  carrierIata: string;
  /** always a string here; v2 sends it as a number */
  flightNumber: string;
  /** LOCAL departure date, YYYY-MM-DD — what a member would call "the date" */
  departureDate: string;
  origin: string;
  destination: string;
  departureTerminal: string | null;
  arrivalTerminal: string | null;
  /** OAG's own status text, e.g. "Cancelled", "Scheduled", "Departed".
   *  Null on a pure schedules query, which does not carry status at all. */
  status: string | null;
  scheduledDepartureUtc: string | null;
  scheduledArrivalUtc: string | null;
  /** clock face at the airport, for display — never for comparison */
  localDepartureTime: string | null;
  localArrivalTime: string | null;
  /** block time in minutes, straight from OAG */
  elapsedTimeMin: number | null;
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

/**
 * Deliberately NOT under server/.state/ (which is gitignored): these are
 * recorded real responses, and their whole point is that a teammate with no
 * OAG key — or a rehearsal that must not touch the 100-call allowance — can
 * still run the search. Committed fixtures make OAG_REPLAY=1 work on a fresh
 * clone.
 */
const FIXTURE_DIR = join(process.cwd(), 'server', 'oag-fixtures');

/**
 * Real flights on a route and date — the search behind the booking form.
 *
 * ── Why this exists next to the throwing flightInstancesBatch ──────────────
 *
 * That function was written against a `FlightIdentities` list the endpoint does
 * not support. The real filter shape, confirmed by OAG's own 400 and then by
 * their v1→v2 migration guide, is carrier and/or airports + a datetime, with a
 * mandatory `CodeType`. That is awkward for "re-check these 40 known flights"
 * but it is exactly the shape of "what flies BOM→GOI on the 23rd", so a route
 * search is the query this endpoint actually wants.
 *
 * DepartureDateTime takes ISO-8601 interval notation, slash-separated —
 * `2026-08-23` or `2026-08-23T15:00/2026-08-23T16:00` — NOT separate From/To
 * params. `CodeType` is mandatory whenever an airport or carrier is named.
 * `FlightType` no longer defaults to Scheduled in v2, so it is set explicitly.
 *
 * ── The trial budget is the real constraint ────────────────────────────────
 *
 * 100 calls total across a 14-day window. A single dress rehearsal that
 * searches a few routes can eat a meaningful fraction of that, so every real
 * response is written to a fixture and `OAG_REPLAY=1` serves from those
 * instead. Rehearse in replay; spend live calls on stage. Replay is checked
 * before the budget is touched, so it can never spend anything.
 */
export async function flightInstancesByRoute(
  origin: string,
  destination: string,
  /** YYYY-MM-DD, or any ISO-8601 interval the endpoint accepts */
  departureDate: string,
): Promise<OagFlightInstance[]> {
  const from = origin.trim().toUpperCase();
  const to = destination.trim().toUpperCase();
  const fixture = join(FIXTURE_DIR, `${from}-${to}-${departureDate.replace(/[/:]/g, '_')}.json`);

  if (process.env.OAG_REPLAY === '1') {
    const replayed = readFixture(fixture);
    if (replayed) return replayed.map(parseInstance).filter((r): r is OagFlightInstance => r !== null);
    // Loud rather than silently empty: an unrecorded route in replay mode looks
    // exactly like a route with no flights, and confusing those two on stage is
    // how "the demo just shows nothing" happens.
    throw new Error(
      `OAG_REPLAY=1 but no fixture for ${from}->${to} on ${departureDate} (${fixture}). ` +
        `Record it once with OAG_REPLAY unset, then replay for free.`,
    );
  }

  const pair = keyPairFor('FLIGHT_INFO');
  if (pair.length === 0) return [];

  // 6h: schedules for a future date barely move, and this is the cache that
  // stands between a page refresh and the trial budget.
  return getOrSet(`oag:route:${from}:${to}:${departureDate}`, 6 * 60 * 60 * 1000, async () => {
    const url =
      `${FLIGHT_INSTANCES_BASE}?version=v2&CodeType=IATA` +
      `&DepartureAirport=${encodeURIComponent(from)}` +
      `&ArrivalAirport=${encodeURIComponent(to)}` +
      `&DepartureDateTime=${encodeURIComponent(departureDate)}` +
      `&FlightType=Scheduled`;

    // Budget is charged inside callWithKeyRotation, and only when a TRIAL key
    // is actually the one used — see its header.
    const res = await callWithKeyRotation(url, pair);
    if (!res.ok) {
      // Surface OAG's own validation text — it is what told us the real query
      // shape in the first place, and swallowing it would waste the call.
      const detail = await res.text().catch(() => '');
      throw new Error(`OAG flight-instances ${res.status}: ${detail.slice(0, 500)}`);
    }
    const json = (await res.json()) as { data?: unknown[] };
    const raw = json.data ?? [];
    // The fixture stores the RAW response, not the parsed rows. parseInstance
    // was wrong once already (it expected a shape v2 does not send), and a
    // fixture of parsed output would have baked that mistake in permanently —
    // re-recording costs a trial call, re-parsing costs nothing.
    writeFixture(fixture, raw);
    return raw.map(parseInstance).filter((r): r is OagFlightInstance => r !== null);
  });
}

/** Raw OAG records, exactly as received. */
function readFixture(path: string): unknown[] | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeFixture(path: string, rows: unknown[]): void {
  try {
    if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify(rows, null, 2));
  } catch {
    // A fixture we failed to write costs a future call, not this one.
  }
}

/**
 * The REAL v2 response shape, transcribed from a live 200 on 2026-08-17.
 *
 * The previous version of this type was written against something else — it
 * expected `departureDate.local` and `departure.scheduledTime.utc`, neither of
 * which exists. v2 splits an instant across two sibling objects, `date` and
 * `time`, each carrying both a local and a UTC value:
 *
 *   "departure": {
 *     "airport": { "iata": "BOM", "icao": "VABB" }, "terminal": "1",
 *     "date": { "local": "2026-08-24", "utc": "2026-08-23" },
 *     "time": { "local": "01:50",      "utc": "20:20"      }
 *   }
 *
 * Note the UTC date differs from the local one on this record — a 01:50 IST
 * departure is the previous day in UTC. Pairing `date.local` with `time.utc`
 * would silently shift a flight by a day, which is why the two are only ever
 * combined within the same namespace below.
 */
type RawTimed = {
  airport?: { iata?: string; icao?: string };
  terminal?: string;
  date?: { local?: string; utc?: string };
  time?: { local?: string; utc?: string };
};

type RawInstance = {
  carrier?: { iata?: string; icao?: string };
  flightNumber?: string | number;
  flightType?: string;
  departure?: RawTimed;
  arrival?: RawTimed;
  elapsedTime?: number;
  aircraftType?: { iata?: string; icao?: string };
  /** present on status-bearing queries; absent from a pure schedules query */
  statusDetails?: { state?: string; updatedAt?: string }[];
  status?: { flightStatus?: string; scheduleChanged?: boolean };
  registration?: string;
};

/** "2026-08-23" + "20:20" -> "2026-08-23T20:20:00Z". Null unless both halves
 *  are present — half an instant is worse than none, since it would be
 *  silently interpreted as midnight. */
function isoFrom(date: string | undefined, time: string | undefined): string | null {
  if (!date || !time) return null;
  const t = time.length === 5 ? `${time}:00` : time;
  return `${date}T${t}Z`;
}

function parseInstance(raw: unknown): OagFlightInstance | null {
  const r = raw as RawInstance;
  if (!r.carrier?.iata || r.flightNumber === undefined || r.flightNumber === null) return null;

  return {
    carrierIata: r.carrier.iata,
    // v2 returns this as a NUMBER (803, not "803"), which would render as
    // "SG803" fine but compare unequal to any stored string flight number.
    flightNumber: String(r.flightNumber),
    departureDate: r.departure?.date?.local ?? '',
    origin: r.departure?.airport?.iata ?? '',
    destination: r.arrival?.airport?.iata ?? '',
    departureTerminal: r.departure?.terminal ?? null,
    arrivalTerminal: r.arrival?.terminal ?? null,
    // A schedules query carries no live status; leaving these null is honest,
    // and is what distinguishes "not asked" from "on time".
    status: r.status?.flightStatus ?? null,
    scheduledDepartureUtc: isoFrom(r.departure?.date?.utc, r.departure?.time?.utc),
    scheduledArrivalUtc: isoFrom(r.arrival?.date?.utc, r.arrival?.time?.utc),
    localDepartureTime: r.departure?.time?.local ?? null,
    localArrivalTime: r.arrival?.time?.local ?? null,
    elapsedTimeMin: typeof r.elapsedTime === 'number' ? r.elapsedTime : null,
    estimatedDepartureUtc: null,
    actualDepartureUtc: null,
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
  if (pair.length === 0) return null;
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
