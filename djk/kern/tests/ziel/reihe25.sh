#!/bin/bash
# Reihe der Läufe am Ziel für Scheibe 25, unter EINEM Echtzeit-Schloss (Aufrufer: flock ... env CYPHERDJ_SCHLOSS_GEHALTEN=1)
# Aufruf: flock -w 10800 $CYPHERDJ_ECHTZEIT_SCHLOSS env CYPHERDJ_SCHLOSS_GEHALTEN=1 djk/kern/tests/ziel/reihe25.sh; danach reihe25b.sh
# Jeder Schritt wartet, bis die 1-min-Last höchstens 8 ist (Hauptinstanz 2026-09-26; über 4 gelten Echtzeit-Zahlen vorläufig) (höchstens 30 min, sonst LAST-ABBRUCH, Rückgabe 5).
cd ~/cypher-dj || exit 4
export CYPHERDJ_INSTANZ=a
L=djk/kern/tests/ziel/laeufe; mkdir -p $L
F=djk/vertrag/folgen; Z=djk/kern/tests/ziel
last() { echo "LAST $1 $(cut -d' ' -f1-3 /proc/loadavg)"; }
warte_last() { local t=0; until awk '{exit !($1 <= 8.0)}' /proc/loadavg; do sleep 15; t=$((t+15)); [ $t -ge 1800 ] && { echo "LAST-ABBRUCH $1 $(cat /proc/loadavg)"; return 1; }; done; last "$1"; }
warte_last vorher18 || exit 5
{ $Z/lauf25.sh --lauf vorher18 --kern ${TMPDIR:-/tmp}/djk25-vorher/bau/cypherdj-kern --sekunden 10 $F/teil_rampe.jsonl; echo "rc=$?"; } > $L/vorher18.log 2>&1
grep -E "^(GRÜN|ROT)|rc=" $L/vorher18.log
: > $L/folgen.log
for a in "rampe --klick deck/2 $F/teil_rampe.jsonl" "hand --klick deck/2 $F/hand_gewinnt.jsonl" "zuspaet $F/zu_spaet.jsonl" \
         "i4 $F/i4_ueberlappung.jsonl" "kistopp $F/ki_stopp.jsonl" "neustart --klick deck/2 $F/neustart.jsonl"; do
  set -- $a; n=$1; shift; warte_last $n >> $L/folgen.log || exit 5
  $Z/lauf25.sh --lauf "$n" "$@" 2>&1 | grep -E "^(GRÜN|ROT|ordner)|fehlt|nicht aktiv|Traceback" >> $L/folgen.log; echo "rc=${PIPESTATUS[0]}" >> $L/folgen.log
done
cat $L/folgen.log
warte_last hand-mutation || exit 5
{ $Z/lauf25.sh --lauf hand-mutation --kern $PWD/djk/kern/build/cypherdj-kern-mutation-hand --klick deck/2 $F/hand_gewinnt.jsonl; echo "rc=$?"; } > $L/hand-mutation.log 2>&1
grep -E "^(GRÜN|ROT)|rc=" $L/hand-mutation.log
warte_last faderzu || exit 5
{ $Z/lauf25.sh --lauf faderzu --klick deck/2 --sekunden 35 $Z/folgen25/fader_zu.jsonl; echo "rc=$?"; } > $L/faderzu.log 2>&1
grep -E "^(GRÜN|ROT)|rc=" $L/faderzu.log
warte_last kosten-offline || exit 5
djk/kern/build/kern_kosten25 20000 > $L/kosten-offline.log 2>&1; cat $L/kosten-offline.log
: > $L/kosten.log
for l in "leer --leer" "belegt16" "rampen16 --rampen" "last --last --sekunden 30"; do
  set -- $l; n=$1; shift; warte_last k-$n >> $L/kosten.log || exit 5
  $Z/kosten25.sh --lauf "k-$n" "$@" | python3 -c "import json,sys; e=json.loads(sys.stdin.read().splitlines()[-1]); print(e[\"lauf\"], e[\"cb_n\"], e[\"cb_p50_us\"], e[\"cb_p99_us\"], e[\"cb_p999_us\"], e[\"cb_max_us\"], e[\"frame_luecken_gesamt\"], e[\"gehalten\"], e[\"last_vorher\"])" >> $L/kosten.log 2>&1
done
cat $L/kosten.log
warte_last regression18 || exit 5
djk/kern/tests/neustart/serie.sh --lauf reg18-kill --art kill --anzahl 5 --kern-arg --waechter-ms --kern-arg 100 > $L/regression18-kill.log 2>&1; echo "reg18-kill rc=$?"; tail -5 $L/regression18-kill.log
warte_last regression08 || exit 5
CYPHERDJ_SCHLOSS=gehalten KERN01=${TMPDIR:-/tmp}/djk18/kern01-cypherdj-kern djk/kern/tests/ziel/abnahme.sh > $L/regression08.log 2>&1; echo "reg08 rc=$?"; tail -6 $L/regression08.log
last ende
echo REIHE-ENDE
