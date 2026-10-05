#!/usr/bin/env python3
"""Wellenform-Daten für die Seite (Plan 2026-09-27-djk-oberflaeche-welle, Spec E4).

Eingang: f32 stereo verschachtelt, 48 kHz (basis.f32 einer Fassung, loop.f32 eines Loops).
Ausgang: Kopf <4sIII> = b"DJKW", Version 1, HOP, Spalten; danach je Spalte 4 Bytes:
  Spitze (|x| max, linear), Band tief < 200 Hz, mittel 200 Hz–2 kHz, hoch > 2 kHz (RMS aus einem STFT, N=1024, Hann).
Normierung: Spitze je Datei auf ihr Maximum (Fassungen tragen −12 dB Headroom, fest normiert nutzte Antistius nur
87/255 der Höhe, Review 2026-09-27); Band-RMS über die Wurzel-Kurve mit Referenz REF (gemessen am Prototyp: Antistius
p99,5 der Bänder liegt zwischen 40 und 120). Aufruf: welle.py <quelle.f32> <ziel.welle>
"""
import os
import struct
import sys

import numpy as np

SR, HOP, N, REF = 48000, 256, 1024, 120.0


def rechne(x: np.ndarray) -> np.ndarray:
    spalten = len(x) // HOP
    aus = np.zeros((spalten, 4), np.uint8)
    if spalten == 0:
        return aus
    spitze = np.abs(x[: spalten * HOP]).reshape(spalten, HOP).max(axis=1)
    aus[:, 0] = np.clip(np.round(255 * spitze / max(float(spitze.max()), 1e-9)), 0, 255)
    pad = np.concatenate([np.zeros(N // 2, np.float32), x, np.zeros(N, np.float32)])
    fenster = np.hanning(N).astype(np.float32)
    f = np.fft.rfftfreq(N, 1 / SR)
    grenzen = [(f < 200), (f >= 200) & (f < 2000), (f >= 2000)]
    for a in range(0, spalten, 8192):
        b = min(spalten, a + 8192)
        idx = (np.arange(a, b) * HOP)[:, None] + np.arange(N)[None, :]
        spek = np.abs(np.fft.rfft(pad[idx] * fenster, axis=1)) ** 2
        for k, g in enumerate(grenzen):
            rms = np.sqrt(spek[:, g].sum(axis=1))
            aus[a:b, 1 + k] = np.clip(np.round(255 * np.sqrt(np.clip(rms / REF, 0, 1))), 0, 255)
    return aus


def main() -> None:
    x = np.fromfile(sys.argv[1], dtype=np.float32).reshape(-1, 2).mean(axis=1)
    w = rechne(x)
    tmp = sys.argv[2] + ".neu"
    with open(tmp, "wb") as d:
        d.write(struct.pack("<4sIII", b"DJKW", 1, HOP, len(w)))
        d.write(w.tobytes())
    os.replace(tmp, sys.argv[2])


if __name__ == "__main__":
    main()
