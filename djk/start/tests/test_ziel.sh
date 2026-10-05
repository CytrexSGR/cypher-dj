#!/usr/bin/env bash
# Prüflauf für Ziel-Auflösung, Weitergabe an den Kern, Ausgangs-Inventur und Sammelstopp (Plan M-1 Blocker 1 bis 3, Task 9).
# Kein Ton, kein Profilwechsel, kein echter Kern: Auflösung und Vorlagen laufen gegen ein aufgezeichnetes pw-dump
# (DJK_PW_DUMP), die Inventur gegen aufgezeichnete Befehlsausgaben, der Sammelstopp gegen Wegwerf-Prozesse (sleep, node)
# in einem Wegwerf-Baum (DJK=...) und eine Wegwerf-Unit der Instanz h. Nichts davon berührt Prozesse ausserhalb.
# Aufruf: tests/test_ziel.sh
# Prüfpunkte:
#   Z1 ziel.py: Beschreibung und node.name -> dieselben zwei Formen; unbekannter Name (stumm, JACK-Client) unverändert;
#      Fehlerfälle: kein Doppelpunkt, verbotenes Zeichen, mehrdeutige Beschreibung -> Rückgabe 2
#   Z2 einheit.py: Name mit Leerzeichen bleibt EIN Argument (früher zerfiel er); Cue mit Leerzeichen in "..." bleibt
#      zwei Argumente; Negativ-Kontrolle: Vorgabe ohne Leerzeichen unverändert
#   Z3 djk-start --vorlagen-nach: echtes Ziel (Beschreibung oder node.name) -> Kern und Notbahn bekommen die Beschreibung
#      in "...", kein --cue; Blocker 3 (--cue auf stummer Senke bei echtem Master), Ziel ohne Doppelpunkt, --cue mit
#      --ohne-cue -> Rückgabe 2 mit Grund; Riegel ohne --ton-frei bleibt 3; Negativ-Kontrolle: stumme Vorgabe unverändert
#   Z4 djk-ausgang: fremder Client -> 4 und genannt; nur eigene Clients -> 0; leere Senke -> 0; unbekannte Senke -> 2
#   Z5 djk-stop --alles: --trocken ändert nichts; beendet nur Cue-Server und Vorhörer der Instanz und die Unit der
#      Instanz; ein Vorhörer der anderen Instanz, ein fremder sleep, ein Köder mit dem Pfad nur im Argument, ein
#      anderes node-Skript und (falls da) der lebende Vorhörer der Sitzung bleiben; ohne --alles bleiben die Prozesse
# Rückgabe: 0 alle Punkte OK, 1 mindestens einer FEHL.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-ziel-test.XXXX")
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
PIDS=()   # nur PIDs dieses Tests, bei jedem Beenden wird die Kommandozeile gegen die Marke geprüft
aufraeumen() {
  local p c
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] && [ -r "/proc/$p/cmdline" ] || continue
    c=$(tr '\0' ' ' < "/proc/$p/cmdline"); w=$(readlink "/proc/$p/cwd")
    case "$c|$w" in *"$O"*|*300.0[0-9][0-9]*) kill "$p" 2>/dev/null;; esac
  done
  systemctl --user stop cypherdj-oberflaeche-h.service 2>/dev/null
  systemctl --user reset-failed cypherdj-oberflaeche-h.service 2>/dev/null
  rm -rf "$O"
}
trap aufraeumen EXIT
lebt() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null); [ -n "$s" ] && [ "${s:0:1}" != Z ]; }

D='Family 17h/19h HD Audio Controller Digitales Stereo (IEC958)'
N='alsa_output.pci-0000_16_00.6.iec958-stereo'
python3 - "$O/dump.json" "$N" "$D" <<'PY'
import json, sys
def knoten(i, name, desc):
    return {"id": i, "type": "PipeWire:Interface:Node",
            "info": {"props": {"node.name": name, "node.description": desc, "media.class": "Audio/Sink"}}}
