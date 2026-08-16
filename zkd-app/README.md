# zkd-app

Next.js 16 / React 19. One process, one port (`5176`) — frontend and backend are two
clearly-separated code layers within it, not two separate servers. See root `README.md` for
what this app is; this file is just about how the code is laid out.

## The backend layer

- **`server/`** — server-only code. Every external API call (NOAA, Open-Meteo, OpenSky,
  AviationStack, Duffel, Sabre, LiteAPI, Gemini) lives here, one file per provider, each
  catching its own errors and returning empty/null rather than throwing. Nothing in `server/`
  is ever imported by a `'use client'` file — it only runs on the server.
- **`app/api/*/route.ts`** — the actual HTTP endpoints (`/api/signals`, `/api/alts`,
  `/api/hotels`, `/api/flight-status`, `/api/explain`). Thin wrappers: read query params, call
  the matching `server/*` module(s), return JSON. These have to live under `app/api/` — that's
  the one place Next.js's router will recognize a route handler, so it's not optional the way
  `server/`'s location is.

Together, `server/` + `app/api/` are "the backend": nothing outside them reads `process.env`
for a supplier API key, and nothing in them is bundled into what ships to the browser.

## The data layer: Postgres, not in-memory Maps

`server/domain/store.ts` used to be a set of process-lifetime `Map`s — fine for one dev process,
but wrong the moment `zkd-risk-model/infra/app.tf` runs more than one Fargate task
(`app_desired_count >= 2`) behind the ALB: two tasks would each hold independent state, so a
disruption event created on the task that handled request 1 would be invisible to the task that
handles request 2. `store.ts` is now Postgres-backed — every exported function has the same
name and parameter shape as before, just `async` now (returns a `Promise` of what it used to
return directly), so every task reads and writes the one shared database.

- **`server/domain/db.ts`** — the shared `postgres` (porsager/postgres) client and migration
  runner. Connection string comes from `DATABASE_URL`; local dev without one set falls back to
  `postgres://zkdapp:zkdapp@localhost:5433/zkdapp` — **port 5433, not 5432**, because 5432 is
  already bound locally by an unrelated project's Docker Compose stack on this machine. Nothing
  in this repo starts that container for you (a docker-compose.yml doing that is separate,
  parallel work) — `db.ts` just points at 5433 by default and documents it here.
- **`server/domain/migrations/*.sql`** — plain numbered files (`0001_init.sql`, ...), no ORM or
  migration library, matching the rest of this codebase's hand-written-SQL style (see
  `server/decisionLedger.ts`). `db.ts`'s `ensureReady()` applies any file not yet recorded in a
  `migrations` bookkeeping table, in filename order, the first time anything touches the store
  in a given process (memoized after that). A Postgres advisory lock — held on a single
  *reserved* connection, since `pg_advisory_lock`/`unlock` are session-scoped and the pool would
  otherwise hand the unlock to a different connection than the one that locked — keeps two ECS
  tasks booting at once from racing the migration run. `server/domain/seed.ts`'s demo-data
  seeding uses the same advisory-lock pattern (a different lock key) plus a one-row `seed_state`
  marker table, so the same "don't double-run across processes" guarantee covers seeding, not
  just schema migrations — seed data uses a shared Postgres sequence for booking/traveller/
  itinerary ids, which has no natural key to de-duplicate on if two processes each seeded once.
- **Schema shape: JSONB-per-aggregate, not full relational normalization.** One table per former
  top-level `Map` (`flights`, `passengers`, `credentials`, `travellers`, `bookings`,
  `itineraries`, `pre_auths`, `past_flights`, `disruption_events`, `recovery_tasks`), each a
  `data jsonb` column holding the exact `server/domain/types.ts` shape serialized as-is, plus a
  handful of real indexed columns only where a query genuinely filters/sorts on them (`dep_iso`
  on `flights`, `flight_id`/`passenger_id` on `bookings` and `recovery_tasks`). This keeps every
  existing TypeScript type exactly as it was — nested fields like `Flight.candidates`,
  `Flight.forecastHistory`, `RecoveryTask.shown` are just part of the parent's JSON blob, not
  redesigned into child tables — while still being a bounded, mechanical migration rather than a
  full relational redesign of the domain model.
