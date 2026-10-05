#!/usr/bin/env bash
# Scheibe 08: Lückenzähler des Kerns am Ziel gegen den JACK-Aufnehmer derselben Null-Senke (SCHNITTSTELLEN.md §5.4,
# §5.9; ARCHITEKTUR §7; ROADMAP §8.4, §8.5). Aufruf: luecken_lauf.sh <kern-programm> <ausgabe-ordner> <lauf-name>
#   <schlaege> <keine|einige> [--test-last-alle N --test-last-perioden F]
# Laufzeit = schlaege·60/128 + 6 s (Review 08 Punkt 7: der vierte Parameter ist die Zahl der Schläge, nicht Sekunden).
# Der Kern läuft mit --pruefmodus (künstliche Callback-Last, 10 K1b, nur im Prüfmodus). Der Lauscher ist der Prüfer
# der Scheibe 01 (Art ohne-klick): /k/set/neu setzt die Zähler auf den Generationsstart, danach zuhören.
# Braucht CYPHERDJ_INSTANZ (Strang A: a). Hält das Echtzeit-Schloss (SCHLOSS=0 nur für Proben, steht im Bericht).
# Rückgabe: die der Auswertung (0 grün, 1 rot, 2 unbrauchbar), 3 kein Schloss, 4 Senke.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
KERN=$1; AUS=$2; NAME=$3; SCHLAEGE=$4; ERW=$5; shift 5
SEK=$(( SCHLAEGE * 60 / 128 + 6 ))
ALLE=0; [ "${1:-}" = --test-last-alle ] && ALLE=$2
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
{ echo "lauf=$NAME kern=$KERN last=$* schlaege=$SCHLAEGE sekunden=$SEK erwarte=$ERW senke=$SENKE instanz=$CYPHERDJ_INSTANZ schloss=$SCHLOSS_STAND start=$(date -Is)"
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
pw-jack -p 256 "$KERN" --konfig "$DJK/konfig/kern.toml" --pruefmodus "$@" 2> "$O/kern.err" & KP=$!
sleep 2  # Graph aufbauen lassen: die Treiberwechsel beim Verbinden liegen vor /k/set/neu
python3 "$DJK/pruefstand/klick/pruefer.py" klick --schlaege "$SCHLAEGE" --log "$O/pruefer.jsonl" \
  --bereit "$O/pruefer.bereit" --aufnahme-bereit "$O/aufnahme.bereit" > "$O/pruefer.out" 2>&1 & PP=$!
for _ in $(seq 1 100); do [ -f "$O/pruefer.bereit" ] && break; sleep 0.1; done
pw-jack -p 256 "$DJK/pruefstand/aufnehmer/build/cypherdj-aufnehmer" --quelle "$SENKE:monitor_F" \
  --datei "$O/aufnahme.wav" --sekunden "$SEK" --bereit "$O/aufnahme.bereit" 2> "$O/aufnehmer.err" & AP=$!
sleep 2
graph_festhalten "$O/meta.txt" kern notbahn aufnehmer
wait "$PP"; PP=""
wait "$AP"; AP=""
kill -TERM "$KP"; wait "$KP"; KP=""
fremdlast nachher >> "$O/meta.txt"
echo "ende=$(date -Is)" >> "$O/meta.txt"
python3 "$HIER/auswertung_luecken.py" --wav "$O/aufnahme.wav" --pruefer "$O/pruefer.jsonl" --erwarte "$ERW" \
  --kern-err "$O/kern.err" --last-alle "$ALLE" --meta "$O/meta.txt" > "$O/ergebnis.json"
AR=$?
python3 -c "import json;e=json.load(open('$O/ergebnis.json'));print('$NAME', e['ergebnis'], 'am Ziel', e.get('ausgelassen_am_ziel'), 'laut Kern', e.get('ausgelassen_laut_kern'), 'erwartet', e.get('verbrennungen_im_fenster_erwartet'), 'Klicks', e.get('klicks'), 'Treiberwechsel', e.get('treiberwechsel_laut_kern'), 'Zustand', e.get('zustand_frame_luecken'), 'ausserhalb Rahmen', len(e.get('klicks_ausserhalb_rahmen') or []))"
exit $AR
