/**
 * The `AutonomousTravelerPreferences_Final` wire contract, as TypeScript.
 *
 * This is the shape a real MyCa (or any preference store) would hand us. It is
 * deliberately NOT the shape anything downstream consumes — ./adapt.ts is the
 * only module allowed to know both this and the repo's internal types.
 *
 * That indirection earns its keep. The repo already carries two vocabularies
 * for preferences: the typed `TravelPreferences` in server/myca.ts and the
 * free-form `Passenger.prefs: {k,v}[]`. Adding a third without one authoritative
 * translation point is how they drift — and preferences that drift are how an
 * agent books against an entitlement the member no longer has.
 *
 * Everything here is optional except what the schema marks required, because a
 * partial profile must degrade to sane defaults rather than fail a recovery.
 * A member with no stated preferences still has to get home.
 */

export type Gender = 'MALE' | 'FEMALE' | 'UNSPECIFIED';

export type TravelerIdentity = {
  full_legal_name: string;
  date_of_birth: string;
  gender: Gender;
  /** ISO 3166-1 alpha-2 */
  nationality: string;
  passport_number?: string;
  passport_expiry?: string;
  /** US TSA PreCheck. Passed through to ticketing; never a blocker. */
  known_traveler_number_ktn?: string;
  redress_number?: string;
  home_airport_code: string;
};

export type AlertChannel = 'sms' | 'whatsapp' | 'email' | 'push';

export type ContactAndNotifications = {
  primary_phone: string;
  primary_email: string;
  preferred_alert_channels: AlertChannel[];
};

export type LoyaltyPrograms = {
  airlines?: { airline_code: string; frequent_flyer_number?: string; elite_status_level?: string }[];
  hotels?: { chain_name: string; loyalty_number?: string; elite_status_level?: string }[];
  rental_cars?: { agency_name: string; loyalty_number?: string }[];
};

export type WireCabin = 'economy' | 'premium_economy' | 'business' | 'first';

export type FlightPreferences = {
  preferred_cabin?: WireCabin;
  seat_preference?: 'aisle' | 'window' | 'middle' | 'no_preference';
  seat_location?: 'front' | 'exit_row' | 'bulkhead' | 'any';
  /** IATA meal code, e.g. VGML / GFML / KSML */
  special_meal_code?: string;
  max_acceptable_layovers?: number;
  /** IATA carrier codes to block outright — a hard rule, not a ranking hint */
  avoid_airlines?: string[];
  /**
   * HH:mm, 24h, local to the destination airport. NOT part of the original
   * wire contract this file otherwise ports verbatim — added so a free-text
   * refine prompt ("arrive before 6pm," server/engine/refine.ts) has a
   * structured field to land in. Optional; absent means no constraint.
   */
  arrival_before_local?: string;
};

export type HotelAmenity =
  | '24_hour_checkin'
  | 'airport_shuttle'
  | 'free_wifi'
  | 'gym'
  | 'restaurant_on_site';

export type HotelPreferences = {
  preferred_room_type?: 'king' | 'queen' | 'twin' | 'any';
  accessibility_requirements?: boolean;
  must_have_amenities?: HotelAmenity[];
  max_distance_from_airport_km?: number;
};

export type RideshareProvider =
  | 'uber'
  | 'lyft'
  | 'mozio_aggregator'
  | 'karhoo_aggregator'
  | 'blacklane';

export type GroundTransportPreferences = {
  immediate_rideshare?: {
    /** Waterfall order. Providers we have not registered are skipped, not errors. */
    provider_hierarchy?: RideshareProvider[];
    vehicle_tier?: 'standard' | 'xl' | 'luxury' | 'eco';
  };
  multi_day_rental_car?: {
    preferred_agencies?: ('hertz' | 'avis' | 'enterprise' | 'national')[];
    car_class?: 'compact' | 'sedan' | 'suv' | 'luxury';
  };
};

export type OptimizationStrategy =
  | 'earliest_arrival'
  | 'stick_to_preferred_airline'
  | 'minimize_layovers'
  | 'lowest_cost';

export type AutonomousRebookingRules = {
  optimization_strategy: OptimizationStrategy;
  auto_approve_rebooking: boolean;
  allow_cabin_downgrade?: boolean;
  /**
   * NOTE the unit in the name. This codebase refuses FX conversion by design
   * (see altsFromOffers.ts, which marks a fare `needsConversion` and forces
   * ok:false rather than guess a rate), so a cap whose currency is baked into
   * its field name cannot be compared to a fare quoted in anything else.
   * ./adapt.ts reads it as {amount, currency:'USD'} and lets the existing
   * needsConversion path require explicit approval. Prefer
   * `max_out_of_pocket_expense: {amount, currency}` if the wire format can change.
   */
  max_out_of_pocket_expense_usd?: number;
  hotel_trigger_threshold_hours: number;
  rental_car_trigger_threshold_hours: number;
  max_ground_transport_spend_usd?: number;
  /** INVERSE of the repo's `avoidRedEye`. See adapt.ts — the flip happens once, there. */
  red_eye_tolerance?: boolean;
};

export type TravelerPreferencesWire = {
  traveler_identity: TravelerIdentity;
  contact_and_notifications: ContactAndNotifications;
  loyalty_programs?: LoyaltyPrograms;
  flight_preferences: FlightPreferences;
  hotel_preferences?: HotelPreferences;
  ground_transport_preferences: GroundTransportPreferences;
  autonomous_rebooking_rules: AutonomousRebookingRules;
};

/**
 * Defaults matching the JSON Schema's own `default` annotations, so a partial
 * profile behaves the way the schema says it should rather than the way
 * whichever call site read it first happened to assume.
 */
export const WIRE_DEFAULTS = {
  max_acceptable_layovers: 1,
  accessibility_requirements: false,
  max_distance_from_airport_km: 15,
  auto_approve_rebooking: true,
  allow_cabin_downgrade: false,
  hotel_trigger_threshold_hours: 6,
  rental_car_trigger_threshold_hours: 24,
  max_ground_transport_spend_usd: 150,
  red_eye_tolerance: true,
} as const;
