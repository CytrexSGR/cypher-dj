#!/usr/bin/env python3
"""Writes the two factory presets that use the full-synth stage of synth-mono (knobs 33..60): an evolving lead and a bass with
delay and reverb. Both start from an existing 32-knob preset and set the new knobs on top. Usage: build_ausbau_presets_mono.py
Then rebuild the register: node ../../ui/presets/tool.ts bauen"""
import json
import pathlib

WERK = pathlib.Path(__file__).resolve().parents[2] / "ui" / "presets" / "factory" / "modular"
STAND = "2026-11-12T00:00:00.000Z"


def diskret(i, n):
    return i / (n - 1)


def log_pos(v, lo, hi):
    import math
    return math.log(v / lo) / math.log(hi / lo)


PRESETS = [
    {
        "slug": "synth-mono-evolving-lead", "name": "Mono Evolving Lead", "basis": "synth-mono-goa-lead",
        "neu": {14: 1.0,                                   # osc 1 pulse, so the PWM movement is heard
                36: 0.45, 37: 0.62, 38: 0.35, 39: 0.55,    # MOD ENV: slow attack, long decay, low sustain
                42: 0.8,                                   # MOD ENV to cutoff +36 st
                43: 0.5, 44: diskret(1, 4), 45: diskret(4, 7), 46: diskret(2, 5), 47: 0.8,   # LFO 2: triangle, 1/2 note, to PWM, +60 %
                48: 0.5, 49: 0.58,                         # velocity opens the filter a little
                53: 0.3, 54: diskret(2, 3), 57: 0.2, 55: log_pos(375, 20, 1000), 56: 0.4, 59: 0.15},
        "beschreibung": {"art": "lead", "unterart": "mono", "charakter": ["evolving", "bright", "wide"], "genre": ["trance", "progressive"],
                         "einsatz": ["build", "drop"], "energie": 4,
                         "text": "Pulse lead that opens slowly: the mod envelope sweeps the cutoff, a tempo-synced LFO 2 moves the pulse width every half note, chorus, delay and a little hall."},
    },
    {
        "slug": "synth-mono-dub-bass", "name": "Mono Dub Bass", "basis": "synth-mono-house-bass",
        "neu": {53: 0.15, 54: 0.0, 55: log_pos(375, 20, 1000), 56: 0.5, 57: 0.22, 60: 1.0, 59: 0.18},
        "beschreibung": {"art": "bass", "unterart": "analog", "charakter": ["warm", "deep", "wide"], "genre": ["house", "deep_house"],
                         "einsatz": ["drop", "intro"], "energie": 3,
                         "text": "Plucky house bass with a ping-pong delay at a dotted eighth, a short hall tail and a touch of chorus: the notes echo around a dry core."},
    },
]

for p in PRESETS:
    basis = json.loads((WERK / f"{p['basis']}.preset.json").read_text())
    werte = dict(basis["werte"])
    for nr, v in p["neu"].items():
        werte[f"knob{nr}"] = round(float(v), 4)
    werte = dict(sorted(werte.items(), key=lambda kv: int(kv[0][4:])))
    doc = {"schema": 1, "name": p["name"], "geraet_typ": "instrument", "geraet": "baukasten", "graph": "synth-mono", "werte": werte,
           "beschreibung": p["beschreibung"], "tags": ["synth-mono"],
           "notiz": "Measured by level on render, not yet heard (2026-11-12).", "angelegt": STAND, "geaendert": STAND}
    (WERK / f"{p['slug']}.preset.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(p["slug"], len(werte), "knobs")
