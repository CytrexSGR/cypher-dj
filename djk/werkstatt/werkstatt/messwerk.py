#!/usr/bin/env python3
"""Messwerk fuer Dossier 07 (Werkstatt). Nur numpy/scipy, keine Abhaengigkeit von den Proben selbst.

- lade(pfad, sr)            : Datei ueber ffmpeg als mono float (sr frei waehlbar)
- samples(pfad)             : Sample-Zahl am Ziel (ffprobe duration_ts, JSON, nie CSV)
- f0_peak(x, sr, lo, hi)    : staerkste Spektrallinie im Band, parabolisch interpoliert (Hz)
- verschiebung_cent(a, b)   : Tonhoehenversatz b gegen a in Cent, aus der Kreuzkorrelation der
                              mittleren Log-Frequenz-Spektren (robust fuer Gemische, Aufloesung 1 Cent)
- anschlaege(x, sr)         : Einsatzzeiten (s) aus der Energie-Huellkurve, Schwelle + Totzeit
- raster_rest(t, periode)   : Abstand jedes Einsatzes zum besten starren Raster (ms), Phase frei
"""
import json, subprocess
import numpy as np


def lade(pfad, sr=48000, af=None):
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(pfad), "-ac", "1", "-ar", str(sr)]
    if af:
        cmd += ["-af", af]
    cmd += ["-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32).astype(float)


def samples(pfad):
    q = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=duration_ts,sample_rate", "-of", "json", str(pfad)],
                       capture_output=True, text=True, check=True)
    s = json.loads(q.stdout)["streams"][0]
    return int(s["duration_ts"]), int(s["sample_rate"])


def f0_peak(x, sr, lo, hi, nfft=1 << 22):
    w = x * np.hanning(len(x))
    S = np.abs(np.fft.rfft(w, n=max(nfft, len(x))))
    f = np.fft.rfftfreq(max(nfft, len(x)), 1 / sr)
    sel = np.where((f >= lo) & (f <= hi))[0]
    i = sel[np.argmax(S[sel])]
    a, b, c = np.log(S[i - 1:i + 2] + 1e-20)
    p = 0.5 * (a - c) / (a - 2 * b + c)
    return float(f[i] + p * (f[1] - f[0]))


def _logspek(x, sr, fmin=40.0, fmax=4000.0, cent=1.0, n=16384):
    hop = n // 2
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    S = np.abs(np.fft.rfft(fr, axis=1)).mean(0)
    f = np.fft.rfftfreq(n, 1 / sr)
    achse = fmin * 2 ** (np.arange(0, 1200 * np.log2(fmax / fmin), cent) / 1200)
    L = np.interp(achse, f, np.log1p(S))
    return L - L.mean()


def verschiebung_cent(a, b, sr, max_cent=200):
    """Wie viele Cent liegt b hoeher als a? (positiv = b hoeher)"""
    A, B = _logspek(a, sr), _logspek(b, sr)
    lags = np.arange(-max_cent, max_cent + 1)
    kk = [np.dot(A[max(0, -l):len(A) - max(0, l)], B[max(0, l):len(B) - max(0, -l)]) for l in lags]
    i = int(np.argmax(kk))
    if 0 < i < len(kk) - 1:
        y0, y1, y2 = kk[i - 1], kk[i], kk[i + 1]
        p = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    else:
        p = 0.0
    return float(lags[i] + p)


def anschlaege(x, sr, fenster_ms=5.0, schwelle=0.3, ruhe_ms=40.0):
    """Einsatz = Ueberschreitung von schwelle*p99.9 der RMS-Huellkurve (Fenster 5 ms, laenger als
    jede Periode ueber 200 Hz). Hysterese: neu scharf erst, wenn die Huellkurve ruhe_ms lang unter
    der halben Schwelle lag. (Erste Fassung mit 1-ms-Betragsmittel zaehlte beim 110-Hz-Ton die
    Nulldurchgaenge mit: 160 statt 32 Einsaetze, am Nullpunkt aufgefallen.)"""
    n = max(1, int(sr * fenster_ms / 1000))
    e = np.sqrt(np.convolve(x * x, np.ones(n) / n, "same"))
    thr = schwelle * np.percentile(e, 99.9)
    ruhe = int(sr * ruhe_ms / 1000)
    out, scharf, unter = [], True, 0
    for i in range(0, len(e), 8):
        v = e[i]
        if scharf and v >= thr:
            out.append(i / sr); scharf = False; unter = 0
        elif not scharf:
            unter = unter + 8 if v < thr / 2 else 0
            if unter >= ruhe:
                scharf = True
    return np.array(out)


def f0_je_note(x, sr, einsaetze, lo, hi, dauer_s):
    """f0 in der Mitte jeder Note (mittlere 60 %), je Note eine FFT mit Zero-Padding; Median."""
    fs = []
    for t in einsaetze:
        a = int((t + 0.2 * dauer_s) * sr); b = int((t + 0.8 * dauer_s) * sr)
        if b <= len(x) and b - a > 1024:
            fs.append(f0_peak(x[a:b], sr, lo, hi, nfft=1 << 20))
    return float(np.median(fs)) if fs else float("nan"), len(fs)


def paare(t_ist, t_soll, fang_s=0.05):
    """Je Soll-Einsatz der naechste Ist-Einsatz im Fangbereich; Abstand in ms."""
    d = []
    for s in t_soll:
        if len(t_ist) == 0: break
        j = np.argmin(np.abs(t_ist - s))
        if abs(t_ist[j] - s) <= fang_s:
            d.append((t_ist[j] - s) * 1000)
    return np.array(d)


def raster_rest(t, periode):
    """Rest jedes Einsatzes gegen ein STARRES Raster mit gegebener Periode; Phase per Kreismittel."""
    ph = np.angle(np.exp(2j * np.pi * t / periode).mean()) / (2 * np.pi) * periode
    k = np.round((t - ph) / periode)
    return (t - (ph + k * periode)) * 1000.0
