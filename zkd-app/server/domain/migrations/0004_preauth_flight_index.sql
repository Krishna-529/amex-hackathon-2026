-- pre_auths and journey_prefs both carry a flight_id column (added
-- 0001/0003) but neither was ever indexed on it, unlike bookings and
-- recovery_tasks. Added 2026-08-21 alongside store.ts's new
-- getPreAuthsForFlight() — server/engine/altsCache.ts's mergePinned() used
-- to find a flight's pre-auths by loading the ENTIRE passenger table and
-- issuing one getPreAuth call per passenger, a true N+1 on a hot path (alts
-- refresh can fire every 20s during a real disruption). The new query
-- filters by flight_id directly; this index is what makes that a real index
-- lookup instead of a sequential scan.
create index if not exists pre_auths_flight_id_idx on pre_auths (flight_id);
create index if not exists journey_prefs_flight_id_idx on journey_prefs (flight_id);
