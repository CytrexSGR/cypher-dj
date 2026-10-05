#!/usr/bin/env bash
# Scheibe 25: Callback-Kosten im echten JACK-Callback (ARCHITEKTUR §7: p99,9 unter 20 % der Periode, 1,07 ms bei 256;
# Maximum unter 50 %, 2,67 ms). Eigene Null-Senke, Notbahn, Kern mit Prüfmodus bei Quantum 256; kosten25_sender.py belegt
# 16 Kanäle (oder keinen: --leer) und hält den Kern --sekunden lang; dann SIGTERM, und die Schlusszeile des Kerns nennt
# cb_p50_us, cb_p99_us, cb_p999_us, cb_max_us über alle Zyklen (Verteilung im Netz-Faden, telemetrie.h) sowie die
# selbst gezählten Frame-Lücken. Hält das Echtzeit-Schloss, Fremdlast vorher und nachher (ROADMAP §8.5).
# Aufruf: kosten25.sh --lauf NAME [--kern PROGRAMM] [--leer] [--rampen] [--last] [--sekunden 60]
#   --last     Fehlerfall für das Instrument: jeder 100. Zyklus verbrennt eine halbe Periode (Kern --test-last-*)
# Ergebnis: djk/kern/tests/ziel/laeufe/<NAME>-<datum>/ergebnis.json (Schlusszeile des Kerns plus Lauf-Angaben).
# Rückgabe: 0 Zusage gehalten, 1 gerissen, 3 kein Schloss, 4 Aufruf oder Aufbau.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen (Strang A: export CYPHERDJ_INSTANZ=a)}"
I=$CYPHERDJ_INSTANZ
case "$I" in [a-i]) K=$(( $(printf '%d' "'$I") - 96 ));; *) echo "CYPHERDJ_INSTANZ=$I: a bis i" >&2; exit 4;; esac
LAUF=kosten KERN=$DJK/kern/build/cypherdj-kern SENDER_ARG=() LAST=() SEK=60
while [ $# -gt 0 ]; do
  case "$1" in
    --lauf) LAUF=$2; shift 2;; --kern) KERN=$2; shift 2;; --leer) SENDER_ARG+=(--leer); shift;;
    --rampen) SENDER_ARG+=(--rampen); shift;; --last) LAST=(--test-last-alle 100 --test-last-perioden 0.5); shift;;
    --sekunden) SEK=$2; shift 2;; *) echo "kosten25.sh: unbekannt $1" >&2; exit 4;;
  esac
done
NOTBAHN=$DJK/notbahn/build/cypherdj-notbahn
for p in "$KERN" "$NOTBAHN"; do [ -x "$p" ] || { echo "fehlt: $p" >&2; exit 4; }; done
NB_ARGS="--daneben --kante cypherdj-kern-$I:master_L"   # Notbahn daneben (ADR 016 Nachtrag), wie neustart/serie.sh aus 18
SENKE=cypherdj-pruef-$I-$LAUF
O=$HIER/laeufe/$LAUF-$(date +%Y%m%d-%H%M%S)
mkdir -p "$O"
if [ -z "${CYPHERDJ_SCHLOSS_GEHALTEN:-}" ]; then
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  echo "[$LAUF] warte auf das Echtzeit-Schloss ..." >&2
  flock -w 10800 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
VOR=$(cut -d' ' -f1-3 /proc/loadavg)
sed -e "s/^pruefmodus = [^#]*/pruefmodus = true /" "$DJK/konfig/kern.toml" > "$O/kern.toml"
for f in "/dev/shm/cypherdj-$I/bus" "/dev/shm/cypherdj-$I/zustand"; do
  if [ -e "$f" ]; then
    if fuser -s "$f" 2>/dev/null; then echo "$f in Benutzung" >&2; exit 4; fi
    rm -f "$f"
  fi
done
NB=""; KP=""; MOD=""
aufraeumen() {
  # Scheibe 25: nach dem Lauf den eigenen Neustart-Zustand wieder weg, sonst setzt der nächste Kern der Instanz (etwa
  # luecken_lauf.sh aus 08) die belegten Kanäle und Prüfklicks dieses Laufs fort (gemessen: luecken_halb −84 Samples)
  [ -n "$KP" ] && kill -TERM "$KP" 2>/dev/null && wait "$KP" 2>/dev/null
  [ -n "$NB" ] && kill -TERM "$NB" 2>/dev/null && wait "$NB" 2>/dev/null
  [ -n "$MOD" ] && pactl unload-module "$MOD"
  f=/dev/shm/cypherdj-$I/zustand; if [ -e "$f" ] && ! fuser -s "$f" 2>/dev/null; then rm -f "$f"; fi
}
trap aufraeumen EXIT
MOD=$(pactl load-module module-null-sink sink_name="$SENKE" channels=4 \
  channel_map=front-left,front-right,rear-left,rear-right sink_properties=node.description="$SENKE")
for _ in $(seq 1 50); do pw-link -i | grep -qx "$SENKE:playback_RL" && break; sleep 0.1; done
# shellcheck disable=SC2086
pw-jack -p 256 "$NOTBAHN" --master "$SENKE:playback_F" --cue "$SENKE:playback_R" $NB_ARGS 2> "$O/notbahn.err" & NB=$!
CYPHERDJ_INSTANZ=$I pw-jack -p 256 "$KERN" --konfig "$O/kern.toml" --pruefmodus --master "$SENKE:playback_F" \
  --cue "$SENKE:playback_R" --waechter-ms 100 "${LAST[@]}" 2> "$O/kern.err" & KP=$!
sleep 1
python3 "$HIER/kosten25_sender.py" --kern-port $((47100 + 1000 * K)) --port $((47140 + 1000 * K)) \
  "${SENDER_ARG[@]}" --sekunden "$SEK" > "$O/sender.txt" 2>&1
kill -TERM "$KP"; wait "$KP" 2>/dev/null; KP=""
NACH=$(cut -d' ' -f1-3 /proc/loadavg)
python3 - "$O" "$LAUF" "$VOR" "$NACH" "$SEK" <<'PY'
import json, sys
o, lauf, vor, nach, sek = sys.argv[1:6]
zeile = [z for z in open(f"{o}/kern.err", encoding="utf-8") if z.startswith('{"zyklen"')][-1]
e = json.loads(zeile)
e.update({"lauf": lauf, "last_vorher": vor, "last_nachher": nach, "sekunden": float(sek),
          "sender": open(f"{o}/sender.txt", encoding="utf-8").read().strip(),
          "zusage_p999_us": 1067, "zusage_max_us": 2667})
e["gehalten"] = e["cb_p999_us"] < 1067 and e["cb_max_us"] < 2667
json.dump(e, open(f"{o}/ergebnis.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(e, ensure_ascii=False))
sys.exit(0 if e["gehalten"] else 1)
PY
