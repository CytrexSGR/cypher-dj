#!/usr/bin/env python3
"""Writes the twelve factory presets of `synth-greif` (Greif).

    python3 build_greif_presets.py     # writes ../../ui/presets/factory/modular/synth-greif-*.preset.json
    python3 build_greif_presets.py --greif2   # the same twelve on synth-greif2 (Greif 2): same knob values, other tables, for an A/B

Each preset gives its knobs in the units of the knob table of build_greif.py (names as in the table; selectors by option index); the
file holds all 63 knobs normalised 0..1, so a later change of a default cannot change a preset.
"""
import json
import math
import pathlib
import sys

from build_greif import K

ZIEL = pathlib.Path(__file__).resolve().parents[2] / "ui" / "presets" / "factory" / "modular"
NAMEN = {k[2]: k for k in K}
GRAPH = "synth-greif2" if "--greif2" in sys.argv else "synth-greif"
NOTIZ = ("Greif's knob values on the tables of Greif 2, for an A/B with Greif; measured by render, not heard yet (2026-11-16)."
         if GRAPH == "synth-greif2" else "Measured by render, not heard yet (2026-11-16).")
OFF, BEND, ASYM, SYNC = 0, 1, 2, 3

# per-preset note that replaces NOTIZ on synth-greif (Pluck Stab: volume raised by hand on 2026-11-16, 70eb2b278; the script carries it since 2026-11-19)
NOTIZ_JE = {"Pluck Stab": "Measured by render (2026-11-16). Volume raised to the top after Andreas heard it too quiet in a mix (2026-11-16)."}

# table positions (see tabelle_a): sine 0, triangle 0.143, saw 0.286, square 0.429, pulse 0.571, hollow 0.857, digital 1
# table B (vocal): u 0, o 0.25, a 0.5, e 0.75, i 1


def norm(name, wert):
    _, _, _, lo, hi, log, *_ = NAMEN[name]
    assert lo <= wert <= hi, (name, wert)
    return (math.log(wert / lo) / math.log(hi / lo)) if log else (wert - lo) / (hi - lo)


def vorgabe(name):
    return norm(name, NAMEN[name][6])


