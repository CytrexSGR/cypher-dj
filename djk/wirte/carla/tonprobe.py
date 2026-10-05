#!/usr/bin/env python3
"""Hörprobe direkt am Wirt-Ausgang (Studio S5.3). Nimmt <client>:audio-out1/2 über einen eigenen pw-record-Knoten auf
(pw-link, NIE --target: das nahm in der Vorprobe nicht am Wirt auf), schickt optional über den Wirt-Socket eine Note
(2 s) und druckt eine JSON-Zeile {spitze_db, rms_db, schwerpunkt_hz} über das Fenster 1,1-2,7 s.
Ohne --note ist das der Nullpunkt (muss -180 liefern). Nur Prüf-Clients (Name endet auf -a..-i).
Aufruf: tonprobe.py --client cypherdj-wirt-bass-f --sock /dev/shm/cypherdj-f/wirt-bass.sock --note 36 --wav /tmp/x.wav"""
import argparse
import json
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wirtsteuerung import sende  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", required=True)
    ap.add_argument("--sock", required=True)
    ap.add_argument("--note", type=int)
    ap.add_argument("--wav", required=True)
    a = ap.parse_args(argv)
    if not re.search(r"-[a-i]$", a.client):
        print("tonprobe: only test clients (name ending in -a..-i)", file=sys.stderr)
        return 2
    knoten = "cypherdj-pruef-tonprobe"
    rec = subprocess.Popen(["pw-record", "-P", f"{{ node.name={knoten} node.autoconnect=false }}", "--rate", "48000",
                            "--channels", "2", a.wav], stderr=subprocess.DEVNULL)
    try:
        time.sleep(0.6)
        for k, p in (("out1", "FL"), ("out2", "FR")):
            subprocess.run(["pw-link", f"{a.client}:audio-{k}", f"{knoten}:input_{p}"], check=True)
        time.sleep(0.3)
        if a.note is not None:
            r = sende(a.sock, {"befehl": "note", "note": a.note, "velocity": 110, "dauer": 2.0})
            if not r.get("ok"):
                print(json.dumps(r), file=sys.stderr)
                return 1
        time.sleep(2.7)
    finally:
        rec.terminate()
        rec.wait()
    with wave.open(a.wav) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    x = x.reshape(-1, 2).mean(axis=1)
    seg = x[int(1.1 * 48000):int(2.7 * 48000)]

    def db(v):
        return round(float(20 * np.log10(max(v, 1e-9))), 1)

    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    fr = np.fft.rfftfreq(len(seg), 1 / 48000)
    print(json.dumps({"spitze_db": db(abs(x).max()), "rms_db": db(np.sqrt((seg ** 2).mean())),
                      "schwerpunkt_hz": round(float((spec * fr).sum() / max(spec.sum(), 1e-9)))}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
