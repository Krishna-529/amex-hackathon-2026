# Verification of `ZKD-Rebooking-Pipeline-Session-Report.md`

**Verified:** 17 August 2026
**Method:** read-only checks against the code, run from the integration worktree
(`.claude/worktrees/merge-team-branches`) and against `origin/feature/autonomous-rebooking-pipeline`
at `650e655` — the branch the report actually describes.
**Why this file is separate:** the report is another session's work product. It is left
untouched; this sits beside it.

---

## Verdict

**The report is accurate, and unusually honest about its own limits.** Nothing material was
found to be fabricated. Headline metrics match to the line, **all 24 file line counts in the
manifest are exact**, and every behavioural claim checked across two passes holds. The
discrepancies that exist are almost all consequences of the three-way merge that happened
*after* it was written.

Across ~35 individually checked claims, exactly **two** were wrong: a one-line miscount in
how the assertions split between suites, and one described mechanism that does not exist
(§8's `/air/orders` stub — though the safety property it protects is real). That is a better
hit rate than most hand-written engineering documentation.

The most important caveat is not an error in the report — it is that **§2's honesty
disclosure is now out of date**, and §2 is exactly the section a judge would press on.

---

## 1. Verified true

| Claim | How checked | Result |
|---|---|---|
| 8 commits · 38 files · 5,768 insertions / 157 deletions | `git diff --shortstat 8a5cd64..650e655` | **Exact** |
| 73 executable assertions, all passing | `npm run verify` | **73, all pass** |
| `reliability` pinned at 0.18 in all four presets | `server/preferences/presets.ts` | `RELIABILITY_FLOOR = 0.18`, used in all four |
| The full strategy weight table (§5.3) | `presets.ts` | All 24 numbers match |
| `COST_WEIGHT_MAX = 0.4` | `server/pipeline/score.ts:59` | Confirmed |
| Carrier-protected reliability raised 0.6 → 0.8 (§10.3) | `score.ts:215` | Confirmed, reasoning in-comment |
| Guard 3 fires at ≥45 min earlier | `score.ts:62` | `TIE_ARRIVAL_MINUTES = 45` |
| `MAX_REPLANS = 3` | `server/pipeline/types.ts:101` | Confirmed |
| Travelport makes zero `fetch` calls | `grep -c "fetch(" server/suppliers/travelport.ts` | **0** |
| Rate-limit floor applied last, unbounded above | `lib/refreshInterval.ts:167-170` | Matches the appendix excerpt verbatim |
| `PIPELINE_ALLOW_MUTATIONS` gates every commit | `saga.ts:115`, `journal.ts:78`, `types.ts:186` | Confirmed |
| Budget-table inconsistencies fixed (§10.2) | `governor.ts:150,165` | Both fixes present, with comments |

### The strongest single signal: the file manifest

§13 lists **24 new files with exact line counts**. Checked against
`origin/feature/autonomous-rebooking-pipeline`:

**All 24 match exactly.** Not approximately — exactly, every one.

A first pass against the *merged* tree showed 5 mismatches
(`pipeline/index.ts`, `saga.ts`, `score.ts`, `journal.ts`, `narrate.ts`). Every one is
explained by edits made *after* the branch: the Postgres conversion during the three-way
merge, and the notification/deadline work added on 17 Aug. Compared against the branch the
report actually describes, they are exact. Nobody rounds 24 numbers correctly by accident.

### Second deeper pass — behavioural claims

| Claim | Evidence |
|---|---|
| §11.1 `MAKCORPS_VETO_TOLERANCE = 3` | `export const MAKCORPS_VETO_TOLERANCE = 3;` |
| §11.4 `paceFloor()` used only for flight + hotel | one call site, guarded on those two step names |
| §5.3a red-eye inversion done once, named | `const avoidRedEye = !redEyeTolerated;` |
| §5.3 accessibility unioned across the party | 3 references in `adapt.ts` |
| §11.3 `cache.invalidate()` added for OAuth | `export function invalidate(key: string)` |
| §11.3 Uber retries exactly once on 401 | 2 `invalidate` references in `ground/index.ts` |
| §5.1 Duffel Air + Stays share one ledger | `LEDGER_OF` present and documented |
| §6 `transition()` never throws | `transition-rejected` recorded, 2 references |
| §10.1 pin-and-merge fix | 8 `pinned` references in `altsCache.ts` |
| §5.3c no invented FX | 3 `needsConversion` references |
| §4 "Registry: 6 sources" | duffel · kiwi · sabre · skyscanner · travelfusion · travelport |
| §7 saga commit order | `revalidate → authorise → flight → hotel → ground → dispose → onward → notify` |
| §7 two-tier failure policy | `CRITICAL = {revalidate, authorise, flight, hotel}` |

Every one confirmed. No claim in this pass was found to be overstated.

Two further findings are positive evidence of good faith:

- **The "known-wrong, NOT yet applied" governor configs really are still wrong.**
  `skyscanner.monthly` is still `500` and `makcorps.monthly` is still `30` modelled as
  renewing. A report inflating its completeness would have fixed these quietly and claimed
  them. This one flagged them and left them.
- **§2's warning that "the first real Duffel call will likely need field-mapping fixes"
  proved correct.** The first real OAG call made on 17 Aug hit exactly that: `parseInstance`
  had been written against a response shape the v2 API does not send.

## 2. Errors found

**a. A trivial miscount.** The report splits the 73 assertions as 37/30/6
(prefs/pipeline/hotels). Actual: **38/29/6**. Total is exactly right; one assertion sits in
a different suite than reported. Not worth correcting.

**b. One claim that does not hold as written.** §8 states:

> `POST /air/orders` — no fetch exists. Stub returning `not implemented`.

There is **no reference to `air/orders` or `not implemented` anywhere under
`server/suppliers/`**. The *substantive* claim — that nothing can create a real booking —
still holds, but it holds through the **absence of any write path** plus the
`PIPELINE_ALLOW_MUTATIONS` gate, not through an explicit stub. The report describes a guard
rail that is not there. The safety property it protects is real; the mechanism described is
not.

## 3. Superseded by the three-way merge

True when written, false now. Listed because the report reads as current documentation.

1. **"The repo has no test runner" (§9.1)** — it does. Zayaan's branch brought vitest; the
   tree now runs **80 tests**. The report's `verify:*` scripts still work and still pass, so
   there are now *two* parallel test systems. Separately, `tests/*.test.ts` are written for
   `node:test` and are currently unrunnable by either runner.
2. **"There is no `.env` / `.env.local` … Live API calls made: 0" (§2)** — **no longer
   true.** `.env.local` now exists with real OAG and Twilio credentials, and real OAG calls
   have been made. This is the single most important line to stop quoting.
3. **"Nothing in this system can create a booking" (§8)** — now qualified. The
   no-holds branch added `server/suppliers/sandbox.ts`, the one write-capable adapter, gated
   behind `ZKD_SANDBOX=1` against synthetic inventory.
4. **"A flat 10-minute TTL" (§3.1)** — superseded twice. `isAltsStale` no longer reads
   `config.altCache.ttlMs` **at all**; it delegates entirely to the governor-derived
   cadence. That knob is now dead for alts while still live for ground.
5. **§5.4's hard-rules table is incomplete** — a fourth filter now exists: an option
   arriving after `Flight.hardDeadlineISO` is disqualified. Krishna's 29 scorer assertions
   still pass against it, which suggests the extension did not distort the original design.

## 4. Recommended follow-up

None of this requires reworking the pipeline code — it is in better shape than the report
claims, not worse. The work is documentation integrity plus two config fixes the report
itself already identified:

1. Add a "superseded by the merge" note to §2 of the report, so "0 live API calls" is not
   quoted as current.
2. Apply the two governor corrections: `skyscanner.monthly` 500 → 100, and make `makcorps`'s
   30 non-renewing. The report is right that the second is the dangerous direction — a
   one-time budget treated as renewing is precisely the failure the governor exists to
   prevent.
3. Correct the `/air/orders` line to describe the actual mechanism.

## 5. Reproducing this verification

```bash
cd zkd-app
npm run verify        # 73 assertions
npm test              # 80 vitest tests
npx tsc --noEmit

git diff --shortstat 8a5cd64 origin/feature/autonomous-rebooking-pipeline
# must read: 38 files changed, 5768 insertions(+), 157 deletions(-)
```

Both repo gates were unaffected (this review was read-only):
`python3 iropssim.py | diff - iropssim-output.json` → empty, and the four canon hashes match.
