import { describe, expect, it } from 'vitest';
import { adapt } from './adapt';
import { weightsFor, normalise, RELIABILITY_FLOOR, PRESETS } from './presets';
import type { TravelerPreferencesWire, OptimizationStrategy } from './schema';

/**
 * Converted from the source branch's server/preferences/verify.ts (a
 * standalone `node --experimental-strip-types` script) into real vitest
 * tests — this repo uses vitest exclusively, and a second, parallel
 * test-execution convention would be exactly the kind of drift the rest of
 * this codebase's comments warn against. Same checks, same reasoning: two
 * behaviors here are the kind that pass review and fail silently in
 * production (a boolean flipped the wrong way ranks every overnight option
 * backwards and looks like bad scoring, not a bad conversion).
 */
function profile(over: Partial<TravelerPreferencesWire> = {}): TravelerPreferencesWire {
  return {
    traveler_identity: {
      full_legal_name: 'PRIYA RAMESH SUNDARAM',
      date_of_birth: '1988-03-14',
      gender: 'FEMALE',
      nationality: 'IN',
      home_airport_code: 'MAA',
    },
    contact_and_notifications: {
      primary_phone: '+91',
      primary_email: 'p@example.com',
      preferred_alert_channels: ['push', 'sms'],
    },
    loyalty_programs: { airlines: [{ airline_code: 'AI' }, { airline_code: '6E' }] },
    flight_preferences: { preferred_cabin: 'economy', max_acceptable_layovers: 1 },
    ground_transport_preferences: {},
    autonomous_rebooking_rules: {
      optimization_strategy: 'earliest_arrival',
      auto_approve_rebooking: true,
      hotel_trigger_threshold_hours: 6,
      rental_car_trigger_threshold_hours: 24,
    },
    ...over,
  };
}

describe('red_eye_tolerance ⇄ avoidRedEye (inverse, both directions)', () => {
  it('tolerance true → avoidRedEye false', () => {
    const a = adapt(profile({ autonomous_rebooking_rules: { ...profile().autonomous_rebooking_rules, red_eye_tolerance: true } }), 'INR');
    expect(a.preferences.avoidRedEye).toBe(false);
  });
  it('tolerance false → avoidRedEye true', () => {
    const a = adapt(profile({ autonomous_rebooking_rules: { ...profile().autonomous_rebooking_rules, red_eye_tolerance: false } }), 'INR');
    expect(a.preferences.avoidRedEye).toBe(true);
  });
  it('omitted → schema default (tolerant, so avoidRedEye is false)', () => {
    expect(adapt(profile(), 'INR').preferences.avoidRedEye).toBe(false);
  });
});

describe('auto_approve_rebooking → consent', () => {
  it('true → autopilot', () => {
    expect(adapt(profile(), 'INR').consent).toBe('autopilot');
  });
  it('false → ask', () => {
    const a = adapt(profile({ autonomous_rebooking_rules: { ...profile().autonomous_rebooking_rules, auto_approve_rebooking: false } }), 'INR');
    expect(a.consent).toBe('ask');
  });
});

describe('money keeps its currency — no silent FX', () => {
  it('a USD-denominated cap is not relabelled as the billing currency', () => {
    const a = adapt(profile({ autonomous_rebooking_rules: { ...profile().autonomous_rebooking_rules, max_out_of_pocket_expense_usd: 200 } }), 'INR');
    expect(a.preferences.perTransactionCap.currency).toBe('USD');
  });
  it('ground cap is a separate budget from the flight cap', () => {
    const a = adapt(profile({ autonomous_rebooking_rules: { ...profile().autonomous_rebooking_rules, max_out_of_pocket_expense_usd: 200 } }), 'INR');
    expect(a.rules.groundCap).not.toBeNull();
    expect(a.rules.groundCap?.amount).toBe(150);
  });
});

describe('hard rules survive adaptation', () => {
  const adapted = adapt(
    profile({ flight_preferences: { preferred_cabin: 'business', avoid_airlines: ['sg', 'g8'], max_acceptable_layovers: 0 } }),
    'INR',
  );
  it('avoid_airlines is upper-cased', () => {
    expect(adapted.rules.avoidAirlines).toEqual(['SG', 'G8']);
  });
  it('max_acceptable_layovers: 0 is preserved, not defaulted to 1', () => {
    expect(adapted.rules.maxLayovers).toBe(0);
  });
  it('allow_cabin_downgrade defaults to false', () => {
    expect(adapted.rules.allowCabinDowngrade).toBe(false);
  });
  it('preferred cabin is distinct from the (unrelated) entitlement default', () => {
    expect(adapted.preferredCabin).toBe('Business');
  });
});

describe('presets', () => {
  it.each(Object.keys(PRESETS) as OptimizationStrategy[])('%s sums to 1 and holds the reliability floor', (s) => {
    const w = PRESETS[s];
    const sum = Object.values(w).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(w.reliability).toBeGreaterThanOrEqual(RELIABILITY_FLOOR - 1e-9);
  });

  it('each strategy actually leads on its own axis, or the preset is decorative', () => {
    expect(PRESETS.earliest_arrival.arrival).toBe(Math.max(...Object.values(PRESETS.earliest_arrival)));
    expect(PRESETS.lowest_cost.cost).toBe(Math.max(...Object.values(PRESETS.lowest_cost)));
    expect(PRESETS.minimize_layovers.effort).toBe(Math.max(...Object.values(PRESETS.minimize_layovers)));
    expect(PRESETS.stick_to_preferred_airline.loyalty).toBe(Math.max(...Object.values(PRESETS.stick_to_preferred_airline)));
  });
});

describe('hard-constraint boost must not dilute the reliability floor', () => {
  it.each(Object.keys(PRESETS) as OptimizationStrategy[])('%s + boost still sums to 1, holds the floor, and raises arrival', (s) => {
    const w = weightsFor(s, { hasHardConstraint: true });
    const sum = Object.values(w).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(w.reliability).toBeGreaterThanOrEqual(RELIABILITY_FLOOR - 1e-9);
    expect(w.arrival).toBeGreaterThan(PRESETS[s].arrival - 1e-9);
  });
});

describe('normalise() restores a starved floor', () => {
  it('boosts a below-floor reliability weight back to the floor without breaking the sum or the ranking', () => {
    const starved = normalise({ arrival: 0.9, cost: 0.05, reliability: 0.01, cabin: 0.01, loyalty: 0.02, effort: 0.01 });
    const sum = Object.values(starved).reduce((x, y) => x + y, 0);
    expect(starved.reliability).toBeGreaterThanOrEqual(RELIABILITY_FLOOR - 1e-9);
    expect(sum).toBeCloseTo(1, 9);
    expect(starved.arrival).toBeGreaterThan(starved.cost);
    expect(starved.arrival).toBeGreaterThan(starved.effort);
  });
});
