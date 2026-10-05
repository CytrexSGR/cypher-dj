#!/bin/bash
# Scheiben 10 und 10k: Ende zu Ende mit dem echten Kern, stumm an eigener Null-Senke, unter der Echtzeit-Sperre.
# Kern (Prüfklick 128 BPM) mit eigenen Ausgängen an der Senke, Notbahn daneben mit Kante auf kern:master_L, Aufnahme;
# nach 22 s kill -9 auf den Kern, nach 4 s Neustart (ohne Klick: der neue Kern schweigt), Aufnahme bis 40 s.
# Aufruf: tests/lauf_kern.sh <ordner> [--kern <binär>]
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -u
O=$(realpath -m "$1"); shift
HIER=$(cd "$(dirname "$0")/.." && pwd); DJK=$(cd "$HIER/.." && pwd)
KERN=$DJK/kern/build/cypherdj-kern
[ "${1:-}" = --kern ] && KERN=$2
export CYPHERDJ_INSTANZ=f
SENKE=cypherdj-pruef-f-10k
[ -e "$O" ] && { echo "$O existiert schon" >&2; exit 4; }
mkdir -p "$O"
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
flock -w 3600 9 || { echo "Sperre nicht bekommen" >&2; exit 1; }
PIDS=()
abbau() {
  for p in "${PIDS[@]}"; do kill -TERM "$p" 2>/dev/null; done
  sleep 0.5; for p in "${PIDS[@]}"; do kill -KILL "$p" 2>/dev/null; done
  [ -n "${ID:-}" ] && pactl unload-module "$ID" 2>/dev/null
  rm -f ${TMPDIR:-/tmp}/cypherdj-senken/$SENKE.modid /dev/shm/cypherdj-f/bus
}
trap abbau EXIT
LAST_VOR=$(cut -d' ' -f1 /proc/loadavg)
rm -f /dev/shm/cypherdj-f/bus
ID=$("$DJK/pruefstand/senke/senke_an.sh" $SENKE) || exit 5
pw-jack -p 256 "$HIER/build/cypherdj-notbahn" --master $SENKE:playback_F --daneben --kante cypherdj-kern-f:master_L \
  > "$O/notbahn.log" 2>&1 & PIDS+=($!)
sleep 0.5
pw-jack -p 256 "$KERN" --pruefmodus --master $SENKE:playback_F 2> "$O/kern1.err" & KP=$!; PIDS+=($KP)
python3 "$DJK/pruefstand/klick/pruefer.py" klick --log "$O/pruefer.jsonl" --bereit "$O/pruefer.bereit" \
  --aufnahme-bereit "$O/aufnahme.bereit" --schlaege 400 > "$O/pruefer.out" 2>&1 & PIDS+=($!)
for _ in $(seq 1 100); do [ -f "$O/pruefer.bereit" ] && break; sleep 0.1; done
pw-jack -p 256 "$DJK/pruefstand/aufnehmer/build/cypherdj-aufnehmer" --quelle $SENKE:monitor_F --datei "$O/aufnahme.wav" \
  --sekunden 40 --bereit "$O/aufnahme.bereit" 2> "$O/aufnehmer.txt" & AUF=$!; PIDS+=($AUF)
sleep 22
kill -KILL $KP; echo "kill $(date +%s.%N)" >> "$O/ablauf.txt"
sleep 4
pw-jack -p 256 "$KERN" --master $SENKE:playback_F 2> "$O/kern2.err" & PIDS+=($!)
echo "neustart $(date +%s.%N)" >> "$O/ablauf.txt"
wait $AUF
python3 -c "import json,sys; json.dump({'last_vorher': float(sys.argv[1]), 'last_nachher': float(open('/proc/loadavg').read().split()[0])}, open(sys.argv[2], 'w'))" "$LAST_VOR" "$O/lauf.json"
echo "fertig $O"
