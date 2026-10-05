#!/usr/bin/env python3
"""Erzeugt osc_adressen.h (C++20) und osc_adressen.ts (TypeScript) aus djk/vertrag/osc.json.

Die erzeugten Dateien werden versioniert und nie von Hand geändert; pruefe_osc.py meldet ROT, wenn sie nicht
genau dem entsprechen, was dieses Skript aus osc.json macht.
Aufruf: python3 djk/vertrag/erzeuge_osc.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
KOPF = ("ERZEUGT von djk/vertrag/erzeuge_osc.py aus djk/vertrag/osc.json. Nicht von Hand ändern.\n"
        "Vertrag: docs/architektur/SCHNITTSTELLEN.md, Version {v}. Prüfung: python3 djk/vertrag/pruefe_osc.py")
CPP_SCHLUESSELWOERTER = {
    "alignas", "alignof", "and", "asm", "auto", "bool", "break", "case", "catch", "char", "class", "const", "continue",
    "default", "delete", "do", "double", "else", "enum", "explicit", "export", "extern", "false", "float", "for",
    "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace", "new", "not", "operator", "or", "private",
    "protected", "public", "register", "return", "short", "signed", "sizeof", "static", "struct", "switch",
    "template", "this", "throw", "true", "try", "typedef", "typeid", "typename", "union", "unsigned", "using",
    "virtual", "void", "volatile", "while", "xor", "concept", "requires", "module", "import",
}
TS_TYP = {"i": "number", "h": "bigint", "f": "number", "d": "number", "s": "string"}


def bezeichner(adresse: str) -> str:
    name = adresse.strip("/").replace("/", "_")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
        raise ValueError(f"Adresse {adresse} ergibt keinen gültigen Bezeichner")
    return name


def kamel(name: str) -> str:
    return "".join(t[:1].upper() + t[1:] for t in name.split("_"))


def zahl(x: float | int) -> str:
    return repr(float(x)) if isinstance(x, float) else str(x)


def _pruefe_namen(daten: dict) -> None:
    gesehen = set()
    for e in daten["adressen"]:
        b = bezeichner(e["adresse"])
        if b in gesehen:
            raise ValueError(f"Bezeichner {b} doppelt")
        gesehen.add(b)
        for f in e["felder"]:
            n = f["name"]
            if n in CPP_SCHLUESSELWOERTER or not re.fullmatch(r"[a-z_][a-z0-9_]*", n):
                raise ValueError(f"{e['adresse']}: Feldname {n} taugt nicht als Bezeichner")


def erzeuge_cpp(daten: dict) -> str:
    v = daten["vertrag"]
    adressen = daten["adressen"]
    z = ["// " + s for s in KOPF.format(v=v).split("\n")]
    z += ["#pragma once", "", "#include <array>", "#include <cstddef>", "#include <cstdint>",
          "#include <string_view>", "", "namespace cypherdj::osc {", "",
          f"inline constexpr int vertrag = {v};", "",
          "enum class Richtung : std::uint8_t { an_kern, vom_kern, von_notbahn };", "",
          "struct Adresse {", "  std::string_view pfad;", "  std::string_view typen;", "  Richtung richtung;",
          "  bool nur_pruefmodus;", "  std::size_t felder;", "};", ""]
    for e in adressen:
        b = bezeichner(e["adresse"])
        pm = "true" if e.get("nur_pruefmodus") else "false"
        z.append(f"// §{e['abschnitt']} {e['adresse']} {e['typen']}")
        z.append(f'inline constexpr Adresse {b}{{"{e["adresse"]}", "{e["typen"]}", Richtung::{e["richtung"]}, '
                 f'{pm}, {len(e["felder"])}}};')
        z.append(f"static_assert({b}.typen.size() - 1 == {b}.felder);")
    z.append("")
    z.append(f"inline constexpr std::array<Adresse, {len(adressen)}> alle{{")
    z += [f"    {bezeichner(e['adresse'])}," for e in adressen]
    z += ["};", "",
          "constexpr const Adresse* finde(std::string_view pfad) {",
          "  for (const auto& a : alle) {",
          "    if (a.pfad == pfad) return &a;",
          "  }",
          "  return nullptr;",
          "}", "", "// Feldnummern je Adresse: feld::<adresse>::<feld>", "namespace feld {"]
    for e in adressen:
        z.append(f"namespace {bezeichner(e['adresse'])} {{ enum : std::size_t {{ "
                 + ", ".join(f"{f['name']} = {k}" for k, f in enumerate(e["felder"])) + " }; }")
    z += ["}  // namespace feld", "",
          "// Optionaler Schwanz nach den festen Feldern (Scheibe 3): 0 bis n Wiederholungen dieser Typen, z. B. (nr, wert)",
          "namespace schwanz {"]
    for e in adressen:
        if e.get("schwanz"):
            z.append(f'inline constexpr std::string_view {bezeichner(e["adresse"])} = "{e["schwanz"]["typen"]}";')
    z += ["}  // namespace schwanz", "", "// Bereiche aus dem Vertragstext: bereich::<adresse>::<feld>_min, _max",
          "namespace bereich {"]
    for e in adressen:
        werte = []
        for f in e["felder"]:
            if f.get("bereich"):
                lo, hi = f["bereich"]
                if lo is not None:
                    werte.append(f"inline constexpr double {f['name']}_min = {zahl(lo)};")
                if hi is not None:
                    werte.append(f"inline constexpr double {f['name']}_max = {zahl(hi)};")
        if werte:
            z.append(f"namespace {bezeichner(e['adresse'])} {{ " + " ".join(werte) + " }")
    z += ["}  // namespace bereich", "", "namespace werte {"]
    for name, w in daten["werte"].items():
        if "codes" in w:
            z.append(f"enum class {kamel(name)} : std::int32_t {{ "
                     + ", ".join(f"{bez} = {code}" for code, bez in w["codes"].items()) + " };")
        elif "liste" in w:
            z.append(f"inline constexpr std::array<std::string_view, {len(w['liste'])}> {name}{{"
                     + ", ".join(f'"{s}"' for s in w["liste"]) + "};")
        elif "zahlen" in w:
            z.append(f"inline constexpr std::array<double, {len(w['zahlen'])}> {name}{{"
                     + ", ".join(zahl(float(x)) for x in w["zahlen"]) + "};")
    z += ["}  // namespace werte", "", "}  // namespace cypherdj::osc", ""]
    return "\n".join(z)


def erzeuge_ts(daten: dict) -> str:
    v = daten["vertrag"]
    z = ["// " + s for s in KOPF.format(v=v).split("\n")]
    z += ["// Nur löschbare Syntax (Konstanten und Typen), damit Node sie mit Type-Stripping laden kann.", "",
          f"export const VERTRAG = {v} as const;", "",
          "export type OscTyp = 'i' | 'h' | 'f' | 'd' | 's';",
          "export type Richtung = 'an_kern' | 'vom_kern' | 'von_notbahn';", "",
          "export const ADRESSEN = {"]
    for e in daten["adressen"]:
        felder = ", ".join(f"'{f['name']}'" for f in e["felder"])
        bereiche = ", ".join(
            f"{f['name']}: [{'null' if f['bereich'][0] is None else zahl(f['bereich'][0])}, "
            f"{'null' if f['bereich'][1] is None else zahl(f['bereich'][1])}]"
            for f in e["felder"] if f.get("bereich"))
        pm = "true" if e.get("nur_pruefmodus") else "false"
        sw = f"schwanz: '{e['schwanz']['typen']}', " if e.get("schwanz") else ""
        z.append(f"  '{e['adresse']}': {{ typen: '{e['typen']}', {sw}abschnitt: '{e['abschnitt']}', "
                 f"richtung: '{e['richtung']}', nurPruefmodus: {pm}, felder: [{felder}], "
                 f"bereiche: {{ {bereiche} }} }},".replace("{  }", "{}"))
    z += ["} as const;", "", "export type Adresse = keyof typeof ADRESSEN;", "",
          "/** Werte je Adresse in Feldreihenfolge: h (int64) als bigint, i, f, d als number, s als string. */",
          "export interface Werte {"]
    for e in daten["adressen"]:
        teile = ", ".join(f"{f['name']}: {TS_TYP[f['typ']]}" for f in e["felder"])
        z.append(f"  '{e['adresse']}': [{teile}];")
    z += ["}", ""]
    for name, w in daten["werte"].items():
        konst = name.upper()
        if "codes" in w:
            z.append(f"export const {konst} = {{ "
                     + ", ".join(f"{bez}: {code}" for code, bez in w["codes"].items()) + " } as const;")
        elif "liste" in w:
            z.append(f"export const {konst} = [" + ", ".join(f"'{s}'" for s in w["liste"]) + "] as const;")
        elif "zahlen" in w:
            z.append(f"export const {konst} = [" + ", ".join(zahl(x) for x in w["zahlen"]) + "] as const;")
    z.append("")
    return "\n".join(z)


def erzeuge(daten: dict) -> dict[str, str]:
    _pruefe_namen(daten)
    return {"osc_adressen.h": erzeuge_cpp(daten), "osc_adressen.ts": erzeuge_ts(daten)}


def main() -> int:
    daten = json.loads((HIER / "osc.json").read_text(encoding="utf-8"))
    for pfad, inhalt in erzeuge(daten).items():
        (HIER / pfad).write_text(inhalt, encoding="utf-8")
        print(f"geschrieben: djk/vertrag/{pfad} ({inhalt.count(chr(10))} Zeilen)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
