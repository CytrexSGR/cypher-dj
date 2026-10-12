import numpy as np
import torch

from tonart_energie import referenz
from tonart_energie.camelot import aus_camelot

# Krumhansl-Profile (C=0) als Spielzeug-Wahrheit
DUR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MOLL = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _spielzeug(n, rng):
    X, y = [], []
    for _ in range(n):
        g, moll = int(rng.integers(12)), bool(rng.integers(2))
        p12 = np.roll(MOLL if moll else DUR, g) + rng.normal(0, 0.8, 12)
        p36 = np.repeat(p12, 3) / 3
        X.append(np.stack([p36, p36]))                     # Kanaele voll, bass
        y.append(referenz.klasse(g, moll))
    return np.array(X, np.float32), np.array(y)


def test_klasse_und_camelot_hin_und_zurueck():
    for code in ("8A", "8B", "1A", "12B"):
        g, m = aus_camelot(code)
        assert referenz.camelot_aus_klasse(referenz.klasse(g, m)) == code


def test_transposition_gleich():
    torch.manual_seed(0)
    m = referenz.Modell(kanaele=2)
    x = torch.randn(4, 2, 36)
    a = m(x)
    b = m(torch.roll(x, 3 * 5, dims=-1))                   # alles 5 Halbtoene hoeher
    assert torch.allclose(torch.roll(a.view(4, 2, 12), 5, dims=-1).view(4, 24), b, atol=1e-5)


def test_speichern_laden(tmp_path):
    m = referenz.Modell(kanaele=2, versteckt=8)
    referenz.speichere(m, str(tmp_path / "m.pt"), {"abschnitte": True})
    m2, meta = referenz.lade(str(tmp_path / "m.pt"))
    x = torch.randn(3, 2, 36)
    assert meta == {"abschnitte": True} and torch.allclose(m(x), m2(x))


def test_lernt_spielzeug():
    rng = np.random.default_rng(1)
    X, y = _spielzeug(600, rng)
    m = referenz.trainiere(X[:400], y[:400], epochen=300)
    p, konf = referenz.vorhersage(m, X[400:])
    assert (p == y[400:]).mean() > 0.9 and konf.shape == (200,)


def test_float64_eingabe():
    rng = np.random.default_rng(2)
    X, y = _spielzeug(60, rng)
    m = referenz.trainiere(X.astype(np.float64), y, epochen=5)
    p, konf = referenz.vorhersage(m, X.astype(np.float64))
    assert p.shape == (60,) and konf.shape == (60,)


def test_merkmale_kanaele():
    p = {"voll": np.full(36, 1.0), "bass": np.full(36, 2.0), "mitte": np.full(36, 3.0)}
    assert referenz.merkmale(p).shape == (2, 36)
    assert referenz.merkmale(p)[1, 0] == 2.0
    m = referenz.merkmale(p, ("mitte", "bass"))
    assert m.shape == (2, 36) and m[0, 0] == 3.0 and m[1, 0] == 2.0
    assert referenz.merkmale(p, ("voll", "bass", "mitte")).shape == (3, 36)
