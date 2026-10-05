"""Frame- und Taktmerkmale: Leistung in drei Baendern, Mitten-Flachheit, Spektralfluss.

Baender (Hz): tief 30-150 (Kick, Bass), mitte 300-3000 (Stimme, Harmonie), hoch 4000-11000 (Hats, Luft).
"""
import numpy as np

SR = 22050
N_FFT = 2048
HOP = 512
BAENDER = {"tief": (30.0, 150.0), "mitte": (300.0, 3000.0), "hoch": (4000.0, 11000.0)}
BAND_NAMEN = ("tief", "mitte", "hoch")


def frame_merkmale(y, sr=SR, n_fft=N_FFT, hop=HOP, block=2048):
    """-> dict mit t (Frame-Mitte, s), p (n_frames x 3 Bandleistung), flach (Mitten-Flachheit 0..1),
    fluss (Spektralfluss < 5 kHz, fuer Beat-Schaetzung)."""
    y = np.asarray(y, dtype=np.float32)
    if len(y) < n_fft:
        y = np.pad(y, (0, n_fft - len(y)))
    y = np.pad(y, (n_fft // 2, n_fft // 2))
    n_frames = 1 + (len(y) - n_fft) // hop
    fenster = np.hanning(n_fft).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    masken = [(freqs >= lo) & (freqs < hi) for lo, hi in (BAENDER[b] for b in BAND_NAMEN)]
    fl_maske = (freqs > 30) & (freqs < 5000)
    p = np.empty((n_frames, 3), dtype=np.float64)
    flach = np.empty(n_frames, dtype=np.float64)
    fluss = np.zeros(n_frames, dtype=np.float64)
    vorher = None
    rahmen = np.lib.stride_tricks.sliding_window_view(y, n_fft)[::hop]
    for a in range(0, n_frames, block):
        f = rahmen[a:a + block] * fenster
        mag = np.abs(np.fft.rfft(f, axis=1)).astype(np.float64)
        pw = mag ** 2
        for j, m in enumerate(masken):
            p[a:a + len(f), j] = pw[:, m].sum(axis=1)
        mp = pw[:, masken[1]] + 1e-12
        flach[a:a + len(f)] = np.exp(np.mean(np.log(mp), axis=1)) / np.mean(mp, axis=1)
        lg = np.log1p(100.0 * mag[:, fl_maske])
        d = np.diff(lg, axis=0, prepend=lg[:1] if vorher is None else vorher[None, :])
        fluss[a:a + len(f)] = np.maximum(d, 0).sum(axis=1)
        vorher = lg[-1]
    t = np.arange(n_frames) * hop / sr
    return {"t": t, "p": p, "flach": flach, "fluss": fluss, "sr": sr, "hop": hop,
            "dauer_s": (len(y) - n_fft) / sr}


def takt_merkmale(fm, takt_starts, takt_s):
    """Mittelwert je Takt [start, start+takt_s): Band-dB (n x 3), Flachheit (n), Anteil gueltiger Frames."""
    t = fm["t"]
    n = len(takt_starts)
    db = np.full((n, 3), np.nan)
    fl = np.full(n, np.nan)
    for i, s in enumerate(takt_starts):
        a, b = np.searchsorted(t, [s, s + takt_s])
        if b - a < 2:
            continue
        db[i] = 10 * np.log10(fm["p"][a:b].mean(axis=0) + 1e-10)
        fl[i] = fm["flach"][a:b].mean()
    return db, fl
