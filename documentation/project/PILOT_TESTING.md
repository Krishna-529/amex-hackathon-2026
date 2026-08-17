# End-to-end pilot testing

**ZKD Concierge · Codestreet 2026 / American Express**

How to actually exercise the real pipeline — prediction, threshold-gated pre-caching, and the
recovery lifecycle — start to finish, on your own machine. Everything below was run and verified
while building `zkd-risk-model/`; this is that same runbook, written down.

---

## 1. Boot the two real processes

The app and the model are two separate processes talking over HTTP — start the model first.
Commands below are given for both PowerShell (Windows default) and bash/Git Bash — use whichever
matches your terminal prompt (`PS C:\...>` vs `$`/`user@host:...$`).

```powershell
# Terminal 1 — the real scorer (PowerShell)
cd zkd-risk-model
.\.venv\Scripts\Activate.ps1     # first time: python -m venv .venv; pip install -r requirements.txt
python src\serve.py 8090
# → "risk scorer listening on :8090 (model <hash>, global prior X.XX%)"
```

```powershell
# Terminal 2 — the app (PowerShell)
cd zkd-app
npm install                      # first time only
$env:RISK_MODEL_URL = "http://localhost:8090"
npm run dev
# → http://localhost:5176
```

<details>
<summary>bash / Git Bash equivalent</summary>

```sh
# Terminal 1
cd zkd-risk-model
source .venv/Scripts/activate    # first time: python3 -m venv .venv && pip install -r requirements.txt
python src/serve.py 8090

# Terminal 2
cd zkd-app
npm install
RISK_MODEL_URL=http://localhost:8090 npm run dev
```
</details>

**Smoke test both are wired together** (PowerShell — `curl` is aliased to `Invoke-WebRequest`, which
doesn't take curl's flags the same way, so use `Invoke-RestMethod` or plain `curl.exe`):

```powershell
curl.exe http://localhost:8090/health                          # {"status":"ok","modelVersion":"..."}
curl.exe http://localhost:5176/api/passengers/p-priya/schedule  # will 401 — see login below
```

If the app is up but `RISK_MODEL_URL` is wrong or the scorer isn't running, flights will load with
no `forecast` field at all rather than an error — that is the intended "not available" behavior
(§4 of `documentation/design/05-cancellation-risk-model.md`), not a bug. Check Terminal 2's log for
`[riskModel] scorer unreachable for ...` to confirm that's what's happening.

## 2. Log in as a real seeded passenger

Five demo accounts exist (`zkd-app/lib/demoAccounts.ts`):

| Email | Password | Passenger ID |
|---|---|---|
| `priya@zkd.demo` | `priya-2026` | `p-priya` — the main walkthrough identity, has a multi-leg itinerary (MAA→DEL→LHR) |
| `arjun@zkd.demo` | `arjun-2026` | `p-arjun` |
| `fatima@zkd.demo` | `fatima-2026` | `p-fatima` |
| `rohan@zkd.demo` | `rohan-2026` | `p-rohan` |
| `ananya@zkd.demo` | `ananya-2026` | `p-ananya` |

Log in through the UI at `http://localhost:5176/login`, or via PowerShell to inspect the raw API
(`-SessionVariable`/`-WebSession` carries the auth cookie between calls, same idea as curl's
`-c`/`-b` cookie jar):

```powershell
$session = $null
Invoke-RestMethod -Uri http://localhost:5176/api/auth/login -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"priya@zkd.demo","password":"priya-2026"}' `
  -SessionVariable session

Invoke-RestMethod -Uri http://localhost:5176/api/passengers/p-priya/schedule -WebSession $session |
  ConvertTo-Json -Depth 10
```

<details>
<summary>bash / Git Bash equivalent</summary>

```sh
curl -c cookies.txt -X POST http://localhost:5176/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"priya@zkd.demo","password":"priya-2026"}'

