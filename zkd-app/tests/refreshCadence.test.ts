import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refreshCadence, cadenceRationale } from '@/lib/refreshCadence';

const NOW = 1_760_000_000_000;

test('a long-lived offer is bound by the band ceiling, not the offer', () => {
  const c = refreshCadence({
    component: 'flight',
    band: 'hold-gate',
    soonestExpiryAt: NOW + 3 * 3600_000,
    now: NOW,
  });
  assert.equal(c.refreshing, true);
  assert.equal(c.boundBy, 'band-ceiling');
  assert.equal(c.seconds, 15 * 60);
});

test('an offer expiring inside the band window is bound by the offer', () => {
  const c = refreshCadence({
    component: 'flight',
    band: 'hold-gate',
    soonestExpiryAt: NOW + 10 * 60_000,
    now: NOW,
  });
  assert.equal(c.boundBy, 'offer-expiry');
  // Ten minutes minus the 20s revalidation budget.
  assert.equal(c.seconds, 10 * 60 - 20);
});

test('an offer dying sooner than we may re-shop is bound by the band floor', () => {
  const c = refreshCadence({
    component: 'flight',
    band: 'hold-gate',
    soonestExpiryAt: NOW + 90_000,
    now: NOW,
  });
  assert.equal(c.boundBy, 'band-floor');
  assert.equal(c.seconds, 5 * 60);
  // The honest consequence, surfaced rather than hidden.
  assert.match(cadenceRationale(c, 'flight'), /may already be gone/);
});

test('scarcity shortens the interval', () => {
  const base = refreshCadence({
    component: 'flight',
    band: 'hold-gate',
    soonestExpiryAt: NOW + 3 * 3600_000,
    now: NOW,
  });
  const scarce = refreshCadence({
    component: 'flight',
    band: 'hold-gate',
    soonestExpiryAt: NOW + 3 * 3600_000,
    scarcity: 0.6,
    now: NOW,
  });
  assert.ok(scarce.seconds < base.seconds, 'scarce routes refresh more often');
  assert.equal(scarce.seconds, Math.round(15 * 60 * 0.6));
});

test('the watch band does not refresh at all', () => {
  const c = refreshCadence({
    component: 'flight',
    band: 'watch',
    soonestExpiryAt: NOW + 60_000,
    now: NOW,
  });
  assert.equal(c.refreshing, false);
  assert.equal(c.boundBy, 'not-refreshing');
  assert.equal(c.nextAt, NOW);
});

test('ground is never on a standing refresh', () => {
  const c = refreshCadence({
    component: 'ground',
    band: 'pre-authorise',
    soonestExpiryAt: NOW + 60_000,
    now: NOW,
  });
  assert.equal(c.refreshing, false);
  assert.match(c.reason ?? '', /on demand/);
});

test('hotels refresh far more slowly than flights in the same band', () => {
  const flight = refreshCadence({
    component: 'flight', band: 'hold-gate', soonestExpiryAt: null, now: NOW,
  });
  const hotel = refreshCadence({
    component: 'hotel', band: 'hold-gate', soonestExpiryAt: null, now: NOW,
  });
  assert.ok(hotel.seconds > flight.seconds * 4, 'rates hold for hours, fares for minutes');
});

test('an offer with no expiry falls back to the band ceiling', () => {
  const c = refreshCadence({
    component: 'flight',
    band: 'pre-authorise',
    soonestExpiryAt: null,
    now: NOW,
  });
  assert.equal(c.boundBy, 'band-ceiling');
  assert.equal(c.seconds, 5 * 60);
});
