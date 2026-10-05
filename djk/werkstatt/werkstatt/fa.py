#!/usr/bin/env python3
"""Fingerabdruck und Passung (Dossier 08). Cypher, 2026-09-22/23.

Alles in BEAT-ZEIT statt Sekunden: jede zeitliche Größe (Band-Energie, Anschläge,
Modulation) wird auf das Sechzehntel-Raster des Stücks gelegt. Dadurch sind zwei Stücke
mit verschiedenem Quelltempo direkt vergleichbar, ohne sie vorher zu strecken.

Bänder verschachteln sich in die Bänder des Pegelmessers (meter_page.js: Sub 30-90,
Tiefen 90-250, Mitte 250-2000, Höhen >2000) und in die Mixer-EQ-Gruppen
(Tief <250, Mitte 250-2000, Hoch >2000).
"""
import json, os, re, subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
REPO = str(Path(__file__).resolve().parents[3])   # Repo-Wurzel; Pfade im Fingerabdruck sind relativ dazu
BAENDER = [("sub", 30, 90), ("tief", 90, 250), ("tiefmitte", 250, 800),
           ("mitte", 800, 2000), ("praesenz", 2000, 6000), ("hoch", 6000, 16000)]
BNAMEN = [b[0] for b in BAENDER]
EQ_GRUPPE = {"sub": "T", "tief": "T", "tiefmitte": "M", "mitte": "M", "praesenz": "H", "hoch": "H"}
ONSET_BAENDER = [("tief", 30, 250), ("mitte", 250, 2000), ("hoch", 2000, 16000)]
SET_BPM = 128.0
KOLL_MS = 30.0

# ---------------------------------------------------------------- Laden
def lade(pfad):
    x, sr = sf.read(pfad, always_2d=True, dtype="float64")
    if sr != SR:
        x = signal.resample_poly(x, SR, sr, axis=0)
    return x  # (n, kanaele)

# ---------------------------------------------------------------- Filter
_SOS = {}
def sos_band(lo, hi, ordnung=4):
    k = ("b", lo, hi, ordnung)
    if k not in _SOS:
        if lo is None:
            _SOS[k] = signal.butter(ordnung, hi, "lowpass", fs=SR, output="sos")
        elif hi is None:
            _SOS[k] = signal.butter(ordnung, lo, "highpass", fs=SR, output="sos")
        else:
            _SOS[k] = signal.butter(ordnung, [lo, hi], "bandpass", fs=SR, output="sos")
    return _SOS[k]

