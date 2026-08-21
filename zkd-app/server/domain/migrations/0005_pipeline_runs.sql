-- Durability for the pipeline state machine, added 2026-08-21. pipelineRuns
-- (server/domain/store.ts) was the one piece of domain state deliberately
-- left in-memory when everything else moved to Postgres — this table is
-- what closes that gap without touching any of the 24+ existing synchronous
-- call sites in journal.ts/pipeline/index.ts: store.ts's getPipelineRun/
-- setPipelineRun/getPipelineRunsForFlight/listPipelineRuns all still read
-- and write the in-memory Map synchronously (unchanged), and setPipelineRun
-- ALSO mirrors to this table fire-and-forget, the same pattern journal.ts's
-- own mirrorToTask() already established for an analogous concern. On
-- startup, hydratePipelineRunsFromDb() reads every row back into the Map —
-- real durability across a restart, zero risk to the hot path.
create table if not exists pipeline_runs (
  key text primary key,
  flight_id text not null,
  passenger_id text not null,
  data jsonb not null
);
create index if not exists pipeline_runs_flight_id_idx on pipeline_runs (flight_id);
