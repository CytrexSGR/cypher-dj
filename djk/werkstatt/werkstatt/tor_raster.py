"""Paket 1.13 Warp, Slice 3a (AK18): das Tor „raster“ am gerenderten Ergebnis (SCHNITTSTELLEN.md:1128-1132, Form :1224).

Verfahren: unabhängig vom Raster-Werkzeug der Werkstatt (nicht beat_this) werden im Tief-Band (30 bis 250 Hz) die Anschläge des Renders gesucht
(fa.onsets_band: Hilbert-Hüllkurve, 50-%-Punkt, Zeitauflösung 1 ms), gemessen wird ihr Rest gegen ein STARRES Raster der Projekt-BPM; die Phase kommt per Kreismittel
aus den stärkeren Anschlägen (wie proben/07-werkstatt-zerleger/messwerk.py raster_rest). Es zählen die stärkere Hälfte (Kicks, nicht die Bassnoten dazwischen) und nur
Anschläge innerhalb ±Periode/8 des Rasters („auf dem Schlag“). Ok = mindestens 64 solche Anschläge und p90 des Betrags ≤ 8 ms (kette.py TOR_RASTER_MS).
Aufruf: python -m werkstatt.tor_raster --wav DATEI --bpm 128 [--von-s S] [--bis-s S]   (stdout: genau eine JSON-Zeile)"""
import argparse
import json
import sys

import numpy as np

from . import fa

TOR_RASTER_MS = 8.0   # kette.py:35
MIN_ANSCHLAEGE = 64
BAND = (30, 250)      # fa.ONSET_BAENDER „tief“


def _phase(t, periode):
    return float(np.angle(np.exp(2j * np.pi * t / periode).mean()) / (2 * np.pi) * periode)


def _rest_ms(t, periode, phase):
    k = np.round((t - phase) / periode)
    return (t - (phase + k * periode)) * 1000.0


def messe(x_mono, bpm, tor_ms=TOR_RASTER_MS, min_anschlaege=MIN_ANSCHLAEGE):
    """{ok, wert_ms, grenze_ms, anschlaege, kandidaten}: kandidaten = alle Tief-Band-Anschläge, anschlaege = die gezählten (stark und auf dem Schlag)."""
    leer = {"ok": False, "wert_ms": None, "grenze_ms": tor_ms, "anschlaege": 0, "kandidaten": 0}
    erg = fa.onsets_band(np.asarray(x_mono, dtype=float), BAND[0], BAND[1], zyklisch=False, mit_staerke=True)
    if not isinstance(erg, tuple) or len(erg[0]) < 2:
        return leer
    t, st = erg
    periode = 60.0 / bpm
    # stark: die Anschläge, aus denen die Phase kommt (Kicks, nicht die leiseren Bassnoten dazwischen). Relativ zu den lautesten (p90), nicht zum
    # Median: der Median wirft bei gleich lauten Kicks die Hälfte nach Rundungsrauschen weg (Eichung Task 17/18: 50 statt 100 Anschläge).
    stark = st >= 0.5 * np.percentile(st, 90)
    if stark.sum() < 2:
        return {**leer, "kandidaten": int(len(t))}
    phase = _phase(t[stark], periode)
    rest = _rest_ms(t, periode, phase)
    gezaehlt = stark & (np.abs(rest) <= 1000.0 * periode / 8.0)
    n = int(gezaehlt.sum())
    if n == 0:
        return {**leer, "kandidaten": int(len(t))}
    wert = float(np.percentile(np.abs(rest[gezaehlt]), 90))
    return {"ok": bool(n >= min_anschlaege and wert <= tor_ms), "wert_ms": round(wert, 3), "grenze_ms": tor_ms, "anschlaege": n, "kandidaten": int(len(t))}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--bpm", type=float, required=True)
    ap.add_argument("--von-s", type=float, default=None)
    ap.add_argument("--bis-s", type=float, default=None)
    a = ap.parse_args(argv)
    x = fa.lade(a.wav).mean(axis=1)
    von = 0 if a.von_s is None else int(a.von_s * fa.SR)
    bis = len(x) if a.bis_s is None else int(a.bis_s * fa.SR)
    sys.stdout.write(json.dumps(messe(x[von:bis], a.bpm)) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
