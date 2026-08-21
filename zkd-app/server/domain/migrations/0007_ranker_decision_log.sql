-- The ranker's shown-set + choice logs (server/pipeline/ranker/decisionLog.ts)
-- used to be two local JSONL files under server/.state/ (ranker-shown.jsonl,
-- ranker-choices.jsonl), same broken-across-instances shape as
-- decision_ledger before migration 0006: whichever process instance served
-- a given request is the only one whose disk ever saw that shown-set, so the
-- offline trainer (train.ts) could only ever learn from one instance's
-- traffic. One generic table, matching 0006's pattern, with a `kind`
-- discriminator ('shown' | 'choice') and a `decision_id` column pulled out
-- of the JSON body specifically because reconcile.ts and train.ts both join
-- on it — added 2026-08-21.
create table if not exists ranker_decision_log (
  id bigserial primary key,
  kind text not null,
  decision_id text not null,
  flight_id text not null,
  member_id text,
  logged_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists ranker_decision_log_decision_idx on ranker_decision_log (decision_id);
create index if not exists ranker_decision_log_flight_member_idx on ranker_decision_log (flight_id, member_id);
create index if not exists ranker_decision_log_kind_idx on ranker_decision_log (kind);
