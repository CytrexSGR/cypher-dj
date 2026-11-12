"""Time map of a track, first version without stems: one row of numbers per bar.

Pure functions, no I/O. Input is the decoded source audio (48 kHz, float, shape (n, 2); (n,) and (n, 1) are
accepted and treated as dual mono) and the `material.json` of the track (tempo map `tempo_karte_quelle`,
`raster.erste_eins_quell_beat`). Every quantity is a list with one entry per bar; `None` marks a bar where the
quantity is undefined (silence), so the JSON never carries NaN.

Quantities per bar
  lufs          K-weighted, ungated loudness (fa.k_filter, same formula as lautheit.lufs_je_takt, but on the
                variable bar grid of the source instead of the fixed 128 BPM grid of a version).
  schwerpunkt   spectral centroid in Hz: centroid of the power spectrum summed over all STFT frames of the bar
                (2048 Hann window, hop 1024, both channels).
  bassanteil    0..1: energy of the bands sub + tief (30-250 Hz) divided by the energy of all six bands of
                fa.BAENDER. fa.band_energien works on a fixed BPM grid, so the bands are integrated here per bar
                with the same filters (fa.sos_band).
  kicks, hats   number of onsets per bar from fa.onsets_band, kick band 30-250 Hz, hat band 6-16 kHz.
  breite        RMS(side) / RMS(mid) with mid = (L+R)/2, side = (L-R)/2, capped at BREITE_MAX (pure antiphase would
                be infinite). 0 = mono.
  korrelation   Pearson-free correlation sum(L*R) / sqrt(sum(L^2) * sum(R^2)), -1..1, as klang.lautheit.korrelation.
  pump_db       pump depth, see `pump_je_takt`.
"""
import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter1d

from . import fa

SR = fa.SR
STILLE_MS = 1e-12                 # mean square (sum over channels) at or below this counts as silence
STFT_N, STFT_HOP = 2048, 1024
BASS_BAENDER = ("sub", "tief")
KICK_BAND = (30, 250)
HAT_BAND = (6000, 16000)
BREITE_MAX = 10.0
PUMP_BAND = (50, 800)             # bass and low mids (sub fundamentals included, so a ducked bass is seen)
PUMP_GLATT_MS = 10                # RMS smoothing of the band envelope
PUMP_STILLE_MS = 1e-9             # a beat whose band power is at or below this is skipped
PUMP_BODEN_DB = 40.0              # envelope floor: beat peak minus 40 dB, so gaps cannot blow up the depth
BREAK_REF_QUANTIL = 75            # "full" loudness = this percentile of the bar loudness over the whole track
BREAK_SCHWELLE_DB = 5.0           # a bar this far below the full loudness belongs to a break
BREAK_BASS_BRUCHTEIL = 0.5        # ... or a bar whose bass share is below this fraction of the track median
BREAK_LUECKE = 1                  # up to this many full bars between two break runs are closed
BREAK_MIN_TAKTE = 2               # shorter dips are drum fills, not breaks


# ---------------------------------------------------------------- grid
def takt_raster(tempo_karte, erste_eins_beat, dauer_s=None, taktart=4):
    """Bar starts in source seconds from `tempo_karte_quelle` = [[quell_sekunde, quell_beat], ...].

    Bar k starts at beat `erste_eins_beat + taktart * k`, the position is interpolated linearly in the map, so
    tempo changes are followed. The first bar is the first Takt-Eins at or after the first map entry. Without
    `dauer_s` only bars inside the map are returned; with it the map is extrapolated with the tempo of its last
    section up to `dauer_s` (as the versions do). Returns (takte, warnungen); takte = [{nr, start_s, ende_s, eins}].
    Every bar starts on a Takt-Eins by construction, `eins` is therefore always True; an uncertain Eins is
    reported by `zeitkarte_berechnen` as a warning."""
    try:
        k = np.asarray(tempo_karte, dtype=float).reshape(-1, 2)
    except (ValueError, TypeError):
        return [], ["tempo map unreadable"]
    if len(k) < 2 or not np.all(np.isfinite(k)):
        return [], ["tempo map empty or too short (need at least two beats)"]
    s, b = k[:, 0], k[:, 1]
    if np.any(np.diff(s) <= 0) or np.any(np.diff(b) <= 0):
        return [], ["tempo map not strictly increasing"]

    def sek(beat):
        t = float(np.interp(beat, b, s))
        if beat > b[-1]:
            t = s[-1] + (beat - b[-1]) * (s[-1] - s[-2]) / (b[-1] - b[-2])
        return t

    erster = erste_eins_beat + taktart * int(np.ceil((b[0] - erste_eins_beat) / taktart - 1e-9))
    ende_beat = b[-1] if dauer_s is None else b[-1] + (dauer_s - s[-1]) * (b[-1] - b[-2]) / (s[-1] - s[-2])
    takte, nr = [], 0
    while erster + taktart * (nr + 1) <= ende_beat + 1e-9:
        a, e = sek(erster + taktart * nr), sek(erster + taktart * (nr + 1))
        if dauer_s is not None and e > dauer_s + 1e-9:
            break
        takte.append({"nr": nr, "start_s": a, "ende_s": e, "eins": True})
        nr += 1
    if not takte:
        return [], ["tempo map shorter than one bar"]
    return takte, []


