"""Normalize the real French AQST (Autorité de Qualité de Service dans les
Transports, sourced from DGAC reporting) flight-punctuality CSV into the
same unified schema as ingest_bts.py / ingest_anac.py / ingest_uk_caa.py /
ingest_bitre.py.

Same real-aggregate-count shape as ingest_uk_caa.py/ingest_bitre.py: a real
monthly count per (route, airline) — "vols programmés" (scheduled) and
"vols annulés" (cancelled) are genuine integer counts, not a percentage —
expanded into that many individual real training rows. Same honest cost:
no real per-flight timestamp survives the aggregation, so
`intraday_known=False` (features.py masks hour_of_day/day_of_week/
origin_hour_density to NaN for these rows, same as every other
aggregate-expanded source).

Real ICAO carrier/airport codes are published directly ("Code Cie", "Code
Aero Départ", "Code Aero Destination") — cleaner identity keys than
UK CAA's/BITRE's plain names, and real genuinely-international routes are
present (e.g. Abidjan-Paris), not just intra-France pairs — this is the
first source in the pipeline where a France-origin flight and a real
cross-border route both appear in the SAME file.

`Service` classification (verified real values: "Intérieur" = mainland
domestic, "International", "Outre-mer" = flights to overseas French
territories e.g. Paris-Réunion): "Intérieur" -> international=0,
everything else -> international=1. "Outre-mer" is a judgment call, stated
here rather than hidden — legally domestic (French territory), but
geographically and operationally a long-haul route, closer in kind to the
other real international rows in this file than to a short mainland hop.

Columns verified 2026-08-17 against a real downloaded file's header
(UTF-8, French column names retained exactly as published).

Run: python src/ingest_aqst.py
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

RAW_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "aqst" / "aqst_avion_par_compagnie.csv"

COL_SCHEDULED = "Nbre mensuel de vols programmés par la Cie sur la relation"
COL_CANCELLED = "Nbre mensuel de vols annulés par la Cie sur la relation"


def load_aqst() -> pd.DataFrame:
    if not RAW_PATH.exists():
        raise FileNotFoundError(f"{RAW_PATH} not found — run src/download_aqst.sh first")

    df = pd.read_csv(RAW_PATH, encoding="utf-8")
    print(f"loaded {RAW_PATH}: {len(df):,} real aggregate rows")

    df = df[df["Mode"] == "Avion"].copy()
    df = df[df[COL_SCHEDULED] > 0].copy()
    df = df[df[COL_CANCELLED] <= df[COL_SCHEDULED]].copy()

    df["country"] = "FR"
    df["carrier"] = "AQST:" + df["Code Cie"].astype(str)
    df["origin"] = "AQST:" + df["Code Aero Départ"].astype(str)
    df["dest"] = "AQST:" + df["Code Aero Destination"].astype(str)
    df["month"] = df["Mois"].astype(int)
    df["year"] = df["Année"].astype(int)
    df["international"] = (df["Service"] != "Intérieur").astype("int8")

    df["sched_dep"] = pd.to_datetime(
        df["year"].astype(str) + "-" + df["month"].astype(str).str.zfill(2) + "-15 12:00:00"
    )

    matched = df[COL_SCHEDULED].astype(int)
    cancelled = df[COL_CANCELLED].astype(int)
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
    df = load_aqst()
    out_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "aqst_normalized.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"wrote {len(df):,} real (expanded) rows -> {out_path}")
    print(f"real cancellation rate: {df['cancelled'].mean():.4%}")
    print(f"international share: {df['international'].mean():.4%}")
