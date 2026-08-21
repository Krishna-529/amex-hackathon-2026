# ZKD demo — session checkpoints

Working copy: `E:\projects\amex\zkd-app` (edited from WSL via `/mnt/e/...`).
Branch: **`demo`** (github.com/Krishna-529/amex-hackathon-2026). `main` untouched.
All commits below are pushed to `origin/demo`. Latest: `061561d`.

---

## ✅ Done & pushed

### [x] 1. Confirm "Yes — do this if it cancels" button (pre-auth)  — `c8bb9f1` / `0a7de15`
- **Bug:** `authorise()` POSTed `{altId, hotelId, cabId}` from state, but `hotelId/cabId`
  were never set (no picker) → always `null`; the route required all three → **400**, swallowed.
- **Fix:** only `altId` required; hotel/cab optional (`string | null`) end-to-end; client sends
  resolved `alt/hotel/cab` ids; surfaces Saving…/Saved/error instead of no-op.
- Files: `app/flights/[id]/page.tsx`, `app/api/flights/[id]/preauth/route.ts`, `lib/apiTypes.ts`,
  `server/domain/types.ts` (+ `RecoveryTask`/`DisruptionResolution`/`PipelineRun.plan` widened to
  `string | null`).

### [x] 2. Sticky `/ops` ramp (demo-override)  — `c8bb9f1`
- **Bug:** ramping 2 flights to ~80 then navigating reset one — the 90 s critical rescore tick
  overwrote the `modelVersion:'demo-override'` forecast.
- **Fix:** `isDemoPinned()` guards `applyScore`, `isStale`, and batch scorer `tick`/`warmAll`;
  a ramped score holds until **Reset demo**.
- Files: `server/engine/forecast.ts`, `server/engine/batchScorer.ts`.

### [x] 3. Recovery stuck at "Policy gate" + copy  — `ee3ce78`
- **Bug (found via 2 adversarial personas):** two compounding issues left autopilot/pre-auth
  recoveries hung at `phase:'acting'`:
  - HOLD_PENDING **race** — `execute()` fired ~260 ms after detection before `plan()` parked the
    run at `HOLD_PENDING`; the `→CONFIRMED` transition was rejected and execute bailed
    (`server/pipeline/index.ts:424`).
  - **stale snapshot** in `plan()` — read alts from a snapshot taken before `refreshAltsNow`
    populated them → `applyHardRules` kept 0 → halted.
- **Fix:** register `plan()`'s promise + `ensurePlanned()`; `createTaskForBooking` awaits it and
  re-reads the flight; `plan()` re-reads the flight after `refreshAltsNow`; `execute()` early-outs
  now mark the task `handed` (never stranded at `acting`).
- **Copy:** "authorised beforehand" only on pre-auth path; autopilot gets its own line; header
  shows real departure day (`dayLabel`) not hardcoded "today".
- Files: `server/pipeline/index.ts`, `server/engine/simulation.ts`, `app/recovery/[id]/page.tsx`.
- ⚠️ **Verify in browser:** `/ops` → Reset demo → trigger u1 → `/recovery/u1` runs through to
  **booked** ("Your trip now"), not hung.

### [x] 4. Dark/light theme toggle on all pages  — `1456181`
- Floating ☀/☾ toggle (`components/ThemeToggle.tsx`) mounted in `app/layout.tsx`; no-flash
  pre-hydration script; persists `localStorage['zkd-theme']`.
- `app/globals.css`: `:root[data-theme='light']` token block; dark-section white/mist literals
  converted to tokens; Amex skin gets a `:root[data-theme='dark']` `--amex-*` palette + tokenised
  card/surface/brand-text so member pages flip too.
