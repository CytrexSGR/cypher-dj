#!/usr/bin/env python3
"""Instrument-Kontrolle für auswertung.py (Scheibe 19): synthetische Läufe mit bekannter Wahrheit.

Gebaut wie ein echter Lauf bei Quantum 256: Senden zu zufälligen Zeiten, das Ereignis liegt im nächsten Block am
Versatz, der genau eine Periode nach dem Senden liegt (09 Probe c). Erwartung:
  richtig (sample = cf + versatz)          --erwarte gruen       -> GRUEN
  blockgrenze (sample = cf + n)            --erwarte gruen       -> ROT   (Fehlerfall wird erkannt)
  blockgrenze                              --erwarte blockgrenze -> GRUEN
  richtig bei Quantum 1024                 --erwarte gruen       -> ROT   (falsches Quantum wird erkannt)
  richtig, ein Ereignis fehlt              --erwarte gruen       -> ROT
Aufruf: python3 test_auswertung.py  (Rückgabe 0, wenn alle fünf wie erwartet)"""
import json
import os
import random
import subprocess
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
SR = 48000


def lauf(n_block, blockgrenze, weglassen=False):
    random.seed(9)
    periode_us = n_block * 1e6 / SR
    senden, empfang = [], [{"typ": "uhrvergleich", "jack_minus_mono_us_min": 0, "max": 0, "sr": SR, "puffer": n_block},
                           {"typ": "verbunden", "t_us": 1000}]
    t = 2_000_000.0
    for i in range(300):
        t += random.uniform(13000, 47000)
        senden.append({"typ": "gesendet", "i": i, "t_send_us": int(t), "wert": i % 128})
        # Ereignis-Sample genau eine Periode nach dem Senden; Block und Versatz daraus (Frame-Zeit = Zeit * SR)
        ziel = int(round((t + periode_us) / 1e6 * SR))
        cf = ziel // n_block * n_block
        versatz = ziel - cf
        cu = cf / SR * 1e6
        if weglassen and i == 150:
            continue
        empfang.append({"typ": "ereignis", "cf": cf, "cu": int(cu), "nu": int(cu + periode_us), "n": n_block,
                        "versatz": versatz, "bytes": [176, 7, i % 128], "aus": 1,
                        "sample": cf + (n_block if blockgrenze else versatz), "art": "regler_absolut",
                        "ziel": "deck/1/fader", "wert": i % 128})
    empfang.append({"typ": "ende", "ereignisse": len(empfang) - 2})
    return senden, empfang


def urteil(senden, empfang, erwarte):
    with tempfile.TemporaryDirectory() as d:
        s, e = os.path.join(d, "s.jsonl"), os.path.join(d, "e.jsonl")
        open(s, "w").write("".join(json.dumps(z) + "\n" for z in senden))
        open(e, "w").write("".join(json.dumps(z) + "\n" for z in empfang))
        r = subprocess.run([sys.executable, os.path.join(HIER, "auswertung.py"), s, e, "--erwarte", erwarte],
                           capture_output=True, text=True)
        return json.loads(r.stdout)["urteil"]


FAELLE = [
    ("richtig", lauf(256, False), "gruen", "GRUEN"),
    ("blockgrenze_als_richtig", lauf(256, True), "gruen", "ROT"),
    ("blockgrenze_erkannt", lauf(256, True), "blockgrenze", "GRUEN"),
    ("quantum_1024", lauf(1024, False), "gruen", "ROT"),
    ("eines_fehlt", lauf(256, False, weglassen=True), "gruen", "ROT"),
]
fehler = 0
for name, (s, e), erw, soll in FAELLE:
    ist = urteil(s, e, erw)
    ok = ist == soll
    fehler += not ok
    print(f"{'OK  ' if ok else 'ROT '} {name}: {ist} (soll {soll})")
print(f"{len(FAELLE) - fehler} von {len(FAELLE)} Faellen gruen")
sys.exit(1 if fehler else 0)
