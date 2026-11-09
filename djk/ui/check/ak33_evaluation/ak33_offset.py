# AK33 G3 (review F2): onset of a hit against a grid, per beat, per band, per threshold; difference between two layers on the same grid.
# The instrument measures a DIFFERENCE between two signals with one function. What it recovers exactly is a shift of the same sound (calibrated in test_ak33_offset.py).
# The absolute offset between two DIFFERENT sounds (track kick against loop kick) is not a single number: click and body of a kick start at different times and the figure
# moves with the threshold, so the result is reported as a range over bands and thresholds, never as one figure.
#
# onset of one hit: the 1 ms RMS envelope of a band-pass (4th order Butterworth, causal; its delay is the same on both sides and cancels in the difference), window from
# FENSTER_VOR_MS before to FENSTER_NACH_MS after the grid line; peak = maximum in the window; base = minimum of the envelope between window start and peak;
# onset = first crossing of base + anteil * (peak - base) after the last sample below it (linear interpolation, sub-sample). A window whose peak is below MIN_REL times
# the 90th percentile of all window peaks counts as "no hit" (NaN) and is left out.
import json, subprocess, sys
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
BANDEN = {'click 2-8k': (2000, 8000), 'body 100-600': (100, 600), 'low 40-120': (40, 120)}
ANTEILE = (0.25, 0.5, 0.75)
FENSTER_VOR_MS = 60.0
FENSTER_NACH_MS = 120.0
GLATT_MS = 1.0
MIN_REL = 0.2


def lies(pfad, sr=SR, a=None, b=None):
    cmd = ['ffmpeg', '-v', 'error'] + (['-ss', str(a)] if a else []) + (['-t', str(b - a)] if b else []) + ['-i', pfad, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).astype(np.float64)


def huelle(x, lo, hi, glatt_ms=None):
    y = sosfilt(butter(4, [lo, hi], 'bandpass', fs=SR, output='sos'), x)
    w = max(1, int(round(SR * (GLATT_MS if glatt_ms is None else glatt_ms) / 1000)))
    return np.sqrt(np.convolve(y ** 2, np.ones(w) / w, 'same'))


def einsaetze(e, gitter_s, anteil=0.5):
    """Onset (ms after the grid line) of the hit at each grid time; NaN where there is no hit in the window. Returns the array (len(gitter_s))."""
    vor, nach = int(round(FENSTER_VOR_MS * SR / 1000)), int(round(FENSTER_NACH_MS * SR / 1000))
    fenster = []
    for g in gitter_s:
        c = int(round(g * SR)); a = c - vor; b = c + nach
        fenster.append((c, a, b) if a >= 0 and b <= len(e) else None)
    spitzen = [e[a:b].max() for f in fenster if f for (_, a, b) in [f]]
    ref = np.percentile(spitzen, 90) if spitzen else 0.0
    aus = np.full(len(gitter_s), np.nan)
    for i, f in enumerate(fenster):
        if f is None: continue
        c, a, b = f; w = e[a:b]; k = int(np.argmax(w)); pk = w[k]
        if pk < MIN_REL * ref: continue
        base = w[:k + 1].min(); thr = base + anteil * (pk - base)
        j = k
        while j > 0 and w[j - 1] >= thr: j -= 1          # walk back while the envelope stays at or above the threshold
        if j == 0 and w[0] >= thr: continue              # the rise began before the window: no onset inside it
        y0, y1 = w[j - 1], w[j]
        frac = (thr - y0) / (y1 - y0) if y1 > y0 else 0.0
        aus[i] = (a + (j - 1) + frac - c) / SR * 1000
    return aus


def zusammenfassung(a):
    ok = a[~np.isnan(a)]
    if len(ok) == 0: return {'n': 0, 'median': float('nan'), 'p10': float('nan'), 'p90': float('nan'), 'ms': ok, 'alle': a}
    return {'n': int(len(ok)), 'median': float(np.median(ok)), 'p10': float(np.percentile(ok, 10)), 'p90': float(np.percentile(ok, 90)), 'ms': ok, 'alle': a}


TEILMENGEN = {'alle': None, 'beat 2+4': lambda i: i % 2 == 1, 'beat 1+3': lambda i: i % 2 == 0}   # export starts on a bar line: index 0 is beat 1


def einsaetze_tabelle(x, gitter_s, banden=None, anteile=None, teil=None):
    """{(band, anteil): summary} of one signal against the grid. teil = None or a function of the beat index (False = beat left out, NaN)."""
    out = {}
    maske = None if teil is None else np.array([bool(teil(i)) for i in range(len(gitter_s))])
    for name, (lo, hi) in (banden or BANDEN).items():
        e = huelle(x, lo, hi)
        for an in (anteile or ANTEILE):
            a = einsaetze(e, gitter_s, an)
            if maske is not None: a = np.where(maske, a, np.nan)
            out[(name, an)] = zusammenfassung(a)
    return out