- ⚠️ **Verify in browser** (couldn't run locally — broken WSL node binding). Known residuals: amber
  `#fffbeb` alert chip and a few `#00175a` navy backgrounds in the Amex skin not yet tokenised.

### [x] 5. In-app cancel-report modal + ops "mark cancelled (data)"  — `061561d`
- Replaced native `window.confirm` with our themed modal ("Sorry for the inconvenience — let us
  check"). Report now **checks our data** and only rebooks when confirmed.
- New `/ops` **"Mark cancelled (data only)"** → sets `flight.cancelledInData` (ground truth, no
  recovery). `corroborate()` treats it as authoritative.
- Not cancelled → "we checked, not cancelled" + helpline **1800 419 2122**, no rebooking.
  Cancelled → "marked cancelled, rebooking" + link to recovery.
- Files: `app/flights/[id]/page.tsx`, `app/api/flights/[id]/report-cancellation/route.ts`,
  `app/api/ops/mark-cancelled/route.ts` (new), `app/ops/page.tsx`, `server/engine/memberReports.ts`,
  `server/domain/types.ts`, `app/globals.css` (`.zkd-modal`/`.zkd-btn`).
- **Demo:** /ops → Mark cancelled (data) → member reports → "rebooking"; on a calm flight → "not
  cancelled + helpline". (A *ramped* hold-gate flight also confirms via existing "model distrusted
  it" logic — use a calm flight for the "not cancelled" demo.)

---

## ❓ Answered (no code change)
- **"airline pays"** = duty-of-care model: the room/cab cost shown is only what the member pays
  *over* the airline allowance (`extra`); u1's default picks (h1 re-timed room, c1 sedan) have
  `extra:0` → airline covers it. Picking Roseate/SUV shows the real "₹X over". Working as designed.
- **Krishna's learned ranker** IS wired: `rankAlts` → `rankByModel` (conditional-logit,
  `server/pipeline/ranker/`), used in `plan()` → `run.plan`. It was being *discarded* until the
  stall fix (#3) let `plan()` complete — now the ranker's pick is what gets booked.

---

## ⏳ Pending / not started

### [ ] 6. Hotel booking button not working
- **Suspected root cause:** `bookHotel` (`app/page.tsx:227`) sends `checkin`/`checkout` from search;
  the route (`app/api/bookings/hotel/route.ts:40`) requires `^\d{4}-\d{2}-\d{2}$`. Need to confirm
  what `/api/search/hotels` returns for those fields → fix format (client or route) + surface errors.

### [ ] 7. Attach hotel to flight PNR at checkout → recovery rebooks both
- When a member books a flight **and** a hotel, link them (set `stay.flightId` / add to that
  flight's `candidates.hotels`) so disruption recovery rebooks **flight + hotel** together, not just
  the flight.

### [ ] 8. Add logo to the Flutter app (`zkd-flutter/`)
- Assets available: `zkd-app/public/brand/icon-512.png` / `icon-192.png`, `public/favicon.svg`.
- Flutter app has no `assets/` dir; `pubspec.yaml` has no `assets:` section (template).
- Plan: create `zkd-flutter/assets/logo.png` (copy icon-512), add `assets:` under `flutter:` in
  pubspec, show `Image.asset` on `lib/screens/login.dart` header (+ optional app bar), `flutter pub get`.
- ⚠️ `zkd-flutter/` is **untracked** in the amex repo — decide whether to commit the whole app to
  `demo` or keep local.

### [ ] 9. Theme residuals (from #4) — tokenise the amber `#fffbeb` chip and remaining `#00175a`
  navy backgrounds in the Amex dark skin once verified visually.

---

## Notes / environment
- Tests can't run here: `node_modules` has a broken native binding (`@rolldown/binding-wasm32-wasi`)
  under WSL/`/mnt/e` — needs `npm i` or run from Windows. Everything validated via `npx tsc --noEmit`.
- The "~90 s wait on cancel" was investigated: it's the intentional `ask`-consent decision window
  (floor 120 s, `lib/confirmWindow.ts`), **not** a scheduler stall. Left as-is (user handling it).
- `.env.local` has `OAG_REPLAY=1` (replays fixtures, no OAG spend).
