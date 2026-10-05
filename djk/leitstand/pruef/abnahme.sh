#!/usr/bin/env bash
# Abnahme der Scheibe 12 gegen den laufenden Kern aus Scheibe 01, stumm an eigener Null-Senke (ROADMAP §8.4, §8.5).
# Aufbau: eigene Senke, Notbahn und Kern aus 01 unter pw-jack -p 256, Leitstand über den Vermittler des Prüf-Clients,
# Prüf-Client (100 Takte, 10 Prüfklicks, SIGSTOP 1 000 ms), dann Auswertung aller Abnahmepunkte am Ziel.
# Ports: eigener Block 47150 bis 47153 und 47250 (plus 1000·k der Prüfinstanz), nicht die Vorgabe-Ports der Instanz:
# die Kern-Attrappe (Scheibe 13) läuft in derselben Instanz auf 47100 + 1000·k (gemessen 2026-09-23: Kern aus 01 fand
# 50100 belegt, „UDP-Port 50100 nicht zu binden“).
# Aufruf: CYPHERDJ_INSTANZ=c pruef/abnahme.sh <lauf-nr> <ausgabe-ordner> [takte]
# Umgebung: KERN_DJK (Vorgabe: dieses djk/) = Ordner mit kern/build/cypherdj-kern, notbahn/build/cypherdj-notbahn und
#           pruefstand/senke/senke_an.sh, senke_ab.sh (alles aus Scheibe 01, nur gelesen).
# Rückgabe: 0 alle Punkte grün, 1 ein Punkt rot, 3 kein Echtzeit-Schloss, 4 Aufbau gescheitert.
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
NR="${1:?Lauf-Nr fehlt}"; AUS="${2:?Ausgabe-Ordner fehlt}"; TAKTE="${3:-100}"
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang C: export CYPHERDJ_INSTANZ=c}"
HIER=$(cd "$(dirname "$0")" && pwd)
LS=$(cd "$HIER/.." && pwd)
DJK=$(cd "$LS/.." && pwd)
KERN_DJK="${KERN_DJK:-$DJK}"
K=$(( $(printf '%d' "'$CYPHERDJ_INSTANZ") - 96 ))
V=$(( 1000 * K ))
KERN_PORT=$((47150 + V)); ABO_LS=$((47151 + V)); ABO_PRUEF=$((47152 + V)); VERM_PORT=$((47153 + V)); WS_PORT=$((47250 + V))
SENKE=cypherdj-pruef-$CYPHERDJ_INSTANZ-12-$NR
SET_ID=$(date +%Y-%m-%d_%H%M)
O=$(mkdir -p "$AUS/lauf-$NR" && cd "$AUS/lauf-$NR" && pwd)
belegt() { ss -lnu | grep -E ":($KERN_PORT|$ABO_LS|$ABO_PRUEF|$VERM_PORT)\b"; ss -lnt | grep -E ":$WS_PORT\b"; }

exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
echo "[12 $NR] warte auf das Echtzeit-Schloss ..." >&2
flock -w 3600 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fremdlast() { echo "uptime_$1=$(uptime)"; echo "gpu_$1=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>&1)"; }
{ echo "lauf=$NR instanz=$CYPHERDJ_INSTANZ senke=$SENKE takte=$TAKTE kern=$KERN_DJK/kern/build/cypherdj-kern";
  echo "ports kern=$KERN_PORT abo_leitstand=$ABO_LS abo_pruef=$ABO_PRUEF vermittler=$VERM_PORT ws=$WS_PORT set_id=$SET_ID";
  echo "start=$(date -Is)"; fremdlast vorher; } > "$O/meta.txt"

NB=""; KP=""; LP=""; SENKE_DA=""
aufraeumen() {
  [ -n "$LP" ] && kill -TERM "$LP" 2>/dev/null && wait "$LP" 2>/dev/null
  [ -n "$KP" ] && kill -CONT "$KP" 2>/dev/null && kill -TERM "$KP" 2>/dev/null && wait "$KP" 2>/dev/null
  [ -n "$NB" ] && kill -TERM "$NB" 2>/dev/null && wait "$NB" 2>/dev/null
  [ -n "$SENKE_DA" ] && "$KERN_DJK/pruefstand/senke/senke_ab.sh" "$SENKE" >> "$O/meta.txt" 2>&1
}
trap aufraeumen EXIT

if belegt > "$O/belegt.txt"; then echo "Ports belegt: $(cat "$O/belegt.txt")" >&2; exit 4; fi
printf 'version = 1\nws_port = 47250\nabo_port = 47151\nsets = "%s/sets"\n' "$O" > "$O/leitstand.toml"
"$KERN_DJK/pruefstand/senke/senke_an.sh" "$SENKE" > "$O/senke.modid" || { echo "Senke $SENKE nicht angelegt" >&2; exit 4; }
SENKE_DA=1
pw-jack -p 256 "$KERN_DJK/notbahn/build/cypherdj-notbahn" --master "$SENKE:playback_F" 2> "$O/notbahn.err" & NB=$!
pw-jack -p 256 "$KERN_DJK/kern/build/cypherdj-kern" --pruefmodus --udp-port "$KERN_PORT" 2> "$O/kern.err" & KP=$!
sleep 1
kill -0 "$KP" 2>/dev/null || { echo "Kern läuft nicht: $(cat "$O/kern.err")" >&2; KP=""; exit 4; }
[ "$(ps -o comm= -p "$KP")" = cypherdj-kern ] || { echo "PID $KP ist nicht cypherdj-kern" >&2; exit 4; }
node "$LS/src/leitstand.ts" --konfig "$O/leitstand.toml" --kern-port "$VERM_PORT" --set-id "$SET_ID" \
  > "$O/leitstand.out" 2> "$O/leitstand.err" & LP=$!
for _ in $(seq 1 50); do grep -q '^leitstand:' "$O/leitstand.out" && break; sleep 0.1; done
grep -q '^leitstand:' "$O/leitstand.out" || { echo "Leitstand startet nicht: $(cat "$O/leitstand.err")" >&2; exit 4; }

node "$LS/pruef/pruefclient.ts" --kern-port "$KERN_PORT" --vermittler-port "$VERM_PORT" --abo-port "$ABO_PRUEF" \
  --ws-port "$WS_PORT" --takte "$TAKTE" --klicks 10 --kern-pid "$KP" --stopp-ms 1000 --aus "$O/ergebnis.json" \
  > "$O/pruefclient.out" 2>&1
PR=$?
kill -TERM "$LP"; wait "$LP"; echo "leitstand_rc=$?" >> "$O/meta.txt"; LP=""
kill -TERM "$KP"; wait "$KP"; KP=""
kill -TERM "$NB"; wait "$NB"; NB=""
"$KERN_DJK/pruefstand/senke/senke_ab.sh" "$SENKE" >> "$O/meta.txt" 2>&1; SENKE_DA=""
{ fremdlast nachher; echo "ende=$(date -Is)"; echo "pruefclient_rc=$PR"; } >> "$O/meta.txt"
flock -u 9
[ "$PR" = 0 ] || { echo "Prüf-Client endete mit $PR: $(tail -3 "$O/pruefclient.out")" >&2; exit 4; }
node "$LS/pruef/auswertung.ts" --ergebnis "$O/ergebnis.json" --journal "$O/sets/$SET_ID/journal.jsonl" \
  --bericht "$O/bericht.json" | tee "$O/auswertung.txt"
exit "${PIPESTATUS[0]}"