# ITU-R BS.1770-4, Koeffizienten fuer 48 kHz aus der Norm (Stufe 1 Shelf, Stufe 2 RLB-Hochpass)
K_SOS = np.array([
    [1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
    [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])

def k_filter(x):
    return signal.sosfilt(K_SOS, x, axis=0)

# ---------------------------------------------------------------- Lautheit
def lufs_integriert(x):
    """BS.1770-4: 400-ms-Bloecke, 75 % Ueberlappung, absolutes Gate -70, relatives -10 LU."""
    z = k_filter(x)
    n = len(z); blk = int(0.4 * SR); hop = int(0.1 * SR)
    if n < blk:
        return None, None
    starts = np.arange(0, n - blk + 1, hop)
    ms = np.array([np.mean(z[s:s + blk] ** 2, axis=0).sum() for s in starts])  # Summe ueber Kanaele, G=1
    lk = -0.691 + 10 * np.log10(ms + 1e-30)
    g1 = ms[lk > -70]
    if len(g1) == 0:
        return -np.inf, lk
    l1 = -0.691 + 10 * np.log10(g1.mean())
    g2 = ms[(lk > -70) & (lk > l1 - 10)]
    return float(-0.691 + 10 * np.log10(g2.mean())), lk

def lautheit(x, bpm=None):
    li, mom = lufs_integriert(x)
    spitze = float(np.max(np.abs(x)))
    ov = signal.resample_poly(x, 4, 1, axis=0)
    tp = float(np.max(np.abs(ov)))
    rms = float(np.sqrt(np.mean(x ** 2)))
    d = {
        "lufs": None if li is None else round(li, 2),
        "spitze_dbfs": round(20 * np.log10(spitze + 1e-12), 2),
        "true_peak_dbtp": round(20 * np.log10(tp + 1e-12), 2),
        "rms_dbfs": round(20 * np.log10(rms + 1e-12), 2),
        "crest_db": round(20 * np.log10((spitze + 1e-12) / (rms + 1e-12)), 2),
    }
    d["plr_db"] = None if li is None else round(d["true_peak_dbtp"] - li, 2)
    if mom is not None and len(mom) > 3:
        m = mom[mom > -70]
        d["dyn_momentan_lu"] = round(float(np.percentile(m, 95) - np.percentile(m, 10)), 2) if len(m) > 3 else None
    else:
        d["dyn_momentan_lu"] = None
    if bpm:
        z = k_filter(x); takt = int(round(4 * 60 / bpm * SR))
        lt = []
        for s in range(0, len(z) - takt + 1, takt):
            lt.append(round(float(-0.691 + 10 * np.log10(np.mean(z[s:s + takt] ** 2, axis=0).sum() + 1e-30)), 2))
        d["lufs_je_takt"] = lt
    return d

# ---------------------------------------------------------------- Raster
def bpm_aus_datei(pfad, n_samples):
    """Taktzahl steht im Namen (_4, _8, _16, _20). Loops sind auf der Eins geschnitten."""
    m = re.search(r"_(\d+)b?\.wav$", os.path.basename(pfad))
    if not m or os.path.basename(pfad).startswith(("mfbsh_", "probe_")):
        return None, None
    takte = int(m.group(1))
    return takte * 4 * 60 * SR / n_samples, takte

def schritt_grenzen(n, bpm):
    """Sample-Grenzen der Sechzehntel ab Sample 0."""
    s16 = 60.0 / bpm / 4 * SR
    anz = int(np.floor(n / s16 + 1e-6))
    return np.round(np.arange(anz + 1) * s16).astype(int)

def band_energien(x, bpm, kgewichtet=False, filtfilt=True):
    """Leistung je Band und Sechzehntel: Matrix (6, schritte), Summe ueber Kanaele."""
    y = k_filter(x) if kgewichtet else x
    gr = schritt_grenzen(len(y), bpm)
    E = np.zeros((len(BAENDER), len(gr) - 1))
    for i, (_, lo, hi) in enumerate(BAENDER):
        f = signal.sosfiltfilt(sos_band(lo, hi), y, axis=0) if filtfilt else signal.sosfilt(sos_band(lo, hi), y, axis=0)
        p = (f ** 2).sum(axis=1)
        c = np.concatenate([[0.0], np.cumsum(p)])
        E[i] = (c[gr[1:]] - c[gr[:-1]]) / np.diff(gr)
    return E

# ---------------------------------------------------------------- Anschlaege
def onsets_band(x_mono, lo, hi, min_abstand_s=0.05, delta=1.5, zyklisch=True, glatt_ms=2, mit_staerke=False):
    """Anschlaege in einem Band.
    Huellkurve: Betrag des analytischen Signals (Hilbert) nach nullphasigem Bandpass, 2 ms geglaettet.
    (Erste Fassung mit 5-ms-RMS rippelte bei 50-Hz-Kicks mit 100 Hz: 64 Falschtreffer, 18,6 ms Fehler.)
    Detektion: Anstieg der log-Huellkurve ueber 5 ms, adaptive Schwelle (Mittel + 1,5 sd ueber 1 s).
    Zeitpunkt: 50-%-Punkt des linearen Anstiegs zwischen Tal davor und Gipfel danach. Bei
    nullphasiger (symmetrischer) Verschmierung liegt dieser Punkt auf dem wahren Einsatz.
    Loops sind zyklisch: 200 ms vom Ende werden vorgesetzt, damit die Eins auf Sample 0 erkannt wird."""
    vor = int(0.2 * SR) if zyklisch and len(x_mono) > int(0.4 * SR) else 0
    xx = np.concatenate([x_mono[-vor:], x_mono]) if vor else x_mono
    f = signal.sosfiltfilt(sos_band(lo, hi), xx)
    env = np.abs(signal.hilbert(f))
    w = max(1, int(glatt_ms / 1000 * SR))
    env = np.convolve(env, np.ones(w) / w, "same")
    e = env[:: SR // 1000]                                  # 1-kHz-Takt
    le = np.log1p(e / (np.percentile(e, 99) + 1e-12) * 100)
    odf = np.maximum(0, le[5:] - le[:-5])
    odf = np.concatenate([np.zeros(5), odf])
    if odf.max() <= 0:
        return np.array([])
    boden = 0.15 * np.percentile(odf, 99.5)
    k = 1000
    mu = np.convolve(odf, np.ones(k) / k, "same")
    sd = np.sqrt(np.maximum(0, np.convolve(odf ** 2, np.ones(k) / k, "same") - mu ** 2))
    schwelle = np.maximum(mu + delta * sd, boden)
    out, st, letzt, r = [], [], -1e9, 25
    for i in range(r, len(odf) - r):
        if odf[i] > schwelle[i] and odf[i] == odf[i - r:i + r + 1].max() and i / 1000 - letzt >= min_abstand_s:
            a, b = max(0, i - 40), min(len(e), i + 30)
            jmin = a + int(np.argmin(e[a:i + 1])); jmax = i + int(np.argmax(e[i:b]))
            halb = e[jmin] + 0.5 * (e[jmax] - e[jmin])
            kk = jmin
            while kk < jmax and e[kk] < halb:
                kk += 1
            out.append(kk / 1000.0); st.append(e[jmax]); letzt = i / 1000.0
    out, st = np.array(out), np.array(st)
    if vor:
        out = out - vor / SR
        ok = (out >= -0.001) & (out < len(x_mono) / SR - 0.001)
        out, st = np.maximum(out[ok], 0.0), st[ok]
    return (out, st) if mit_staerke else out

def kick_phase(x, bpm, bins=256):
    """Wo sitzt der Kick relativ zum Raster: Tief-Band-Huellkurve (30-250 Hz, Hilbert) schlagsynchron
    gefaltet, Maximum suchen, davor den 50-%-Punkt des Anstiegs. Ergebnis in Schlaegen [-0.5, 0.5).
    (Erste Fassung als Kreismittel der Anschlaege: Offbeat-Ereignisse loeschten den Vektor aus, R=0,13.)
    klarheit = (max-min)/(max+min) des gefalteten Profils."""
    xm = x.mean(axis=1) if x.ndim == 2 else x
    f = signal.sosfiltfilt(sos_band(30, 250), xm)
    env = np.abs(signal.hilbert(f))
    beta = np.arange(len(env)) / SR * bpm / 60.0
    k = (np.mod(beta, 1.0) * bins).astype(int)
    prof = np.bincount(k, weights=env, minlength=bins) / np.maximum(1, np.bincount(k, minlength=bins))
    if prof.max() <= 1e-9:
        return None
    im = int(np.argmax(prof))
    tal = im - bins // 4 + int(np.argmin(np.roll(prof, -(im - bins // 4))[:bins // 4 + 1]))
    lo_, hi_ = prof[tal % bins], prof[im]
    j = tal
    while j < im and prof[j % bins] < lo_ + 0.5 * (hi_ - lo_):
        j += 1
    ph = ((j / bins) + 0.5) % 1 - 0.5
    return {"phase_schlaege": round(float(ph), 3), "phase_ms": round(float(ph * 60000 / bpm), 1),
            "klarheit": round(float((prof.max() - prof.min()) / (prof.max() + prof.min())), 3)}

def onsets(x, mit_staerke=False):
    xm = x.mean(axis=1)
    return {n: onsets_band(xm, lo, hi, mit_staerke=mit_staerke) for n, lo, hi in ONSET_BAENDER}

def onset_profil(on_s, bpm, takte):
    """Treffer je Takt auf den 16 Positionen (Anschlag innerhalb 30 ms vom Sechzehntel)."""
    if takte is None or len(on_s) == 0:
        return [0.0] * 16, None
    s16 = 60.0 / bpm / 4
    pos = on_s / s16
    k = np.round(pos).astype(int)
    abw_ms = np.abs(pos - k) * s16 * 1000
    ok = abw_ms <= KOLL_MS
    h = np.bincount(k[ok] % 16, minlength=16) / takte
    return [round(float(v), 3) for v in h], round(float(np.median(abw_ms)), 1)

# ---------------------------------------------------------------- Tonart
NAMEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
DUR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MOLL = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
CAM_MOLL = {9: "8A", 4: "9A", 11: "10A", 6: "11A", 1: "12A", 8: "1A", 3: "2A", 10: "3A", 5: "4A", 0: "5A", 7: "6A", 2: "7A"}
CAM_DUR = {0: "8B", 7: "9B", 2: "10B", 9: "11B", 4: "12B", 11: "1B", 6: "2B", 1: "3B", 8: "4B", 3: "5B", 10: "6B", 5: "7B"}

def spitzen(x_mono, fmin=30.0, fmax=2000.0, n=32768, hop=8192, dyn_db=50):
    """Spektralspitzen je Rahmen mit parabolischer Feinlage: (Frequenz Hz, Betrag).
    Erste Fassung (Bins ab 55 Hz summiert) verlor die Message-Bassnoten (32-52 Hz) ganz und
    zaehlte Fensterlecks eines 52-Hz-Tons als A. 1,46-Hz-Bins trennen Halbtoene ab etwa 30 Hz."""
    if len(x_mono) < n:
        x_mono = np.pad(x_mono, (0, n - len(x_mono)))
    fr = np.lib.stride_tricks.sliding_window_view(x_mono, n)[::hop] * np.hanning(n)
    A = np.abs(np.fft.rfft(fr, axis=1)) + 1e-12
    La = np.log(A)
    i0, i1 = int(fmin * n / SR) + 1, int(fmax * n / SR)
    a, b, c = La[:, i0 - 1:i1 - 1], La[:, i0:i1], La[:, i0 + 1:i1 + 1]
    ist = (b > a) & (b >= c) & (b > (La.max(axis=1, keepdims=True) - dyn_db / 8.686))
    r, k = np.nonzero(ist)
    al, be, ga = a[r, k], b[r, k], c[r, k]
    d = 0.5 * (al - ga) / (al - 2 * be + ga - 1e-12)
    f = (k + i0 + d) * SR / n
    mag = np.exp(be - 0.25 * (al - ga) * d)
    return f, mag

def stimmung_cent(f, mag):
    """Abweichung der Stimmung von A=440 Hz in Cent, gewichtetes Kreismittel ueber alle Spitzen."""
    if len(f) == 0:
        return None
    st = 12 * np.log2(f / 440.0)
    z = (mag * np.exp(2j * np.pi * (st - np.round(st)))).sum()
    return float(np.angle(z) / (2 * np.pi) * 100)

def chroma(x_mono, stimmung=None):
    """Tonklassen-Profil aus Spektralspitzen, auf die gemessene Stimmung zentriert."""
    f, mag = spitzen(x_mono)
    if stimmung is None:
        stimmung = stimmung_cent(f, mag) or 0.0
    pc = np.round(12 * np.log2(f / 440.0) + 9 - stimmung / 100).astype(int) % 12
    c = np.zeros(12)
    np.add.at(c, pc, mag)
    return c / (c.sum() + 1e-30)

def tonart_aus_chroma(c):
    werte = []
    for r in range(12):
        werte.append((np.corrcoef(np.roll(DUR, r), c)[0, 1], r, "Dur"))
        werte.append((np.corrcoef(np.roll(MOLL, r), c)[0, 1], r, "Moll"))
    werte.sort(reverse=True)
    (k, r, g), (k2, r2, g2) = werte[0], werte[1]
    cam = (CAM_DUR if g == "Dur" else CAM_MOLL)[r]
    p = c / (c.sum() + 1e-30)
    ent = -(p * np.log(p + 1e-30)).sum() / np.log(12)
    return {"tonart": f"{NAMEN[r]}-{g}", "camelot": cam, "r": round(float(k), 3),
            "vorsprung": round(float(k - k2), 3), "zweite": f"{NAMEN[r2]}-{g2}",
            "tonalitaet": round(float(1 - ent), 3)}

def camelot_abstand(a, b):
    na, la = int(a[:-1]), a[-1]; nb, lb = int(b[:-1]), b[-1]
    d = abs(na - nb); d = min(d, 12 - d)
    return d + (0 if la == lb else 1)

# ---------------------------------------------------------------- Bass-Charakter
def bass_charakter(x, bpm, E=None):
    """Modulationstiefe der Tief-Huellkurve (30-250 Hz) bei Viertel-, Achtel-, Sechzehntel-Rate.
    rollend = starke 16tel-Modulation; rund/lang = schwache Modulation bei hoher Belegung."""
    xm = x.mean(axis=1)
    f = signal.sosfiltfilt(sos_band(30, 250), xm)
    w = int(0.005 * SR)
    env = np.sqrt(np.convolve(f ** 2, np.ones(w) / w, "same"))[:: SR // 1000]  # 1 kHz
    if env.mean() <= 1e-9:
        return None
    n = len(env)
    X = np.abs(np.fft.rfft(env * np.hanning(n)))
    fr = np.fft.rfftfreq(n, 1 / 1000)
    dc = X[0]
    fb = bpm / 60.0
    def tiefe(rate):
        i = int(np.argmin(np.abs(fr - rate)))
        return float(2 * X[max(0, i - 1):i + 2].max() / (dc + 1e-12))
    E = (band_energien(x, bpm) if E is None else E)[:2].sum(0)  # sub+tief je 16tel
    bel = float(np.mean(E > E.max() * 10 ** (-12 / 10)))
    d = {"tiefe_viertel": round(tiefe(fb), 3), "tiefe_achtel": round(tiefe(2 * fb), 3),
         "tiefe_16tel": round(tiefe(4 * fb), 3), "belegung_16tel": round(bel, 3)}
    return d

# ---------------------------------------------------------------- Fingerabdruck
def fingerabdruck(pfad, meta=None):
    x = lade(pfad)
    n = len(x)
    bpm, takte = bpm_aus_datei(pfad, n)
    d = {"datei": os.path.relpath(pfad, REPO), "dauer_s": round(n / SR, 3),
         "bpm": None if bpm is None else round(bpm, 3), "takte": takte}
    d["lautheit"] = lautheit(x, bpm)
    ges = (x ** 2).sum(axis=1).mean()
    if bpm:
        E = band_energien(x, bpm)
        eb = E.mean(axis=1)
        d["baender_db"] = [round(float(10 * np.log10(v + 1e-20)), 2) for v in eb]
        d["baender_anteil"] = [round(float(v / (eb.sum() + 1e-30)), 4) for v in eb]
        # Rhythmus je Band als Energie-Profil ueber die 16 Positionen (Mittel ueber Takte, normiert)
        st = E.shape[1] // 16 * 16
        P = E[:, :st].reshape(len(BAENDER), -1, 16).mean(axis=1)
        d["energie_profil16"] = [[round(float(v), 3) for v in (p / (p.max() + 1e-30))] for p in P]
        on_st = onsets(x, mit_staerke=True)
        on = {k: v[0] for k, v in on_st.items()}
        d["anschlaege_s"] = {k: [round(float(t), 4) for t in v] for k, v in on.items()}
        d["anschlaege_staerke_db"] = {k: [round(float(20 * np.log10(a + 1e-12)), 1) for a in v[1]] for k, v in on_st.items()}
        prof, abw = {}, {}
        for k, v in on.items():
            prof[k], abw[k] = onset_profil(v, bpm, takte)
        d["onset_profil16"] = prof
        d["raster_abweichung_ms"] = abw
        d["anschlaege_je_takt"] = {k: round(len(v) / takte, 2) for k, v in on.items()}
        d["kick_phase"] = kick_phase(x, bpm)
        d["bass"] = bass_charakter(x, bpm, E)
        tot = E.sum(0)
        d["belegung_16tel"] = round(float(np.mean(tot > tot.max() * 0.01)), 3)  # Schritte ueber max-20 dB
    else:
        d["baender_db"] = None
    fq, mg = spitzen(x.mean(axis=1))
    st = stimmung_cent(fq, mg)
    d["stimmung_cent"] = None if st is None else round(st, 1)
    c = chroma(x.mean(axis=1), st)
    d["chroma"] = [round(float(v), 4) for v in c]
    d["tonart"] = tonart_aus_chroma(c)
    if meta:
        d.update(meta)
    return d

# ---------------------------------------------------------------- Passung
def kacheln(E, schritte):
    reps = int(np.ceil(schritte / E.shape[1]))
    return np.tile(E, (1, reps))[:, :schritte]

def ueberdeckung(PA, PB, eps=1e-20):
    """Ueberdeckung je Band in [0,1]: sum 4 a b/(a+b) / sum (a+b).
    1 = beide gleich stark zur selben Zeit, 0 = einer allein oder zeitlich abwechselnd."""
    s = PA + PB
    return (4 * PA * PB / (s + eps)).sum(axis=-1) / (s.sum(axis=-1) + eps)

def kollisionen(onA_beats, onB_beats, ms_je_schlag):
    """Anteil der Anschlaege mit Partner im anderen Deck innerhalb 30 ms; dazu Flam-Anteil (8-30 ms)."""
    a, b = np.sort(onA_beats), np.sort(onB_beats)
    if len(a) == 0 or len(b) == 0:
        return 0.0, 0.0, 0
    def naechster(u, v):
        i = np.searchsorted(v, u)
        d = np.full(len(u), np.inf)
        for j in (i - 1, i):
            ok = (j >= 0) & (j < len(v))
            d[ok] = np.minimum(d[ok], np.abs(u[ok] - v[j[ok]]))
        return d * ms_je_schlag
    da, db = naechster(a, b), naechster(b, a)
    treffer = (da < KOLL_MS).sum() + (db < KOLL_MS).sum()
    flam = ((da >= 8) & (da < KOLL_MS)).sum() + ((db >= 8) & (db < KOLL_MS)).sum()
    return float(treffer / (len(a) + len(b))), float(flam / max(1, treffer)), int((da < KOLL_MS).sum())

def passung(fa, fb, Ea, Eb, verschiebung_schlaege=0.0, pegelgleich=True, staerke_boden_db=-30.0, E_schon_verschoben=False, trim_db=None):
    """fa/fb: Fingerabdruecke, Ea/Eb: Band-Energien je 16tel (Beat-Zeit).
    pegelgleich: B wird vorher auf die LUFS von A gebracht (der Gain-Knopf nach dem Vorhoeren, A4).
    Kollisionen zaehlen nur Anschlaege, die nach dem Angleich ueber staerke_boden_db unter dem
    lautesten Anschlag beider Decks im selben Band liegen (sonst zaehlen Atem und Plosive als 'Tief')."""
    schritte = max(Ea.shape[1], Eb.shape[1])
    la, lb = fa["lautheit"]["lufs"], fb["lautheit"]["lufs"]
    if trim_db is None:   # ohne Vorgabe: Loop gegen Loop angleichen (nur fuer gleichartiges Material sinnvoll)
        trim_db = (la - lb) if (pegelgleich and la is not None and lb is not None) else 0.0
    A, B = kacheln(Ea, schritte), kacheln(Eb, schritte) * 10 ** (trim_db / 10)
    if verschiebung_schlaege and not E_schon_verschoben:
        B = np.roll(B, int(round(verschiebung_schlaege * 4)), axis=1)   # grob: nur ganze 16tel
    M = ueberdeckung(A, B)
    anteil = (A + B).mean(axis=1); anteil = anteil / anteil.sum()
    d = {"ueberdeckung": {n: round(float(m), 3) for n, m in zip(BNAMEN, M)},
         "ueberdeckung_relevant": {n: (round(float(m), 3) if a >= 0.01 else None) for n, m, a in zip(BNAMEN, M, anteil)},
         "ueberdeckung_gewichtet": round(float((anteil * M).sum()), 3),
         "band_anteil_summe": {n: round(float(a), 4) for n, a in zip(BNAMEN, anteil)}}
    # Aufschlag: um wie viel dB steigt die Band-Energie, wenn beide unveraendert zusammen laufen
    d["aufschlag_db"] = {n: round(float(10 * np.log10((A[i] + B[i]).sum() / max(A[i].sum(), B[i].sum()) + 1e-30)), 2)
                         for i, n in enumerate(BNAMEN)}
    ms = 60000.0 / SET_BPM
    lenA, lenB = fa["takte"] * 4, fb["takte"] * 4
    L = max(lenA, lenB)
    koll = {}
    for band in ("tief", "mitte", "hoch"):
        sa = np.array(fa["anschlaege_staerke_db"][band]); sb = np.array(fb["anschlaege_staerke_db"][band]) + trim_db
        boden = max(sa.max() if len(sa) else -200, sb.max() if len(sb) else -200) + staerke_boden_db
        oa = np.array(fa["anschlaege_s"][band])[sa >= boden] * fa["bpm"] / 60.0
        ob = np.array(fb["anschlaege_s"][band])[sb >= boden] * fb["bpm"] / 60.0 + verschiebung_schlaege
        na, nb = len(oa), len(ob)
        oa = np.concatenate([oa + k * lenA for k in range(int(np.ceil(L / lenA)))]) if na else oa; oa = oa[oa < L]
        ob = np.concatenate([ob + k * lenB for k in range(int(np.ceil(L / lenB)) + 1)]) % L if nb else ob
        r, flam, n_a_koll = kollisionen(oa, ob, ms)
        koll[band] = {"rate": round(r, 3), "flam_anteil": round(flam, 3), "gezaehlt_a_b": [len(oa), len(ob)],
                      "kollisionen_je_takt": round(n_a_koll / (L / 4), 2)}
    d["kollision_30ms"] = koll
    d["trim_b_db"] = round(trim_db, 2)
    ta, tb = fa["tonart"], fb["tonart"]
    ca, cb = np.array(fa["chroma"]), np.array(fb["chroma"])
    d["tonart"] = {"a": ta["tonart"] + " " + ta["camelot"], "b": tb["tonart"] + " " + tb["camelot"],
                   "camelot_abstand": camelot_abstand(ta["camelot"], tb["camelot"]),
                   "chroma_kosinus": round(float(ca @ cb / (np.linalg.norm(ca) * np.linalg.norm(cb) + 1e-30)), 3)}
    summe = tonart_aus_chroma((ca + cb) / 2)
    d["tonart"]["klarheit_summe_minus_min"] = round(summe["r"] - min(ta["r"], tb["r"]), 3)
    sa, sb = fa.get("stimmung_cent"), fb.get("stimmung_cent")
    d["stimmung_differenz_cent"] = None if sa is None or sb is None else round(((sb - sa + 50) % 100) - 50, 1)
    la, lb = fa["lautheit"]["lufs"], fb["lautheit"]["lufs"]
    d["lufs_differenz"] = None if la is None or lb is None else round(lb - la, 2)
    d["crest_differenz"] = round(fb["lautheit"]["crest_db"] - fa["lautheit"]["crest_db"], 2)
    d["stretch_zur_basis_prozent"] = {"a": round((SET_BPM / fa["bpm"] - 1) * 100, 2),
                                      "b": round((SET_BPM / fb["bpm"] - 1) * 100, 2)}
    d["tempo_abstand_prozent"] = round(abs(fb["bpm"] / fa["bpm"] - 1) * 100, 2)
    va, vb = fa.get("vocal_anteil"), fb.get("vocal_anteil")
    d["vocal_ueberlapp"] = None if va is None or vb is None else round(min(va, vb), 3)
    return d