- **Upsert-as-persistence, not new "update" methods.** Several call sites
  (`server/engine/forecast.ts`, `altsCache.ts`, `groundCache.ts`,
  `server/engine/simulation.ts`'s `finishDecide`) fetch an object, mutate it in place (cache a
  forecast, refresh alt/hotel/cab candidates, flip a disruption event's phase), and need to
  persist that mutation. Every `create*` function in `store.ts` already did a plain
  `map.set(id, value)` with no existence check — an upsert in every way but name — so those call
  sites just call the same `create*` function again rather than needing a separate exported
  "update" API.

Run migrations by just running the app — `npm run dev` / `instrumentation.ts`'s `register()`
kicks `ensureReady()` at process startup, best-effort, before the batch scorer starts. Every
`store.ts` call also lazily awaits the same memoized promise, so a startup-time failure isn't
fatal to the process; it just means the first real request pays the migration-check latency
instead.

## The frontend layer

- **`app/*/page.tsx`** (everything except `app/api/`) — the actual pages.
- **`components/`** — shared UI, plus `WorldProvider.tsx`, which holds the client-side app
  state and is the only place that calls the `/api/*` endpoints above (via `fetch`, on-demand,
  never polled — see the dedup guard in `WorldProvider`).
- **`lib/`** — mostly frontend logic (`risk.ts`, `recovery.ts`, `time.ts`, the mock `data.ts`),
  plus two small shared files (`airports.ts`, `apiTypes.ts`) that both sides import — static
  data and TypeScript types carry no secrets, so sharing them across the boundary is safe.

## Running it

```bash
npm install
npm run dev          # → http://localhost:5176
```

Copy `.env.example` to `.env.local` and fill in keys to enable the live integrations —
without it, the app runs entirely on its mock data. See `assets/data/round2-api-requirements.xlsx` at the
repo root for signup links and free-tier details per provider.

## Running the prediction + caching pipeline specifically

The pieces below (`server/engine/riskModel.ts`, `batchScorer.ts`, `rescoreTiming.ts`,
`altsCache.ts`, `groundCache.ts`, `forecast.ts`, `lib/thresholdConfig.ts`) are one coherent
slice — the real trained model plus the threshold-gated pre-cache that reads its output. You do
**not** need the full `docker-compose.yml` stack (Temporal/OPA/`zkd-execute`) to run or test this
slice; that's the separate rebooking-execution plane, covered in
`documentation/architecture/execution-plane.md`.

**1. One-time setup** (skip anything already done):

```bash
cd zkd-risk-model
python3 -m venv .venv && source .venv/Scripts/activate   # Git Bash on Windows
pip install -r requirements.txt
# model artifacts already exist under models/ from the last real train.py run —
# only re-run train.py if you want fresh numbers, see zkd-risk-model/README.md
```

**2. Start three processes:**

```bash
# Postgres only — zkd-app's store, not the full execution-plane stack
docker compose up postgres -d

# the real trained model, served locally (from zkd-risk-model/, venv active)
python src/serve.py 8090

# the app itself
cd zkd-app
RISK_MODEL_URL=http://localhost:8090 npm run dev
```

Startup should print the tiered rescore scheduler, confirming `batchScorer.ts`'s three cadences
(critical/standard/dormant, see `documentation/design/01-prediction-model.md` §4a) are live:

```
[batchScorer] starting — critical=90000ms (<=180min or hold-gate+) standard=600000ms dormant=1800000ms (>1440min and watch)
```

**3. Automated tests:**

```bash
# Python — model training/inference correctness
cd zkd-risk-model && .venv/Scripts/python.exe -m pytest tests/ -v      # 12 passed

# TypeScript — threshold engine, caching, tiering, timezone handling, etc.
cd ../zkd-app
DATABASE_URL=postgres://zkdapp:zkdapp@localhost:5433/zkdapp npx vitest run   # 12 files / 64 passed
npx tsc --noEmit                                                             # clean = no output
```

**4. Manual/functional checks:**

- `http://localhost:5176/flights` — the six seeded flights each get a real forecast from the
  model within seconds (watch the `serve.py` terminal for each `/score` call).
- Open a flight already seeded near `hold-gate` (`u4`) and confirm `candidates.alts`/`hotels`/
  `cabs` are populated — proof the risk-gated pre-cache actually fired, not just the forecast.
- `curl "http://localhost:5176/api/flight-status?flightId=u4"` — a disruption-shaped status
  should trigger `forecast.ts`'s `triggerEventRescore` immediately (a fresh `/score` call in the
  `serve.py` terminal right after), rather than waiting for the next scheduled tick.
- `POST /api/flights/u4/reverify` — forces an immediate real re-score and reports the delta
  against the previous one; useful for a live demo moment.
- As real time passes, a near-departure flight should visibly move from the `standard`/`dormant`
  cadence into the 90-second `critical` one — forecast-history points get denser in the
  `serve.py` log as departure approaches.
