#!/usr/bin/env python3
"""Measures the echo in the exports of end_to_end_bk.mjs (arr-bk slice 4). Usage: end_to_end_bk_measure.py out.json

Cases: a120 dry only, b120 delay return with send 0 dB, c120 send -12 dB, d120 send 0 dB with a Level lane 0 -> 1 over the four beats,
d90 the same at tempo 90 (one dotted eighth = 0.75 beat). Checks: the first echo sits at 0.75 beat after the hit (+-2 samples) in the left
channel, the second in the right (ping-pong), the -12 dB send gives an echo at 0.251 of the 0 dB one, and the lane scales the first echo by
the lane value at that moment (the Level knob maps 0..1 to 0..2, so the static 0.5 is gain 1)."""
import json
import subprocess
import sys

import numpy as np


def lade(pfad):
    roh = subprocess.run(['ffmpeg', '-v', 'error', '-i', pfad, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(roh, dtype='<f4').reshape(-1, 2)


def hoechster(x, von, bis):
    f = np.abs(x[von:bis])
    i = int(np.argmax(f))
    return von + i, float(f[i])


def main():
    d = json.load(open(sys.argv[1]))['dateien']
    w = {k: lade(v) for k, v in d.items()}
    rc = 0

    def pruef(ok, was):
        nonlocal rc
        print(('OK   ' if ok else 'FAIL ') + was)
        rc |= 0 if ok else 1

    a = w['a120']
    t0 = int(np.argmax(np.abs(a[:, 0]) + np.abs(a[:, 1])))
    print(f'hit at sample {t0}, dry peak L {np.abs(a[:, 0]).max():.4f} R {np.abs(a[:, 1]).max():.4f}')
    for fall, bpm in (('b120', 120), ('c120', 120), ('d120', 120), ('d90', 90)):
        x = w[fall]
        T = round(0.75 * 60.0 / bpm * 48000)
        t = int(np.argmax(np.abs(x[:3000, 0]) + np.abs(x[:3000, 1])))
        il, pl = hoechster(x[:, 0], t + 3000, t + T + T // 2)
        ir, pr = hoechster(x[:, 1], t + T + T // 2, t + 2 * T + T // 2)
        il_r, pl_r = hoechster(x[:, 1], t + 3000, t + T + T // 2)
        print(f'{fall}: T {T}; first echo L at +{il - t} ({pl:.4f}), R in the same window {pl_r:.5f}; second echo R at +{ir - t} ({pr:.4f})')
        pruef(abs((il - t) - T) <= 2, f'{fall}: first echo (left) at 0.75 beat = {T} samples, measured {il - t}')
        pruef(abs((ir - t) - 2 * T) <= 2, f'{fall}: second echo (right) at {2 * T} samples, measured {ir - t}')
        pruef(pl_r < 0.01 * pl, f'{fall}: ping-pong, the right channel is silent at the first echo ({pl_r:.5f} against {pl:.4f})')
    # dry part unchanged by the return: the first 2500 samples of b120 equal a120
    pruef(np.allclose(w['b120'][:2500], a[:2500], atol=1e-6), 'b120: the dry hit is the same as without the return (the graph is wet only)')
    e_b = hoechster(w['b120'][:, 0], t0 + 3000, t0 + 27000)[1]
    e_c = hoechster(w['c120'][:, 0], t0 + 3000, t0 + 27000)[1]
    pruef(abs(e_c / e_b - 10 ** (-12 / 20)) < 0.01, f'send -12 dB: echo {e_c:.4f} against {e_b:.4f} at 0 dB = {e_c / e_b:.4f} (expected 0.2512)')
    e_d = hoechster(w['d120'][:, 0], t0 + 3000, t0 + 27000)[1]
    lane = (0.75 / 4.0)   # lane value at the first echo (0 -> 1 over four beats), Level = 2 * lane against 1.0 at 0.5
    pruef(abs(e_d / e_b - 2 * lane) < 0.05, f'Level lane: first echo {e_d:.4f} against the static {e_b:.4f} = {e_d / e_b:.3f} (expected {2 * lane:.3f})')
    sys.exit(rc)


main()
