#!/usr/bin/env bash
# Ein stummer Prüflauf der Scheibe 01 an eigener Null-Senke (SCHNITTSTELLEN §19.5, ROADMAP §8.4, §8.5):
# Senke anlegen, Notbahn, Kern, Aufnehmer am Monitor der Senke, Prüfer über OSC, Auswertung, Senke entladen.
# Aufruf: lauf.sh <art> <lauf-nr> <ausgabe-ordner>
#   klick            Kern mit --pruefmodus, /test/klick, 101 Schläge, Auswertung gegen llround(sample_at(b))
#   mutation         wie klick, aber cypherdj-kern-mutation (Klick auf den Blockanfang): muss rot werden
#   ohne-klick       Kern mit --pruefmodus, kein /test/klick, 60 s Aufnahme: 0 Klicks
#   ohne-pruefmodus  Kern ohne --pruefmodus, /test/klick: /e/protokollfehler, 10 s Aufnahme: 0 Klicks
# Braucht CYPHERDJ_INSTANZ (Strang A: a). Hält das Echtzeit-Schloss für den ganzen Lauf; hat der Aufrufer es schon
# (CYPHERDJ_SCHLOSS=gehalten, so abnahme.sh), nimmt es das Skript nicht noch einmal (sonst wartete es auf sich selbst).
# Rückgabe: 0 Auswertung grün (bei mutation: rot wie erwartet), 1 sonst, 2 Instrument unbrauchbar (Lauf wiederholen),
# 3 kein Schloss.
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
ART="$1"; NR="$2"; AUS="$3"
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang A: export CYPHERDJ_INSTANZ=a}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../.." && pwd)
KERN=$DJK/kern/build/cypherdj-kern
[ "$ART" = mutation ] && KERN=$DJK/kern/build/cypherdj-kern-mutation
NOTBAHN=$DJK/notbahn/build/cypherdj-notbahn
AUFNEHMER=$DJK/pruefstand/aufnehmer/build/cypherdj-aufnehmer
SENKE=cypherdj-pruef-$CYPHERDJ_INSTANZ-$NR
O=$AUS/$ART-$NR
Q=256
mkdir -p "$O"
rm -f "$O"/*.bereit

if [ "${CYPHERDJ_SCHLOSS:-}" = gehalten ]; then
  echo "[$ART $NR] Echtzeit-Schloss hält der Aufrufer" >&2
else
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  echo "[$ART $NR] warte auf das Echtzeit-Schloss ..." >&2
  flock -w 3600 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
fremdlast() { echo "uptime_$1=$(uptime)"; echo "gpu_$1=$(nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader 2>&1)"; }
{ echo "art=$ART lauf=$NR senke=$SENKE quantum=$Q instanz=$CYPHERDJ_INSTANZ kern=$KERN"; echo "start=$(date -Is)"; fremdlast vorher; } > "$O/meta.txt"

KP=""; NB=""; AP=""; PP=""
aufraeumen() {
  for p in $PP $AP; do kill "$p" 2>/dev/null; done
  [ -n "$KP" ] && kill -TERM "$KP" 2>/dev/null && wait "$KP" 2>/dev/null
  [ -n "$NB" ] && kill -TERM "$NB" 2>/dev/null && wait "$NB" 2>/dev/null
  "$DJK/pruefstand/senke/senke_ab.sh" "$SENKE" >> "$O/meta.txt" 2>&1
}
trap aufraeumen EXIT

"$DJK/pruefstand/senke/senke_an.sh" "$SENKE" > "$O/senke.modid" || exit 1
pw-jack -p $Q "$NOTBAHN" --master "$SENKE:playback_F" 2> "$O/notbahn.err" & NB=$!
# Erst wenn die Notbahn an der eigenen Senke hängt, treibt diese Senke die Gruppe cypherdj-<i>; ein früher gestarteter
# Kern (ohne eigene Ports) landete sonst kurz am Standard-Treiber und zwänge ihm Quantum 256 auf (PIPEWIRE_QUANTUM).
VERBUNDEN=nein
for _ in $(seq 1 50); do
  pw-link -l | grep -A1 -x "cypherdj-notbahn-$CYPHERDJ_INSTANZ:master_L" | grep -q -- "|-> $SENKE:playback_FL" && { VERBUNDEN=ja; break; }
  sleep 0.1
done
echo "notbahn_verbunden=$VERBUNDEN" >> "$O/meta.txt"
[ "$VERBUNDEN" = ja ] || { echo "[$ART $NR] Notbahn nach 5 s nicht an $SENKE" >&2; exit 1; }
PRUEFMODUS=--pruefmodus
[ "$ART" = ohne-pruefmodus ] && PRUEFMODUS=""
pw-jack -p $Q "$KERN" $PRUEFMODUS 2> "$O/kern.err" & KP=$!
sleep 1

case "$ART" in
  klick|mutation) PART=klick; SEK=52 ;;
  ohne-klick) PART=ohne-klick; SEK=60 ;;
  ohne-pruefmodus) PART=klick-verboten; SEK=10 ;;
  *) echo "unbekannte Art $ART" >&2; exit 1 ;;
esac

if [ "$PART" = klick-verboten ]; then
  python3 "$HIER/pruefer.py" klick-verboten --log "$O/pruefer.jsonl" > "$O/pruefer.out" 2>&1
  PR=$?
  # Ton darf trotzdem keiner kommen: 10 s Aufnahme ohne Klick
  python3 "$HIER/pruefer.py" ohne-klick --log "$O/pruefer2.jsonl" --bereit "$O/pruefer.bereit" \
    --aufnahme-bereit "$O/aufnahme.bereit" --sekunden 11 > "$O/pruefer2.out" 2>&1 & PP=$!
  PRUEFERLOG=$O/pruefer2.jsonl
else
  EXTRA=""
  [ "$PART" = ohne-klick ] && EXTRA="--sekunden 62"
  python3 "$HIER/pruefer.py" "$PART" --log "$O/pruefer.jsonl" --bereit "$O/pruefer.bereit" \
    --aufnahme-bereit "$O/aufnahme.bereit" $EXTRA > "$O/pruefer.out" 2>&1 & PP=$!
  PRUEFERLOG=$O/pruefer.jsonl
fi
for _ in $(seq 1 100); do [ -f "$O/pruefer.bereit" ] && break; sleep 0.1; done
pw-jack -p $Q "$AUFNEHMER" --quelle "$SENKE:monitor_F" --datei "$O/aufnahme.wav" --sekunden $SEK \
  --bereit "$O/aufnahme.bereit" 2> "$O/aufnehmer.err" & AP=$!
sleep 2
# pw-top: letzter von zwei Rahmen, alle cypherdj-Knoten (auch fremder Instanzen: treibt ein fremder Treiber, steht er hier)
{ echo "== pw-top"; timeout 3 pw-top -b -n 2 2>/dev/null | awk '/QUANT/{n++} n==2' | grep -E "QUANT|cypherdj-"
  echo "== knoten"; for k in kern notbahn aufnehmer; do echo "$k=$(pw-cli ls Node | grep -c "node.name = \"cypherdj-$k-$CYPHERDJ_INSTANZ\"")"; done
  echo "== pw-link"; pw-link -l | grep -A2 -E "^cypherdj-(notbahn|aufnehmer)-$CYPHERDJ_INSTANZ|^$SENKE"; } >> "$O/meta.txt"
wait "$PP"; PR2=$?; PP=""
wait "$AP"; AP=""
[ "$PART" != klick-verboten ] && PR=$PR2
kill -TERM "$KP"; wait "$KP"; KP=""
kill -TERM "$NB"; wait "$NB"; NB=""
fremdlast nachher >> "$O/meta.txt"
echo "ende=$(date -Is)" >> "$O/meta.txt"
[ "${CYPHERDJ_SCHLOSS:-}" = gehalten ] || flock -u 9

ERW=101
[ "$PART" != klick ] && ERW=0
python3 "$HIER/auswertung.py" --wav "$O/aufnahme.wav" --pruefer "$PRUEFERLOG" --erwarte-klicks $ERW --meta "$O/meta.txt" \
  > "$O/ergebnis.json"
AR=$?
echo "[$ART $NR] Prüfer $PR, Auswertung $AR: $(python3 -c "import json;e=json.load(open('$O/ergebnis.json'));print(e['ergebnis'],e.get('klicks'),'Klicks, Versatz',e.get('versatz_samples'),'Streuung',e.get('streuung_samples'))")" >&2
[ "$AR" = 2 ] && exit 2
if [ "$ART" = mutation ]; then [ "$AR" = 1 ] && exit 0 || exit 1; fi
[ "$PR" = 0 ] && [ "$AR" = 0 ] && exit 0 || exit 1
