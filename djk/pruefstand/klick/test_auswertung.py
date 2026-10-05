#!/usr/bin/env python3
"""Prüft das Messinstrument (auswertung.py) an synthetischen Läufen mit bekannter Wahrheit, bevor es über den Kern
urteilt: richtige Einsätze grün, ein Sample daneben rot, Klick auf den Blockanfang rot mit Streuung 252,
Aufnehmer-Lücke, fehlendes /uhr, fremder Treiber (eigene Senke in pw-top mit „+“) und ein doppelter Kern-Knoten
unbrauchbar, eine pw-top-Zeile ohne Messwerte dagegen nicht (grün), Stille bei 0 erwarteten Klicks grün, ein Klick
dann rot.
Aufruf: python3 test_auswertung.py   Rückgabe 0, wenn alle Fälle das erwartete Urteil bekommen.
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile

HIER = os.path.dirname(os.path.abspath(__file__))
SPB = 22500  # 128 BPM
K0 = 14336   # Kern-Sample bei Aufnahme-Frame 0
V = 512      # Versatz Kern -> Aufnahme
MONO0 = 1_000_000_000
FORM = np.array([math.exp(-i / 12.0) * math.cos(2 * math.pi * 2000.0 * i / 48000.0) for i in range(96)], np.float32)


def meta_txt(pfad, senke, fremder_treiber=False, kerne=1, top_ohne_daten=False):
    """meta.txt wie von lauf.sh: Kopfzeile mit senke=, letzter pw-top-Rahmen, Knotenzählung."""
    if top_ohne_daten:  # so in 4 von 9 Läufen der Planungsprobe: pw-top hatte noch keine Messwerte
        top = [f"R  134      0      0   0,0us   0,0us  ???   ???     0     F32P 2 48000 {senke}"]
    elif fremder_treiber:
        top = [f"R   64    256  48000  10,0us   3,0us  0,00  0,00    0     F32P 2 48000 cypherdj-pruef-x-fremd",
               f"R  116      0      0   4,9us   8,1us  0,00  0,00    0     F32P 2 48000  + {senke}"]
    else:
        top = [f"R  116    256  48000  24,9us   4,2us  0,00  0,00    0     F32P 2 48000 {senke}"]
    top += ["R  109    256  48000  10,1us   2,8us  0,00  0,00    0                   + cypherdj-notbahn-a",
            "R   95    256  48000   9,9us   2,8us  0,00  0,00    0                   + cypherdj-kern-a"]
    with open(pfad, "w") as f:
        f.write(f"art=klick lauf=1 senke={senke} quantum=256 instanz=a kern=synthetisch\n== pw-top\n")
        f.write("S   ID  QUANT   RATE    WAIT    BUSY   W/Q   B/Q  ERR FORMAT           NAME\n" + "\n".join(top) + "\n")
        f.write(f"== knoten\nkern={kerne}\nnotbahn=1\naufnehmer=1\n== pw-link\n")


def lauf(ordner, name, einsatz_kern, luecken=0, uhr_fehlt=False, frames=52 * 48000, fremder_treiber=False, kerne=1,
         top_ohne_daten=False):
    x = np.zeros(frames, np.float32)
    for b, s in einsatz_kern:
        o = s + V - K0
        x[o:o + 96] += (0.5 if b % 4 == 0 else 0.25) * FORM[:max(0, min(96, frames - o))]
    wav = os.path.join(ordner, name + ".wav")
    wavfile.write(wav, 48000, np.stack([x, x], axis=1))
    json.dump({"erster_mono_ns": MONO0, "erster_jack_frame": 0, "frames": frames, "luecken": luecken,
               "luecken_bei": [], "ueberlauf": 0, "quantum": 256, "quelle": "synthetisch"}, open(wav + ".json", "w"))
    per = 256 / 48000 * 1e9
    log = os.path.join(ordner, name + ".jsonl")
    with open(log, "w") as f:
        for z in range(0, (K0 + frames) // 256 + 2):
            if uhr_fehlt and z == 400:
                continue
            m = MONO0 + int(round((z * 256 - K0) / 256 * per))
            f.write(json.dumps({"t_ns": m, "adresse": "/uhr", "typen": "hhddd",
                                "werte": [z * 256, m, z * 256 / SPB, 128.0, 0.0]}) + "\n")
    meta_txt(os.path.join(ordner, name + ".meta.txt"), "cypherdj-pruef-a-1", fremder_treiber, kerne, top_ohne_daten)
    return wav, log


def urteil(wav, log, erwarte):
    meta = log[:-len(".jsonl")] + ".meta.txt"
    r = subprocess.run([sys.executable, os.path.join(HIER, "auswertung.py"), "--wav", wav, "--pruefer", log,
                        "--erwarte-klicks", str(erwarte), "--meta", meta], capture_output=True, text=True)
    try:
        return r.returncode, json.loads(r.stdout)
    except json.JSONDecodeError:
        return r.returncode, {}


def main():
    fehler = 0
    with tempfile.TemporaryDirectory() as d:
        exakt = [(b, b * SPB) for b in range(2, 105)]
        faelle = [
            ("richtig", exakt, {}, 101, 0, {"versatz_samples": V, "streuung_samples": 0}),
            ("ein_sample", [(b, s + (1 if b == 50 else 0)) for b, s in exakt], {}, 101, 1, {"streuung_samples": 1}),
            ("blockanfang", [(b, (s // 256) * 256) for b, s in exakt], {}, 101, 1, {"streuung_samples": 252}),
            ("aufnehmer_luecke", exakt, {"luecken": 1}, 101, 2, {"ergebnis": "unbrauchbar"}),
            ("uhr_fehlt", exakt, {"uhr_fehlt": True}, 101, 2, {"ergebnis": "unbrauchbar"}),
            ("fremder_treiber", exakt, {"fremder_treiber": True}, 101, 2, {"ergebnis": "unbrauchbar"}),
            ("doppelter_kern", exakt, {"kerne": 2}, 101, 2, {"ergebnis": "unbrauchbar"}),
            ("top_ohne_daten", exakt, {"top_ohne_daten": True}, 101, 0, {"ergebnis": "gruen", "streuung_samples": 0}),
            ("stille", [], {}, 0, 0, {"klicks": 0}),
            ("ein_klick", [(10, 10 * SPB)], {}, 0, 1, {"klicks": 1}),
        ]
        for name, einsaetze, extra, erwarte, rc_soll, felder in faelle:
            wav, log = lauf(d, name, einsaetze, **extra)
            rc, e = urteil(wav, log, erwarte)
            ok = rc == rc_soll and all(e.get(k) == v for k, v in felder.items())
            print(f"{name}: Rückgabe {rc} (soll {rc_soll}), {e.get('ergebnis')}, Versatz {e.get('versatz_samples')}, "
                  f"Streuung {e.get('streuung_samples')}, Klicks {e.get('klicks')}: {'ok' if ok else 'FALSCH'}")
            fehler += 0 if ok else 1
    print("Instrument geprüft" if not fehler else f"{fehler} Fall/Fälle falsch")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
