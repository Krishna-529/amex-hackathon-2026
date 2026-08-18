/**
 * The member's stored strategy has to survive the trip from the Passenger
 * record to the scorer's weights. Before this, `optimization_strategy` was a
 * hardcoded literal in pipeline/index.ts, so three of the four presets were
 * unreachable at runtime no matter what anyone chose.
 *
 * This covers the pure half of that path — wire document -> adapt() -> rules ->
 * weightsFor(). The store half needs a real Postgres and lives with the other
 * DB-gated tests.
 */
import { describe, test, expect } from 'vitest';
import { adapt } from './adapt';
import { weightsFor, PRESETS } from './presets';
import { WIRE_DEFAULTS, type OptimizationStrategy, type TravelerPreferencesWire } from './schema';

const ALL = Object.keys(PRESETS) as OptimizationStrategy[];

function wireWith(strategy: OptimizationStrategy): TravelerPreferencesWire {
  return {
    traveler_identity: {
      full_legal_name: 'A B', date_of_birth: '1990-01-01', gender: 'UNSPECIFIED',
      nationality: 'IN', home_airport_code: 'MAA',
    },
    contact_and_notifications: {
      primary_phone: '', primary_email: '', preferred_alert_channels: ['push'],
    },
    flight_preferences: {},
    ground_transport_preferences: {},
    autonomous_rebooking_rules: {
      optimization_strategy: strategy,
      auto_approve_rebooking: true,
      hotel_trigger_threshold_hours: 6,
      rental_car_trigger_threshold_hours: 24,
    },
  };
}

describe('a chosen strategy reaches the scorer', () => {
  test('every preset survives adapt() onto the rules', () => {
    for (const s of ALL) {
      expect(adapt(wireWith(s), 'INR').rules.strategy).toBe(s);
    }
  });

  test('each strategy produces a distinct weight vector', () => {
    const seen = new Set(ALL.map((s) => JSON.stringify(weightsFor(s))));
    expect(seen.size).toBe(ALL.length);
  });

  test('the schema carries a default for members who have not chosen', () => {
    // `preferencesFor` falls back to this when Passenger.strategy is absent, so
    // an unset preference must resolve to a real preset rather than undefined.
    expect(ALL).toContain(WIRE_DEFAULTS.optimization_strategy as OptimizationStrategy);
  });

  test('there are exactly four strategies, and /settings offers all of them', () => {
    // The settings page hardcodes its four buttons. If a fifth preset is ever
    // added, this fails and points at the UI that would silently not offer it.
    expect(ALL.sort()).toEqual(
      ['earliest_arrival', 'lowest_cost', 'minimize_layovers', 'stick_to_preferred_airline'],
    );
  });
});
