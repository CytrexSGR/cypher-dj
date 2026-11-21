#!/usr/bin/env python3
"""Control table of the signalbox against contract/pult.json (container core K9).

The paths printed by stellwerk_regler_liste, filtered to the families deck, pad, bus and strom, plus the four
deck/<n>/transport rows (the tool leaves them out), must equal `generate_pult.py --liste` line for line (C-locale sort).
A self test first: a table with one line removed and one line added must be found different.
Usage: controls_against_pult.py <stellwerk_regler_liste> <generate_pult.py>
"""
import re
import subprocess
import sys


def vergleiche(tabelle: list[str], pult: list[str]) -> list[str]:
    a, b = set(tabelle), set(pult)
    fehler = [f"only in the table: {p}" for p in sorted(a - b)] + [f"only in pult.json: {p}" for p in sorted(b - a)]
    if len(tabelle) != len(set(tabelle)):
        fehler.append("duplicate path in the table")
    return fehler


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    roh = subprocess.run([sys.argv[1]], check=True, capture_output=True, text=True).stdout.splitlines()
    tabelle = sorted((z.split("\t")[0] for z in roh if re.match(r"(deck|pad|bus|strom)/", z)), key=lambda s: s.encode())
    tabelle += [f"deck/{n}/transport" for n in range(1, 5)]
    tabelle.sort(key=lambda s: s.encode())
    pult = subprocess.run([sys.executable, sys.argv[2], "--liste"], check=True, capture_output=True, text=True).stdout.split()
    pult.sort(key=lambda s: s.encode())
    if not tabelle or not pult:
        print("empty list")
        return 1
    if not vergleiche(tabelle[1:], pult) or not vergleiche(tabelle + ["bus/9/fader"], pult):
        print("self test failed: a changed table was not found different")
        return 1
    fehler = vergleiche(tabelle, pult)
    for f in fehler[:20]:
        print(f)
    print(f"{len(tabelle)} paths in the table, {len(pult)} in pult.json, {len(fehler)} differences")
    return 1 if fehler else 0


sys.exit(main())
