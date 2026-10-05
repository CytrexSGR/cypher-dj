#!/usr/bin/env bash
# Scheibe 08: Golden-Folgen über djk/vertrag/attrappe_leitstand.py gegen einen laufenden Kern an eigener Null-Senke
# (SCHNITTSTELLEN.md §19.2, §19.5; ROADMAP §8.4, §8.5). Kern und Notbahn in einer node.group, damit der Kern dem
# Treiber der eigenen Senke folgt; kein Ton an echte Ausgänge (Riegel der Notbahn).
# Aufruf: folgen_lauf.sh <kern-programm> <ausgabe-ordner> <lauf-name> [folge.jsonl ...]
#   ohne Folgen: uhr_golden, storno, protokollfehler aus djk/vertrag/folgen/
#   KERN_ARGS (Umgebung): Aufrufparameter des Kerns, Vorgabe "--konfig <djk>/konfig/kern.toml"; für den Kern aus
#   Scheibe 01 KERN_ARGS="" setzen (er kennt --konfig nicht).
# Braucht CYPHERDJ_INSTANZ (Strang A: a). Hält das Echtzeit-Schloss für den ganzen Lauf.
# Rückgabe: die der Attrappe (0 alle grün, 1 mindestens eine rot, 2 keine Verbindung), 3 kein Schloss, 4 Senke
# oder Notbahn nicht an der Senke.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
KERN=$1; AUS=$2; NAME=$3; shift 3
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang A: export CYPHERDJ_INSTANZ=a}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
KERN_ARGS=${KERN_ARGS---konfig $DJK/konfig/kern.toml}
FOLGEN=("$@")
[ ${#FOLGEN[@]} -eq 0 ] && FOLGEN=("$DJK/vertrag/folgen/uhr_golden.jsonl" "$DJK/vertrag/folgen/storno.jsonl" \
                                   "$DJK/vertrag/folgen/protokollfehler.jsonl")
SENKE=cypherdj-pruef-$CYPHERDJ_INSTANZ-$NAME
mkdir -p "$AUS"
SCHLOSS_STAND=${CYPHERDJ_SCHLOSS:-${SCHLOSS:-1}}  # gehalten: der Aufrufer hält es (abnahme.sh); 0: nur Proben
if [ "$SCHLOSS_STAND" = 1 ]; then
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  flock -w 3600 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
fremdlast() { echo "uptime_$1=$(uptime)"; echo "gpu_$1=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>&1)"; }
{ echo "lauf=$NAME kern=$KERN args=$KERN_ARGS senke=$SENKE instanz=$CYPHERDJ_INSTANZ schloss=$SCHLOSS_STAND start=$(date -Is)"
  fremdlast vorher; } > "$AUS/$NAME.meta"
KP=""; NB=""
aufraeumen() {
  [ -n "$KP" ] && kill -TERM "$KP" 2>/dev/null && wait "$KP" 2>/dev/null
  [ -n "$NB" ] && kill -TERM "$NB" 2>/dev/null && wait "$NB" 2>/dev/null
  "$DJK/pruefstand/senke/senke_ab.sh" "$SENKE" >> "$AUS/$NAME.meta" 2>&1
}
trap aufraeumen EXIT
"$DJK/pruefstand/senke/senke_an.sh" "$SENKE" > /dev/null || exit 4
pw-jack -p 256 "$DJK/notbahn/build/cypherdj-notbahn" --master "$SENKE:playback_F" 2> "$AUS/$NAME.notbahn.err" & NB=$!
. "$HIER/graph.sh"
notbahn_verbinden "$AUS/$NAME.meta" || { echo "Notbahn nach 5 s nicht an $SENKE" >&2; exit 4; }
# shellcheck disable=SC2086
pw-jack -p 256 "$KERN" $KERN_ARGS 2> "$AUS/$NAME.kern.err" & KP=$!
sleep 1
timeout 900 python3 "$DJK/vertrag/attrappe_leitstand.py" --bericht "$AUS/$NAME.json" --protokoll "$AUS/$NAME.jsonl" \
  "${FOLGEN[@]}" > "$AUS/$NAME.txt" 2>&1
RC=$?
fremdlast nachher >> "$AUS/$NAME.meta"
echo "ende=$(date -Is) rueckgabe=$RC" >> "$AUS/$NAME.meta"
cat "$AUS/$NAME.txt"
exit $RC
