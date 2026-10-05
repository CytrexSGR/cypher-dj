"""Plan MVP 2 Task 6: pruef_loop.py und loop_bauen.py schreiben Loops, die der Kern lädt (ADR 025, §4.9)."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import loop_bauen  # noqa: E402
import pruef_loop  # noqa: E402

SPB = 22500


def test_pruef_loop_bursts_auf_den_beats(tmp_path):
    d = pruef_loop.schreibe(tmp_path, "pruef-burst", 1, [0.5, 1.5, 2.5, 3.5])
    j = json.loads((d / "loop.json").read_text())
    assert (j["schema"], j["beats"], j["bpm"], j["frames"], j["datei"]) == (1, 4, 128, 90000, "loop.f32")
    x = np.fromfile(d / "loop.f32", dtype="<f4").reshape(-1, 2)
    assert x.shape == (90000, 2) and np.array_equal(x[:, 0], x[:, 1])
    an = np.flatnonzero(np.abs(x[:, 0]) > 0)
    starts = [int(a) for i, a in enumerate(an) if i == 0 or an[i - 1] != a - 1]
    assert starts == [11251, 33751, 56251, 78751]  # Burst-Form beginnt mit sin(0) = 0: erstes Nicht-Null-Sample +1
    assert abs(np.abs(x).max() - 0.15) < 1e-6


def test_pruef_loop_beat_ausserhalb(tmp_path):
    with pytest.raises(ValueError, match="liegt nicht im Loop"):
        pruef_loop.schreibe(tmp_path, "x", 1, [4.0])


def wav(p: Path, sek: float):
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", f"sine=f=220:r=48000:d={sek}",
                    "-ac", "2", str(p)], check=True)


def test_loop_bauen_genau_n_takte(tmp_path):
    wav(tmp_path / "zwei.wav", 3.75 + 0.004)  # 2 Takte bei 128 BPM plus 4 ms (innerhalb ±10 ms)
    d = loop_bauen.baue(tmp_path / "zwei.wav", 2, "mein-loop", tmp_path / "loops")
    j = json.loads((d / "loop.json").read_text())
    assert j["frames"] == 180000 and j["beats"] == 8 and j["name"] == "mein-loop"
    assert (d / "loop.f32").stat().st_size == 180000 * 8
    assert not any(p.name.startswith(".") for p in (tmp_path / "loops").iterdir())


def test_loop_bauen_fehler(tmp_path):
    wav(tmp_path / "kurz.wav", 1.5)
    with pytest.raises(ValueError, match="erwartet 90000"):
        loop_bauen.baue(tmp_path / "kurz.wav", 1, "kurz", tmp_path / "loops")
    with pytest.raises(ValueError, match="Takte"):
        loop_bauen.baue(tmp_path / "kurz.wav", 3, "kurz", tmp_path / "loops")
    with pytest.raises(ValueError, match="Name"):
        loop_bauen.baue(tmp_path / "kurz.wav", 1, "Gross", tmp_path / "loops")
    wav(tmp_path / "eins.wav", 1.875)
    loop_bauen.baue(tmp_path / "eins.wav", 1, "doppelt", tmp_path / "loops")
    with pytest.raises(ValueError, match="gibt es schon"):
        loop_bauen.baue(tmp_path / "eins.wav", 1, "doppelt", tmp_path / "loops")