# ---------------------------------------------------------------- helpers
def _stereo(x):
    x = np.asarray(x)
    if x.ndim == 1:
        x = x[:, None]
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2]


def _grenzen(takte):
    a = np.array([int(round(t["start_s"] * SR)) for t in takte], dtype=np.int64)
    e = np.array([int(round(t["ende_s"] * SR)) for t in takte], dtype=np.int64)
    return a, e


def _leise(x, a, e):
    """True for bars with (almost) no signal."""
    return [float(np.mean(x[i:j].astype(np.float64) ** 2, axis=0).sum()) <= STILLE_MS if j > i else True
            for i, j in zip(a, e)]


def _bandleistung(x, lo, hi):
    f = signal.sosfiltfilt(fa.sos_band(lo, hi), x.astype(np.float64), axis=0)
    return (f ** 2).sum(axis=1)


def _zu_kurz(x):
    return len(x) < 4 * SR // 10


# ---------------------------------------------------------------- quantities
def lautheit_je_takt(x, takte):
    x = _stereo(x)
    a, e = _grenzen(takte)
    z = fa.k_filter(x.astype(np.float64))
    out = []
    for i, j in zip(a, e):
        ms = float(np.mean(z[i:j] ** 2, axis=0).sum()) if j > i else 0.0
        out.append(None if ms <= STILLE_MS else round(-0.691 + 10.0 * np.log10(ms), 2))
    return out


def schwerpunkt_je_takt(x, takte):
    x = _stereo(x)
    a, e = _grenzen(takte)
    stumm = _leise(x, a, e)
    fenster = np.hanning(STFT_N).astype(np.float32)
    freq = np.fft.rfftfreq(STFT_N, 1.0 / SR)
    out = []
    for i, j, st in zip(a, e, stumm):
        if st or j - i < STFT_N:
            out.append(None)
            continue
        p = np.zeros(len(freq))
        for c in range(2):
            fr = np.lib.stride_tricks.sliding_window_view(x[i:j, c].astype(np.float32), STFT_N)[::STFT_HOP]
            p += (np.abs(np.fft.rfft(fr * fenster, axis=1)) ** 2).sum(axis=0, dtype=np.float64)
        out.append(round(float((freq * p).sum() / p.sum()), 1) if p.sum() > 0 else None)
    return out


def bassanteil_je_takt(x, takte):
    x = _stereo(x)
    a, e = _grenzen(takte)
    stumm = _leise(x, a, e)
    summe = np.zeros(len(takte))
    bass = np.zeros(len(takte))
    for name, lo, hi in fa.BAENDER:
        p = _bandleistung(x, lo, hi)
        je_takt = np.array([p[i:j].sum() if j > i else 0.0 for i, j in zip(a, e)])
        summe += je_takt
        if name in BASS_BAENDER:
            bass += je_takt
        del p
    return [None if st or s <= 0 else round(float(b / s), 4) for st, b, s in zip(stumm, bass, summe)]


def anschlaege_je_takt(x, takte):
    """(kicks, hats): onset counts per bar. Silent bars give None."""
    x = _stereo(x)
    a, e = _grenzen(takte)
    stumm = _leise(x, a, e)
    mono = x.astype(np.float64).mean(axis=1)
    start = np.array([t["start_s"] for t in takte])
    ende = np.array([t["ende_s"] for t in takte])
    ergebnis = []
    for lo, hi in (KICK_BAND, HAT_BAND):
        ons = np.asarray(fa.onsets_band(mono, lo, hi, zyklisch=False)) if not _zu_kurz(mono) else np.array([])
        n = np.searchsorted(ons, ende, "left") - np.searchsorted(ons, start, "left")
        ergebnis.append([None if st else int(c) for st, c in zip(stumm, n)])
    return ergebnis[0], ergebnis[1]


