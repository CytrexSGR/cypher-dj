#!/usr/bin/env python3
"""Misst die Datensatzrate der Ring-Attrappe am Ziel (am Zähler w im Ring, nicht an der Meldung der Attrappe).

Startet attrappe_huellen.py im Echtzeit-Takt mit einem 1-kHz-Sinus auf deck/1 (Schleife), liest w alle 50 ms gegen
CLOCK_MONOTONIC. Das Messfenster beginnt 2 s nach dem ersten geschriebenen Datensatz (Anlauf und Import der Attrappe
zählen nicht) und dauert DAUER Sekunden. Rate = Steigung der Ausgleichsgeraden w(t) im Fenster (w wächst in Schritten
von 10 Datensätzen, zwei Endpunkte allein wären um ±10 ungenau); dazu die Rate aus den Endpunkten und der größte
Rückstand von w gegen die Uhr. Grenze (Abnahme Scheibe 09): 1 000 Hz ±0,1 % über 60 s.

Aufruf (zeitkritisch, also unter dem Schloss, ROADMAP §8.5):
  flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" python3 djk/vertrag/messe_ringrate.py [--dauer 60]
Rückgabe 0 = in der Grenze, 1 = außerhalb, 2 = Attrappe lief nicht lange genug.
Die Auswertung (auswerten) ist von der Messung getrennt, damit tests/test_ringrate.py das Instrument an künstlichen
Zählerständen prüfen kann (sieht es eine falsche Rate?), ohne Echtzeit.
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile
import time

import numpy as np
from scipy.io import wavfile

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import huellen_ring as hr  # noqa: E402

ANLAUF_S = 2.0
SOLL_HZ = 1000.0
GRENZE = 0.001      # ±0,1 %


def last():
    return " ".join(pathlib.Path("/proc/loadavg").read_text().split()[:3])


def auswerten(t, w, dauer, anlauf=ANLAUF_S):
    """t: Zeitpunkte (s, monoton), w: Zählerstände dazu. Gibt ein dict mit rate, rate_enden, abw, rueckstand,
    proben, fenster_s oder None zurück, wenn das Fenster [erster Datensatz + anlauf, + dauer] nicht erreicht wurde."""
    t = np.asarray(t, dtype=np.float64)
    w = np.asarray(w, dtype=np.float64)
    if not (w > 0).any():
        return None
    t_an = t[np.argmax(w > 0)]
    fenster = (t >= t_an + anlauf) & (t <= t_an + anlauf + dauer)
    tf, wf = t[fenster], w[fenster]
    if tf.size < 2 or tf[-1] - tf[0] < dauer - 0.5:
        return None
    rate = float(np.polyfit(tf - tf[0], wf, 1)[0])
    return {"rate": rate, "rate_enden": float((wf[-1] - wf[0]) / (tf[-1] - tf[0])), "abw": rate / SOLL_HZ - 1.0,
            "rueckstand": float(np.max((tf - tf[0]) * SOLL_HZ - (wf - wf[0]))), "proben": int(tf.size),
            "fenster_s": float(tf[-1] - tf[0])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dauer", type=float, default=60.0)
    a = ap.parse_args()
    print(f"Fremdlast vorher (1/5/15 min): {last()}")
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "sinus_1k.wav"
        t = np.arange(48000) / 48000.0
        wavfile.write(wav, 48000, (0.5 * np.sin(2 * np.pi * 1000.0 * t)).astype(np.float32))
        ring = pathlib.Path(tmp) / "huellen"
        proz = subprocess.Popen([sys.executable, str(HIER / "attrappe_huellen.py"), "--kanal", f"0={wav}", "--schleife",
                                 "--sekunden", str(a.dauer + ANLAUF_S + 4.0), "--pfad", str(ring)])
        while (not ring.exists() or ring.stat().st_size < hr.GROESSE) and proz.poll() is None:
            time.sleep(0.01)
        leser = hr.HuellenLeser(ring)
        proben = []
        while proz.poll() is None:
            proben.append((time.monotonic(), leser.w()))
            time.sleep(0.05)
        proben.append((time.monotonic(), leser.w()))
    e = auswerten([p[0] for p in proben], [p[1] for p in proben], a.dauer)
    if e is None:
        print(f"Attrappe lief nicht lange genug für ein Fenster von {a.dauer} s nach {ANLAUF_S} s Anlauf")
        return 2
    print(f"Rate {e['rate']:.3f} Hz (Ausgleichsgerade) und {e['rate_enden']:.3f} Hz (Endpunkte) über "
          f"{e['fenster_s']:.2f} s, Abweichung {e['abw'] * 100:+.4f} %, größter Rückstand {e['rueckstand']:.0f} "
          f"Datensätze, {e['proben']} Proben, Rückgabe Attrappe {proz.returncode}")
    print(f"Fremdlast nachher (1/5/15 min): {last()}")
    ok = abs(e["abw"]) <= GRENZE and proz.returncode == 0
    print("IN DER GRENZE" if ok else "AUSSERHALB DER GRENZE (1 000 Hz ±0,1 %)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