def differenz(ref, vergleich):
    """{(band, anteil): summary} of (vergleich - ref) per beat, only beats with a hit in both (positive = vergleich is LATER)."""
    out = {}
    for k in ref:
        d = vergleich[k]['alle'] - ref[k]['alle']
        out[k] = zusammenfassung(d)
    return out


def bereich(d):
    """Range of the median differences over all bands and thresholds."""
    items = [(o['median'], k) for k, o in d.items() if not np.isnan(o['median'])]
    lo, hi = min(items), max(items)
    return {'min': lo[0], 'min_bei': f'band {lo[1][0]} at {int(lo[1][1] * 100)} %', 'max': hi[0], 'max_bei': f'band {hi[1][0]} at {int(hi[1][1] * 100)} %'}


def je_band(d):
    """{band: (min, max) of the median over the thresholds}"""
    out = {}
    for (b, a), o in d.items(): out.setdefault(b, []).append(o['median'])
    return {b: (min(v), max(v)) for b, v in out.items()}


def steigung(beat_nr, ms, n_boot=2000, seed=1):
    """Theil-Sen slope of onset (ms) against beat number (ms per beat) with a bootstrap 95 % interval over beats; NaN entries dropped."""
    beat_nr = np.asarray(beat_nr, float); ms = np.asarray(ms, float); ok = ~np.isnan(ms); beat_nr, ms = beat_nr[ok], ms[ok]
    def ts(bn, m):
        i, j = np.triu_indices(len(bn), 1); dx = bn[j] - bn[i]; sel = dx != 0
        return float(np.median((m[j] - m[i])[sel] / dx[sel]))
    s = ts(beat_nr, ms)
    r = np.random.default_rng(seed); bs = []
    for _ in range(n_boot):
        idx = r.integers(0, len(ms), len(ms)); bs.append(ts(beat_nr[idx], ms[idx]))
    return {'slope_ms_per_beat': s, 'ci95': (float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))), 'n': int(len(ms))}


def tempo_schaetzung(x, gitter_s, click=(2000, 8000), low=(40, 150), kick_rel=0.5, n_boot=2000):
    """True tempo of a hit train from its drift against a grid (G3). Beats where the low band (kick) is below kick_rel * the 90th percentile of the low-band window peaks are
    left out (no kick: breaks, intro), the onset is the click-band onset (50 %); the Theil-Sen slope of onset (ms) against beat number is the period error of the grid:
    slope > 0 = the hits get later against the grid = the grid is faster than the hits. True period = grid period (least-squares line of the grid times) + slope.
    The interval is a bootstrap over beats (beats treated as independent; the block medians in 'bloecke' show whether the drift is monotonic)."""
    gitter_s = np.asarray(gitter_s, float)
    vor, nach = int(round(FENSTER_VOR_MS * SR / 1000)), int(round(FENSTER_NACH_MS * SR / 1000))
    el = huelle(x, *low); a = einsaetze(huelle(x, *click), gitter_s, 0.5)
    pk = np.array([el[c - vor:c + nach].max() if c - vor >= 0 and c + nach <= len(el) else np.nan for c in (int(round(t * SR)) for t in gitter_s)])
    kick = pk >= kick_rel * np.nanpercentile(pk, 90)
    am = np.where(kick, a, np.nan); nr = np.arange(len(gitter_s))
    st = steigung(nr, am, n_boot=n_boot)
    per = float(np.polyfit(nr, gitter_s, 1)[0]); bpm = lambda sl: 60.0 / (per + sl / 1000.0)
    bl = []
    for i in range(0, len(nr), 32):
        b = am[i:i + 32]; ok = ~np.isnan(b)
        if ok.sum() >= 8: bl.append((i, int(ok.sum()), float(np.median(b[ok]))))
    return {'n': st['n'], 'slope_ms_per_beat': st['slope_ms_per_beat'], 'ci95': st['ci95'], 'grid_bpm': 60.0 / per, 'bpm': bpm(st['slope_ms_per_beat']),
            'bpm_ci95': tuple(sorted((bpm(st['ci95'][0]), bpm(st['ci95'][1])))), 'bloecke': bl, 'median_onset_ms': float(np.nanmedian(am))}


