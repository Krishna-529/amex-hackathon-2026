#!/usr/bin/env bash
# Real, no-auth, publicly published French flight-punctuality/cancellation
# data — AQST (Autorité de Qualité de Service dans les Transports), sourced
# from DGAC reporting, republished as a clean CSV mirror at data.cquest.org.
# ONE consolidated file (Oct 2018 - Sep 2019, real fixed historical window —
# same "real but time-boxed" shape as the BTS/ANAC/UK-CAA/BITRE yearly
# downloads), no per-month pagination needed.
#
# Real per-route/airline/month "vols programmés" (scheduled) and "vols
# annulés" (cancelled) counts — real ICAO airline/airport codes included
# (Code Cie / Code Aero Départ / Code Aero Destination), and real
# international routes (e.g. Abidjan-Paris), not just intra-France — the
# fifth real per-flight-expandable source (see ingest_aqst.py).
set -euo pipefail
cd "$(dirname "$0")/../data/raw"
mkdir -p aqst

out="aqst/aqst_avion_par_compagnie.csv"
if [ -s "$out" ]; then echo "skip $out (exists)"; exit 0; fi

url="http://data.cquest.org/aqst_ponctualite_transports/avion_par_compagnie.csv"
echo "fetching $url -> $out"
curl -sSL --retry 3 --retry-delay 5 --max-time 120 -o "$out" "$url"
echo "downloaded $(wc -l < "$out") real rows"