curl -b cookies.txt http://localhost:5176/api/passengers/p-priya/schedule | python3 -m json.tool
```
</details>

Each `upcoming` flight's `forecast` field should show `"source": "internal-ml"` and a real
`modelVersion` — that is the thing to point at as proof this isn't a vendor call or a mock.

## 3. What "real but currently low-risk" looks like, and why

Every Indian/international flight cold-starts every historical-rate feature to the population base
rate (`entity_rates.json`'s `global_prior`, ~1.7%) — the model has real training data for US and
Brazil, and has never seen an Indian carrier's real outcome yet. Real scores today cluster
2-4% (verified: `zkd-risk-model/reports/score_distribution.json`, 168,000 real feature combinations
scored through the live model). `documentation/design/05-cancellation-risk-model.md` §2 covers this;
it is the single most important thing to be able to explain in a pilot review if someone asks "why
does every flight look safe?"

**The action bands (`prepare` / `hold-gate` / `pre-authorise`) are recalibrated against that real
distribution** (`config/risk-thresholds.json`, base `{2, 3, 5}` / floor `{1, 2, 4}` / ceiling
`{3, 4, 7}` — see design doc §7), so this is no longer hypothetical: the seeded flight `u4` (`6E 6155`,
BOM→GOI, a real late-Sunday-night red-eye — the actual real max-risk profile for the current month)
reaches a real **4% / hold-gate** score out of the box, with real alternatives pre-cached. Even the
original flagship flight `u1` now reaches `hold-gate` under these thresholds. Load `/flights/u4` (or
`/flights/u1`) to see the escalation path fire with zero manual intervention.

Two more ways to see the model's real range, beyond what's seeded:

### 3a. Score the model directly with a deliberately bad feature vector

This tests the scoring + calibration math in isolation, the same way `zkd-risk-model/src/train.py`'s
evaluation does — not part of the live app flow:

```powershell
$badFlight = @{
  carrier_hist_cancel_rate = 0.15; route_hist_cancel_rate = 0.20
  origin_hist_cancel_rate  = 0.10; dest_hist_cancel_rate   = 0.10
  origin_month_hist_cancel_rate = 0.18
  month = 12; day_of_week = 5; hour_of_day = 23
  is_redeye = 1; is_weekend = 0
  distance_km = 1800; sched_duration_min = 220; origin_hour_density = 12
  prior_leg_cancelled = 1; international = 0
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:8090/score -Method Post -ContentType "application/json" -Body $badFlight
```

<details>
<summary>bash / Git Bash equivalent</summary>

```sh
curl -s -X POST http://localhost:8090/score -H "Content-Type: application/json" -d '{
  "carrier_hist_cancel_rate": 0.15, "route_hist_cancel_rate": 0.20,
  "origin_hist_cancel_rate": 0.10, "dest_hist_cancel_rate": 0.10,
  "origin_month_hist_cancel_rate": 0.18, "month": 12, "day_of_week": 5,
  "hour_of_day": 23, "is_redeye": 1, "is_weekend": 0, "distance_km": 1800,
  "sched_duration_min": 220, "origin_hour_density": 12, "prior_leg_cancelled": 1,
  "international": 0
}'
```
</details>

You should see `cancelProbability` well above the seed flights' baseline and `confidence` near 1.0
(lots of real, differentiated history behind every input, unlike a cold-started `LIVE:` entity).

### 3b. Recompute the real score distribution after any retrain

If you retrain (`python src/train.py`) and want to check whether the recalibrated thresholds still
make sense against the new model's real output range:

```powershell
cd zkd-risk-model
python src\score_distribution.py
Get-Content reports\score_distribution.json | ConvertFrom-Json
```

Compare the real percentiles against `config/risk-thresholds.json`'s `bands` comment — if they've
drifted meaningfully, the base/floor/ceiling values are due for another real recalibration pass
(same method as `documentation/design/05-cancellation-risk-model.md` §7 describes), not a guess.

## 4. Exercise the recovery lifecycle via `/ops`

`/ops` is not linked from the nav — direct URL only: `http://localhost:5176/ops`. It is the operator
console that lets a demo trigger an actual disruption without waiting for a real airline to cancel a
flight. Its trigger button calls the exact same `detectDisruption()` entry point a live
AviationStack/OAG status change would call — only the caller differs.

1. Open `/ops`, pick a flight, hit **Trigger**.
2. Watch the phase progress: `WATCH → WARM → ASK → WAIT → ACT → VERIFY → CLAIM` (documented in
   `documentation/design/03-action-policy.md` §1). This exercises the saga, the policy gate, and the
   confirmation window — none of which depend on the ML model being right (that's the point of the
   WAIT-gate safety claim).
3. Open a second tab as a different identity (`?as=p-arjun` in the header identity switcher) to see
   two members converge independently against the same shared backend state.

## 5. Confirm the threshold-gated pre-cache is actually gating

This is the specific behavior the whole prediction pipeline exists to pay for — worth checking
directly rather than trusting it happened:

```powershell
# u4 (BOM->GOI, the seeded real high-risk red-eye) starts with candidates.alts: []
(Invoke-RestMethod -Uri http://localhost:5176/api/flights/u4 -WebSession $session).candidates.alts.Count

# Reverify (or just wait for the batch scorer / view the flight page) to force a real score —
# u4's real ~4% score crosses hold-gate, which is at/above altCache.prefetchAtOrAbove ("prepare")
Invoke-RestMethod -Uri http://localhost:5176/api/flights/u4/reverify -Method Post -WebSession $session

# candidates.alts should now be non-empty — refreshAlts() actually ran off a real score crossing
(Invoke-RestMethod -Uri http://localhost:5176/api/flights/u4 -WebSession $session).candidates.alts.Count
```

