# Auth & Security

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

Establishes who is acting on every request: a signed-in member (`session.ts`), or a holder of the
shared operator key (`opsSession.ts`) for the `/ops` console. It is the single point (`guard.ts`)
where a cookie becomes a trusted `Passenger` or an operator go-ahead, so no route ever trusts a
body/query passenger id as identity. It also carries the app's two other cross-cutting defenses —
an Origin-based CSRF check (`csrf.ts`) and an in-process token-bucket rate limiter
(`rateLimit.ts`) — that mutating routes apply on top of the identity check.

## Where it lives

| File | Purpose |
|---|---|
| `server/auth/session.ts` | Member session: sign/verify a `zkd_session` cookie, 12h expiry |
| `server/auth/opsSession.ts` | Operator session: sign/verify a `zkd_ops_session` cookie against a shared `OPS_ACCESS_KEY`, 8h expiry |
| `server/auth/guard.ts` | `requireSession`, `requireSelf`, `requireOperator` — the only place a cookie becomes an authorization decision |
| `server/auth/passwords.ts` | scrypt password hashing/verification, plus `DUMMY_HASH` for timing-safe unknown-email handling |
| `server/auth/csrf.ts` | `isSameOriginRequest()` — Origin-vs-Host CSRF check |
| `server/rateLimit.ts` | `checkRateLimit`/`consumeToken` — in-process token-bucket limiter, keyed per route+client |
| `server/jsonBody.ts` | `parseJsonBody()` — shape-validated JSON body parsing shared by routes (400 instead of an unhandled parse throw) |
| `app/api/auth/login/route.ts`, `.../logout/route.ts`, `.../me/route.ts` | Member sign-in/out/identity |
| `app/api/auth/ops-login/route.ts`, `.../ops-logout/route.ts`, `.../ops-me/route.ts` | Operator sign-in/out/identity |
| `app/api/ops/demo-reset/route.ts`, `app/api/ops/mark-cancelled/route.ts` | Operator-only demo control routes |
| `server/auth/opsSession.test.ts`, `server/auth/csrf.test.ts`, `server/rateLimit.test.ts` | Unit coverage for the three modules above |

## How it works

### Member sessions

`session.ts` implements a signed session cookie from `node:crypto` alone — no `next-auth`, no
`jose`, no cookie library. The payload is `{ pid, iat }` (passenger id, issued-at ms),
base64url-encoded, with an HMAC-SHA256 signature appended after a `.`. `signSession(pid)` produces
the token; `verifySession(token)` re-computes the HMAC and compares it with `timingSafeEqual`
(guarding the case where `timingSafeEqual` throws on mismatched-length buffers), then checks
`Date.now() - iat` against a 12-hour (`MAX_AGE_S = 60*60*12`) ceiling. The cookie name is
`zkd_session` (`SESSION_COOKIE`); options are `httpOnly`, `sameSite: 'lax'`, `path: '/'`, and
`secure` only in production (not in dev, because the Android app talks to the dev server over
plain LAN HTTP and a `Secure` cookie would never be stored there).

The signing key (`SESSION_SECRET`) falls back to a checked-in dev constant, but `session.ts`
throws at import time if `NODE_ENV === 'production'` and `SESSION_SECRET` is unset — production
cannot boot on the dev secret.

