"""Tonklassen-Profil eines Tracks nach Patent US 7842878 (erloschen 2022-11): Stimmung messen, Spektralspitzen in
36 Bins je Oktave falten (HPCP), ueber Rahmen mitteln. Index 0 = C wie in camelot.py (Essentia legt die
Referenzfrequenz, also A, auf Bin 0; wir rollen um 9 Halbtoene = 27 Bins). Zusaetzlich ein Bass-Profil (60-250 Hz)
und 16 gleich lange Abschnitte (MIK rechnet seit Version 5 abschnittsweise)."""
from __future__ import annotations

import numpy as np

SR = 44100
RAHMEN, SCHRITT = 4096, 4096
BINS = 36
ABSCHNITTE = 16
UNTEN, OBEN = 60.0, 5000.0   # genutzter Bereich; Spitzen werden weiter aussen gesucht (Randspitze auf FFT-Bin 4 = 43 Hz)
_es = None


def _essentia():
    global _es
    if _es is None:
        import essentia
        essentia.log.infoActive = False
        essentia.log.warningActive = False
        import essentia.standard as es
        _es = es
    return _es


def _auf_c(h: np.ndarray) -> np.ndarray:
    """Essentia: Bin 0 = A. C liegt 3 Halbtoene ueber A = Bin 9. Rollen um -9 legt C auf 0."""
    return np.roll(h, -9, axis=-1)


def profil_aus_signal(x: np.ndarray) -> dict:
    """x: Mono float32 bei 44,1 kHz. Rueckgabe voll[36] (60-5000 Hz), bass[36] (60-250 Hz), mitte[36] (250-5000 Hz, ohne
    die Bass-Spitzen, die voll dominieren), seg_voll/seg_bass/seg_mitte[16,36], stimmung_cent in [-50, 50), rahmen."""
    x = np.nan_to_num(np.asarray(x, dtype=np.float32))              # ein NaN liesse SpectralPeaks endlos laufen
    if len(x) < SR * 5:
        raise ValueError(f"zu kurz: {len(x) / SR:.1f} s")
    es = _essentia()
    fen = es.Windowing(type="blackmanharris62", size=RAHMEN)
    spek = es.Spectrum(size=RAHMEN)
    spitzen = es.SpectralPeaks(sampleRate=SR, maxPeaks=100, minFrequency=20, maxFrequency=5500,
                               magnitudeThreshold=1e-5, orderBy="magnitude")
    tuning = es.TuningFrequency(resolution=1.0)
    peaks, energie = [], []
    for fr in es.FrameGenerator(np.asarray(x, dtype=np.float32), frameSize=RAHMEN, hopSize=SCHRITT, startFromZero=True):
        s = spek(fen(fr))
        f, m = spitzen(s)
        ok = (f >= UNTEN) & (f <= OBEN)
        f, m = f[ok], m[ok]
        peaks.append((f, m))
        energie.append(float(np.sum(s ** 2)))
        if len(f):
            tuning(f, m)
    hz, cent = tuning(np.array([], dtype=np.float32), np.array([], dtype=np.float32))
    cent = ((float(cent) + 50.0) % 100.0) - 50.0                     # Essentia meldet nur -35..+65 ct: auf [-50, 50) beziehen
    ref = 440.0 * 2 ** (cent / 1200)
    hpcp_voll = es.HPCP(size=BINS, referenceFrequency=ref, minFrequency=UNTEN, maxFrequency=OBEN, bandPreset=False,
                        weightType="cosine", nonLinear=False, normalized="unitMax", sampleRate=SR)
    # Essentia verlangt >= 200 Hz Breite; Spitzen unter UNTEN sind schon maskiert, 50 Hz wirkt also wie 60 Hz
    hpcp_bass = es.HPCP(size=BINS, referenceFrequency=ref, minFrequency=50, maxFrequency=250, bandPreset=False,
                        weightType="cosine", nonLinear=False, normalized="unitMax", sampleRate=SR)
    hpcp_mitte = es.HPCP(size=BINS, referenceFrequency=ref, minFrequency=250, maxFrequency=OBEN, bandPreset=False,
                         weightType="cosine", nonLinear=False, normalized="unitMax", sampleRate=SR)
    hv = np.zeros((len(peaks), BINS), np.float32)
    hm = np.zeros((len(peaks), BINS), np.float32)
    hb = np.zeros((len(peaks), BINS), np.float32)
    for i, (f, m) in enumerate(peaks):
        if len(f):
            hv[i] = hpcp_voll(f, m)
            hb[i] = hpcp_bass(f, m)
            hm[i] = hpcp_mitte(f, m)
    laut = np.asarray(energie) > np.percentile(energie, 20)          # Stille und leere Intros nicht mitteln
    def mittel(h):
        v = h[laut].mean(0) if laut.any() else h.mean(0)
        return v / (v.max() + 1e-12)
    grenzen = np.linspace(0, len(peaks), ABSCHNITTE + 1).astype(int)
    seg = lambda h: np.stack([h[a:b].mean(0) if b > a else np.zeros(BINS, np.float32)
                              for a, b in zip(grenzen[:-1], grenzen[1:])])
    return {"voll": _auf_c(mittel(hv)), "bass": _auf_c(mittel(hb)), "mitte": _auf_c(mittel(hm)),
            "seg_voll": _auf_c(seg(hv)),
            "seg_bass": _auf_c(seg(hb)), "seg_mitte": _auf_c(seg(hm)), "stimmung_cent": float(cent), "rahmen": len(peaks)}


def profil(pfad: str) -> dict:
    from .tonart import dekodiere
    return profil_aus_signal(dekodiere(pfad))
