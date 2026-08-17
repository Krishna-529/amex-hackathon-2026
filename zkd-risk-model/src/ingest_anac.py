"""Normalize real Brazil ANAC VRA (Voo Regular Ativo) monthly files into the
same unified schema as ingest_bts.py.

Columns verified 2026-08-14 against anac_2024_01.csv's real header (semicolon
delimited, UTF-8, dd/mm/yyyy HH:MM timestamps). Notably this dataset already
carries real INTERNATIONAL flights (Sigla ICAO Aeroporto Origem/Destino
includes non-Brazilian ICAO codes like KMIA — Miami — for a Rio-Miami
American Airlines pair), which is why it is the second real training source
rather than a second domestic-only one: it is genuine evidence the feature
set has to generalize past a single country's route network.
"""
from __future__ import annotations

import glob
from pathlib import Path

import pandas as pd

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "anac"

COLUMNS = {
    "Sigla ICAO Empresa Aérea": "carrier_icao",
    "Número Voo": "flight_number",
    "Código Tipo Linha": "line_type",  # I=international, N=domestic(national), C=charter, G=general
    "Sigla ICAO Aeroporto Origem": "origin_icao",
    "Partida Prevista": "sched_dep_str",
    "Sigla ICAO Aeroporto Destino": "dest_icao",
    "Situação Voo": "status",
}


def load_anac() -> pd.DataFrame:
    files = sorted(glob.glob(str(RAW_DIR / "anac_*.csv")))
    if not files:
        raise FileNotFoundError(f"no ANAC files in {RAW_DIR} — run src/download_anac.sh first")

    frames = []
    for path in files:
        df = pd.read_csv(
            path, sep=";", usecols=list(COLUMNS.keys()), encoding="utf-8",
            dtype=str, on_bad_lines="skip",
        )
        df = df.rename(columns=COLUMNS)
        frames.append(df)
        print(f"loaded {path}: {len(df):,} real rows")

    anac = pd.concat(frames, ignore_index=True)
    anac = anac[anac["status"].isin(["REALIZADO", "CANCELADO"])]  # drop the rare unresolved/other codes

    sched_dep = pd.to_datetime(anac["sched_dep_str"], format="%d/%m/%Y %H:%M", errors="coerce")

    out = pd.DataFrame({
        "country": "BR",
        "carrier": "ANAC:" + anac["carrier_icao"].fillna("UNKNOWN"),
        "tail_number": pd.NA,  # ANAC's VRA extract carries no aircraft registration — no rotation feature from this source
        "flight_number": anac["flight_number"],
        "origin": "ANAC:" + anac["origin_icao"].fillna("UNKNOWN"),
        "dest": "ANAC:" + anac["dest_icao"].fillna("UNKNOWN"),
        "sched_dep": sched_dep,
        "day_of_week": sched_dep.dt.dayofweek + 1,  # align to BTS's 1=Monday convention
        "month": sched_dep.dt.month,
        "year": sched_dep.dt.year,
        "distance_km": pd.NA,  # not published per-flight; left for the model to learn without it
        "sched_duration_min": pd.NA,
        "cancelled": (anac["status"] == "CANCELADO").astype("int8"),
        "diverted": 0,
        "international": (anac["line_type"] == "I").astype("int8"),
    })
    out = out.dropna(subset=["sched_dep"])
    return out


if __name__ == "__main__":
    df = load_anac()
    out_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "anac_normalized.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"wrote {len(df):,} real rows -> {out_path}")
    print(f"real cancellation rate: {df['cancelled'].mean():.4%}")
    print(f"international share: {df['international'].mean():.4%}")
