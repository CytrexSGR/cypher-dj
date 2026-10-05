#!/usr/bin/env bash
# Abschuss-Serie der Scheibe 18, stumm an einer eigenen Null-Senke mit vier Kanälen (SCHNITTSTELLEN §19.5, ROADMAP
# §8.4): Kern mit eigenen Ausgängen direkt an der Senke (10k, --master/--cue) und die Notbahn (Scheibe 10) daneben mit
# --daneben --kante <kern>:master_L (ADR 016 Nachtrag 2026-09-25), beide als transiente Units mit den Eigenschaften aus
# djk/units/cypherdj-notbahn.service und djk/units/cypherdj-kern.service (die Notbahn-Unit aus 10 hat keinen Watchdog:
# systemd prüft den des Kerns mit 250 ms Genauigkeit, Plan-Befund B5), JACK-Aufnehmer am Monitor der Senke, Prüf-Abonnent mit festem Herzschlag (2 s), N Eingriffe (kill -9 oder SIGSTOP) auf
# den Hauptprozess der Unit, danach Auswertung (auswertung.py). Hält das Echtzeit-Schloss für den ganzen Lauf.
#
# Aufruf: serie.sh --lauf <name> --art kill|stop|ruhe [--anzahl N] [--abstand 6] [--dauer S] [--bpm 128]
#                  [--rampe ab:ziel:dauer] [--kern <programm>] [--ohne-pruef-cue] [--klick-nach-neustart]
#                  [--ohne-notify] [--ohne-zustand] [--abschuss-bei S] [--vorlauf 8] [--kern-arg A ...]
#   --art ruhe          kein Eingriff, Laufzeit --dauer Sekunden (Negativ-Kontrolle)
#   --abschuss-bei S    genau ein kill -9, wenn die Kern-Uhr Sample S erreicht (Golden-Folgen notbahn_*)
#   --kern P            anderes Kern-Programm (Fehlerfall: der Kern aus 08, dann auch --ohne-pruef-cue
#                       --klick-nach-neustart --ohne-notify: er kennt weder --pruef-cue noch READY=1/WATCHDOG=1)
#   --ohne-zustand      Prüfschalter des Kerns aus 18: Neustart wie Scheibe 08 (Fehlerfall für SIGSTOP)
#   --kern-arg A        zusätzlicher Aufrufparameter des Kerns (mehrfach; etwa der Selbst-Wächter, Stand 18)
# Umgebung: CYPHERDJ_INSTANZ (Strang A: a). Ergebnis: djk/kern/tests/neustart/laeufe/<lauf>-<datum>/ mit lauf.json,
# ereignisse.jsonl, abonnent.jsonl, ziel.f32(.json), journal.txt, unit.txt, zustand.json, fremdlast.txt,
# auswertung.json. Rückgabe: 0 alle Grenzen gehalten, 1 mindestens eine gerissen, 2 Instrument oder Aufbau
# unbrauchbar, 3 kein Schloss, 4 Aufruf.
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../../.." && pwd)
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen (Strang A: export CYPHERDJ_INSTANZ=a)}"
I=$CYPHERDJ_INSTANZ
case "$I" in [a-i]) K=$(( $(printf '%d' "'$I") - 96 ));; *) echo "CYPHERDJ_INSTANZ=$I: a bis i" >&2; exit 4;; esac
LAUF=x ART=kill N=0 ABSTAND=6 DAUER=0 BPM=128 RAMPE="" KERN=$DJK/kern/build/cypherdj-kern PRUEF_CUE=1 KLICK_NEU=0
VORLAUF=8 BEI=-1 NOTIFY_ARG="" OHNE_ZUSTAND="" KERN_EXTRA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lauf) LAUF=$2; shift 2;; --art) ART=$2; shift 2;; --anzahl) N=$2; shift 2;; --abstand) ABSTAND=$2; shift 2;;
    --dauer) DAUER=$2; shift 2;; --bpm) BPM=$2; shift 2;; --rampe) RAMPE=$2; shift 2;; --kern) KERN=$2; shift 2;;
    --ohne-pruef-cue) PRUEF_CUE=0; shift;; --klick-nach-neustart) KLICK_NEU=1; shift;; --vorlauf) VORLAUF=$2; shift 2;;
    --abschuss-bei) BEI=$2; shift 2;; --ohne-notify) NOTIFY_ARG=--ohne-notify; shift;;
    --ohne-zustand) OHNE_ZUSTAND=--ohne-zustand; shift;;
    --kern-arg) KERN_EXTRA="$KERN_EXTRA $2"; shift 2;;
    *) echo "serie.sh: unbekannt $1" >&2; exit 4;;
  esac
