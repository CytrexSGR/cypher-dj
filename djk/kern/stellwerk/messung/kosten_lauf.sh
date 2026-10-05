#!/bin/sh
# Scheibe 11, Task 15: Kosten je Zyklus mit 64 laufenden Reglern, unter der Echtzeit-Sperre (ROADMAP §8.5).
# Aufruf aus djk/kern/stellwerk/:  flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" sh messung/kosten_lauf.sh build berichte/kosten_11.txt
# Nullpunkt (null), Instrument-Kontrolle (nadel: 500 µs im Zyklus n/2), drei Läufe im Takt, ein Lauf ohne Pause (Vergleich).
B=${1:-build}
AUS=${2:-berichte/kosten_11.txt}
LAEUFE=${3:-3}
ZYKLEN=${4:-100000}
mkdir -p "$(dirname "$AUS")"
{
  echo "start $(date -Is) last $(cut -d' ' -f1-3 /proc/loadavg)"
  nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null | sed 's/^/gpu /'
  "$B/stellwerk_kosten" null 20000 --takt-us 1000
  "$B/stellwerk_kosten" nadel 20000 --takt-us 1000
  i=1
  while [ "$i" -le "$LAEUFE" ]; do
    "$B/stellwerk_kosten" last "$ZYKLEN" --takt-us 1000
    i=$((i + 1))
  done
  "$B/stellwerk_kosten" last "$ZYKLEN" --takt-us 0
  echo "ende $(date -Is) last $(cut -d' ' -f1-3 /proc/loadavg)"
} > "$AUS" 2>&1
cat "$AUS"
