"""Generates data/synthetic/india_carrier_monthly.csv — synthetic
carrier x origin x dest x month flight/cancellation counts for Indian
aviation, standing in for the real bulk historical dataset that does not
exist yet (see zkd-risk-model/README.md "Known gaps": BTS/ANAC are the only
free bulk sources with real per-flight cancellation labels, and neither
covers India).

Every row is FABRICATED — there is no real per-flight record behind any
count in this file. It exists so LIVE:-namespaced entities (any Indian
carrier/airport/route — see server/engine/riskModel.ts) have SOMETHING
better than a flat population-average cold-start while the real thing (this
app's own AviationStack/OAG-observed outcomes, accumulated over time, per
documentation/design/01-prediction-model.md's back-test loop) is still thin.
src/ingest_india_synthetic.py turns this into rate tables that are served
and consumed under a clearly separate 'synthetic-market-estimate' label —
never merged into the real entity_rates.json, never presented as 'real'.

The rates below are not invented from nothing: they follow well-documented,
public directional patterns —
  - SpiceJet's cancellation/reliability troubles have been widely reported
    (DGCA show-cause notices, grounded fleet, financial distress through
    2023-2025) relative to IndiGo's much higher schedule reliability and
    Akasa's young fleet.
  - Northwest India (Delhi) winter fog (Dec-Jan) is a well-known, recurring
    cause of mass delays/cancellations (CAT III-only ops at many carriers).
  - Southwest monsoon (Jun-Sep) disrupts the west coast (Mumbai, Goa) and
    northeast monsoon (Oct-Dec) disrupts the southeast coast (Chennai) —
    standard IMD seasonal patterns.
  - Kolkata sees both monsoon (Jun-Sep) and Bay-of-Bengal cyclone season
    (Oct-Nov) impact.
Magnitudes (the actual multiplier values) are illustrative judgment calls,
not sourced statistics — flagged as such everywhere this data surfaces.

Run: python data/synthetic/generate_india_synthetic.py
"""
from __future__ import annotations

import csv
from pathlib import Path

OUT_PATH = Path(__file__).resolve().parent / "india_carrier_monthly.csv"

# code -> (name, base_annual_cancel_rate). Matches zkd-app/server/mockData/
# airlines.json's carrier list exactly, so a LIVE: key assembled from a
# seeded flight's real carrier code always has a row here.
DOMESTIC_CARRIERS = {
    "AI": ("Air India", 0.022),         # mixed legacy+new fleet, post-merger integration friction
    "6E": ("IndiGo", 0.011),            # largest, youngest domestic fleet, strong on-time reputation
    "UK": ("Vistara", 0.014),           # full-service, historically reliable, smaller fleet
    "SG": ("SpiceJet", 0.048),          # widely reported reliability/financial distress in this period
    "QP": ("Akasa Air", 0.010),         # newest fleet, least accumulated wear-driven disruption
    "I5": ("AirAsia India", 0.020),     # mid-size LCC
}
INTERNATIONAL_CARRIERS = {
    "BA": ("British Airways", 0.015),
    "EK": ("Emirates", 0.012),
    "LH": ("Lufthansa", 0.017),
    "SQ": ("Singapore Airlines", 0.010),
    "QR": ("Qatar Airways", 0.013),
    "AF": ("Air France", 0.018),
}

# IATA -> monthly multiplier (1.0 = no seasonal effect), 12 values Jan..Dec.
# Airports not listed default to a flat 1.0 all year (no distinguishing
# seasonal weather pattern modeled).
AIRPORT_SEASONAL = {
    # Delhi: winter fog is the dominant driver; light monsoon bump.
    "DEL": [2.0, 1.5, 1.0, 1.0, 1.0, 1.05, 1.1, 1.1, 1.0, 1.0, 1.2, 1.9],
    # Mumbai: southwest monsoon Jun-Sep (flooding, low-visibility ops).
    "BOM": [1.0, 1.0, 1.0, 1.0, 1.1, 1.6, 1.7, 1.6, 1.4, 1.05, 1.0, 1.0],
    # Goa: same monsoon system as Mumbai, slightly sharper coastal impact.
    "GOI": [1.0, 1.0, 1.0, 1.0, 1.1, 1.65, 1.75, 1.7, 1.45, 1.05, 1.0, 1.0],
    # Kolkata: monsoon Jun-Sep, Bay of Bengal cyclone season Oct-Nov.
    "CCU": [1.0, 1.0, 1.0, 1.0, 1.05, 1.4, 1.45, 1.4, 1.3, 1.35, 1.3, 1.05],
    # Chennai: northeast monsoon Oct-Dec is the dominant local pattern.
    "MAA": [1.05, 1.0, 1.0, 1.0, 1.0, 1.05, 1.05, 1.05, 1.15, 1.5, 1.55, 1.4],
    # Bangalore: mild year-round climate, only a small monsoon bump.
    "BLR": [1.0, 1.0, 1.0, 1.0, 1.0, 1.15, 1.15, 1.15, 1.1, 1.0, 1.0, 1.0],
    # Hyderabad: mild, small monsoon bump, similar profile to Bangalore.
    "HYD": [1.0, 1.0, 1.0, 1.0, 1.05, 1.15, 1.15, 1.15, 1.05, 1.0, 1.0, 1.0],
    # London Heathrow: winter snow/low-visibility ops Dec-Feb.
    "LHR": [1.25, 1.2, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.3],
}