def breite_je_takt(x, takte):
    """(breite, korrelation) per bar, see module docstring."""
    x = _stereo(x)
    a, e = _grenzen(takte)
    breite, korr = [], []
    for i, j in zip(a, e):
        l, r = x[i:j, 0].astype(np.float64), x[i:j, 1].astype(np.float64)
        el, er = float(np.sum(l * l)), float(np.sum(r * r))
        if j <= i or (el + er) / (2 * (j - i)) <= STILLE_MS / 2:
            breite.append(None)
            korr.append(None)
            continue
        m, s = (l + r) / 2, (l - r) / 2
        rm, rs = float(np.sqrt(np.mean(m * m))), float(np.sqrt(np.mean(s * s)))
        breite.append(round(BREITE_MAX if rm <= rs / BREITE_MAX else rs / rm, 4))
        if min(el, er) < 1e-10 * max(el, er):
            korr.append(0.0)                    # one channel dead: correlation undefined, as klang.korrelation
        else:
            korr.append(round(float(np.sum(l * r) / np.sqrt(el * er)), 4))
    return breite, korr


def pump_je_takt(x, takte):
    """Pump depth in dB per bar.

    Definition: take the power of the bass/low-mid band (50-800 Hz) (PUMP_BAND, zero-phase band pass, both channels summed),
    average it in 1 ms blocks, smooth with a PUMP_GLATT_MS moving mean and convert to dB (the envelope). Each bar
    is cut into four equal beats. Depth of a beat = maximum minus minimum of the envelope inside that beat, the
    minimum floored at the beat peak minus PUMP_BODEN_DB. The bar value is the mean over its beats that carry
    signal (None if none does). A sidechain that ducks by D dB at every beat and releases within the beat reads
    close to D (a little less, the smoothing eats the very bottom); a steady tone reads about 0. Without stems
    the kick itself sits in the band and also counts as modulation, so on kick-driven material the value is an
    upper bound of the bass pump."""
    x = _stereo(x)
    a, e = _grenzen(takte)
    p = _bandleistung(x, *PUMP_BAND)
    n = len(p) // 48
    roh = p[:n * 48].reshape(n, 48).mean(axis=1)                    # 1 ms blocks
    del p
    glatt = uniform_filter1d(roh, PUMP_GLATT_MS, mode="nearest")
    db = 10.0 * np.log10(np.maximum(glatt, 1e-12))
    out = []
    for i, j in zip(a, e):
        tiefen = []
        for k in range(4):
            b0 = int(round((i + (j - i) * k / 4) / 48))
            b1 = min(n, int(round((i + (j - i) * (k + 1) / 4) / 48)))
            if b1 - b0 < 2 * PUMP_GLATT_MS or roh[b0:b1].mean() <= PUMP_STILLE_MS:
                continue
            seg = db[b0:b1]
            hoch = seg.max()
            tiefen.append(hoch - max(seg.min(), hoch - PUMP_BODEN_DB))
        out.append(round(float(np.mean(tiefen)), 2) if tiefen else None)
    return out


