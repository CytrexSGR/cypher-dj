#!/bin/bash
# Scheibe 10: ein Prüflauf, stumm an eigener Null-Senke, unter der Echtzeit-Sperre.
# Aufruf: tests/lauf.sh <art> <ordner> --bpm B [--bpm-bis B2 --rampe-takte N] [--nan-takt K] [--notbahn <binär>]
#   art: schleife (Kill nach 6 s, 25 s Aufnahme) · ruhe (<sekunden> ohne Kill, --dauer S) · rueckgabe (Kill, 3 s, Neustart)
#        ohne_kante (wie schleife, ohne Leerkante)
# Schreibt <ordner>/lauf.json, schreiber.log, notbahn.log, aufnahme.wav; baut Senke, Prozesse und Ring in jedem Fall ab.
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -u
ART=$1; O=$(realpath -m "$2"); shift 2
BPM=""; BPM_BIS=""; RAMPE=0; NAN=""; NB=""; DAUER=20
while [ $# -gt 0 ]; do case "$1" in
  --bpm) BPM=$2; shift 2 ;; --bpm-bis) BPM_BIS=$2; shift 2 ;; --rampe-takte) RAMPE=$2; shift 2 ;;
  --nan-takt) NAN=$2; shift 2 ;; --notbahn) NB=$2; shift 2 ;; --dauer) DAUER=$2; shift 2 ;;
  *) echo "unbekannt $1" >&2; exit 2 ;; esac; done
HIER=$(cd "$(dirname "$0")/.." && pwd); DJK=$(cd "$HIER/.." && pwd)
NB=${NB:-$HIER/build/cypherdj-notbahn}
export CYPHERDJ_INSTANZ=f
SENKE=cypherdj-pruef-f-10
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
SARGS=(--ziel $SENKE:playback_F --bpm "$BPM"); [ -n "$BPM_BIS" ] && SARGS+=(--bpm-bis "$BPM_BIS" --rampe-takte "$RAMPE")
[ -n "$NAN" ] && SARGS+=(--nan-takt "$NAN")
pw-jack -p 256 "$HIER/build/ring_schreiber" "${SARGS[@]}" > "$O/schreiber.log" 2>&1 & RS=$!; PIDS+=($RS)
sleep 0.5
python3 "$HIER/tests/nb_hoerer.py" $((47140 + 6000)) "$O/nb.txt" & PIDS+=($!)
KANTE=(--kante cypherdj-ringschreiber-f:master_L); [ "$ART" = ohne_kante ] && KANTE=()
pw-jack -p 256 "$NB" --master $SENKE:playback_F --daneben "${KANTE[@]}" > "$O/notbahn.log" 2>&1 & PIDS+=($!)
SEK=42; [ "$ART" = ruhe ] && SEK=$DAUER
pw-jack -p 256 "$DJK/pruefstand/aufnehmer/build/cypherdj-aufnehmer" --quelle $SENKE:monitor_F --datei "$O/aufnahme.wav" \
  --sekunden "$SEK" 2> "$O/aufnehmer.txt" & AUF=$!; PIDS+=($AUF)
sleep 20
if [ "$ART" != ruhe ]; then
  kill -KILL $RS; echo "kill $(date +%s.%N)" >> "$O/ablauf.txt"
  if [ "$ART" = rueckgabe ]; then
    sleep 3
    pw-jack -p 256 "$HIER/build/ring_schreiber" "${SARGS[@]}" >> "$O/schreiber.log" 2>&1 & PIDS+=($!)
  fi
fi
wait $AUF
python3 - "$O" "$ART" "$BPM" "${BPM_BIS:-$BPM}" "$RAMPE" "$LAST_VOR" <<'EOF'
import json, sys
o, art, b, b2, r, lv = sys.argv[1:]
json.dump({'art': art, 'args': {'bpm': float(b), 'bpm_bis': float(b2), 'rampe_takte': float(r)},
           'last_vorher': float(lv), 'last_nachher': float(open('/proc/loadavg').read().split()[0])},
          open(f'{o}/lauf.json', 'w'), indent=1)
EOF
echo "fertig $O"