def quell_lag(xs, xe, beat_zu_quelle_s, bpm=128.0, fenster=((4.0, 6.0), (7.0, 9.0), (10.0, 12.0)), band=(100, 5000), suche_ms=50.0):
    """Where the engine put a clip against what its marker map says: the source (decoded, mono, 48 kHz) is read through the map (clip beat -> source second, evaluated at the
    export time of each sample, linear interpolation) and cross-correlated with the export in each window; returns the lag in ms per window, POSITIVE = the export is LATER
    than the mapped source (parabolic peak refinement; search range +-suche_ms, a result within a few samples of the range edge is saturated and must not be believed). Needs no hit structure, works on any programme material; the export starts on clip beat 0."""
    from scipy.signal import fftconvolve, sosfiltfilt
    sos = butter(4, list(band), 'bandpass', fs=SR, output='sos')
    xs, xe = sosfiltfilt(sos, xs), sosfiltfilt(sos, xe); aus = []; sp = int(suche_ms * SR / 1000)
    for a, b in fenster:
        i0, n = int(a * SR), int((b - a) * SR); te = (np.arange(n) + i0) / SR
        ws = np.interp(beat_zu_quelle_s(te / (60.0 / bpm)) * SR, np.arange(len(xs)), xs)
        c = fftconvolve(xe[i0 - sp:i0 + n + sp], ws[::-1], 'valid'); i = int(np.argmax(c)); y0, y1, y2 = c[i - 1], c[i], c[i + 1]
        aus.append(float((i - sp + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)) / SR * 1000))
    return aus


LANGSAME_BAENDER = {'low 40-120': 'the 40-120 Hz envelope lags a hit by tens of ms by itself and in the track it follows the bass line'}


def bereichsbericht(ds):
    """One line per measured band: range of the median differences over all thresholds and all beat sets in `ds` ({beat set name: differenz result}).
    EVERY band in BANDEN gets a line (review of G3: a band must not be left out of a 'range per band' report by a filter). A band in LANGSAME_BAENDER is
    reported with the label 'not a kick onset measure' and the reason, not dropped. The spread is the p10..p90 width of the per-beat differences at 50 %."""
    zeilen = []
    for b in BANDEN:
        med = [o['median'] for d in ds.values() for (bb, _), o in d.items() if bb == b and not np.isnan(o['median'])]
        streu = [o['p90'] - o['p10'] for d in ds.values() for (bb, a), o in d.items() if bb == b and a == 0.5 and not np.isnan(o['p90'])]
        if not med: zeilen.append(f'{b:12} no beat with a hit in both'); continue
        z = f'{b:12} {min(med):+.2f} .. {max(med):+.2f} ms over {len(med)} cells (thresholds x beat sets), per-beat spread p10..p90 up to {max(streu):.1f} ms'
        if b in LANGSAME_BAENDER: z += f'  [not a kick onset measure: {LANGSAME_BAENDER[b]}; reported, not used as the kick offset]'
        zeilen.append(z)
    return zeilen


def tabelle_text(d, titel=''):
    z = [titel] if titel else []
    for (b, a), o in d.items():
        z.append(f'  {b:14} {int(a * 100):3d} %  median {o["median"]:+8.2f} ms  p10 {o["p10"]:+8.2f}  p90 {o["p90"]:+8.2f}  n {o["n"]}')
    return '\n'.join(z)


if __name__ == '__main__':
    # usage: ak33_offset.py <ref.wav> <vergleich.wav> [--bpm 128] [--beats 32] [--json out.json]
    a = sys.argv[1:]; bpm = float(a[a.index('--bpm') + 1]) if '--bpm' in a else 128.0
    xr, xv = lies(a[0]), lies(a[1]); n = int(min(len(xr), len(xv)) / SR / (60 / bpm))
    n = int(a[a.index('--beats') + 1]) if '--beats' in a else n - 1
    g = np.arange(n) * 60 / bpm
    tr, tv = einsaetze_tabelle(xr, g), einsaetze_tabelle(xv, g); d = differenz(tr, tv)
    print(tabelle_text(tr, f'reference {a[0].split("/")[-1]} (onset against the grid)')); print(tabelle_text(tv, f'comparison {a[1].split("/")[-1]}'))
    print(tabelle_text(d, 'comparison minus reference (positive = comparison later)')); r = bereich(d); print('range', json.dumps(r)); print('per band', json.dumps(je_band(d)))
    if '--json' in a:
        json.dump({'ref': a[0], 'vergleich': a[1], 'bpm': bpm, 'beats': n, 'diff': {f'{b}@{int(an * 100)}': {k: o[k] for k in ('median', 'p10', 'p90', 'n')} for (b, an), o in d.items()},
                   'bereich': r, 'je_band': je_band(d)}, open(a[a.index('--json') + 1], 'w'), indent=1)
