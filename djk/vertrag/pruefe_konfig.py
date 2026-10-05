#!/usr/bin/env python3
"""Prüft djk/vertrag/konfig.schema.json gegen die Tabelle in SCHNITTSTELLEN.md §2.1.

Grün (Rückgabewert 0) nur, wenn je Datei (kern.toml, leitstand.toml, werkstatt.toml) die Schlüssel in Text und
Schema gleich sind (am Text gezählt), Typ und Vorgabe übereinstimmen, und eine TOML-Datei aus allen Vorgaben gegen das
Schema gültig ist, während ein unbekannter Schlüssel und eine fehlende version ungültig sind.
Aufruf: python3 djk/vertrag/pruefe_konfig.py [--vertrag PFAD] [--schema PFAD]
"""
from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

import jsonschema

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402

JSON_TYP = {"float": "number", "int": "integer", "str": "string", "Pfad": "string", "bool": "boolean"}


def als_toml(werte: dict) -> str:
    zeilen = []
    for k, v in werte.items():
        if isinstance(v, bool):
            zeilen.append(f"{k} = {'true' if v else 'false'}")
        elif isinstance(v, str):
            zeilen.append(f"{k} = {json.dumps(v)}")
        else:
            zeilen.append(f"{k} = {v!r}")
    return "\n".join(zeilen) + "\n"


def vorgaben_toml(teilschema: dict) -> str:
    werte = {"version": 1}
    for k, p in teilschema["properties"].items():
        if k != "version" and "default" in p:
            werte[k] = p["default"]
    return als_toml(werte)


def pruefe(text: str, schema: dict) -> list[str]:
    fehler: list[str] = []
    im_text = vertragstext.konfig_schluessel(text)
    dateien = sorted({d for d, *_ in im_text})
    print(f"§2.1: {len(im_text)} Schlüssel in {len(dateien)} Dateien am Text gezählt: {', '.join(dateien)}")
    if sorted(schema["$defs"]) != dateien:
        fehler.append(f"Dateien Schema {sorted(schema['$defs'])}, Text {dateien}")
    for datei in dateien:
        teil = schema["$defs"].get(datei, {"properties": {}})
        props = {k: v for k, v in teil["properties"].items() if k != "version"}
        text_nach = {n: (t, v) for d, n, t, v in im_text if d == datei}
        for n in sorted(set(text_nach) - set(props)):
            fehler.append(f"{datei}: {n} steht im Text, fehlt im Schema")
        for n in sorted(set(props) - set(text_nach)):
            fehler.append(f"{datei}: {n} steht im Schema, fehlt im Text")
        for n in sorted(set(text_nach) & set(props)):
            typ, vorgabe = text_nach[n]
            p = props[n]
            if p.get("x-typ") != typ or p.get("type") != JSON_TYP[typ]:
                fehler.append(f"{datei}.{n}: Typ Text {typ}, Schema {p.get('x-typ')}/{p.get('type')}")
            if vorgabe is None:
                if "default" in p:
                    fehler.append(f"{datei}.{n}: Text nennt keine Vorgabe, Schema {p['default']!r}")
            elif p.get("default") != vorgabe or type(p.get("default")) is not type(vorgabe):
                fehler.append(f"{datei}.{n}: Vorgabe Text {vorgabe!r}, Schema {p.get('default')!r}")
        if teil.get("additionalProperties") is not False or teil.get("required") != ["version"]:
            fehler.append(f"{datei}: Schema muss unbekannte Schlüssel verbieten und version verlangen")
        v = jsonschema.Draft202012Validator(teil)
        gut = tomllib.loads(vorgaben_toml(teil))
        if list(v.iter_errors(gut)):
            fehler.append(f"{datei}: Datei aus allen Vorgaben ist ungültig: {[e.message for e in v.iter_errors(gut)]}")
        tippfehler = dict(gut, start_bmp=130.0)
        if not list(v.iter_errors(tippfehler)):
            fehler.append(f"{datei}: unbekannter Schlüssel start_bmp wird nicht abgelehnt")
        ohne_version = {k: w for k, w in gut.items() if k != "version"}
        if not list(v.iter_errors(ohne_version)):
            fehler.append(f"{datei}: fehlende version wird nicht abgelehnt")
    return fehler


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vertrag", type=Path, default=vertragstext.VERTRAG)
    ap.add_argument("--schema", type=Path, default=HIER / "konfig.schema.json")
    args = ap.parse_args()
    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    fehler = pruefe(vertragstext.lies(args.vertrag), schema)
    for f in fehler:
        print(f"ROT: {f}")
    if fehler:
        print(f"ERGEBNIS: ROT ({len(fehler)} Befunde)")
        return 1
    print("ERGEBNIS: GRÜN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
