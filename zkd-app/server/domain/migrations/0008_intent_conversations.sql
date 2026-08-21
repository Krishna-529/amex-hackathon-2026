-- The member's running free-text conversation about one flight (the chat that
-- replaced the one-shot intent box). Same shape and keying as journey_prefs /
-- pre_auths: one row per (flight, passenger), a JSON blob, upserted by a
-- `${flightId}:${passengerId}` key. Temporary and per-flight — discarded with
-- the flight, never merged into the durable MyCa profile.
create table if not exists intent_conversations (
  key text primary key,
  flight_id text not null,
  passenger_id text not null,
  data jsonb not null
);
