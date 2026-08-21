# ZKD Gap Audit — Session Report

**Date:** 2026-08-19 · **Branch audited:** `main` at `8f1db4b` · **Scope:** read-only audit, no
source files modified.

This session took a standing written audit of ZKD Concierge and checked it, claim by claim,
against the code on `main`. The result is not a summary of that audit — it is a correction of it.
Six of its conclusions had drifted from the code, one was confirmed as a genuine safety defect,
and the international capability turned out to be substantially further along than anyone had
written down.

Companion documents: the full remaining-work tables live in the approved session plan; the
per-question document map is [`CLAUDE.md`](CLAUDE.md); house rules are [`AGENTS.md`](AGENTS.md).

---

## 1. What was checked, and how

Every claim below is traced to a file and a line, not to a document. Documents in this repo have
proven able to describe a system that has since changed underneath them — §2 records six such
cases — so the code was treated as the only authority.

Verification run in `zkd-app/`:

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx vitest run` | **199 passed, 5 skipped** — 24 files passed, 3 skipped |
| Canon `A2` block hashes across the four agent specs | unchanged, `6294649430f22e26` |
| `iropssim.py` vs `iropssim-output.json` | unchanged (fixed seed) |

The audit's claim that the verification suites pass is therefore correct and reproducible.

One process note worth keeping: this repo has many concurrent unmerged worktrees, and the
worktree this report was written in initially branched from `origin/main`, two commits behind
local `main`. One of those two commits was the refund commit cited in §2. The branch was rebased
onto `8f1db4b` before anything was written, and the citations re-verified there. **"This exists"
is only meaningful against a named branch in this repo.**

---

## 2. Six corrections to the standing audit and checklist

These matter more than the gap list. A checklist that *overstates* a safety control is worse than
one that understates a feature, and row 9 below does exactly that.

| # | What was claimed | What the code says | Evidence |
|---|---|---|---|
| C1 | Foreign-currency offers are dropped by `needsConversion` (audit; `ZKD-Feature-Checklist.xlsx` row 16 marks this *Covered*) | **Reversed for flights.** `server/fx.ts` converts using a live daily reference rate with a committed `FALLBACK_RATES` table, attaches `CONVERSION_NOTE` to every converted figure, and records the rate and the moment it was read with the decision. `needsConversion` now survives only in explanatory comments. | `server/fx.ts:1–60`; `server/domain/altsFromOffers.ts:31,80` |
| C2 | LiteAPI hotel search is orphaned; `/api/hotels` uses seeded inventory instead | **Wired.** `liteapi` is a registered `HotelSupplier` alongside Duffel Stays, and `searchAccommodation()` is called by the live recovery pipeline. Only the *legacy* `/api/hotels` route still uses the mock generator. | `server/hotels/index.ts:31,40`; `server/pipeline/index.ts:35,282` |
| C3 | Ground transfers are a mock cab fleet (checklist row 11: "no real ground-transfer supplier") | **Wrong now.** `server/ground/index.ts` is a real Uber sandbox integration with OAuth2 client-credentials and an exercised cancellation/rollback path. `server/mockCabs.ts` is the *fallback*, not the implementation. | `server/ground/index.ts:1–40` |
| C4 | **Checklist row 9:** a ₹25,000 per-transaction cap is enforced before anything is charged | **The spend ceiling was removed on 2026-08-19.** The file says so in its own words: *"Removed on 2026-08-19. It was the last hard stop on an unattended recovery."* `outOfPocketCap` survives only as an input to the hotel affordability veto and the ground cap. **Nothing blocks spend on amount any more.** | `server/myca.ts:27–32`; `server/pipeline/index.ts:100,317` |
| C5 | **Checklist row 15:** there is no original-ticket refund path | **Partly built.** `server/domain/refund.ts` + `estimateRefund` compute the refund, and the member is shown a *delta* rather than the gross fare — the code's reasoning being that "announcing ₹18,000 when ₹14,000 of it is coming straight back would be true and misleading". The actual void is still synthetic (`void:{pnr}`). | `server/engine/simulation.ts:33,363–374`; `server/pipeline/saga.ts:300` |
| C6 | `design/02-data-sources-and-apis.md` §1: "There is no poller, cron, webhook or worker anywhere in `zkd-app/server/`" | **Stale.** Three detection lanes now exist: `server/webhooks/` (push, with three adapters — `duffel`, `aerodatabox`, `oag`), `server/engine/statusPoller.ts` (poll), and `server/engine/memberReports.ts` (the member). | `server/webhooks/index.ts:49–53` |

**Follow-up required:** regenerate `ZKD-Feature-Checklist.xlsx` rows 9, 11, 15 and 16, and fix §1
of `02-data-sources-and-apis.md`, before either is shown to judges.

---

## 3. The one confirmed safety defect

The audit flagged notification-channel reliability as a safety concern. That is confirmed, and it
is the most serious finding in this session.

`dispatch()` computes whether any channel actually delivered:

```ts
const delivered = results.some((r) => r.ok);   // server/notify/index.ts:50
```

It logs the result to the decision ledger and emits a `console.warn` when nothing got through.
**Nothing in the consent path reads it.** There is no consumer of `delivered` anywhere in
`server/engine/simulation.ts`.

Under the notify-then-proceed policy, silence proceeds to book. So a member whose WhatsApp and
push both failed is indistinguishable, to the system, from a member who read the message and
chose not to object — and is charged without ever having seen the stop window.

**Why this is now worse than when the policy was written.** The ₹25,000 per-transaction cap that
used to backstop an unattended recovery was removed on 2026-08-19 (C4). The notification ladder
was what replaced it. That makes delivery the *only* remaining control on an unattended spend,
and delivery is currently unchecked.

This is the money-flow invariant in `design/03-action-policy.md` §10 failing in practice, not in
principle.

**Fix:** feed `DispatchResult.delivered` into `simulation.ts`. On a fully-undelivered notify, do
not let the window expire into "proceed" — extend and retry the ladder, or halt into the `/ops`
queue as an un-notified member — and log which branch was taken. The test belongs in
`server/notify/dispatch.test.ts` or a new simulation test: force both channels to fail, assert the
run does **not** reach a spend state.

---

## 4. The international finding

The project has been framed as Indian domestic aviation with international as a future ambition.
The code does not agree. Most of the hard part is already built:

- **The jurisdiction engine covers five regimes** — `IN-DGCA`, `EU261`, `UK261`, `US-DOT`, and a
  `CARD-TERMS` fallback — with the attachment rules correct: EU261/UK261 attach to *departures*
  from the EU/UK on any carrier, and to *arrivals* only on an EU/UK carrier. UK261 is kept
  separate from EU261 rather than folded in, because the money differs.
  `server/airportDirectory.ts:49–110`; `lib/entitlement.ts:85`.
- **The airport table is worldwide** — 6,072 airports with country and timezone, not an Indian
  subset (`zkd-app/server/airports.json`).
- **The risk model is already trained on international data** — real US DOT/BTS and Brazil ANAC
  on-time files, column-verified against actual releases on 2026-08-14 and normalised into one
  shared schema, plus India synthetic. **7.9 M rows** (5.53 M train / 1.18 M calib / 1.18 M test),
  **ROC-AUC 0.804**, **Brier 0.0097**. `zkd-risk-model/reports/model_metrics.json`;
  `src/ingest_bts.py`; `src/ingest_anac.py`.
- Refund and entitlement already branch on `jurisdictionFor()` and `isInternational()`
  (`server/domain/refund.ts:40,145`).

**What actually blocks an international demo — four things, all small:**

| # | Blocker | Where | Fix |
|---|---|---|---|
| I1 | Billing currency hardcoded `INR`; hotel search hardcodes `guestNationality: 'IN'` and `currency: 'INR'` | `server/myca.ts:61,142`; `app/api/search/hotels/route.ts:71` | Read both from the member profile. Hotel FX (§5, R6) is the prerequisite. |
| I2 | Seed fixtures are Delhi-only (Andaz Aerocity, Roseate House, Leela Palace, ₹ rates) | `server/domain/seed.ts:164–170` | Seed P1's MAA→DEL→**LHR** — it is already the canonical persona. Highest demo value per hour spent. |
| I3 | `US-DOT` and `CARD-TERMS` bundles exist but no persona exercises them | `lib/entitlement.ts:85` | Fold into the persona test (§6). |
| I4 | The model has no *real* India data — synthetic only, while BTS/ANAC are real | `zkd-risk-model/data/synthetic` | Frame it honestly: the model generalises from 7.9 M real international rows; India is synthetic until a DGCA/AAI feed exists. Say it rather than let it be found. |

**The claim this supports:** ZKD is not an India-domestic tool with international bolted on. It is
jurisdiction-aware by construction and trained on international data, and India is the *launch
market*. That is a stronger story than the current framing, and it is true today.

---

## 5. Cancellation trigger — named providers and costs

The honest framing is that **capability is not the constraint, budget is.** OAG's Flight Instances
v2 already returns a live status whose values include `"Cancelled"` alongside a `scheduleChanged`
flag, and `server/oag.ts` already models both. The trial key is simply capped at 100 calls per
14 days *in total*, which does not cover one day of watching one route.

| Provider | How it triggers | Latency | Cost | Status in our code |
|---|---|---|---|---|
| **AeroDataBox Flight Alert PUSH** — *recommended* | Webhook, subscribed **per flight number** (`POST /subscriptions/webhook/FlightByNumber/{number}`). Pushes a `changed` diff; the adapter forwards only status/schedule changes and normalises gate/belt noise to `[]`. | Seconds | Credit-based: **1 credit per flight item, charged when SENT, not when delivered** | **Adapter implemented** — `server/webhooks/aerodatabox.ts` |
| Cirium (FlightStats) | Push webhook; the industry reference — schedules, status, cancellations, tail linkage | Seconds | Enterprise, quote-only | `identified` |
| FlightAware AeroAPI | Push alerts | ~seconds | ~$0.002–0.02 per query, tiered | `identified` |
| OAG Flight Instances v2 | Poll; status includes `Cancelled` plus `scheduleChanged` | Poll | Trial: 100 calls / 14 days **total**; paid tier quote-only | `wired` (search only) + webhook adapter |
| AviationStack | Poll | ~1 min | Free 100/mo; ~$50/mo for 10k | `wired` — current fallback poller |
| Lumo Subscription API | Push on schedule change / cancellation | Push | Commercial | `sandbox` (mocked) |
| Airline NDC direct | Authoritative the moment the cancellation is filed | Push | Commercial, per carrier | `commercial` |
| Duffel order webhooks | Push, but only for orders **we** booked — and this app books none | Seconds | Included | Implemented, practically inert |

**Why AeroDataBox is the one to name.** It is the only push option that is (a) already implemented
here, (b) able to watch a ticket bought *anywhere* rather than only one we sold, and (c) priced
per event in a way you can put a number against. Pair it with the AviationStack poll sweep as
reconciliation — a change feed cannot recover a *dropped* message, and a missed cancellation is
indistinguishable from a healthy trip, so it fails silently.

> **Before any slide is printed:** pull the current AeroDataBox credit price and tier from the
> vendor's own pricing page and compute cost per member per trip (credits × flights watched ×
> events). This session deliberately did **not** invent a rupee figure — the code documents the
> credit *model*, not the rate.

Related: push detection is off by default. With `WEBHOOK_PUBLIC_URL` unset nothing is registered
and detection falls back to poll plus member reports. The code states this loudly rather than
pretending otherwise (`server/webhooks/subscriptions.ts:57,99`).

---

## 6. Personas, and the test that is missing

The canonical set is **five personas, P1–P5**, identical across all four agent specs in
`documentation/agent-specs/current/` §A7. They differ **precisely on the payer axis** — that is
why they are the test set. The specs say plainly: *do not invent others.*

| Persona | Scenario | Payer outcome | Why it exists |
|---|---|---|---|
| **P1 · PRIYA** | MAA→DEL→LHR, AI2803 cancelled 06:12, 7 h delay, **overnight**, mode `zeroCharge` | `airline_owed` — room **claimed, not charged** | All three conditions hold: involuntary, ≥6 h, overnight. Failure branch: zero inventory at the star floor returns `proposals: []` with `infeasibility_reason` — the floor is **hard**, and the agent does not silently drop a star to fill the set. |
| **P2 · ARJUN** | BOM→DEL→SIN, 6E-5192 delayed 4 h, misses connection, not overnight, original **did operate** | `member_paid` room, `airline_owed` meals | Over the 2 h meals threshold, under the 6 h hotel threshold. Because the original operated, the change is **voluntary** for fare purposes. |
| **P3 · FATIMA** | CCU→DEL→DXB, 6E-6402 cancelled 05:50, 5 h delay, not overnight, mode `wallet` | `member_paid` — **despite an involuntary cancellation** | **The instructive row.** Involuntary makes the *re-route* free, not the lodging. Must return `entitlement_source: "member_paid"` beside `disposition: "involuntary"` and `threshold_met: false`, so no downstream reader can collapse the two. A wrong `airline_owed` here shows a ₹0 plan, fails to reserve against the VAN, and breaks the payment path — not merely the accounting. |
| **P4 · ROHIT** | The Outcome C case | Airline owes everything | Full duty of care end to end. |
| **P5 · TAKE THE WHEEL** | Member rejects the proposed hotel | — | Human override mid-flow: the clock is **held** while they decide. `server/engine/simulation.ts:533` |

Published at `zkd-website/personas/`, built from `Code/apps/personas/src/Personas.jsx` — a real
populated page (213 KB bundle), not a stub.

**The gap:** P1–P5 are exercised in prose and nowhere else. The specs instruct a reviewer to "walk
all five §A7 personas through the table", but no test does. **This is the single highest-value
test the repo is missing**, because P3 is exactly the case a lazy `disruption ⇒ airline pays`
default gets wrong, and getting it wrong breaks the payment path rather than producing a visible
error.

Separately, the 20 real-life member scenarios in `ZKD-Feature-Checklist.xlsx` are a broader set.
The 11 covered / 6 partial / 3–4 out-of-scope split is broadly right, but four rows are stale —
see §2. The genuinely out-of-scope cases (denied boarding, mid-air diversion, baggage loss,
medical emergency) need carrier DCS feeds nobody has; they should be stated as a boundary in
`SUBMISSION.md` so they read as a decision rather than an omission.

---

## 7. Scope changes taken this session

| Change | Consequence |
|---|---|
| Android is owned elsewhere | All Android-app gaps dropped from the work list. |
| **Expo dropped; Flutter is the client** | `zkd-flutter/` exists with five screens (login, flights, flight_detail, recovery, profile) but is **entirely untracked**, while `zkd-android/` is left modified. Also: the server's push limb is still Expo (`EXPO_ACCESS_TOKEN`, `server/notify/push.ts:110`), which no longer matches the client — so push must move to FCM or WhatsApp must be accepted as the single channel. Combined with the Twilio trial session expiring after 24 h idle, that risks a demo where *no* channel delivers, which is precisely the §3 path. |
| Theme is light | The Amex light skin is class-scoped under `.amex-page` and switched per route by `lib/amexRoutes.ts`. `:root` in `globals.css` is the *dark* default, so a token search reports the wrong answer — a session already made that mistake on 2026-08-19. No code change needed; just do not "fix" a colour by grepping `:root`. |
| Research widened to international | See §4. |

---

## 8. What was deliberately not done

- **No source files were modified.** This was an audit; every finding is a citation, not a patch.
- **No pricing was invented.** The AeroDataBox rupee figure is left as a lookup (§5) because the
  code documents the credit model and not the rate.
- **The removed spend cap was not reverted.** Its removal was a deliberate design decision with a
  stated rationale — a stranded member being shown the only seat home greyed out. The correct
  response is to make the ladder that replaced it actually work (§3), not to undo the decision.
- **Out-of-scope scenarios were not designed around.** They need feeds that do not exist.

---

## 9. Recommended order

1. **§3 — the undelivered-notification defect.** The only place a real member loses money
   silently, and the removed cap makes it worse. Correctness, not capability.
2. **§2 — the checklist and doc corrections.** About an hour, and it stops the deck claiming a
   safety cap that no longer exists.
3. **Hotel FX → I1 → I2.** Hotel FX unlocks international; the LHR seed makes it demoable.
4. **Flutter tracking and the push channel** (§7) — cheap, and it is what breaks on stage.
5. **The P1–P5 payer test** (§6).
6. **The AeroDataBox pricing lookup** (§5), before the deck is printed.

---

*No source modified. All findings verified against `main` at `8f1db4b` on 2026-08-19, with
`typecheck` clean and 199 tests passing.*
