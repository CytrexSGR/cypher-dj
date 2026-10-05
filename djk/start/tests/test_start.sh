#!/usr/bin/env bash
# Prüflauf für djk-start und djk-stop an einer eigenen Null-Senke (ROADMAP §8.4) in einer Prüfinstanz (Z2).
# Kein Ton: Senke cypherdj-pruef-<i>-start (vier Kanäle), Riegel-Ziele nur stumm/cypherdj-pruef-*.
# Aufruf: tests/test_start.sh [instanz a..i, Vorgabe i]
# Prüfpunkte:
#   P1 Riegel: fremdes Ziel ohne --ton-frei -> Rückgabe 3, Meldung nennt --ton-frei, 0 Units
#   P2 Fehlerfall: belegter Oberflächen-Port -> Rückgabe 4, Meldung nennt Port, 0 Units, Senke unberührt
#   P3 Start an der Prüf-Senke (Negativ-Kontrolle dabei: ein harmloser Nachbar-Port ist belegt) -> Rückgabe 0, URL
#   P4 vier Units aktiv
#   P5 Kern- und Notbahn-Ausgänge hängen an der Prüf-Senke, Kante Kern -> Notbahn verbunden
#   P6 Leitstand-WS lauscht, Oberfläche liefert GET / mit 200
#   P7 --zustand meldet alle vier aktiv
#   P8 zweiter Start bei laufendem Verbund -> Abbruch, weiter vier Units (nichts doppelt)
#   P9 djk-stop -> 0 Units, keine JACK-Clients der Instanz, Zustandsdatei weg, Kern-Zustand /dev/shm/cypherdj-<i>/zustand weg
#   P10 Vorgabe ohne --master: djk-start legt die stumme Senke der Instanz an, djk-stop entlädt sie -> 0 Senken
#   P11 --kern-konfig mit udp_port 47170 und eigenem Arbeitsbestand: Kern lauscht dort, Oberfläche und Leitstand melden
#       denselben Kern-Port, die Oberfläche den Arbeitsbestand, und sie ist mit dem Kern verbunden (Gegenprobe P3)
#   P12 Prüfmodus: Vorgabe-Start sagt ihn an und der Kern meldet "Prüfmodus an"; --ohne-pruefmodus: "aus", keine Ansage
#   P14 Erkennung "tot" (Funktion aus djk-start) an Wegwerf-Units: Neustart-Pause (Rückgabe 1, Restart=always) -> tot;
#       Negativ-Kontrolle: laufende Unit -> nicht tot
#   P13 toter Satellit (Leitstand-Konfiguration mit unbekanntem Schlüssel, Rückgabe 2): Abbruch 5 in unter 5 s, 0 Units
# Rückgabe: 0 alle Punkte OK, 1 mindestens einer FEHL, 2 Aufbau (Last, Schloss).
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd)
START=$(cd "$HIER/.." && pwd)
I=${1:-i}
case "$I" in [a-i]) K=$(( $(printf '%d' "'$I") - 96 ));; *) echo "Instanz a bis i" >&2; exit 2;; esac
LAST=$(cut -d' ' -f1 /proc/loadavg)
python3 -c "import sys; sys.exit(0 if float('$LAST') <= 4 else 1)" || { echo "1-min-Last $LAST > 4, kein Start" >&2; exit 2; }
exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
flock -w 900 9 || { echo "kein Echtzeit-Schloss" >&2; exit 2; }
echo "Instanz $I, Last vorher $(cut -d' ' -f1-3 /proc/loadavg)"

