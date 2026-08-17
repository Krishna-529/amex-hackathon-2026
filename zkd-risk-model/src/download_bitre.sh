#!/usr/bin/env bash
# Real, no-auth, publicly published Australian domestic on-time-performance
# data — BITRE (Bureau of Infrastructure and Transport Research Economics),
# via data.gov.au. Unlike BTS/ANAC/UK-CAA/DGCA this is ONE consolidated file
# (real monthly rows already, Jan-2004 through the file's latest month) —
# no per-month pagination needed.
#
# Real per-route/airline/month Sectors_Scheduled and Cancellations counts
# (a genuine integer count, not a percentage) — the fourth real
# per-flight-expandable source alongside BTS/ANAC/UK-CAA (see
# ingest_bitre.py). Real, distinct Oceania/Asia-Pacific carriers (Qantas,
# Jetstar, Virgin Australia, Rex) and airport set — domestic Australian
# routes only, verified by inspecting the real port-name list (see
# ingest_bitre.py's header for the honest limit that implies).
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
mkdir -p bitre

out="bitre/bitre_otp_time_series.csv"
if [ -s "$out" ]; then echo "skip $out (exists)"; exit 0; fi

url="https://data.gov.au/data/dataset/29128ebd-dbaa-4ff5-8b86-d9f30de56452/resource/cf663ed1-0c5e-497f-aea9-e74bfda9cf44/download/otp_time_series_web.csv"
echo "fetching $url -> $out"
curl -sSL --retry 3 --retry-delay 5 --max-time 120 -o "$out" "$url"
echo "downloaded $(wc -l < "$out") real rows"
