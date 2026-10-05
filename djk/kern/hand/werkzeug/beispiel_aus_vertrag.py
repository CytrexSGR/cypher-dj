#!/usr/bin/env python3
"""Druckt den JSON-Block aus SCHNITTSTELLEN.md §7.2 (das Mapping-Beispiel des Vertrags) wörtlich aus.

Aufruf: python3 beispiel_aus_vertrag.py <pfad zu SCHNITTSTELLEN.md>
Rückgabe 0 mit dem Block auf stdout, 1 wenn §7.2 oder der ```json-Block fehlt. Die Tests vergleichen die Ausgabe
bytegleich mit tests/mappings/beispiel_7_2.json: ändert sich der Vertrag, wird der Test rot."""
import sys

zeilen = open(sys.argv[1], encoding="utf-8").read().split("\n")
try:
    start = next(i for i, z in enumerate(zeilen) if z.startswith("### 7.2 Mapping-Datei"))
    auf = next(i for i in range(start, len(zeilen)) if zeilen[i].strip() == "```json")
    zu = next(i for i in range(auf + 1, len(zeilen)) if zeilen[i].strip() == "```")
except StopIteration:
    print("§7.2 oder der json-Block fehlt", file=sys.stderr)
    sys.exit(1)
sys.stdout.write("\n".join(zeilen[auf + 1:zu]) + "\n")
