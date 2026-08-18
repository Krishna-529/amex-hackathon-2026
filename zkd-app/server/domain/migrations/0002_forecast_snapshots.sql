-- Durable, queryable per-tick prediction history — every real ('internal-ml')
-- AND neighbor-smoothed ('neighbor-smoothed') forecast server/engine/forecast.ts's
-- applyScore() computes, one row per compute. See server/engine/neighborSmoothing.ts
-- and config/risk-thresholds.json's neighborSmoothing block.
--
-- Coexists with flights.data->forecastHistory (JSONB array, capped at
-- FORECAST_HISTORY_CAP=288 in forecast.ts): that array remains the read path
-- for the UI's HistoryChart (components/ForecastAudit.tsx), unchanged. This
-- table exists for two reasons the JSONB array can't serve: (1) real
-- DB-level storage of every prediction, queryable independent of any one
-- flight's row; (2) an efficient "other flights at airport X departing
-- within window Y, with their latest REAL score" query for neighbor
-- smoothing — not expressible efficiently against N separate flights' JSONB
-- blobs without loading the whole flights table into memory on every tick.
create table if not exists forecast_snapshots (
  id bigserial primary key,
  flight_id text not null references flights(id) on delete cascade,
  origin text not null,
  dep_epoch_ms bigint not null,
  cancel_probability double precision not null,
  pct integer not null,
  risk_score integer,
  band text not null,
  confidence double precision not null,
  model_version text not null,
  -- 'internal-ml' | 'neighbor-smoothed' — see server/engine/riskModel.ts's ModelScore.source
  source text not null,
  as_of_ms bigint not null,
  created_at timestamptz not null default now()
);

-- Neighbor query: same origin, departure-time window — see
-- server/domain/store.ts's getNeighborRealSnapshots().
create index if not exists forecast_snapshots_neighbor_idx
  on forecast_snapshots (origin, dep_epoch_ms);

-- Per-flight "latest real score" lookups — getLastRealSnapshot().
create index if not exists forecast_snapshots_flight_asof_idx
  on forecast_snapshots (flight_id, as_of_ms desc);
