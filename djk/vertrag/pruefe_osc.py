#!/usr/bin/env python3
"""Prüft djk/vertrag/osc.json gegen den Vertragstext SCHNITTSTELLEN.md (§4, §5, §19.0) und die erzeugten Dateien.

Grün (Rückgabewert 0) nur, wenn
  1. die Zahl der OSC-Definitionen im Text (am Text gezählt) gleich der Zahl der Einträge in osc.json ist,
  2. jede Adresse in beiden vorkommt, keine doppelt,
  3. jede Typ-Zeichenkette gleich ist,
  4. die Feldnamen je Adresse in Text und JSON gleich und gleich geordnet sind,
  5. jedes Feld einen Typ passend zur Typ-Zeichenkette und eine bekannte Einheit hat, jede Werteliste existiert,
  6. die Wertelisten quelle, politik, status, gruende, taste mit dem Text übereinstimmen,
  7. osc_adressen.h und osc_adressen.ts genau dem entsprechen, was erzeuge_osc.py aus osc.json erzeugt.
Aufruf: python3 djk/vertrag/pruefe_osc.py [--vertrag PFAD] [--json PFAD] [--ohne-erzeugte]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402

TYPZEICHEN = set("ihfds")


def pruefe(vertrag: Path, json_pfad: Path, mit_erzeugten: bool) -> list[str]:
    fehler: list[str] = []
    text = vertragstext.lies(vertrag)
    daten = json.loads(json_pfad.read_text(encoding="utf-8"))
    im_text = vertragstext.osc_definitionen(text)
    eintraege = daten["adressen"]

    print(f"Vertragstext: {len(im_text)} OSC-Definitionen (§4, §5, §19.0), osc.json: {len(eintraege)} Einträge")
    if len(im_text) != len(eintraege):
        fehler.append(f"Anzahl ungleich: Text {len(im_text)}, osc.json {len(eintraege)}")

    text_nach = {}
    for d in im_text:
        if d.adresse in text_nach:
            fehler.append(f"Text definiert {d.adresse} doppelt (Zeilen {text_nach[d.adresse].zeile} und {d.zeile})")
        text_nach[d.adresse] = d
    json_nach = {}
    for e in eintraege:
        if e["adresse"] in json_nach:
            fehler.append(f"osc.json enthält {e['adresse']} doppelt")
        json_nach[e["adresse"]] = e

    for a in sorted(set(text_nach) - set(json_nach)):
        fehler.append(f"{a} steht im Text (Zeile {text_nach[a].zeile}), fehlt in osc.json")
    for a in sorted(set(json_nach) - set(text_nach)):
        fehler.append(f"{a} steht in osc.json, fehlt im Text")

    gleich_typen = 0
    for a in sorted(set(text_nach) & set(json_nach)):
        d, e = text_nach[a], json_nach[a]
        if d.typen != e["typen"]:
            fehler.append(f"{a}: Typ-Zeichenkette Text {d.typen} (Zeile {d.zeile}), osc.json {e['typen']}")
        else:
            gleich_typen += 1
        namen_json = [f["name"] for f in e["felder"]]
        if not d.felder:
            fehler.append(f"{a}: Feldnamen im Text nicht gefunden (Zeile {d.zeile})")
        elif d.felder != namen_json:
            fehler.append(f"{a}: Felder Text {d.felder}, osc.json {namen_json}")
    print(f"Typ-Zeichenketten gleich: {gleich_typen} von {len(im_text)}")

    einheiten = set(daten["einheiten"])
    werte = daten["werte"]
    for e in eintraege:
        a, typen = e["adresse"], e["typen"]
        if not typen.startswith(",") or not set(typen[1:]) <= TYPZEICHEN:
            fehler.append(f"{a}: ungültige Typ-Zeichenkette {typen}")
            continue
        sw = e.get("schwanz")
        if sw is not None:
            st = sw.get("typen", "")
            if not st or not set(st) <= TYPZEICHEN:
                fehler.append(f"{a}: ungültiger Schwanz {st}")
            if sw.get("werte") is not None and sw["werte"] not in werte:
                fehler.append(f"{a}: Schwanz-Werteliste {sw['werte']!r} unbekannt")
        if len(e["felder"]) != len(typen) - 1:
            fehler.append(f"{a}: {len(e['felder'])} Felder, Typ-Zeichenkette hat {len(typen) - 1}")
        for k, f in enumerate(e["felder"]):
            if k + 1 < len(typen) and f["typ"] != typen[k + 1]:
                fehler.append(f"{a}.{f['name']}: Typ {f['typ']}, Typ-Zeichenkette sagt {typen[k + 1]}")
            if f.get("einheit") not in einheiten:
                fehler.append(f"{a}.{f['name']}: Einheit {f.get('einheit')!r} unbekannt")
            w = f.get("werte")
            if w is not None and w not in werte:
                fehler.append(f"{a}.{f['name']}: Werteliste {w!r} unbekannt")
            b = f.get("bereich")
            if b is not None and not (isinstance(b, list) and len(b) == 2):
                fehler.append(f"{a}.{f['name']}: Bereich muss [min, max] sein")

    vergleiche = {
        "quelle": (werte["quelle"]["liste"], vertragstext.quellen(text)),
        "politik": (werte["politik"]["codes"], vertragstext.politik_codes(text)),
        "status": (werte["status"]["codes"], vertragstext.status_codes(text)),
        "gruende": (sorted(werte["gruende"]["liste"]), sorted(vertragstext.gruende(text))),
        "taste": (werte["taste"]["liste"], vertragstext.tasten(text)),
    }
    for name, (j, t) in vergleiche.items():
        if j != t:
            fehler.append(f"Werteliste {name}: osc.json {j}, Text {t}")
    print(f"Wertelisten gegen den Text geprüft: {', '.join(vergleiche)}")

    if mit_erzeugten:
        import erzeuge_osc
        for pfad, soll in erzeuge_osc.erzeuge(daten).items():
            ziel = HIER / pfad
            if not ziel.exists() or ziel.read_text(encoding="utf-8") != soll:
                fehler.append(f"{pfad} ist nicht aktuell: python3 djk/vertrag/erzeuge_osc.py")
        print("Erzeugte Dateien gegen osc.json geprüft: osc_adressen.h, osc_adressen.ts")
    return fehler


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vertrag", type=Path, default=vertragstext.VERTRAG)
    ap.add_argument("--json", type=Path, default=HIER / "osc.json")
    ap.add_argument("--ohne-erzeugte", action="store_true", help="erzeugte Kopfdateien nicht vergleichen")
    args = ap.parse_args()
    fehler = pruefe(args.vertrag, args.json, not args.ohne_erzeugte)
    for f in fehler:
        print(f"ROT: {f}")
    if fehler:
        print(f"ERGEBNIS: ROT ({len(fehler)} Befunde)")
        return 1
    print("ERGEBNIS: GRÜN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
