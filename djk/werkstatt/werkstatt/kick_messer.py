"""Paket 1.13 Warp, Slice 3b (AK18 neu gefasst, Andreas 2026-10-29): der Kick-Messer und der Vergleich Export gegen Quelle.

Warum neu: das Tor raster (tor_raster.py, Tief-Band 30 bis 250 Hz, alle Anschläge) fand an echten Tracks je Schlag zwei Ereignisse rund 25 ms auseinander
(Kick und Bass) und lag damit schon an der QUELLE 26 und 52 ms neben der Karte (~/messungen/2026-10-29-s3a-ziel/bericht.md). Dieser Messer fragt nicht
„wo sind Anschläge“, sondern „wo setzt der Kick dieses Schlags ein“: genau ein Ereignis je erwartetem Schlag.

Verfahren je Schlag b (Fenster b ± ¼ Schlagabstand, der Offbeat bleibt draußen): Band 30 bis 200 Hz nullphasig (Ordnung 2, kurzes Ein- und Ausschwingen), Hilbert-Hüllkurve, 2 ms
geglättet. Der Einsatz ist der Punkt steilsten Anstiegs: der stärkste im Fenster, oder ein früherer bis 40 ms davor mit mindestens 30 % seiner Steigung (eine
Bassnote, die in den abklingenden Kick hinein steigt, darf lauter sein). Bass auf Sechzehnteln und Offbeat liegt weiter weg und zählt nicht. Ein Schlag ohne Kick (Gipfel unter 30 % des Medians aller Gipfel) gibt NaN, kein Fehltreffer.

Vergleich (AK18): Rest des Exports gegen das Projektraster minus Rest der Quelle gegen die Karte, Schlag für Schlag mit demselben Messer. Was der Track
selbst gegen seine Karte versetzt (Kick vor dem Beat, Messer-Eigenart), kürzt sich heraus; übrig bleibt, was der Warp verschiebt.
Seit 2026-10-29 ist die Vorgabe art "anschlag": der Versatz je Schlag direkt aus der Kreuzkorrelation der Hochpass-Hüllkurven (versatz), ohne
Ereigniswahl; der Körper-Vergleich sah die um 20 ms verschobene Fassung von Queen of Pain als ok. Der Körper bleibt als art "koerper".
Ok = mindestens 64 Paare und p90 des Betrags ≤ 8 ms (kette.py TOR_RASTER_MS).
Aufruf: python -m werkstatt.kick_messer --export WAV --bpm 128 --raster-start-s S --quelle DATEI --material material.json --von-beat A --bis-beat B [--art anschlag|koerper]
  (Projekt-Beat k ↔ Karten-Beat k + erste_eins_quell_beat; stdout: genau eine JSON-Zeile)"""
import argparse
import json
import sys

import numpy as np
from scipy import signal

from . import fa

BAND = (30, 200)      # Ordnung 2: Eichung 29.10. sechs Fälle ±0,4 ms; 40..100 Hz Ordnung 4 lag −10 bis +25 ms daneben (Vorschwingen des engen Bands)
ORDNUNG = 2
TOR_MS = 8.0          # kette.py TOR_RASTER_MS
MIN_PAARE = 64
KANDIDAT = 0.10       # Anstiege ab diesem Anteil der stärksten Steigung im Fenster gehen in die Faltung
GIPFEL = 0.30         # ein Gipfel des Faltungsprofils zählt ab diesem Anteil des höchsten
MEHRDEUTIG = 0.040    # ein zweiter zählender Gipfel so nah: nicht entscheidbar, welcher der Kick ist
FANG = 0.025          # je Schlag: der Anstieg, der höchstens so weit neben dem Kick-Gipfel liegt
DA = 0.30             # Anteil des Gipfel-Medians, ab dem ein Schlag einen Kick hat
FENSTER = 0.25        # Anteil des Schlagabstands je Seite
TAKT = 8000           # Hüllkurve im 8-kHz-Takt (0,125 ms)


