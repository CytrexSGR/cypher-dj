#!/usr/bin/env bash
# Scheibe 08, Abnahme „Am Ziel“: Prüfklick in einer Rampe 128 -> 132 über 32 Beats an eigener Null-Senke
# (SCHNITTSTELLEN.md §19.5, ROADMAP §8.4, §8.5). Senke, Notbahn, Kern mit Prüfmodus, Prüfer, JACK-Aufnehmer am Monitor
# der Senke, Auswertung gegen karte.py. Aufruf: klick_rampe_lauf.sh <kern-programm> <ausgabe-ordner> <lauf-name>
# Braucht CYPHERDJ_INSTANZ (Strang A: a). Hält das Echtzeit-Schloss für den ganzen Lauf (SCHLOSS=0 nur für Proben ohne
# Zeitmessung, steht dann im Bericht).
# Rückgabe: die der Auswertung (0 grün, 1 rot, 2 Instrument unbrauchbar: Lauf wiederholen), 3 kein Schloss, 4 Senke.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
KERN=$1; AUS=$2; NAME=$3
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang A: export CYPHERDJ_INSTANZ=a}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
SENKE=cypherdj-pruef-$CYPHERDJ_INSTANZ-$NAME
O=$AUS/$NAME
mkdir -p "$O"
rm -f "$O"/*.bereit
SCHLOSS_STAND=${CYPHERDJ_SCHLOSS:-${SCHLOSS:-1}}  # gehalten: der Aufrufer hält es (abnahme.sh); 0: nur Proben
if [ "$SCHLOSS_STAND" = 1 ]; then
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  flock -w 3600 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
fremdlast() { echo "uptime_$1=$(uptime)"; echo "gpu_$1=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>&1)"; }
{ echo "lauf=$NAME kern=$KERN senke=$SENKE instanz=$CYPHERDJ_INSTANZ schloss=$SCHLOSS_STAND start=$(date -Is)"
  fremdlast vorher; } > "$O/meta.txt"
KP=""; NB=""; AP=""; PP=""
aufraeumen() {
  for p in $PP $AP; do kill "$p" 2>/dev/null; done
  [ -n "$KP" ] && kill -TERM "$KP" 2>/dev/null && wait "$KP" 2>/dev/null
  [ -n "$NB" ] && kill -TERM "$NB" 2>/dev/null && wait "$NB" 2>/dev/null
  "$DJK/pruefstand/senke/senke_ab.sh" "$SENKE" >> "$O/meta.txt" 2>&1
}
trap aufraeumen EXIT
"$DJK/pruefstand/senke/senke_an.sh" "$SENKE" > "$O/senke.modid" || exit 4
pw-jack -p 256 "$DJK/notbahn/build/cypherdj-notbahn" --master "$SENKE:playback_F" 2> "$O/notbahn.err" & NB=$!
. "$HIER/graph.sh"
notbahn_verbinden "$O/meta.txt" || { echo "Notbahn nach 5 s nicht an $SENKE" >&2; exit 4; }
pw-jack -p 256 "$KERN" --konfig "$DJK/konfig/kern.toml" --pruefmodus 2> "$O/kern.err" & KP=$!
sleep 1
python3 "$HIER/pruefer_rampe.py" --log "$O/pruefer.jsonl" --bereit "$O/pruefer.bereit" \
  --aufnahme-bereit "$O/aufnahme.bereit" > "$O/pruefer.out" 2>&1 & PP=$!
for _ in $(seq 1 100); do [ -f "$O/pruefer.bereit" ] && break; sleep 0.1; done
pw-jack -p 256 "$DJK/pruefstand/aufnehmer/build/cypherdj-aufnehmer" --quelle "$SENKE:monitor_F" \
  --datei "$O/aufnahme.wav" --sekunden 32 --bereit "$O/aufnahme.bereit" 2> "$O/aufnehmer.err" & AP=$!
sleep 2
graph_festhalten "$O/meta.txt" kern notbahn aufnehmer
wait "$PP"; PR=$?; PP=""
wait "$AP"; AP=""
fremdlast nachher >> "$O/meta.txt"
echo "ende=$(date -Is) pruefer=$PR" >> "$O/meta.txt"
python3 "$HIER/auswertung_rampe.py" --wav "$O/aufnahme.wav" --pruefer "$O/pruefer.jsonl" --meta "$O/meta.txt" \
  > "$O/ergebnis.json"
AR=$?
python3 -c "import json;e=json.load(open('$O/ergebnis.json'));print('$NAME', e['ergebnis'], 'Klicks', e.get('klicks'), 'in der Rampe', e.get('in_rampe_auf_versatz'), 'von', e.get('in_rampe_klicks'), 'auf Versatz', e.get('versatz_samples'), 'Streuung', e.get('streuung_samples'), 'Quittungen', e.get('rampe_quittungen'))"
exit $AR
