import json
import numpy as np
import pytest
from klang import ab, wav, lautheit

SR = 48000

def sinus(a, sek=4.0, f=100.0):
    t = np.arange(int(SR * sek)) / SR
    x = (a * np.sin(2 * np.pi * f * t)).astype(np.float32)
    return np.stack([x, x], axis=1)

def test_ab_macht_pegelgleich(tmp_path):
    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    wav.schreibe(tmp_path / "a" / "master.wav", sinus(0.5), SR)
    wav.schreibe(tmp_path / "b" / "master.wav", sinus(0.1), SR)
    ergebnis = ab.vergleiche(tmp_path / "a", tmp_path / "b", tmp_path / "ab")
    ya, _ = wav.lies(tmp_path / "ab" / "a.wav")
    yb, _ = wav.lies(tmp_path / "ab" / "b.wav")
    assert abs(lautheit.integriert(ya, SR) - lautheit.integriert(yb, SR)) < 0.1
    j = json.loads((tmp_path / "ab" / "ab.json").read_text())
    assert j["vorher_lufs"]["a"] - j["vorher_lufs"]["b"] > 13.0     # 0,5 gegen 0,1 = 14 dB
    assert abs(j["ziel_lufs"] - ergebnis["ziel_lufs"]) < 1e-9

def test_ab_stille_ist_fehler(tmp_path):
    (tmp_path / "a").mkdir(); (tmp_path / "b").mkdir()
    wav.schreibe(tmp_path / "a" / "master.wav", sinus(0.5), SR)
    wav.schreibe(tmp_path / "b" / "master.wav", sinus(0.0), SR)
    with pytest.raises(ValueError):
        ab.vergleiche(tmp_path / "a", tmp_path / "b", tmp_path / "ab")