# ---------------------------------------------------------------- breaks
def breaks_finden(lufs, bassanteil=None, schwelle_db=BREAK_SCHWELLE_DB, bass_bruchteil=BREAK_BASS_BRUCHTEIL,
                  luecke=BREAK_LUECKE, min_takte=BREAK_MIN_TAKTE):
    """Breaks = runs of bars that are either `schwelle_db` below the full loudness of the track (percentile
    BREAK_REF_QUANTIL of all bars, a track-wide reference, so a long break cannot drag its own reference down)
    or whose bass share is below `bass_bruchteil` of the track median bass share (`bassanteil` optional).
    A track that is quiet or bass-poor all the way through has no break, both criteria are relative to the track.
    Gaps of up to `luecke` full bars between two runs are closed. Runs shorter than `min_takte` are dropped, so
    are runs touching the first or the last bar (intro and outro, also a bass-less intro, are not breaks). None
    bars are never hit by their own criterion. Returns [{start_takt, laenge_takte, tiefe_db, grund, bass_weg}]:
    tiefe_db = mean distance of the run's bars to the full loudness, grund = "lautheit" | "bass" | "beides"
    (which criteria hit anywhere in the run), bass_weg = the bass criterion hit in at least half of the bars."""
    n = len(lufs)
    v = np.array([np.nan if w is None else float(w) for w in lufs])
    if n == 0 or not np.any(np.isfinite(v)):
        return []
    abstand = np.nanpercentile(v, BREAK_REF_QUANTIL) - v
    laut = np.isfinite(abstand) & (abstand >= schwelle_db)
    bass = np.zeros(n, dtype=bool)
    if bassanteil is not None:
        b = np.array([np.nan if w is None else float(w) for w in bassanteil])
        if np.any(np.isfinite(b)):
            bass = np.isfinite(b) & (b < bass_bruchteil * np.nanmedian(b))
    hit = laut | bass
    i = 0
    while i < n:                                    # close small gaps between two runs
        if hit[i]:
            i += 1
            continue
        j = i
        while j < n and not hit[j]:
            j += 1
        if 0 < i and j < n and j - i <= luecke:
            hit[i:j] = True
        i = j
    out, i = [], 0
    while i < n:
        if not hit[i]:
            i += 1
            continue
        j = i
        while j < n and hit[j]:
            j += 1
        if j - i >= min_takte and i > 0 and j < n:
            a = abstand[i:j]
            a = a[np.isfinite(a)]
            hl, hb = bool(laut[i:j].any()), bool(bass[i:j].any())
            out.append({"start_takt": i, "laenge_takte": j - i,
                        "tiefe_db": round(float(a.mean()), 2) if len(a) else None,
                        "grund": "beides" if hl and hb else ("bass" if hb else "lautheit"),
                        "bass_weg": bool(bass[i:j].sum() * 2 >= j - i)})
        i = j
    return out


# ---------------------------------------------------------------- whole track
def zeitkarte_berechnen(material, x):
    """Time map of one track as a dict (`zeitkarte/1`). `material`: parsed material.json; `x`: decoded source."""
    x = _stereo(x)
    r = material.get("raster", {})
    dauer = float(material.get("quelle", {}).get("dauer_s") or len(x) / SR)
    takte, warn = takt_raster(material.get("tempo_karte_quelle") or [], int(r.get("erste_eins_quell_beat", 0)),
                              dauer_s=dauer, taktart=int(r.get("taktart") or 4))
    warn = list(warn)
    if r.get("erste_eins_unsicher"):
        warn.append("Eins uncertain: the bar grid may be shifted by whole beats")
    voll = [t for t in takte if int(round(t["ende_s"] * SR)) <= len(x)]
    if len(voll) < len(takte):
        warn.append(f"audio shorter than the grid: {len(takte) - len(voll)} of {len(takte)} bars dropped")
    takte = voll
    z = {"schema": "zeitkarte/1", "track": material.get("material_id"), "dauer_s": round(dauer, 3),
         "tempo": None, "takte": [], "breaks": [], "breaks_anzahl": 0, "warnungen": warn}
    if not takte:
        return z
    bpm = [4 * 60.0 / (t["ende_s"] - t["start_s"]) * (4 / max(1, int(r.get("taktart") or 4))) for t in takte]
    z["tempo"] = {"bpm_mittel": round(float(np.mean(bpm)), 3), "bpm_min": round(float(np.min(bpm)), 3),
                  "bpm_max": round(float(np.max(bpm)), 3), "tempo_vielfaches": r.get("tempo_vielfaches")}
    g = {"lufs": lautheit_je_takt(x, takte), "schwerpunkt_hz": schwerpunkt_je_takt(x, takte),
         "bassanteil": bassanteil_je_takt(x, takte)}
    g["kicks"], g["hats"] = anschlaege_je_takt(x, takte)
    g["breite"], g["korrelation"] = breite_je_takt(x, takte)
    g["pump_db"] = pump_je_takt(x, takte)
    for k, werte in g.items():
        nn = sum(w is None for w in werte)
        if nn:
            warn.append(f"{k}: {nn} of {len(werte)} bars undefined (silence)")
    for i, t in enumerate(takte):
        z["takte"].append({"nr": t["nr"], "start_s": round(t["start_s"], 4), "ende_s": round(t["ende_s"], 4),
                           "eins": t["eins"], **{k: g[k][i] for k in g}})
    z["breaks"] = breaks_finden(g["lufs"], g["bassanteil"])
    z["breaks_anzahl"] = len(z["breaks"])
    return z
