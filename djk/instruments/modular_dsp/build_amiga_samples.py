#!/usr/bin/env python3
"""Writes the factory sample bank of the `amiga` device (raw 48 kHz-style stereo float32, mono data in both channels).

    python3 build_amiga_samples.py [DIR]      DIR defaults to ~/.config/cypherdj/baukasten/samples

Four files: amiga-quadrat.f32 (one 32-frame square cycle), amiga-dreieck.f32 (triangle cycle), amiga-saege.f32 (saw cycle), all
meant to loop, and amiga-rauschen.f32 (a 4096-frame burst of the NES 15-bit shift register with a quadratically falling amplitude).
The values are 8-bit integers divided by 128, pure integer arithmetic, so `baukasten_dsp::proben::amiga_werk` produces the same
bytes (tests/amiga_werk.rs compares them). The data rate (8372 Hz = 32 frames at middle C) is a property of the bank slots in
demos/amiga.json, not of the files.
"""
import os
import struct
import sys

N_RAUSCHEN = 4096


def stereo(werte):
    return b"".join(struct.pack("<ff", v / 128.0, v / 128.0) for v in werte)


def quadrat():
    return [93 if i < 16 else -93 for i in range(32)]


def dreieck():
    return [-90 + 12 * (i if i < 16 else 31 - i) for i in range(32)]


def saege():
    return [-93 + 6 * i for i in range(32)]


def rauschen():
    reg, aus = 1, []
    for i in range(N_RAUSCHEN):
        a = 110 * (N_RAUSCHEN - i) * (N_RAUSCHEN - i) // (N_RAUSCHEN * N_RAUSCHEN)
        aus.append(-a if reg & 1 else a)
        reg = (reg >> 1) | (((reg ^ (reg >> 1)) & 1) << 14)
    return aus


DATEIEN = [("amiga-quadrat.f32", quadrat), ("amiga-dreieck.f32", dreieck), ("amiga-saege.f32", saege), ("amiga-rauschen.f32", rauschen)]


def schreibe(ziel):
    os.makedirs(ziel, exist_ok=True)
    for name, f in DATEIEN:
        with open(os.path.join(ziel, name), "wb") as d:
            d.write(stereo(f()))
        print(os.path.join(ziel, name))


if __name__ == "__main__":
    schreibe(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.config/cypherdj/baukasten/samples"))
