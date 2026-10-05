#!/usr/bin/env bash
# Abnahme der Scheibe 01 (ROADMAP Steckbrief 01) in einem Zug: ctest (normal und ASan/UBSan), Instrument-Test,
# Riegel am Graphen, Fehlerfall (Mutation), 5 Klick-Läufe, zwei Negativ-Kontrollen, Bericht. Alle Läufe am Graphen
# stehen unter EINEM Echtzeit-Schloss (rund 10 min), damit sie unter gleichen Bedingungen laufen und die Abnahme nicht
# achtmal hinter fremden Messungen anstehen muss.
# Ein Lauf mit lückenhaftem Instrument (Rückgabe 2) wird wiederholt, höchstens 5 Versuche je Lauf; die Zahl der
# verworfenen Läufe steht im Bericht. Aufruf: CYPHERDJ_INSTANZ=a abnahme.sh   Rückgabe 0 bestanden.
. "$(dirname "$0")/../../konfig/echtzeit_schloss.sh"   # CYPHERDJ_ECHTZEIT_SCHLOSS
set -uo pipefail
: "${CYPHERDJ_INSTANZ:?CYPHERDJ_INSTANZ setzen, Strang A: export CYPHERDJ_INSTANZ=a}"
HIER=$(cd "$(dirname "$0")" && pwd)
DJK=$(cd "$HIER/../.." && pwd)
AUS=$HIER/ergebnisse/$(date +%Y%m%d-%H%M%S)
mkdir -p "$AUS"
echo "Abnahme nach $AUS" >&2
# Erst bauen, damit kein veraltetes Programm abgenommen wird (Ninja baut nur, was sich geändert hat)
for b in kern/build kern/build-asan notbahn/build pruefstand/aufnehmer/build; do
  cmake --build "$DJK/$b" > "$AUS/bau_${b//\//_}.txt" 2>&1 || { echo "Bau $b gescheitert, siehe $AUS" >&2; exit 1; }
done
ctest --test-dir "$DJK/kern/build" --output-on-failure > "$AUS/ctest_kern.txt" 2>&1
ctest --test-dir "$DJK/kern/build-asan" --output-on-failure > "$AUS/ctest_kern_asan.txt" 2>&1
ctest --test-dir "$DJK/notbahn/build" --output-on-failure > "$AUS/ctest_notbahn.txt" 2>&1
python3 "$HIER/test_auswertung.py" > "$AUS/instrument.txt" 2>&1

exec 9>"$CYPHERDJ_ECHTZEIT_SCHLOSS"
echo "warte auf das Echtzeit-Schloss ... ($(date +%T))" >&2
flock -w 7200 9 || { echo "kein Echtzeit-Schloss" >&2; exit 3; }
echo "Echtzeit-Schloss erhalten ($(date +%T))" >&2
export CYPHERDJ_SCHLOSS=gehalten
"$DJK/notbahn/tests/riegel.sh" "$AUS/riegel" > "$AUS/riegel.txt" 2>&1

lauf() {  # <art> <nr>
  local v rc
  for v in 1 2 3 4 5; do
    "$HIER/lauf.sh" "$1" "${2}v$v" "$AUS"; rc=$?
    echo "$1 ${2}v$v Rückgabe $rc" >> "$AUS/laeufe.txt"
    [ "$rc" != 2 ] && return 0
  done
}
lauf mutation 1
for n in 1 2 3 4 5; do lauf klick "$n"; done
lauf ohne-klick 1
lauf ohne-pruefmodus 1
flock -u 9
python3 "$HIER/bericht.py" "$AUS"
