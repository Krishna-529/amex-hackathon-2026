import { afterEach, describe, expect, it } from 'vitest';
import { intervalMs } from './schedule.ts';

/**
 * schedule.ts's own timer/globalThis-guard machinery isn't tested directly,
 * matching batchScorer.test.ts's restraint (it only covers the pure
 * flightsInTier partitioning, not the setTimeout loop around it) — this
 * covers the one pure, meaningfully-buggable piece: parsing
 * RANKER_RETRAIN_INTERVAL_MS.
 */
const ENV_KEY = 'RANKER_RETRAIN_INTERVAL_MS';
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe('intervalMs', () => {
  it('defaults to 30 minutes when unset', () => {
    delete process.env[ENV_KEY];
    expect(intervalMs()).toBe(30 * 60 * 1000);
  });

  it('honours a valid positive override', () => {
    process.env[ENV_KEY] = '5000';
    expect(intervalMs()).toBe(5000);
  });

  it('falls back to the default on a non-numeric value', () => {
    process.env[ENV_KEY] = 'not-a-number';
    expect(intervalMs()).toBe(30 * 60 * 1000);
  });

  it('falls back to the default on zero or negative', () => {
    process.env[ENV_KEY] = '0';
    expect(intervalMs()).toBe(30 * 60 * 1000);
    process.env[ENV_KEY] = '-5000';
    expect(intervalMs()).toBe(30 * 60 * 1000);
  });
});
