#!/usr/bin/env python3
"""Compares the live recording with the offline export of end_to_end_bk_live.mjs (arr-bk slice 4). Usage: end_to_end_bk_live_measure.py <out folder>

The live file starts at an unknown moment, so both are aligned on the first hit; checked: the echo sits at 0.75 beat (18000 samples at 120 BPM) in both,
the echo level relative to the dry hit is the same within 0.5 dB, and the ping-pong second echo is on the right channel in both."""
import subprocess
import sys

import numpy as np


def lade(pfad):
    roh = subprocess.run(['ffmpeg', '-v', 'error', '-i', pfad, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(roh, dtype='<f4').reshape(-1, 2)


def messe(x):
    a = np.abs(x)
    summe = a.sum(axis=1)
    t0 = int(np.argmax(summe > 0.5 * summe.max()))           # the first hit of the file (the live file may hold a second pass of the loop)
    t = t0 + int(np.argmax(a[t0: t0 + 200, 0]))               # aligned on the peak sample of the dry hit, left channel
    dry = float(a[t, 0])
    f1 = a[t + 17000: t + 19000, 0]
    e1 = float(f1.max())
    i1 = t + 17000 + int(np.argmax(f1))
    f2 = a[t + 35000: t + 37000, 1]
    i2 = t + 35000 + int(np.argmax(f2))
    return t, dry, e1, i1 - t, i2 - t, float(a[t + 17000: t + 19000, 1].max())


def main():
    ordner = sys.argv[1]
    rc = 0
    erg = {}
    for name in ('export', 'live'):
        x = lade(f'{ordner}/{name}.wav')
        t, dry, e1, l1, l2, r1 = messe(x)
        erg[name] = (dry, e1, l1, l2, r1)
        print(f'{name}: hit at {t}, dry {dry:.4f}, first echo (left) {e1:.4f} at +{l1}, right channel at the first echo {r1:.5f}, second echo (right) at +{l2}')
    d_e, d_l = erg['export'], erg['live']
    for was, ok in (('echo at 18000 samples in both', abs(d_e[2] - 18000) <= 2 and abs(d_l[2] - 18000) <= 2),
                    ('second echo at 36000 samples in both', abs(d_e[3] - 36000) <= 2 and abs(d_l[3] - 36000) <= 2),
                    ('ping-pong in both (right channel silent at the first echo)', d_e[4] < 0.01 * d_e[1] and d_l[4] < 0.01 * d_l[1]),
                    ('echo to dry level within 0.5 dB', abs(20 * np.log10((d_l[1] / d_l[0]) / (d_e[1] / d_e[0]))) < 0.5)):
        print(('OK   ' if ok else 'FAIL ') + was)
        rc |= 0 if ok else 1
    sys.exit(rc)


main()
