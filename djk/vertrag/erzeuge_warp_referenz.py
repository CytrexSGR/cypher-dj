#!/usr/bin/env python3
"""Paket 1.13 Warp (Slice 1): Referenzdatei für die Abbildung W(b) (Quellsekunde zum Clip-Beat), geteilt von
kern/include/cypherdj/warp_abbildung.h (kern/tests/test_warp_abbildung.cpp), oberflaeche/projekt/warp.ts und
oberflaeche/oeffentlich/produktion/warp.js (oberflaeche/tests/warp_abbildung.test.mjs).

W ist stückweise linear zwischen Markern [quell_s, beat] (beide streng steigend); vor dem ersten und hinter dem letzten Marker gilt
das Randsegment weiter. Der Erwartungswert wird hier EXAKT gerechnet (fractions.Fraction auf den Doppel-Werten der Eingabe) und erst
am Ende auf double gerundet: unabhängig von der Rechenordnung der drei Implementierungen. Feste Folge (random.Random(1313)).

Aufruf: python3 erzeuge_warp_referenz.py [--pruefe]   (schreibt warp_referenz.json neben das Skript; --pruefe vergleicht nur)
"""
import json
import random
import sys
from fractions import Fraction
from pathlib import Path

ZIEL = Path(__file__).with_name("warp_referenz.json")


def wert(marker, b):
    """Exakte Quellsekunde zum Clip-Beat b (Randsegment außerhalb)."""
    n = len(marker)
    i = 0
    for k in range(n - 1):
        if Fraction(marker[k][1]) <= Fraction(b):
            i = k
    s0, b0 = Fraction(marker[i][0]), Fraction(marker[i][1])
    s1, b1 = Fraction(marker[i + 1][0]), Fraction(marker[i + 1][1])
    return float(s0 + (Fraction(b) - b0) * (s1 - s0) / (b1 - b0))


def bauen():
    r = random.Random(1313)
    faelle = []
    while len(faelle) < 1000:
        n = r.choice([2, 2, 3, 4, 6, 9])
        beat = r.uniform(-10.0, 10.0)
        sek = r.uniform(0.0, 5.0)
        marker = []
        for _ in range(n):
            marker.append([sek, beat])
            beat += r.uniform(0.25, 8.0)
            sek += r.uniform(0.1, 10.0)
        lo, hi = marker[0][1] - 5.0, marker[-1][1] + 5.0
        art = len(faelle) % 4
        if art == 0:
            b = r.choice(marker)[1]                                   # genau auf einem Marker
        elif art == 1:
            k = r.randrange(n - 1)
            b = (marker[k][1] + marker[k + 1][1]) / 2.0               # Mitte eines Segments
        else:
            b = r.uniform(lo, hi)                                     # überall, auch im Randsegment
        faelle.append({"marker": marker, "beat": b, "quell_s": wert(marker, b)})
    return {"hinweis": "erzeugt von erzeuge_warp_referenz.py (Seed 1313); quell_s exakt gerechnet, auf double gerundet",
            "toleranz_relativ": 1e-12, "faelle": faelle}


if __name__ == "__main__":
    neu = json.dumps(bauen(), indent=None, separators=(",", ":"), ensure_ascii=False) + "\n"
    if "--pruefe" in sys.argv:
        sys.exit(0 if ZIEL.read_text() == neu else 1)
    ZIEL.write_text(neu)
    print(f"geschrieben: {ZIEL} ({len(neu)} Bytes, 1000 Fälle)")
