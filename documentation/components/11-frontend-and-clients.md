# Frontend & Client Apps

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## The trap: two themes, one stylesheet

`zkd-app/app/globals.css` (1,770 lines) contains two genuinely different visual
designs, not one theme with variants.

- **`:root` (line 4) is a dark "glass" default** — deep navy `--bg:#080c14`, translucent
  `--glass`/`--edge` panels, a single blue accent `--iris:#2f7ff0`. This is what every
  grep for `:root` or `--bg` will find, and what a search stopping there will conclude
  the whole app looks like.
- **A separate, fully-scoped Amex corporate skin** lives further down, under its own
  token set — `--amex-blue`, `--amex-bg`, `--amex-card`, `--amex-ink`, `--amex-serif`,
  etc. — first declared around line 560 and restated with different literal values
  in a second, later-appended block at line 796 ("American Express Travel Redesign",
  covering the newer `/` and `/login` markup). Both blocks target the same class,
  `.amex-page`, and together drive on the order of 100 override rules
  (`.amex-page .g.panel`, `.amex-page .kv`, `.amex-page .gauge .track`, `.amex-page .tbl`, …)
  that re-skin the exact same shared component classes the dark theme uses.
- **`lib/amexRoutes.ts` decides which skin a route gets**, and it is the only place
  that decides it:

  ```ts
  export const AMEX_ROUTES = new Set([
    '/', '/login', '/flights',
    '/history', '/how-it-works', '/profile', '/settings', '/prepare',
  ]);
  const AMEX_PREFIXES = ['/flights/', '/recovery/', '/prepare/'];
  ```

  Despite the comment inside the file itself claiming only `/`, `/login`, `/flights`
  and the `/flights/*` subtree carry the skin, the code as written now puts **every
  member-facing route** on the Amex skin (`/history`, `/how-it-works`, `/profile`,
  `/settings` are in `AMEX_ROUTES`; `/recovery/*` and `/prepare/*` are in
  `AMEX_PREFIXES`). Only `/ops` — the operator console — and the top-level
  `/prepare/[id]` redirect stub stay dark. `isAmexRoute()` matches `AMEX_ROUTES`
  exactly and `AMEX_PREFIXES` by `startsWith`, so `/flights-archive` cannot
  accidentally match but `/flights/anything` does.

There is a second, orthogonal axis layered on top: a light/dark **toggle**
(`components/ThemeToggle.tsx`, floating button, state in `localStorage['zkd-theme']`,
applied as `<html data-theme="light|dark">` before first paint by an inline script in
`app/layout.tsx`). Both skins now respond to it — `:root[data-theme='light']`
re-values the dark-glass tokens to a light palette, and `:root[data-theme='dark']`
re-values the `--amex-*` tokens to a dark palette — but the toggle only changes
light-vs-dark *within* whichever skin `amexRoutes.ts` already chose for the route.
It does not choose between the two skins.

**Do not answer "which theme does this app use" by grepping `:root` or `--bg` alone.**
That token search finds only the dark-glass default and will report the app as
dark-only — which is the wrong answer for every route a member actually books,
browses, or manages their trip on. Read `lib/amexRoutes.ts` directly.

## What this component does

This is the presentation layer for two independent clients — a Next.js web app
(`zkd-app/app/`) and an Expo/React Native Android app (`zkd-android/`) — that share
one architectural rule: **nothing is computed, timed, or decided client-side.**
Every screen is a plain poller of the same server-authoritative state
(`server/engine/simulation.ts` for recovery, `server/pipeline/score.ts` for ranking,
`server/engine/forecast.ts` for risk) via `usePoll`/`usePoll.ts`, fetched on a fixed
interval and rendered as-is. Buttons POST an intent (approve, choose an alternative,
change consent) and wait for the next poll tick to show the result — there is no
optimistic local state machine standing in for what the server decides, with one
narrow, self-clearing exception (`liveForecast` on `/flights/[id]`, see below).

## Where it lives

### Web (`zkd-app/app/` + `zkd-app/lib/`)

