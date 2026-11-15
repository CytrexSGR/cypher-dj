#!/usr/bin/env python3
"""Writes the six factory presets of `bass-banddrive` (Band Drive Bass).

    python3 build_banddrive_presets.py     # writes ../../ui/presets/factory/modular/bass-banddrive-*.preset.json

Each preset gives its knobs in the units of the knob table of build_banddrive.py (names as in the table); the file holds all 24
knobs normalised 0..1, so a later change of a default cannot change a preset.
"""
import json
import math
import pathlib

from build_banddrive import K

ZIEL = pathlib.Path(__file__).resolve().parents[2] / "ui" / "presets" / "factory" / "modular"
NAMEN = {k[2]: k for k in K}


def norm(name, wert):
    _, _, _, lo, hi, log, *_ = NAMEN[name]
    assert lo <= wert <= hi, (name, wert)
    return (math.log(wert / lo) / math.log(hi / lo)) if log else (wert - lo) / (hi - lo)


def vorgabe(name):
    return norm(name, NAMEN[name][6])


# name, overrides in knob units, (art, unterart, charakter, genre, einsatz, energie), text
P = [
    ("Electro Growl",
     {"Wave position": 0.6, "Wave env amount": 0.5, "Wave LFO rate": 3.5, "Wave LFO depth": 0.55, "Detune": 6, "Width": 0.4, "Bite": 0.6, "Sub level": 0.75,
      "Cutoff": 2400, "Resonance": 0.3, "Env amount": 28, "Env decay": 0.12, "Mid drive": 0.7, "Vowel": 1.5, "Vowel move": 0.75, "High drive": 0.5, "Air": 0.9,
      "Attack": 0.002, "Decay/Sustain": 0.35, "Release": 0.08, "Output": -3},
     ("bass", "wobble", ["aggressive", "dirty", "evolving"], ["electro", "techno"], ["drop"], 4),
     "Growling electro bass for short eighth notes: a bite voice, a folded mid band and a vowel that talks on every note, with a clean mono sub underneath."),
    ("Wide Reese",
     {"Wave position": 0.6, "Wave env amount": 0.2, "Wave LFO rate": 0.25, "Wave LFO depth": 0.5, "Detune": 22, "Width": 0.9, "Bite": 0.15, "Sub level": 0.7,
      "Cutoff": 1400, "Resonance": 0.2, "Env amount": 6, "Env decay": 0.8, "Mid drive": 0.4, "Vowel": 0.5, "Vowel move": 0.25, "High drive": 0.25, "Air": 0.8,
      "Attack": 0.01, "Decay/Sustain": 0.9, "Release": 0.3, "Output": -3},
     ("bass", "reese", ["wide", "dark", "evolving"], ["dnb", "dubstep"], ["drop", "breakdown"], 4),
     "Reese with a wide, slowly breathing mid band: three copies detuned far apart, a slow swing in the cutoff and the wave position, sub and low end stay mono."),
    ("Neuro Stab",
     {"Wave position": 0.7, "Wave env amount": 0.4, "Wave LFO rate": 8, "Wave LFO depth": 0.4, "Detune": 12, "Width": 0.6, "Bite": 0.5, "Sub level": 0.6,
      "Cutoff": 3500, "Resonance": 0.4, "Env amount": 30, "Env decay": 0.1, "Mid drive": 0.8, "Vowel": 2.0, "Vowel move": 1.0, "High drive": 0.6, "Air": 1.0,
      "Attack": 0.002, "Decay/Sustain": 0.25, "Release": 0.06, "Output": -4},
     ("bass", "wobble", ["aggressive", "tight", "evolving"], ["dnb", "dubstep"], ["drop"], 5),
     "Short neuro stab: the vowel sweeps the whole a-e-i-o-u range at 8 Hz while a hard envelope snaps the filter open on each note."),
    ("Clean Sub Grit",
     {"Wave position": 0.62, "Wave env amount": 0.1, "Wave LFO rate": 0.5, "Wave LFO depth": 0.1, "Detune": 3, "Width": 0.2, "Bite": 0.0, "Sub level": 0.95,
      "Cutoff": 700, "Resonance": 0.1, "Env amount": 12, "Env decay": 0.2, "Mid drive": 0.25, "Vowel": 1.0, "Vowel move": 0.1, "High drive": 0.1, "Air": 0.4,
      "Attack": 0.004, "Decay/Sustain": 0.9, "Release": 0.12, "Output": -2},
     ("bass", "sub", ["clean", "deep", "smooth"], ["deep_house", "techno"], ["drop", "mixdown"], 3),
     "Mostly a pure sine sub with a little folded grit in the mids so the line still reads on small speakers."),
    ("Overdriven Rock",
     {"Wave position": 0.67, "Wave env amount": 0.0, "Wave LFO rate": 0.5, "Wave LFO depth": 0.0, "Detune": 3, "Width": 0.1, "Bite": 0.2, "Sub level": 0.75,
      "Cutoff": 1800, "Resonance": 0.15, "Env amount": 14, "Env decay": 0.25, "Mid drive": 0.85, "Vowel": 1.5, "Vowel move": 0.0, "High drive": 0.6, "Air": 0.7,
      "Attack": 0.003, "Decay/Sustain": 0.9, "Release": 0.1, "Output": -3},
     ("bass", "analog", ["dirty", "thick", "punchy"], ["techno", "electro"], ["drop", "mixdown"], 4),
     "Close to an overdriven bass guitar: a static saw, a hard folded mid band with a fixed vowel and a grainy top, no movement."),
    ("Acid Squelch",
     {"Wave position": 0.67, "Wave env amount": 0.0, "Wave LFO rate": 0.5, "Wave LFO depth": 0.05, "Detune": 2, "Width": 0.1, "Bite": 0.2, "Sub level": 0.6,
      "Cutoff": 600, "Resonance": 0.8, "Env amount": 48, "Env decay": 0.22, "Glide": 0.35, "Mid drive": 0.5, "Vowel": 0.5, "Vowel move": 0.2, "High drive": 0.4, "Air": 0.8,
      "Attack": 0.002, "Decay/Sustain": 0.6, "Release": 0.08, "Output": -4},
     ("bass", "acid", ["aggressive", "evolving", "tight"], ["acid", "techno"], ["drop", "build"], 5),
     "Acid-like squelch: high resonance and a strong, fast filter envelope with a short slide between notes."),
]

ZIEL.mkdir(parents=True, exist_ok=True)
for name, ue, (art, unter, char, genre, eins, en), text in P:
    assert set(ue) <= set(NAMEN), set(ue) - set(NAMEN)
    slug = "bass-banddrive-" + name.lower().replace(" ", "-")
    werte = {f"knob{k[0]}": round(norm(k[2], ue[k[2]]) if k[2] in ue else vorgabe(k[2]), 5) for k in K}
    doc = {"schema": 1, "name": name, "geraet_typ": "instrument", "geraet": "baukasten", "graph": "bass-banddrive", "werte": werte,
           "beschreibung": {"art": art, "unterart": unter, "charakter": char, "genre": genre, "einsatz": eins, "energie": en, "text": text},
           "tags": ["bass-banddrive", "band-split"], "notiz": "Measured by render, not heard yet (2026-11-15).",
           "angelegt": "2026-11-15T00:00:00.000Z", "geaendert": "2026-11-15T00:00:00.000Z"}
    (ZIEL / f"{slug}.preset.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
print(len(P), "presets in", ZIEL)
