"""Signal measurements for the sound steps of the journey tours: pure functions on a mono float array, no studio needed.

The J4 family steps play a few notes through a track, export the track offline and measure the file. Everything here works on the
decoded export (48 kHz, mono mix): level, peak, spectral centroid, the share of the energy in a band, how far one note sits above another
in semitones, and how fast a note falls after its end.
"""
import math
import subprocess

SR = 48000


def lade(pfad):
    """A WAV (or any file ffmpeg reads) as a mono float array at 48 kHz."""
    import numpy as np
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(pfad), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True)
    a = np.frombuffer(r.stdout, dtype="<f4").astype(np.float64)
    if len(a) == 0:
        raise RuntimeError(f"{pfad} decodes to no samples")
    return a


def fenster(a, von_s, bis_s):
    """The samples between two times in seconds (clipped to the signal)."""
    return a[max(0, int(von_s * SR)):max(0, int(bis_s * SR))]


def rms_db(x):
    import numpy as np
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)) if len(x) else -240.0


def spitze(x):
    """Largest absolute sample value (1.0 = full scale)."""
    import numpy as np
    return float(np.max(np.abs(x))) if len(x) else 0.0


def schwerpunkt(x, lo=None, hi=None):
    """Spectral centroid in Hz, optionally of the band lo..hi only (a kick's tune is the centroid of its low band; its click does not count)."""
    import numpy as np
    if len(x) == 0:
        return 0.0
    sp = np.abs(np.fft.rfft(x))
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    if lo is not None or hi is not None:
        m = (fr >= (lo or 0.0)) & (fr < (hi or SR))
        sp, fr = sp[m], fr[m]
    return float(np.sum(sp * fr) / max(np.sum(sp), 1e-12))


def anteil(x, lo, hi):
    """Share (0..1) of the signal energy that lies between lo and hi Hz."""
    import numpy as np
    if len(x) == 0:
        return 0.0
    sp = np.abs(np.fft.rfft(x)) ** 2
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    return float(sp[(fr >= lo) & (fr < hi)].sum() / max(sp.sum(), 1e-18))


def _logspektrum(x, lo=50.0, hi=4000.0, cent=10.0):
    """Magnitude spectrum on a log frequency axis (one bin per `cent` cents), square-rooted so that no single partial rules."""
    import numpy as np
    n = 1 << 17
    x = x[:n] * np.hanning(min(len(x), n))
    sp = np.abs(np.fft.rfft(x, n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    f = lo * 2 ** (np.arange(int(math.log2(hi / lo) * 1200 / cent)) * cent / 1200)
    s = np.sqrt(np.interp(f, fr, sp))
    return s - s.mean()


def verschiebung_halbtoene(a, b, max_halbtoene=18, cent=10.0):
    """How far the sound `b` sits above the sound `a`, in semitones: the shift that lines the two log spectra up best. Unlike a fundamental
    estimate it does not jump an octave when a synth has a sub oscillator or a weak fundamental. nan when one of them is silent."""
    import numpy as np
    if len(a) < 2048 or len(b) < 2048 or spitze(a) < 1e-6 or spitze(b) < 1e-6:
        return float("nan")
    sa, sb = _logspektrum(a, cent=cent), _logspektrum(b, cent=cent)
    m = int(max_halbtoene * 100 / cent)
    werte = [float(np.dot(sa[:len(sa) - s], sb[s:]) if s >= 0 else np.dot(sa[-s:], sb[:len(sb) + s])) for s in range(-m, m + 1)]
    return (int(np.argmax(werte)) - m) * cent / 100.0


def rahmen_db(x, rahmen_s=0.02):
    """RMS in dB per frame of `rahmen_s` seconds."""
    import numpy as np
    n = max(1, int(rahmen_s * SR))
    k = len(x) // n
    if k == 0:
        return np.array([rms_db(x)])
    r = x[:k * n].reshape(k, n)
    return 20 * np.log10(np.sqrt(np.mean(r ** 2, axis=1)) + 1e-12)


def abfall_db(x, kopf_s, schluss_s=0.1):
    """How far the level falls inside one note slot: the loudest 20 ms frame of the first `kopf_s` seconds minus the level of the last
    `schluss_s` seconds of the slot. Returns (fall in dB, head level, tail level). Large = the note ends; about 0 = it never stops."""
    kopf = float(rahmen_db(x[:int(kopf_s * SR)]).max())
    schluss = rms_db(x[max(0, len(x) - int(schluss_s * SR)):])
    return kopf - schluss, kopf, schluss