| File | Purpose |
|---|---|
| `app/layout.tsx` | Root shell: pre-hydration theme-stamping script, `WorldProvider`, `SiteHeader`, `ThemeToggle`, footer |
| `app/page.tsx` (`/`) | Flight + hotel search and booking (Amex skin) |
| `app/globals.css` | Both stylesheets described above |
| `app/login/page.tsx` (`/login`) | Session sign-in form, demo-account autofill |
| `app/flights/page.tsx` (`/flights`) | "My flights" list, next-flight risk panel, upcoming/stays/history |
| `app/flights/[id]/page.tsx` | Flight detail: risk gauge, alternatives, pre-authorisation, free-text intent, "report cancelled" |
| `app/prepare/[id]/page.tsx` | Dead-route redirect to `/flights/[id]`, kept alive only for old notification deep links |
| `app/recovery/[id]/page.tsx` | Live recovery timeline: warm-phase recap, consent gate, booked/handed outcome |
| `app/profile/page.tsx` (`/profile`) | Read-only member/PII/booking record, "what we never hold" |
| `app/settings/page.tsx` (`/settings`) | Standing consent choice (autopilot vs. ask-me-first) |
| `app/history/page.tsx` (`/history`) | Full past-flight table |
| `app/how-it-works/page.tsx` | Static explainer of bands, thresholds, and the consent window — no polling |
| `app/ops/page.tsx` (`/ops`) | Operator-key-gated console: trigger disruptions, inspect detection health, demo controls |
| `app/not-found.tsx` | Generic 404 for a stale/rebooked flight id |
| `lib/amexRoutes.ts` | The skin-switch — see above |
| `lib/apiTypes.ts` | Client-side mirror of every server response/request shape the pages consume |
| `lib/bundle.ts` | Flight+hotel+ground "bundle" coherence/repair model shared with the pipeline (not UI-specific) |
| `lib/demoAccounts.ts` | The five seeded card-member fixtures, shared with `server/domain/seed.ts` |
| `lib/disruptionKind.ts` | Classifies a disruption signal (cancellation/reschedule/delay-cascade/diversion/none) and its member-facing copy |
| `lib/entitlement.ts` | Duty-of-care table by jurisdiction (DGCA/EU261/UK261/US-DOT/card terms) |
| `lib/outcome.ts` | Three-value past-flight outcome → CSS class/label map |
| `lib/partyCost.ts` | Client-side mirror of room/vehicle-count math; never trusted for the actual charge |
| `lib/recovery.ts` | The WARM/DECIDE/ACT step budget and totals shown on `/recovery` and `/how-it-works` |
| `lib/time.ts` | Clock-safe date/money formatting helpers (deliberately takes `now` as a parameter, never reads the clock at module scope) |
| `lib/usePoll.ts` | The polling primitive — see below |

### Android (`zkd-android/`)

| File | Purpose |
|---|---|
| `App.tsx` | Navigation stack, swapped wholesale between `Login` and the four signed-in screens on auth status |
| `src/api.ts` | The app's one network module — mirrors `zkd-app`'s API contract, session-cookie based |
| `src/config.ts` | `API_BASE_URL` — a hand-edited constant (LAN IP or `adb reverse` tunnel), no build-time injection |
| `src/lib/forecast.ts` | Hard-coded three-flight forecast fixture set — this build has no backend risk model of its own |
| `src/lib/outcome.ts` | Same outcome map as the web `lib/outcome.ts` |
| `src/lib/recovery.ts` | Same WARM/DECIDE/ACT step budget as the web version, plus a fixed `CONFIRM_WINDOW_SECONDS` fixture (web derives this per-disruption; Android cannot, having no live offer to read an expiry from) |
| `src/lib/time.ts` | Same clock-safe helpers as the web version |
| `src/lib/usePoll.ts` | Polling primitive — narrower than the web one, see below |
| `src/notify.ts` | Local Android notification channels + Expo push token registration |
| `src/screens/FlightDetailScreen.tsx` | Risk detail, read-only alternatives list — no pre-authorisation action |
| `src/screens/FlightsScreen.tsx` | "My flights" list, same next-flight alert pattern as web |
| `src/screens/LoginScreen.tsx` | Sign-in form, demo-account autofill (duplicated fixture, not imported across the package boundary) |
| `src/screens/ProfileScreen.tsx` | Member record + inline consent segmented control (folds in what web splits into `/profile` + `/settings`) |
| `src/screens/RecoveryScreen.tsx` | Live recovery timeline, same phase model as web |
| `src/theme.ts` | Fixed dark palette — no light mode, no Amex skin |
| `src/ui.tsx` | Shared "glass" primitives ported from the web dark theme |
| `src/world.tsx` | Session/auth/schedule provider — the Android analogue of `WorldProvider.tsx` |

