# Deploying `zkd-app`

**ZKD Concierge · Codestreet 2026 / American Express**

Two things bite when this repo is deployed to Vercel. The first is a
misconfiguration and is easy. The second is architectural and is not — read it
before promising anyone a live URL.

---

## 1. The repo root is not an app

There is no `package.json` at the repository root, and there are four separate
applications underneath it:

| Path | What it is |
|---|---|
| `zkd-app/` | **The Round 2 product.** Next.js 16. This is the one to deploy. |
| `zkd-android/` | Expo / React Native. Not a web deployment. |
| `zkd-sites/` and `Code/` | Vite builds of the three Round 1 evidence sites |
| `amex-travel-disruption-concierge/` | A separate Temporal/OPA prototype with its own `web/vercel.json` |

If Vercel is pointed at the repository root with no configuration, the build
fails before it starts: there is nothing at the root to install. If it
auto-detects, it may well pick the wrong one of the four.

**The fix, in the Vercel dashboard:** set the project's **Root Directory** to
`zkd-app`. That is a project setting and cannot be expressed in a config file, so
it has to be done once in the UI (Project → Settings → General → Root Directory).

The `vercel.json` at the repo root is a fallback for the case where Root
Directory is left at the repo root — it installs and builds `zkd-app` explicitly.
When Root Directory *is* set to `zkd-app`, Vercel reads `zkd-app/vercel.json`
instead and ignores the root one, so keeping both is harmless.

### Environment variables

None are required. The app builds and runs with no keys at all — every provider
adapter falls back to a labelled mock, and the UI prints `mock` where it is
showing one. Adding keys upgrades individual providers; missing keys never break
the build. Verified by building with `.env.local` removed.

Optional, in rough order of value:

| Variable | What it turns on |
|---|---|
| `DUFFEL_ACCESS_TOKEN` | Real flight inventory with real offer expiries (which is what the confirmation window is derived from) |
| `LUMO_API_KEY` | Real disruption forecasts instead of the labelled mock |
| `AVIATIONSTACK_API_KEY` | Live flight status, and reschedule detection against the carrier's published schedule |
| `LITEAPI_API_KEY` | Real hotel inventory |
| `SABRE_CLIENT_ID` / `SABRE_CLIENT_SECRET` | A second inventory source (cert currently returns no results) |
| `GEMINI_API_KEY` | Plain-language explanation text |
| `MYCA_API_KEY` | Real card-member preferences instead of the mock profile |

---

## 2. The engine needs one continuous process — Vercel does not give it one

This is the one that matters, and it is not a bug to be fixed by configuration.

`server/domain/store.ts` holds the entire domain in module-level `Map`s, and
`server/engine/simulation.ts` advances every disruption with `setTimeout` chains
so that a recovery progresses on schedule **whether or not any client is
polling**. That is deliberate: it is what makes the server, rather than the
member's browser, the thing that decides what happens.

Both assume a single long-lived Node process. Vercel's serverless functions do
not provide one:

- Each invocation may land in a fresh isolate, so the `Map`s can be empty or
  stale between two requests that a user experiences as one session.
- A `setTimeout` scheduled during one request is not guaranteed to survive past
  that request's response, so the timed transitions — DECIDING → READY, and the
  window expiring into a resolution — may simply never fire.

The practical effect: the app would **build and deploy successfully, and then
behave incorrectly at runtime.** A disruption might sit in `DECIDING` forever, or
a member's window might never resolve. That is worse than a failed build, because
it looks fine until someone demos it.

### What to do about it

**For the finale demo:** run it as a persistent process, not serverless.
`npm run build && npm start` on any host that keeps the process alive — a small
VM, Render, Railway, Fly, or simply a laptop on the venue network. This is the
tested path.

**If a Vercel URL is genuinely needed:** the store and the scheduler both have to
move out of process memory — the store to Redis/Postgres, and the timed
transitions to a durable scheduler (which is what Temporal is for, and what the
architecture already says the production system uses). That is a real piece of
work, not a config change, and it is not done.

This limitation is already stated in the source: see the header comments on
`server/engine/simulation.ts` and `server/domain/store.ts`.
