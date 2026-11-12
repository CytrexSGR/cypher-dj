#!/usr/bin/env python3
"""Writes the two factory presets that show the synth-poly build-out (second oscillator, MOD ENV, LFO 2, glide).

    python3 build_ausbau_presets_poly.py [werk dir]      # default: djk/ui/presets/factory/modular
    node djk/ui/presets/tool.ts bauen      # then rebuild the register

Every knob is written (1..57 of the graph; knobs the preset does not name stay at the graph's `vorgabe`). Values are plain numbers
turned into knob positions with the ranges of the graph, so the table reads in musical units.
"""
import json
import math
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
GRAPH = json.loads((HIER / "demos" / "synth-poly.json").read_text())
ZIEL = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HIER.parents[1] / "ui" / "presets" / "factory" / "modular"

# first regler node of every number: range, log flag, vorgabe
REGLER = {}
for k in GRAPH["knoten"]:
    if k["art"] == "regler" and k["nr"] not in REGLER:
        REGLER[k["nr"]] = k


def pos(nr, wert):
    """Knob position of the plain value `wert` of knob `nr` (linear or log, `mitte` not used by these presets)."""
    k = REGLER[nr]
    lo, hi = k["min"], k["max"]
    p = math.log(wert / lo) / math.log(hi / lo) if k.get("log") else (wert - lo) / (hi - lo)
    assert -1e-9 <= p <= 1 + 1e-9, (nr, wert, p)
    return round(min(1.0, max(0.0, p)), 4)


def stufe(i, n):
    return round(i / (n - 1), 4)


# synth-poly "Poly Goa Lead Stack" knobs as the starting point of the lead are overridden below; the pad starts from the graph's defaults
SYNC_LEAD = {
    1: 0.60, 2: 0.45, 3: 0.40, 4: 0.30, 5: 0.0, 6: 0.30, 7: 0.15, 8: 0.0, 9: 0.0, 10: 0.45, 11: 0.35, 12: 0.0, 13: 0.5, 14: 0.30, 15: 0.0,
    16: 0.4667, 17: 0.5, 18: 0.5, 19: 0.35, 20: 0.85, 21: 0.30, 22: 0.20, 23: 0.7845, 24: 0.0, 25: 0.0, 26: 0.5313, 27: 1.0, 28: 0.25,
    # MOD ENV: 2 ms attack, 0.9 s decay to nothing, 0.15 s release; it lifts the pitch of oscillator 2 by 14 st and lets it fall back
    31: pos(31, 0.002), 32: pos(32, 0.9), 33: 0.0, 34: pos(34, 0.15), 38: 0.5 + 14 / 48,
    # oscillator 2: saw, same octave, 7 ct sharp, hard-synced to oscillator 1
    46: 0.85, 47: 0.0, 48: stufe(2, 5), 49: 0.5, 50: 0.5 + 7 / 100, 51: 1.0,
    54: stufe(2, 7), 56: 0.5 + 0.5 * 8 / 36,
}
SLOW_PAD = {
    1: 0.45, 2: 0.25, 3: 0.25, 4: 0.6, 5: 0.8, 6: 0.8, 7: 0.6, 8: 0.5, 9: 0.5, 10: 0.5, 11: 0.8, 12: 0.2, 13: 0.5, 14: 0.4, 15: 0.0,
    16: 0.5, 17: 0.5, 18: 0.5, 19: 0.7, 20: 0.85, 21: 0.7, 22: 0.6, 23: 0.3, 24: 0.0, 25: 0.3, 26: 0.0, 27: 1.0, 28: 0.25,
    # LFO 2: synced to one bar (position 6 of 7), onto the cutoff, +-7 st; the free rate and shape do not act while it is synced
    41: stufe(5, 7), 42: 0.0, 43: 0.5 + 0.5 * 7 / 24,
    # oscillator 2: saw one octave down, 5 ct sharp, free running
    46: 0.45, 47: 0.0, 48: stufe(1, 5), 49: 0.5, 50: 0.5 + 5 / 100, 51: 0.0,
}

PRESETS = [
    ("synth-poly-sync-lead", "Poly Sync Lead", SYNC_LEAD, {
        "art": "lead", "unterart": "sync", "charakter": ["bright", "aggressive", "thin"], "genre": ["trance", "electro"], "einsatz": ["drop", "build"], "energie": 4,
        "text": "Three saws and a hard-synced second oscillator 7 ct sharp; the mod envelope sweeps its pitch up 14 st and back in 0.9 s, with a 50 ms glide and vibrato."}),
    ("synth-poly-slow-sweep-pad", "Poly Slow Sweep Pad", SLOW_PAD, {
        "art": "pad", "unterart": "atmosphere", "charakter": ["warm", "wide", "evolving"], "genre": ["deep_house", "ambient", "progressive"], "einsatz": ["breakdown", "intro"], "energie": 2,
        "text": "Five saws and a second oscillator an octave down; LFO 2 opens and closes the cutoff once per bar, locked to the tempo (the channel reverb adds the room)."}),
]


def schreibe(slug, name, knoepfe, beschreibung):
    werte = {}
    for nr in sorted(REGLER):
        v = knoepfe.get(nr, REGLER[nr].get("vorgabe", 0.5))
        werte[f"knob{nr}"] = round(v, 4)
    assert all(0.0 <= v <= 1.0 for v in werte.values()), slug
    assert set(knoepfe) <= set(REGLER), set(knoepfe) - set(REGLER)
    p = {"schema": 1, "name": name, "geraet_typ": "instrument", "geraet": "baukasten", "graph": "synth-poly", "werte": werte,
         "beschreibung": beschreibung, "tags": ["synth-poly"], "notiz": "Measured by level and pitch on render, not yet heard (2026-11-12).",
         "angelegt": "2026-11-12T00:00:00.000Z", "geaendert": "2026-11-12T00:00:00.000Z"}
    (ZIEL / f"{slug}.preset.json").write_text(json.dumps(p, indent=1, ensure_ascii=False) + "\n")
    print(slug, len(werte), "knobs")


if __name__ == "__main__":
    for s in PRESETS:
        schreibe(*s)
