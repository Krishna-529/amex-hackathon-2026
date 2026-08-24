import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Alt, Booking, Flight } from '../domain/types';

/**
 * Coverage for the rebooking->Upcoming linkage: when a recovery's saga
 * CONFIRMS, execute() (server/pipeline/index.ts) calls this to persist the
 * chosen `alt` as a real Flight+Booking, linked back to the cancelled
 * original via `replacesFlightId`/`replacesFlightCode`. Before this, the
 * "new flight" only ever existed as a candidate on the OLD flight's
 * `candidates.alts` — nothing made it a real Upcoming entry.
 */

const createFlightMock = vi.fn(async (_f: Flight) => {});
const createBookingMock = vi.fn(async (b: Partial<Booking>) => ({ id: 'bk-new', ...b }) as Booking);

vi.mock('../domain/store', () => ({
  createFlight: (f: Flight) => createFlightMock(f),
  createBooking: (b: Partial<Booking>) => createBookingMock(b),
}));

const { createReplacementBooking } = await import('./index');

function flight(): Flight {
  return {
    id: 'flt-original', code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: '2026-09-01T10:00:00.000Z', durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: true, hardDeadlineISO: '2026-09-01T14:00:00.000Z',
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
  };
}

function booking(): Booking {
  return {
    id: 'bk-original', flightId: 'flt-original', passengerId: 'p-1',
    seat: '12A', pnr: 'ORIGPNR', cabin: 'economy',
    travellerIds: ['p-1'], seats: [{ travellerId: 'p-1', seat: '12A' }],
  };
}

function alt(overrides: Partial<Alt> = {}): Alt {
  return {
    id: 'alt-1', code: 'AI 2809', dep: '14:00', arr: '16:10',
    cabin: 'business', seats: 4, fare: 12000, currency: 'INR',
    expiresAt: null, kind: 'market', ok: true, why: 'earliest',
    ...overrides,
  };
}

describe('createReplacementBooking', () => {
  afterEach(() => {
    createFlightMock.mockClear();
    createBookingMock.mockClear();
  });

  it('creates a new Flight linked back to the cancelled original', async () => {
    await createReplacementBooking(flight(), booking(), alt());

    expect(createFlightMock).toHaveBeenCalledTimes(1);
    const newFlight = createFlightMock.mock.calls[0][0] as Flight;
    expect(newFlight.code).toBe('AI 2809');
    expect(newFlight.from).toBe('DEL');
    expect(newFlight.to).toBe('BOM');
    expect(newFlight.replacesFlightId).toBe('flt-original');
    expect(newFlight.replacesFlightCode).toBe('AI 2803');
    expect(newFlight.cancelledInData).toBe(false);
    expect(newFlight.candidates).toEqual({ alts: [], hotels: [], cabs: [], cabLegs: [] });
    // The hard deadline that mattered for choosing this alt still matters going forward.
    expect(newFlight.hasHardConstraint).toBe(true);
    expect(newFlight.hardDeadlineISO).toBe('2026-09-01T14:00:00.000Z');
  });

  it('derives durationMin from alt timestamps when present', async () => {
    await createReplacementBooking(
      flight(),
      booking(),
      alt({ departsAt: 1_800_000_000_000, arrivesAt: 1_800_000_000_000 + 90 * 60_000 }),
    );
    const newFlight = createFlightMock.mock.calls.at(-1)![0] as Flight;
    expect(newFlight.durationMin).toBe(90);
  });

  it('falls back to the original flight duration when the alt has no timestamps', async () => {
    await createReplacementBooking(flight(), booking(), alt());
    const newFlight = createFlightMock.mock.calls.at(-1)![0] as Flight;
    expect(newFlight.durationMin).toBe(130);
  });

  it('creates a Booking copying party/seats from the original, with a fresh PNR and the alt cabin', async () => {
    await createReplacementBooking(flight(), booking(), alt());

    expect(createBookingMock).toHaveBeenCalledTimes(1);
    const newBooking = createBookingMock.mock.calls[0][0] as Booking;
    expect(newBooking.passengerId).toBe('p-1');
    expect(newBooking.travellerIds).toEqual(['p-1']);
    expect(newBooking.seats).toEqual([{ travellerId: 'p-1', seat: '12A' }]);
    expect(newBooking.cabin).toBe('business');
    // A different physical ticket must not reuse the original's PNR.
    expect(newBooking.pnr).not.toBe('ORIGPNR');
    expect(newBooking.pnr).toMatch(/^[A-Z0-9]{6}$/);
    expect(newBooking).not.toHaveProperty('farePaid');
    expect(newBooking).not.toHaveProperty('fareBasis');
    expect(newBooking).not.toHaveProperty('itineraryId');
  });
});
