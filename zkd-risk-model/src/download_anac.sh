#!/usr/bin/env bash
# Runs in parallel with download_data.sh's BTS loop (real, no-auth ANAC VRA data).
set -euo pipefail
cd "$(dirname "$0")/../data/raw/anac"

for m in 01 02 03 04 05 06 07 08 09 10 11 12; do
  out="anac_2024_${m}.csv"
  url="https://siros.anac.gov.br/siros/registros/diversos/vra/2024/VRA_2024_${m}.csv"
  if [ -s "$out" ]; then echo "skip $out (exists)"; continue; fi
  echo "fetching $url"
  curl -sSL --retry 3 --retry-delay 5 --max-time 300 -o "$out" "$url" || echo "FAILED: $url"
done
echo "anac done"
