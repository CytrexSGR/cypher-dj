#!/usr/bin/env bash
# Glanz 2.1 (F22) Prüfstand an echter ALSA-Hardware: Karte der PCI-Adresse 0000:16:00.1 (Rembrandt-HDMI, in PipeWire
# ohne Knoten). Der Digital-Out (16:00.6) wird NIE berührt. Ein Beobachter (alsactl monitor) stempelt jede Änderung
# von 'IEC958 Playback Switch',0 und misst off->on unabhängig von der Wache (Ereignisse paarweise: off, on).
# D1 ohne Wache bleibt off · D2 Ereignisweg 20/20, max <= 200 ms, kampf · D3 index=1 zählt nicht · D4 Takt allein 5/5, <= 1200 ms
# W=/dev/null ersetzt die Wache durch nichts (Vorher-Lauf). Rückgabe 0 alles OK, 1 ein Punkt FEHL, 2 Aufbau.
set -uo pipefail
HIER=$(cd "$(dirname "$0")" && pwd); W=${W:-"$HIER/../digitalwache.py"}
PCI=0000:16:00.1; S="name='IEC958 Playback Switch'"
K=$(basename /sys/bus/pci/devices/$PCI/sound/card* 2>/dev/null | sed 's/^card//')
[[ "$K" =~ ^[0-9]+$ ]] || { echo "Karte zu $PCI fehlt" >&2; exit 2; }
wert() { amixer -c "$K" cget "$S${1:+,index=$1}" | sed -n 's/^ *: values=//p'; }
[ "$(wert)" = on ] && [ "$(wert 1)" = on ] || { echo "Schalter auf Karte $K vorher nicht on, nichts angefasst" >&2; exit 2; }
O=$(mktemp -d "${TMPDIR:-/tmp}/djk-digitalwache.XXXX"); OK=0; FEHL=0; WP=""; BP=""
pruef() { if [ "$1" = 0 ]; then echo "OK   $2"; OK=$((OK + 1)); else echo "FEHL $2"; FEHL=$((FEHL + 1)); fi; }
aufraeumen() { [ -n "$WP" ] && kill "$WP" 2>/dev/null; [ -n "$BP" ] && kill "$BP" 2>/dev/null
  amixer -q -c "$K" cset "$S" on; amixer -q -c "$K" cset "$S,index=1" on; }
trap aufraeumen EXIT
python3 - "$K" "$O/beob.txt" <<'PY' & BP=$!
import signal, subprocess, sys, time
k, aus = sys.argv[1], open(sys.argv[2], "w", buffering=1)
m = subprocess.Popen(["stdbuf", "-oL", "alsactl", "monitor", f"hw:{k}"], stdout=subprocess.PIPE, text=True)
signal.signal(signal.SIGTERM, lambda *_: (m.kill(), sys.exit(0)))   # kein verwaister alsactl
for z in m.stdout:
    if "IEC958 Playback Switch,0)" in z:
        aus.write(f"{time.monotonic():.4f}\n")
PY
sleep 0.5
dauern() { python3 -c '
import sys
t=[float(l) for l in open(sys.argv[1])][int(sys.argv[2]):]
d=[b-a for a,b in zip(t[0::2],t[1::2])]
print(len(d), round(max(d)*1000) if d else -1)' "$O/beob.txt" "$1"; }
stand() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2" 2>/dev/null; }
# D1 vorher (Fehlerfall heute ohne Wache: Stille, bis jemand schaltet)
amixer -q -c "$K" cset "$S" off; sleep 2; V=$(wert); amixer -q -c "$K" cset "$S" on; sleep 0.3
[ "$V" = off ]; pruef $? "D1 ohne Wache: nach 2 s $V (erwartet off)"
# D2 Ereignisweg
Z0=$(wc -l < "$O/beob.txt")
python3 "$W" --pci "$PCI" --status "$O/d2.json" --takt-ms 5000 > "$O/d2.log" 2>&1 & WP=$!; sleep 1
for i in $(seq 1 20); do amixer -q -c "$K" cset "$S" off; sleep 1; done
read -r N MAX <<< "$(dauern "$Z0")"
F=$(stand "$O/d2.json" faelle); ZU=$(stand "$O/d2.json" zustand)
E=$(grep -c "quelle=ereignis" "$O/d2.log"); T=$(grep -c "quelle=takt" "$O/d2.log")
# Gemessen 06.10.: fällt ein Abfall genau auf die Taktprüfung, heilt der Takt ihn (1 von 20, auch dann 3 ms). Richtig,
# nicht falsch: deshalb Ereignis + Takt = 20 und Takt höchstens 2 (der Ereignisweg muss tragen, nicht der Takt).
[ "$N" = 20 ] && [ "$MAX" -le 200 ] && [ "$F" = 20 ] && [ $((E + T)) = 20 ] && [ "$T" -le 2 ] && [ "$ZU" = kampf ]
pruef $? "D2 Ereignisweg: $N von 20 wieder an, max off->on $MAX ms (<= 200), Wache faelle $F, quelle=ereignis $E takt $T, zustand $ZU"
# D3 Negativ-Kontrolle
C0=$(grep -c "war aus" "$O/d2.log")
for i in 1 2 3 4 5; do amixer -q -c "$K" cset "$S,index=1" off; sleep 0.3; amixer -q -c "$K" cset "$S,index=1" on; sleep 0.3; done
sleep 1.2; F3=$(stand "$O/d2.json" faelle)
[ "$F3" = 20 ] && [ "$(grep -c "war aus" "$O/d2.log")" = "$C0" ]; pruef $? "D3 index=1 geschaltet: Wache faelle $F3 (erwartet 20)"
kill "$WP"; wait "$WP" 2>/dev/null; WP=""
# D4 nur Takt
Z0=$(wc -l < "$O/beob.txt")
python3 "$W" --pci "$PCI" --status "$O/d4.json" --alsactl '' --takt-ms 1000 > "$O/d4.log" 2>&1 & WP=$!; sleep 1
for i in 1 2 3 4 5; do amixer -q -c "$K" cset "$S" off; sleep 2; done
read -r N MAX <<< "$(dauern "$Z0")"
[ "$N" = 5 ] && [ "$MAX" -le 1200 ] && [ "$(grep -c "quelle=takt" "$O/d4.log")" = 5 ]
pruef $? "D4 Takt allein: $N von 5 wieder an, max off->on $MAX ms (<= 1200)"
echo "ERGEBNIS $OK OK, $FEHL FEHL; Ausgaben $O"
[ "$FEHL" = 0 ]
