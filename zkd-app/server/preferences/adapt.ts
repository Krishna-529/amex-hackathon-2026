/**
 * The single translation point between the wire preference schema and the
 * repo's internal types.
 *
 * Nothing else in the codebase is allowed to know both vocabularies. There are
 * already two (`TravelPreferences` in server/myca.ts and the free-form
 * `Passenger.prefs[]`); a third that everyone reads directly is how they drift,
 * and preferences that drift are how an agent books against an entitlement the
 * member no longer holds.
 *
 * ── Three conversions that are easy to get silently wrong ──────────────────
 *
 * 1. **`red_eye_tolerance` is the exact inverse of `avoidRedEye`.** It is
 *    flipped exactly once, here, on a line that says so. Done inline at a call
 *    site it would survive review and then rank every overnight option
 *    backwards — the failure would look like bad scoring, not a bad boolean.
 *
 * 2. **`preferred_cabin` is not `cabinEntitlement`.** Entitlement is a ceiling
 *    the card product sets and MyCa owns; preference is what the member wants
 *    within it. Both survive: we score against the preference and gate against
 *    the entitlement. Collapsing them would let a stated preference for
 *    Business quietly authorise a fare the card does not cover.
 *
 * 3. **Money keeps its currency.** The wire field is `..._usd`, but this
 *    codebase refuses FX by design (altsFromOffers.ts marks a fare
 *    `needsConversion` and forces `ok:false` rather than invent a rate). So the
 *    suffix becomes data — `{amount, currency:'USD'}` — and a USD cap against
 *    INR fares gates rather than silently auto-approving. Honest, and it will
 *    gate more than you expect on an INR demo.
 */

import type { CabinClass, TravelPreferences } from '../myca';
import type {
  AlertChannel, HotelAmenity, OptimizationStrategy, RideshareProvider,
  TravelerPreferencesWire, WireCabin,
} from './schema';
import { WIRE_DEFAULTS } from './schema';
import type { Consent, Passenger } from '../domain/types';
import type { MycaProfile } from '../myca';

export type Money = { amount: number; currency: string };

/**
 * The rules half of the profile — everything that governs how the agent acts
 * rather than what the member likes. Kept separate from `TravelPreferences`
 * because these are decisions, not tastes, and the distinction is load-bearing:
 * server/pipeline/score.ts's applyHardRules() runs the hard ones as filters
 * before scoring, where a weighted sum can never outvote them.
 */
export type RebookingRules = {
  strategy: OptimizationStrategy;
  /** hard: never book below the preferred cabin */
  allowCabinDowngrade: boolean;
  /** hard: IATA codes that disqualify an option outright */
  avoidAirlines: string[];
  /** hard: caps connection depth */
  maxLayovers: number;
  /** HH:mm local to the destination, or null when unconstrained — hard filter */
  arrivalBeforeLocal: string | null;
  /** the flight/total spend cap the member pre-authorises. NOT currently
   *  enforced by server/pipeline/score.ts — only the real MyCa
   *  perTransactionCap (passed separately as ScoreContext.cap) gates. Kept
   *  here since adapt() produces it, but this is a known, flagged gap, not
   *  a silently-patched one — see the implementation plan's Risks section. */
  outOfPocketCap: Money | null;
  /** a SEPARATE budget — ground spend is not inside the flight cap */
  groundCap: Money | null;
  /** delay past which an overnight option is composed at all */
  hotelTriggerHours: number;
  /** delay past which a multi-day rental is indicated (no provider wired) */
  rentalCarTriggerHours: number;
  alertChannels: AlertChannel[];
  homeAirport: string;
};

export type HotelRules = {
  accessibilityRequired: boolean;
  mustHaveAmenities: HotelAmenity[];
  maxDistanceKm: number;
  roomType: 'king' | 'queen' | 'twin' | 'any';
  /** chain names the member holds status with — a ranking boost, never a filter */
  loyaltyChains: string[];
};

