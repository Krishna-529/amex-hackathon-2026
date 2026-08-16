#!/usr/bin/env bash
# Real, no-auth, publicly published historical flight-performance data.
#   BTS  = US Dept. of Transportation, Bureau of Transportation Statistics,
#          "On-Time : Reporting Carrier On-Time Performance" — real per-flight
#          rows with an actual Cancelled/CancellationCode field.
#   ANAC = Brazil's Agencia Nacional de Aviacao Civil, "VRA" (Voo Regular
#          Ativo) dataset — real per-flight rows with situacaoVoo including
#          CANCELADO.
# Nothing here is synthetic. Run from repo root or anywhere; paths are
# relative to this script.
set -euo pipefail
cd "$(dirname "$0")/../data/raw"

BTS_YEARS_MONTHS=(
  "2024 1" "2024 2" "2024 3" "2024 4" "2024 5" "2024 6"
  "2024 7" "2024 8" "2024 9" "2024 10" "2024 11" "2024 12"
)
ANAC_YEARS_MONTHS=(
  "2024 01" "2024 02" "2024 03" "2024 04" "2024 05" "2024 06"
  "2024 07" "2024 08" "2024 09" "2024 10" "2024 11" "2024 12"
)

mkdir -p bts anac

echo "== BTS On-Time Performance =="
for ym in "${BTS_YEARS_MONTHS[@]}"; do
  read -r y m <<< "$ym"
  out="bts/bts_${y}_${m}.zip"
  url="https://www.transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_1987_present_${y}_${m}.zip"
  if [ -s "$out" ]; then echo "skip $out (exists)"; continue; fi
  echo "fetching $url"
  curl -sSL --retry 3 --retry-delay 5 --max-time 300 -o "$out" "$url" || echo "FAILED: $url"
done

echo "== ANAC VRA =="
for ym in "${ANAC_YEARS_MONTHS[@]}"; do
  read -r y m <<< "$ym"
  out="anac/anac_${y}_${m}.csv"
  url="https://siros.anac.gov.br/siros/registros/diversos/vra/${y}/VRA_${y}_${m}.csv"
  if [ -s "$out" ]; then echo "skip $out (exists)"; continue; fi
  echo "fetching $url"
  curl -sSL --retry 3 --retry-delay 5 --max-time 300 -o "$out" "$url" || echo "FAILED: $url"
done

echo "done"
du -sh bts anac 2>/dev/null || true