## How it works

### The polling model

`usePoll<T>(url, intervalMs)` is the only way either client learns anything. Both
implementations fetch immediately on mount, then `setInterval` at a fixed cadence,
replacing state wholesale each tick; both clean up on unmount/url-change via a
`cancelled` flag.

- **Web** (`zkd-app/lib/usePoll.ts`) returns `{ data, error }` — a failed fetch or a
  non-OK response sets `error: true`, which pages can (and do) render around.
- **Android** (`zkd-android/src/lib/usePoll.ts`) returns just `data` — a failed fetch
  is swallowed in a bare `.catch(() => {})` with no error signal surfaced to the
  screen at all. This is a genuine divergence, not a stylistic one: an Android
  screen has no way to distinguish "still loading" from "the last several polls
  failed," where the web equivalent can.

Typical intervals in use: flight schedule 4s (both), flight detail 5s (both),
recovery view 1.5s (both — the fastest poll in the system, since it drives a visible
countdown), pre-auth 6–10s, passenger/profile 8s, ops console 2–10s depending on
panel. Nothing here respects the external-supplier rate limits `server/*.ts`
observes — this is polling the app's own same-origin API over in-memory reads, not
an external vendor.

The one place a client keeps optimistic state ahead of the poll is
`/flights/[id]`'s `liveForecast`: `onReverify()` POSTs `/api/flights/[id]/reverify`
and stores the returned forecast so the score updates instantly instead of waiting
up to 5s for the next tick; a `useEffect` clears it the moment the regular poll's
own forecast catches up (`asOf` newer-or-equal), so polling is always the
long-run source of truth.

### The identity switcher

**This no longer exists, and the prior design it replaced is worth being explicit
about because it is easy to assume otherwise from older documentation or habit.**
`components/WorldProvider.tsx` says so directly in its own header comment:

> "WHO used to come from a `?as=` query param — anyone could view or act as anyone
> by editing the URL. It now comes from the signed-in session (`GET /api/auth/me`),
> fetched once and never polled."

`SiteHeader.tsx`'s anonymous-state branch makes the same point from the other side:
"No nav, no member identity to show — there is nothing left to impersonate, because
there is nothing to show." A repo-wide search confirms `?as=` appears nowhere in
current route code — only in that one WorldProvider comment describing what used to
happen. Android's `world.tsx` carries an equivalent note: it never had a switcher at
all ("no identity switcher any more, unlike the old `DEFAULT_PASSENGER_ID` build");
whoever is signed in on the phone is the only passenger it can see or act as.

**What actually demonstrates "multiple members, multiple devices, one shared
backend" today is real per-session authentication**, not a URL parameter: signing
in as two different seeded accounts from `lib/demoAccounts.ts` (`priya@zkd.demo`,
`arjun@zkd.demo`, …) in two different browser sessions — or one in a browser tab and
one on the Android app — gives each client its own session cookie, each scoped
server-side (`server/auth/guard.ts` reads the passenger off the session, never off
a client-supplied id anywhere in the current routes). Because neither client holds
any of the disruption/recovery state itself, and both are re-fetching from the same
`server/engine/simulation.ts`, two independently signed-in sessions watching the
same flight (e.g. two travellers on one booking) converge on identical recovery
state without any coordination between the clients — that property is real and
demonstrable, it just is not driven by a query parameter any more.

### Route-by-route summary

- **`/`** — flight and hotel search/booking. Live OAG schedules and a live
  accommodation registry; no fares from OAG, so flights are shown unpriced.
  Polls nothing (search/booking are one-shot POSTs); see `00-system-overview.md`
  for where the booking lands (`Flight`/`Booking`/`PNR` creation, entering the risk
  model).
- **`/login`** — session creation against `/api/auth/login`; see
  `10-auth-and-security.md`.
- **`/flights`** — the member's trip list. Polls the shared `schedule` (via
  `WorldProvider`) plus, for the next flight only, `/api/flights/[id]/preauth`.
  Surfaces the risk band from `server/engine/forecast.ts` and links into recovery
  once `disruptionPhase !== 'none'`.
