-- Standalone hotel and ground bookings.
--
-- Until now the only thing a member could book was a flight, and `bookings` is
-- flight-shaped by design: it is keyed on flight_id and carries a seat, a PNR
-- and a cabin. A hotel has none of those. Rather than widen that table with
-- columns that are null for every existing row — and make `bookings` mean two
-- different things — stays and rides get their own tables.
--
-- They mirror `bookings`' storage shape deliberately: an id, the owning
-- passenger, and the entity as JSON in `data`. Every read in store.ts already
-- works that way, so nothing new has to learn a different pattern.
--
-- `flight_id` is nullable and intentionally so: a stay booked on its own has no
-- flight, while one arranged during a recovery belongs to the flight it was
-- caused by. That single column is what lets the same table serve origination
-- and re-accommodation without a second concept.

create table if not exists stays (
  id text primary key,
  passenger_id text not null,
  flight_id text,
  data jsonb not null
);

create index if not exists stays_passenger_idx on stays (passenger_id);

create table if not exists rides (
  id text primary key,
  passenger_id text not null,
  flight_id text,
  data jsonb not null
);

create index if not exists rides_passenger_idx on rides (passenger_id);

create sequence if not exists stay_seq;
create sequence if not exists ride_seq;