done
[ "$BEI" -ge 0 ] && { ART=kill; N=1; }
KERN=$(readlink -f "$KERN")   # systemd-run braucht einen absoluten Pfad
case "$ART" in
  kill|stop) [ "$N" -ge 1 ] || { echo "--anzahl fehlt" >&2; exit 4; };;
  ruhe) [ "$DAUER" -ge 1 ] || { echo "--dauer fehlt" >&2; exit 4; };;
  *) echo "--art kill|stop|ruhe" >&2; exit 4;;
esac
NOTBAHN=$DJK/notbahn/build/cypherdj-notbahn
AUFNEHMER=$DJK/kern/build/cypherdj-aufnehmer4
ZUSTAND=$DJK/kern/build/cypherdj-zustand
for p in "$KERN" "$NOTBAHN" "$AUFNEHMER"; do [ -x "$p" ] || { echo "fehlt: $p" >&2; exit 4; }; done
UNIT=cypherdj-kern-$I
NB_ARGS="--daneben --kante cypherdj-kern-$I:master_L"   # wie djk/units/cypherdj-notbahn.service, Kern dieser Instanz
NB_UNIT=cypherdj-notbahn-$I
SENKE=cypherdj-pruef-$I-$LAUF
KERN_PORT=$((47100 + 1000 * K)); ABO_PORT=$((47140 + 1000 * K))
if [ "$ART" = ruhe ]; then GESAMT=$((VORLAUF + DAUER)); else GESAMT=$((VORLAUF + N * (ABSTAND + 1) + 4)); fi
[ "$BEI" -ge 0 ] && GESAMT=$((BEI / 48000 + 14))
O=$HIER/laeufe/$LAUF-$(date +%Y%m%d-%H%M%S)
mkdir -p "$O"
mono() { python3 -c 'import time; print(time.clock_gettime_ns(time.CLOCK_MONOTONIC))'; }
# Zeit nehmen und Signal senden in einem Zug (die Zeit liegt höchstens Mikrosekunden vor dem Signal)
schiesse() { python3 -c 'import os, signal, sys, time
t = time.clock_gettime_ns(time.CLOCK_MONOTONIC); os.kill(int(sys.argv[1]), getattr(signal, sys.argv[2])); print(t)' "$1" "$2"; }
fremdlast() { echo "$1 $(cat /proc/loadavg)"; nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>&1 | sed "s/^/gpu $1 /"; }

if [ -z "${CYPHERDJ_SCHLOSS_GEHALTEN:-}" ]; then   # eine äußere Reihe hält das Schloss schon (flock ... env ...=1)
  exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
  echo "[$LAUF] warte auf das Echtzeit-Schloss ..." >&2
  flock -w 10800 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
fi
echo "[$LAUF] Schloss $(date -Is), Last $(cut -d' ' -f1-3 /proc/loadavg)" >&2
fremdlast vorher > "$O/fremdlast.txt"
python3 - "$O/lauf.json" <<PY
import json, sys
json.dump({"lauf": "$LAUF", "art": "$ART", "anzahl": $N, "abstand_s": $ABSTAND, "dauer_s": $DAUER, "bpm": $BPM,
           "rampe": [float(x) for x in "$RAMPE".split(":")] if "$RAMPE" else None, "kern": "$KERN",
           "pruef_cue": bool($PRUEF_CUE), "klick_nach_neustart": bool($KLICK_NEU), "ohne_zustand": "$OHNE_ZUSTAND" != "", "kern_extra": "$KERN_EXTRA".split(),
           "instanz": "$I", "unit": "$UNIT", "senke": "$SENKE", "notbahn": "$NB_ARGS", "vorlauf_s": $VORLAUF,
           "gesamt_s": $GESAMT, "quantum": 256, "abschuss_bei": $BEI}, open(sys.argv[1], "w"), indent=1)
PY
BPM_F=$(python3 -c "print(float('$BPM'))")   # TOML-Gleitkommazahl mit Punkt, unabhängig von der Locale
sed -e "s/^start_bpm = [^#]*/start_bpm = $BPM_F /" -e "s/^pruefmodus = [^#]*/pruefmodus = true /" \
  "$DJK/konfig/kern.toml" > "$O/kern.toml"

# Frische Instanz: Ring und Zustand dieser Instanz weg, aber nur, wenn kein Prozess sie hält
for f in "/dev/shm/cypherdj-$I/bus" "/dev/shm/cypherdj-$I/zustand"; do
  if [ -e "$f" ]; then
    if fuser -s "$f" 2>/dev/null; then echo "$f in Benutzung: fremder Kern oder Notbahn der Instanz $I" >&2; exit 2; fi
    rm -f "$f"
  fi
done
AP=""; AB=""; MOD=""
aufraeumen() {
  for p in $AB $AP; do kill -TERM "$p" 2>/dev/null; done
  for u in "$UNIT" "$NB_UNIT"; do systemctl --user stop "$u" 2>/dev/null; systemctl --user reset-failed "$u" 2>/dev/null; done
  if [ -n "$MOD" ]; then
    pactl unload-module "$MOD"
    pactl list short modules | grep -q "^$MOD[[:space:]]" && echo "senke $MOD noch geladen" >> "$O/fremdlast.txt"
  fi
  fremdlast nachher >> "$O/fremdlast.txt"
}
trap aufraeumen EXIT

MOD=$(pactl load-module module-null-sink sink_name="$SENKE" channels=4 \
  channel_map=front-left,front-right,rear-left,rear-right sink_properties=node.description="$SENKE")
for _ in $(seq 1 50); do pw-link -i | grep -qx "$SENKE:playback_RL" && break; sleep 0.1; done
START_WAND=$(date +%s)
systemctl --user reset-failed "$NB_UNIT" 2>/dev/null
# shellcheck disable=SC2046,SC2086
systemd-run --user --unit="$NB_UNIT" -G $(python3 "$HIER/unit_eigenschaften.py" "$DJK/units/cypherdj-notbahn.service") \
  -p Environment=CYPHERDJ_INSTANZ="$I" -- /usr/bin/pw-jack -p 256 "$NOTBAHN" --master "$SENKE:playback_F" \
  --cue "$SENKE:playback_R" $NB_ARGS > "$O/systemd-run-notbahn.txt" 2>&1 || { echo "Notbahn-Unit gescheitert" >&2; exit 2; }
for _ in $(seq 1 50); do [ "$(systemctl --user is-active "$NB_UNIT")" = active ] && break; sleep 0.1; done
[ "$(systemctl --user is-active "$NB_UNIT")" = active ] || { echo "Notbahn-Unit nicht aktiv" >&2; exit 2; }

systemctl --user reset-failed "$UNIT" 2>/dev/null
CUE_ARG=""; [ "$PRUEF_CUE" = 1 ] && CUE_ARG=--pruef-cue
T_UNIT=$(mono)
# shellcheck disable=SC2046
systemd-run --user --unit="$UNIT" -G $(python3 "$HIER/unit_eigenschaften.py" "$DJK/units/cypherdj-kern.service" $NOTIFY_ARG) \
  -p Environment=CYPHERDJ_INSTANZ="$I" -- /usr/bin/pw-jack -p 256 "$KERN" --konfig "$O/kern.toml" --pruefmodus \
  --master "$SENKE:playback_F" --cue "$SENKE:playback_R" $CUE_ARG $OHNE_ZUSTAND $KERN_EXTRA > "$O/systemd-run.txt" 2>&1 || { echo "systemd-run gescheitert" >&2; cat "$O/systemd-run.txt" >&2; exit 2; }
for _ in $(seq 1 50); do [ "$(systemctl --user is-active "$UNIT")" = active ] && break; sleep 0.1; done
[ "$(systemctl --user is-active "$UNIT")" = active ] || { echo "Kern-Unit nicht aktiv" >&2; exit 2; }

pw-jack -p 256 "$AUFNEHMER" --quelle "$SENKE" --datei "$O/ziel.f32" --sekunden "$GESAMT" --bereit "$O/aufnahme.bereit" \
  2> "$O/aufnehmer.err" & AP=$!
for _ in $(seq 1 100); do [ -s "$O/aufnahme.bereit" ] && break; sleep 0.05; done
[ -s "$O/aufnahme.bereit" ] || { echo "Aufnehmer meldet sich nicht (aufnehmer.err)" >&2; exit 2; }
ABO_ARGS=(--kern-port "$KERN_PORT" --port "$ABO_PORT" --log "$O/abonnent.jsonl" --dauer "$((GESAMT - 1))" --bpm "$BPM")
[ -n "$RAMPE" ] && ABO_ARGS+=(--rampe "$RAMPE")
[ "$KLICK_NEU" = 1 ] && ABO_ARGS+=(--klick-nach-neustart)
[ "$BEI" -ge 0 ] && ABO_ARGS+=(--abschuss-bei "$BEI" --unit "$UNIT" --ereignisse "$O/ereignisse.jsonl")
: > "$O/ereignisse.jsonl"
python3 "$HIER/abonnent.py" "${ABO_ARGS[@]}" 2> "$O/abonnent.err" & AB=$!
sleep "$VORLAUF"
if [ "$BEI" -ge 0 ]; then
  sleep $((GESAMT - VORLAUF))
elif [ "$ART" != ruhe ]; then
  for i in $(seq 1 "$N"); do
    PID=$(systemctl --user show -p MainPID --value "$UNIT")
    if ! [ "$PID" -gt 0 ] 2>/dev/null; then
      echo "{\"i\":$i,\"fehler\":\"kein MainPID\"}" >> "$O/ereignisse.jsonl"; sleep "$ABSTAND"; continue
    fi
    if [ "$ART" = kill ]; then T=$(schiesse "$PID" SIGKILL); else T=$(schiesse "$PID" SIGSTOP); fi
    echo "{\"i\":$i,\"art\":\"$ART\",\"pid\":$PID,\"t_ns\":$T}" >> "$O/ereignisse.jsonl"
    sleep "$ABSTAND.$(printf '%03d' $((RANDOM % 1000)))"   # zufällige Lage im Takt
  done
else
  sleep "$DAUER"
fi
wait "$AP"; AP=""
wait "$AB" 2>/dev/null; AB=""
systemctl --user show -p NRestarts -p ActiveState -p MainPID "$UNIT" > "$O/unit.txt"
[ -x "$ZUSTAND" ] && "$ZUSTAND" "/dev/shm/cypherdj-$I/zustand" > "$O/zustand.json" 2>&1   # ab Task 10
journalctl --user -u "$UNIT" -o short-monotonic --no-pager --since "@$((START_WAND - 1))" > "$O/journal.txt" 2>&1
journalctl --user -u "$NB_UNIT" -o short-monotonic --no-pager --since "@$((START_WAND - 1))" > "$O/journal-notbahn.txt" 2>&1
echo "t_unit_ns $T_UNIT" >> "$O/lauf.txt"
aufraeumen; trap - EXIT
python3 "$HIER/auswertung.py" "$O"