export type GroundRules = {
  /** waterfall order; providers we have not registered are skipped, not errors */
  providerHierarchy: RideshareProvider[];
  vehicleTier: 'standard' | 'xl' | 'luxury' | 'eco';
};

export type AdaptedPreferences = {
  preferences: TravelPreferences;
  /** what the member wants, distinct from what the card entitles them to */
  preferredCabin: CabinClass;
  consent: Consent;
  rules: RebookingRules;
  hotel: HotelRules;
  ground: GroundRules;
};

const CABIN_OF: Record<WireCabin, CabinClass> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
};

/** "Aisle, forward cabin" is what the existing UI renders, so rebuild that string. */
function seatText(
  pref: TravelerPreferencesWire['flight_preferences'],
): string {
  const seat = pref.seat_preference && pref.seat_preference !== 'no_preference'
    ? pref.seat_preference[0].toUpperCase() + pref.seat_preference.slice(1)
    : 'No preference';
  const loc = pref.seat_location && pref.seat_location !== 'any'
    ? `, ${pref.seat_location.replace(/_/g, ' ')}`
    : '';
  return `${seat}${loc}`;
}

export function adapt(wire: TravelerPreferencesWire, billingCurrency: string): AdaptedPreferences {
  const fp = wire.flight_preferences;
  const rules = wire.autonomous_rebooking_rules;
  const hp = wire.hotel_preferences ?? {};
  const gp = wire.ground_transport_preferences ?? {};

  const preferredCabin = CABIN_OF[fp.preferred_cabin ?? 'economy'];

  // THE INVERSION. Once, here, named. See the module header.
  const redEyeTolerated = rules.red_eye_tolerance ?? WIRE_DEFAULTS.red_eye_tolerance;
  const avoidRedEye = !redEyeTolerated;

  const preferences: TravelPreferences = {
    seat: seatText(fp),
    meal: fp.special_meal_code ?? 'No preference',
    // Entitlement is NOT taken from the wire: the card is the system of record
    // for what the member may be moved into, and a preference file must not be
    // able to raise its own ceiling. Callers overlay the real MyCa entitlement;
    // the preferred cabin is the floor we default to when none is supplied.
    cabinEntitlement: preferredCabin,
    preferredCarriers: (wire.loyalty_programs?.airlines ?? [])
      .map((a) => a.airline_code)
      .filter(Boolean),
    perTransactionCap: capOf(rules.max_out_of_pocket_expense_usd, billingCurrency),
    avoidRedEye,
  };

  return {
    preferences,
    preferredCabin,
    // The entire auto-rebooking policy the repo already models.
    consent: (rules.auto_approve_rebooking ?? WIRE_DEFAULTS.auto_approve_rebooking) ? 'autopilot' : 'ask',
    rules: {
      strategy: rules.optimization_strategy,
      allowCabinDowngrade: rules.allow_cabin_downgrade ?? WIRE_DEFAULTS.allow_cabin_downgrade,
      avoidAirlines: (fp.avoid_airlines ?? []).map((c) => c.toUpperCase()),
      maxLayovers: fp.max_acceptable_layovers ?? WIRE_DEFAULTS.max_acceptable_layovers,
      arrivalBeforeLocal: fp.arrival_before_local ?? null,
      outOfPocketCap: capOrNull(rules.max_out_of_pocket_expense_usd),
      groundCap: capOrNull(rules.max_ground_transport_spend_usd ?? WIRE_DEFAULTS.max_ground_transport_spend_usd),
      hotelTriggerHours: rules.hotel_trigger_threshold_hours ?? WIRE_DEFAULTS.hotel_trigger_threshold_hours,
      rentalCarTriggerHours:
        rules.rental_car_trigger_threshold_hours ?? WIRE_DEFAULTS.rental_car_trigger_threshold_hours,
      alertChannels: wire.contact_and_notifications?.preferred_alert_channels ?? ['push'],
      homeAirport: wire.traveler_identity?.home_airport_code ?? '',
    },
    hotel: {
      accessibilityRequired: hp.accessibility_requirements ?? WIRE_DEFAULTS.accessibility_requirements,
      mustHaveAmenities: hp.must_have_amenities ?? [],
      maxDistanceKm: hp.max_distance_from_airport_km ?? WIRE_DEFAULTS.max_distance_from_airport_km,
      roomType: hp.preferred_room_type ?? 'any',
      loyaltyChains: (wire.loyalty_programs?.hotels ?? []).map((h) => h.chain_name).filter(Boolean),
    },
    ground: {
      // Uber first when unstated: it is the only registered provider that can
      // actually be requested and cancelled.
      providerHierarchy: gp.immediate_rideshare?.provider_hierarchy ?? ['uber'],
      vehicleTier: gp.immediate_rideshare?.vehicle_tier ?? 'standard',
    },
  };
}

