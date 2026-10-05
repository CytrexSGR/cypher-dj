#!/bin/bash
# Scheibe 25: Master-Limiter an allen 128er-Fassungen des Bestands. Trim nach §1.5 (ziel_lufs −16 − lufs_integriert, auf
# ±24 begrenzt), EQ 0 und +6 dB. Eine Zeile JSON je Lauf nach <ausgabe>/limiter.jsonl; kein Ton, kein JACK, ein Kern.
# Aufruf: messe.sh [bestand] [ausgabe]
set -u
HIER=$(cd "$(dirname "$0")" && pwd)
BESTAND=${1:-$HIER/../../../../bestand}
AUS=${2:-$HIER/laeufe/$(date +%Y%m%d-%H%M%S)}
BAU=$HIER/../../build
mkdir -p "$AUS"
for j in "$BESTAND"/*/fassungen/128000_r1/fassung.json; do
  d=$(dirname "$j")
  trim=$(python3 -c "import json;l=json.load(open('$j'))['lautheit']['lufs_integriert'];print(max(-24,min(24,-16.0-l)))")
  for eq in 0 6; do
    nice -n 19 "$BAU/kern_limiter_fassung" "$d/basis.f32" "$trim" "$eq" /dev/null >> "$AUS/limiter.jsonl"
  done
done
python3 - "$AUS/limiter.jsonl" <<'PY'
import json, sys
z = [json.loads(l) for l in open(sys.argv[1])]
for eq in (0.0, 6.0):
    t = [x for x in z if x["eq_db"] == eq]
    print(f"EQ {eq:+.0f} dB: {len(t)} Fassungen, Kanal über 0 dBTP: {sum(x['kanal_dbtp'] > 0 for x in t)}, "
          f"Kanal höchstens {max(x['kanal_dbtp'] for x in t):.3f} dBTP, Master höchstens {max(x['master_dbtp'] for x in t):.3f} dBTP")
PY
