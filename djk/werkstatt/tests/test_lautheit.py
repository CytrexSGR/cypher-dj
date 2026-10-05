import numpy as np

from werkstatt.lautheit import lautheit, lufs_je_takt

SR = 48000


def sinus(db, s=10.0, f=1000.0):
    t = np.arange(int(s * SR)) / SR
    x = 10 ** (db / 20) * np.sin(2 * np.pi * f * t)
    return np.stack([x, x], 1)


def test_lautheit_gibt_python_zahlen():
    d = lautheit(sinus(-20.0))
    assert set(d) == {"lufs_integriert", "echtspitze_dbtp", "crest_db"}
    assert all(type(v) is float for v in d.values())
    assert abs(d["echtspitze_dbtp"] + 20.0) < 0.1          # Sinus-Spitze -20 dBFS
    assert abs(d["crest_db"] - 3.01) < 0.05                 # Spitze gegen RMS eines Sinus


def test_minus_12_db_luft_senkt_lufs_um_12():
    a, b = lautheit(sinus(-10.0)), lautheit(sinus(-22.0))
    assert abs((a["lufs_integriert"] - b["lufs_integriert"]) - 12.0) < 0.01


def test_lufs_je_takt_zaehlt_ab_der_eins_und_meldet_stille_als_none():
    x = np.concatenate([np.zeros((SR, 2)), sinus(-20.0, s=4.0)])
    w = lufs_je_takt(x, ab_frame=SR // 2, frames_je_takt=SR)
    assert len(w) == 4                                      # (5 s - 0,5 s) / 1 s, nur volle Takte
    assert w[0] is not None and w[-1] is not None and abs(w[-1] - w[-2]) < 0.01
    assert lufs_je_takt(np.zeros((3 * SR, 2)), 0, SR) == [None, None, None]