json.dump([knoten(57, sys.argv[2], sys.argv[3]),
           knoten(63, "alsa_output.pci-0000_01_00.1.hdmi-stereo-extra1", "HDA NVidia Digital Stereo (HDMI 2)"),
           knoten(70, "alsa_output.usb-A.analog-stereo", "Gleiches Geraet"),
           knoten(71, "alsa_output.usb-B.analog-stereo", "Gleiches Geraet"),
           {"id": 90, "type": "PipeWire:Interface:Node",
            "info": {"props": {"node.name": "Firefox", "node.description": "Firefox", "media.class": "Stream/Output/Audio"}}}],
          open(sys.argv[1], "w"))
PY
export DJK_PW_DUMP="$O/dump.json"

# Z1 ziel.py
ist=$("$START/ziel.py" "$D:playback_F"); R=$?
[ "$R" = 0 ] && [ "$ist" = "$N:playback_F"$'\t'"$D:playback_F" ]; pruef $? "Z1 Beschreibung -> node.name + Beschreibung: rc $R: $ist"
ist=$("$START/ziel.py" "$N:playback_F"); R=$?
[ "$R" = 0 ] && [ "$ist" = "$N:playback_F"$'\t'"$D:playback_F" ]; pruef $? "Z1 node.name -> dieselben zwei Formen: rc $R: $ist"
ist=$("$START/ziel.py" "cypher_stumm-i:playback_F"); R=$?
[ "$R" = 0 ] && [ "$ist" = "cypher_stumm-i:playback_F"$'\t'"cypher_stumm-i:playback_F" ]; pruef $? "Z1 Negativ-Kontrolle stumme Senke unverändert: rc $R"
for f in "cypher_stumm" 'a"b:playback_F' 'a$(x):playback_F' "Gleiches Geraet:playback_F"; do
  "$START/ziel.py" "$f" >"$O/z1.txt" 2>&1; R=$?
  [ "$R" = 2 ] && ! grep -q Traceback "$O/z1.txt"; pruef $? "Z1 Fehlerfall $f: rc $R: $(head -c 100 "$O/z1.txt")"
done
"$START/ziel.py" "alsa_output.usb-A.analog-stereo:playback_F" >/dev/null 2>&1; R=$?
pruef $([ "$R" = 0 ]; echo $?) "Z1 Negativ-Kontrolle: mehrdeutige Beschreibung, aber eindeutiger node.name -> 0 ($R)"

# Z2 einheit.py
UN="$START/../units/cypherdj-kern.service"; DI="$START/vorlagen/cypherdj-kern.service.d/betrieb.conf"
args() { python3 "$START/einheit.py" --unit "$UN" --dropin "$DI" --var "MASTER=$1" --var "CUE_ARG=$2" --var TON_FREI=--ton-frei \
  --var KERN_ARGS= --var KERN_CLIENT=x --var LEITSTAND_ARGS= --var OBERFLAECHE_ARGS= | sed -n '/^--$/,$p' | tail -n +2; }
m=$(args "$D:playback_F" "" | grep -A1 -x -- '--master' | tail -1)
[ "$m" = "$D:playback_F" ]; pruef $? "Z2 Name mit Leerzeichen bleibt ein Argument: '$m'"
c=$(args "$D:playback_F" "--cue \"$D:playback_R\"" | grep -A1 -x -- '--cue' | tail -1)
[ "$c" = "$D:playback_R" ]; pruef $? "Z2 --cue \"Name mit Leerzeichen\" bleibt --cue plus ein Argument: '$c'"
a=$(args "cypher_stumm:playback_F" "--cue cypher_stumm:playback_R" | tr '\n' ' ')
[[ "$a" == *"--master cypher_stumm:playback_F --cue cypher_stumm:playback_R --ton-frei --waechter-ms 100"* ]]
pruef $? "Z2 Negativ-Kontrolle Vorgabe ohne Leerzeichen unverändert: ${a: -95}"

