#!/usr/bin/env python3
"""Unabhängige Gegenprobe der Echtspitze: 8-fach überabgetastet mit scipy.signal.resample_poly
(Kaiser-Fenster, anderer Filter als der 4-fach-Interpolator von libebur128 und Limiter).
Aufruf: echtspitze.py <datei.f32> [ab_sekunde]   (float32 LE Stereo 48 kHz)
Ausgabe: abtastspitze_dbfs, echtspitze8_dbtp. Stücke zu 10 s mit 1 s Überlappung (Randeffekte
des Filters fallen in die Überlappung und werden verworfen)."""
import sys

import numpy as np
from scipy import signal

x = np.fromfile(sys.argv[1], dtype="<f4").reshape(-1, 2).astype(np.float64)
ab = int(float(sys.argv[2]) * 48000) if len(sys.argv) > 2 else 0
x = x[ab:]
stueck, rand = 480000, 48000
spitze8 = 0.0
for anfang in range(0, len(x), stueck):
    a0 = max(0, anfang - rand)
    a1 = min(len(x), anfang + stueck + rand)
    y = signal.resample_poly(x[a0:a1], 8, 1, axis=0)
    lo = (anfang - a0) * 8
    hi = lo + (min(anfang + stueck, len(x)) - anfang) * 8
    spitze8 = max(spitze8, float(np.abs(y[lo:hi]).max()))
abtast = float(np.abs(x).max())
db = lambda v: 20 * np.log10(v) if v > 0 else -200.0
print(f"abtastspitze_dbfs {db(abtast):.3f} echtspitze8_dbtp {db(spitze8):.3f}")