If a *different* seeded flight (one that stays at `watch`) never populates `candidates.alts`, that
is the model correctly declining to spend a supplier search on a flight it has no reason to
distrust — not a broken gate.

## 5a. The prediction-history graph and audit panel

On any upcoming flight's page (`/flights/u1`, etc.) below the main gauge:

- **Prediction history** — a real time-series of every score that flight has received. It starts
  empty ("collecting history") because history only grows from real scores — either the interval
  batch re-scorer (fires on `config/risk-thresholds.json`'s `forecast.batchRescoreIntervalMs`,
  default 10 min, logged as `[batchScorer] starting, interval=...` on server startup) or a manual
  reverify. To see a real multi-point graph without waiting 10 real minutes, click **Reverify now**
  a few times a minute or two apart.
- **Why this number** — a real diverging bar chart of the current prediction's XGBoost tree-SHAP
  feature contributions (blue = pushes toward safe, red = pushes toward cancel), sized by real
  relative share. This is computed fresh per prediction, not a canned explanation per flight.
- **Reverify this prediction** — forces an immediate real re-score and reports the delta against
  what was last shown. Two reverifies back-to-back on an unchanged flight should reproduce (near-)
  identically; a large swing on the same model/config is flagged for a human look.

## 6. Validate the model itself, offline

This is the honest accuracy claim, separate from anything the live app does:

```powershell
cd zkd-risk-model
.\.venv\Scripts\Activate.ps1
python src\train.py
Get-Content reports\model_metrics.json | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

Re-running is deterministic modulo the chronological split (same data in, same split points, same
numbers out). `roc_auc`, `pr_auc`, `brier_score` and the calibration curve are all computed on a
test window the model never trained or calibrated on — that's the number to defend in a review, not
anything computed on training data. `reports/model_metrics.json` also includes a naive-baseline and
logistic-regression comparison, a real lift table, and per-country/month segment metrics;
`reports/calibration_plot.png` is a real reliability diagram. **`zkd-risk-model/MODEL_CARD.md` is
the 2-minute version of all of this** — the one to actually hand a VP, not the raw JSON.

## 6a. Run the real test suite

```powershell
# zkd-app — unit tests (no server needed) + Playwright E2E (needs both servers up, per §1)
cd zkd-app
npm test
npm run test:e2e

# zkd-risk-model — pytest (needs models/ populated, which it already is — real, small, checked in)
cd ..\zkd-risk-model
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest -v
```

`.github/workflows/ci.yml` runs the same three suites (plus `tsc --noEmit` and `next build`) on
every push/PR touching `zkd-app/` or `zkd-risk-model/`.

## 7. Known gaps to have an answer ready for

Straight from `documentation/design/05-cancellation-risk-model.md` §8 — a pilot reviewer will find
these, so know them going in:

1. No Indian/most-international historical training data exists publicly in bulk — the model
   generalizes by feature design, not by having seen the routes (§3 above). Real, measured
   consequence: the model is also weaker on Brazil (its smaller training market) than the US —
   `MODEL_CARD.md` states the real per-country numbers, not just the aggregate.
2. No weather feature in the trained model yet (v1) — `server/weather.ts` is real and live for the
   explanation narrative only.
3. OAG's request shape is mostly confirmed (`version=v2`, the real required params), not fully —
   2 of 100 trial calls spent, one more would confirm the exact datetime-range format. See
   `server/oag.ts`'s header for the full real request/response history.
4. `prior_leg_cancelled` (real tail-rotation signal) is `null` for every live flight — that product
   (OAG Flight Info Connections) is Production-tier, not usable on trial.
5. The continual-learning loop's outcome-join isn't built — predictions/outcomes are really logged
   (`server/decisionLedger.ts` locally, S3 in the AWS path) and the weekly retrain runs genuinely
   unattended (`src/entrypoint.py`), but nothing yet maps the accumulated `LIVE:` outcome log back
   onto the BTS/ANAC training schema — a retrain today still trains on US+Brazil data only.
6. AWS infra (`zkd-risk-model/infra/`) is real Terraform, unapplied — the $140 credit is reserved
   for the week before the final presentation (`infra/README.md`).

## 8. Shutting down cleanly

```sh
# Ctrl-C both terminals, or:
taskkill //F //IM python.exe   # Windows — kills the scorer
taskkill //F //IM node.exe     # kills the Next.js dev server
```

Both processes are stateless between restarts except the trained model artifact
(`zkd-risk-model/models/`) and the app's in-memory demo data (`server/domain/seed.ts`, reset on
every `npm run dev` restart).