# Z3 djk-start --vorlagen-nach (immer --vorlagen-nach: dieser Abschnitt darf nie in den echten Start fallen)
vn() { rm -rf "$O/v"; "$START/djk-start" --instanz i --vorlagen-nach "$O/v" "$@" >"$O/z3.txt" 2>&1; }
kernzeile() { grep -h '^ExecStart=/' "$O/v/cypherdj-$1.service.d/betrieb.conf" 2>/dev/null; }
for m in "$D:playback_F" "$N:playback_F"; do
  vn --master "$m" --ohne-cue --ton-frei; R=$?
  K=$(kernzeile kern); B=$(kernzeile notbahn)
  [ "$R" = 0 ] && [[ "$K" == *"--master \"$D:playback_F\" --ton-frei"* ]] && [[ "$B" == *"--master \"$D:playback_F\" --daneben"* ]] \
    && [[ "$K$B" != *"--cue"* ]]
  pruef $? "Z3 --master '${m:0:30}...' --ohne-cue --ton-frei: rc $R, Kern/Notbahn bekommen die Beschreibung, kein --cue"
done
vn --master "$N:playback_F" --cue cypher_stumm-i:playback_R --ton-frei; R=$?
[ "$R" = 2 ] && grep -q "silent sink" "$O/z3.txt" && [ ! -e "$O/v" ]; pruef $? "Z3 Blocker 3 Cue auf stummer Senke bei echtem Master: rc $R: $(head -c 90 "$O/z3.txt")"
vn --master cypher_stumm-i; R=$?
[ "$R" = 2 ] && grep -q "port base" "$O/z3.txt" && [ ! -e "$O/v" ]; pruef $? "Z3 Ziel ohne Doppelpunkt: rc $R: $(head -c 90 "$O/z3.txt")"
vn --cue "$D:playback_R" --ohne-cue --ton-frei; R=$?
[ "$R" = 2 ] && grep -q "exclude each other" "$O/z3.txt"; pruef $? "Z3 --cue mit --ohne-cue: rc $R"
vn --master "$D:playback_F" --ohne-cue; R=$?
[ "$R" = 3 ] && [ ! -e "$O/v" ]; pruef $? "Z3 Riegel: echtes Ziel ohne --ton-frei bleibt 3: rc $R"
vn; R=$?; K=$(kernzeile kern)
[ "$R" = 0 ] && [[ "$K" == *"--master cypher_stumm-i:playback_F --cue cypher_stumm-i:playback_R --ton-frei"* || \
  "$K" == *"--master cypher_stumm-i:playback_F --cue cypher_stumm-i:playback_R --waechter-ms"* ]]
pruef $? "Z3 Negativ-Kontrolle Vorgabe (stumm, mit Cue): rc $R"
vn --master cypher_stumm-i:playback_F --cue cypher_stumm-i:playback_R; R=$?
pruef $([ "$R" = 0 ]; echo $?) "Z3 Negativ-Kontrolle stummer Cue bei stummem Master: rc $R"

# Z4 djk-ausgang gegen aufgezeichnete Ausgaben
cat > "$O/pwlink.txt" <<EOF
$N:playback_FL
  |<- cypherdj-vorhoerer:aus_L
  |<- Firefox:output_FL
$N:playback_FR
  |<- cypherdj-vorhoerer:aus_R
  |<- Firefox:output_FR
Firefox:output_FL
  |-> $N:playback_FL
alsa_output.usb-A.analog-stereo:playback_FL
  |<- cypherdj-kern:master_L
EOF
printf '57\t%s\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n70\talsa_output.usb-A.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tIDLE\n71\talsa_output.usb-B.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tIDLE\n' "$N" > "$O/sinks.txt"
cat > "$O/inputs.txt" <<'EOF'
Ziel-Eingabe #1144
	Ziel: 57
	Eigenschaften:
		application.name = "Firefox"
