import numpy as np
from werkstatt.karte import karte_aus_schlaegen
from werkstatt.eins import eins_beat_this, eins_tiefband

SR = 22050


def kicks(betont, gleich=False, bpm=120.0, n=64, t0=0.5):
    per = 60.0 / bpm
    x = np.zeros(int((t0 + (n + 1) * per) * SR))
    tk = np.arange(int(0.2 * SR)) / SR
    kick = np.sin(2 * np.pi * 60 * tk) * np.exp(-tk / 0.05)
    for i in range(n):
        a = int((t0 + i * per) * SR)
        x[a:a + len(kick)] += (2.0 if (i % 4 == betont and not gleich) else 1.0) * kick
    return x, t0 + np.arange(n) * per


def test_downbeats_auf_lage_1():
    t = 0.5 + np.arange(64) * 0.5
    eins, zaehl = eins_beat_this(t[1::4], karte_aus_schlaegen(t))
    assert eins == 1 and zaehl == [0, 16, 0, 0]


def test_downbeats_ausserhalb_der_karte_zaehlen_nicht():
    t = 0.5 + np.arange(64) * 0.5
    eins, zaehl = eins_beat_this(np.array([0.1, 100.0]), karte_aus_schlaegen(t))
    assert eins is None and zaehl == [0, 0, 0, 0]


def test_tiefband_findet_betonte_lage():
    x, t = kicks(2)
    eins, vorsprung, energie = eins_tiefband(x, SR, karte_aus_schlaegen(t))
    assert eins == 2 and vorsprung > 0.5


def test_tiefband_ohne_betonung_ohne_vorsprung():
    x, t = kicks(2, gleich=True)
    eins, vorsprung, energie = eins_tiefband(x, SR, karte_aus_schlaegen(t))
    assert vorsprung < 0.05


def test_tiefband_ueberhoert_den_clap():
    """Clap (Rauschen, doppelt so laut wie der Kick) auf 2 und 4: die Eins bleibt beim betonten Kick."""
    x, t = kicks(0)
    rng = np.random.default_rng(3)
    clap = rng.standard_normal(int(0.08 * SR)) * np.exp(-np.arange(int(0.08 * SR)) / SR / 0.02)
    for i in range(1, 64, 2):
        a = int(t[i] * SR)
        x[a:a + len(clap)] += 2.0 * clap
    eins, vorsprung, energie = eins_tiefband(x, SR, karte_aus_schlaegen(t))
    assert eins == 0