SENKE=cypherdj-pruef-$I-start
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-start-test.XXXX")
SHM_VORHER=0; [ -e "/dev/shm/cypherdj-$I" ] && SHM_VORHER=1
cat > "$O/leitstand.toml" <<EOF
version = 1
ws_port = 47200
abo_port = 47110
set_basis_bpm = 128.0
autonomie_start = 1
bestand = "~/cypher-dj/bestand"
sets = "$O/sets"
rechner_socket = "$O/rechner.sock"
zug_vorlauf_takte = 12
antwort_frist_takte = 4
nachrender_ruhe_takte = 16
grenzen_tief_verriegeln = false
EOF
UNITS="cypherdj-kern-$I cypherdj-notbahn-$I cypherdj-leitstand-$I cypherdj-oberflaeche-$I"
OK=0; FEHL=0
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
aktive() { local n=0 u; for u in $UNITS; do [ "$(systemctl --user is-active "$u.service" 2>/dev/null)" = active ] && n=$((n + 1)); done; echo $n; }
geladen() { systemctl --user list-units --all --no-legend --plain "cypherdj-*-$I.service" 2>/dev/null | grep -c . ; }
MOD=""; HALTER=""
aufraeumen() {
  [ -n "$HALTER" ] && kill "$HALTER" 2>/dev/null
  for d in tot lebt; do systemctl --user stop "cypherdj-pruef-$I-$d.service" 2>/dev/null; systemctl --user reset-failed "cypherdj-pruef-$I-$d.service" 2>/dev/null; done
  "$START/djk-stop" --instanz "$I" >/dev/null 2>&1
  [ -n "$MOD" ] && pactl unload-module "$MOD" 2>/dev/null
  [ "$SHM_VORHER" = 0 ] && rm -rf "/dev/shm/cypherdj-$I"
}
trap aufraeumen EXIT
halte_tcp() { python3 -c 'import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(); time.sleep(600)' "$1" & HALTER=$!; sleep 0.3; }

MOD=$(pactl load-module module-null-sink sink_name="$SENKE" channels=4 \
  channel_map=front-left,front-right,rear-left,rear-right sink_properties=node.description="$SENKE")
for _ in $(seq 1 50); do pw-link -i | grep -qx "$SENKE:playback_RL" && break; sleep 0.1; done
ZIEL=(--instanz "$I" --master "$SENKE:playback_F" --cue "$SENKE:playback_R" --leitstand-konfig "$O/leitstand.toml")

# P1 Riegel
"$START/djk-start" --instanz "$I" --master "alsa_output.echt:playback_F" > "$O/p1.txt" 2>&1; R=$?
[ "$R" = 3 ] && grep -q -- "--ton-frei" "$O/p1.txt" && [ "$(geladen)" = 0 ]; pruef $? "P1 Riegel: Rückgabe $R, Units $(geladen): $(head -1 "$O/p1.txt")"

# P2 Fehlerfall belegter Port
OPORT=$((47300 + 1000 * K))
halte_tcp "$OPORT"
"$START/djk-start" "${ZIEL[@]}" > "$O/p2.txt" 2>&1; R=$?
kill "$HALTER"; wait "$HALTER" 2>/dev/null; HALTER=""
SENKE_DA=$(pw-link -i | grep -c "^$SENKE:")
[ "$R" = 4 ] && grep -q "$OPORT" "$O/p2.txt" && [ "$(geladen)" = 0 ] && [ "$SENKE_DA" = 4 ] \
  && [ -z "$(pw-link -o | grep -- "-$I:")" ]
pruef $? "P2 Port $OPORT belegt: Rückgabe $R, Units $(geladen), JACK-Clients der Instanz $(pw-link -o | grep -c -- "-$I:"): $(grep -m1 "$OPORT" "$O/p2.txt")"

# P3 Start, Negativ-Kontrolle: Nachbar-Port belegt
halte_tcp $((OPORT + 1))
"$START/djk-start" "${ZIEL[@]}" > "$O/p3.txt" 2>&1; R=$?
kill "$HALTER"; wait "$HALTER" 2>/dev/null; HALTER=""
[ "$R" = 0 ] && grep -q "http://127.0.0.1:$OPORT/" "$O/p3.txt"; pruef $? "P3 Start mit belegtem Nachbar-Port $((OPORT + 1)): Rückgabe $R"
[ "$R" = 0 ] || sed 's/^/     /' "$O/p3.txt"

# P4 Units
pruef $([ "$(aktive)" = 4 ]; echo $?) "P4 Units aktiv: $(aktive) von 4"

# P5 Verbindungen
pw-link -l > "$O/links.txt"
V=0
for q in "cypherdj-kern-$I:master_L" "cypherdj-kern-$I:master_R" "cypherdj-kern-$I:cue_L" "cypherdj-notbahn-$I:master_L" "cypherdj-notbahn-$I:cue_R"; do
  grep -A4 -x "$q" "$O/links.txt" | grep -q "|->.*$SENKE:playback_" && V=$((V + 1))