- **`/flights/[id]`** — the merged "risk + act" screen (folded in from the old
  `/prepare/[id]` on 2026-08-19). Polls flight detail and pre-auth; POSTs free-text
  intent (`/api/flights/[id]/intent`, previewed only, never auto-applied), forced
  reverify, pre-authorisation, and member-initiated cancellation reports. See
  `01-detection-and-triggers.md` for the member-report lane and
  `03-simulation-lifecycle-engine.md` for what pre-authorisation actually gates.
- **`/prepare/[id]`** — pure `redirect()` to `/flights/[id]`; kept only because
  `server/notify/templates.ts` still deep-links old push/WhatsApp messages here.
- **`/recovery/[id]`** — the live rebooking timeline. Polls the recovery view (1.5s),
  flight detail (5s), and pre-auth (10s); POSTs the member's consent action
  (approve/browse/hand-over/choose/swap/back) to `/api/disruptions/[id]/consent`.
  See `03-simulation-lifecycle-engine.md` for the phase machine this renders.
- **`/profile`** — read-only PII/booking/loyalty/payment record, sourced from
  `/api/passengers/[id]`.
- **`/settings`** — the standing autopilot-vs-ask-me-first consent choice, written
  through `WorldProvider.setConsent` → `PATCH /api/passengers/[id]`.
- **`/history`** — full past-flight table, no live polling beyond the schedule
  already held by `WorldProvider`.
- **`/how-it-works`** — static explainer; imports constants from `lib/recovery.ts`
  and `lib/confirmWindow.ts` but makes no network calls.
- **`/ops`** — operator console, gated by a separate operator-key session
  (`/api/auth/ops-login`, distinct from member login). Polls flights, active
  disruptions, and pipeline health; exposes demo-only controls (trigger a
  disruption, ramp a risk score, mark cancelled-in-data, warm candidates, reset
  demo state) that call the same production entry points a live feed or operator
  would.
- **not-found** — generic 404 for a flight id that no longer resolves (rebooked
  away, or a stale link).

### The Android subset

Confirmed against `zkd-android/src/screens/`: there are exactly five screens
(`Login`, `Flights`, `FlightDetail`, `Recovery`, `Profile`) and no others. Relative
to the web app:

- **No pre-authorisation flow.** `FlightDetailScreen.tsx` shows the risk gauge and
  a read-only list of alternatives ("We're already holding N alternatives...") with
  no free-text intent box and no "Yes — do this if it cancels" action. The web
  screen's entire pre-auth POST path (`authorise()`, `/api/flights/[id]/preauth`)
  has no Android equivalent.
- **No standalone consent-settings screen.** There is no `Settings` route at all;
  the autopilot/ask-me-first toggle is folded into `ProfileScreen.tsx` as an inline
  segmented control, mirroring the web's `/profile` + `/settings` split into one
  screen instead of two.
- **No history screen.** `FlightsScreen.tsx` renders a capped "recent history" list
  inline with a local `allHistory` toggle to expand it, rather than linking to a
  separate route.
- **No how-it-works or ops equivalent.**
- Login is a first-class screen here (web reuses one `/login` route reached by
  redirect); Android swaps its entire navigation stack between `Login` and the
  four member screens on auth status, rather than gating routes individually.

## Interfaces

### Inbound — who calls this, and how

This is the outermost layer, so "inbound" means the browser/phone itself, driven
by member interaction. What each page/screen actually calls:

**Web**: `/` → `GET /api/search/flights`, `GET /api/search/hotels`,
`POST /api/bookings`, `POST /api/bookings/hotel`. `/login` →
`POST /api/auth/login`. `/flights` → schedule poll (`WorldProvider`),
`GET /api/flights/[id]/preauth`. `/flights/[id]` → `GET /api/flights/[id]`,
`GET /api/flights/[id]/preauth`, `POST /api/flights/[id]/intent`,
`POST /api/flights/[id]/preauth`, `POST /api/flights/[id]/reverify`,
`POST /api/flights/[id]/report-cancellation`. `/recovery/[id]` →
`GET /api/disruptions/[id]`, `GET /api/flights/[id]`,
`GET /api/flights/[id]/preauth`, `POST /api/disruptions/[id]/consent`.
`/profile` → `GET /api/passengers/[id]`. `/settings` →
`PATCH /api/passengers/[id]`. `/ops` → `GET /api/flights`,
`GET /api/disruptions`, `GET /api/pipeline/health`, `POST /api/disruptions`,
`POST /api/flights/[id]/warm`, `POST /api/flights/[id]/demo-risk`,
`POST /api/ops/mark-cancelled`, `POST /api/ops/demo-reset`,
`POST /api/auth/ops-login`, `GET /api/auth/ops-me`. Every page also indirectly
depends on `GET /api/auth/me` via `WorldProvider`.

