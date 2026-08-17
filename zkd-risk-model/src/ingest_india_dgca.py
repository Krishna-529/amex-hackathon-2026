"""Extracts REAL per-airline India domestic cancellation rates from DGCA's
own monthly performance bulletins (data/raw/dgca/*.pdf, see
src/download_dgca.sh) and produces a real entity-rate table in the exact
`LIVE:<carrier code>` shape server/engine/riskModel.ts's assembleFeatures()
looks up — train.py merges this into models/entity_rates.json's `carrier`
dict, so a matched Indian carrier's dataSource becomes 'real', not
'synthetic-market-estimate' (see server/engine/riskModel.ts's tieredRate:
it already checks the real dict before falling back to
entity_rates_synthetic.json — this file just needs to genuinely populate
that real dict for India, nothing on the TS side changes).

Real per-flight India data does not publicly exist in bulk (see
zkd-risk-model/README.md's "Known gaps") — DGCA's bulletin publishes a real
PERCENTAGE per airline per month, not the underlying flight counts, so
unlike ingest_uk_caa.py this cannot become new per-flight training rows.
What it CAN honestly become: a real, government-sourced carrier-level prior,
replacing the fabricated one for any carrier DGCA actually reports (route/
origin/dest granularity isn't published, so those stay synthetic-only for
India — this file only ever writes to the `carrier` key).

Since no real per-airline flight-COUNT is published (only a rate), the
smoothing weight here is "how many real months of DGCA data we found for
this airline" rather than the flight-count weighting BTS/ANAC/UK CAA use —
an airline observed in more real bulletins is trusted closer to its own
average; one observed in only one or two months shrinks harder toward the
real DGCA-wide average across all airlines/months. This is a genuinely
different (weaker) evidence shape than a flight-count-weighted rate, and is
labeled as such in the output rather than presented as equally strong.

Run: python src/ingest_india_dgca.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "dgca"
OUT_PATH = ROOT / "models" / "dgca_carrier_rates.json"

SMOOTH_N_MONTHS = 6.0  # months of real observation treated as "as trustworthy as the prior"

# Real IATA codes for the airline names DGCA's bulletins have actually used
# (spelling varies month to month — both real spellings map to the same real
# code). An airline NOT in this table is skipped, not guessed — see module
# docstring on never fabricating a mapping.
AIRLINE_TO_IATA: dict[str, str] = {
    "AIR INDIA": "AI", "AIR INDIA LTD": "AI", "AIR INDIA LIMITED": "AI",
    "INDIGO": "6E", "INTERGLOBE AVIATION": "6E",
    "SPICEJET": "SG", "SPICE JET": "SG",
    "VISTARA": "UK", "TATA SIA AIRLINES": "UK",
    "GOFIRST": "G8", "GO FIRST": "G8", "GOAIR": "G8", "GO AIR": "G8",
    "AIRASIA INDIA": "I5", "AIR ASIA": "I5", "AIR ASIA INDIA": "I5",
    "ALLIANCE AIR": "9I",
    "STAR AIR": "S5",
    "FLYBIG": "FB", "FLY BIG": "FB",
    "AKASA AIR": "QP", "AKASAAIR": "QP",
    "TRUJET": "2T",
}

OVERALL_RE = re.compile(
    r"overall cancellation rate of scheduled domestic airlines[^%]*?has been\s*([\d.]+)\s*%",
    re.IGNORECASE | re.DOTALL,
)
# One airline-name-then-rate line, e.g. "Air India 0.05". Names are letters/
# spaces/&/. only, deliberately excluding digits so this can't accidentally
# swallow the axis-label line ("0.00 10.00 20.00 ...").
LINE_RE = re.compile(r"^([A-Za-z][A-Za-z .&']{2,40}?)\s+(\d{1,3}\.\d{1,2})$")


def _extract_month_text(pdf_path: Path) -> str | None:
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "Cancellations" in text and "cancellation rate" in text.lower():
                return text
    return None


def parse_bulletin(pdf_path: Path) -> tuple[float | None, dict[str, float]]:
    """Returns (real overall rate pct or None, {real IATA code: real rate pct})."""
    text = _extract_month_text(pdf_path)
    if text is None:
        return None, {}

    normalized = re.sub(r"\s+", " ", text)
    overall_match = OVERALL_RE.search(normalized)
    overall = float(overall_match.group(1)) if overall_match else None

    rates: dict[str, float] = {}
    for line in text.splitlines():
        m = LINE_RE.match(line.strip())
        if not m:
            continue
        name, pct = m.group(1).strip().upper(), float(m.group(2))
        code = AIRLINE_TO_IATA.get(name)
        if code is None:
            continue  # unknown spelling — real number, but no verified real code to attach it to
        rates[code] = pct
    return overall, rates


def build() -> dict:
    files = sorted(RAW_DIR.glob("dgca_*.pdf"))
    if not files:
        raise FileNotFoundError(f"no DGCA bulletins in {RAW_DIR} — run src/download_dgca.sh first")

    per_carrier: dict[str, list[float]] = defaultdict(list)
    overall_rates: list[float] = []
    months_parsed = 0

    for path in files:
        overall, rates = parse_bulletin(path)
        if overall is None and not rates:
            print(f"skip {path.name}: no real 'Cancellations' section found")
            continue
        months_parsed += 1
        if overall is not None:
            overall_rates.append(overall)
        for code, pct in rates.items():
            per_carrier[code].append(pct)
        print(f"parsed {path.name}: overall={overall}, {len(rates)} real airline rates")

    if months_parsed == 0:
        raise RuntimeError("parsed zero real DGCA bulletins — check data/raw/dgca/*.pdf are real downloads, not error pages")

    global_prior_pct = sum(overall_rates) / len(overall_rates) if overall_rates else (
        sum(v for vs in per_carrier.values() for v in vs) / sum(len(vs) for vs in per_carrier.values())
    )

    carrier: dict[str, float] = {}
    for code, pcts in per_carrier.items():
        own_mean_pct = sum(pcts) / len(pcts)
        n_months = len(pcts)
        smoothed_pct = (own_mean_pct * n_months + global_prior_pct * SMOOTH_N_MONTHS) / (n_months + SMOOTH_N_MONTHS)
        # LIVE: prefix matches exactly what riskModel.ts's assembleFeatures()
        # builds for a real Indian flight's carrier key.
        carrier[f"LIVE:{code}"] = round(smoothed_pct / 100.0, 6)

    return {
        "_comment": (
            "REAL — sourced from DGCA's own monthly domestic-airline "
            "performance bulletins (data/raw/dgca/*.pdf), not fabricated. "
            "Weighted by MONTHS of real DGCA observation per airline "
            "(SMOOTH_N_MONTHS below), not by real flight count, because "
            "DGCA's public bulletin reports a rate, not the underlying "
            "flight counts — a materially weaker evidence shape than the "
            "flight-count-weighted BTS/ANAC/UK-CAA rates. See this file's "
            "own module docstring."
        ),
        "source": "real",
        "months_parsed": months_parsed,
        "smooth_n_months": SMOOTH_N_MONTHS,
        "global_prior": round(global_prior_pct / 100.0, 6),
        "as_of": datetime.now(timezone.utc).isoformat(),
        "carrier": carrier,
    }


if __name__ == "__main__":
    table = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(table, indent=2))
    print(
        f"wrote real DGCA carrier rates: {table['months_parsed']} real months parsed, "
        f"global_prior={table['global_prior']:.4%}, {len(table['carrier'])} real carriers -> {OUT_PATH}"
    )