done
grep -A4 -x "cypherdj-kern-$I:master_L" "$O/links.txt" | grep -q "|-> *cypherdj-notbahn-$I:kante" && V=$((V + 1))
pruef $([ "$V" = 6 ]; echo $?) "P5 Verbindungen an der Prüf-Senke und Kante: $V von 6"

# P6 Leitstand und Oberfläche
WS=$((47200 + 1000 * K))
ss -Hlnt "sport = :$WS" | grep -q . ; W=$?
C=$(curl -s -o "$O/index.html" -w '%{http_code}' "http://127.0.0.1:$OPORT/")
[ "$W" = 0 ] && [ "$C" = 200 ] && grep -qi "<html" "$O/index.html"; pruef $? "P6 Leitstand-WS $WS lauscht ($W), GET / $C"

# P7 Zustand
"$START/djk-start" --instanz "$I" --zustand > "$O/p7.txt" 2>&1; R=$?
ZA=$(grep -cE "^  cypherdj-[a-z]+-$I +active +pid [1-9][0-9]* +restarts 0$" "$O/p7.txt")
[ "$R" = 0 ] && [ "$ZA" = 4 ]; pruef $? "P7 --zustand: Rückgabe $R, Zeilen 'active pid <n> restarts 0': $ZA von 4"
[ "$ZA" = 4 ] || sed 's/^/     /' "$O/p7.txt"

# P8 zweiter Start
PID_VOR=$(systemctl --user show -p MainPID --value "cypherdj-kern-$I")
"$START/djk-start" "${ZIEL[@]}" > "$O/p8.txt" 2>&1; R=$?
PID_NACH=$(systemctl --user show -p MainPID --value "cypherdj-kern-$I")
[ "$R" != 0 ] && [ "$(aktive)" = 4 ] && [ "$PID_VOR" = "$PID_NACH" ]; pruef $? "P8 zweiter Start: Rückgabe $R, aktiv $(aktive), Kern-PID $PID_VOR/$PID_NACH: $(head -1 "$O/p8.txt")"

# P9 Stopp
[ -e "/dev/shm/cypherdj-$I/neustarts" ]; NEU_VOR=$?  # F20: der Kern hat die Bremsdatei angelegt (0 = liegt)
"$START/djk-stop" --instanz "$I" > "$O/p9.txt" 2>&1; R=$?
sleep 0.5
J=$(pw-link -o | grep -c -- "-$I:")
[ "$R" = 0 ] && [ "$(geladen)" = 0 ] && [ "$J" = 0 ] && [ ! -e "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/cypherdj-$I/start.env" ] \
  && [ ! -e "/dev/shm/cypherdj-$I/zustand" ] && [ "$NEU_VOR" = 0 ] && [ ! -e "/dev/shm/cypherdj-$I/neustarts" ]
pruef $? "P9 djk-stop: Rückgabe $R, Units $(geladen), JACK-Ports der Instanz $J, Kern-Zustand $([ -e "/dev/shm/cypherdj-$I/zustand" ] && echo liegt || echo weg), neustarts vorher $([ "$NEU_VOR" = 0 ] && echo da || echo fehlte)/nachher $([ -e "/dev/shm/cypherdj-$I/neustarts" ] && echo liegt || echo weg)"

# P10 Vorgabe-Senke
"$START/djk-start" --instanz "$I" --leitstand-konfig "$O/leitstand.toml" > "$O/p10.txt" 2>&1; R=$?
A=$(aktive); S1=$(pactl list short sinks | grep -c "stumm-$I")
"$START/djk-stop" --instanz "$I" > "$O/p10b.txt" 2>&1; R2=$?
sleep 0.5
S2=$(pactl list short sinks | grep -c "stumm-$I")
[ "$R" = 0 ] && [ "$A" = 4 ] && [ "$S1" = 1 ] && [ "$R2" = 0 ] && [ "$S2" = 0 ] && [ "$(geladen)" = 0 ]
pruef $? "P10 Vorgabe stumme Senke: Start $R, aktiv $A, Senke $S1 -> nach Stopp $S2, Units $(geladen)"
[ "$R" = 0 ] || sed 's/^/     /' "$O/p10.txt"

# P11 abweichender Kern-Port und Arbeitsbestand aus --kern-konfig
sed -e 's|^udp_port *=.*|udp_port = 47170|' -e 's|^arbeitsbestand *=.*|arbeitsbestand = "/dev/shm/cypherdj/material-abw"|' \
  "$START/../konfig/kern.toml" > "$O/kern.toml"
