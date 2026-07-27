/**
 * Local supplier mocks. Every "external" system in the demo lives here:
 * Sabre (air), the hotel aggregator, the ground-transit partner and Amex
 * vPayment. All responses replay recorded fixtures — no network, no keys.
 *
 * Two knobs matter for the demo:
 *   - seeded latency          (deterministic, --fast collapses it)
 *   - FORCE_FAILURE switch    (makes A4 bookGround fail on demand)
 */

import { ApplicationFailure } from '@temporalio/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LATENCY_MS, FAST_LATENCY_MS } from '../src/scenario';

const FIXTURES = join(__dirname, 'fixtures');

function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export const sabreOffers = () => fixture('sabre-offers.json');
export const hotelOffers = () => fixture('hotel-offers.json');
export const groundOffers = () => fixture('ground-offers.json');

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

export const isFast = () => process.env.FAST === '1';

export function latency(): typeof LATENCY_MS {
  return isFast() ? FAST_LATENCY_MS : LATENCY_MS;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Seeded, stable reference generator. Same seed string -> same reference,
 * every run, on every machine. Nothing here touches Math.random or the clock.
 */
export function ref(prefix: string, seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const alphabet = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  let n = h;
  for (let i = 0; i < 6; i++) {
    out += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + 7;
  }
  return `${prefix}-${out}`;
}

/** The forced-failure switch. `FORCE_FAILURE=bookGround` breaks A4. */
export function failureArmedFor(activityId: string): boolean {
  return (process.env.FORCE_FAILURE ?? '') === activityId;
}

// ---------------------------------------------------------------------------
// Amex vPayment — single-use virtual account number
// ---------------------------------------------------------------------------

export interface VanReservation {
  van_id: string;
  last4: string;
  authorised_inr: number;
  merchant_lock: string[];
  status: 'RESERVED' | 'RELEASED';
}

export async function vPaymentReserve(args: {
  amountInr: number;
  merchants: string[];
  idempotencyKey: string;
}): Promise<VanReservation> {
  await sleep(latency().book);
  if (failureArmedFor('reserveVAN')) throw carrierUnavailable('Amex vPayment', 'VAN reservation');
  const van = ref('VAN', args.idempotencyKey);
  return {
    van_id: van,
    last4: van.slice(-4),
    authorised_inr: args.amountInr,
    merchant_lock: args.merchants,
    status: 'RESERVED',
  };
}

export async function vPaymentRelease(args: { vanId: string }): Promise<{ van_id: string; status: 'RELEASED' }> {
  await sleep(latency().compensate);
  return { van_id: args.vanId, status: 'RELEASED' };
}

// ---------------------------------------------------------------------------
// Air — Sabre
// ---------------------------------------------------------------------------

export async function sabreSearch(): Promise<any> {
  await sleep(latency().supplierFanout);
  return sabreOffers();
}

export async function sabreBook(args: { offerId: string; pnr: string; idempotencyKey: string }) {
  await sleep(latency().book);
  if (failureArmedFor('bookFlight')) throw carrierUnavailable('Sabre', args.offerId);
  const all = sabreOffers();
  const offer =
    all.offers.find((o: any) => o.offer_id === args.offerId) ??
    (all.protection.offer_id === args.offerId ? all.protection : undefined);
  if (!offer) throw new Error(`Unknown offer ${args.offerId}`);
  return {
    booking_ref: ref('AIR', args.idempotencyKey),
    pnr: args.pnr,
    offer_id: offer.offer_id,
    flight: offer.flight,
    carrier: offer.carrier,
    carrier_name: offer.carrier_name,
    from: offer.from,
    to: offer.to,
    departIso: offer.departIso,
    arriveIso: offer.arriveIso,
    cabin: offer.cabin,
    charged_inr: offer.fare_delta_inr,
    status: 'CONFIRMED' as const,
  };
}

export async function sabreVoid(args: { bookingRef: string }) {
  await sleep(latency().compensate);
  return { booking_ref: args.bookingRef, status: 'VOIDED' as const };
}

// ---------------------------------------------------------------------------
// Hotel
// ---------------------------------------------------------------------------

export async function hotelBook(args: { offerId: string; idempotencyKey: string }) {
  await sleep(latency().book);
  if (failureArmedFor('bookHotel')) throw carrierUnavailable('Hotel aggregator', args.offerId);
  const offer = hotelOffers().offers.find((o: any) => o.offer_id === args.offerId);
  if (!offer) throw new Error(`Unknown hotel offer ${args.offerId}`);
  return {
    booking_ref: ref('HTL', args.idempotencyKey),
    offer_id: offer.offer_id,
    name: offer.name,
    room: offer.room,
    checkInIso: offer.checkInIso,
    nights: offer.nights,
    charged_inr: offer.amount_inr,
    status: 'CONFIRMED' as const,
  };
}

export async function hotelCancel(args: { bookingRef: string }) {
  await sleep(latency().compensate);
  return { booking_ref: args.bookingRef, status: 'CANCELLED' as const, penalty_inr: 0 };
}

// ---------------------------------------------------------------------------
// Ground transit — this is the supplier that fails on demand (A4)
// ---------------------------------------------------------------------------

export async function groundBook(args: { offerId: string; idempotencyKey: string }) {
  await sleep(latency().book);
  if (failureArmedFor('bookGround')) {
    throw carrierUnavailable('Delhi Airport Express', args.offerId);
  }
  const offer = groundOffers().offers.find((o: any) => o.offer_id === args.offerId);
  if (!offer) throw new Error(`Unknown ground offer ${args.offerId}`);
  return {
    booking_ref: ref('GRD', args.idempotencyKey),
    offer_id: offer.offer_id,
    provider: offer.provider,
    pickupIso: offer.pickupIso,
    from: offer.from,
    to: offer.to,
    charged_inr: offer.amount_inr,
    status: 'CONFIRMED' as const,
  };
}

export async function groundCancel(args: { bookingRef: string | null }) {
  await sleep(latency().compensate);
  return { booking_ref: args.bookingRef, status: 'CANCELLED' as const, penalty_inr: 0 };
}

/**
 * The failure the demo induces. A non-retryable Temporal ApplicationFailure —
 * the workflow must not burn retries on it, it must roll the saga back.
 */
function carrierUnavailable(supplier: string, subject: string): ApplicationFailure {
  return ApplicationFailure.create({
    type: 'CarrierUnavailableError',
    message: `${supplier} rejected ${subject}: no vehicle available for the requested pickup window`,
    nonRetryable: true,
    details: [{ supplier, subject, forced_by: 'FORCE_FAILURE=bookGround' }],
  });
}
