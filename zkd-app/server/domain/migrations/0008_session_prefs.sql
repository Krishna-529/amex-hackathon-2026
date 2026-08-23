-- A member's temporary, per-flight rebooking-preference override, parsed from a
-- sentence they typed into the intent box while a flight was at risk. Same shape
-- and keying as journey_prefs / pre_auths: one row per (flight, passenger), a
-- JSON blob, upserted by a `${flightId}:${passengerId}` key.
--
-- Unlike journey_prefs (which carries only a window + consent), this holds the
-- full validated PreferenceOverride — strategy, avoided airlines, layover cap,
-- budget, hotel + ground rules. It drives THIS recovery's search and ranking and
-- is discarded with the flight. It is NEVER promoted to the durable MyCa profile:
-- one sentence about one flight must not rewrite a member's standing preferences.
create table if not exists session_prefs (
  key text primary key,
  flight_id text not null,
  passenger_id text not null,
  data jsonb not null
);
