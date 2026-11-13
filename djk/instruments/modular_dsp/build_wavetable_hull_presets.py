#!/usr/bin/env python3
"""Writes the six factory presets that use the wave envelope (2 each for wavetable-chor, -reese, -supersaw).

    python3 build_wavetable_hull_presets.py        # writes ../../oberflaeche/presets/werk/baukasten/wavetable-*.preset.json

Knobs are normalised 0..1. Knob 7 (wave env amount) maps -1..1, so 0.5 = off; 8 and 9 are log scales (5 ms..4 s, 50 ms..6 s).
"""
import json
import pathlib

ZIEL = pathlib.Path(__file__).resolve().parents[2] / "ui" / "presets" / "werk" / "baukasten"

P = [
    ("wavetable-chor", "Vowel Bloom", {1: 0.0, 2: 0.1, 3: 0.35, 4: 0.8, 5: 0.5, 6: 0.6, 7: 0.8, 8: 0.55, 9: 0.6},
     ("pad", "choir", ["evolving", "warm", "wide"], ["ambient", "deep_house"], ["intro", "breakdown"], 2),
     "Choir pad that opens from the first vowel to the last as each note blooms; the wave envelope sweeps the vowel table over about a second."),
    ("wavetable-chor", "Reverse Sigh", {1: 1.0, 2: 0.05, 3: 0.25, 4: 0.9, 5: 0.35, 6: 0.7, 7: 0.15, 8: 0.3, 9: 0.7},
     ("pad", "choir", ["evolving", "soft", "wide"], ["ambient", "downtempo"], ["breakdown", "transition"], 2),
     "Choir that starts on the last vowel and sighs back toward the first as the wave envelope falls."),
    ("wavetable-reese", "Sine Collapse", {1: 0.45, 2: 0.3, 3: 0.3, 4: 0.5, 5: 0.4, 6: 0.5, 7: 0.1, 8: 0.2, 9: 0.55},
     ("bass", "reese", ["deep", "dark", "evolving"], ["dnb", "dubstep"], ["drop"], 4),
     "Reese bass whose wave envelope starts at the sine and returns to the saw: a soft thump at the start of every note, then the full growl."),
    ("wavetable-reese", "Square Punch", {1: 0.55, 2: 0.25, 3: 0.2, 4: 0.4, 5: 0.35, 6: 0.4, 7: 0.75, 8: 0.1, 9: 0.45},
     ("bass", "reese", ["punchy", "thick", "dirty"], ["techno", "dnb"], ["drop"], 4),
     "Reese bass with a hollow square-wave punch on the attack that decays into the saw."),
    ("wavetable-supersaw", "Morph Stab", {1: 0.8, 2: 0.1, 3: 0.5, 4: 0.9, 5: 0.25, 6: 0.45, 7: 0.8, 8: 0.2, 9: 0.5},
     ("lead", "supersaw", ["bright", "wide", "punchy"], ["trance", "progressive"], ["drop", "build"], 4),
     "Wide supersaw that snaps from the saw into a square-wave stack on each note and relaxes back; chord stabs with a moving edge."),
    ("wavetable-supersaw", "Triangle Swell", {1: 0.65, 2: 0.1, 3: 0.4, 4: 0.9, 5: 0.5, 6: 0.55, 7: 0.275, 8: 0.7, 9: 0.8},
     ("pad", "analog", ["warm", "wide", "smooth"], ["trance", "ambient"], ["intro", "breakdown"], 2),
     "Slow supersaw swell: the wave envelope rises over a second from a soft triangle blend and settles on the saw."),
]
ZIEL.mkdir(parents=True, exist_ok=True)
for graph, name, k, (art, unter, char, genre, eins, en), text in P:
    slug = f"{graph}-" + name.lower().replace(" ", "-")
    doc = {"schema": 1, "name": f"{graph.split('-')[1].capitalize()} {name}", "geraet_typ": "instrument", "geraet": "baukasten", "graph": graph,
           "werte": {f"knob{n}": v for n, v in sorted(k.items())},
           "beschreibung": {"art": art, "unterart": unter, "charakter": char, "genre": genre, "einsatz": eins, "energie": en, "text": text},
           "tags": [graph, "wave-envelope"], "notiz": "Measured by level on render, not yet heard (2026-11-11).",
           "angelegt": "2026-11-11T00:00:00.000Z", "geaendert": "2026-11-11T00:00:00.000Z"}
    (ZIEL / f"{slug}.preset.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
print(len(P), "presets in", ZIEL)
