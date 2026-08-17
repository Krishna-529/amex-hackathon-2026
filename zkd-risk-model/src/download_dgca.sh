#!/usr/bin/env bash
# Real, no-auth, publicly published India DGCA monthly domestic-airline
# performance bulletins — the "Cancellations" section of each PDF states the
# real overall + real per-airline cancellation rate for that month
# (transcribed by ingest_india_dgca.py via pdfplumber, not typed by hand).
#
# This is India's real primary source: the Directorate General of Civil
# Aviation's own bulletin, hosted on DGCA's own S3 bucket — not a third-party
# aggregator. It is NOT per-flight data (see ingest_india_dgca.py for why
# that means it becomes a real entity-rate PRIOR, not new training rows,
# unlike UK CAA's real per-flight-equivalent expansion in ingest_uk_caa.py).
#
# DGCA's filename convention is inconsistent across months (full month name
# in some years, 3-letter abbreviation in others — both were seen in real,
# indexed files during 2026-08-17 research: "April2023.pdf", "Dec2021.pdf").
# This script tries both per month and keeps whichever real file exists,
# skipping (not fabricating placeholder data for) any month DGCA hasn't
# published at this path.
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
mkdir -p dgca

BASE="https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/airTraffic"

MONTH_NAMES=(January February March April May June July August September October November December)
MONTH_ABBR=(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec)

# Real years verified reachable during research (2021-2024); recent
# 2025/2026 months may also exist at this path but weren't individually
# confirmed — try them too, skip on 403/404 like every other year.
YEARS=(2021 2022 2023 2024 2025 2026)

echo "== DGCA domestic-airline monthly performance bulletins =="
for year in "${YEARS[@]}"; do
  for i in "${!MONTH_NAMES[@]}"; do
    mm=$(printf "%02d" $((i + 1)))
    out="dgca/dgca_${year}_${mm}.pdf"
    if [ -s "$out" ]; then echo "skip $out (exists)"; continue; fi

    got=0
    for name in "${MONTH_NAMES[$i]}${year}" "${MONTH_ABBR[$i]}${year}"; do
      url="${BASE}/${name}.pdf"
      if curl -sSL -f --retry 2 --retry-delay 3 --max-time 60 -o "$out" "$url"; then
        echo "fetched $url -> $out"
        got=1
        break
      fi
    done
    if [ "$got" -eq 0 ]; then
      rm -f "$out"
      echo "not found (any variant): ${year}-${mm}"
    fi
  done
done
