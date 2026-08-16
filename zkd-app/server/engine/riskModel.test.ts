import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleFeatures } from './riskModel';
import type { Flight } from '../domain/types';

/**
 * The train/serve contract that matters most and had no test at all: the
 * exact set of feature NAMES this function sends must equal
 * zkd-risk-model/models/feature_columns.json (the live artifact's own
 * declared input schema, read by src/inference.py's CancellationScorer at
 * load time) — a silent rename on either side desyncs a real trained model
 * from what it's actually being asked to score, with no error, just quietly
 * wrong predictions (every unlisted key is ignored; every expected key not
 * sent scores as missing/NaN, which the model tolerates but wasn't trained
 * to expect as a *systematic* absence).
 *
 * Hardcoded here as a snapshot of feature_columns.json rather than read off
 * disk across the zkd-risk-model/ boundary — this test's job is to fail
 * loudly the moment someone changes one side without the other, which a
 * cross-repo file read would silently "fix" instead of catching.
 */
const LIVE_MODEL_FEATURE_COLUMNS = [
  'carrier_hist_cancel_rate', 'route_hist_cancel_rate', 'origin_hist_cancel_rate',
  'dest_hist_cancel_rate', 'origin_month_hist_cancel_rate',
  'month', 'day_of_week', 'hour_of_day', 'is_redeye', 'is_weekend',
  'distance_km', 'sched_duration_min', 'origin_hour_density',
  'prior_leg_cancelled', 'international',
].sort();

const entityRatesResponse = {
  global_prior: 0.02,
  as_of: '2026-01-01T00:00:00Z',
  carrier: {}, origin: {}, dest: {}, route: {}, origin_month: {},
  origin_hour_density_avg: {}, origin_hour_density_global_avg: 5,
  live_synthetic: null,
};

function realFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flt-test', code: 'AI 2803', from: 'DEL', to: 'BOM',
    depISO: '2026-06-15T15:30:00Z', durationMin: 130,
    connectionSlackMinutes: null, hasHardConstraint: false,
    candidates: { alts: [], hotels: [], cabs: [], cabLegs: [] },
    ...overrides,
  };
}

describe('assembleFeatures — TS/Python feature-name contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends exactly the feature names the live trained model declares — no more, no fewer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(entityRatesResponse), { status: 200 })));
    const result = await assembleFeatures(realFlight());
    expect(result).not.toBeNull();
    const sentKeys = Object.keys(result!.features).sort();
    expect(sentKeys).toEqual(LIVE_MODEL_FEATURE_COLUMNS);
  });

  it('every numeric feature is a finite number or null — never NaN, undefined, or a string (a real over-the-wire JSON hazard)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(entityRatesResponse), { status: 200 })));
    const result = await assembleFeatures(realFlight());
    for (const [name, value] of Object.entries(result!.features)) {
      const ok = value === null || (typeof value === 'number' && Number.isFinite(value));
      expect(ok, `${name}=${value} must be a finite number or null`).toBe(true);
    }
  });
});
