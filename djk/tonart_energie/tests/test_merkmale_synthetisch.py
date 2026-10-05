"""Positiv-/Negativkontrolle der Tonart- und Energiekette an synthetischem Signal (kein Ton hörbar, nur Rechnung)."""
import numpy as np
import pytest

es = pytest.importorskip("essentia.standard")
from tonart_energie import merkmale as m  # noqa: E402

SR = m.SR


def _akkorde(grundtoene_midi, dauer=4.0, pegel=0.2):
    t = np.arange(int(SR * dauer)) / SR
    x = np.zeros_like(t)
    for midi in grundtoene_midi:
        f0 = 440 * 2 ** ((midi - 69) / 12)
        for h in range(1, 5):
            x += pegel / h * np.sin(2 * np.pi * f0 * h * t)
    return x


def _kadenz_a_moll():
    # Am - Dm - E - Am, je 4 s, Bass + Dreiklang
    folge = [[45, 57, 60, 64], [50, 57, 62, 65], [52, 56, 59, 64], [45, 57, 60, 64]]
    return np.concatenate([_akkorde(a) for a in folge] * 3).astype(np.float32) / 4


@pytest.mark.skipif(not m.KF_CLI.exists(), reason="keyfinder-stdin nicht gebaut")
def test_a_moll_wird_8A_bei_keyfinder():
    key, chroma = m.keyfinder(_kadenz_a_moll())
    assert key == "8A" and chroma.shape == (72,)


def test_a_moll_wird_8A_bei_essentia():
    z, v = m.tonart(_kadenz_a_moll(), es) if m.KF_CLI.exists() else pytest.skip("kf fehlt")
    assert z["ess_edma_key"] == "8A" and z["essx_edma_key"] == "8A"
    assert v["hpcp36"].shape == (36,)


def test_transponiert_c_moll_wird_5A():
    folge = [[48, 60, 63, 67], [53, 60, 65, 68], [55, 59, 62, 67], [48, 60, 63, 67]]
    x = np.concatenate([_akkorde(a) for a in folge] * 3).astype(np.float32) / 4
    z, _ = m.tonart(x, es)
    assert z["ess_edma_key"] == "5A" and z["kf_key"] == "5A"


def test_energie_lauter_ist_lauter():
    x = _kadenz_a_moll()
    leise, _ = m.energie(x * 0.1, es, 128.0)
    laut, _ = m.energie(x, es, 128.0)
    assert laut["lufs_int"] - leise["lufs_int"] == pytest.approx(20.0, abs=0.5)
    assert laut["crest_db"] == pytest.approx(leise["crest_db"], abs=0.1)   # Crest pegelunabhängig
