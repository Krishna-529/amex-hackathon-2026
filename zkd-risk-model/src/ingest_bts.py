"""Normalize real US DOT/BTS On-Time Performance monthly files into one
unified schema shared with the ANAC (Brazil) loader, so features.py never
has to know which country a row came from.

Column names below are read directly off a downloaded file's real header
(verified 2026-08-14 against bts_2024_1.zip) — not guessed from memory of
the BTS schema, which drifts release to release.
"""
from __future__ import annotations

import glob
import zipfile
from pathlib import Path

import pandas as pd

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "bts"

USECOLS = [
    "FlightDate", "Reporting_Airline", "Tail_Number", "Flight_Number_Reporting_Airline",
    "Origin", "Dest", "CRSDepTime", "CRSArrTime", "DayOfWeek", "Month", "Year",
    "Cancelled", "CancellationCode", "Diverted", "CRSElapsedTime", "Distance",
]

DTYPES = {
    "Reporting_Airline": "category",
    "Tail_Number": "string",
    "Flight_Number_Reporting_Airline": "string",
    "Origin": "category",
    "Dest": "category",
    "CancellationCode": "category",
    "DayOfWeek": "int8",
    "Month": "int8",
    "Year": "int16",
    "Cancelled": "int8",
    "Diverted": "int8",
}


def _sched_time(date_str: str, hhmm) -> pd.Timestamp | None:
    """CRSDepTime/CRSArrTime is HMM/HHMM as a zero-padded 4-digit string, local
    time, sometimes '2400' for midnight. Real BTS quirk, not a parsing bug."""
    if pd.isna(hhmm):
        return None
    s = str(int(hhmm)).zfill(4)
    if s == "2400":
        s = "0000"
    try:
        return pd.Timestamp(f"{date_str} {s[:2]}:{s[2:]}")
    except ValueError:
        return None


def load_bts() -> pd.DataFrame:
    files = sorted(glob.glob(str(RAW_DIR / "bts_*.zip")))
    if not files:
        raise FileNotFoundError(f"no BTS files in {RAW_DIR} — run src/download_data.sh first")

    frames = []
    for zf_path in files:
        try:
            with zipfile.ZipFile(zf_path) as zf:
                csv_name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
                with zf.open(csv_name) as f:
                    df = pd.read_csv(
                        f, usecols=USECOLS, dtype=DTYPES, low_memory=False,
                    )
        except zipfile.BadZipFile:
            # Still mid-download (src/download_data.sh writes in place) — skip
            # rather than fail the whole run; re-run once it finishes.
            print(f"skipping {zf_path}: not a complete zip yet")
            continue
        frames.append(df)
        print(f"loaded {zf_path}: {len(df):,} real rows")

    bts = pd.concat(frames, ignore_index=True)

    out = pd.DataFrame({
        "country": "US",
        "carrier": "BTS:" + bts["Reporting_Airline"].astype(str),
        "tail_number": "BTS:" + bts["Tail_Number"].fillna("UNKNOWN").astype(str),
        "flight_number": bts["Flight_Number_Reporting_Airline"].astype(str),
        "origin": "BTS:" + bts["Origin"].astype(str),
        "dest": "BTS:" + bts["Dest"].astype(str),
        "sched_dep": [
            _sched_time(d, t) for d, t in zip(bts["FlightDate"], bts["CRSDepTime"])
        ],
        "day_of_week": bts["DayOfWeek"],
        "month": bts["Month"],
        "year": bts["Year"],
        "distance_km": bts["Distance"] * 1.60934,
        "sched_duration_min": bts["CRSElapsedTime"],
        "cancelled": bts["Cancelled"],
        "diverted": bts["Diverted"],
    })
    out = out.dropna(subset=["sched_dep"])
    return out


if __name__ == "__main__":
    df = load_bts()
    out_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "bts_normalized.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"wrote {len(df):,} real rows -> {out_path}")
    print(f"real cancellation rate: {df['cancelled'].mean():.4%}")