**Android**: `world.tsx` → `GET /api/auth/me` (once), schedule poll
`GET /api/passengers/[id]/schedule` (4s), `POST /api/devices` (push-token
registration, once per session), `PATCH /api/passengers/[id]` (consent).
`LoginScreen` → `POST /api/auth/login`. `FlightsScreen` →
`GET /api/disruptions/[id]` (2s, next flight only, if disrupted),
`GET /api/flights/[id]/preauth` (6s). `FlightDetailScreen` →
`GET /api/flights/[id]` (5s). `RecoveryScreen` → `GET /api/disruptions/[id]` (1.5s),
`GET /api/flights/[id]` (5s), `GET /api/flights/[id]/preauth` (10s),
`POST /api/disruptions/[id]/consent`. `ProfileScreen` →
`GET /api/passengers/[id]` (8s). Sign-out → `POST /api/auth/logout`.

### Outbound — what this calls, and why

Both clients call exclusively into the same Next.js API surface
(`zkd-app/app/api/**/route.ts`); Android's `API_BASE_URL` just points that fetch
layer at a LAN address or a USB `adb reverse` tunnel instead of same-origin. What
happens behind each route is covered elsewhere: detection and the disruption
trigger in `01-detection-and-triggers.md`; the recovery phase machine and consent
gate in `03-simulation-lifecycle-engine.md`; push/WhatsApp/notification templates
in `07-notifications.md`; session, ops-key, and CSRF handling in
`10-auth-and-security.md`.

## State it owns

Almost nothing survives a poll tick — the two exceptions worth naming:

- **Web**: `localStorage['zkd-theme']` (`'light' | 'dark'`), read by an inline
  script in `app/layout.tsx` before first paint to stamp `data-theme` and avoid a
  flash of the wrong theme; written by `ThemeToggle.tsx`. The session itself is an
  opaque cookie set by `/api/auth/login` and never inspected client-side beyond
  "does `/api/auth/me` answer." All other client state is transient React state for
  in-progress form inputs (search fields, the intent textarea, which alternative
  row is currently selected) or ops-console demo overrides (`ramp`, `marked`) that
  are pure UI mirrors of a debug POST already sent.
- **Android**: no persistent local storage at all (no `AsyncStorage`/`SecureStore`
  usage anywhere in the app) — the session cookie lives in the platform's native
  HTTP stack cookie jar, and the registered-push-token guard (`registeredFor` ref
  in `world.tsx`) is in-memory only, reset on every app restart.

Everything else — the forecast, the recovery phase, the chosen alternative, the
consent setting, the member's own profile — is server state, re-fetched every poll
tick and never cached across a reload.

## Real vs. simulated vs. mocked

`lib/demoAccounts.ts` is a small (five-entry) set of **real, seeded card-member
personas** — `priya@zkd.demo` / `arjun@zkd.demo` / `fatima@zkd.demo` /
`rohan@zkd.demo` / `ananya@zkd.demo` — each with its own password, hashed at seed
time by `server/domain/seed.ts` (which imports this same file, so there is exactly
one source of truth for the credentials, not two lists that can drift). The
login page states plainly that this is "a prototype fixture, not how a real card
member would authenticate," which is accurate: the accounts and their passwords
are fixtures, but the passenger records, bookings, and consent state they unlock
are the same real domain rows every other part of the system operates on — nothing
about the account itself is a mock in the sense of returning canned data. Android's
`LoginScreen.tsx` duplicates this same five-row list as a separate literal (it is a
different Expo bundle with no package boundary to `zkd-app/lib`), so the two lists
must be kept in sync by hand.

