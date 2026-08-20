-- A member's temporary, per-flight journey window + consent choice, set before
-- a booked flight is disrupted. Same shape and keying as pre_auths: one row per
-- (flight, passenger), a JSON blob, upserted by a `${flightId}:${passengerId}`
-- key. Deliberately separate from the durable member profile — these are
-- discarded with the flight, never promoted to MyCa.
create table if not exists journey_prefs (
  key text primary key,
  flight_id text not null,
  passenger_id text not null,
  data jsonb not null
);
