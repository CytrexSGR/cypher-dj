"""Blockweise Echtspitze und Spektralspitzen (2026-10-10): gleiche Werte wie in einem Stueck, auch wenn die Spitze
genau auf einer Blockgrenze liegt."""
import numpy as np
from scipy import signal

from werkstatt import fa


def _ganz(x):
    return float(np.max(np.abs(signal.resample_poly(x, 4, 1, axis=0))))


def test_echtspitze_auf_blockgrenze_gleich_ganz():
    rng = np.random.default_rng(7)
    x = rng.normal(0, 0.1, (50_000, 2))
    for k in (4095, 4096, 4097, 8192, 49_999, 0):   # Inter-Sample-Spitze an und neben Blockgrenzen (block=4096)
        y = x.copy()
        y[k, 0], y[min(k + 1, len(y) - 1), 0] = 0.95, -0.95
        assert fa.echtspitze(y, block=4096, rand=256) == _ganz(y)


def test_spitzen_blockweise_gleich_einem_stueck():
    rng = np.random.default_rng(3)
    t = np.arange(48000 * 6) / 48000
    x = 0.3 * np.sin(2 * np.pi * 110.3 * t) + 0.01 * rng.normal(size=len(t))
    f, m = fa.spitzen(x, n=4096, hop=1024)
    fr = np.lib.stride_tricks.sliding_window_view(x, 4096)[::1024] * np.hanning(4096)
    assert len(fr) > 64                               # mehr als ein Block
    La = np.log(np.abs(np.fft.rfft(fr, axis=1)) + 1e-12)
    i0, i1 = int(30 * 4096 / 48000) + 1, int(2000 * 4096 / 48000)
    a, b, c = La[:, i0 - 1:i1 - 1], La[:, i0:i1], La[:, i0 + 1:i1 + 1]
    r, k = np.nonzero((b > a) & (b >= c) & (b > (La.max(axis=1, keepdims=True) - 50 / 8.686)))
    d = 0.5 * (a[r, k] - c[r, k]) / (a[r, k] - 2 * b[r, k] + c[r, k] - 1e-12)
    assert np.array_equal(f, (k + i0 + d) * 48000 / 4096)
    assert np.array_equal(m, np.exp(b[r, k] - 0.25 * (a[r, k] - c[r, k]) * d))
