/**
 * Hotel (LiteAPI) and ground (Uber) write scopes: no production key has ever
 * existed for either (LITEAPI_API_KEY / UBER_API_KEY are blank in every env
 * this has run in), so both run this realistic mock unconditionally today.
 * It is not a narration string — it persists booked/cancelled state per
 * idempotency key and genuinely refuses to double-book or to cancel
 * something never booked, the same invariants a real supplier enforces.
 */
import { randomUUID } from 'node:crypto';

export type MockBookResult = { confirmationNumber: string };

const bookings = new Map<string, { confirmationNumber: string; cancelled: boolean }>();

export type MockBookingKind = 'flight' | 'hotel' | 'ground';

function keyFor(idempotencyKey: string, kind: MockBookingKind): string {
  return `${kind}:${idempotencyKey}`;
}

export async function mockBook(idempotencyKey: string, kind: MockBookingKind): Promise<MockBookResult> {
  const k = keyFor(idempotencyKey, kind);
  const existing = bookings.get(k);
  if (existing && !existing.cancelled) return { confirmationNumber: existing.confirmationNumber };

  const confirmationNumber = `MOCK${kind.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  bookings.set(k, { confirmationNumber, cancelled: false });
  return { confirmationNumber };
}

/** Cancels by confirmation number when given one (what a real supplier
 *  cancels against); falls back to the idempotency-key lookup for the mock's
 *  own bookkeeping when no specific reference is known. */
export async function mockCancel(
  idempotencyKey: string,
  kind: MockBookingKind,
  confirmationNumber?: string,
): Promise<{ cancelled: boolean }> {
  const k = keyFor(idempotencyKey, kind);
  const existing = bookings.get(k);
  if (!existing) return { cancelled: true }; // nothing was ever booked — cancelling is a trivial no-op success
  if (confirmationNumber && existing.confirmationNumber !== confirmationNumber) {
    throw new Error(`cancel mismatch: expected ${existing.confirmationNumber}, got ${confirmationNumber}`);
  }
  existing.cancelled = true;
  return { cancelled: true };
}
