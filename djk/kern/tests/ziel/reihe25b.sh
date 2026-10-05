#!/bin/bash
# Teil B ohne äußeres Schloss: Prüfstand 16 und Abnahme 01 nehmen das Echtzeit-Schloss selbst
cd ~/cypher-dj || exit 4
export CYPHERDJ_INSTANZ=a
L=djk/kern/tests/ziel/laeufe; mkdir -p $L
last() { echo "LAST $1 $(cut -d' ' -f1-3 /proc/loadavg)"; }
warte_last() { local t=0; until awk '{exit !($1 <= 8.0)}' /proc/loadavg; do sleep 15; t=$((t+15)); [ $t -ge 1800 ] && { echo "LAST-ABBRUCH $1 $(cat /proc/loadavg)"; return 1; }; done; last "$1"; }
# Querprobe mit dem Prüfstand aus 16 (Nachtrag A) und Regression 18 (kill -9 mit Selbst-Wächter)
for p in "kill-neustart djk/kern/tests/neustart/profile/kill-neustart.toml" "ruhe-kern djk/pruefstand/profile/ruhe-kern.toml --kurz 60"; do
  set -- $p; n=$1; shift; warte_last quer16-$n || exit 5
  rm -f /dev/shm/cypherdj-a/zustand
  python3 djk/pruefstand/pruefstand.py lauf "$@" > $L/quer16-$n.log 2>&1; echo "quer16-$n rc=$?"; tail -4 $L/quer16-$n.log
done
warte_last regression01 || exit 5
djk/pruefstand/klick/abnahme.sh > $L/regression01.log 2>&1; echo "reg01 rc=$?"; tail -8 $L/regression01.log
last ende
echo REIHE-B-ENDE