/**
 * The wire says USD in the field name. We keep that as data rather than
 * pretending it is the member's billing currency — see the module header. When
 * the two differ, the existing needsConversion path in altsFromOffers.ts marks
 * affected options as needing explicit approval instead of auto-approving
 * across a rate we do not hold.
 */
function capOf(usd: number | undefined, billingCurrency: string): Money {
  if (usd === undefined) return { amount: 0, currency: billingCurrency };
  return { amount: usd, currency: 'USD' };
}

function capOrNull(usd: number | undefined): Money | null {
  return usd === undefined ? null : { amount: usd, currency: 'USD' };
}

/**
 * Party rule: preferences are the card member's, because they are the one who
 * consents and pays — with one exception.
 *
 * Accessibility is a fact about a human being, not a taste. If any traveller in
 * the party needs an accessible room, the party does, and the strictest
 * requirement across the party wins.
 */
export function unionHotelRulesAcrossParty(
  cardMember: HotelRules,
  partyNeedsAccessibility: boolean,
): HotelRules {
  return partyNeedsAccessibility ? { ...cardMember, accessibilityRequired: true } : cardMember;
}

/**
 * Synthesizes a complete wire profile for a passenger who has never saved
 * explicit preferences, so adapt() always has a full object to translate
 * rather than every call site needing its own partial-profile handling.
 * `optimization_strategy: 'earliest_arrival'` is a deliberate, documented
 * product default (the closest honest match to "get there reliably soonest")
 * — NOT a behavioral shim for the old find()-cascade logic it replaces, which
 * had no defined ranking semantic at all. `auto_approve_rebooking` is derived
 * FROM `passenger.consent`, one-directionally, purely so this synthesized
 * object is internally consistent — `passenger.consent` remains the sole
 * authoritative field everywhere else in the app; the `.consent` this
 * produces via adapt() is never read back into it.
 */
export function defaultWireFor(passenger: Passenger, myca: MycaProfile): TravelerPreferencesWire {
  return {
    traveler_identity: {
      full_legal_name: passenger.legalName,
      date_of_birth: passenger.dob,
      gender: passenger.gender.toLowerCase().startsWith('f')
        ? 'FEMALE'
        : passenger.gender.toLowerCase().startsWith('m')
          ? 'MALE'
          : 'UNSPECIFIED',
      nationality: passenger.nationality,
      home_airport_code: '',
    },
    contact_and_notifications: {
      primary_phone: passenger.contact.phone,
      primary_email: passenger.contact.email,
      preferred_alert_channels: ['push'],
    },
    loyalty_programs: {
      airlines: passenger.loyalty.map((l) => ({ airline_code: l.airline, elite_status_level: l.tier })),
    },
    flight_preferences: {},
    ground_transport_preferences: {},
    autonomous_rebooking_rules: {
      optimization_strategy: 'earliest_arrival',
      auto_approve_rebooking: passenger.consent === 'autopilot',
      hotel_trigger_threshold_hours: WIRE_DEFAULTS.hotel_trigger_threshold_hours,
      rental_car_trigger_threshold_hours: WIRE_DEFAULTS.rental_car_trigger_threshold_hours,
      max_out_of_pocket_expense_usd: myca.preferences.perTransactionCap.currency === 'USD'
        ? myca.preferences.perTransactionCap.amount
        : undefined,
    },
  };
}
