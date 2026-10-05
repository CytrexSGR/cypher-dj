#!/usr/bin/env python3
"""Erzeugt djk/vertrag/baender.json: Koeffizienten der sechs Analyse-Bänder (SCHNITTSTELLEN §6.2) und des
K-Filters (BS.1770-4, 48 kHz) als Biquad-Kaskaden (scipy-SOS-Zeilen b0 b1 b2 a0 a1 a2, a0 = 1).

Vertrag §6.2: je Band ein Bandpass aus zwei Butterworth-Filtern vierter Ordnung (Hochpass an der unteren,
Tiefpass an der oberen Grenze), kausal, als Biquad-Kaskade. Die Zahlen stehen als float64 mit repr-Genauigkeit
(17 signifikante Stellen), damit Kern, Werkstatt und Ring-Attrappe aus derselben Tabelle bitgleich rechnen.

Aufruf: python3 djk/vertrag/erzeuge_baender.py   (schreibt baender.json neben dieses Skript)
"""
import json
import pathlib
import sys

import numpy as np
from scipy import signal

SR = 48000
ORDNUNG = 4
# §6.2 wörtlich: Sub 30 bis 90, Tief 90 bis 250, Tiefmitte 250 bis 800, Mitte 800 bis 2000,
# Präsenz 2000 bis 6000, Hoch 6000 bis 16000 Hz
BAENDER = [("sub", 30.0, 90.0), ("tief", 90.0, 250.0), ("tiefmitte", 250.0, 800.0),
           ("mitte", 800.0, 2000.0), ("praesenz", 2000.0, 6000.0), ("hoch", 6000.0, 16000.0)]
# ITU-R BS.1770-4 Tabelle 1 und 2 (48 kHz), wörtlich wie proben/08-analyse-passung/fa.py K_SOS
K_SOS = [[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
         [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]]


def band_sos(lo, hi):
    hp = signal.butter(ORDNUNG, lo, btype="highpass", fs=SR, output="sos")
    tp = signal.butter(ORDNUNG, hi, btype="lowpass", fs=SR, output="sos")
    return np.vstack([hp, tp])


def baue():
    return {
        "version": 1,
        "rate_hz": SR,
        "quelle": "SCHNITTSTELLEN.md §6.2; erzeugt von djk/vertrag/erzeuge_baender.py mit scipy "
                  + __import__("scipy").__version__ + " (signal.butter, output='sos', fs=48000)",
        "form": "sos: je Zeile b0 b1 b2 a0 a1 a2 (a0 = 1), Zeilen nacheinander angewandt (Kaskade), "
                "Direktform II transponiert wie scipy.signal.sosfilt",
        "fenster_samples": 48,
        "rms": "band[i] = sqrt(Summe über 48 Samples und alle Kanäle von y_i^2 / (48 * Kanalzahl)), y_i = Bandfilter i "
               "angewandt auf jeden Kanal getrennt, Filterzustand läuft über die Fenster weiter",
        "k_leistung": "Summe über die Kanäle von (Summe über 48 Samples von z^2 / 48), z = K-Filter je Kanal "
                      "(BS.1770: Kanalgewicht 1 für L und R)",
        "spitze": "Betragsmaximum des ungefilterten Signals über 48 Samples und alle Kanäle",
        "baender": [{"index": i, "name": n, "unten_hz": lo, "oben_hz": hi,
                     "hochpass": {"ordnung": ORDNUNG, "grenze_hz": lo}, "tiefpass": {"ordnung": ORDNUNG, "grenze_hz": hi},
                     "sos": [[float(v) for v in zeile] for zeile in band_sos(lo, hi)]}
                    for i, (n, lo, hi) in enumerate(BAENDER)],
        "k_filter": {"quelle": "ITU-R BS.1770-4 (48 kHz), Stufe 1 Shelf, Stufe 2 RLB-Hochpass", "sos": K_SOS},
    }


def main():
    ziel = pathlib.Path(__file__).resolve().parent / "baender.json"
    daten = baue()
    ziel.write_text(json.dumps(daten, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{ziel}: {len(daten['baender'])} Bänder, je {len(daten['baender'][0]['sos'])} Biquads")
    return 0


if __name__ == "__main__":
    sys.exit(main())