Ziel-Eingabe #228
	Ziel: 57
	Eigenschaften:
		application.name = "speech-dispatcher-dummy"
EOF
export DJK_FIX_PWLINK="$O/pwlink.txt" DJK_FIX_SINKS="$O/sinks.txt" DJK_FIX_INPUTS="$O/inputs.txt" DJK_FIX_DEFAULT=/dev/null
"$START/djk-ausgang" --senke "$D:playback_F" >"$O/z4.txt" 2>&1; R=$?
[ "$R" = 4 ] && grep -q 'FREMD  Firefox' "$O/z4.txt" && grep -q 'FREMD  speech-dispatcher-dummy' "$O/z4.txt" \
  && grep -q 'eigen  cypherdj-vorhoerer' "$O/z4.txt" && grep -q '1 djk-own, 2 foreign' "$O/z4.txt"
pruef $? "Z4 Fehlerfall fremde Clients an der echten Senke: rc $R: $(tail -1 "$O/z4.txt" | head -c 100)"
"$START/djk-ausgang" --senke alsa_output.usb-A.analog-stereo >"$O/z4.txt" 2>&1; R=$?
[ "$R" = 0 ] && grep -q 'eigen  cypherdj-kern' "$O/z4.txt" && ! grep -q FREMD "$O/z4.txt"
pruef $? "Z4 Negativ-Kontrolle nur eigener Client: rc $R"
"$START/djk-ausgang" --senke alsa_output.usb-B.analog-stereo >"$O/z4.txt" 2>&1; R=$?
[ "$R" = 0 ] && grep -q 'no client' "$O/z4.txt"; pruef $? "Z4 Negativ-Kontrolle leere Senke: rc $R"
"$START/djk-ausgang" --senke gibtsnicht >"$O/z4.txt" 2>&1; R=$?
[ "$R" = 2 ] && ! grep -q Traceback "$O/z4.txt"; pruef $? "Z4 unbekannte Senke: rc $R"
"$START/djk-ausgang" --senke >"$O/z4.txt" 2>&1; R=$?
[ "$R" = 2 ]; pruef $? "Z4 --senke ohne Wert: rc $R"
unset DJK_FIX_PWLINK DJK_FIX_SINKS DJK_FIX_INPUTS DJK_FIX_DEFAULT

# Z5 djk-stop --alles gegen Wegwerf-Prozesse
FAKE="$O/baum"; mkdir -p "$FAKE/vorhoerer/build" "$FAKE/cues" "$FAKE/units"
cp /usr/bin/sleep "$FAKE/vorhoerer/build/cypherdj-vorhoerer"
echo 'setTimeout(() => {}, 300000);' > "$FAKE/cues/server.ts"
echo 'setTimeout(() => {}, 300000);' > "$FAKE/cues/anderes.ts"
if systemctl --user list-units --all --no-legend 'cypherdj-*-h.service' 2>/dev/null | grep -q .; then
  echo "FEHL Z5 Instanz h ist belegt, Abschnitt übersprungen"; FEHL=$((FEHL + 1))
