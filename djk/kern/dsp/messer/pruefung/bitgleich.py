#!/usr/bin/env python3
"""Negativ-Kontrolle des Limiters: ist der Ausgang der um den Vorhalt verzögerte, verstärkte Eingang, bitgleich?
Aufruf: bitgleich.py <eingang.f32> <ausgang.f32> <verstaerkung_db> <vorhalt_samples>
Die Verstärkung wird wie in messer_limiter_datei als float32 gerechnet (10^(dB/20) in float32, dann mal Sample)."""
import sys

import numpy as np

ein = np.fromfile(sys.argv[1], dtype="<f4").reshape(-1, 2)
aus = np.fromfile(sys.argv[2], dtype="<f4").reshape(-1, 2)
g = np.float32(10.0 ** (float(sys.argv[3]) / 20.0))
d = int(sys.argv[4])
erwartet = ein * g
gleich = np.array_equal(aus[d:], erwartet[:-d]) and not aus[:d].any()
abw = int((aus[d:] != erwartet[:-d]).sum())
print(f"vorhalt {d} bitgleich {'ja' if gleich else 'nein'} abweichende_samples {abw}")
sys.exit(0 if gleich else 1)