def huelle(x_mono):
    f = signal.sosfiltfilt(fa.sos_band(*BAND, ordnung=ORDNUNG), np.asarray(x_mono, dtype=float))
    env = np.abs(signal.hilbert(f))
    w = max(1, int(0.002 * fa.SR))
    env = np.convolve(env, np.ones(w) / w, "same")
    return env[:: fa.SR // TAKT]


def _scheitel(d, k):
    """Scheitel der Steigung bei k parabolisch verfeinert; diff liegt zwischen k und k+1."""
    f = 0.0
    if 0 < k < len(d) - 1:
        y0, y1, y2 = d[k - 1], d[k], d[k + 1]
        q = y0 - 2 * y1 + y2
        f = 0.5 * (y0 - y2) / q if q != 0 else 0.0
    return k + 0.5 + f


def _anstiege(e, a, b):
    """Alle Anstiege in e[a:b]: (Index mit Bruchteil, Steigung relativ zur stärksten im Fenster), dazu der Gipfel des Fensters."""
    seg = e[a:b]
    m = float(seg.max())
    d = np.diff(seg)
    w = max(1, int(0.001 * TAKT))
    d = np.convolve(d, np.ones(w) / w, "same")
    dm = float(d.max())
    if dm <= 0:
        return [], m
    r = max(1, int(0.002 * TAKT))      # lokales Maximum über ±2 ms
    out = []
    for k in np.nonzero(d >= KANDIDAT * dm)[0]:
        if d[k] == d[max(0, k - r):k + r + 1].max():
            out.append((a + _scheitel(d, int(k)), float(d[k] / dm)))
    return out, m


def einsaetze(x_mono, schlaege_s, mit_lage=False, lage_ms=None):
    """Kick-Einsatz (Sekunden) je erwartetem Schlag, NaN wo kein Kick ist.
    mit_lage: dazu {lage_ms, gipfel_ms, mehrdeutig}: Lage des Kick-Gipfels im Faltungsprofil, alle zählenden Gipfel, und ob ein zweiter bis 40 ms daneben
    liegt (dann ist „welcher ist der Kick“ an diesem Track nicht entscheidbar; Gegenprobe 29.10.: a9b19ad5 Gipfel bei −20 und +10,5 ms).
    lage_ms: Gipfel vorgegeben statt gesucht (der nächste zählende Gipfel daran; Vergleich: der Export sucht, wo die Quelle ihn hatte)."""
    e = huelle(x_mono)
    s = np.asarray(schlaege_s, dtype=float)
    d = np.diff(s)
    # Fenster ±¼ Schlag: der Offbeat (½ Schlag daneben) liegt draußen. Ein Kick, der mehr als ¼ Schlag neben seinem Schlag liegt, gehört nicht zu ihm.
    halb_vor = np.r_[d[:1], d] * FENSTER if len(s) > 1 else np.array([0.1])
    halb_nach = np.r_[d, d[-1:]] * FENSTER if len(s) > 1 else np.array([0.1])
    kand, gipfel = [], np.zeros(len(s))
    for i, b in enumerate(s):
        a, z = max(0, int((b - halb_vor[i]) * TAKT)), min(len(e), int((b + halb_nach[i]) * TAKT))
        if z - a < 8:
            kand.append([])
            continue
        c, gipfel[i] = _anstiege(e, a, z)
        kand.append([(k / TAKT - b, g) for k, g in c])
    # Faltung: alle Anstiege über ihre Lage zum Schlag (0,5-ms-Klassen, 4 ms geglättet), jeder Schlag mit gleichem Gewicht
    rand = float(np.max(halb_nach)) if len(s) else 0.1
    kl = np.arange(-rand, rand + 0.0005, 0.0005)
    prof = np.zeros(len(kl))
    for c in kand:
        for v, g in c:
            prof[int(round((v + rand) / 0.0005))] += g
    ker = np.exp(-0.5 * (np.arange(-16, 17) / 4.0) ** 2)
    prof = np.convolve(prof, ker / ker.sum(), "same")
    roh = np.full(len(s), np.nan)
    if prof.max() <= 0:
        return (roh, {"lage_ms": None, "gipfel_ms": [], "mehrdeutig": False}) if mit_lage else roh
    gi = [j for j in range(1, len(prof) - 1) if prof[j] >= GIPFEL * prof.max() and prof[j] == prof[max(0, j - 8):j + 9].max()] or [int(np.argmax(prof))]
    ziel = 0.0 if lage_ms is None else lage_ms / 1000.0
    lage = kl[min(gi, key=lambda j: abs(kl[j] - ziel))]
    info = {"lage_ms": round(float(lage) * 1000, 2), "gipfel_ms": [round(float(kl[j]) * 1000, 2) for j in gi],
            "mehrdeutig": any(0 < abs(kl[j] - lage) <= MEHRDEUTIG for j in gi)}
    for i, c in enumerate(kand):
        nah = [(abs(v - lage), v) for v, g in c if abs(v - lage) <= FANG]
        if nah:
            roh[i] = s[i] + min(nah)[1]
    ok = gipfel > 0
    if ok.any():
        roh[gipfel < DA * np.median(gipfel[ok])] = np.nan
    return (roh, info) if mit_lage else roh


ANSCHLAG_HP = 1500.0        # Hz: der Klick des Kicks, über dem Bass
ANSCHLAG_FENSTER = (-0.080, 0.040)   # s um den erwarteten Schlag; Sechzehntel (±117 ms bei 128) liegen draußen
ANSCHLAG_RUHE = (-0.120, -0.060)     # s: Grundpegel davor
ANSCHLAG_DA = 3.0           # Gipfel im Fenster mindestens so oft über dem Grundpegel, sonst NaN


def _hp_huelle(x_mono):
    x = np.asarray(x_mono, dtype=float)
    hp = signal.sosfiltfilt(signal.butter(4, ANSCHLAG_HP, "highpass", fs=fa.SR, output="sos"), x)
    w = int(0.001 * fa.SR)
    env = np.convolve(np.abs(hp), np.ones(w) / w, "same")
    return np.convolve(env, np.ones(w) / w, "same")


VERSATZ_SUCHE = 0.040       # s: so weit sucht die Korrelation den Versatz je Schlag


def versatz(x_export, raster_s, x_quelle, karte_s):
    """Versatz (ms) des Exports gegen die Quelle je Schlag, NaN ohne Anschlag in der Quelle: Hochpass-Hüllkurve des Exports um den Rasterschlag
    gegen die der Quelle um den Kartenschlag, Quelle auf das örtliche Tempo des Exports gedehnt, Kreuzkorrelation ±40 ms, parabolisch verfeinert.
    Warum keine Ereigniswahl: Funk Phenomena (99f5717e) hat je Schlag Hochton-Spitzen bei −10, 0 und +13 ms; welche am steilsten steigt, kippt
    durch den Warp, und der Vergleich zweier gewählter Ereignisse lag dort bei p90 21 ms trotz treuem Warp (Median 0,1 ms, gemessen 2026-10-29)."""
    st = fa.SR // TAKT
    eq, ex = _hp_huelle(x_quelle)[::st], _hp_huelle(x_export)[::st]
    r, k = np.asarray(raster_s, dtype=float), np.asarray(karte_s, dtype=float)
    t_rel = np.arange(int(ANSCHLAG_FENSTER[0] * TAKT), int(ANSCHLAG_FENSTER[1] * TAKT)) / TAKT
    L = int(VERSATZ_SUCHE * TAKT)
    out = np.full(len(r), np.nan)
    for i in range(len(r)):
        j0, j1 = max(0, i - 1), min(len(r) - 1, i + 1)
        dehn = (k[j1] - k[j0]) / (r[j1] - r[j0]) if j1 > j0 else 1.0
        iq = np.rint((k[i] + t_rel * dehn) * TAKT).astype(int)
        ra, rz = int(round((k[i] + ANSCHLAG_RUHE[0]) * TAKT)), int(round((k[i] + ANSCHLAG_RUHE[1]) * TAKT))
        a = int(round((r[i] + t_rel[0]) * TAKT)) - L
        z = a + len(t_rel) + 2 * L
        if ra < 0 or iq[-1] >= len(eq) or a < 0 or z > len(ex):
            continue
        q = eq[iq]
        if q.max() < ANSCHLAG_DA * (np.median(eq[ra:rz]) + 1e-12):
            continue
        e = ex[a:z]
        c = np.correlate(e - e.mean(), q - q.mean(), "valid")
        m = int(np.argmax(c))
        if not 0 < m < len(c) - 1:
            continue                                  # am Rand der Suche: kein Gipfel gefunden, kein Versatz von 40 ms
        y0, y1, y2 = c[m - 1], c[m], c[m + 1]
        d = y0 - 2 * y1 + y2
        out[i] = (m + (0.5 * (y0 - y2) / d if d != 0 else 0.0) - L) / TAKT * 1000.0
    return out


def anschlaege(x_mono, schlaege_s):
    """Anschlag (Sekunden) je erwartetem Schlag, NaN ohne Anschlag: steilster Anstieg der Hochpass-Hüllkurve (1,5 kHz, 1 ms).
    Warum neben einsaetze: an Queen of Pain (4282cd99) fand der Körper-Messer je Schlag zwei Gipfel (mehrdeutig) und sah die um 20 ms verschobene
    Fassung r1 im AK18-Fenster als ok (Median +1,5 ms); der Anschlag lag dort über 20 Abschnitte bei −19,9 ms mit IQR ~1 ms (gemessen 2026-10-29)."""
    x = np.asarray(x_mono, dtype=float)
    hp = signal.sosfiltfilt(signal.butter(4, ANSCHLAG_HP, "highpass", fs=fa.SR, output="sos"), x)
    w = int(0.001 * fa.SR)
    env = np.convolve(np.abs(hp), np.ones(w) / w, "same")
    env = np.convolve(env, np.ones(w) / w, "same")
    out = np.full(len(schlaege_s), np.nan)
    for i, b in enumerate(np.asarray(schlaege_s, dtype=float)):
        c = int(round(b * fa.SR))
        a, z = c + int(ANSCHLAG_FENSTER[0] * fa.SR), c + int(ANSCHLAG_FENSTER[1] * fa.SR)
        ra, rz = c + int(ANSCHLAG_RUHE[0] * fa.SR), c + int(ANSCHLAG_RUHE[1] * fa.SR)
        if ra < 0 or z + 1 > len(env):
            continue
        seg = env[a:z]
        if seg.max() < ANSCHLAG_DA * (np.median(env[ra:rz]) + 1e-12):
            continue
        out[i] = (a + int(np.argmax(np.diff(seg))) + 0.5) / fa.SR
    return out


def rest_ms(einsatz_s, schlaege_s):
    return (np.asarray(einsatz_s) - np.asarray(schlaege_s)) * 1000.0


def vergleich(x_export, raster_s, x_quelle, karte_s, tor_ms=TOR_MS, min_paare=MIN_PAARE, art="anschlag"):
    """{ok, wert_ms, grenze_ms, paare, schlaege, median_ms, quelle_p90_ms, export_p90_ms, art}: wert = p90 |Versatz Export gegen Quelle| je Schlag.
    art "anschlag" (Vorgabe seit 2026-10-29): Versatz aus versatz(), quelle/export_p90 sind die Anschläge (anschlaege) gegen Karte und Raster, nur Auskunft.
    art "koerper": Rest des Exports gegen das Raster minus Rest der Quelle gegen die Karte, beide mit einsaetze (Bass-Körper 30 bis 200 Hz)."""
    if art == "anschlag":
        dd = versatz(x_export, raster_s, x_quelle, karte_s)
        rq = rest_ms(anschlaege(x_quelle, karte_s), karte_s)
        rx = rest_ms(anschlaege(x_export, raster_s), raster_s)
        iq = {"lage_ms": None, "mehrdeutig": False}
    elif art == "koerper":
        eq, iq = einsaetze(x_quelle, karte_s, mit_lage=True)
        rq = rest_ms(eq, karte_s)
        # Der Export sucht den Kick, wo die Quelle ihn hatte: bei zwei Gipfeln würde „nächster zur Null“ sonst einen Warp-Versatz wegwählen
        rx = rest_ms(einsaetze(x_export, raster_s, lage_ms=iq["lage_ms"]), raster_s)
        dd = rx - rq
    else:
        raise ValueError(f"art {art!r}")
    g = np.isfinite(dd)
    n = int(g.sum())
    erg = {"ok": False, "wert_ms": None, "grenze_ms": tor_ms, "paare": n, "schlaege": int(len(dd)), "median_ms": None,
           "quelle_p90_ms": None, "export_p90_ms": None, "kick_lage_quelle_ms": iq["lage_ms"], "mehrdeutig": iq["mehrdeutig"], "art": art}
    if n == 0:
        return erg
    wert = float(np.percentile(np.abs(dd[g]), 90))
    p90 = lambda v: round(float(np.nanpercentile(np.abs(v), 90)), 3) if np.isfinite(v).any() else None
    return {**erg, "ok": bool(n >= min_paare and wert <= tor_ms), "wert_ms": round(wert, 3), "median_ms": round(float(np.median(dd[g])), 3),
            "quelle_p90_ms": p90(rq), "export_p90_ms": p90(rx)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--bpm", type=float, required=True)
    ap.add_argument("--raster-start-s", type=float, default=0.0, help="Zeit von Projekt-Beat --von-beat im Export")
    ap.add_argument("--quelle", required=True)
    ap.add_argument("--material", required=True)
    ap.add_argument("--von-beat", type=int, required=True)
    ap.add_argument("--bis-beat", type=int, required=True)
    ap.add_argument("--art", choices=("anschlag", "koerper"), default="anschlag")
    a = ap.parse_args(argv)
    m = json.load(open(a.material))
    k = np.asarray(m["tempo_karte_quelle"], dtype=float)
    eins = float(m["raster"].get("erste_eins_quell_beat", 0) or 0)
    beats = np.arange(a.von_beat, a.bis_beat)
    karte = np.interp(beats + eins, k[:, 1], k[:, 0])
    raster = a.raster_start_s + (beats - a.von_beat) * 60.0 / a.bpm
    xe = fa.lade(a.export).mean(axis=1)
    xq = fa.lade(a.quelle).mean(axis=1)
    sys.stdout.write(json.dumps(vergleich(xe, raster, xq, karte, art=a.art)) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
