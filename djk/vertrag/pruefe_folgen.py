#!/usr/bin/env python3
"""Prüft die Golden-Folgen unter djk/vertrag/folgen/ und die Herkunft ihrer Zahlen.

Grün (Rückgabewert 0) nur, wenn
  1. karte.py die Golden-Tabelle aus SCHNITTSTELLEN.md §1.3 trifft (auf die im Text angegebenen Stellen genau),
  2. jede Zeile jeder Folge dem Schema folge.schema.json entspricht,
  3. jede OSC-Nachricht zu osc.json passt (Adresse, Typ-Zeichenkette, Richtung, Wertetypen), außer sie ist mit
     "absicht" als absichtlich falsch gekennzeichnet und ist es auch,
  4. die Zeitachse stimmt (erste Zeile /k/set/neu bei sample 0, sende-Samples steigen nicht ab, Kennungen steigen),
  5. uhr_golden, storno und protokollfehler genau dem entsprechen, was erzeuge_folgen.py heute erzeugt.
Aufruf: python3 djk/vertrag/pruefe_folgen.py [--vertrag PFAD] [--ordner PFAD]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import jsonschema

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import erzeuge_folgen  # noqa: E402
import karte  # noqa: E402
import vertragstext  # noqa: E402

SONDER = {"NaN", "inf", "-inf"}
RECHNER_SCHRITTE = ("rechner_frage", "rechner_antwort")


def _rechner_folge(zeilen: list[str]) -> bool:
    """FORMAT.md Punkt 17 (Scheibe 09): eine Folge nur aus rechner_frage und rechner_antwort hat keine Zeitachse."""
    try:
        return all(json.loads(z).get("t") in RECHNER_SCHRITTE for z in zeilen if z.strip())
    except (json.JSONDecodeError, AttributeError):
        return False


def _wert_passt(typ: str, w, erlaubt_null: bool) -> bool:
    if w is None:
        return erlaubt_null
    if typ in "ih":
        return isinstance(w, int) and not isinstance(w, bool)
    if typ in "fd":
        return (isinstance(w, (int, float)) and not isinstance(w, bool)) or w in SONDER
    return isinstance(w, str)


def pruefe_datei(pfad: Path, osc: dict, validator) -> list[str]:
    fehler: list[str] = []
    nach = {e["adresse"]: e for e in osc["adressen"]}
    letzte_sende = -1
    letzte_id = 0
    zeilen = pfad.read_text(encoding="utf-8").splitlines()
    for nr, roh in enumerate(zeilen, 1):
        ort = f"{pfad.name}:{nr}"
        try:
            z = json.loads(roh)
        except json.JSONDecodeError as e:
            fehler.append(f"{ort}: kein JSON ({e})")
            continue
        for f in validator.iter_errors(z):
            fehler.append(f"{ort}: Schema: {f.message}")
        if nr == 1 and not (z.get("t") == "sende" and z.get("sample") == 0 and z.get("osc", [None])[0] == "/k/set/neu") \
                and not _rechner_folge(zeilen):
            fehler.append(f"{ort}: erste Zeile muss sende /k/set/neu bei sample 0 sein")
        if z.get("t") not in ("sende", "erwarte") or not isinstance(z.get("osc"), list) or len(z["osc"]) < 2:
            continue
        adresse, typen, werte = z["osc"][0], z["osc"][1], z["osc"][2:]
        absicht = z.get("absicht")
        e = nach.get(adresse)
        if len(werte) != len(typen) - 1:
            fehler.append(f"{ort}: {len(werte)} Werte, Typ-Zeichenkette {typen} verlangt {len(typen) - 1}")
        for k, w in enumerate(werte[: len(typen) - 1]):
            if not _wert_passt(typen[k + 1], w, z["t"] == "erwarte"):
                fehler.append(f"{ort}: Wert {k + 1} ({w!r}) passt nicht zu Typ {typen[k + 1]}")
        if absicht == "unbekannte_adresse":
            if e is not None:
                fehler.append(f"{ort}: absicht unbekannte_adresse, aber {adresse} steht in osc.json")
        elif absicht == "falsche_typen":
            if e is None or e["typen"] == typen:
                fehler.append(f"{ort}: absicht falsche_typen, aber {adresse} {typen} ist vertragsgemäß oder unbekannt")
        elif e is None:
            fehler.append(f"{ort}: {adresse} steht nicht in osc.json")
        elif e["typen"] != typen:
            fehler.append(f"{ort}: {adresse} hat laut osc.json {e['typen']}, die Folge sagt {typen}")
        else:
            richtung = e["richtung"]
            if z["t"] == "sende" and richtung != "an_kern":
                fehler.append(f"{ort}: {adresse} geht nicht an den Kern, kann nicht gesendet werden")
            if z["t"] == "erwarte" and richtung == "an_kern":
                fehler.append(f"{ort}: {adresse} kommt nie vom Kern, kann nicht erwartet werden")
        if z["t"] == "sende":
            if z["sample"] < letzte_sende:
                fehler.append(f"{ort}: sende-Sample {z['sample']} liegt vor dem vorigen ({letzte_sende})")
            letzte_sende = z["sample"]
            if e is not None and e["felder"] and e["felder"][0]["name"] == "id" and typen[1:2] == "h":
                if not (isinstance(werte[0], int) and werte[0] > letzte_id):
                    fehler.append(f"{ort}: id {werte[0]!r} steigt nicht (vorige {letzte_id})")
                else:
                    letzte_id = werte[0]
    return fehler


def pruefe_aktuell(ordner: Path) -> list[str]:
    fehler = []
    for name, bau in erzeuge_folgen.FOLGEN.items():
        pfad = ordner / f"{name}.jsonl"
        if not pfad.exists():
            fehler.append(f"{name}.jsonl fehlt")
        elif pfad.read_text(encoding="utf-8") != erzeuge_folgen.als_text(bau()):
            fehler.append(f"{name}.jsonl ist nicht, was erzeuge_folgen.py erzeugt (von Hand geändert oder veraltet)")
    return fehler


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vertrag", type=Path, default=vertragstext.VERTRAG)
    ap.add_argument("--ordner", type=Path, default=HIER / "folgen")
    args = ap.parse_args()
    osc = json.loads((HIER / "osc.json").read_text(encoding="utf-8"))
    schema = json.loads((HIER / "folge.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    validator = jsonschema.Draft202012Validator(schema)
    text = vertragstext.lies(args.vertrag)
    fehler = karte.golden_abweichungen(text)
    print(f"§1.3: {len(vertragstext.golden_1_3(text))} Golden-Werte und "
          f"{len(vertragstext.takt_schlag_phrase_1_3(text))} Takt/Schlag/Phrase-Fälle mit karte.py nachgerechnet")
    dateien = sorted(args.ordner.glob("*.jsonl"))
    schritte = 0
    for pfad in dateien:
        fehler += pruefe_datei(pfad, osc, validator)
        schritte += len(pfad.read_text(encoding="utf-8").splitlines())
    print(f"Folgen: {len(dateien)} Dateien, {schritte} Schritte gegen Schema und osc.json geprüft")
    fehler += pruefe_aktuell(args.ordner)
    for f in fehler:
        print(f"ROT: {f}")
    if fehler:
        print(f"ERGEBNIS: ROT ({len(fehler)} Befunde)")
        return 1
    print("ERGEBNIS: GRÜN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
