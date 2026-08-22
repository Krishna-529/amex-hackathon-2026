# Suppliers & External Integrations

> Part of the ZKD Concierge rebooking pipeline. See [00-system-overview.md](00-system-overview.md) for how this fits with the rest of the system.

## What this component does

Normalises every third-party dependency this system has — flight search/booking, hotel search/hold, ground transfers, currency conversion, member-preference data, and plain-language LLM explanations — behind a small set of shared interfaces (`Supplier`, `HotelSupplier`, `GroundSupplier`-shaped functions) so the pipeline never has to know which vendor actually answered. Every source registers itself, is queried concurrently with the others in its domain, and degrades independently: a dead or unconfigured vendor reports a typed status (`no-key` / `error` / `rate-limited` / `empty`) rather than failing the search, and nothing downstream distinguishes a live answer from a synthetic fallback except an explicit `live: false` flag that is honoured all the way to the UI copy.

## Where it lives

| File | Purpose |
|---|---|
| **Flights** | |
| `server/suppliers/index.ts` | Registry + fan-out (`searchInventory`), dedupe/rank, `revalidateOffer`, `firstBookable` |
| `server/suppliers/types.ts` | The shared `Offer`/`Supplier` contract, plus the write-plane types (`Ticket`, `ReissueResult`, `BookResult`, idempotency keys) |
| `server/suppliers/duffel.ts` | Duffel Air — real search + revalidate |
| `server/suppliers/kiwi.ts` | Kiwi/Tequila — real search + revalidate, the only source with a real seat count |
| `server/suppliers/skyscanner.ts` | Skyscanner via RapidAPI — real search, no revalidate (breadth-only) |
| `server/suppliers/sabre.ts` | Sabre Dev Studio CERT — real auth + real endpoint, never seen real data |
| `server/suppliers/travelport.ts` | Routes to real OAG identities when available, else the synthetic generator |
| `server/suppliers/travelfusion.ts` | Registered seam, no client — always `no-key` |
| `server/suppliers/oagOffers.ts` | Wraps `server/oag.ts` schedules into `Offer` shape with a deterministic demo fare |
| `server/suppliers/mockFlights.ts` | Deterministic synthetic offer generator, shared PRNG (`hash`/`mulberry32`) |
| `server/suppliers/sandbox.ts` | The one write-capable adapter — synthetic inventory, real coupon/reissue/void logic |
| `server/oag.ts` | Real OAG Flight Info client (schedules), trial-budget ledger, fixture replay |
| **Hotels** | |
| `server/hotels/index.ts` | Registry + fan-out (`searchAccommodation`), dedupe/rank, `holdHotel`, `firstHoldable`, `affordabilityVeto` |
| `server/hotels/types.ts` | The shared `HotelOffer`/`HotelSupplier` contract |
| `server/hotels/providers.ts` | Duffel Stays (real), LiteAPI adapter (real), Makcorps (real, guard-only, not a `HotelSupplier`) |
| `server/hotels/tolerance.ts` | The Makcorps veto threshold, isolated for direct testing |
| `server/hotels/verify.ts` | Executable checks (`npm run verify:hotels`) for the veto threshold |
| `server/liteapi.ts` | The underlying LiteAPI HTTP client `providers.ts` wraps; also used directly by the legacy route |
| `server/mockHotels.ts` | Deterministic synthetic hotel generator, seeded from `mockData/hotelInventory.json` |
| **Ground** | |
| `server/ground/index.ts` | Uber sandbox client (OAuth2 client-credentials, price/time estimates, sandbox fault injection) + private-car fallback + `searchGround` waterfall |
| `server/mockCabs.ts` | Older, always-on deterministic cab generator seeded from `mockData/cabFleet.json` — no live cab supplier ever called |
| **FX** | |
| `server/fx.ts` | Frankfurter (ECB daily rates) client, committed fallback table, `convert`/`convertWith`/`currencyForCountry` |
| **Member data** | |
| `server/myca.ts` | MyCa (Amex card-member) profile fetch — real endpoint shape, no credentials held, mock fallback |
| **LLM** | |
| `server/gemini.ts` | Gemini `generateContent` REST client — `explain()` (free text) and `extractJson()` (schema-constrained) |
| **Routes exercising the above** | |
| `app/api/search/flights/route.ts` | Public, unauthenticated OAG schedule search (rate-limited) |
| `app/api/search/hotels/route.ts` | Public, unauthenticated accommodation search via `searchAccommodation` (rate-limited) |
| `app/api/hotels/route.ts` | Legacy hotel route: LiteAPI direct, falling back to `mockHotels.ts` |
| `app/api/explain/route.ts` | Public, rate-limited Gemini explanation endpoint |

