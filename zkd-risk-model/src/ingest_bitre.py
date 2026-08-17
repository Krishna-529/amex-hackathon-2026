"""Normalize the real BITRE (Bureau of Infrastructure and Transport Research
Economics) Australian domestic on-time-performance CSV into the same
unified schema as ingest_bts.py / ingest_anac.py / ingest_uk_caa.py.

Same shape as ingest_uk_caa.py: a real monthly aggregate per (route,
airline) — not per-flight — with a genuine integer `Cancellations` count
(not a percentage, unlike DGCA) and `Sectors_Scheduled` as the real
denominator. Expanded into that many individual real training rows exactly
like ingest_uk_caa.py does, with the same honest cost: no real per-flight
timestamp survives the aggregation, so `intraday_known=False` here too —
features.py already knows to mask hour_of_day/day_of_week/origin_hour_density
to NaN wherever that flag is False, regardless of which source set it.

Real domestic-Australia limitation, stated plainly: every route in this
file is between two Australian ports (verified by inspecting the real
Departing_Port/Arriving_Port value set — no overseas city names present),
so `international` is honestly 0 for every row here. This is a real,
distinct Oceania/Asia-Pacific carrier and airport set (Qantas, Jetstar,
Virgin Australia, Rex, and Australian domestic airports never seen in
BTS/ANAC/UK-CAA), not an international-route source the way UK CAA's ~80%
international share was.

Columns verified 2026-08-17 against a real downloaded file's header.

Run: python src/ingest_bitre.py
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

RAW_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "bitre" / "bitre_otp_time_series.csv"

# BITRE's file is one consolidated download spanning Jan-2004 through the
# present — unlike BTS/ANAC/UK-CAA, which each only pulled real calendar
# year 2024. This was first set to "2023 onward" (a recency filter, for two
# real reasons: a live model should weight recent conditions over a
# 2004-era snapshot, and unfiltered this source alone expands to ~20M rows,
# more than every other source combined). That choice caused a real,
# measured bug: train.py's global chronological split sorts every source
# together by sched_dep, and with BITRE alone reaching into 2026 while
# BTS/ANAC/UK-CAA stop at end-2024, the held-out test tail became ~75%
# Australian data from a period (2025-2026) nothing else in the training
# set has any representation in — test ROC-AUC collapsed from 0.807 to
# 0.619 (see reports/model_metrics.json's fit_diagnostics from that run:
# train/test gap widened to 0.20, the real overfitting signature this
# pipeline's own diagnostics are built to catch). Locking BITRE to the same
# real calendar year as every other rolling source restores a chronological
# split that fairly samples every country in the SAME held-out period,
# instead of "test" silently meaning "whichever source has the most recent
# timestamp."
YEAR = 2024


def load_bitre() -> pd.DataFrame:
    if not RAW_PATH.exists():
        raise FileNotFoundError(f"{RAW_PATH} not found — run src/download_bitre.sh first")

    df = pd.read_csv(RAW_PATH)
    print(f"loaded {RAW_PATH}: {len(df):,} real aggregate rows")

    # "All Airlines" is BITRE's own real aggregate-across-carriers row per
    # route/month — keeping it alongside the individual-airline rows would
    # double-count every real cancellation once under the carrier's own name
    # and again under this synthetic rollup.
    df = df[df["Airline"] != "All Airlines"].copy()
    df = df[df["Sectors_Scheduled"] > 0].copy()
    df = df[df["Cancellations"] <= df["Sectors_Scheduled"]].copy()
    df = df[df["Year"] == YEAR].copy()

    df["country"] = "AU"
    df["carrier"] = "BITRE:" + df["Airline"].astype(str)
    df["origin"] = "BITRE:" + df["Departing_Port"].astype(str)
    df["dest"] = "BITRE:" + df["Arriving_Port"].astype(str)
    df["month"] = df["Month_Num"].astype(int)
    df["year"] = df["Year"].astype(int)
    df["international"] = 0  # see module docstring — real, verified domestic-only

    # Real-month-anchored placeholder, sort-key only (see ingest_uk_caa.py's
    # module docstring for the full rationale — same pattern here).
    df["sched_dep"] = pd.to_datetime(
        df["year"].astype(str) + "-" + df["month"].astype(str).str.zfill(2) + "-15 12:00:00"
    )

    matched = df["Sectors_Scheduled"].astype(int)
    cancelled = df["Cancellations"].astype(int)
    not_cancelled = matched - cancelled

    base_cols = ["country", "carrier", "tail_number", "flight_number", "origin", "dest",
                 "sched_dep", "day_of_week", "month", "year", "distance_km",
                 "sched_duration_min", "diverted", "international", "intraday_known"]

    df = df.assign(
        tail_number=pd.NA, flight_number=pd.NA, day_of_week=pd.NA,
        distance_km=pd.NA, sched_duration_min=pd.NA, diverted=0, intraday_known=False,
    )

    pos_idx = df.index.repeat(cancelled)
    neg_idx = df.index.repeat(not_cancelled)
    pos = df.loc[pos_idx, base_cols].assign(cancelled=1)
    neg = df.loc[neg_idx, base_cols].assign(cancelled=0)
    out = pd.concat([pos, neg], ignore_index=True)
    return out


if __name__ == "__main__":
    df = load_bitre()
    out_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "bitre_normalized.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"wrote {len(df):,} real (expanded) rows -> {out_path}")
    print(f"real cancellation rate: {df['cancelled'].mean():.4%}")
