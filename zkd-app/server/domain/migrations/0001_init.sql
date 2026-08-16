-- One table per top-level Map in server/domain/store.ts, JSONB-per-aggregate:
-- the full TypeScript shape from server/domain/types.ts lives in `data`
-- as-is, with only the columns a real query filters/sorts on pulled out.
-- See zkd-app/README.md for why this schema shape was chosen over full
-- relational normalization.

create table if not exists flights (
  id text primary key,
  dep_iso text not null,
  data jsonb not null
);
create index if not exists flights_dep_iso_idx on flights (dep_iso);

create table if not exists passengers (
  id text primary key,
  data jsonb not null
);

-- Keyed by lowercased email, same as the old Map<string, Credential>.
-- `data` includes passwordHash — never logged, never returned over the wire
-- (see server/domain/types.ts's Credential comment for why it's a separate
-- table from passengers at all).
create table if not exists credentials (
  email text primary key,
  passenger_id text not null,
  data jsonb not null
);
create index if not exists credentials_passenger_id_idx on credentials (passenger_id);

create table if not exists travellers (
  id text primary key,
  data jsonb not null
);

create table if not exists bookings (
  id text primary key,
  passenger_id text not null,
  flight_id text not null,
  data jsonb not null
);
create index if not exists bookings_passenger_id_idx on bookings (passenger_id);
create index if not exists bookings_flight_id_idx on bookings (flight_id);

create table if not exists itineraries (
  id text primary key,
  passenger_id text not null,
  data jsonb not null
);

-- key: `${flightId}:${passengerId}`, same composite key the old
-- Map<string, PreAuthRecord> used.
create table if not exists pre_auths (
  key text primary key,
  flight_id text not null,
  passenger_id text not null,
  data jsonb not null
);

-- key: passengerId. `data` is the whole PastFlight[] for that passenger —
-- the old store kept one Map entry per passenger holding the full array,
-- not one row per past flight, so this mirrors that exactly.
create table if not exists past_flights (
  passenger_id text primary key,
  data jsonb not null
);

-- key: flightId — one active disruption event per flight, same as the old
-- Map<string, DisruptionEvent>.
create table if not exists disruption_events (
  flight_id text primary key,
  data jsonb not null
);

-- key: `${flightId}:${passengerId}`, same composite key as the old
-- Map<string, RecoveryTask>.
create table if not exists recovery_tasks (
  key text primary key,
  flight_id text not null,
  passenger_id text not null,
  data jsonb not null
);
create index if not exists recovery_tasks_flight_id_idx on recovery_tasks (flight_id);

-- Real Postgres sequences replace the old module-level `let bookingSeq = 0`
-- style counters (server/domain/store.ts) — those were process-local and
-- would collide across two ECS tasks generating ids concurrently; a
-- sequence's nextval() is atomic across every connection to this database.
create sequence if not exists booking_seq;
create sequence if not exists itinerary_seq;
create sequence if not exists task_seq;
create sequence if not exists traveller_seq;

-- A one-row marker so ensureSeeded() (server/domain/seed.ts) only actually
-- seeds demo data once across every process sharing this database, not once
-- per process — see that file's advisory-lock-guarded doSeed() for how this
-- is used.
create table if not exists seed_state (
  id text primary key
);
