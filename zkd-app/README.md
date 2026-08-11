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
without it, the app runs entirely on its mock data. See `round2-api-requirements.xlsx` at the
repo root for signup links and free-tier details per provider.
