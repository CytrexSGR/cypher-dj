"""Regression against real stems with Suno MIDI as reference. The material is NOT in the repo (rights): it lives outside under
~/messungen/2026-11-12-live-module/suno-ref (loops cut out by the measurement scripts there: schleifen.json = loop windows + reference notes,
segmente.pkl = the cut-out mono audio). Without that directory the test is skipped.

Thresholds sit clearly below the values measured on 2026-11-12 (kick F1 0.95/0.97, bass onset F1 0.69/0.74 on these songs) so that only a real
regression fails, not the noise of the reference."""
import json
import pickle
from pathlib import Path

import numpy as np
import pytest

from werkstatt import midi_off_stem as mas

REF = Path.home() / "messungen" / "2026-11-12-live-module" / "suno-ref"
pytestmark = pytest.mark.skipif(not (REF / "schleifen.json").exists() or not (REF / "segmente.pkl").exists(), reason="reference stems not present")

KLASSE = {36: "tief", 39: "mitte", 42: "hoch"}


def _pos(beat, n):
    return int(round(beat / 0.25)) % n


def _f1(tp, fp, fn):
    return 2 * tp / (2 * tp + fp + fn) if tp else 0.0


def _schleifen(songs, stem):
    sch = json.loads((REF / "schleifen.json").read_text())
    seg = pickle.loads((REF / "segmente.pkl").read_bytes())
    for song in songs:
        for i, s in enumerate(sch[song]["schleifen"]):
            if s["stem"] == stem:
                yield s, seg[(song, i)].astype(np.float64)


def test_kick_f1_gegen_suno_referenz():
    tp = fp = fn = 0
    for s, x in _schleifen(["Hands_Up_to_the_Light", "Doors_Open"], "Drums"):
        n = s["beats"] * 4
        ours = {_pos(a["beat"], n) for a in mas.drums_x(x, s["beats"]) if a["ton"] == 36}
        ref = {_pos(b[0], n) for b in s["ref"] if b[2] == "tief"}
        tp += len(ours & ref); fp += len(ours - ref); fn += len(ref - ours)
    assert _f1(tp, fp, fn) >= 0.85


def test_bass_onset_f1_gegen_suno_referenz():
    tp = fp = fn = 0
    for s, x in _schleifen(["Hands_Up_to_the_Light", "Doors_Open"], "Bass"):
        n = s["beats"] * 4
        ours = {_pos(a["beat"], n) for a in mas.bass_x(x, s["beats"])}
        ref = {_pos(b[0], n) for b in s["ref"]}
        tp += len(ours & ref); fp += len(ours - ref); fn += len(ref - ours)
    assert _f1(tp, fp, fn) >= 0.55
