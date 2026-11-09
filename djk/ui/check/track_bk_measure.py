#!/usr/bin/env python3
"""S23: does a live automation track (POST /spur) move a Baukasten graph knob in the SOUND?

Runs against a test instance (b..i, never the operating instance a) with its silent sink. It puts a sustained
pattern on erz/3, loads the lead graph, sets knob 1 (Cutoff) to 0.7, starts a track of three moves on
erz/3/bk/1 (0.7 -> 0 -> 1 -> 0.7, 2 + 2 + 1 bars) and records the monitor of the silent sink. The measure is
the magnitude weighted spectral centroid per bar (the cutoff barely moves the level, so the level says nothing).

Verdict "ok": the lowest bar is at most 0.7 of the level before the track AND the highest bar is at least 1.15 of it.
A track that is acknowledged by the kern but does not reach the graph leaves the centroid flat: verdict "flach".
Positive control for the instrument: run it against the kern built with CYPHERDJ_MUTATION_BK_RAMPE_TOTZONE
(target cypherdj-kern-mutation-bk-rampe), it must say "flach" there and "ok" with the normal kern.

Usage: track_bk_measure.py --instanz i [--kanal erz/3] [--knopf 1] [--graph lead] [--takte 2,2,1]
Needs: numpy, parec (PipeWire), a running instance started with --strudel and an erzeuger3 with a MIDI target (--ziel midi:2:1).
Output: one JSON line, exit code 0 for ok, 1 for flach, 2 for a setup problem.
"""
import argparse
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

import numpy as np

BPM_DEFAULT = 128.0


def aufruf(port, pfad, daten=None):
    kopf = {"content-type": "application/json", "x-djk-quelle": "cypher"}
    req = urllib.request.Request(f"http://127.0.0.1:{port}{pfad}", headers=kopf,
                                 data=None if daten is None else json.dumps(daten).encode(),
                                 method="GET" if daten is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read() or b"{}")
        except ValueError:
            return {"fehler": f"http {e.code}"}


def zentroid(a):
    """Magnitude weighted spectral centroid (Hz) of one mono segment."""
    if len(a) < 4096:
        return float("nan")
    s = np.abs(np.fft.rfft(a * np.hanning(len(a))))
    f = np.fft.rfftfreq(len(a), 1 / 48000)
    return float((f * s).sum() / max(s.sum(), 1e-12))


def lies_wav(pfad):
    w = wave.open(pfad)
    x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, w.getnchannels()).astype(np.float64) / 32768
    return x[:, :2].mean(axis=1)


def nimm_auf(sink, sek, datei):
    p = subprocess.Popen(["parec", "-d", f"{sink}.monitor", "--rate=48000", "--channels=4", "--format=s16le",
                          "--file-format=wav", datei], stderr=subprocess.DEVNULL)
    time.sleep(sek)
    p.terminate()
    p.wait()
    return lies_wav(datei)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instanz", required=True)
    ap.add_argument("--kanal", default="erz/3")
    ap.add_argument("--knopf", type=int, default=1)
    ap.add_argument("--graph", default="lead")
    ap.add_argument("--takte", default="2,2,1")
    a = ap.parse_args()
    if a.instanz not in "bcdefghi" or len(a.instanz) != 1:
        print("spur_bk_messen: --instanz must be one of b..i (never the operating instance a)", file=sys.stderr)
        return 2
    port = 47300 + 1000 * (ord(a.instanz) - 96)
    sink = f"cypher_stumm-{a.instanz}"
    pfad = f"{a.kanal}/bk/{a.knopf}"
    strom = {"erz/1": 1, "erz/2": 2, "erz/3": 3}.get(a.kanal)
    if strom is None:
        print("spur_bk_messen: --kanal must be erz/1..3 (Strudel streams)", file=sys.stderr)
        return 2
    t = [int(x) for x in a.takte.split(",")]
    lage = aufruf(port, "/lage")
    bpm = (lage.get("uhr") or {}).get("bpm") or BPM_DEFAULT
    takt_s = 4 * 60.0 / bpm
    aufruf(port, "/regler", {"pfad": f"{a.kanal}/fader", "nach": -6, "takte": 0})
    aufruf(port, "/strudel", {"strom": strom, "text": 'note("a2 cs3 e3 a3").slow(2).s("x").legato(1)'})
    g = aufruf(port, "/graph", {"kanal": a.kanal, "name": a.graph})
    if not g.get("ok"):
        print(json.dumps({"verdikt": "aufbau", "graph": g}))
        return 2
    time.sleep(4)
    aufruf(port, "/regler", {"pfad": pfad, "nach": 0.7, "takte": 0})
    time.sleep(5)
    with tempfile.TemporaryDirectory() as d:
        vor = zentroid(nimm_auf(sink, 4, f"{d}/vor.wav"))
        fahrten = []
        ab = 1
        for nach, n in zip((0.0, 1.0, 0.7), t):
            fahrten.append({"ziel": pfad, "ab_takt": ab, "takte": n, "nach": nach})
            ab += n
        p = subprocess.Popen(["parec", "-d", f"{sink}.monitor", "--rate=48000", "--channels=4", "--format=s16le",
                              "--file-format=wav", f"{d}/spur.wav"], stderr=subprocess.DEVNULL)
        time.sleep(0.3)
        antwort = aufruf(port, "/spur", {"spur": {"name": "spurbk", "fahrten": fahrten}})
        time.sleep((sum(t) + 3) * takt_s + 1)
        p.terminate()
        p.wait()
        m = lies_wav(f"{d}/spur.wav")
    L = int(takt_s * 48000)
    je_takt = [zentroid(m[i:i + L]) for i in range(0, len(m) - L + 1, L)]
    gueltig = [c for c in je_takt if c == c]
    tief, hoch = min(gueltig), max(gueltig)
    ok = bool(antwort.get("ok")) and tief <= 0.7 * vor and hoch >= 1.15 * vor
    print(json.dumps({"verdikt": "ok" if ok else "flach", "pfad": pfad, "spur_ok": antwort.get("ok"), "quittung": antwort.get("quittung"),
                      "vor_hz": round(vor), "tief_hz": round(tief), "hoch_hz": round(hoch), "tief_zu_vor": round(tief / vor, 2),
                      "hoch_zu_vor": round(hoch / vor, 2), "je_takt_hz": [round(c) for c in je_takt]}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
