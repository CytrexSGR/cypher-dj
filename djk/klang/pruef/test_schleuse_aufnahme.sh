#!/usr/bin/env bash
# Test djk-schleuse ohne PipeWire: KEIN Fall erreicht den echten Aufnehmer (Stub über DJK_AUFNEHMER, dazu ein pw-jack-Wächter
# im PATH, der jede echte Aufnahme sichtbar macht). Rückgabe 0 = alle Fälle wie erwartet. Fasst keine Instanz an.
# Lauf 2 (Gegenprobe) läuft mit CYPHERDJ_INSTANZ=f in der Umgebung. SCHLEUSE=<pfad> prüft eine Mutante.
set -uo pipefail
DJK=$(cd "$(dirname "$0")/../.." && pwd); PY=$DJK/werkstatt/.venv/bin/python
SCHLEUSE=${SCHLEUSE:-$DJK/klang/djk-schleuse}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir "$T/bin"; export PY STUBLOG=$T/stub.log
cat > "$T/bin/pw-jack" <<W
#!/usr/bin/env bash
echo "ECHTER AUFNEHMERWEG: \$*" >> "$T/echt"; exit 99
W
chmod +x "$T/bin/pw-jack"; export PATH=$T/bin:$PATH
cat > "$T/stub" <<'STUB'
#!/usr/bin/env bash
echo "stub instanz=[${CYPHERDJ_INSTANZ-}]" >> "$STUBLOG"
while [ $# -gt 0 ]; do case "$1" in --datei) D=$2;; esac; shift; done
if [ "${STUBMODUS:-ton}" = schlaf ]; then echo $$ > "$STUB_PID"; exec sleep 300; fi
"$PY" -c "
import numpy as np, sys
from scipy.io import wavfile
t=np.arange(48000*2)/48000; x=(0.2*np.sin(2*np.pi*997*t)).astype('float32')
if sys.argv[2]=='stumm': x=x*0
wavfile.write(sys.argv[1], 48000, np.stack([x,x],1))" "$D" "${STUBMODUS:-ton}"
echo "{\"luecken\":${LUECKEN:-0},\"luecken_bei\":[],\"ueberlauf\":${UEBERLAUF:-0}}" > "$D.json"
STUB
chmod +x "$T/stub"; export DJK_AUFNEHMER=$T/stub
fehl=0
pruefe() { # Name Soll Ist Ausgabedatei [Muster]
  if [ "$2" = "$3" ] && { [ -z "${5:-}" ] || grep -q -- "$5" "$4"; }; then echo "ok   $1"; else echo "FEHL $1 (exit $3, soll $2)"; cat "$4" 2>/dev/null; fehl=1; fi; }
S() { env -u CYPHERDJ_INSTANZ -u LUECKEN -u UEBERLAUF -u STUBMODUS "$@"; }  # jeder Fall startet ohne geerbte Instanz
S "$SCHLEUSE" --ziel "$T/betrieb" > "$T/o" 2>&1; pruefe "Betrieb gesperrt (ohne Instanz)" 2 $? "$T/o" "Betriebs-Aufnahme gesperrt"
[ ! -e "$T/betrieb" ] && echo "ok   Betrieb: kein Ziel angelegt" || { echo "FEHL Ziel angelegt"; fehl=1; }
LUECKEN=1 S env LUECKEN=1 "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/l" > "$T/o" 2>&1; pruefe "Lücken=1 -> Exit 2" 2 $? "$T/o" "FEHLER: Aufnahme lückenhaft"
S env UEBERLAUF=3 "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/u" > "$T/o" 2>&1; pruefe "Überlauf=3 -> Exit 2" 2 $? "$T/o" "FEHLER: Aufnahme lückenhaft"
S "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/g" > "$T/o" 2>&1; pruefe "Lücken=0 -> BESTANDEN Exit 0" 0 $? "$T/o" "BESTANDEN"
S env STUBMODUS=stumm "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/s" > "$T/o" 2>&1; pruefe "stumm -> DURCHGEFALLEN Exit 1" 1 $? "$T/o" "VERSTOSS lautheit"
S "$SCHLEUSE" --instanz j --sekunden 2 --ziel "$T/j" > "$T/o" 2>&1; pruefe "Instanz j -> Exit 2" 2 $? "$T/o" "ungültig"
for w in 0 601 abc -5 2.5 ""; do S "$SCHLEUSE" --instanz f --sekunden "$w" --ziel "$T/w" > "$T/o" 2>&1; pruefe "--sekunden '$w' -> Exit 2" 2 $? "$T/o" "ungültig"; done
S env STUBMODUS=schlaf STUB_PID="$T/pid1" DJK_AUFNEHMER_FRIST=2 "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/h" > "$T/o" 2>&1; pruefe "Aufnehmer hängt -> Exit 2" 2 $? "$T/o" "FEHLER: Aufnehmer hängt"
sleep 0.3; kill -0 "$(cat "$T/pid1")" 2>/dev/null && { echo "FEHL Stub nach Frist noch da"; fehl=1; } || echo "ok   Stub nach Frist beendet"
env -u CYPHERDJ_INSTANZ STUBMODUS=schlaf STUB_PID="$T/pid2" "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/t" > "$T/o" 2>&1 & SP=$!
for _ in $(seq 50); do [ -s "$T/pid2" ] && break; sleep 0.1; done
kill -TERM "$SP"; wait "$SP"; RC=$?; sleep 0.3
kill -0 "$(cat "$T/pid2")" 2>/dev/null && { echo "FEHL TERM: Stub verwaist"; fehl=1; kill "$(cat "$T/pid2")"; } || echo "ok   TERM: kein verwaister Stub (Exit $RC)"
# Wächter-Selbsttest: der echte Weg (ohne Stub) landet im pw-jack-Wächter, nie im echten Aufnehmer
env -u CYPHERDJ_INSTANZ -u DJK_AUFNEHMER "$SCHLEUSE" --instanz f --sekunden 2 --ziel "$T/e" > "$T/o" 2>&1; pruefe "Wächter fängt echten Weg" 2 $? "$T/o" "gescheitert"
[ -s "$T/echt" ] && echo "ok   Wächter hat den echten Weg gesehen" || { echo "FEHL Wächter blind"; fehl=1; }
n=$(wc -l < "$T/echt"); [ "$n" = 1 ] && echo "ok   genau 1 Wächter-Treffer (nur der Selbsttest)" || { echo "FEHL $n Wächter-Treffer"; fehl=1; }
grep -q 'instanz=\[\]' "$T/stub.log" && { echo "FEHL Stub sah leere Instanz"; fehl=1; } || echo "ok   Stub-Log: nie leere Instanz ($(wc -l < "$T/stub.log") Aufrufe)"
# Gegenprobe: derselbe Test mit CYPHERDJ_INSTANZ=f in der Umgebung
if [ -z "${SCHLEUSE_TEST_INNER:-}" ]; then
  CYPHERDJ_INSTANZ=f SCHLEUSE_TEST_INNER=1 bash "$0" > "$T/inner" 2>&1; r=$?
  [ $r = 0 ] && echo "ok   Gegenprobe mit CYPHERDJ_INSTANZ=f in der Umgebung ($(grep -c '^ok' "$T/inner") ok)" || { echo "FEHL Gegenprobe"; cat "$T/inner"; fehl=1; }
fi
exit $fehl