# name, overrides in knob units, (art, unterart, charakter, genre, einsatz, energie), text
P = [
    # ---- bass
    ("Sub Anchor",
     {"A Position": 0.08, "A Warp": OFF, "A Level": 0.45, "B Level": 0.0, "C Level": 0.0, "Detune": 4, "Width": 0.15, "Sub Shape": 0.05, "Sub Octave": 0,
      "Sub Level": 0.85, "Noise Level": 0.0, "F1 Cutoff": 1100, "F1 Resonance": 0.1, "F1 Env": 10, "F1 Key": 0.3, "Drive": 0.1, "F2 Cutoff": 6000,
      "Amp Decay": 2.0, "Amp Sustain": 0.9, "Amp Release": 0.12, "LFO1 >Position": 0.0, "LFO1 >Cutoff": 0.0, "Chaos >Cutoff": 0.0, "Chaos >Position": 0.0,
      "Env3 >Position": 0.0, "LFO2 >Pitch": 0.0, "LFO2 >Depth": 0.0, "PM B>A": 0.0, "PM C>A": 0.0, "PM C>B": 0.0, "Shift Mix": 0.0, "Chorus Mix": 0.0, "Delay Mix": 0.0,
      "Volume": 6},
     ("bass", "sub", ["clean", "deep", "smooth"], ["deep_house", "techno"], ["drop", "mixdown"], 3),
     "A heavy sine sub under a clean, softly filtered triangle: the low end carries the line and the top stays out of the way."),
    ("Phase Growl",
     {"A Position": 0.29, "A Warp": BEND, "A Depth": 0.3, "B Position": 0.0, "B Warp": OFF, "B Level": 0.3, "B Pitch": 12, "B Fine": 0, "C Level": 0.0, "PM B>A": 0.45,
      "PM C>B": 0.0, "PM C>A": 0.0, "Detune": 8, "Width": 0.3, "Sub Octave": 0, "Sub Level": 0.5, "Noise Level": 0.0, "F1 Cutoff": 1500, "F1 Resonance": 0.35, "F1 Env": 30,
      "Drive": 0.5, "F2 Cutoff": 5000, "F2 Resonance": 0.2, "Filter Decay": 0.25, "Filter Sustain": 0.15, "Amp Decay": 0.5, "Amp Sustain": 0.8, "Amp Release": 0.12,
      "LFO1 Rate": 4.0, "LFO1 >Position": 0.2, "LFO1 >Cutoff": 14, "LFO2 >Depth": 0.15, "Chorus Mix": 0.0, "Shift Mix": 0.0, "Delay Mix": 0.0, "Volume": 5},
     ("bass", "wobble", ["aggressive", "dirty", "evolving"], ["dubstep", "dnb"], ["drop"], 5),
     "Growling bass: a second oscillator an octave up bends the phase of the first, and a four hertz wobble opens and closes the filter."),
    ("Sync Stab Bass",
     {"A Position": 0.29, "A Warp": SYNC, "A Depth": 0.5, "A Level": 0.9, "B Position": 0.43, "B Warp": SYNC, "B Depth": 0.35, "B Pitch": -12, "B Level": 0.4, "B Fine": 0,
      "C Level": 0.0, "PM B>A": 0.0, "PM C>A": 0.0, "PM C>B": 0.0, "Detune": 6, "Width": 0.1, "Sub Level": 0.4, "Sub Octave": 0, "Noise Level": 0.0, "F1 Cutoff": 1800,
      "F1 Resonance": 0.3, "F1 Env": 34, "Drive": 0.35, "F2 Cutoff": 7000, "Filter Decay": 0.18, "Filter Sustain": 0.1, "Amp Decay": 0.35, "Amp Sustain": 0.6, "Amp Release": 0.1,
      "LFO2 Rate": 1.4, "LFO2 >Depth": 0.3, "LFO1 >Position": 0.0, "Env3 >Position": 0.0, "Chorus Mix": 0.0, "Shift Mix": 0.0, "Delay Mix": 0.0, "Volume": 6},
     ("bass", "analog", ["tight", "aggressive", "punchy"], ["techno", "electro"], ["drop", "build"], 4),
     "Short bass stab with hard sync on two oscillators; a slow sine sweeps the sync depth so the bite changes from note to note."),
    # ---- lead
    ("Glass Lead",
     {"A Position": 0.29, "A Warp": OFF, "A Level": 0.55, "B Level": 0.0, "C Position": 0.55, "C Warp": OFF, "C Pitch": 12, "C Level": 0.3, "PM C>A": 0.1, "PM B>A": 0.0,
      "PM C>B": 0.0, "Detune": 10, "Width": 0.7, "Sub Level": 0.0, "Noise Level": 0.0, "F1 Cutoff": 7000, "F1 Resonance": 0.15, "F1 Env": 8, "F1 Key": 1.2, "Drive": 0.0,
      "Filter Decay": 0.8, "Amp Attack": 0.01, "Amp Decay": 1.5, "Amp Sustain": 0.85, "Amp Release": 0.45, "LFO1 >Cutoff": 0.0, "Env3 >Position": 0.0, "LFO2 Rate": 5.0,
      "LFO2 >Pitch": 9, "Chorus Mix": 0.4, "Shift Mix": 0.12, "Shift Hz": 3.0, "Delay Time": 420, "Delay Mix": 0.25, "Volume": 2.5},
     ("lead", "poly", ["bright", "wide", "airy"], ["trance", "progressive"], ["breakdown", "build"], 3),
     "Bright saw lead with a thin bell tone an octave above and a little phase bend, wide chorus and a slow echo."),
    ("Vowel Lead",
     {"A Level": 0.25, "A Position": 0.29, "B Position": 0.5, "B Warp": OFF, "B Level": 0.8, "B Pitch": 0, "B Fine": 4, "C Level": 0.0, "PM B>A": 0.0, "PM C>A": 0.0, "PM C>B": 0.0,
      "Detune": 9, "Width": 0.4, "Sub Level": 0.0, "Noise Level": 0.04, "F1 Cutoff": 6000, "F1 Resonance": 0.1, "F1 Env": 6, "Drive": 0.1, "LFO1 Rate": 0.45, "LFO1 >Position": 0.3,
      "Chaos Rate": 0.3, "Chaos >Position": 0.12, "Env3 >Position": 0.2, "Env3 Decay": 1.2, "Glide": 0.4, "Amp Attack": 0.02, "Amp Decay": 1.5, "Amp Sustain": 0.85, "Amp Release": 0.35,
      "LFO2 >Pitch": 8, "Chorus Mix": 0.25, "Shift Mix": 0.0, "Delay Time": 300, "Delay Mix": 0.18, "Volume": 0},
     ("lead", "mono", ["evolving", "smooth", "warm"], ["progressive", "downtempo"], ["intro", "breakdown"], 3),
     "A singing lead: the vocal table sweeps from dark u to bright i over each note and again with a slow wave, with a short slide between notes."),
    ("Sync Edge",
     {"A Position": 0.29, "A Warp": SYNC, "A Depth": 0.45, "A Level": 0.6, "A Pitch": 0, "B Position": 0.29, "B Warp": ASYM, "B Depth": 0.4, "B Level": 0.4, "B Pitch": 12, "B Fine": 7,
      "C Level": 0.0, "PM B>A": 0.0, "PM C>A": 0.0, "PM C>B": 0.0, "Detune": 16, "Width": 0.5, "Sub Level": 0.0, "Noise Level": 0.0, "F1 Cutoff": 5000, "F1 Resonance": 0.35,
      "F1 Env": 12, "F1 Key": 1.5, "Drive": 0.3, "LFO2 Rate": 0.9, "LFO2 >Depth": 0.35, "LFO2 >Pitch": 5, "Amp Attack": 0.005, "Amp Decay": 1.0, "Amp Sustain": 0.8, "Amp Release": 0.25,
      "Chorus Mix": 0.2, "Shift Mix": 0.0, "Delay Time": 360, "Delay Mix": 0.2, "Volume": 0},
     ("lead", "sync", ["aggressive", "bright", "thick"], ["techno", "trance"], ["drop", "build"], 5),
     "Cutting sync lead: two warped oscillators an octave apart, the sync depth drifts with a slow sine so the edge keeps moving."),
    # ---- pad
    ("Slow Scan Pad",
     {"A Position": 0.0, "A Level": 0.5, "B Position": 0.0, "B Level": 0.3, "C Position": 0.0, "C Level": 0.25, "C Pitch": 0, "PM B>A": 0.0, "PM C>A": 0.02, "PM C>B": 0.0,
      "Detune": 18, "Width": 0.9, "Sub Level": 0.0, "Noise Level": 0.03, "F1 Cutoff": 3000, "F1 Resonance": 0.15, "F1 Env": 6, "Drive": 0.0, "Env3 Attack": 3.0, "Env3 Decay": 5.0,
      "Env3 >Position": 0.7, "LFO1 Rate": 0.08, "LFO1 >Position": 0.4, "LFO1 >Cutoff": 6, "Amp Attack": 1.4, "Amp Decay": 3.0, "Amp Sustain": 0.9, "Amp Release": 2.5,
      "Filter Attack": 1.5, "Filter Decay": 4.0, "Filter Sustain": 0.6, "Filter Release": 2.0, "Chorus Mix": 0.5, "Shift Mix": 0.1, "Shift Hz": 0.7, "Delay Time": 520, "Delay Mix": 0.3, "Volume": 1},
     ("pad", "atmosphere", ["evolving", "wide", "soft"], ["ambient", "progressive"], ["intro", "breakdown"], 2),
     "A pad that travels through all three tables very slowly; envelope and a slow wave move the position together."),
    ("Chaos Drift Pad",
     {"A Position": 0.4, "A Level": 0.5, "B Position": 0.3, "B Level": 0.35, "C Position": 0.5, "C Level": 0.2, "C Pitch": 7, "PM B>A": 0.03, "PM C>A": 0.05, "PM C>B": 0.05,
      "Detune": 22, "Width": 1.0, "Sub Level": 0.0, "Noise Level": 0.04, "F1 Cutoff": 2200, "F1 Resonance": 0.25, "F1 Env": 4, "Drive": 0.05, "Chaos Rate": 0.35, "Chaos >Cutoff": 20,
      "Chaos >Position": 0.4, "Env3 >Position": 0.0, "LFO1 >Position": 0.0, "LFO1 >Cutoff": 0.0, "Amp Attack": 1.0, "Amp Decay": 3.0, "Amp Sustain": 0.9, "Amp Release": 3.0,
      "Filter Decay": 3.0, "Filter Sustain": 0.7, "Chorus Mix": 0.45, "Shift Mix": 0.18, "Shift Hz": 0.4, "Delay Time": 640, "Delay Mix": 0.3, "Volume": 1},
     ("pad", "atmosphere", ["evolving", "dark", "wide"], ["ambient", "downtempo"], ["intro", "breakdown"], 2),
     "A dark pad whose position and filter wander on a Lorenz curve: no two bars are alike, and a slow shifter beats softly on top."),
    ("Octave Choir",
     {"A Position": 0.29, "A Level": 0.4, "A Warp": OFF, "B Position": 0.5, "B Level": 0.55, "B Warp": OFF, "C Level": 0.0, "PM B>A": 0.0, "PM C>A": 0.0, "PM C>B": 0.0,
      "Stack": 1, "Detune": 14, "Width": 0.9, "Sub Level": 0.0, "Noise Level": 0.05, "F1 Cutoff": 2800, "F1 Resonance": 0.12, "F1 Env": 5, "F1 Key": 1.0, "Drive": 0.0,
      "LFO1 Rate": 0.2, "LFO1 >Position": 0.2, "Env3 Attack": 1.5, "Env3 Decay": 3.0, "Env3 >Position": 0.25, "Amp Attack": 0.9, "Amp Decay": 2.0, "Amp Sustain": 0.9, "Amp Release": 1.8,
      "Chorus Mix": 0.45, "Shift Mix": 0.0, "Delay Time": 480, "Delay Mix": 0.25, "Volume": 0.5},
     ("pad", "choir", ["thick", "wide", "warm"], ["ambient", "progressive"], ["breakdown", "intro"], 3),
     "A choir-like pad: the odd unison copies sound an octave up, over the vocal table and a soft saw."),
    # ---- keys and pluck
    ("Bell Keys",
     {"A Position": 0.0, "A Level": 0.35, "A Pitch": 0, "B Level": 0.0, "C Position": 0.6, "C Warp": OFF, "C Pitch": 12, "C Level": 0.6, "PM C>A": 0.25, "PM B>A": 0.0, "PM C>B": 0.0,
      "Detune": 4, "Width": 0.4, "Sub Level": 0.0, "Noise Level": 0.0, "F1 Cutoff": 9000, "F1 Resonance": 0.08, "F1 Env": 12, "F1 Key": 1.0, "Drive": 0.0, "Filter Decay": 0.6,
      "Filter Sustain": 0.2, "Amp Attack": 0.002, "Amp Decay": 1.8, "Amp Sustain": 0.0, "Amp Release": 1.2, "LFO1 >Cutoff": 0.0, "LFO1 >Position": 0.0, "Env3 Decay": 1.5, "Env3 >Position": 0.35,
      "Chorus Mix": 0.2, "Shift Mix": 0.2, "Shift Hz": 42.0, "Delay Time": 380, "Delay Mix": 0.25, "Volume": 3.5},
     ("keys", "bell", ["bright", "metallic", "airy"], ["ambient", "downtempo"], ["intro", "breakdown"], 2),
     "A bell: the inharmonic-looking table an octave up bends a sine through phase modulation, a shifted copy rings on top."),
    ("Pluck Stab",
     {"A Position": 0.43, "A Warp": BEND, "A Depth": 0.2, "A Level": 0.6, "B Position": 0.57, "B Warp": OFF, "B Level": 0.3, "B Pitch": 12, "B Fine": 0, "C Level": 0.0,
      "PM B>A": 0.1, "PM C>A": 0.0, "PM C>B": 0.0, "Detune": 12, "Width": 0.6, "Sub Level": 0.0, "Noise Level": 0.02, "F1 Cutoff": 1800, "F1 Resonance": 0.25, "F1 Env": 36, "F1 Key": 1.0,
      "Drive": 0.2, "Filter Attack": 0.001, "Filter Decay": 0.22, "Filter Sustain": 0.0, "Amp Attack": 0.002, "Amp Decay": 0.35, "Amp Sustain": 0.0, "Amp Release": 0.25,
      "Env3 Decay": 0.2, "Env3 >Position": 0.3, "Chorus Mix": 0.3, "Shift Mix": 0.0, "Delay Time": 280, "Delay Mix": 0.2, "Volume": 6},
     ("pluck", "stab", ["punchy", "tight", "bright"], ["house", "tech_house"], ["drop", "build"], 4),
     "Short chord stab: a square-ish table with a fast filter snap and a quick sweep of the position on each hit."),
    # ---- texture
    ("Shift Drone",
     {"A Position": 0.857, "A Level": 0.4, "A Warp": ASYM, "A Depth": 0.3, "B Position": 0.2, "B Level": 0.35, "B Warp": OFF, "C Position": 0.7, "C Level": 0.3, "C Pitch": -12,
      "PM B>A": 0.1, "PM C>A": 0.12, "PM C>B": 0.1, "Detune": 30, "Width": 1.0, "Stack": 2, "Sub Level": 0.0, "Noise Level": 0.1, "F1 Cutoff": 1800, "F1 Resonance": 0.3, "F1 Env": 0.0,
      "Drive": 0.1, "Chaos Rate": 0.2, "Chaos >Cutoff": 22, "Chaos >Position": 0.4, "LFO1 Rate": 0.06, "LFO1 >Position": 0.3, "Amp Attack": 2.5, "Amp Decay": 3.0, "Amp Sustain": 1.0,
      "Amp Release": 4.0, "LFO2 Rate": 0.15, "LFO2 >Depth": 0.4, "Chorus Mix": 0.6, "Shift Hz": 55.0, "Shift Mix": 0.5, "Delay Time": 780, "Delay Mix": 0.5, "Volume": -1},
     ("fx", "texture", ["dark", "metallic", "evolving"], ["ambient", "idm"], ["intro", "transition"], 2),
     "An unsettled drone: warped hollow spectra, a Lorenz wander and a frequency shifter that turns the harmonics inharmonic."),
]

