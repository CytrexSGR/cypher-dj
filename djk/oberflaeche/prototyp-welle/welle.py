#!/usr/bin/env python3
"""Prototyp: Wellenform mit drei Frequenzbändern aus einer basis.f32 (stereo verschachtelt, 48 kHz).

Feinste Stufe: eine Spalte je HOP Frames. Je Spalte fünf Bytes: Spitze, Band tief, mittel, hoch (RMS), 0.
Bänder über ein STFT mit Hann-Fenster (N=1024), tief < 200 Hz, mittel 200 Hz–2 kHz, hoch > 2 kHz.
Aufruf: welle.py <basis.f32> <aus.bin>
"""
import sys
import numpy as np

SR, HOP, N = 48000, 256, 1024

x = np.fromfile(sys.argv[1], dtype=np.float32).reshape(-1, 2).mean(axis=1)
spalten = len(x) // HOP
spitze = np.abs(x[: spalten * HOP]).reshape(spalten, HOP).max(axis=1)

pad = np.concatenate([np.zeros(N // 2, np.float32), x, np.zeros(N, np.float32)])
fenster = np.hanning(N).astype(np.float32)
f = np.fft.rfftfreq(N, 1 / SR)
grenzen = [(f < 200), (f >= 200) & (f < 2000), (f >= 2000)]
baender = np.zeros((spalten, 3), np.float32)
BLOCK = 8192
for a in range(0, spalten, BLOCK):
    b = min(spalten, a + BLOCK)
    idx = (np.arange(a, b) * HOP)[:, None] + np.arange(N)[None, :]
    spek = np.abs(np.fft.rfft(pad[idx] * fenster, axis=1)) ** 2
    for k, g in enumerate(grenzen):
        baender[a:b, k] = np.sqrt(spek[:, g].sum(axis=1))

def u8(v, ref):
    return np.clip(np.round(255 * np.sqrt(np.clip(v / ref, 0, 1))), 0, 255).astype(np.uint8)

aus = np.zeros((spalten, 5), np.uint8)
aus[:, 0] = np.clip(np.round(255 * np.minimum(spitze / max(spitze.max(), 1e-9), 1)), 0, 255)
for k in range(3):
    aus[:, 1 + k] = u8(baender[:, k], np.percentile(baender[:, k], 99.5) + 1e-9)
aus.tofile(sys.argv[2])
print(f"{spalten} Spalten zu {HOP} Frames, {aus.nbytes} Bytes")
