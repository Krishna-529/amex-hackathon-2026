-- The decision ledger (server/decisionLedger.ts) — predictions, outcomes,
-- threshold evaluations, notifications, member intents, member reports —
-- used to be six local JSONL files under server/.state/, appended via
-- fs.appendFileSync. That's genuinely broken across more than one process
-- instance: each instance's disk holds only what IT logged, so "every
-- prediction and every observed outcome gets logged" (this file's own
-- header quotes that exact claim) was true on one instance and false the
-- moment a second one exists. One generic table, not six, since every
-- entry is already a self-describing JSON object and a `kind` discriminator
-- is enough to keep them queryable separately — added 2026-08-21.
create table if not exists decision_ledger (
  id bigserial primary key,
  kind text not null,
  flight_id text,
  logged_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists decision_ledger_kind_flight_idx on decision_ledger (kind, flight_id);
create index if not exists decision_ledger_logged_at_idx on decision_ledger (logged_at);
