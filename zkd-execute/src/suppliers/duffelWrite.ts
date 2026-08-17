/**
 * Duffel order creation/cancellation — the write half of the same sandbox
 * zkd-app/server/suppliers/duffel.ts already searches and revalidates
 * against. Real HTTP against Duffel's test-mode API when DUFFEL_ACCESS_TOKEN
 * is set (no production key has existed in this project at any point — see
 * zkd-app/.env.example — so this path is written against Duffel's documented
 * order API but has not been exercised against a live sandbox token; the
 * no-key fallback below is what every demo run actually exercises today).
 *
 * Only this module — inside zkd-execute, never zkd-app — holds the write
 * scope. zkd-app's duffel.ts intentionally has no book()/cancel().
 */
import { randomUUID } from 'node:crypto';

const API = 'https://api.duffel.com';

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export type FlightBookInput = {
  supplierOfferId: string;
  amount: number;
  currency: string;
  /** minimal passenger shape Duffel's order API requires per selected offer */
  passenger: { givenName: string; familyName: string; dob: string; gender: 'm' | 'f'; email: string; phoneNumber: string };
};

export type FlightBookResult = { confirmationNumber: string; pnr: string };

const mockBookings = new Map<string, FlightBookResult>();

export async function bookFlight(idempotencyKey: string, input: FlightBookInput): Promise<FlightBookResult> {
  const existing = mockBookings.get(idempotencyKey);
  if (existing) return existing; // idempotent replay — Temporal shouldn't re-run a completed activity, but a real supplier call being idempotent too is defense in depth

  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return mockBookFlight(idempotencyKey, input);

  try {
    const res = await fetch(`${API}/air/orders`, {
      method: 'POST',
      headers: headers(token),
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        data: {
          type: 'instant',
          selected_offers: [input.supplierOfferId],
          payments: [{ type: 'balance', currency: input.currency, amount: String(input.amount) }],
          passengers: [
            {
              given_name: input.passenger.givenName,
              family_name: input.passenger.familyName,
              born_on: input.passenger.dob,
              gender: input.passenger.gender,
              email: input.passenger.email,
              phone_number: input.passenger.phoneNumber,
              title: input.passenger.gender === 'f' ? 'ms' : 'mr',
            },
          ],
        },
      }),
    });
    if (!res.ok) throw new Error(`Duffel order creation failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data?: { id: string; booking_reference: string } };
    if (!json.data) throw new Error('Duffel order creation returned no data');
    const result = { confirmationNumber: json.data.id, pnr: json.data.booking_reference };
    mockBookings.set(idempotencyKey, result);
    return result;
  } catch (e) {
    throw e instanceof Error ? e : new Error('Duffel order creation failed');
  }
}

export async function cancelFlight(idempotencyKey: string, confirmationNumber: string): Promise<{ cancelled: boolean }> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return mockCancelFlight(idempotencyKey);

  try {
    const create = await fetch(`${API}/air/order_cancellations`, {
      method: 'POST',
      headers: headers(token),
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ data: { order_id: confirmationNumber } }),
    });
    if (!create.ok) throw new Error(`Duffel cancellation creation failed: ${create.status}`);
    const created = (await create.json()) as { data?: { id: string } };
    if (!created.data) throw new Error('Duffel cancellation creation returned no data');

    const confirm = await fetch(`${API}/air/order_cancellations/${created.data.id}/actions/confirm`, {
      method: 'POST',
      headers: headers(token),
      signal: AbortSignal.timeout(15000),
    });
    if (!confirm.ok) throw new Error(`Duffel cancellation confirm failed: ${confirm.status}`);
    return { cancelled: true };
  } catch (e) {
    throw e instanceof Error ? e : new Error('Duffel cancellation failed');
  }
}

function mockBookFlight(idempotencyKey: string, input: FlightBookInput): FlightBookResult {
  const result: FlightBookResult = {
    confirmationNumber: `MOCKDF-${randomUUID().slice(0, 8).toUpperCase()}`,
    pnr: randomUUID().slice(0, 6).toUpperCase(),
  };
  mockBookings.set(idempotencyKey, result);
  void input; // shape-checked, unused in the mock body
  return result;
}

async function mockCancelFlight(idempotencyKey: string): Promise<{ cancelled: boolean }> {
  const existed = mockBookings.delete(idempotencyKey);
  return { cancelled: existed || true }; // cancelling a booking already released is still a successful no-op, not a failure
}
