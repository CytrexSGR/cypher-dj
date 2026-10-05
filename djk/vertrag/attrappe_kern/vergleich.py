#!/usr/bin/env python3
"""Urteil über Beobachtungen der Kern-Attrappe mit dem Vergleich von Scheibe 09 (djk/vertrag/folgen_vergleich.py).

Die Node-Läufer golden.mjs (simulierte Zeit) und echtzeit.mjs (UDP gegen den Prozess) sammeln je Folge, was die
Attrappe gemeldet hat, und geben es hier hinein. So gilt für die Attrappe genau die Regel, die FORMAT.md (Punkte 1
bis 22) und folgen_vergleich.py für jeden Läufer festlegen, statt einer zweiten Umsetzung in JavaScript.

Eingabe (stdin, JSON; NaN und Infinity als nackte Literale erlaubt):
  [{"name": str, "datei": Pfad der Folge, "auslassen": [Zeilennummern 1-basiert],
    "beobachtet": [{"sample": int, "osc": [adresse, typen, ...werte]}],
    "werte": [[pfad, sample, wert]], "deck": [[deck, feld, sample, wert]]}]
Die Folge wird aus der Datei gelesen (nicht aus dem JSON der Läufer), damit 64.0 eine Gleitkommazahl bleibt.
Ausgelassene Zeilen (Bereiche, die die Attrappe nicht baut, FORMAT.md Punkt 14) werden durch eine wirkungslose Zeile
ersetzt, damit die Zeilennummern der Befunde zur Datei passen.
Ausgabe (stdout, JSON): [{"name": str, "befunde": [[zeile, art, text], ...]}]
"""
import json
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
sys.dont_write_bytecode = True           # kein __pycache__ in djk/vertrag/ (Territorium von 09)
sys.path.insert(0, str(HIER.parent))
import folgen_vergleich as fv  # noqa: E402  (djk/vertrag/folgen_vergleich.py, Scheibe 09)


def urteile(eintrag):
    zeilen = [json.loads(z) for z in pathlib.Path(eintrag["datei"]).read_text(encoding="utf-8").splitlines() if z.strip()]
    for n in eintrag["auslassen"]:
        zeilen[n - 1] = {"t": "ausgelassen"}
    werte = {(p, s): v for p, s, v in eintrag["werte"]}
    deck = {(d, f, s): v for d, f, s, v in eintrag["deck"]}
    befunde = fv.pruefe(zeilen, eintrag["beobachtet"], lambda p, s: werte.get((p, s)),
                        lambda d, f, s: deck.get((d, f, s)), lambda n, s: None)
    return {"name": eintrag["name"], "befunde": [[z, a, t] for z, a, t in befunde]}


def main():
    daten = json.loads(sys.stdin.read())
    json.dump([urteile(e) for e in daten], sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