## The supplier registry pattern

`server/suppliers/index.ts` holds a flat array, `SUPPLIERS: Supplier[]`, populated at module load: `duffel, kiwi, skyscanner, sabre, travelport, travelfusion`, plus `sandbox` only when `ZKD_SANDBOX=1`. `searchInventory(params)` runs `Promise.allSettled` across all of them concurrently — a rejected promise is recorded as `sources[id] = 'error'`, a resolved one contributes its offers and its own reported status. There is no fixed "primary" vendor in code: registration order is not significance order, and a source with no configured key returns `{ offers: [], status: 'no-key' }` rather than being skipped from the array, so the per-source status is always visible to the UI. Results are deduped by `flightCode` + minute-truncated departure time — preferring a `live` offer over a synthetic one, then one with a known `expiresAt` over none, then the cheaper — and then sorted by departure time and price.

Every provider implements the same two-method contract from `types.ts`:
```
search(params): Promise<{ offers: Offer[]; status: SupplierStatus }>
revalidate(offer): Promise<RevalidationResult>   // available | price-changed | gone | unknown
```
`Offer` is the normalised shape every adapter must produce, carrying `expiresAt` (drives the member's consent window in `lib/confirmWindow.ts`), `currency` (never assumed INR), and the optional `carriers`/`fareRules`/`supplierType` triple the policy gate requires before a candidate can be considered for reissue at all — an offer missing them is default-denied, never approved on a guess. `sandbox` additionally implements `WriteVerbs` (`reissue`, `bookReplacement`, `voidTicket`, `claimCreditOnCancelled`), gated by `isWriteCapable()`; it is the only adapter with a write plane, so the reissue/rollback logic in `server/pipeline/saga.ts` exercises this one exclusively. `server/hotels/index.ts` and `server/ground/index.ts` mirror this exact shape for their own two- and three-supplier registries respectively — same dedupe-then-rank pattern, same per-source status reporting, same "a source we cannot re-check is a source we cannot promise" rule for `revalidate`/`hold`.

## Per-supplier status (be exhaustive and specific)

| Supplier | Domain | Real or mock, precisely | Evidence | Known limit |
|---|---|---|---|---|
| **Duffel** | Flights | **Real** — search + revalidate, test-mode sandbox | `DUFFEL_ACCESS_TOKEN` env var; POSTs to `https://api.duffel.com/air/offer_requests`; `Duffel-Version: v2` header; real `expires_at` on every offer | Test-mode sandbox reliably returns offers only for Duffel's own dummy routes (e.g. LHR↔JFK) — real Indian domestic routes come back empty (`empty`, not `error`). Shares its account-level rate ledger with Duffel Stays |
| **OAG** (Flight Info, feeding `travelport`'s live path) | Flights (schedules only) | **Real** — verified live 200 against the trial key on 2026-08-17, per `server/oag.ts`'s own changelog | `Subscription-Key` header, `https://api.oag.com/flight-instances/?version=v2`; dual-key primary/secondary rotation; committed fixtures under `server/oag-fixtures/` from a real recorded response | Hard-capped at **100 calls total per rolling 14-day window** — tracked in `server/.state/oag-trial-usage.json`, hard-stops rather than degrading to a guess. Returns schedules only (real carrier/flight/times/terminals), never a fare or seat count — `oagOffers.ts` attaches a deterministic demo fare on top |
| **Kiwi (Tequila)** | Flights | **Real** — search + revalidate, live partner sandbox once approved | `TEQUILA_API_KEY` env var; `https://api.tequila.kiwi.com/v2/search` and `/v2/booking/check_flights`; the only source with a genuine per-offer `availability.seats` | Partner approval not guaranteed — `no-key` is the expected default state. No price-hold instant (`expiresAt: null`, honestly) |
| **Skyscanner** | Flights | **Real search, deliberately no execution path** | `RAPIDAPI_KEY`, configurable host/path env vars; real RapidAPI mirror endpoint | No booking path, no PNR, no price hold, no seat count in the underlying data (`seatsRemaining: 0` by design). `revalidate()` unconditionally returns `unknown`. Tightest flight budget held: 500 calls/month |
| **Sabre** | Flights | **Real auth, real endpoint, never returned real data** | `SABRE_CLIENT_ID`/`SABRE_CLIENT_SECRET`; confirmed-working double-base64 Basic auth against `https://api.cert.sabre.com/v2/auth/token`; InstaFlights shop call authenticates fine | Every route/date tried against CERT has returned "No results were found" — the parser has never seen a populated response. `revalidate` falls back to a fresh search (no re-fetchable offer handle exists), returning `unknown` if nothing comes back |
| **Travelport** | Flights | **Not integrated — synthetic by construction, with a real-data override** | No credentials anywhere; `search()` tries `oagOffers()` first (real OAG identities when a fixture/live call has data) and falls back to `generateFlightOffers()` (fully synthetic, from real route geometry + `mockData/airlines.json`) | Every offer this path can return carries `live: false` unless the OAG substrate produced it, and even then the fare is a deterministic demo number, not a real quote. `revalidate()` always returns `unknown` |
| **TravelFusion** | Flights | **Mock — a registered seam, not an implementation** | No client exists; `search()` returns `{ offers: [], status: 'no-key' }` unconditionally, "not gated on an env var: even with credentials present there is no client behind this" | Needs a commercial demo agreement and XML-over-HTTP two-phase calls (`Login`→`StartRouting`→`CheckRouting`) that were never built — the file documents a full wiring checklist for whoever gets credentials |
| **LiteAPI** | Hotels | **Real, live-called, sandbox inventory, no card required** | `LITEAPI_API_KEY`; real two-call flow against `https://api.liteapi.travel/v3.0/data/hotels` then `/v3.0/hotels/rates`; used both by `server/liteapi.ts` directly and wrapped as a `HotelSupplier` in `providers.ts` | No `hold`/prebook wired in the `HotelSupplier` adapter (the underlying `HotelOpt` return type carries no rate handle), so `revalidate()` always returns `unknown` and it cannot be committed against from the new registry path |
| **Legacy `/api/hotels` route** | Hotels | **Confirmed: calls the real LiteAPI client first, falls back to seeded mock inventory** | `app/api/hotels/route.ts` calls `searchHotels()` (the real `server/liteapi.ts` client) and only calls `generateMockHotels()` when LiteAPI returns zero rows (no key or empty city) | The framing in the brief holds — this route is real-first, mock-fallback, not mock-only |
| **Duffel Stays** | Hotels | **Real** — search, revalidate (re-quote), and a genuine reversible `hold` | Same `DUFFEL_ACCESS_TOKEN`; `https://api.duffel.com/stays/search`, `/stays/quotes`; a `quote` is the reversible WAIT-gate hold, `book` is the only irreversible step | Shares Duffel's account-level ledger (`LEDGER_OF` in `governor.ts`) — Air and Stays calls draw from one quota |
| **Makcorps** | Hotels (guard only) | **Real, but deliberately not a portfolio source** | `MAKCORPS_API_KEY`; real call to `https://api.makcorps.com/free`; not exported into `SUPPLIERS` in `hotels/index.ts`, not a `HotelSupplier` at all | Prices arbitrary future dates with no occupancy control — can only *withhold* (veto a search as implausibly priced at >3× the member's cap), can never approve or price a real booking. 30 calls/month (~1/day) |
| **Uber (ground)** | Ground | **Real — sandbox, OAuth2 client-credentials, exercised cancel/rollback path** | `UBER_CLIENT_ID`/`UBER_CLIENT_SECRET`; real token fetch at `https://login.uber.com/oauth/v2/token`; `UBER_API_HOST` defaults to `sandbox-api.uber.com`; real `PUT /sandbox/products/{id}` fault-injection endpoint (`injectSandboxScenario`) refuses to run against anything but a sandbox host | No published free-tier cap — budgeted conservatively (`tps:1, daily:100`) in `governor.ts`. Returns no products on many Indian domestic routes, which is exactly why `privateCarSearch` fallback exists |
| **mockCabs.ts** (`server/mockCabs.ts`) | Ground | **Fully mocked, and NOT the same code path as the Uber-vs-privatecar fallback in `ground/index.ts`** | Deterministic FNV-hash generator seeded from `mockData/cabFleet.json`; header states plainly "no real cab supplier is wired anywhere in this app — UBER_API_KEY exists in .env.example but nothing calls it" | This file predates `server/ground/index.ts`'s real Uber client and its own header is stale — Uber *is* wired elsewhere in the codebase now. Confirm which of `mockCabs.ts` vs. `ground/index.ts`'s `privateCarSearch` a given call site actually reaches before citing this file as proof cabs are unimplemented (see Failure modes section) |
| **Frankfurter / `fx.ts`** | FX | **Real, keyless, ECB daily reference rates** | No API key needed; `https://api.frankfurter.app/latest`; 12h cache TTL | On any failure (network, non-200, malformed body) falls straight to `FALLBACK_RATES`, a small checked-in table of approximate rates marked `source: 'fallback'` — explicitly stale and expected to drift |
| **MyCa** | Member data | **Real endpoint shape, no credentials held anywhere** | `MYCA_API_KEY`; real-looking call to `https://api.myca.americanexpress.com/v1/members/{id}/travel-profile` | No key exists in this environment — every run returns `mockProfile()`, `source: 'mock'`. The mock is a single hardcoded member ("Priya S."); a per-member cap or preference set is not exercised |
| **Gemini** | LLM | **Real, live-called** | `GEMINI_API_KEY`; `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent` | Free-tier budget in `governor.ts` (`daily: 1500`) is documented but **not actually enforced by `gemini.ts` or `/api/explain`** — neither calls `withBudget`/`tryAcquire`; only the route's own per-IP `checkRateLimit` gates volume |

## How it works

### Search and booking

**Duffel flights.** `search()` in `duffel.ts` POSTs to `/air/offer_requests?return_offers=true` with one passenger object per party member (fixed from an earlier hardcoded single-adult bug), `cabin_class`, and the slice; a 10s `AbortSignal.timeout` guards the call. A non-OK response is recorded via `noteOutcome` (feeding the governor's backoff) and returns `{ offers: [], status: 'error' }`; a `no-key` short-circuit happens before any network call. `revalidate()` re-fetches `/air/offers/{id}` on the `confirm` lane (which can draw on the reserve `refresh` cannot touch) and classifies the result as `gone` (404/410 or expired), `price-changed`, or `available`. Failure anywhere — thrown exception, denied budget — degrades to `unknown`, never to `gone`, because `firstBookable()` in `suppliers/index.ts` treats `unknown` as "not confirmable, try the next candidate" rather than a hard rejection.

**LiteAPI / Duffel Stays hotels.** `searchAccommodation()` in `hotels/index.ts` fans out to both `duffelStays` and `liteapi` concurrently, same dedupe-then-rank shape as flights but keyed on a normalised property name + city (not a flight code), preferring live over indicative, then refundable, then cheaper. Duffel Stays offers a genuine two-phase flow — `quote` (the reversible hold `holdHotel()` takes at the WAIT gate) then `book` — because a rate ID survives from search through booking. LiteAPI's adapter in `providers.ts` wraps the older `server/liteapi.ts` client, which returns a `HotelOpt` with no rate handle, so `hold` is simply absent on that supplier and `revalidate()` always answers `unknown` — the honest signal that LiteAPI-sourced rooms in the new registry path cannot be committed against without further wiring. `affordabilityVeto()` only ever runs when *neither* live source answered, and can only stop a search, never approve one.

**Uber ground.** `uberSearch()` in `ground/index.ts` fetches a cached OAuth2 token (`uberToken()`, 25-minute TTL, `login.uber.com/oauth/v2/token`) then calls `/v1.2/estimates/price` and `/v1.2/estimates/time` in parallel via a shared `uberFetch()` wrapper that transparently retries once on a 401 by evicting the cached token — recovering from a token that was revoked or clock-skewed before its guessed TTL, rather than tripping the governor's backoff for what was actually a cache problem. Every ride quotes the *high* estimate (a single-use virtual card issued for the low end fails at the worst moment). `searchGround()` walks the member's `provider_hierarchy`, tries Uber first, and only falls through to the deterministic `privateCarSearch()` mock (`live: false`) when Uber returns nothing — which happens often on Indian domestic routes since Uber's sandbox has thin coverage there. `injectSandboxScenario()` drives Uber's own `PUT /sandbox/products/{id}` to force `drivers_available: false` or a surge multiplier, making the ground-step failure and rollback path testable on demand rather than by luck; it refuses to run unless `UBER_API_HOST` contains `"sandbox"`.

A ground-step failure never rolls back the flight or hotel — only they are trip-critical; a member with a seat and a bed but no cab is a recoverable inconvenience, so the saga records an orphan and reaches `CONFIRMED` anyway.

### Currency conversion

`server/fx.ts` calls Frankfurter (`api.frankfurter.app/latest`, ECB daily rates, no key) with a 6-second timeout and a 12-hour cache. On any failure it falls through to a small checked-in `FALLBACK_RATES` table (INR-pegged, explicitly documented as approximate and drifting) and marks the result `source: 'fallback'` rather than pretending it is live. This replaced an earlier behaviour, described in the file's own header, where `altsFromOffers.ts` refused to convert at all and marked any non-billing-currency fare `needsConversion: true` with a forced `ok:false` — which, now that the hard per-transaction spend ceiling has been removed, meant EUR-priced Duffel offers were silently dropped from the option list rather than shown with a conversion caveat. Every converted figure now carries `CONVERSION_NOTE` ("Converted at current market rates — the amount charged may vary slightly.") and the rate/timestamp travel with the decision record so a settled charge can be reconciled later. `convertWith()` exists specifically so a batch of forty offers is converted against one fetched rate rather than forty separate lookups that could each land on a different published rate mid-comparison.

### The LLM explanation call

`server/gemini.ts` exposes exactly two functions, both plain `fetch` calls against Gemini's REST `generateContent` endpoint (no SDK): `explain(prompt)` returns free text or `null`, `extractJson<T>(prompt, schema)` requests schema-constrained JSON (`responseMimeType: application/json`, `temperature: 0`) and parses it, also returning `null` on any failure. `/api/explain/route.ts` is the only caller of `explain()`, used for exactly two things — a one-sentence plain-language reason a flight has a given cancellation-risk percentage, and a one-sentence reason a given rebooking option was recommended — both capped at ~20-25 words, second person, built from a request body that is length-capped (80 chars/field) and control-character-stripped before interpolation into the prompt (prompt-injection hardening added 2026-08-21 alongside the route's rate limit). `extractJson()` has one other caller, `server/preferences/intent.ts`, which uses it to turn a member's free-text preference override into structured fields — but that file's own header is explicit that Gemini's output is never trusted as an authorization boundary: every field it returns is re-validated and clamped against caller-supplied bounds (cabin entitlement, route legality, deadlines) after the call returns, so "shape is the model's job; legality is ours." Neither call site gives Gemini any role in ranking, pricing, or booking decisions — it only ever produces text or advisory structured fields that are independently re-checked or purely explanatory.

Both functions return `null` on missing key, non-OK HTTP status, timeout (15s for `explain`, 20s for `extractJson`), or unparseable JSON, and every caller treats `null` as "the feature degrades," never as an error to surface. `/api/explain`'s response type (`ExplainResponse = { text: string | null }`) makes the null case a first-class, typed outcome the client is expected to handle (e.g. showing no explanation, or a static line) rather than a template string generated server-side — there is no server-side canned-text fallback in `gemini.ts` or the route itself; any substitute copy shown on a `null` response lives client-side.

## Interfaces

### Inbound — who calls this, and how

| Caller | What it triggers |
|---|---|
| `server/pipeline/compose.ts`, `server/engine/altsCache.ts`, `server/engine/forecast.ts` | `searchInventory()` — the recurring/adaptive refresh that keeps `Flight.candidates.alts` warm |
| `server/pipeline/saga.ts`, `server/pipeline/ranker/bookability.ts` (indirectly, via learned priors) | `revalidateOffer()` / `firstBookable()` — the moment-of-spend re-check before ticketing; `bookability.ts` folds historical outcomes of these calls into the ranker's `P(bookable)` term rather than calling suppliers itself |
| `server/pipeline/index.ts`, `server/hotels/index.ts` internals | `searchAccommodation()`, `holdHotel()`, `firstHoldable()`, `affordabilityVeto()` — hotel search, the reversible WAIT-gate hold, and the Makcorps guard |
| `server/pipeline/index.ts` | `searchGround()`, `toCabOpt()`, `withinGroundCap()` — ground search and the member's ground-budget filter |
| `app/api/search/flights/route.ts` | `flightInstancesByRoute()` — public, unauthenticated OAG schedule browse |
| `app/api/search/hotels/route.ts` | `searchAccommodation()` — public, unauthenticated hotel browse, plus FX conversion to billing currency |
| `app/api/hotels/route.ts` | `searchHotels()` (LiteAPI) then `generateMockHotels()` fallback — the legacy hotel path |
| `app/api/explain/route.ts` | `explain()` — plain-language risk/recommendation copy |
| `server/preferences/intent.ts` | `extractJson()` — free-text preference override parsing, always re-validated after |
| `server/domain/pricing.ts`, `app/api/search/hotels/route.ts` | `convert()`/`convertWith()`/`currencyForCountry()` — FX for display and cross-currency comparison |
| `server/engine/simulation.ts`, ranking/policy code throughout | `fetchProfile()` (MyCa) — cabin entitlement, preferred carriers, payment instrument, billing currency |

### Outbound — what this calls, and why

| External API | Why |
|---|---|
| `api.duffel.com` (Air + Stays) | Real flight and hotel search, revalidation, quoting, and booking — the primary bookable inventory source |
| `api.tequila.kiwi.com` | Real flight search with a genuine seat count, and pre-booking confirmation |
| RapidAPI Skyscanner mirror | Market-breadth flight search only, no booking |
| `api.cert.sabre.com` | GDS flight search (auth verified working, data never populated in CERT) |
| `api.oag.com` | Real flight schedules (carrier, times, terminals) under a hard 100-call/14-day trial budget |
| `api.liteapi.travel` | Real sandbox hotel search |
| `api.makcorps.com` | Coarse city-level hotel price band, guard-only |
| `login.uber.com` / `sandbox-api.uber.com` | OAuth2 token issuance and sandboxed ride price/time estimates + fault injection |
| `api.frankfurter.app` | Daily ECB currency reference rates |
| `api.myca.americanexpress.com` | Card-member travel profile (unreachable in this environment — no key) |
| `generativelanguage.googleapis.com` | Gemini text generation for explanations and preference extraction |

## State it owns

- **OAG trial-call ledger** (`server/oag.ts`): a JSON file at `server/.state/oag-trial-usage.json` (gitignored, process-crash-surviving) tracking `{ firstCallAt, callsUsed }` against the 100-call/14-day cap; checked *before* spending and only charged when a trial-tier key is the one actually used (production-tier keys, if ever approved, would not count against it).
- **OAG fixture cache** (`server/oag-fixtures/`): committed (not gitignored) raw JSON responses per route+date, replayed under `OAG_REPLAY=1` so rehearsal never touches the live budget.
- **The governor ledgers** (`server/governor.ts`): one in-memory, process-lifetime `Ledger` per provider (token-bucket for burst, day/month counters, exponential-backoff cooldown), covering every flight, hotel, and ground supplier plus `aviationstack`, `lumo`, and `gemini` — though `gemini` calls in `server/gemini.ts` do not actually route through `withBudget`/`tryAcquire`, so this ledger entry is currently descriptive/dashboard-only rather than enforced. `LEDGER_OF` redirects `duffel-stays` onto the shared `duffel` ledger since both spend one account's token.
- **`getOrSet` caches** (`server/cache.ts`, used throughout): FX rates (12h TTL), the Sabre and Uber OAuth tokens (6-day and 25-minute TTL respectively), OAG route lookups (6h TTL), OAG airport master data (7 days).
- **The sandbox's ticket ledger** (`server/suppliers/sandbox.ts`): an in-memory `Map` of issued `Ticket`s and a replay cache of write results keyed by idempotency key — the only mutable inventory state in the whole component, and even it is scoped to bookings we made, never to the (stateless, hash-derived) market inventory itself.

## Real vs. simulated vs. mocked

**Genuinely real and live-callable today, given credentials:** Duffel (flights and Stays — search, revalidate, hold, and the only fully modelled booking path outside the sandbox), Kiwi, Skyscanner (search-only), Sabre (auth only — data path unproven), LiteAPI, Makcorps, Uber (including its sandbox fault-injection endpoint), Frankfurter, Gemini, and OAG (schedules only, hard-budgeted). MyCa is real in shape but has no credentials in this environment and always serves its mock.

**Real geometry/reference data wrapped in a synthetic fare:** `travelport`'s OAG-backed path (`oagOffers.ts`) — real carrier, flight number, and scheduled times, but a fare and seat count generated deterministically per flight, never a real quote.

**Fully synthetic, and honestly labelled `live: false` everywhere it surfaces:** `travelport`'s fallback generator (`mockFlights.ts`), the sandbox's own inventory (stateless, hash-derived — this is deliberate design for the write-plane demo, not an oversight), `mockHotels.ts`, `mockCabs.ts`, and `privateCarSearch()` in `ground/index.ts`.

**A registered no-op:** TravelFusion — not gated on missing credentials, because there is no client behind it regardless of whether a key is configured.

The one claim in the original brief that does **not** hold cleanly: `mockCabs.ts`'s own file header says "no real cab supplier is wired anywhere in this app," which was true before `server/ground/index.ts`'s Uber client existed but is stale now — Uber *is* real and live-called for ground transport. The two ground modules are not one fallback chain with Uber primary and `mockCabs.ts` secondary; they appear to be two independently-seeded synthetic generators (`mockCabs.ts` and `ground/index.ts`'s internal `privateCarSearch`) serving different call sites, with `ground/index.ts` being the one that actually tries Uber first. A reviewer should treat `mockCabs.ts`'s comment as documentation debt, not as evidence Uber is unused.

The legacy `/api/hotels` route framing in the brief is accurate: it calls the real LiteAPI client first and only falls back to `generateMockHotels()` when LiteAPI has no key or returns nothing for the city.

## Failure modes & concurrency

**Timeouts.** Every external call read in this component now carries an explicit `AbortSignal.timeout(...)`, confirming the five previously-uncovered sites are fixed: Kiwi search (`kiwi.ts:133`) and revalidate/`check_flights` (`kiwi.ts:175`), Skyscanner search (`skyscanner.ts:123`), Uber's OAuth token fetch (`ground/index.ts:85`) and every authenticated Uber request via `uberFetch`'s own default (`ground/index.ts:120`, `init.signal ?? AbortSignal.timeout(10000)`), Makcorps (`providers.ts:325`), and all three Duffel Stays hotel calls — search (`providers.ts:119`), revalidate/quote (`providers.ts:152`), and hold/quote (`providers.ts:194`). Every other live call surveyed (Duffel flights, Sabre token + shop, OAG, LiteAPI, Frankfurter, MyCa, Gemini) also carries a timeout, ranging from 6s (FX) to 20s (Gemini's `extractJson`).

**Silent fallback.** Every `search()`/`revalidate()` implementation catches its own exceptions and returns a typed status rather than throwing — `searchInventory`/`searchAccommodation` additionally wrap each supplier call in `Promise.allSettled` so one throwing adapter cannot take down the fan-out. No supplier name is constructed into member-facing UI copy in any of the files read for this component: offers carry a `supplier` field used for dedupe preference and ranking, and `toHotelOpt()`/`toCabOpt()` build a `why` string that says things like "Bookable rate from duffel-stays" or "generated inventory, not a bookable seat" — these do name the vendor internally in a couple of hotel `why` strings, but the failure states themselves (`no-key`, `error`, `rate-limited`) are reported as per-source status codes to `/api/pipeline/health`-style surfaces, not spelled out to the member as "Duffel is down."

**What the member actually sees on an outage.** A flight/hotel/ground search that loses every live source does not go empty — it falls through to the deterministic synthetic generator for that domain (`mockFlights.ts`, `mockHotels.ts`, `privateCarSearch`), each clearly marked `live: false` and carrying an honest `why`/label. A currency-rate outage falls to the committed `FALLBACK_RATES` table rather than hiding the offer. An LLM outage means no explanation sentence is shown (`text: null`), never a broken request. The one place a failure is surfaced as an explicit, non-vendor-specific error to an anonymous caller is `/api/search/flights`, which distinguishes "OAG trial allowance exhausted" (503) and "route not recorded for replay" (503) from a generic "Flight search is temporarily unavailable" (502) — deliberately not echoing OAG's raw error text or file paths, per that route's own 2026-08-21 fix.

**Rate governance gap.** `server/governor.ts` defines a budget entry for `gemini` (1500/day, `tps: 1`), but neither `server/gemini.ts` nor `/api/explain/route.ts` calls `withBudget`/`tryAcquire` — the only volume control on that path is the route's own per-IP `checkRateLimit`. This is a real gap between the documented governor coverage and what is actually enforced for the LLM path specifically (flights, hotels, and ground suppliers are all correctly wired through `withBudget`).

## Tests

- `zkd-app/server/fx.test.ts` — unit tests for `currencyForCountry` and `convertWith` (rounding, case-insensitivity, unmapped-country default). No test exercises the live Frankfurter call or the fallback-on-failure path directly.
- `zkd-app/server/hotels/verify.ts` — an executable script (`npm run verify:hotels`), not a `vitest`/`node:test` file, checking `marketExceedsTolerance`'s boundary behaviour (at-cap, 2x, exactly 3x, 3x+1, currency mismatch never vetoes).
- `zkd-app/tests/sandbox.test.ts` — the most thorough supplier-adjacent test file: determinism of seeded inventory, monotonic seat decay, scarcity effects, duplicate-coupon refusal, reissue/void/idempotency behaviour, and revalidate-as-gone paths, all against `server/suppliers/sandbox.ts`.
- `zkd-app/server/oag.test.ts`, `oag.record.test.ts`, `oag.live.test.ts` — OAG-specific coverage (parsing, fixture record/replay, and a live-tagged suite), not opened in full for this document but present and named for that purpose.
- `zkd-app/server/preferences/intent.test.ts` — exercises the `extractJson` consumer's validation/clamping logic (the enforcement boundary around Gemini's output), not `gemini.ts` itself.
- **Real gap:** no test file was found for `duffel.ts`, `kiwi.ts`, `skyscanner.ts`, `sabre.ts`, `travelport.ts`, `travelfusion.ts`, `providers.ts` (Duffel Stays/LiteAPI/Makcorps), `ground/index.ts` (Uber), `mockCabs.ts`, `mockHotels.ts`, `myca.ts`, or `gemini.ts` directly — coverage of the live HTTP adapters themselves (request shape, header construction, response parsing, timeout behaviour) rests entirely on the sandbox's synthetic-inventory tests and the two guard-threshold test files above. The dedupe/rank/fan-out logic in `suppliers/index.ts` and `hotels/index.ts` is also not directly unit-tested in the files enumerated here.

## See also
- [05-orchestration-and-execution.md](05-orchestration-and-execution.md)
- [04-ranking-engine.md](04-ranking-engine.md)
- [02-prediction-and-risk-model.md](02-prediction-and-risk-model.md)
