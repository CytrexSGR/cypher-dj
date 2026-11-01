#!/usr/bin/env bash
# Load measurement slice 7 (merge next to the core): the kernel load run ziel_lauf_boxen.py (four decks in keylock, two loop boxes, a running arrangement
# with 32 audio tracks, null sink, test instance e, never a) once without and once with a merge loop on a SECOND test instance (f, its own server and
# kernel) next to it. The merge loop is w7_last_treiber.mjs: back to back merges of four tracks over 32 beats, the real cypherdj-render.
# Usage: w7_last.sh <outdir> [minutes=2] [repeats=5]
# Cases per repeat: ohne (baseline), mit (merge loop); at the end once "beide" (merge loop plus one real stems run on the CPU).
# Takes the real-time lock itself per run (CYPHERDJ_ECHTZEIT_SCHLOSS), waits, never deletes it.
# Result per run: <outdir>/<case>-<n>/{ergebnis.json, pwtop.txt, treiber.jsonl, meta.txt}.
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"
set -uo pipefail
O="${1:?outdir}"; MIN="${2:-2}"; WDH="${3:-5}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../.." && pwd)
mkdir -p "$O"
export CYPHERDJ_PYTHON="${CYPHERDJ_PYTHON:-$DJK/werkstatt/.venv/bin/python}" CUDA_VISIBLE_DEVICES=
AUF=/dev/shm/w7-last; mkdir -p "$AUF"
echo '{"sha":"b3f393fcf7b9dcf7a1532c0bb77dd5685ecc03927aaf6366233465e3be4948ec","von_beat":16,"bis_beat":48,"bpm":124}' > "$AUF/aufbau.json"
URL=http://127.0.0.1:53300
"$DJK/start/djk-stop" --instanz f > /dev/null 2>&1
DJK="$DJK" "$DJK/start/djk-start" --instanz f > "$O/start-f.txt" 2>&1 || { echo "instance f did not start" >&2; exit 4; }
timeout 90 bash -c "until curl -sf $URL/ >/dev/null; do sleep 1; done" || { echo "server f not reachable" >&2; exit 4; }
TP=""
stopp() { if [ -n "$TP" ]; then kill -TERM "$TP" 2>/dev/null; wait "$TP" 2>/dev/null; TP=""; fi; }
trap 'stopp; "$DJK/start/djk-stop" --instanz f > /dev/null 2>&1' EXIT
lauf() {   # lauf <fall> <n>
  local fall="$1" n="$2" name="$1-$2"
  local d="$O/$name"; mkdir -p "$d"
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  flock -w 7200 9 || { echo "no real-time lock" >&2; return 3; }
  { echo "case=$fall n=$n minutes=$MIN start=$(date -Is)"; uptime; } > "$d/meta.txt"
  if [ "$fall" != ohne ]; then
    local extra=""; [ "$fall" = beide ] && extra="--stems"
    # exec: $! is the node process itself, so stopp() really ends the driver (a plain subshell left it running into the next run)
    ( exec 9>&-; cd "$HIER/.." && exec node pruef/w7_last_treiber.mjs --url "$URL" --aufbau "$AUF/aufbau.json" --instanz f \
      --dauer-s $(( MIN * 60 + 110 )) --jsonl "$d/treiber.jsonl" --ausgabe "$d/treiber" $extra > "$d/treiber.log" 2>&1 ) &
    TP=$!
  fi
  CYPHERDJ_INSTANZ=e python3 "$DJK/kern/tests/deck/ziel_lauf_boxen.py" --fall T128 --boxen an --arr ohne --lauf "w7last-$name" \
    --minuten "$MIN" --kern "$DJK/kern/build/cypherdj-kern" > "$d/kern.log" 2>&1
  local rc=$?
  stopp
  if pgrep -f "[w]7_last_treiber.mjs" > /dev/null; then echo "driver still alive after stopp: run invalid" >> "$d/meta.txt"; fi
  local erg; erg=$(ls -dt "$DJK/kern/tests/deck/laeufe/w7last-$name-"* 2>/dev/null | head -1)
  if [ -n "$erg" ]; then cp "$erg/ergebnis.json" "$d/ergebnis.json"; cp "$erg/pwtop.txt" "$d/pwtop.txt" 2>/dev/null; echo "kern_lauf=$erg" >> "$d/meta.txt"; fi
  echo "rc_kern=$rc end=$(date -Is)" >> "$d/meta.txt"
  flock -u 9; exec 9>&-
  return 0
}
for i in $(seq 1 "$WDH"); do lauf ohne "$i"; lauf mit "$i"; done
lauf beide 1
echo fertig > "$O/fertig"