KP=$((47170 + 1000 * K))
T=$(date '+%Y-%m-%d %H:%M:%S')
"$START/djk-start" "${ZIEL[@]}" --kern-konfig "$O/kern.toml" > "$O/p11.txt" 2>&1; R=$?
ss -Hlnu "sport = :$KP" | grep -q . ; KL=$?
sleep 1
OFZ=$(journalctl --user -u "cypherdj-oberflaeche-$I" --since "$T" -o cat --no-pager | grep '^oberflaeche:' | tail -1)
LSZ=$(journalctl --user -u "cypherdj-leitstand-$I" --since "$T" -o cat --no-pager | grep '^leitstand:' | tail -1)
KV=$(curl -s --max-time 1 "http://127.0.0.1:$OPORT/strom" | head -1 | grep -o '"kern":"[a-z_]*"')
"$START/djk-stop" --instanz "$I" > /dev/null 2>&1
[ "$R" = 0 ] && [ "$KL" = 0 ] && [[ "$OFZ" == *"kern $KP "* ]] && [[ "$OFZ" == *"arbeitsbestand /dev/shm/cypherdj-$I/material-abw"* ]] \
  && [[ "$LSZ" == *"kern $KP"* ]] && [ "$KV" = '"kern":"verbunden"' ]
pruef $? "P11 --kern-konfig udp $KP: Start $R, Kern lauscht ($KL), Seite: ${OFZ:-?} | Leitstand: ${LSZ:-?} | Seite->Kern $KV"
[ "$R" = 0 ] || sed 's/^/     /' "$O/p11.txt"

# P12 Prüfmodus: Vorgabe an (Ansage beim Start), --ohne-pruefmodus aus
T=$(date '+%Y-%m-%d %H:%M:%S')
"$START/djk-start" "${ZIEL[@]}" > "$O/p12a.txt" 2>&1; R=$?
KA=$(journalctl --user -u "cypherdj-kern-$I" --since "$T" -o cat --no-pager | grep -o 'Prüfmodus [a-z]*' | tail -1)
"$START/djk-stop" --instanz "$I" > /dev/null 2>&1
sleep 1; T=$(date '+%Y-%m-%d %H:%M:%S')
"$START/djk-start" "${ZIEL[@]}" --ohne-pruefmodus > "$O/p12b.txt" 2>&1; R2=$?
KB=$(journalctl --user -u "cypherdj-kern-$I" --since "$T" -o cat --no-pager | grep -o 'Prüfmodus [a-z]*' | tail -1)
"$START/djk-stop" --instanz "$I" > /dev/null 2>&1
[ "$R" = 0 ] && [ "$KA" = "Prüfmodus an" ] && grep -qi "pruefmodus" "$O/p12a.txt" && [ "$R2" = 0 ] && [ "$KB" = "Prüfmodus aus" ] \
  && ! grep -q "test mode  ON" "$O/p12b.txt" && grep -q "without --pruefmodus" "$O/p12b.txt"
pruef $? "P12 Prüfmodus: Vorgabe $R -> '${KA:-?}' ($(grep -i -m1 'test mode' "$O/p12a.txt")), --ohne-pruefmodus $R2 -> '${KB:-?}'"

# P13 toter Satellit: Leitstand scheitert mit Rückgabe 2 (unbekannter Schlüssel), djk-start soll nicht 10 s warten
{ cat "$O/leitstand.toml"; echo 'gibt_es_nicht = 1'; } > "$O/leitstand-kaputt.toml"
A0=$(date +%s.%N)
"$START/djk-start" --instanz "$I" --master "$SENKE:playback_F" --cue "$SENKE:playback_R" --leitstand-konfig "$O/leitstand-kaputt.toml" \
  > "$O/p13.txt" 2>&1; R=$?
DAUER=$(python3 -c "import sys; print(f'{float(sys.argv[2]) - float(sys.argv[1]):.1f}')" "$A0" "$(date +%s.%N)")
[ "$R" = 5 ] && python3 -c "import sys; sys.exit(0 if float('$DAUER') < 5 else 1)" && [ "$(geladen)" = 0 ]
pruef $? "P13 toter Leitstand: Rückgabe $R nach $DAUER s, Units $(geladen): $(grep -m1 leitstand "$O/p13.txt")"

