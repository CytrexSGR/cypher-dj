#!/usr/bin/env python3
"""Gives the Drift `regler` nodes a start position (`"vorgabe": 0.25`). Idempotent.

    python3 setze_drift_default.py        # demos/synth-mono.json (knob 32) and demos/synth-poly.json (knob 28), in place

0.25 is the value the Drift panel control and the factory presets already use; a project that never stored the knob now loads it instead of 0.5.
The file text is edited line by line, so the layout of the committed graph stays as it is (synth-poly.json is also written by build_synth_poly.py,
which emits the same field: regenerating gives the same file).
"""
import json
import pathlib

HIER = pathlib.Path(__file__).resolve().parent
VORGABE = 0.25
ZIELE = {"synth-mono.json": 32, "synth-poly.json": 28}


def setze(pfad: pathlib.Path, nr: int) -> bool:
    text = pfad.read_text()
    alt = f'{{"id": "k_drift", "art": "regler", "nr": {nr}, "min": 0, "max": 1}}'
    neu = f'{{"id": "k_drift", "art": "regler", "nr": {nr}, "min": 0, "max": 1, "vorgabe": {VORGABE}}}'
    if neu in text:
        return False
    if text.count(alt) != 1:
        raise SystemExit(f"{pfad.name}: the Drift node of knob {nr} was not found exactly once")
    pfad.write_text(text.replace(alt, neu))
    json.loads(pfad.read_text())   # still valid JSON
    return True


if __name__ == "__main__":
    for datei, nr in ZIELE.items():
        print(f"{datei}: {'set' if setze(HIER / 'demos' / datei, nr) else 'already set'}")
