#!/usr/bin/env python3
"""Abgleich der beiden §1.5-Tabellen, die Scheibe 25 zusammenführt: Kanalzug (Scheibe 04, djk/kern/dsp,
`regler_liste`: pfad einheit min max vorgabe ms form, Pfade ohne Kanal) gegen Stellwerk (`stellwerk_regler_liste`:
pfad min max vorgabe ms nur_hand) am Kanal deck/1. Selbsttest vorher: eine verfälschte Kopie der 04-Zeilen (Filter
20 -> 10 ms) muss genau eine Abweichung ergeben. Rückgabe 0 nur bei 0 Abweichungen und bestandenem Selbsttest.
Aufruf: abgleich_kanalzug.py <stellwerk_regler_liste> <regler_liste von 04>"""
import subprocess
import sys


def zeilen(programm):
    return {z.split('\t')[0]: z.split('\t') for z in subprocess.run([programm], check=True, capture_output=True,
                                                                    text=True).stdout.splitlines()}


def vergleiche(kanalzug, stellwerk):
    fehler = []
    for p, z in sorted(kanalzug.items()):
        s = stellwerk.get('deck/1/' + p)
        if s is None:
            fehler.append(f'{p}: fehlt im Stellwerk')
            continue
        a = [float(x) for x in z[2:6]]
        b = [float(x) for x in s[1:5]]
        if a != b:
            fehler.append(f'{p}: Kanalzug min/max/vorgabe/ms {a}, Stellwerk {b}')
    return fehler


def main():
    stellwerk, kanalzug = zeilen(sys.argv[1]), zeilen(sys.argv[2])
    falsch = {p: (z[:5] + ['10'] + z[6:] if p == 'filter' else z) for p, z in kanalzug.items()}
    f = vergleiche(falsch, stellwerk)
    print(f'Selbsttest (Filter 20 -> 10 ms verfälscht): {len(f)} Abweichung(en)')
    if len(f) != 1:
        print('FEHLER: der Abgleich sieht die Verfälschung nicht')
        return 1
    fehler = vergleiche(kanalzug, stellwerk)
    for x in fehler:
        print('ABWEICHUNG', x)
    print(f'{len(kanalzug)} Kanalzug-Regler (04) gegen deck/1 des Stellwerks (11): {len(fehler)} Abweichungen')
    return 1 if fehler or not kanalzug else 0


if __name__ == '__main__':
    sys.exit(main())
