import { test } from 'node:test';
import assert from 'node:assert/strict';

import { confirmWindow, WINDOW_FLOOR_SECONDS } from '@/lib/confirmWindow';

/**
 * The runner exists mainly so everything else can be verified. This first case
 * doubles as a check that the `@/` path alias resolves under the runner, which
 * is the one thing likely to be misconfigured.
 */
test('a 40-second offer leaves no askable window', () => {
  const now = Date.now();
  const w = confirmWindow({
    offerExpiresAt: now + 40_000,
    departureAt: now + 8 * 3600_000,
    international: false,
  });
  assert.equal(w.askable, false);
  assert.equal(w.boundBy, 'floor');
});

test('a six-minute offer is bound by offer expiry, not the ceiling', () => {
  const now = Date.now();
  const w = confirmWindow({
    offerExpiresAt: now + 6 * 60_000,
    departureAt: now + 8 * 3600_000,
    international: false,
  });
  assert.equal(w.askable, true);
  assert.equal(w.boundBy, 'offer-expiry');
  // 360s minus 11s execution minus 20s network.
  assert.equal(w.seconds, 329);
  assert.ok(w.seconds > WINDOW_FLOOR_SECONDS);
});
