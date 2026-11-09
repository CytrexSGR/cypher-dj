"""Gemeinsame Helfer der Kettentests: kurzer synthetischer Klick mit bekannter Wahrheit, sha256 je Datei."""
import hashlib

import numpy as np
import soundfile as sf

SR = 48000


def klick(pfad, dauer_s=24.0, bpm=134.0, start=0.25):
    """1-kHz-Klick wie proben/07 b_timemap.py `klicktrack`; Rueckgabe: Schlagzeiten in s."""
    n = int(dauer_s * SR)
    x = np.zeros(n)
    L = int(0.060 * SR)
    t = np.arange(L) / SR
    burst = 0.7 * np.sin(2 * np.pi * 1000 * t) * np.minimum(1, t / 0.002) * np.exp(-t / 0.030)
    schlaege = start + np.arange(int(dauer_s * bpm / 60)) * 60.0 / bpm
    schlaege = schlaege[np.rint(schlaege * SR).astype(int) + L < n]
    for s in schlaege:
        a = int(round(s * SR))
        x[a:a + L] += burst
    sf.write(str(pfad), np.stack([x, x], 1).astype(np.float32), SR, subtype="FLOAT")
    return schlaege


def sha_baum(ordner):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ordner.iterdir()) if p.is_file()}