ZIEL.mkdir(parents=True, exist_ok=True)
for name, ue, (art, unter, char, genre, eins, en), text in P:
    assert set(ue) <= set(NAMEN), set(ue) - set(NAMEN)
    slug = f"{GRAPH}-" + name.lower().replace(" ", "-")
    werte = {f"knob{k[0]}": round(norm(k[2], ue[k[2]]) if k[2] in ue else vorgabe(k[2]), 5) for k in K}
    # on Greif 2 the display name gets " II" so the sound list does not show every Greif sound twice; slug, id and values stay
    anzeige = f"{name} II" if GRAPH == "synth-greif2" else name
    doc = {"schema": 1, "name": anzeige, "geraet_typ": "instrument", "geraet": "baukasten", "graph": GRAPH, "werte": werte,
           "beschreibung": {"art": art, "unterart": unter, "charakter": char, "genre": genre, "einsatz": eins, "energie": en, "text": text},
           "tags": [GRAPH, "wavetable"], "notiz": NOTIZ_JE.get(name, NOTIZ) if GRAPH == "synth-greif" else NOTIZ,
           "angelegt": "2026-11-16T00:00:00.000Z", "geaendert": "2026-11-16T00:00:00.000Z"}
    (ZIEL / f"{slug}.preset.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
print(len(P), "presets in", ZIEL)
