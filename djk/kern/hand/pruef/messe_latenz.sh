#!/bin/sh
# Latenzprobe Softcontroller -> ALSA -> Midi-Bridge -> JACK-MIDI -> Hand-Bibliothek bei Quantum 256 (Scheibe 19,
# Vorlage 09 Probe c). Stumm: nur MIDI-Ports, kein Audio. Immer unter der Echtzeit-Sperre aufrufen:
#   flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" sh messe_latenz.sh <hand_pruef> <softcontroller> <mapping> <ordner> [N] [gruen|blockgrenze]
# Schreibt <ordner>/senden.jsonl, empfang.jsonl, ergebnis.json (reines JSON), urteil.txt, last_vorher.txt,
# last_nachher.txt; letzte Zeile GRUEN oder ROT (auswertung.py), Rückgabe 0 bei GRUEN.
set -eu
PRUEF=$1
SOFT=$2
MAP=$3
AUS=$4
N=${5:-300}
ERW=${6:-gruen}
HIER=$(cd "$(dirname "$0")" && pwd)
export CYPHERDJ_INSTANZ="${CYPHERDJ_INSTANZ:-b}"
mkdir -p "$AUS"
last() { date -Is; uptime; nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "nvidia-smi fehlt"; }
last > "$AUS/last_vorher.txt"
SEK=$((N * 50 / 1000 + 10))
pw-jack -p 256 "$PRUEF" --mapping "$MAP" --quelle "cypherdj-softcontroller-$CYPHERDJ_INSTANZ:hand" \
  --sekunden "$SEK" --anzahl "$N" --log "$AUS/empfang.jsonl" > "$AUS/pruef.out" 2>&1 &
P=$!
"$SOFT" --mess "$N" --vorlauf-ms 2000 --log "$AUS/senden.jsonl" 2> "$AUS/soft.err"
wait "$P"
last > "$AUS/last_nachher.txt"
RC=0
python3 "$HIER/auswertung.py" "$AUS/senden.jsonl" "$AUS/empfang.jsonl" --erwarte "$ERW" > "$AUS/ergebnis.json" 2> "$AUS/urteil.txt" || RC=$?
cat "$AUS/urteil.txt"
exit "$RC"