Login (`app/api/auth/login/route.ts`) rate-limits first (8 burst / 8-per-minute per client, via
`checkRateLimit`), then looks up the credential by email and calls `verifyPassword` against the
stored hash **or `DUMMY_HASH`** when no such email exists — so an unknown-email 401 takes the same
time as a wrong-password 401, closing an email-enumeration timing channel. On success it sets the
session cookie via `setSessionCookie`. Logout (`.../logout/route.ts`) is a `POST` (deliberately not
`GET`, so a prefetched link or crawler can't sign a member out) that clears the cookie. `.../me/route.ts`
calls `requireSession` and returns `{ id, displayName, consent }`, marked `dynamic = 'force-dynamic'`
so identity is never cached.

### The operator credential

`opsSession.ts` is a structurally identical but **entirely separate** mechanism from the member
session — its own cookie (`zkd_ops_session` vs `zkd_session`), its own HMAC secret
(`OPS_SESSION_SECRET` vs `SESSION_SECRET`), its own expiry (8h vs 12h, deliberately shorter — the
module comment frames an operator session as "one active demo/incident window," not a standing
login), and its own credential type: a single shared key (`OPS_ACCESS_KEY`) rather than a
per-account password. There is no `role` field bolted onto the member session payload; a member
and an operator are two different credentials verified by two different functions, and nothing in
`session.ts` can produce a token `opsSessionFrom` will accept, or vice versa (confirmed directly by
`opsSession.test.ts`'s cross-secret and tampered-payload/signature cases).

Unlike the member session, `verifyOpsKey` has **no dev fallback** for the credential itself: if
`OPS_ACCESS_KEY` is unset, `verifyOpsKey` returns `false` for every candidate (including the empty
string) rather than accepting a guessable default — an unconfigured ops console fails closed,
recoverable only by setting the env var. The signing secret (`OPS_SESSION_SECRET`) does have a dev
fallback, mirroring `session.ts`'s pattern, and is likewise refused in production when unset.

`requireOperator` is defined in **`server/auth/guard.ts`**, not in `opsSession.ts` itself.
`opsSession.ts` only exports the primitives (`verifyOpsKey`, `signOpsSession`, `verifyOpsSession`,
`opsSessionFrom`, cookie helpers). `guard.ts` composes `opsSessionFrom(req)` into the actual guard:

```ts
export async function requireOperator(req: NextRequest): Promise<OpsGuard> {
  const session = opsSessionFrom(req);
  if (!session) {
    return { response: NextResponse.json({ error: 'operator sign-in required' }, { status: 401 }) };
  }
  return { ok: true };
}
```

It checks only that a valid, unexpired operator session cookie is present — there is no further
per-operator identity or permission distinction; possession of the cookie (obtained by knowing
`OPS_ACCESS_KEY`) is the entire authorization. `requireOperator` returns `{ ok: true }` rather than
a passenger, since an operator is not acting as any particular passenger.

The `/ops` page itself (`app/ops/page.tsx`) adds a client-side gate (`OpsLoginGate`) that checks
`GET /api/auth/ops-me` on load and renders a key-entry form if not signed in. This is UX only, not
a security boundary — the page has no server-side guard of its own; the actual enforcement is
`requireOperator` on every API route the page calls (see the Interfaces table below).

### Ownership checks

`requireSession` (in `guard.ts`) resolves a cookie to a `Passenger`, returning 401 if the cookie is
absent, forged, expired, or points at a passenger the in-memory store no longer has (e.g. after a
dev restart). `requireSelf(req, id)` layers on top of it and returns 403 (not 401) when the
signed-in passenger's id doesn't match `id` — a deliberate distinction so "wrong person" is visibly
different from "not signed in" in the network tab.

Three routes — `flights/[id]/warm`, `flights/[id]/reverify`, and `flights/[id]/report-cancellation`
— need a narrower check than `requireSelf` provides: not "is this passenger the one named in the
URL" but "does this passenger have an actual booking on this flight." `report-cancellation`
establishes the pattern: call `requireSession`, then look up `getBookingsForFlight(id)` and confirm
one entry's `passengerId` matches the caller, returning 403 (`'you do not have a booking on this
flight'`) if not. `warm` and `reverify` were fixed on 2026-08-21 to reuse exactly this pattern —
before the fix, `requireSession` alone let any signed-in member force a real, budget-consuming
supplier search or model re-score against an arbitrary flight id, not only their own.

Both `warm` and `reverify` add one more branch: **an operator session bypasses the ownership check
unconditionally** — `if (!opsSessionFrom(req)) { ...ownership check... }` — so the `/ops` console
(which has no booking of its own to own) can still call these for demo purposes. `report-cancellation`
has no such bypass; it has no operator caller.

### CSRF

`isSameOriginRequest(req)` in `csrf.ts` is a second layer on top of the session cookie's
`sameSite: 'lax'`. It reads the `Origin` header and compares its host against the `Host` header:
- No `Origin` header at all → allowed (same-site top-level navigations and some non-browser
  clients don't send one; `sameSite=lax` already covers the cross-site-form case this would
  otherwise catch).
- `Origin` present but `Host` missing → rejected (fails closed).
- A malformed `Origin` (fails `new URL()`) → rejected, never throws.
- Otherwise: allowed only if `new URL(origin).host === host` (an exact host+port match — a
  same-hostname request on a different port is rejected).

It is called explicitly inside the four operator-mutation routes that check it
(`ops/demo-reset`, `ops/mark-cancelled`, `flights/[id]/demo-risk`, and `POST /api/disruptions`),
immediately after the `requireOperator` check and before the rate limit / body parsing — it is not
wired in as global middleware, so a route that doesn't call it is not covered by it.

### Rate limiting

`rateLimit.ts` implements an in-process token-bucket limiter: `Map<string, { tokens, lastRefillMs }>`
keyed by an arbitrary string. `consumeToken(key, { capacity, refillPerMinute })` refills
`Math.floor(elapsedMs / refillMs)` tokens (capped at `capacity`) on each call before checking
whether a token is available; if not, it returns `{ allowed: false, retryAfterMs }`. `checkRateLimit(req,
routeName, opts)` builds the key as `` `${routeName}:${clientKey(req)}` ``, where `clientKey` reads
the first `x-forwarded-for` entry (set by any real reverse proxy in front of the app) and falls
back to the literal string `'unknown'` in local dev where that header is absent — meaning all
unidentified local clients share one bucket per route in dev.

Limits observed per route: `login` 8 burst / 8-per-minute (by IP); `ops-login` 5/5-per-minute (by
IP); `ops-demo-reset` 5/5-per-minute; `ops-mark-cancelled` 20/20-per-minute; `ops-demo-risk` 30/30-per-minute;
`disruption-trigger` (`POST /api/disruptions`) 20/20-per-minute, applied even behind the operator
check so a stuck demo script or a compromised operator credential can't hammer the pipeline;
`warm`/`reverify` 5 burst / 1-per-minute, keyed **per passenger id** (`` `warm:${pid}` ``,
`` `reverify:${pid}` ``) rather than per IP, since the abuse surface there is per-account budget
spend; `report-cancellation` 10 burst / 2-per-minute, also per passenger id.

## Interfaces

### Inbound — who calls this, and how

Confirmed by grepping `zkd-app/` for `requireOperator`, `requireSession`, and the ownership-check
pattern (`getBookingsForFlight` + `passengerId` match) directly, not assumed:

| Route | Guard applied |
|---|---|
| `GET /api/disruptions` | `requireOperator` |
| `POST /api/disruptions` | `requireOperator` + `isSameOriginRequest` + rate limit |
| `POST /api/ops/demo-reset` | `requireOperator` + `isSameOriginRequest` + rate limit |
| `POST /api/ops/mark-cancelled` | `requireOperator` + `isSameOriginRequest` + rate limit |
| `POST /api/flights/[id]/demo-risk` | `requireOperator` + `isSameOriginRequest` + rate limit |
| `GET /api/auth/me` | `requireSession` |
| `POST /api/flights/[id]/warm` | `requireSession` + ownership check (bypassed for an operator session) + per-passenger rate limit |
| `POST /api/flights/[id]/reverify` | `requireSession` + ownership check (bypassed for an operator session) + per-passenger rate limit |
| `POST /api/flights/[id]/report-cancellation` | `requireSession` + ownership check (no operator bypass) + per-passenger rate limit |
| `app/ops/page.tsx` | No server-side guard of its own — client-side `ops-me` check only; real enforcement is the guards above on the routes it calls |

The grep for `requireSelf` found no current callers among the 20 route files that reference
`requireSession`/`requireSelf` as a group — `requireSession` plus an explicit ownership check (the
pattern above) is what routes actually use where per-resource ownership matters, not `requireSelf`.
Other routes found in that broader `requireSession`/`requireSelf` grep
(`bookings`, `bookings/hotel`, `flights/[id]/preauth`, `disruptions/[flightId]/consent`,
`flights/[id]/journey`, `flights/[id]/intent`, `devices`, `passengers/[id]`, `passengers/[id]/schedule`,
`flights/[id]`, `disruptions/[flightId]`, `pipeline/[flightId]`, `webhooks/flight-status/[provider]`)
are outside this component's scope (identity/booking/pipeline domains) and are not asserted here
beyond confirming they reference the guard module — their exact per-route guard shape belongs to
the components that own those routes.

Also confirmed: `POST /api/disruptions` has exactly one caller anywhere under `app/`/`components/` —
`app/ops/page.tsx` — matching the comment in `app/api/disruptions/route.ts` and `opsSession.ts`.

### Outbound — what this calls, and why

| Target | Why |
|---|---|
| `node:crypto` (`createHmac`, `timingSafeEqual`, `scryptSync`, `randomBytes`) | Session/ops-session signing and verification; password hashing and verification |
| `server/domain/store.ts` (`getPassenger`, `findCredentialByEmail`, `getBookingsForFlight`) | Resolve a session's passenger id to a real `Passenger`; look up login credentials; resolve booking ownership |
| `server/domain/seed.ts` (`ensureSeeded`) | Guarantee the in-memory store is populated before a guard looks anything up |

## State it owns

- The `zkd_session` cookie (member) and `zkd_ops_session` cookie (operator) — both `httpOnly`,
  `sameSite: 'lax'`, signed, carrying no state beyond `{ pid, iat }` / `{ iat }`; all real state
  (passenger identity, bookings) is looked up fresh from the store on every request, not embedded
  in the cookie.
- The rate-limiter's `Map<string, Bucket>` in `rateLimit.ts`, declared as a module-level `const
  buckets = new Map(...)` — **not** `globalThis`-scoped. It is process-local: every route sharing
  one Node process shares one map, but nothing here spans processes.

## Real vs. simulated vs. mocked

This is real, exercised application security, not a placeholder: HMAC-signed cookies with genuine
expiry enforcement, scrypt password hashing with constant-time comparison, a real (if simple)
CSRF check, and a functioning token-bucket rate limiter, all unit-tested directly. The operator
credential closes a documented, real vulnerability (unauthenticated `/ops` mutation routes and an
unauthenticated `GET /api/disruptions` leaking passenger names and owed amounts) rather than
standing in for a future fix. The acknowledged limitations are structural and stated in the code's
own comments, not hidden: one shared operator key rather than per-operator identity, and a
process-local rate limiter (see Failure modes below).

## Failure modes & concurrency

- **Invalid/expired member or operator session**: `verifySession`/`verifyOpsSession` return `null`
  on any malformed token, bad signature, or an `iat` older than the respective ceiling (never
  throw); the guard then returns a `401` JSON body (`'not signed in'` / `'operator sign-in
  required'`). A session pointing at a passenger id the store no longer has (e.g. after a dev
  restart wipes the in-memory store) also yields `401`.
- **Wrong passenger acting on their own account context**: `requireSelf` returns `403` (`'not your
  account'`); the ownership-check routes return `403` (`'you do not have a booking on this
  flight'`) — both distinguishable in the network tab from a `401`.
- **Missing/cross-site Origin on a CSRF-checked route**: `403` (`'cross-site request rejected'`).
  Only the four routes listed above call `isSameOriginRequest` — a new mutating route does not get
  this check unless it explicitly calls it.
- **Rate-limit breach**: `429` with `{ error, retryAfterMs }` (where the caller surfaces
  `retryAfterMs`) or a plain `{ error }` (the `/ops`-scoped routes).
- **Unset `OPS_ACCESS_KEY`**: ops login is unconditionally impossible (`verifyOpsKey` always
  `false`) rather than a 500 or a guessable default.
- **Horizontal scaling gap**: `rateLimit.ts`'s bucket map is a plain module-level `Map`, scoped to
  one Node process. A deployment running more than one instance behind a load balancer would give
  each instance its own independent bucket per client/route — e.g. a client hitting two instances
  round-robin effectively gets `2x` the intended `login`/`ops-login` limit. The module's own header
  comment names this directly: "a real multi-instance deployment would move this to a shared
  store" (e.g. Redis) — this is a known, accepted limitation of the current single-instance
  deployment, not something the code claims to solve.

## Tests

- `server/auth/opsSession.test.ts` — unit-level, direct: key verification (correct/wrong/empty),
  fail-closed behavior when `OPS_ACCESS_KEY` is unset, `timingSafeEqual`-guard robustness against
  different-length candidates, sign/verify round-trip, tampered-payload and tampered-signature
  rejection, malformed-token handling, expiry past the 8h ceiling, and cross-secret rejection
  (a token signed under one `OPS_SESSION_SECRET` does not verify under another).
- `server/auth/csrf.test.ts` — unit-level, direct: same-origin allow, cross-origin reject,
  same-host-different-port reject, missing-Origin allow, missing-Host-with-Origin-present reject
  (fail closed), malformed-Origin reject without throwing.
- `server/rateLimit.test.ts` — unit-level, direct: capacity-then-reject, refill-over-time (with
  fake timers), independent buckets per key, and never exceeding capacity on a long-elapsed refill.
- Gap: `server/auth/session.ts` (the member session) and `server/auth/guard.ts` (`requireSession`,
  `requireSelf`, `requireOperator` themselves) have **no dedicated unit test file** of their own —
  they are exercised only indirectly, through whichever route-level tests happen to call a guarded
  endpoint. `passwords.ts` (scrypt hashing, `DUMMY_HASH` timing defense) likewise has no direct test
  file found under `server/auth/`. The ownership-check bypass-for-operator branch in `warm.ts` and
  `reverify.ts` is also not confirmed by a test file read in this pass — only by reading the route
  source directly.

## See also
- [01-detection-and-triggers.md](01-detection-and-triggers.md)
- [09-domain-and-persistence.md](09-domain-and-persistence.md)
- [11-frontend-and-clients.md](11-frontend-and-clients.md)
