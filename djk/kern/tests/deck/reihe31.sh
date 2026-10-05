#!/bin/bash
# Scheibe 31: Regressionen 18, 08, 01 und die Stems-Abnahme mit dem Kern dieser Scheibe, dazu die Kosten, nacheinander.
# Aufruf: djk/kern/tests/deck/reihe31.sh (Teil A hält das Echtzeit-Schloss selbst, Teil B nehmen die Skripte selbst).
# Jeder Schritt wartet, bis die 1-min-Last höchstens 8 ist (über 4 gelten Echtzeit-Zahlen vorläufig, höchstens 30 min).
. "$(dirname "$0")/../../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
cd ~/cypher-dj || exit 4
export CYPHERDJ_INSTANZ=a
L=djk/kern/tests/deck/laeufe; mkdir -p $L
last() { echo "LAST $1 $(cut -d' ' -f1-3 /proc/loadavg)"; }
warte_last() { local t=0; until awk '{exit !($1 <= 8.0)}' /proc/loadavg; do sleep 15; t=$((t+15)); [ $t -ge 1800 ] && { echo "LAST-ABBRUCH $1 $(cat /proc/loadavg)"; return 1; }; done; last "$1"; }
(
  flock -w 10800 9 || exit 3
  export CYPHERDJ_SCHLOSS_GEHALTEN=1
  warte_last regression18 || exit 5
  djk/kern/tests/neustart/serie.sh --lauf reg18-kill-31 --art kill --anzahl 5 --kern-arg --waechter-ms --kern-arg 100 > $L/regression18-kill.log 2>&1; echo "reg18-kill rc=$?"; tail -5 $L/regression18-kill.log
  warte_last regression08 || exit 5
  CYPHERDJ_SCHLOSS=gehalten KERN01=${TMPDIR:-/tmp}/djk18/kern01-cypherdj-kern djk/kern/tests/ziel/abnahme.sh > $L/regression08.log 2>&1; echo "reg08 rc=$?"; tail -8 $L/regression08.log
  warte_last stems || exit 5
  python3 djk/kern/tests/deck/ziel_lauf.py --art stems --lauf st > $L/stems.log 2>&1; echo "stems rc=$?"; tail -c 600 $L/stems.log
) 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
warte_last regression01 || exit 5
djk/pruefstand/klick/abnahme.sh > $L/regression01.log 2>&1; echo "reg01 rc=$?"; tail -8 $L/regression01.log
last ende
echo REIHE-ENDE
