#!/usr/bin/env bash
# Real, no-auth, publicly published UK flight-punctuality data.
#   UK CAA "Punctuality Statistics — Full Analysis Arrival Departure" — real
#   monthly counts per (reporting airport, route, airline, arrival/departure
#   direction): number_flights_matched, number_flights_cancelled. This is
#   the third real geography in the training set (BTS=US, ANAC=BR, this=UK/
#   European routes — many origin_destination_country values are non-UK,
#   e.g. Poland, Spain, per the CAA reporting every route touching a UK
#   airport, domestic and international alike).
#
# Unlike BTS/ANAC, this is NOT per-flight — it's a monthly aggregate count.
# ingest_uk_caa.py expands each (matched, cancelled) pair into that many real
# individual training rows (frequency expansion of a real binomial count,
# not fabrication — see that file's own header for the honest limits this
# implies: no real intraday timestamp survives the aggregation, so
# hour_of_day/day_of_week/distance_km are left NaN for these rows, not
# guessed).
#
# The CAA's site serves these through an internal document-ID system with no
# predictable per-month URL template (unlike BTS/ANAC's date-based URLs) —
# each ID below was resolved by parsing the real 2024 punctuality-statistics
# page (caa.co.uk/data-and-analysis/uk-aviation-market/flight-punctuality/
# uk-flight-punctuality-statistics/2024/) on 2026-08-17. If the CAA
# reorganizes that page, these IDs may need re-resolving the same way.
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
mkdir -p uk_caa

BASE="https://www.caa.co.uk/Documents/Download/12040/43d8c177-ce46-40bd-9b0a-ac45f3bdaaec"

# month -> real CAA document ID (2024 "Full Analysis Arrival Departure" CSV)
MONTH_IDS=(
  "01 1571" "02 1579" "03 1584" "04 1587" "05 1591" "06 1594"
  "07 1600" "08 1603" "09 1607" "10 1611" "11 1616" "12 1642"
)

echo "== UK CAA Punctuality Statistics (Full Analysis Arrival Departure, 2024) =="
for pair in "${MONTH_IDS[@]}"; do
  read -r m id <<< "$pair"
  out="uk_caa/uk_caa_2024_${m}.csv"
  if [ -s "$out" ]; then echo "skip $out (exists)"; continue; fi
  url="${BASE}/${id}"
  echo "fetching $url -> $out"
  curl -sSL --retry 3 --retry-delay 5 --max-time 120 -o "$out" "$url" || echo "FAILED: $url"
done
