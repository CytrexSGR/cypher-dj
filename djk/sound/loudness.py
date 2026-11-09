"""Messungen nach ITU-R BS.1770-4 und Hilfsmaße. x: (n, kanaele) float32, Werte ±1 = 0 dBFS."""
import numpy as np
from scipy import signal

BAENDER = {"sub": (20, 80), "tief": (80, 250), "tiefmitte": (250, 800), "mitte": (800, 2000),
           "praesenz": (2000, 6000), "hoch": (6000, 20000)}

def _k_filter(sr: int):
    # BS.1770-4 Anhang 1, für beliebige Rate aus den analogen Prototypen (Formeln wie pyloudnorm/libebur128)
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / sr); vh = 10 ** (g / 20); vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / sr)
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, 2 * (k * k - 1) / (1 + k / q + k * k), (1 - k / q + k * k) / (1 + k / q + k * k)]
    return (b1, a1), (b2, a2)

def integriert(x: np.ndarray, sr: int) -> float:
    (b1, a1), (b2, a2) = _k_filter(sr)
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x.astype(np.float64), axis=0), axis=0)
    blk, hop = int(0.4 * sr), int(0.1 * sr)
    if len(y) < blk:
        return float("-inf")
    starts = range(0, len(y) - blk + 1, hop)
    z = np.array([np.mean(y[s:s + blk] ** 2, axis=0).sum() for s in starts])   # Kanalgewichte L/R = 1
    l = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    z1 = z[l > -70.0]
    if z1.size == 0:
        return float("-inf")
    rel = -0.691 + 10 * np.log10(z1.mean()) - 10.0
    z2 = z[(l > -70.0) & (l > rel)]
    return float(-0.691 + 10 * np.log10(z2.mean()))

def sample_spitze_db(x: np.ndarray) -> float:
    return float(20 * np.log10(max(np.abs(x).max(), 1e-12)))

def true_peak_db(x: np.ndarray, sr: int, block_s: float = 10.0, rand: int = 2000) -> float:
    """4× Überabtastung, blockweise (Speicher); Blöcke überlappen um `rand` Samples (> Filterlänge von resample_poly)."""
    blk = max(int(block_s * sr), 1)
    spitze = float(np.abs(x).max()) if len(x) else 0.0
    for start in range(0, len(x), blk):
        a, b = max(0, start - rand), min(len(x), start + blk + rand)
        y = signal.resample_poly(x[a:b].astype(np.float64), 4, 1, axis=0)
        von = (start - a) * 4
        spitze = max(spitze, float(np.abs(y[von:von + min(blk, len(x) - start) * 4]).max()))
    return float(20 * np.log10(max(spitze, 1e-12)))

def clips(x: np.ndarray, schwelle: float = 0.999) -> int:
    return int(np.count_nonzero(np.abs(x) >= schwelle))

def korrelation(x: np.ndarray) -> float:
    if x.shape[1] < 2:
        return 1.0
    l, r = x[:, 0].astype(np.float64), x[:, 1].astype(np.float64)
    el, er = np.sum(l * l), np.sum(r * r)
    if min(el, er) < 1e-10 * max(el, er):   # ein Kanal (fast) tot, < -100 dB: undefiniert, nicht mono-sicher
        return 0.0
    n = np.sqrt(el * er)
    return float(np.sum(l * r) / n) if n > 0 else 1.0

def baender_db(x: np.ndarray, sr: int) -> dict:
    m = x.astype(np.float64).mean(axis=1)
    f, p = signal.welch(m, sr, nperseg=8192)
    return {n: float(10 * np.log10(max(p[(f >= a) & (f < b)].sum(), 1e-20))) for n, (a, b) in BAENDER.items()}
