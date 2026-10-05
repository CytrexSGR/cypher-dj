#!/usr/bin/env python3
"""Erzeugt baender_koeff.h aus djk/vertrag/baender.json (zur Bauzeit, aus CMake).
Aufruf: erzeuge_baender_h.py <baender.json> <ausgabe.h>
Die Zahlen werden mit repr() geschrieben: 17 gültige Stellen, jede double kommt bitgleich an.
Bei einer Datei, die nicht der erwarteten Form entspricht, bricht es mit Rückgabewert 1 und der
Meldung aus baender_json.FormatFehler ab (dann bricht auch der Bau)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import baender_json  # noqa: E402

quelle, ziel = sys.argv[1], sys.argv[2]
try:
    baender, k_sos = baender_json.lade(quelle)
except (baender_json.FormatFehler, OSError, ValueError, KeyError, TypeError) as f:
    print(f"erzeuge_baender_h: {quelle}: {f}", file=sys.stderr)
    sys.exit(1)


def band(von, bis, sos):
    zeilen = ", ".join("{" + ", ".join(repr(v) for v in s) + "}" for s in sos)
    return f"BandKoeff{{{von!r}, {bis!r}, {len(sos)}, {{{zeilen}}}}}"


z = ["// ERZEUGT von erzeuge_baender_h.py aus " + os.path.basename(quelle) + ", nicht von Hand aendern.",
     "#pragma once",
     '#include "cypherdj/dsp/analyse_baender.h"',
     "namespace cypherdj::dsp {",
     "inline constexpr BaenderKoeff kVertragBaender = {",
     "  {"]
for name, von, bis, sos in baender:
    z.append(f"    {band(von, bis, sos)},  // {name}")
z += ["  },", f"  {band(0.0, 0.0, k_sos)},  // k_filter", "};", "}  // namespace cypherdj::dsp", ""]
os.makedirs(os.path.dirname(os.path.abspath(ziel)), exist_ok=True)
with open(ziel, "w") as f:
    f.write("\n".join(z))
