"""Hüllkurven-Ring /dev/shm/cypherdj/huellen, Version 1 (SCHNITTSTELLEN.md §6.2): Layout, Pfad, Leser.

Kopf 64 Bytes: char[4] magic "CDJH"; uint32 version 1; uint32 rate_hz 1000; uint32 n_kanaele 16; uint32 cap 16384;
uint32 reserve[3]; _Atomic uint64 w (Datensätze je Kanal); uint8 reserve[24]. Datensatz 64 Bytes: int64 sample;
float64 beat; float64 quell_beat; float32 band[6]; float32 k_leistung; float32 spitze; float32 reserve[2].
Datensatz r von Kanal c bei 64 + ((r % cap)·16 + c)·64. Little Endian.
"""
import mmap
import os
import pathlib

import numpy as np

MAGIC = b"CDJH"
VERSION, RATE_HZ, N_KANAELE, CAP = 1, 1000, 16, 16384
KOPF = 64
SATZ = np.dtype([("sample", "<i8"), ("beat", "<f8"), ("quell_beat", "<f8"), ("band", "<f4", (6,)),
                 ("k_leistung", "<f4"), ("spitze", "<f4"), ("reserve", "<f4", (2,))])
assert SATZ.itemsize == 64
GROESSE = KOPF + CAP * N_KANAELE * SATZ.itemsize
KANAELE = [f"deck/{i}" for i in range(1, 5)] + [f"erz/{i}" for i in range(1, 9)] + ["pad/1", "pad/2", "master", "cue"]
VERWERF_ABSTAND = 1024   # Leser verwerfen Datensätze älter als w − cap + 1024


def ring_pfad():
    """§6.2 mit ROADMAP Z2: bei gesetztem CYPHERDJ_INSTANZ wird cypherdj/ zu cypherdj-<instanz>/."""
    inst = os.environ.get("CYPHERDJ_INSTANZ", "")
    return pathlib.Path("/dev/shm") / (f"cypherdj-{inst}" if inst else "cypherdj") / "huellen"


class HuellenLeser:
    def __init__(self, pfad=None):
        self.pfad = pathlib.Path(pfad or ring_pfad())
        fd = os.open(self.pfad, os.O_RDONLY)
        try:
            self.mm = mmap.mmap(fd, GROESSE, prot=mmap.PROT_READ)
        finally:
            os.close(fd)
        kopf = np.frombuffer(self.mm, dtype="<u4", count=4, offset=4)
        if bytes(self.mm[:4]) != MAGIC or tuple(int(x) for x in kopf) != (VERSION, RATE_HZ, N_KANAELE, CAP):
            raise ValueError(f"{self.pfad}: Kopf {bytes(self.mm[:4])!r} {tuple(kopf)} passt nicht zu §6.2")
        self._w = np.frombuffer(self.mm, dtype="<u8", count=1, offset=32)
        self.saetze = np.frombuffer(self.mm, dtype=SATZ, count=CAP * N_KANAELE, offset=KOPF).reshape(CAP, N_KANAELE)

    def w(self):
        return int(self._w[0])

    def lies(self, r):
        """Alle 16 Kanäle von Datensatz r, oder None, wenn r noch nicht geschrieben oder zu alt ist."""
        w = self.w()
        if r >= w or r < w - CAP + VERWERF_ABSTAND:
            return None
        satz = self.saetze[r % CAP].copy()
        return satz if self.w() - CAP + VERWERF_ABSTAND <= r else None
