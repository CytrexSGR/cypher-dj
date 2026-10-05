#!/usr/bin/env python3
"""Rechnet die sha256 aller Fremddateien unter djk/third_party/ gegen herkunft.json nach.

Grün (Rückgabewert 0) nur, wenn jede gelistete Datei existiert und ihre sha256 stimmt und keine Datei unter
djk/third_party/ ungelistet ist (außer eigene_dateien und Bauverzeichnissen).
Aufruf: python3 djk/third_party/pruefe_herkunft.py [--ordner PFAD]
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
UEBERSPRINGEN = {"build", "__pycache__"}


def pruefe(ordner: Path) -> list[str]:
    herkunft = json.loads((ordner / "herkunft.json").read_text(encoding="utf-8"))
    fehler, gelistet = [], set(herkunft["eigene_dateien"])
    for q in herkunft["quellen"]:
        for datei, soll in q["dateien"].items():
            gelistet.add(datei)
            pfad = ordner / datei
            if not pfad.is_file():
                fehler.append(f"{q['name']}: {datei} fehlt")
                continue
            ist = hashlib.sha256(pfad.read_bytes()).hexdigest()
            if ist != soll:
                fehler.append(f"{q['name']}: {datei} sha256 {ist}, herkunft.json {soll}")
    vorhanden = {p.relative_to(ordner).as_posix() for p in ordner.rglob("*")
                 if p.is_file() and not (set(p.relative_to(ordner).parts) & UEBERSPRINGEN)}
    for datei in sorted(vorhanden - gelistet):
        fehler.append(f"{datei} liegt in djk/third_party/, steht aber nicht in herkunft.json")
    print(f"herkunft.json: {len(herkunft['quellen'])} Quellen, "
          f"{sum(len(q['dateien']) for q in herkunft['quellen'])} Fremddateien nachgerechnet")
    return fehler


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ordner", type=Path, default=HIER)
    fehler = pruefe(ap.parse_args().ordner)
    for f in fehler:
        print(f"ROT: {f}")
    print("ERGEBNIS: " + (f"ROT ({len(fehler)} Befunde)" if fehler else "GRÜN"))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
