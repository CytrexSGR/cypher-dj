#!/usr/bin/env python3
"""Listening round 2026-11-19 fixes (synth upgrade wave 1). Patches demos/*.json and paneele/*.json in place; refuses a second run.

    python3 patch_sound_fix.py

synth-neuro knob 50 Phase mod: the knob range was 0..0.5 cycles, which at ratio 1 moves the sound by about 1 dB in the low band and
nothing above (measured at C2). The range is now 0..2 cycles: at 60 % the high band is up by about 10 dB and the low band down by
about 2.6 dB (ratio 1), at ratio 2 the low band is down by about 9 dB. Default (knob 0) is untouched: the product is exactly 0.0.

wavetable-reese knob 15 Clean sub: the sine joined in front of the output level (x 0.2), so at 60 % it was a peak of 0.12, about
+1 dB in the 20..100 Hz band, below one octave under C2 (33 Hz) where monitors give up. The knob range is now 0..1.6 (about +3 dB in
the band at 60 %) and knob 16 Sub octave gets a first choice "0" (the note pitch, 65 Hz at C2): choices 0, -1, -2 (default 0).
The gate (`sub_gate_sel`, range 0..1000) and the amount 0 path are untouched: knob 15 at 0 stays byte-equal.
"""
import pathlib

HIER = pathlib.Path(__file__).resolve().parent


def ersetze(pfad, alt, neu):
    t = pfad.read_text()
    assert t.count(alt) == 1, (pfad.name, alt)
    pfad.write_text(t.replace(alt, neu))


neuro = HIER / "demos" / "synth-neuro.json"
ersetze(neuro, '"id": "pm_k", "art": "regler", "nr": 50, "min": 0, "max": 0.5,', '"id": "pm_k", "art": "regler", "nr": 50, "min": 0, "max": 2,')

reese = HIER / "demos" / "wavetable-reese.json"
ersetze(reese, '"id": "k_sub", "art": "regler", "nr": 15, "min": 0, "max": 1.0,', '"id": "k_sub", "art": "regler", "nr": 15, "min": 0, "max": 1.6,')
ersetze(reese, '"id": "sub_okt", "art": "wahl", "n": 2, "blende": 10, "e1": 0.5, "e2": 0.25}',
        '"id": "sub_okt", "art": "wahl", "n": 3, "blende": 10, "e1": 1, "e2": 0.5, "e3": 0.25}')
ersetze(HIER / "paneele" / "wavetable-reese.json", '"options": ["-1", "-2"]', '"options": ["0", "-1", "-2"]')
