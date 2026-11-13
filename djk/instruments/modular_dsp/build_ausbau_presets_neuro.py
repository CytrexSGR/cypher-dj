#!/usr/bin/env python3
"""Two factory presets that use the synth build-out knobs of synth-neuro (25..45; 44 is free): a talking bass with LFO 2 on the fold and a
rumble with delay and reverb. Writes werk/baukasten/synth-neuro-<slug>.preset.json. Usage: build_ausbau_presets_neuro.py [werk dir]
Every preset lists all knobs of the graph (1..43, 45); 1..24 are the values of the existing preset the new one grows from.
Run `node djk/ui/presets/tool.ts bauen` afterwards to refresh presets/register.json."""
import json
import os
import re
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WERK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HIER, "..", "..", "ui", "presets", "werk")

# the new knobs at their vorgabe (what every older preset gets), changed per preset below
NEU = {25: 0.5, 26: 0.5, 27: 0.5, 28: 0.0, 29: 0.6667, 30: 0.5, 31: 0.5, 32: 0.6157, 33: 0.0, 34: 0.0, 35: 0.0, 36: 0.5, 37: 0.0,
       38: 0.0, 39: 0.5, 40: 0.5, 41: 0.7946, 42: 0.3889, 43: 0.0, 45: 0.0}

PRESETS = [
    {"name": "Fold Talker",
     "alt": {1: 0.35, 2: 0.55, 3: 0.5, 4: 0.4, 5: 0.5, 6: 0.5, 7: 0.6667, 8: 0.5, 9: 0.55, 10: 0.6, 11: 0.8, 12: 0.0, 13: 0.5, 14: 0.4,
             15: 0.12, 16: 0.5, 17: 0.0, 18: 0.5, 19: 0.5, 20: 0.5, 21: 0.45, 22: 0.3, 23: 0.5, 24: 0.55},
     # LFO 2 synced to 1/8 (sync stop 2 of 6), target fold (1 of 4), +60 %: the fold breathes by up to +-11 dB with the vowel walk;
     # a sine one octave down under the saws (osc 2), a medium velocity depth
     "neu": {28: 0.22, 29: 0.0, 30: 0.25, 34: 0.3333, 35: 0.25, 36: 0.8, 38: 0.5, 26: 0.45, 27: 0.55},
     "beschreibung": {"art": "bass", "unterart": "wobble", "charakter": ["evolving", "dirty", "punchy"], "genre": ["dnb", "dubstep"],
                      "einsatz": ["drop"], "energie": 4,
                      "text": "The vowel bass with a second LFO breathing the wavefolder on every eighth note, a sine one octave down under the saws and some velocity."}},
    {"name": "Deep Rumble",
     "alt": {1: 0.3, 2: 0.35, 3: 0.8333, 4: 0.25, 5: 0.65, 6: 0.3, 7: 0.8333, 8: 0.8, 9: 0.55, 10: 0.55, 11: 0.4, 12: 0.0, 13: 1.0, 14: 0.15,
             15: 0.0, 16: 0.5, 17: 0.0, 18: 0.5, 19: 0.5, 20: 0.78, 21: 0.15, 22: 0.22, 23: 0.5, 24: 0.5},
     # a dotted-eighth style delay (about 280 ms, feedback 45 %) and a long dark hall; shorter amp decay with a lower sustain
     "neu": {26: 0.4, 27: 0.4, 41: 0.7, 42: 0.5, 43: 0.2, 45: 0.28, 37: 0.3},
     "beschreibung": {"art": "bass", "unterart": "rolling", "charakter": ["dark", "deep", "thick"], "genre": ["techno"],
                      "einsatz": ["drop", "intro"], "energie": 3,
                      "text": "The dark rolling bass with a feedback delay and a long hall behind it, a shorter amp decay and some key follow: a rumble that echoes away."}},
]

os.makedirs(os.path.join(WERK, "baukasten"), exist_ok=True)
for p in PRESETS:
    werte = {**p["alt"], **NEU, **p["neu"]}
    slug = "synth-neuro-" + re.sub(r"[^a-z0-9]+", "-", p["name"].lower()).strip("-")
    doc = {"schema": 1, "name": "Neuro " + p["name"], "geraet_typ": "instrument", "geraet": "baukasten", "graph": "synth-neuro",
           "werte": {f"knob{k}": round(float(v), 4) for k, v in sorted(werte.items())},
           "beschreibung": p["beschreibung"], "tags": ["synth-neuro"],
           "notiz": "Measured by level and pitch on render, not yet heard (2026-11-12).",
           "angelegt": "2026-11-12T00:00:00.000Z", "geaendert": "2026-11-12T00:00:00.000Z"}
    with open(os.path.join(WERK, "baukasten", slug + ".preset.json"), "w") as f:
        f.write(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(slug)
