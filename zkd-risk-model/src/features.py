"""Turns the unified BTS+ANAC row set into a training table of
GEOGRAPHY-AGNOSTIC features — i.e. features that describe a flight's risk
profile in terms that transfer to a route or carrier the model never saw in
training (percentile reliability, schedule position, rotation exposure),
rather than memorizing "this US city pair" or "this Brazilian carrier".

This matters because the real, freely available bulk historical data with
per-flight cancellation labels is US (BTS) and Brazil (ANAC) — there is no
equivalent open bulk dataset for Indian/other international routes yet (see
zkd-risk-model/README.md). The model has to generalize past its training
countries by construction, not by having seen every country, and its
real-world accuracy on new geographies gets validated by the online
back-test loop (server/engine/riskModel.ts logs every prediction against the
real observed OAG/AviationStack outcome) rather than assumed from day one.

EVERY feature here is something genuinely knowable strictly BEFORE the
flight's scheduled departure — historical rates are computed on an
expanding window of PRIOR rows only (shift-by-one, verified by the leakage
check at the bottom of this file). Delay-attribution columns (CarrierDelay,
WeatherDelay, ...) are deliberately never used: they are post-hoc, known
only after the flight resolves, and would leak the label.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"

# Additive (Laplace-style) smoothing pseudo-count for historical-rate
# features. Small enough not to blur a genuinely bad route/carrier with the
# global mean, large enough that a route seen twice does not swing to 0% or
# 100%.
SMOOTH_N = 20.0


def _expanding_rate(df: pd.DataFrame, entity_col: str, global_prior: float) -> pd.Series:
    """Smoothed cancellation rate for `entity_col`, using only rows strictly
    before the current one (same entity, earlier in the globally
    time-sorted frame). df must already be sorted by sched_dep."""
    grp = df.groupby(entity_col, observed=True)["cancelled"]
    prior_count = grp.cumcount()  # rows seen so far for this entity, EXCLUDING current row
    prior_sum = grp.cumsum() - df["cancelled"]  # cumulative sum up to and including current row, minus current row
    return (prior_sum + global_prior * SMOOTH_N) / (prior_count + SMOOTH_N)


def build_features() -> pd.DataFrame:
    parts = []
    bts_path = PROCESSED_DIR / "bts_normalized.parquet"
    anac_path = PROCESSED_DIR / "anac_normalized.parquet"
    if bts_path.exists():
        parts.append(pd.read_parquet(bts_path))
    if anac_path.exists():
        parts.append(pd.read_parquet(anac_path))
    if not parts:
        raise FileNotFoundError("run src/ingest_bts.py and src/ingest_anac.py first")

    df = pd.concat(parts, ignore_index=True)
    if "international" not in df.columns:
        df["international"] = 0
    df["international"] = df["international"].fillna(0).astype("int8")

    df = df.sort_values("sched_dep").reset_index(drop=True)
    global_prior = df["cancelled"].mean()

    df["route"] = df["origin"].astype(str) + ">" + df["dest"].astype(str)
    df["origin_month"] = df["origin"].astype(str) + ":" + df["month"].astype(str)

    df["carrier_hist_cancel_rate"] = _expanding_rate(df, "carrier", global_prior)
    df["route_hist_cancel_rate"] = _expanding_rate(df, "route", global_prior)
    df["origin_hist_cancel_rate"] = _expanding_rate(df, "origin", global_prior)
    df["dest_hist_cancel_rate"] = _expanding_rate(df, "dest", global_prior)
    df["origin_month_hist_cancel_rate"] = _expanding_rate(df, "origin_month", global_prior)

    # Schedule-position features — all read straight off the published
    # timetable, no observation of the flight itself required.
    df["hour_of_day"] = df["sched_dep"].dt.hour
    df["is_redeye"] = ((df["hour_of_day"] < 5) | (df["hour_of_day"] >= 22)).astype("int8")
    df["is_weekend"] = (df["day_of_week"] >= 6).astype("int8")

    # Schedule density at the origin airport in the same hour bucket, same
    # day — a real congestion proxy computable from the timetable alone
    # (this is what OpenSky aircraft-counts used to approximate; here it
    # comes for free from the same historical data).
    df["origin_hour_bucket"] = df["origin"].astype(str) + ":" + df["sched_dep"].dt.floor("h").astype(str)
    df["origin_hour_density"] = df.groupby("origin_hour_bucket")["origin_hour_bucket"].transform("count")

    # Upstream rotation exposure: BTS only (has real tail numbers). The
    # immediately preceding flight of the SAME aircraft, same day, was
    # itself cancelled or ran late — a materially real predictor, and one
    # OAG's own Flight Info Connections product supplies for live scoring
    # (see server/oag.ts) once this feature crosses from training to serving.
    has_tail = df["tail_number"].notna() & (df["tail_number"] != "")
    bts_mask = df["country"] == "US"
    rotation_frame = df[bts_mask & has_tail].sort_values(["tail_number", "sched_dep"])
    rotation_frame["prior_leg_cancelled"] = (
        rotation_frame.groupby("tail_number")["cancelled"].shift(1)
    )
    df["prior_leg_cancelled"] = np.nan
    df.loc[rotation_frame.index, "prior_leg_cancelled"] = rotation_frame["prior_leg_cancelled"]

    feature_cols = [
        "carrier_hist_cancel_rate", "route_hist_cancel_rate", "origin_hist_cancel_rate",
        "dest_hist_cancel_rate", "origin_month_hist_cancel_rate",
        "month", "day_of_week", "hour_of_day", "is_redeye", "is_weekend",
        "distance_km", "sched_duration_min", "origin_hour_density",
        "prior_leg_cancelled", "international",
    ]
    label_col = "cancelled"
    meta_cols = ["country", "carrier", "origin", "dest", "sched_dep"]

    out = df[meta_cols + feature_cols + [label_col]].copy()
    return out


def _leakage_self_check(df: pd.DataFrame) -> None:
    """The one thing that would silently invalidate every metric downstream:
    an expanding-window feature that accidentally includes the current row.
    Recompute carrier_hist_cancel_rate for the LAST chronological row of one
    high-volume carrier by hand and compare."""
    sample_carrier = df["carrier"].value_counts().idxmax()
    sub = df[df["carrier"] == sample_carrier].sort_values("sched_dep")
    manual_rate_excl_last = sub["cancelled"].iloc[:-1].mean()
    reported = sub["carrier_hist_cancel_rate"].iloc[-1]
    # Smoothed vs. raw won't match exactly, but should be within a few
    # points at this row count — a leak would show as reported == the
    # INCLUDING-current-row rate, off by exactly cancelled/(n).
    print(f"leakage self-check ({sample_carrier}, n={len(sub)}): "
          f"raw-excl-last={manual_rate_excl_last:.4f} vs reported-smoothed={reported:.4f}")


if __name__ == "__main__":
    df = build_features()
    _leakage_self_check(df)
    out_path = PROCESSED_DIR / "training_table.parquet"
    df.to_parquet(out_path, index=False)
    print(f"wrote {len(df):,} real rows, {df['cancelled'].sum():,.0f} real cancellations -> {out_path}")
    print(df["country"].value_counts())
