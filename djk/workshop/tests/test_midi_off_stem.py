"""werkstatt.midi_aus_stem on synthetic stems: a known kick/clap/hat pattern and a known bass line (rendered as a
cyclic 16-beat loop at 48 kHz) must come back as the same notes on the 1/16 grid, pitch exact. Silence gives []."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from werkstatt import midi_off_stem as midi_aus_stem
from click_helper import braucht_essentia

HIER = Path(__file__).resolve().parent.parent
SR = 48000
BEATS = 16


def _add(x, sig, start):
    """Add sig at sample start, wrapping around the loop end (cyclic loop)."""
    idx = (start + np.arange(len(sig))) % len(x)
    np.add.at(x, idx, sig)


def kick(n=int(0.25 * SR)):
    t = np.arange(n) / SR
    f = 50 + 100 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return 0.9 * np.sin(ph) * np.exp(-t / 0.08) * np.minimum(1.0, t / 0.003)   # 3 ms fade-in, as a real kick has no click at 250+ Hz


def clap(n=int(0.12 * SR)):
    from scipy import signal
    rng = np.random.default_rng(1)
    b = signal.butter(4, [800, 1800], "bandpass", fs=SR, output="sos")
    y = signal.sosfilt(b, rng.standard_normal(n))
    return 0.8 * y / np.abs(y).max() * np.exp(-np.arange(n) / SR / 0.04)


def hat(n=int(0.04 * SR)):
    from scipy import signal
    rng = np.random.default_rng(2)
    b = signal.butter(4, 7000, "highpass", fs=SR, output="sos")
    y = signal.sosfilt(b, rng.standard_normal(n))
    return 0.5 * y / np.abs(y).max() * np.exp(-np.arange(n) / SR / 0.01)


def render_drums(bpm):
    n = int(round(BEATS * 60.0 / bpm * SR))
    x = np.zeros(n)
    s16 = 60.0 / bpm / 4 * SR
    esperado = set()
    for bar in range(BEATS // 4):
        for pos in range(16):
            beat = bar * 4 + pos / 4
            s = int(round((bar * 16 + pos) * s16))
            if pos % 4 == 0:
                _add(x, kick(), s); esperado.add((beat, 36))
            if pos in (4, 12):
                _add(x, clap(), s); esperado.add((beat, 39))
            if pos % 2 == 0:
                _add(x, hat(), s); esperado.add((beat, 42))
    return x, esperado


def saw_note(freq, dauer_s, n_ausklang=0.03):
    n = int(dauer_s * SR)
    t = np.arange(n) / SR
    y = 2 * ((t * freq) % 1.0) - 1
    h = np.minimum(1.0, t / 0.005) * np.minimum(1.0, (dauer_s - t) / n_ausklang)
    return 0.6 * y * h


# (beat, length in beats, MIDI pitch): A1, C2, E2, G2 on different 1/16 positions and lengths
BASS = [(0.0, 1.0, 33), (1.5, 0.5, 36), (3.25, 0.75, 40), (4.0, 2.0, 43), (6.75, 0.25, 33),
        (8.0, 1.5, 36), (10.5, 1.0, 40), (12.0, 0.5, 43), (13.25, 0.75, 36), (15.0, 1.0, 33)]


def render_bass(bpm):
    n = int(round(BEATS * 60.0 / bpm * SR))
    x = np.zeros(n)
    sb = 60.0 / bpm * SR
    for beat, lg, ton in BASS:
        f = 440.0 * 2 ** ((ton - 69) / 12)
        s = int(round(beat * sb))
        # a short gap before the next note is part of the playing: note sounds 90 % of its length
        _add(x, saw_note(f, lg * 60.0 / bpm * 0.9), s)
    return x


def schreibe(tmp_path, x, name):
    p = tmp_path / name
    sf.write(p, np.stack([x, x], axis=1), SR, subtype="FLOAT")
    return str(p)


@pytest.mark.parametrize("bpm", [120, 128])
def test_drums_pattern(tmp_path, bpm):
    x, soll = render_drums(bpm)
    noten = midi_aus_stem.drums(schreibe(tmp_path, x, "d.wav"), BEATS)
    for n in noten:
        assert set(n) == {"beat", "laenge", "ton", "vel"}
        assert n["beat"] % 0.25 == 0 and 0 <= n["beat"] < BEATS
        assert n["laenge"] >= 0.25 and isinstance(n["ton"], int) and 1 <= n["vel"] <= 127
    ist = {(n["beat"], n["ton"]) for n in noten}
    assert ist == soll, f"missing {sorted(soll - ist)[:8]}, extra {sorted(ist - soll)[:8]}"
    assert len(noten) == len(ist)


@braucht_essentia
@pytest.mark.parametrize("bpm", [120, 128])
def test_bass_line(tmp_path, bpm):
    x = render_bass(bpm)
    noten = midi_aus_stem.bass(schreibe(tmp_path, x, "b.wav"), BEATS)
    assert [(n["beat"], n["ton"]) for n in noten] == [(b, t) for b, _, t in BASS]
    for n, (_, lg, _) in zip(noten, BASS):
        assert abs(n["laenge"] - lg) <= 0.25 and n["laenge"] >= 0.25
        assert 1 <= n["vel"] <= 127


def test_silence_gives_empty_list(tmp_path):
    p = schreibe(tmp_path, np.zeros(int(BEATS * 0.5 * SR)), "s.wav")
    assert midi_aus_stem.drums(p, BEATS) == []
    assert midi_aus_stem.bass(p, BEATS) == []


def test_command_line_json(tmp_path):
    x, soll = render_drums(128)
    p = schreibe(tmp_path, x, "d.wav")
    r = subprocess.run([sys.executable, "-m", "werkstatt.midi_off_stem", "drums", p, str(BEATS)],
                       cwd=HIER, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert {(n["beat"], n["ton"]) for n in json.loads(r.stdout)["noten"]} == soll


def test_command_line_error(tmp_path):
    r = subprocess.run([sys.executable, "-m", "werkstatt.midi_off_stem", "bass", str(tmp_path / "gibts-nicht.wav"), "16"],
                       cwd=HIER, capture_output=True, text=True)
    assert r.returncode != 0
    assert "fehler" in json.loads(r.stdout)