Android's `src/lib/forecast.ts` is a genuine mock standing in for a live model: it
hard-codes exactly three flight-code fixtures (`AI 2803`, `AI 2201`, `6E 5192`) with
canned percentages, and its header is explicit that the app has no backend risk
model of its own and deliberately does not "re-derive a probability from invented
factor weights." In practice this file appears unused by the current screens (none
of the five screens read `forecastFor` — `FlightDetailScreen` reads `detail.forecast`
straight from the live API instead), so it is dead/vestigial rather than an active
mock path.

## Failure modes & concurrency

- **A failed poll tick, web**: `usePoll` sets `error: true` and keeps the last good
  `data`; most pages don't render a distinct error state from this today (the flag
  exists but is lightly consumed), so a transient network blip is usually invisible
  and the page just shows slightly stale data until the next successful tick.
- **A failed poll tick, Android**: silently swallowed — no error signal reaches the
  screen at all (see the polling-model section above). A sustained outage looks
  identical to "still loading" on every Android screen.
- **A stale/expired session**: `WorldProvider` (web) treats any non-OK
  `/api/auth/me` as anonymous and hard-redirects to `/login` for any route outside
  `PUBLIC_PATHS` (`/`, `/login`, `/ops`); it does not poll `/api/auth/me` again
  after the initial check, so a session that expires mid-visit is only caught the
  next time a scoped API call 401s (which the pages do not uniformly handle — most
  just show stale or missing data rather than bouncing to `/login` immediately).
  Android's `world.tsx` follows the same one-shot pattern.
- **Two tabs/devices on different accounts, same flight**: this is the intended
  and supported case (see "The identity switcher" above) — each session polls its
  own passenger-scoped views, and because all state lives server-side in
  `server/engine/simulation.ts`, both converge on the same recovery phase/chosen
  alternative independently, with no client-to-client coordination and no risk of
  one tab's local state overwriting another's.
- **A member acting on a flight mid-recovery from two places at once** (e.g. web
  tab and phone both open on `/recovery/[id]`): both POST consent actions against
  the same server-side task; the server, not either client, resolves ordering —
  this component has no client-side lock or optimistic-concurrency handling of its
  own to describe.
- **`/prepare/[id]` reached from a stale notification**: redirects rather than
  404s, specifically because old push/WhatsApp messages still deep-link there —
  see `07-notifications.md`.

## Tests

No component-render or page-level UI tests exist for either client (no React
Testing Library / Jest-RN snapshot tests were found under `zkd-app/app`,
`zkd-app/components`, or anywhere in `zkd-android`). The frontend-adjacent test
coverage that does exist is narrower than "does this render correctly":

- `zkd-app/lib/noHoldsCopy.test.ts` — a static-text guard that reads the actual
  page source of every member-facing route (`app/flights`, `app/prepare`,
  `app/recovery`, `app/profile`, `app/settings`) plus the server modules that write
  copy those pages render verbatim (`server/engine/simulation.ts`,
  `server/notify/templates.ts`), asserting none of them ever claims an option is
  "held." It exists because this exact claim leaked onto `/flights/[id]` and into
  `simulation.ts`-authored recovery notes on two separate prior occasions after a
  narrower version of the same guard passed cleanly.
- `zkd-app/tests/bundle.test.ts` exercises `lib/bundle.ts`'s coherence/repair logic
  directly — this is shared flight+hotel+ground domain logic that happens to live
  under `lib/`, not UI behaviour.
- `zkd-app/lib/thresholds.test.ts`, `zkd-app/lib/thresholdConfig.test.ts`,
  `zkd-app/lib/entitlement.test.ts` similarly test business logic that lives in
  `lib/` and is consumed by the pages, not the pages themselves.

The real gap: nothing asserts that a given page renders the right thing for a
given server response, that `usePoll` behaves correctly under a flaky network, or
that `amexRoutes.ts`'s route list actually matches every route that visually needs
the skin (the discrepancy between that file's own comment and its actual
`AMEX_ROUTES` contents, noted above, is exactly the kind of drift this test gap
would not catch). Android has no test files at all.

## See also

- [01-detection-and-triggers.md](01-detection-and-triggers.md)
- [03-simulation-lifecycle-engine.md](03-simulation-lifecycle-engine.md)
- [07-notifications.md](07-notifications.md)
- [10-auth-and-security.md](10-auth-and-security.md)
