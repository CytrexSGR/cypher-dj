"""Synthetische Tracks mit bekannter Struktur (125 BPM, 1 Takt = 1,92 s)."""
import numpy as np

SR = 22050
BPM = 125.0
BEAT = 60.0 / BPM
TAKT = 4 * BEAT


def spur(abschnitte, sr=SR, saat=0):
    """abschnitte: Liste (takte, {"kick","hat","ton"}). -> Signal float32."""
    rng = np.random.default_rng(saat)
    n_takte = sum(t for t, _ in abschnitte)
    y = np.zeros(int(n_takte * TAKT * sr) + sr, dtype=np.float64)
    kick_t = np.arange(int(0.25 * sr)) / sr
    kick = np.sin(2 * np.pi * 55 * kick_t) * np.exp(-kick_t * 18)
    hat = rng.standard_normal(int(0.05 * sr)) * np.exp(-np.arange(int(0.05 * sr)) / sr * 80)
    hat = np.diff(hat, prepend=0) * 0.5
    takt0 = 0
    for takte, teile in abschnitte:
        for b in range(takte * 4):
            s = int(((takt0 * 4) + b) * BEAT * sr)
            if "kick" in teile:
                y[s:s + len(kick)] += 0.8 * kick
            if "hat" in teile:
                h = s + int(BEAT / 2 * sr)
                y[h:h + len(hat)] += 0.3 * hat
        if "ton" in teile:
            a = int(takt0 * TAKT * sr)
            e = int((takt0 + takte) * TAKT * sr)
            tt = np.arange(e - a) / sr
            y[a:e] += 0.2 * (np.sin(2 * np.pi * 440 * tt) + 0.5 * np.sin(2 * np.pi * 880 * tt)
                             + 0.3 * np.sin(2 * np.pi * 1320 * tt))
        takt0 += takte
    return y.astype(np.float32)
