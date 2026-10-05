"""Instrument-Prüfung der Ziel-Messung kanalzug_ziel.py mit bekannten Signalen (offline, kein JACK): Klickfolgen wie der
Prüfklick (Z1, 96 Samples, Schlag 1 doppelt so laut) mit gewollten Pegeln. Positiv: Rampe −15 → 0 dB ergibt Beat 80
gegen 96 genau −7,5 dB; ein Griff, der den Pegel bei Beat 72 anhält, gibt Spanne 0. Fehlerfall: eine Rampe, die nach dem
Griff weiterläuft, ist bei `hand` rot; ein Leck von −114 dBFS vor dem Öffnen ist bei `stumm` rot; ein verschobener Klick
ist ein Instrumentfehler (Rückgabe 2). Aufruf: python3 -m pytest -q djk/kern/tests/ziel/test_kanalzug_ziel.py"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HIER = Path(__file__).resolve().parent
K = np.exp(-np.arange(96) / 12) * np.cos(2 * np.pi * 2000 * np.arange(96) / 48000)


def klicks(pegel_db, erster_beat, bis_beat, start=100_000, n=2_300_000):
    x = np.zeros((n, 4), dtype=np.float32)
    for b in range(erster_beat, bis_beat):
        s = start + (b - erster_beat) * 22_500
        x[s:s + 96, 0] += (0.5 if b % 4 == 0 else 0.25) * 10 ** (pegel_db(b) / 20) * K
    return x


def messe(tmp_path: Path, x: np.ndarray, art: str):
    x.tofile(tmp_path / "ziel.f32")
    r = subprocess.run([sys.executable, str(HIER / "kanalzug_ziel.py"), str(tmp_path), art], capture_output=True,
                       text=True)
    return r.returncode, json.loads(r.stdout)


def test_rampe(tmp_path):
    rc, a = messe(tmp_path, klicks(lambda b: -15 + 15 * (b - 64) / 32 if b < 96 else 0.0, 64, 100), "rampe")
    assert rc == 0 and a["beat80_gegen_96_db"] == -7.5


def test_hand_und_fehlerfall(tmp_path):
    steht = lambda b: -15 + 15 * (min(b, 72) - 64) / 32  # noqa: E731
    rc, a = messe(tmp_path, klicks(steht, 64, 100), "hand")
    assert rc == 0 and a["spanne_schlag1_db"] == 0.0
    rc2, _ = messe(tmp_path, klicks(lambda b: -15 + 15 * (b - 64) / 32, 64, 100), "hand")  # läuft weiter
    assert rc2 == 1


def test_stumm_und_leck(tmp_path):
    x = klicks(lambda b: 0.0, 48, 60, start=1_200_000)
    rc, a = messe(tmp_path, x, "stumm")
    assert rc == 0 and a["stumm_s"] == 25.0
    x[500_000, 0] = 2e-6
    rc2, a2 = messe(tmp_path, x, "stumm")
    assert rc2 == 1 and a2["stumm_max_dbfs"] == -114.0


def test_instrumentfehler(tmp_path):
    x = klicks(lambda b: 0.0, 64, 100)
    x[100_000 + 5 * 22_500 + 7, 0] = 0.3  # zweiter Einsatz 7 Samples daneben
    x[100_000 + 5 * 22_500:100_000 + 5 * 22_500 + 7, 0] = 0.0
    rc, a = messe(tmp_path, x, "rampe")
    assert rc == 2 and "instrument" in a
