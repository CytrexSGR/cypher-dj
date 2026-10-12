#!/usr/bin/env python3
"""Cypher Komp gegen Faust co.compressor_mono (T −20, R 4, Attack 10 ms, Release 120 ms, hartes Knie):
statische Kennlinie (1-kHz-Sinus, −60..0 dBFS) und Sprungantwort (−40 → 0 → −40 dBFS).
Aufruf: vergleich.py <faust-referenz-programm> <render_raw> <ausgabe.json>"""
import json, subprocess, sys
import numpy as np

FS = 48000
ref, unser, ziel = sys.argv[1:4]
PAR = ["-20", "4", "0", "10", "120"]


def lauf(prog, x):
    st = np.repeat(x.astype("<f4"), 2)  # L = R
    args = [prog] + (PAR if prog == unser else [])
    y = np.frombuffer(subprocess.run(args, input=st.tobytes(), capture_output=True, check=True).stdout, dtype="<f4")
    return y[0::2]


def huelle_db(y, f=1000):
    p = FS // f  # Spitze je Periode
    m = len(y) // p
    return 20 * np.log10(np.maximum(np.abs(y[: m * p]).reshape(m, p).max(axis=1), 1e-9)), p


t = np.arange(FS * 2) / FS
kennlinie = []
for ein in range(-60, 1, 2):
    x = 10 ** (ein / 20) * np.sin(2 * np.pi * 1000 * t)
    a, b = lauf(ref, x), lauf(unser, x)
    sp = lambda y: 20 * np.log10(np.abs(y[-FS // 4:]).max())
    kennlinie.append({"ein": ein, "faust": round(float(sp(a)), 2), "cypher": round(float(sp(b)), 2), "soll": ein if ein < -20 else -20 + (ein + 20) / 4})

# Sprung: 0,5 s −40, 1 s 0 dBFS, 1 s −40
pegel = np.concatenate([np.full(FS // 2, -40.0), np.full(FS, 0.0), np.full(FS, -40.0)])
x = 10 ** (pegel / 20) * np.sin(2 * np.pi * 1000 * np.arange(len(pegel)) / FS)
sprung = {}
for name, prog in (("faust", ref), ("cypher", unser)):
    h, p = huelle_db(lauf(prog, x))
    ein_db = pegel[::p][: len(h)]
    absenkung = ein_db - h  # dB je Periode
    a0, a1 = FS // 2 // p, (FS // 2 + FS) // p
    end = absenkung[a1 - 5]
    att = next(i for i in range(a0, a1) if absenkung[i] >= 0.632 * end) - a0
    rel_start = absenkung[a1 - 1]
    rel = next(i for i in range(a1, len(absenkung)) if absenkung[i] <= 0.368 * rel_start) - a1
    sprung[name] = {"absenkung_end_db": round(float(end), 2), "attack_63_ms": att * p / FS * 1000, "release_37_ms": rel * p / FS * 1000}

abw = float(max(abs(k["faust"] - k["cypher"]) for k in kennlinie))
soll_c = float(max(abs(k["cypher"] - k["soll"]) for k in kennlinie))
soll_f = float(max(abs(k["faust"] - k["soll"]) for k in kennlinie))
erg = {"kennlinie": kennlinie, "max_abweichung_faust_cypher_db": round(abw, 2), "max_abweichung_cypher_soll_db": round(soll_c, 2),
       "max_abweichung_faust_soll_db": round(soll_f, 2), "sprung": sprung}
json.dump(erg, open(ziel, "w"), indent=1)
print(json.dumps({k: v for k, v in erg.items() if k != "kennlinie"}, indent=1))
