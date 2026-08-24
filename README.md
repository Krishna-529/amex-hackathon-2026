# ZKD Concierge — Codestreet 2026 / American Express

Team ZKD, IIT Madras. Autonomous travel-disruption concierge for Indian domestic aviation:
predict or detect an IRROPS event, re-accommodate the member across flight + hotel + ground,
claim duty of care from the carrier, and stop safely when it cannot.

This is the submission bundle: the two working apps, the self-trained risk model, the deck, the
APK, and the full solution writeup. Earlier Round 1 evidence sites, session logs, and superseded
design docs have been pruned — see git history if you need them.

## Start here

| I want to… | Go to |
|---|---|
| Read the full solution writeup, backed by real data | [`SOLUTION.md`](SOLUTION.md) |
| See how the Monte Carlo sim numbers were derived | [`documentation/design/10-monte-carlo-revision-2026-08.md`](documentation/design/10-monte-carlo-revision-2026-08.md) |
| Run the web app | `cd zkd-app && npm install && npm run dev` |
| Run the Flutter app | `cd zkd-flutter && flutter pub get && flutter run` |
| Try the pre-built Android build | [`assets/builds/ZKD-Concierge.apk`](assets/builds/ZKD-Concierge.apk) |
| See the pitch deck | [`assets/deck/ZKD_Concierge_Codestreet_2026.pptx`](assets/deck/ZKD_Concierge_Codestreet_2026.pptx) |
| Check the risk model's real training metrics | [`zkd-risk-model/reports/model_metrics.json`](zkd-risk-model/reports/model_metrics.json), [`zkd-risk-model/MODEL_CARD.md`](zkd-risk-model/MODEL_CARD.md) |

---

## `zkd-app/` — the web product

Next.js 16 / React 19 prototype. Predicts a cancellation, shows the risk gauge with a
plain-language explanation, and walks the member through pre-authorisation and the live
rebooking sequence — for any of several flights, each with any number of passengers, including
passengers with a connecting itinerary (a layover between two legs).

```bash
cd zkd-app
npm install
npm run dev          # → http://localhost:5176
```

**Architecture: the backend is the only thing that decides anything.** A module-level
simulation engine (`server/engine/simulation.ts`) runs the whole disruption lifecycle —
detection, the decision window, rebooking — with real `setTimeout`/`setInterval` chains, so it
resolves on schedule whether or not any device is watching. Every screen (web tab, phone) is a
plain poller of that shared state; nothing is computed or timed client-side. This only behaves
correctly as one continuous `npm run dev` / `npm start` process — a serverless redeploy would
drop the in-memory state and any scheduled timers mid-flight.

Since a live demo can't wait for an actual airline to cancel a flight, `/ops` (not linked from
the nav — direct URL only) is an operator console that adds flights and triggers a disruption on
one, through the same `detectDisruption()` entry point a real production live-status poller
would call.

Routes: `/flights` · `/flights/[id]` · `/prepare/[id]` · `/recovery/[id]` · `/profile` ·
`/settings` · `/history` · `/how-it-works` · `/ops` (operator console, direct URL only)

When a flight is cancelled and the recovery completes, the newly booked flight now appears as a
real entry in the member's Upcoming list, tagged "Booked on behalf of {original flight code}".

**Cancellation detection runs on three lanes** — a push webhook, a budget-capped poller, and the
member telling us. Payment stays fully mocked — no live payment integration exists.

## `zkd-flutter/` — the mobile app

Flutter client: Flights, Flight detail, Recovery, Profile.

```bash
cd zkd-flutter
flutter pub get
flutter run
```

Disruption notifications fire both while the app is open (a live 4-second poll) and while it's
backgrounded or fully closed (a WorkManager periodic background task, ~15-minute floor on
Android — see `lib/background_task.dart`). This is a throttled poll, not real push; a full FCM
integration remains a further step.

## `zkd-risk-model/` — the cancellation-risk model

The real, self-trained model behind every risk score: an XGBoost classifier trained on
7,893,669 real historical flights (US DOT/BTS + Brazil ANAC), ROC-AUC 0.804. See
`zkd-risk-model/README.md`, `zkd-risk-model/MODEL_CARD.md`, and
`zkd-risk-model/reports/model_metrics.json` for the full training/evaluation detail — the exact
numbers `SOLUTION.md` quotes.

---

## Reproducing the Monte Carlo numbers

```sh
python3 iropssim.py | diff - iropssim-output.json    # must be empty
```

`iropssim.py` is the fixed-seed simulation behind every `sim`-tier number in `SOLUTION.md` and
the deck. See `documentation/design/10-monte-carlo-revision-2026-08.md` for how its
`p_prediction_lead` parameter was derived from the risk model's own decile lift table, rather
than assumed.

## Known limitations, stated plainly

The cancellation-risk model is real and self-trained, but has no Indian/international historical
training data yet and cold-starts those routes to the population base rate (see
`SOLUTION.md`'s Prediction & Risk Model section). Payment is mocked throughout. The Flutter app's
background notifications are a poll, not real push — see `zkd-flutter/lib/background_task.dart`'s
own comments for the exact reliability caveats (OS-throttled interval, no guarantee under
aggressive OEM battery optimization).