# Domestic routes actually used by the app's seeded flights (server/domain/
# seed.ts) plus their reverse direction and a handful of other real trunk
# routes between the same airports, so the table generalizes past exactly
# the seeded set. (origin, dest, typical monthly frequency per carrier)
DOMESTIC_ROUTES = [
    ("MAA", "DEL", 60), ("DEL", "MAA", 60),
    ("BOM", "DEL", 90), ("DEL", "BOM", 90),
    ("DEL", "BLR", 70), ("BLR", "DEL", 70),
    ("BLR", "MAA", 45), ("MAA", "BLR", 45),
    ("BOM", "GOI", 40), ("GOI", "BOM", 40),
    ("DEL", "CCU", 35), ("CCU", "DEL", 35),
    ("DEL", "HYD", 40), ("HYD", "DEL", 40),
    ("BOM", "BLR", 55), ("BLR", "BOM", 55),
    ("MAA", "GOI", 20), ("GOI", "MAA", 20),
]
INTERNATIONAL_ROUTES = [("DEL", "LHR", 14), ("LHR", "DEL", 14)]


def _mulberry32(seed: int):
    """Same tiny deterministic PRNG as zkd-app/server/suppliers/mockFlights.ts
    (mulberry32) — not because the algorithm matters here, but so a reviewer
    who already knows that generator recognizes this one immediately."""
    a = seed & 0xFFFFFFFF

    def next_():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (1 | t)) & 0xFFFFFFFF
        t = (t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return next_


def _hash(s: str) -> int:
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def generate() -> list[dict]:
    rows: list[dict] = []

    def add_rows(carriers: dict, routes: list[tuple[str, str, int]]):
        for code, (_name, base_rate) in carriers.items():
            for origin, dest, monthly_freq in routes:
                for month in range(1, 13):
                    origin_mult = AIRPORT_SEASONAL.get(origin, [1.0] * 12)[month - 1]
                    dest_mult = AIRPORT_SEASONAL.get(dest, [1.0] * 12)[month - 1]
                    # Weather affects the WORSE end of the trip slightly more
                    # (departure-station ops are the more common bottleneck).
                    seasonal_mult = 0.6 * origin_mult + 0.4 * dest_mult

                    rng = _mulberry32(_hash(f"{code}:{origin}:{dest}:{month}"))
                    jitter = 0.85 + rng() * 0.3  # +/-15% month-to-month noise, deterministic
                    rate = min(0.35, base_rate * seasonal_mult * jitter)

                    scheduled = max(1, round(monthly_freq * (0.9 + rng() * 0.2)))
                    # Kept as a fraction, not rounded to an integer: these are
                    # already fabricated "expected" counts, and a low-volume
                    # route (e.g. the 14/month international ones) at a ~1%
                    # rate would round to 0 cancellations almost every month,
                    # systematically dragging the smoothed rate toward zero
                    # instead of toward the carrier's actual configured rate.
                    cancelled = round(scheduled * rate, 3)

                    rows.append({
                        "carrier": code, "origin": origin, "dest": dest, "month": month,
                        "scheduled_flights": scheduled, "cancelled_flights": cancelled,
                    })

    add_rows(DOMESTIC_CARRIERS, DOMESTIC_ROUTES)
    add_rows(INTERNATIONAL_CARRIERS, INTERNATIONAL_ROUTES)
    return rows


if __name__ == "__main__":
    rows = generate()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["carrier", "origin", "dest", "month", "scheduled_flights", "cancelled_flights"])
        writer.writeheader()
        writer.writerows(rows)
    total_sched = sum(r["scheduled_flights"] for r in rows)
    total_cancel = sum(r["cancelled_flights"] for r in rows)
    print(f"wrote {len(rows):,} synthetic rows ({total_sched:,} scheduled, {total_cancel:,} cancelled, "
          f"{total_cancel / total_sched:.2%} blended rate) -> {OUT_PATH}")
