#!/usr/bin/env python3
"""Ring-Attrappe: schreibt den Hüllkurven-Ring §6.2 aus WAV-Dateien je Kanal, mit den Filtern aus baender.json,
im Echtzeit-Takt (1 000 Datensätze je Sekunde), solange der Kern fehlt (SCHNITTSTELLEN.md §19.0).

  python3 djk/vertrag/attrappe_huellen.py --kanal 0=deck_a.wav --kanal 1=deck_b.wav --sekunden 60
      [--pfad RING] [--bpm 128] [--quell-bpm 128] [--baender baender.json] [--schnell] [--schleife]

Kanal-Nummern nach §6.2: 0 bis 3 deck/1..4, 4 bis 11 erz/1..8, 12 pad/1, 13 pad/2, 14 master, 15 cue. WAV mit 48 kHz,
mono oder stereo, int16/int32/float32. Kanäle ohne WAV bekommen Nullen (§6.2: leere Kanäle schreibt der Kern mit Nullen).
--schnell schreibt so schnell wie möglich (für Tests), sonst im Echtzeit-Takt gegen CLOCK_MONOTONIC.
"""
import argparse
import json
import mmap
import os
import pathlib
import sys
import time

import numpy as np
from scipy import signal
from scipy.io import wavfile

import huellen_ring as hr

HIER = pathlib.Path(__file__).resolve().parent
FENSTER = 48          # Samples je Datensatz (§6.2)
BLOCK_SAETZE = 10     # 10 Datensätze = 480 Samples = 10 ms je Schreibschritt


def lade_wav(pfad):
    rate, x = wavfile.read(pfad)
    if rate != 48000:
        raise SystemExit(f"{pfad}: {rate} Hz, verlangt 48000 (§1.1)")
    if x.dtype.kind == "i":
        x = x.astype(np.float64) / float(np.iinfo(x.dtype).max + 1)
    else:
        x = x.astype(np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    return x[:, :2]


class Kanal:
    def __init__(self, x, baender, k_sos):
        self.x = x
        self.sos = [np.asarray(b["sos"], dtype=np.float64) for b in baender]
        self.k = np.asarray(k_sos, dtype=np.float64)
        self.zi = [np.zeros((s.shape[0], 2, 2)) for s in self.sos]
        self.kzi = np.zeros((self.k.shape[0], 2, 2))

    def block(self, pos, n, schleife):
        idx = np.arange(pos, pos + n)
        if schleife:
            idx %= len(self.x)
        teil = np.zeros((n, 2))
        gueltig = idx < len(self.x)
        teil[gueltig] = self.x[idx[gueltig]]
        saetze = n // FENSTER
        band = np.empty((saetze, 6))
        for i, s in enumerate(self.sos):
            y, self.zi[i] = signal.sosfilt(s, teil, axis=0, zi=self.zi[i])
            band[:, i] = np.sqrt((y.reshape(saetze, FENSTER, 2) ** 2).mean(axis=(1, 2)))
        z, self.kzi = signal.sosfilt(self.k, teil, axis=0, zi=self.kzi)
        k_leistung = (z.reshape(saetze, FENSTER, 2) ** 2).mean(axis=1).sum(axis=1)
        spitze = np.abs(teil).reshape(saetze, FENSTER * 2).max(axis=1)
        return band, k_leistung, spitze


def oeffne_ring(pfad):
    pfad.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(pfad, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        os.ftruncate(fd, hr.GROESSE)
        mm = mmap.mmap(fd, hr.GROESSE)
    finally:
        os.close(fd)
    kopf = np.frombuffer(mm, dtype="<u4", count=4, offset=4)
    w = np.frombuffer(mm, dtype="<u8", count=1, offset=32)
    if bytes(mm[:4]) != hr.MAGIC or tuple(int(v) for v in kopf) != (hr.VERSION, hr.RATE_HZ, hr.N_KANAELE, hr.CAP):
        mm[:hr.KOPF] = b"\0" * hr.KOPF
        mm[:4] = hr.MAGIC
        kopf[:] = (hr.VERSION, hr.RATE_HZ, hr.N_KANAELE, hr.CAP)
        w[0] = 0
    saetze = np.frombuffer(mm, dtype=hr.SATZ, count=hr.CAP * hr.N_KANAELE, offset=hr.KOPF).reshape(hr.CAP, hr.N_KANAELE)
    return mm, w, saetze


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--kanal", action="append", default=[], help="NR=datei.wav")
    ap.add_argument("--sekunden", type=float, default=None)
    ap.add_argument("--pfad", default=None)
    ap.add_argument("--bpm", type=float, default=128.0)
    ap.add_argument("--quell-bpm", type=float, default=None)
    ap.add_argument("--start-sample", type=int, default=0)
    ap.add_argument("--baender", default=str(HIER / "baender.json"))
    ap.add_argument("--schnell", action="store_true")
    ap.add_argument("--schleife", action="store_true")
    a = ap.parse_args(argv)
    baender = json.loads(pathlib.Path(a.baender).read_text(encoding="utf-8"))
    kanaele = {}
    for k in a.kanal:
        nr, _, datei = k.partition("=")
        kanaele[int(nr)] = Kanal(lade_wav(datei), baender["baender"], baender["k_filter"]["sos"])
    laenge = max((len(k.x) for k in kanaele.values()), default=0)
    sekunden = a.sekunden if a.sekunden is not None else laenge / 48000.0
    n_saetze = int(round(sekunden * hr.RATE_HZ))
    pfad = pathlib.Path(a.pfad) if a.pfad else hr.ring_pfad()
    mm, w, saetze = oeffne_ring(pfad)
    r0 = int(w[0])
    spb = 48000.0 * 60.0 / a.bpm
    q_spb = 48000.0 * 60.0 / (a.quell_bpm or a.bpm)
    t0 = time.monotonic()
    geschrieben = 0
    while geschrieben < n_saetze:
        n = min(BLOCK_SAETZE, n_saetze - geschrieben)
        if not a.schnell:
            faellig = t0 + (geschrieben + n) / hr.RATE_HZ
            rest = faellig - time.monotonic()
            if rest > 0:
                time.sleep(rest)
        pos = geschrieben * FENSTER
        ende = pos + np.arange(1, n + 1) * FENSTER - 1           # letztes Sample des Fensters, Datei-Frame
        block = np.zeros((n, hr.N_KANAELE), dtype=hr.SATZ)
        block["sample"] = (a.start_sample + ende)[:, None]
        block["beat"] = ((a.start_sample + ende) / spb)[:, None]
        block["quell_beat"] = np.nan
        for nr, k in kanaele.items():
            band, kl, sp = k.block(pos, n * FENSTER, a.schleife)
            block["band"][:, nr, :] = band
            block["k_leistung"][:, nr] = kl
            block["spitze"][:, nr] = sp
            if nr <= 3:
                block["quell_beat"][:, nr] = ende / q_spb
        for j in range(n):
            r = r0 + geschrieben + j
            saetze[r % hr.CAP] = block[j]
            w[0] = r + 1                                            # erst alle 16 Kanäle, dann w (§6.2)
        geschrieben += n
    dauer = time.monotonic() - t0
    print(f"{geschrieben} Datensätze in {dauer:.3f} s nach {pfad} (w = {int(w[0])}, Kanäle {sorted(kanaele)})")
    mm.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