# P14 Erkennung der Neustart-Pause (der Zweig, den P13 mit Rückgabe 2 nicht erreicht)
eval "$(sed -n '/^tot() {/,/^}/p' "$START/djk-start")"
systemd-run --user --quiet --collect --unit="cypherdj-pruef-$I-tot" -p Restart=always -p RestartSec=30 /bin/sh -c 'exit 1'
systemd-run --user --quiet --collect --unit="cypherdj-pruef-$I-lebt" /bin/sleep 30
sleep 0.5
tot "cypherdj-pruef-$I-tot"; T1=$?; tot "cypherdj-pruef-$I-lebt"; T2=$?
ZT=$(systemctl --user show -p SubState --value "cypherdj-pruef-$I-tot.service")
for d in tot lebt; do systemctl --user stop "cypherdj-pruef-$I-$d.service" 2>/dev/null; done
[ "$T1" = 0 ] && [ "$T2" = 1 ]; pruef $? "P14 tot(): Unit in $ZT -> $T1 (0 = tot), laufende Unit -> $T2 (1 = lebt)"

# P15 --strudel: fünfte Unit (Erzeuger), er meldet sich beim Kern an (/k/hallo → Abonnent), djk-stop räumt sie ab
"$START/djk-start" "${ZIEL[@]}" --strudel > "$O/p15.txt" 2>&1; R=$?
sleep 1.5
E=$(systemctl --user is-active "cypherdj-erzeuger-$I.service" 2>/dev/null)
"$START/djk-stop" --instanz "$I" > "$O/p15stop.txt" 2>&1
E2=$(systemctl --user list-units --all --no-legend --plain "cypherdj-erzeuger-$I.service" 2>/dev/null | wc -l)
[ "$R" = 0 ] && [ "$E" = active ] && grep -q 'strudel    ready' "$O/p15.txt" && [ "$E2" = 0 ]
pruef $? "P15 --strudel: Start $R, Erzeuger $E, Zeile 'strudel ready' $(grep -c 'strudel    ready' "$O/p15.txt"), nach Stopp Units $E2"

# P16 Loop-Boxen (MVP 2): die Seite bekommt den Loop-Ordner der Instanz und listet ihn
DJK=$(cd "$START/.." && pwd)
P_OF16=$(( 47300 + 1000 * ($(printf '%d' "'$I") - 96) ))
"$START/djk-start" "${ZIEL[@]}" > "$O/p16.txt" 2>&1; R=$?
"$DJK/werkstatt/.venv/bin/python" "$DJK/loops/pruef_loop.py" "/dev/shm/cypherdj-$I/loops" p16-probe > /dev/null 2>&1
L=$(curl -s --max-time 3 "http://127.0.0.1:$P_OF16/loops")
EXEC=$(systemctl --user show -p ExecStart --value "cypherdj-oberflaeche-$I")  # Review: CYPHERDJ_INSTANZ allein fände den Ordner auch
"$START/djk-stop" --instanz "$I" > "$O/p16stop.txt" 2>&1
rm -rf "/dev/shm/cypherdj-$I/loops/p16-probe"
[ "$R" = 0 ] && [[ "$EXEC" == *"--loops /dev/shm/cypherdj-$I/loops"* ]] && [[ "$L" == *'"name":"p16-probe"'* ]] && grep -q "loops /dev/shm/cypherdj-$I/loops" "$O/p16.txt"
pruef $? "P16 Loops: Start $R, /loops kennt p16-probe $([[ "$L" == *p16-probe* ]] && echo ja || echo nein), Zeile 'loops' $(grep -c "loops /dev/shm/cypherdj-$I/loops" "$O/p16.txt")"
pactl unload-module "$MOD"; MOD=""
SREST=$(pactl list short sinks | grep -c "cypherdj-pruef-$I-\|stumm-$I")
pruef $([ "$SREST" = 0 ] && [ "$(geladen)" = 0 ]; echo $?) "Ende: Units $(geladen), Senken der Instanz $SREST"
echo "Last nachher $(cut -d' ' -f1-3 /proc/loadavg); Ausgaben $O"
echo "ERGEBNIS $OK OK, $FEHL FEHL"
[ "$FEHL" = 0 ]
