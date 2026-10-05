"""Takt-Raster: Traktor-Grid (TYPE 4, START ms, BPM aus TEMPO) oder eigene Schaetzung aus TBPM.

Konvention: Takt 0 beginnt am Anker. Takte vor dem Anker haben negative Nummern.
Eigene Schaetzung: BPM um TBPM verfeinern (+-0,5 %), Beat-Phase ueber Spektralfluss,
Takt-Eins unter den 4 Beat-Lagen per Strukturneuheit (Wechsel fallen auf die Eins).
"""
import numpy as np

# Die Tiefband-Huelle steigt, sobald das Fenster (2048 bei 22050 Hz) den Kick erfasst, also vor dem
# Einsatz. Am synthetischen Kick gemessen: -27 bis -33 ms (tests/test_detektor.py). Ausgleich:
KICK_VERSATZ_S = 0.030


def raster_aus_anker(dauer_s, bpm, anker_s):
    takt_s = 4 * 60.0 / bpm
    k0 = -int(np.floor(anker_s / takt_s))
    k1 = int(np.ceil((dauer_s - anker_s) / takt_s))
    nummern = np.arange(k0, k1)
    starts = anker_s + nummern * takt_s
    return {"bpm": float(bpm), "anker_s": float(anker_s), "takt_s": takt_s,
            "nummern": nummern, "starts": starts}


def kick_huelle(fm):
    """Positive Aenderung der log. Tiefbandleistung (Kick-Einsaetze)."""
    lg = np.log(fm["p"][:, 0] + 1e-10)
    return np.maximum(np.diff(lg, prepend=lg[0]), 0)


def _beat_phase(fluss, fps, bpm):
    env = fluss - np.convolve(fluss, np.ones(int(fps)) / int(fps), mode="same")
    env = np.maximum(env, 0)
    per = 60.0 / bpm * fps
    n = np.arange(int((len(env) - per) / per))
    phasen = np.arange(0, per, 0.5)
    idx = np.rint(phasen[:, None] + n[None, :] * per).astype(int)
    idx = np.clip(idx, 0, len(env) - 1)
    s = env[idx].sum(axis=1)
    j = int(np.argmax(s))
    return phasen[j] / fps, float(s[j] / max(1, len(n)))


def schaetze_bpm(fluss, fps, lo=90.0, hi=160.0):
    env = np.maximum(fluss - fluss.mean(), 0)
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    lags = np.arange(len(ac)) / fps
    ok = (lags >= 60.0 / hi) & (lags <= 60.0 / lo)
    lag = lags[ok][np.argmax(ac[ok])]
    return 60.0 / lag


def eigene_schaetzung(fm, tbpm, eins_waehler):
    """eins_waehler(raster) -> Punktzahl; hoeher = plausiblere Takt-Eins."""
    fps = fm["sr"] / fm["hop"]
    if not tbpm:
        tbpm = schaetze_bpm(fm["fluss"], fps)
    beste = None
    env = kick_huelle(fm)
    for bpm in tbpm * (1 + np.linspace(-0.005, 0.005, 41)):
        ph, s = _beat_phase(env, fps, bpm)
        if beste is None or s > beste[2]:
            beste = (bpm, ph, s)
    bpm, ph, _ = beste
    ph += KICK_VERSATZ_S
    beat = 60.0 / bpm
    kandidaten = []
    for lage in range(4):
        r = raster_aus_anker(fm["dauer_s"], bpm, ph + lage * beat)
        kandidaten.append((eins_waehler(r), lage, r))
    kandidaten.sort(key=lambda k: -k[0])
    r = kandidaten[0][2]
    r["quelle"] = "eigen"
    return r
