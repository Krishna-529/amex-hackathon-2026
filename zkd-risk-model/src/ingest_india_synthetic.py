"""Turns data/synthetic/india_carrier_monthly.csv (see
data/synthetic/generate_india_synthetic.py — every row there is FABRICATED,
not observed) into smoothed carrier/origin/dest/route/origin_month rate
tables, using the exact same additive (Laplace-style) smoothing formula
features.py applies to the real BTS/ANAC training data (SMOOTH_N=20), so a
reviewer comparing the two methodologies finds them identical — only the
input rows differ in provenance.

Unlike features.py's per-row EXPANDING window (each row only sees rows
strictly before it, because during training a leak would inflate reported
accuracy), this table is not training data and is never scored against
itself — it is a static reference served alongside the real one. A single
aggregate smoothed rate per entity (all synthetic rows pooled) is therefore
the honest, simplest thing to compute; there is no leakage concept to guard
against for a table nothing is trained on.

Output: models/entity_rates_synthetic.json — deliberately a SEPARATE file
from models/entity_rates.json (the real trained artifact). Never merged in,
so a retrain (train.py) can never silently pick up or overwrite synthetic
rows, and serve.py can label the two tables differently to every consumer
rather than presenting one as the other.

Run: python src/ingest_india_synthetic.py
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "synthetic" / "india_carrier_monthly.csv"
OUT_PATH = ROOT / "models" / "entity_rates_synthetic.json"

# Same smoothing strength as features.py's real pipeline (SMOOTH_N=20) —
# not tuned separately, so "how much a single route/carrier can move the
# rate before deviating from the prior" reads the same in both tables.
SMOOTH_N = 20.0


def _load_rows() -> list[dict]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"{CSV_PATH} not found — run data/synthetic/generate_india_synthetic.py first")
    with CSV_PATH.open() as f:
        return [
            {
                "carrier": r["carrier"], "origin": r["origin"], "dest": r["dest"], "month": int(r["month"]),
                "scheduled": int(r["scheduled_flights"]), "cancelled": float(r["cancelled_flights"]),
            }
            for r in csv.DictReader(f)
        ]


def _smoothed_table(rows: list[dict], key_fn, prior: float) -> dict[str, float]:
    """Pools every row's scheduled/cancelled counts by key_fn(row), then
    applies the same (sum + prior*N) / (count + N) formula as
    features.py's _expanding_rate — here 'count' is real synthetic flight
    volume (scheduled_flights), not a row count, since these rows are
    already monthly aggregates rather than one-row-per-flight."""
    agg: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])  # [scheduled, cancelled]
    for row in rows:
        k = key_fn(row)
        agg[k][0] += row["scheduled"]
        agg[k][1] += row["cancelled"]
    # LIVE: namespace matches exactly what server/engine/riskModel.ts's
    # assembleFeatures() constructs for a real Indian flight (carrier code,
    # single IATA, "ORIGIN>DEST" pair, "ORIGIN:MONTH") — so a lookup against
    # this table needs no key translation on the TS side.
    out: dict[str, float] = {}
    for k, (sched, cancel) in agg.items():
        out[f"LIVE:{k}"] = round((cancel + prior * SMOOTH_N) / (sched + SMOOTH_N), 6)
    return out


def build() -> dict:
    rows = _load_rows()
    total_sched = sum(r["scheduled"] for r in rows)
    total_cancel = sum(r["cancelled"] for r in rows)
    global_prior = total_cancel / total_sched

    carrier = _smoothed_table(rows, lambda r: r["carrier"], global_prior)
    origin = _smoothed_table(rows, lambda r: r["origin"], global_prior)
    dest = _smoothed_table(rows, lambda r: r["dest"], global_prior)
    route = _smoothed_table(rows, lambda r: f"{r['origin']}>LIVE:{r['dest']}", global_prior)
    origin_month = _smoothed_table(rows, lambda r: f"{r['origin']}:{r['month']}", global_prior)

    return {
        "_comment": (
            "SYNTHETIC — every rate below is derived from fabricated rows "
            "(data/synthetic/india_carrier_monthly.csv), not real observed "
            "flights. Served separately from the real entity_rates.json and "
            "must be surfaced to the end user as 'synthetic-market-estimate', "
            "never as 'real' history — see server/engine/riskModel.ts and "
            "components/ForecastAudit.tsx on the zkd-app side."
        ),
        "source": "synthetic-market-estimate",
        "global_prior": round(global_prior, 6),
        "as_of": datetime.now(timezone.utc).isoformat(),
        "carrier": carrier,
        "origin": origin,
        "dest": dest,
        "route": route,
        "origin_month": origin_month,
    }


if __name__ == "__main__":
    table = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(table, indent=2))
    print(f"wrote synthetic entity rates: global_prior={table['global_prior']:.4%}, "
          f"{len(table['carrier'])} carriers, {len(table['route'])} routes -> {OUT_PATH}")
