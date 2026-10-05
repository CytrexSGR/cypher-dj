#!/usr/bin/env python3
"""Scheiben 10 und 10k: prüft einen Lauf von tests/lauf_kern.sh (echter Kern daneben, Prüfklick je Takt bei 128 BPM).
Aufruf: python3 pruef_kern.py <ordner> -> je Prüfung OK/FEHLT, dann GRÜN/ROT."""
import sys
from pathlib import Path
import numpy as np
from scipy.io import wavfile
O = Path(sys.argv[1])
_, x = wavfile.read(O / 'aufnahme.wav')
L = x[:, 0].astype(np.float64)
pos = np.nonzero(np.abs(L) > 0.25)[0]
on = [int(p) for i, p in enumerate(pos) if i == 0 or p - pos[i - 1] > 1]
zust = [z.split()[1] for z in (O / 'notbahn.log').read_text().splitlines() if z.startswith('zustand')]
ok_alle = True
def pruefe(name, ok, ist):
    global ok_alle
    ok_alle &= bool(ok)
    print('OK   ' if ok else 'FEHLT', name, '| ist', ist)
pruefe('keine NaN', not np.isnan(L).any(), int(np.isnan(L).sum()))
pruefe('Spitze 0,5: Kern und Notbahn klingen nie zugleich', float(np.max(np.abs(L))) <= 0.5 + 1e-6, float(np.max(np.abs(L))))
pruefe('mindestens 12 Takt-Klicks', len(on) >= 12, len(on))
pruefe('jeder Abstand 90000 ±1 (Raster über den Kill hinweg)', all(abs(d - 90000) <= 1 for d in np.diff(on)), sorted(set(np.diff(on).tolist())))
pruefe('Notbahn: Übernahme, Rückgabe, wacht (1, 3, 0)', zust == ['1', '3', '0'], zust)
# Prüfklick: Betonung 0,5 auf der Eins, drei Schläge 0,25; ein Takt sind 90000 Samples
gleich = float(np.max(np.abs(L[on[-1]:on[-1] + 90000] - L[on[-2]:on[-2] + 90000]))) if len(on) >= 2 else None
pruefe('letzter Takt sampleweise gleich dem vorletzten (Schleife)', gleich == 0.0, gleich)
rest = np.nonzero(np.abs(L[on[-1] + 90000:]) > 1e-6)[0] if on else []
pruefe('nach dem letzten Takt Stille (Kern ohne Klick, Schleife aus)', len(rest) == 0, len(rest))
print('GRÜN' if ok_alle else 'ROT'); sys.exit(0 if ok_alle else 1)
