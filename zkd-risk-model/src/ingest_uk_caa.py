"""Normalize real UK CAA "Punctuality Statistics — Full Analysis Arrival
Departure" monthly CSVs into the same unified schema as ingest_bts.py /
ingest_anac.py, so features.py never has to know which country a row came
from.

UNLIKE BTS/ANAC, this source is not per-flight — it's a real monthly
aggregate per (reporting airport, route, airline, arrival/departure
direction): `number_flights_matched` real flights, `number_flights_cancelled`
of which were real cancellations. This script expands each aggregate cell
into that many individual training rows (frequency expansion of a real
binomial count — not fabrication: a cell reporting "9 matched, 0 cancelled"
becomes 9 real rows with cancelled=0, because that IS what 9 real flights
each not cancelling means).

The honest cost of that expansion: CAA's aggregation has no real per-flight
date/time, so hour_of_day/day_of_week/origin_hour_density genuinely cannot
be computed for these rows — `intraday_known=False` tells features.py to
leave those NaN rather than guess. `distance_km`/`sched_duration_min` are
left NaN too (not published at this level, same honest gap ANAC already has
for distance). `sched_dep` gets a real-month-anchored placeholder timestamp
(day 15, noon) used ONLY as a chronological sort key for the global
train/calib/test split — never read for its time-of-day, which is why
intraday_known exists as a separate signal features.py must check.

Columns verified 2026-08-17 against a real downloaded 202401 file's header.

Run: python src/ingest_uk_caa.py
"""
from __future__ import annotations

import glob
from pathlib import Path

import pandas as pd

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "uk_caa"


def load_uk_caa() -> pd.DataFrame:
    files = sorted(glob.glob(str(RAW_DIR / "uk_caa_*.csv")))
    if not files:
        raise FileNotFoundError(f"no UK CAA files in {RAW_DIR} — run src/download_uk_caa.sh first")

    frames = []
    for path in files:
        df = pd.read_csv(path, encoding="utf-8-sig")
        frames.append(df)
        print(f"loaded {path}: {len(df):,} real aggregate rows")

    caa = pd.concat(frames, ignore_index=True)

    # Scheduled service only — charter ('C') is a different operating model
    # BTS/ANAC don't cleanly include either (BTS's OTP dataset is reporting-
    # carrier scheduled service by construction; ANAC's charter rows are the
    # minority this app doesn't otherwise represent).
    caa = caa[caa["scheduled_charter"] == "S"].copy()
    caa = caa[caa["number_flights_matched"] > 0].copy()
    # A real data-quality floor: cancelled can't exceed matched. Rare
    # (~dozens of rows/year) but real, and worth dropping rather than
    # silently producing a negative "not cancelled" count below.
    caa = caa[caa["number_flights_cancelled"] <= caa["number_flights_matched"]].copy()

    caa["month"] = caa["reporting_period"].astype(str).str.slice(4, 6).astype(int)
    caa["year"] = caa["reporting_period"].astype(str).str.slice(0, 4).astype(int)
    is_domestic = caa["origin_destination_country"].astype(str).str.upper() == "UNITED KINGDOM"
    caa["international"] = (~is_domestic).astype("int8")

    # Orient origin->dest by real reported direction rather than picking an
    # arbitrary side — 'D' means the reporting airport is the origin, 'A'
    # means it's the destination. Getting this backwards would silently
    # swap real route identities (a A->B route counted as B->A).
    is_departure = caa["arrival_departure"].astype(str).str.upper() == "D"
    caa["origin"] = "CAA:" + caa["reporting_airport"].where(is_departure, caa["origin_destination"]).astype(str)
    caa["dest"] = "CAA:" + caa["origin_destination"].where(is_departure, caa["reporting_airport"]).astype(str)
    caa["carrier"] = "CAA:" + caa["airline_name"].astype(str)

    # Real-month-anchored placeholder, sort-key only — see module docstring.
    caa["sched_dep"] = pd.to_datetime(
        caa["year"].astype(str) + "-" + caa["month"].astype(str).str.zfill(2) + "-15 12:00:00"
    )

    matched = caa["number_flights_matched"].astype(int)
    cancelled = caa["number_flights_cancelled"].astype(int)
    not_cancelled = matched - cancelled

    # Materialize the real aggregate counts into one row per real flight:
    # `cancelled` rows with cancelled=1, `not_cancelled` rows with
    # cancelled=0, each carrying this cell's real covariates. np.repeat on
    # the row index is the standard, leakage-free way to do this — every
    # resulting row is a real flight's real (partial) covariate set, not an
    # invented one.
    base_cols = ["country", "carrier", "tail_number", "flight_number", "origin", "dest",
                 "sched_dep", "day_of_week", "month", "year", "distance_km",
                 "sched_duration_min", "diverted", "international", "intraday_known"]

    caa = caa.assign(
        country="GB", tail_number=pd.NA, flight_number=pd.NA,
        day_of_week=pd.NA, distance_km=pd.NA, sched_duration_min=pd.NA,
        diverted=0, intraday_known=False,
    )

    pos_idx = caa.index.repeat(cancelled)
    neg_idx = caa.index.repeat(not_cancelled)
    pos = caa.loc[pos_idx, base_cols].assign(cancelled=1)
    neg = caa.loc[neg_idx, base_cols].assign(cancelled=0)
    out = pd.concat([pos, neg], ignore_index=True)
    return out


if __name__ == "__main__":
    df = load_uk_caa()
    out_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "uk_caa_normalized.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"wrote {len(df):,} real (expanded) rows -> {out_path}")
    print(f"real cancellation rate: {df['cancelled'].mean():.4%}")
    print(f"international share: {df['international'].mean():.4%}")