else
  # je Prozess ein Unter-Shell mit exec: $! ist dann die PID des Prozesses selbst, nie eines Vermittlers
  ( export CYPHERDJ_INSTANZ=h; exec "$FAKE/vorhoerer/build/cypherdj-vorhoerer" 300.001 ) </dev/null >/dev/null 2>&1 & echo $! > "$O/p_vh"
  ( export CYPHERDJ_INSTANZ=h; cd "$FAKE/cues"; exec node server.ts ) </dev/null >/dev/null 2>&1 & echo $! > "$O/p_cue"
  ( export CYPHERDJ_INSTANZ=g; exec "$FAKE/vorhoerer/build/cypherdj-vorhoerer" 300.002 ) </dev/null >/dev/null 2>&1 & echo $! > "$O/p_vg"
  ( exec sleep 300.003 ) </dev/null >/dev/null 2>&1 & echo $! > "$O/p_fremd"
  ( export CYPHERDJ_INSTANZ=h; exec python3 -c 'import time; time.sleep(300)' 300.004 "$FAKE/vorhoerer/build/cypherdj-vorhoerer" ) </dev/null >/dev/null 2>&1 & echo $! > "$O/p_koeder"
  ( export CYPHERDJ_INSTANZ=h; cd "$FAKE/cues"; exec node anderes.ts ) </dev/null >/dev/null 2>&1 & echo $! > "$O/p_anders"
  systemd-run --user --quiet --collect --unit=cypherdj-oberflaeche-h sleep 300.005
  sleep 1
  for f in p_vh p_cue p_vg p_fremd p_koeder p_anders; do PIDS+=("$(cat "$O/$f")"); done
  VH=$(cat "$O/p_vh"); CUE=$(cat "$O/p_cue"); VG=$(cat "$O/p_vg"); FR=$(cat "$O/p_fremd"); KO=$(cat "$O/p_koeder"); AN=$(cat "$O/p_anders")
  LEBEND=$(ps -eo pid,args | awk '/\/vorhoerer\/build\/cypherdj-vorhoerer --ausgang/ && !/djk-ziel-test/ {print $1; exit}')
  alle() { local p; for p in "$@"; do lebt "$p" || return 1; done; }
  alle "$VH" "$CUE" "$VG" "$FR" "$KO" "$AN" && systemctl --user is-active --quiet cypherdj-oberflaeche-h.service
  pruef $? "Z5 Aufbau: alle sechs Wegwerf-Prozesse und die Wegwerf-Unit laufen"
  DJK="$FAKE" "$START/djk-stop" --alles --trocken --instanz h >"$O/z5.txt" 2>&1; R=$?
  [ "$R" = 0 ] && grep -q "would stop cue-server pid $CUE" "$O/z5.txt" && grep -q "would stop vorhoerer pid $VH" "$O/z5.txt" \
    && ! grep -q "pid $VG\|pid $FR\|pid $KO\|pid $AN" "$O/z5.txt" && grep -q "would stop cypherdj-oberflaeche-h" "$O/z5.txt" \
    && alle "$VH" "$CUE" && systemctl --user is-active --quiet cypherdj-oberflaeche-h.service
  pruef $? "Z5 --trocken nennt genau die zwei Prozesse und die Unit und ändert nichts: rc $R"
  DJK="$FAKE" "$START/djk-stop" --instanz h --still >/dev/null 2>&1
  alle "$VH" "$CUE"; pruef $? "Z5 Negativ-Kontrolle: djk-stop ohne --alles lässt Cue-Server und Vorhörer stehen"
  systemd-run --user --quiet --collect --unit=cypherdj-oberflaeche-h sleep 300.005; sleep 0.5
  DJK="$FAKE" "$START/djk-stop" --alles --instanz h >"$O/z5.txt" 2>&1; R=$?
  ! lebt "$VH" && ! lebt "$CUE" && ! systemctl --user is-active --quiet cypherdj-oberflaeche-h.service && [ "$R" = 0 ]
  pruef $? "Z5 Fehlerfall: --alles beendet Cue-Server, Vorhörer und Unit der Instanz h: rc $R"
  alle "$VG" "$FR" "$KO" "$AN"; pruef $? "Z5 fremd bleibt: Vorhörer Instanz g, fremder sleep, Köder mit Pfad im Argument, anderes node-Skript"
  if [ -n "$LEBEND" ]; then lebt "$LEBEND"; pruef $? "Z5 der lebende Vorhörer der Sitzung (pid $LEBEND) blieb unberührt"; else echo "INFO Z5 kein lebender Vorhörer der Sitzung zum Gegenprüfen"; fi
fi

echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
