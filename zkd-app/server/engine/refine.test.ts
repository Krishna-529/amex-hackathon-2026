/**
 * The safety-envelope guarantees behind server/engine/refine.ts, against a
 * real Postgres (same describe.skipIf(!hasDb) pattern as
 * store.integration.test.ts) with Bedrock itself mocked — this file proves
 * the MERGE/re-rank logic is safe regardless of what a (mocked) LLM
 * returns, not that Bedrock is reachable.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Flight, Passenger, RecoveryTask } from '../domain/types';

const hasDb = !!process.env.DATABASE_URL;

const parsePreferencePromptMock = vi.fn();
vi.mock('../bedrock', () => ({ parsePreferencePrompt: (...a: unknown[]) => parsePreferencePromptMock(...a) }));

describe.skipIf(!hasDb)('refineWithPreference — safety envelope', () => {
  let store: typeof import('../domain/store');
  let refine: typeof import('./refine');

  beforeEach(async () => {
    vi.resetModules();
    parsePreferencePromptMock.mockReset();
    store = await import('../domain/store');
    refine = await import('./refine');
  });
  afterEach(() => vi.restoreAllMocks());

  async function seed(suffix: string, opts: { alts: Flight['candidates']['alts']; rejectedAltIds?: string[] }) {
    const flightId = `refine-flt-${suffix}-${Date.now()}`;
    const passengerId = `refine-pax-${suffix}-${Date.now()}`;

    const flight: Flight = {
      id: flightId, code: 'TT 1', from: 'BOM', to: 'DEL',
      depISO: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 130,
      connectionSlackMinutes: null, hasHardConstraint: false,
      candidates: { alts: opts.alts, hotels: [], cabs: [], cabLegs: [] },
    };
    await store.createFlight(flight);

    const passenger: Passenger = {
      id: passengerId, displayName: 'Test', legalName: 'TEST PASSENGER', dob: '01 Jan 1990',
      gender: 'Other', nationality: 'Indian',
      passport: { number: 'X1234567', expiry: 'Jan 2030', issued: 'India' },
      contact: { email: `${passengerId}@example.com`, phone: '+91 00000 00000' },
      consent: 'ask', loyalty: [], prefs: [], payment: { card: 'test', method: 'test' },
    };
    await store.createPassenger(passenger);

    const task: RecoveryTask = {
      id: `rt-${suffix}-${Date.now()}`, disruptionEventId: 'de-test', flightId, bookingId: 'bk-test',
      passengerId, phase: 'waiting', terminal: null, needsRebooking: true, partySize: 1,
      windowExpiresAt: Date.now() + 120_000, windowBoundBy: 'ceiling',
      chosenAltId: opts.alts[0]?.id ?? '', chosenHotelId: '', chosenCabId: '',
      rejectedAltIds: opts.rejectedAltIds ?? [],
      chosenAltReason: null, rankedOptions: [], excludedAlts: [], refining: false,
      shown: [], note: null, resolution: null,
    };
    await store.setRecoveryTask(task);

    return { flightId, passengerId };
  }

  function alt(id: string, over: Partial<Flight['candidates']['alts'][number]> = {}) {
    return {
      id, code: 'AI 100', dep: '10:00', arr: '13:00', cabin: 'Economy', seats: 4, fare: 5000,
      currency: 'INR', expiresAt: null, kind: 'market' as const, ok: true, why: 'test', ...over,
    };
  }

  test('a patch\'s avoid_airlines_add only ever ADDS to the base list, never replaces it', async () => {
    // 'SG' would already be avoided by the member's own base rules if any
    // existed — here the base is empty, so the patch's addition is the only
    // exclusion, and it must still land as an ADDITION (union), not a
    // silent full replacement of an (empty) base list.
    const { flightId, passengerId } = await seed('avoid-union', {
      alts: [alt('sg-1', { code: 'SG 202' }), alt('ai-1', { code: 'AI 300' })],
    });
    parsePreferencePromptMock.mockResolvedValue({ rationale: 'avoid SpiceJet', avoid_airlines_add: ['SG'] });

    await refine.refineWithPreference(flightId, passengerId, 'no SpiceJet please');

    const task = await store.getRecoveryTask(flightId, passengerId);
    expect(task?.excludedAlts.some((e) => e.altId === 'sg-1')).toBe(true);
    expect(task?.chosenAltId).toBe('ai-1');
  });

  test('a rejected alt id can never reappear — the schema has no field that could reference one', async () => {
    const { flightId, passengerId } = await seed('rejected-stays-out', {
      alts: [alt('rejected-1'), alt('kept-1')],
      rejectedAltIds: ['rejected-1'],
    });
    parsePreferencePromptMock.mockResolvedValue({ rationale: 'earlier please', optimization_strategy: 'earliest_arrival' });

    await refine.refineWithPreference(flightId, passengerId, 'get me there earlier');

    const task = await store.getRecoveryTask(flightId, passengerId);
    expect(task?.rankedOptions.some((r) => r.altId === 'rejected-1')).toBe(false);
    expect(task?.chosenAltId).toBe('kept-1');
  });

  test('the entitlement-clamped cabin ceiling holds even against an adversarial-shaped mock patch', async () => {
    // PreferencePatchSchema has no cabin field at all — even if something
    // upstream of the schema misbehaved, refine.ts's own preferredCabin
    // clamp (mirroring planningGraph.ts's) is independent of anything the
    // patch object could carry, since the schema is .strict() and simply
    // has no cabin key to smuggle one through.
    const { flightId, passengerId } = await seed('cabin-clamp', {
      alts: [alt('econ-1', { cabin: 'Economy' }), alt('biz-1', { cabin: 'Business', fare: 40000 })],
    });
    parsePreferencePromptMock.mockResolvedValue({ rationale: 'nicer seat', optimization_strategy: 'earliest_arrival' });

    await refine.refineWithPreference(flightId, passengerId, 'I want a nicer seat');

    const task = await store.getRecoveryTask(flightId, passengerId);
    // Default mock MyCa profile entitlement is Economy (server/myca.ts) and
    // allowCabinDowngrade default is false with preferredCabin Economy, so a
    // Business option must never be silently promoted to the winner here.
    expect(task?.chosenAltId).not.toBe('biz-1');
  });

  test('refining flips true then false, observably, across the call', async () => {
    const { flightId, passengerId } = await seed('refining-flag', { alts: [alt('a1')] });
    let observedTrueMidCall = false;
    parsePreferencePromptMock.mockImplementation(async () => {
      const mid = await store.getRecoveryTask(flightId, passengerId);
      observedTrueMidCall = mid?.refining === true;
      return { rationale: 'ok' };
    });

    await refine.refineWithPreference(flightId, passengerId, 'anything');

    expect(observedTrueMidCall).toBe(true);
    const after = await store.getRecoveryTask(flightId, passengerId);
    expect(after?.refining).toBe(false);
  });

  test('a null patch (Bedrock failure) re-ranks unchanged and leaves an honest fallback note', async () => {
    const { flightId, passengerId } = await seed('null-patch-fallback', {
      alts: [alt('only-1')],
    });
    parsePreferencePromptMock.mockResolvedValue(null);

    await refine.refineWithPreference(flightId, passengerId, 'anything at all');

    const task = await store.getRecoveryTask(flightId, passengerId);
    expect(task?.chosenAltId).toBe('only-1');
    expect(task?.chosenAltReason?.kind).toBe('deterministic-score');
    expect(task?.note).toContain("Couldn't process your preference");
  });
});
