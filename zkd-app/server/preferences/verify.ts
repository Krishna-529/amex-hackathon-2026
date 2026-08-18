/**
 * Executable checks for the preference adapter and the scoring presets.
 *
 * This repo has no test runner, and adding one mid-feature would be a bigger
 * change than the thing it verifies. But two behaviours here are the kind that
 * pass review and fail silently in production — a boolean flipped the wrong way
 * ranks every overnight option backwards and looks like bad scoring, not a bad
 * conversion — so they get executable assertions rather than trust.
 *
 * Run:  node --experimental-strip-types server/preferences/verify.ts
 */

import { adapt } from './adapt.ts';
import { weightsFor, normalise, RELIABILITY_FLOOR, PRESETS } from './presets.ts';
import type { TravelerPreferencesWire, OptimizationStrategy } from './schema.ts';

let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

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

console.log('\nred_eye_tolerance ⇄ avoidRedEye (inverse — both directions)');
{
  const tolerant = adapt(
    profile({
      autonomous_rebooking_rules: {
        ...profile().autonomous_rebooking_rules,
        red_eye_tolerance: true,
      },
    }),
    'INR',
  );
  const intolerant = adapt(
    profile({
      autonomous_rebooking_rules: {
        ...profile().autonomous_rebooking_rules,
        red_eye_tolerance: false,
      },
    }),
    'INR',
  );
  check('tolerance true  → avoidRedEye false', tolerant.preferences.avoidRedEye === false,
    `got ${tolerant.preferences.avoidRedEye}`);
  check('tolerance false → avoidRedEye true', intolerant.preferences.avoidRedEye === true,
    `got ${intolerant.preferences.avoidRedEye}`);
  // Default is red_eye_tolerance:true, so the default must NOT avoid red-eyes.
  check('omitted → schema default (tolerant)', adapt(profile(), 'INR').preferences.avoidRedEye === false);
}

console.log('\nauto_approve_rebooking → consent');
{
  check('true  → autopilot', adapt(profile(), 'INR').consent === 'autopilot');
  const ask = adapt(
    profile({
      autonomous_rebooking_rules: {
        ...profile().autonomous_rebooking_rules,
        auto_approve_rebooking: false,
      },
    }),
    'INR',
  );
  check('false → ask', ask.consent === 'ask');
}

console.log('\nMoney keeps its currency (no silent FX)');
{
  const a = adapt(
    profile({
      autonomous_rebooking_rules: {
        ...profile().autonomous_rebooking_rules,
        max_out_of_pocket_expense_usd: 200,
      },
    }),
    'INR',
  );
  // The card's per-transaction ceiling is gone (2026-08-19), but the member's
  // OWN stated budget survives on rules.outOfPocketCap — and the currency trap
  // it guards against is unchanged: a figure the wire schema names `_usd` must
  // never be silently relabelled as the card's billing currency.
  check('a USD budget is not relabelled as INR',
    a.rules.outOfPocketCap !== null && a.rules.outOfPocketCap.currency === 'USD',
    `got ${a.rules.outOfPocketCap?.currency}`);
  check('ground cap is separate from flight cap',
    a.rules.groundCap !== null && a.rules.groundCap.amount === 150);
}

console.log('\nHard rules survive adaptation');
{
  const a = adapt(
    profile({
      flight_preferences: {
        preferred_cabin: 'business',
        avoid_airlines: ['sg', 'g8'],
        max_acceptable_layovers: 0,
      },
    }),
    'INR',
  );
  check('avoid_airlines upper-cased', a.rules.avoidAirlines.join(',') === 'SG,G8', a.rules.avoidAirlines.join(','));
  check('max_acceptable_layovers 0 preserved (not defaulted to 1)', a.rules.maxLayovers === 0,
    `got ${a.rules.maxLayovers}`);
  check('allow_cabin_downgrade defaults false', a.rules.allowCabinDowngrade === false);
  check('preferred cabin distinct from entitlement default', a.preferredCabin === 'Business');
}

console.log('\nPresets');
{
  for (const s of Object.keys(PRESETS) as OptimizationStrategy[]) {
    const w = PRESETS[s];
    const sum = Object.values(w).reduce((x, y) => x + y, 0);
    check(`${s} sums to 1`, Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
    check(`${s} holds reliability floor`, w.reliability >= RELIABILITY_FLOOR - 1e-9);
  }
  // Each strategy must actually lead on its own axis, or the preset is decorative.
  check('earliest_arrival leads on arrival',
    PRESETS.earliest_arrival.arrival === Math.max(...Object.values(PRESETS.earliest_arrival)));
  check('lowest_cost leads on cost',
    PRESETS.lowest_cost.cost === Math.max(...Object.values(PRESETS.lowest_cost)));
  check('minimize_layovers leads on effort',
    PRESETS.minimize_layovers.effort === Math.max(...Object.values(PRESETS.minimize_layovers)));
  check('stick_to_preferred_airline leads on loyalty',
    PRESETS.stick_to_preferred_airline.loyalty === Math.max(...Object.values(PRESETS.stick_to_preferred_airline)));
}

console.log('\nHard-constraint boost must not dilute the reliability floor');
{
  for (const s of Object.keys(PRESETS) as OptimizationStrategy[]) {
    const w = weightsFor(s, { hasHardConstraint: true });
    const sum = Object.values(w).reduce((x, y) => x + y, 0);
    check(`${s} + boost still sums to 1`, Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
    check(`${s} + boost keeps reliability >= floor`, w.reliability >= RELIABILITY_FLOOR - 1e-9,
      `reliability=${w.reliability.toFixed(4)}`);
    check(`${s} + boost raises arrival share`, w.arrival > PRESETS[s].arrival - 1e-9);
  }
}

console.log('\nnormalise() restores a starved floor');
{
  const starved = normalise({
    arrival: 0.9, cost: 0.05, reliability: 0.01, cabin: 0.01, loyalty: 0.02, effort: 0.01,
  });
  const sum = Object.values(starved).reduce((x, y) => x + y, 0);
  check('floor restored', starved.reliability >= RELIABILITY_FLOOR - 1e-9,
    `reliability=${starved.reliability.toFixed(4)}`);
  check('still sums to 1', Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
  check('arrival still dominates the rest',
    starved.arrival > starved.cost && starved.arrival > starved.effort);
}

console.log(failures === 0 ? '\nAll preference checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
