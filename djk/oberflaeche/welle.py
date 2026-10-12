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


def rechne_strom(f, rate: int, chunk: int = 1 << 18) -> np.ndarray:
    """Streamend (S5-Review B1): f liefert mono float32 little-endian bei `rate` Hz (ffmpeg -ac 1 -ar rate -f f32le -).

    Konstanter Speicher: je Block werden nur die Spalten gerechnet, deren STFT-Fenster schon da ist; übrig bleiben die letzten
    N Samples und je Spalte 4 Bytes (+ 4 Bytes Rohspitze, normiert wird am Ende). Gleiche Zeitauflösung wie der Dateimodus
    (Hop 64 bei 12 kHz = 256 bei 48 kHz), Fenster entsprechend kürzer (N 256), Bandpegel mit N/n auf den Dateimodus geeicht.
    Das Ergebnis hängt nicht von der Blockgröße ab (Test)."""
    hop, n = rate * HOP // SR, N * rate // SR
    if hop * SR != rate * HOP or n < 16:
        raise ValueError(f"rate {rate}: Hop {HOP} bei {SR} Hz ergibt keinen ganzzahligen Hop")
    skal = N / n                              # Σ|X|² wächst mit n², der RMS also mit n
    fenster = np.hanning(n).astype(np.float32)
    fr = np.fft.rfftfreq(n, 1 / rate)
    grenzen = [(fr < 200), (fr >= 200) & (fr < 2000), (fr >= 2000)]
    buf = np.zeros(n // 2, np.float32)       # pad[base*hop:], pad = n/2 Nullen + x + Nullen
    base, gesamt, rest = 0, 0, b""
    spitzen: list[np.ndarray] = []
    baender: list[np.ndarray] = []

    def spalten_rechnen(anz: int) -> None:
        nonlocal buf, base
        for a in range(0, anz, 4096):
            b = min(anz, a + 4096)
            idx = (np.arange(a, b) * hop)[:, None] + np.arange(n)[None, :]
            spek = np.abs(np.fft.rfft(buf[idx] * fenster, axis=1)) ** 2
            aus = np.zeros((b - a, 3), np.uint8)
            for k, g in enumerate(grenzen):
                rms = np.sqrt(spek[:, g].sum(axis=1)) * skal
                aus[:, k] = np.clip(np.round(255 * np.sqrt(np.clip(rms / REF, 0, 1))), 0, 255)
            baender.append(aus)
            kern = buf[n // 2 + a * hop : n // 2 + b * hop].reshape(b - a, hop)
            spitzen.append(np.abs(kern).max(axis=1))
        buf = buf[anz * hop :]
        base += anz

    while True:
        roh = f.read(chunk * 4)
        if not roh:
            break
        rest += roh
        k = len(rest) // 4 * 4
        blk = np.frombuffer(rest[:k], dtype="<f4")
        rest = rest[k:]
        gesamt += len(blk)
        buf = np.concatenate([buf, blk])
        if len(buf) >= n:
            spalten_rechnen((len(buf) - n) // hop + 1)
    spalten = gesamt // hop
    buf = np.concatenate([buf, np.zeros(n, np.float32)])
    if spalten > base:
        spalten_rechnen(spalten - base)
    aus = np.zeros((spalten, 4), np.uint8)
    if spalten:
        sp = np.concatenate(spitzen)[:spalten]
        aus[:, 0] = np.clip(np.round(255 * sp / max(float(sp.max()), 1e-9)), 0, 255)
        aus[:, 1:] = np.concatenate(baender)[:spalten]
    return aus


def schreibe(w: np.ndarray, ziel: str) -> None:
    tmp = ziel + ".neu"
    with open(tmp, "wb") as d:
        d.write(struct.pack("<4sIII", b"DJKW", 1, HOP, len(w)))
        d.write(w.tobytes())
    os.replace(tmp, ziel)


def main() -> None:
    if sys.argv[1] == "--strom":                  # welle.py --strom RATE ZIEL  (Eingang: stdin)
        schreibe(rechne_strom(sys.stdin.buffer, int(sys.argv[2])), sys.argv[3])
        return
    x = np.fromfile(sys.argv[1], dtype=np.float32).reshape(-1, 2).mean(axis=1)
    w = rechne(x)
    tmp = sys.argv[2] + ".neu"
    with open(tmp, "wb") as d:
        d.write(struct.pack("<4sIII", b"DJKW", 1, HOP, len(w)))
        d.write(w.tobytes())
    os.replace(tmp, sys.argv[2])


if __name__ == "__main__":
    main()
