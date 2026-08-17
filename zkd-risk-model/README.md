# zkd-risk-model — the real cancellation-prediction model

Replaces the Lumo vendor call (`zkd-app/server/lumo.ts`, deleted) with a gradient-boosted model
trained on real historical flight data and served by our own code. See
[`documentation/design/05-cancellation-risk-model.md`](../documentation/design/05-cancellation-risk-model.md)
for the full design writeup, [`MODEL_CARD.md`](MODEL_CARD.md) for the 2-minute plain-English
accuracy/cost/limitations summary — this file is the "how to actually run it" companion.

## Quickstart

```sh
cd zkd-risk-model
python3 -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash; use bin/activate on macOS/Linux
pip install -r requirements.txt

# 1. Pull real historical data (no auth, ~650MB total for a year of both sources)
bash src/download_data.sh      # US DOT/BTS, ~12 months
bash src/download_anac.sh      # Brazil ANAC, ~12 months

# 2. Normalize + engineer features (all real, leakage-checked)
python src/ingest_bts.py
python src/ingest_anac.py
python src/features.py

# 3. Train, calibrate, evaluate — writes models/ and reports/
python src/train.py

# 4. Serve locally for zkd-app to call
python src/serve.py 8090
# then, in another terminal:
cd ../zkd-app && RISK_MODEL_URL=http://localhost:8090 npm run dev
```

`reports/model_metrics.json` after step 3 has the real, out-of-time evaluation numbers — ROC-AUC,
PR-AUC, Brier score, a calibration curve, and feature importances. Nothing in that file is
hand-edited; re-run `train.py` and it regenerates from scratch.

## What's real here, stated plainly

| Claim | Evidence |
|---|---|
| Real training data | `src/download_data.sh`/`download_anac.sh` pull directly from `transtats.bts.gov` and `siros.anac.gov.br` — no auth, no synthetic rows. Re-run them yourself. |
| No label leakage | `src/features.py`'s `_leakage_self_check()` recomputes one carrier's historical rate by hand on every run and compares against the vectorized version |
| Honest evaluation | `train.py` splits **chronologically** (train/calib/test are three consecutive time windows) — no shuffled k-fold, which would leak future rows into the past |
| No mock fallback at serving time | `zkd-app/server/engine/riskModel.ts` returns `null` (not a fabricated number) when this service is unreachable — verified by killing `serve.py` mid-session and re-polling |
| Same code, dev and prod | `src/serve.py` (local HTTP) and `src/handler.py` (Lambda) both wrap the one `CancellationScorer` class in `src/inference.py` |

## Known gaps (see the design doc's §8 for the full list)

- No Indian/most-international historical training data exists publicly in bulk yet — the feature
  set is geography-agnostic by design so the model has a mechanism to generalize, and the weekly
  retrain folds in real `LIVE:`-namespaced outcomes as this app accumulates them.
- No weather feature in the trained model yet (v1) — `server/weather.ts` is real but not joined
  into training data.
- OAG's exact live endpoint path for the trial subscription is unconfirmed — see
  `zkd-app/server/oag.ts`'s header comment for the real 404 we got back and why we stopped guessing
  rather than spend more of the 100-call trial budget.
- Infrastructure (`infra/`) is real Terraform, `terraform validate`-clean, **not applied** — the AWS
  budget is a $140 credit reserved for the week before the final presentation.

## Continual learning loop

1. Every live prediction and every real observed outcome gets logged to a real decision ledger —
   locally as JSONL (`zkd-app/server/decisionLedger.ts`, `.state/predictions.jsonl` +
   `.state/outcomes.jsonl`) for dev/pilot, and to S3 (`infra/storage.tf`) via `handler.py` once
   deployed. **Built and wired in**, not aspirational.
2. The weekly retrain now runs genuinely unattended (`src/entrypoint.py`, `Dockerfile.trainer`,
   `infra/training.tf`'s Fargate Spot schedule): download → ingest → features → train → upload the
   fresh artifact to `MODEL_BUCKET`, with S3-cached raw data so it isn't a ~600MB re-download every
   week. **Built and `terraform validate`-clean**, not applied yet (see the $140-credit note above).
3. **Not yet built**: joining the accumulated `LIVE:` outcome log back into `features.py`'s training
   table — today the retrain re-runs against BTS/ANAC only, so `LIVE:`-namespaced entities stay
   cold-started to the population prior even after a retrain. Closing this (mapping the ledger's
   shape onto the BTS/ANAC-derived feature schema) is the next real step, not a rerun of what
   already exists — see the design doc's §8.

## Files

| Path | What it does |
|---|---|
| `src/download_data.sh`, `download_anac.sh` | Pull real historical data, no auth |
| `src/ingest_bts.py`, `ingest_anac.py` | Normalize to one shared schema |
| `src/features.py` | Leakage-safe, geography-agnostic feature engineering |
| `src/train.py` | Train, calibrate, evaluate, export `models/` + `reports/` |
| `src/inference.py` | The scoring function — loads the artifact, returns a calibrated probability |
| `src/serve.py` | Local HTTP wrapper (stdlib only) |
| `src/handler.py` | AWS Lambda wrapper (same `inference.py`) |
| `Dockerfile.scorer` | Container image for the Lambda |
| `src/entrypoint.py` | Unattended retrain orchestrator (download → ingest → features → train → S3 upload) — what `Dockerfile.trainer`'s weekly Fargate Spot task actually runs |
| `Dockerfile.trainer` | Container image for `infra/training.tf`'s weekly retrain task |
| `infra/` | Terraform — see `infra/README.md` |
