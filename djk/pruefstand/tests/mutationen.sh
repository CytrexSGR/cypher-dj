#!/usr/bin/env bash
# Mutationsprobe aller Messer (Plan 16 Task 1): je Messer eine Mutante, die rot werden MUSS (tests/mutation.sh).
# Rückgabewert 0 nur, wenn jede Mutante rot wurde; die Zeile „MUTANTE GRÜN“ nennt einen blinden Messer.
set -u
cd "$(dirname "$0")/.."
M=tests/mutation.sh
blind=0
lauf() { "$M" "$@" || blind=$((blind + 1)); }
echo "== stille (Mindestlänge)";       lauf messer.py 's/k = l >= mindest/k = l >= 10 * mindest/' tests/test_messer.py
echo "== bloecke (stille Blöcke)";     lauf messer.py 's/if np.all(np.abs(b) < 1e-6):/if np.all(np.abs(b) < 1e-6) and False:/' tests/test_messer.py
echo "== spruenge (Schwelle)";         lauf messer.py 's/ueber = (d > schwelle) \& frei/ueber = (d > 5 * schwelle) \& frei/' tests/test_messer.py
echo "== einsaetze (Ruhe)";            lauf messer.py 's/neu = np.diff(ueber) > ruhe/neu = np.diff(ueber) > 50 * ruhe/' tests/test_messer.py
echo "== raster_versatz";              lauf messer.py 's/v = float(np.median(nach) - np.median(vor))/v = 0.0/' tests/test_messer.py
echo "== klick_pausen";                lauf messer.py 's/fehlend += int(round(g \/ spb)) - 1 if g > 1.5 \* spb else 0/fehlend += 0/' tests/test_messer.py
echo "== schleife_treue";              lauf messer.py 's/"abweichend": int(np.sum(d > 1e-6))/"abweichend": int(np.sum(d > 1e-1))/' tests/test_messer.py
echo "== raster_luecken";              lauf messer.py 's/luecken = int(sum(int(round(d\[i\] \/ quantum)) for i in idx if d\[i\] > 0))/luecken = len(idx)/' tests/test_messer.py
echo "== Treue-Fenster daneben";       lauf auswertung.py 's/von = a0 if ist_kern else a + int(4 \* spb) + SR \/\/ 10/von = a0 if ist_kern else a + SR \/\/ 10/' tests/test_auswertung.py
echo "== Spins im Aufnahmefenster";    lauf auswertung.py 's/if t_auf <= t < t_ende_auf)/)/' tests/test_auswertung.py
echo "== Aufnehmer-Lücke unbrauchbar"; lauf auswertung.py 's/brauchbar = meta\["luecken"\] == 0 and/brauchbar = True or/' tests/test_auswertung.py
echo "== Rückgabe-Folge";              lauf auswertung.py 's/return all(any(x == t for x in it) for t in teil)/return True/' tests/test_auswertung.py
echo "blind: $blind"
exit $(( blind > 0 ))
