#!/usr/bin/env python3
"""Prüft das Messinstrument auswertung.py an künstlichen Läufen mit bekannter Wahrheit, bevor es am echten Kern misst:
  sauber      Notbahn-Schleife 60 ms, Rückkehr samplegenau          → alle Grenzen PASS (Negativ-Kontrolle)
  stille      50 ms Nullen am Ziel                                  → stille_le_1_block FAIL, 50,0 ms gemessen
  block1      256 Samples Nullen (ein Block, Notbahn daneben)        → stille_le_1_block PASS (Grenze), 256 gemessen
  block1p     257 Samples Nullen                                     → stille_le_1_block FAIL
  versatz2    Rückkehr um 2 Samples verschoben                       → raster und cue_abw FAIL (2)
  versatz1    Rückkehr um 1 Sample verschoben                        → raster und cue_abw PASS (Grenze 1), Wert 1
  spaet       Rückkehr erst nach 300 ms                              → hoerbar_le_250_ms FAIL
  herzschlag  /e/neustart erst nach der Antwort auf einen Herzschlag   → neustart_vor_herzschlag FAIL
  watchdog    SIGSTOP, Watchdog nach 460 ms, bis dahin Stille (Kante)  → watchdog_le_450_ms und stille_le_450_ms FAIL
  haenger     SIGSTOP, Watchdog nach 300 ms, bis dahin Stille          → alles PASS (Negativ-Kontrolle SIGSTOP)
  haenger_selbst  SIGSTOP, Selbst-Wächter tötet nach 55 ms (Journal)   → getoetet_von selbst, 55 ms, alles PASS
  luecke_vorher  Graph-Lücke (256 Frames fehlen) 4,5 s vor dem Eingriff → Eingriff trotzdem richtig beurteilt, rc 0
  luecke_fenster Graph-Lücke 1 s vor dem Eingriff                     → graph_luecke, Instrument (rc 2)
Dazu: das Prüfsignal der Auswertung ist bitgleich mit dem des Kerns (Festwerte wie djk/kern/tests/test_pruef_cue.cpp).
Grenzen seit der Notbahn daneben (ADR 016 Nachtrag 2026-09-25): kill -9 höchstens 1 Block Stille, SIGSTOP höchstens
450 ms (Watchdog 200 ms plus 250 ms systemd-Genauigkeit), die Notbahn wartet über die Kante auf den hängenden Kern.
Aufruf: python3 test_auswertung.py   Rückgabe 0: das Instrument trifft alle dreizehn Fälle und die Festwerte."""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
import auswertung as A  # noqa: E402

RATE = 48000
T0 = 1_000_000_000_000  # erster Aufnahme-Frame, CLOCK_MONOTONIC ns
D = 700                 # Versatz Aufnahme-Index − Kern-Sample


def baue(o, fall):
    bpm = 128.0
    karte = A.Karte(bpm)
    n = 20 * RATE
    idx = np.arange(n, dtype=np.int64)
    kern = idx - D                                          # Kern-Sample je Aufnahme-Index
    x = np.zeros((n, 4), dtype=np.float32)
    x[:, 2] = x[:, 3] = A.pruef_cue(np.maximum(kern, 0))
    for b in range(0, 400):
        s = int(round(karte.sample_at(b))) + D
        if 0 <= s < n - 96:
            form = np.exp(-np.arange(96) / 12.0) * np.cos(2 * np.pi * 2000 * np.arange(96) / RATE)
            x[s:s + 96, 0] = x[s:s + 96, 1] = (0.5 if b % 4 == 0 else 0.3) * form
    i_e = 10 * RATE + 12345                                 # Eingriff
    schleife = {"spaet": 0.300}.get(fall, 0.060)
    schleife = int(schleife * RATE)
    wd_ms = {"watchdog": 460, "haenger": 300, "haenger_selbst": 55}.get(fall)
    if wd_ms:   # Hänger mit Kante: Stille bis kurz nach dem Watchdog-Tod, dann schleift die Notbahn
        a = i_e + int((wd_ms + 5) * RATE / 1000)
        x[i_e + 64:a, :] = 0.0
    else:       # Absturz: die Notbahn daneben schleift ab dem nächsten Block
        a = i_e + 256
    e = a + schleife
    x[a:e] = x[a - 90000:e - 90000]                         # letzter Takt (90 000 Frames bei 128 BPM)
    if fall == "stille":
        x[a + 1000:a + 1000 + 2400, :] = 0.0
    if fall in ("block1", "block1p"):
        x[a - 256:a - 256 + (256 if fall == "block1" else 257), :] = 0.0
    if fall in ("versatz1", "versatz2"):
        v = 1 if fall == "versatz1" else 2
        x[e:, :] = np.roll(x, v, axis=0)[e:, :]
    t_e = T0 + int(i_e * 1e9 / RATE)
    ev = [{"i": 1, "art": "stop" if wd_ms else "kill", "pid": 1, "t_ns": t_e}]
    abo = [{"t": T0 - 10**9, "gesendet": "/k/hallo", "w": ["pruefstand", 47140, 1]},
           {"t": T0 - 9 * 10**8, "gesendet": "/k/set/neu", "w": [11, "pruefstand", bpm]},
           {"t": T0 - 8 * 10**8, "adr": "/q", "w": [11, "pruefstand", 2, 0, 0.0, ""]}]
    for k in range(0, n // 256):                            # /uhr je Block, Kern-Zeit = Aufnahme-Zeit − D
        s = k * 256 - D
        tm = T0 + int(k * 256 * 1e9 / RATE)
        abo.append({"t": tm + 100000, "adr": "/uhr", "w": [s, tm, karte.beat_at(s), bpm, 0.0]})
    herz = t_e + (30 if fall == "herzschlag" else 900) * 10**6
    abo.append({"t": herz, "gesendet": "/k/hallo", "w": ["pruefstand", 47140, 1]})
    abo.append({"t": herz + 10**6, "adr": "/k/willkommen", "w": [1, 1, 0, 0.0, bpm, "t"]})
    t_ns = t_e + (60 if fall == "herzschlag" else 40) * 10**6
    abo.append({"t": t_ns, "adr": "/e/neustart", "w": [1, int(i_e - D + 2304)]})
    abo.sort(key=lambda m: m["t"])
    np.ascontiguousarray(x).tofile(os.path.join(o, "ziel.f32"))
    luecken_bei = []
    if fall in ("luecke_vorher", "luecke_fenster"):   # der ganze Graph lässt 256 Frames aus: Aufnahme ab dort früher
        li = i_e - (int(4.5 * RATE) if fall == "luecke_vorher" else RATE)
        x = np.concatenate((x[:li], x[li + 256:], np.zeros((256, 4), dtype=np.float32)))
        luecken_bei = [[li, 256]]
    json.dump({"erster_mono_ns": T0, "erster_jack_frame": 0, "frames": n, "luecken": len(luecken_bei),
               "luecken_bei": luecken_bei, "ueberlauf": 0, "quantum": 256, "quelle": "t"},
              open(os.path.join(o, "ziel.f32.json"), "w"))
    json.dump({"lauf": fall, "art": ev[0]["art"], "anzahl": 1, "bpm": bpm, "rampe": None, "pruef_cue": True},
              open(os.path.join(o, "lauf.json"), "w"))
    with open(os.path.join(o, "ereignisse.jsonl"), "w") as f:
        f.write(json.dumps(ev[0]) + "\n")
    with open(os.path.join(o, "abonnent.jsonl"), "w") as f:
        for m in abo:
            f.write(json.dumps(m) + "\n")
    wd = t_e + (wd_ms or 200) * 10**6
    with open(os.path.join(o, "journal.txt"), "w") as f:
        if fall == "haenger_selbst":
            f.write(f"[{wd // 10**9}.{(wd % 10**9) // 1000:06d}] h cypherdj-kern[2]: Selbst-Waechter: SIGKILL an 1, "
                    "w steht seit 50.2 ms bei 123\n")
        elif ev[0]["art"] == "stop":
            f.write(f"[{wd // 10**9}.{(wd % 10**9) // 1000:06d}] h systemd[1]: cypherdj-kern-a.service: "
                    "Watchdog timeout (limit 200ms)!\n")
    open(os.path.join(o, "unit.txt"), "w").write("NRestarts=1\n")


def lauf(fall):
    with tempfile.TemporaryDirectory() as o:
        baue(o, fall)
        erg, rc = A.werte(o)
        return erg, rc


def main():
    fehler = 0
    # Prüfsignal bitgleich zum Kern (dieselben Festwerte stehen in djk/kern/tests/test_pruef_cue.cpp)
    fest = {0: 0.0766621605, 1: 0.0133122923, 1440000: 0.0115677118, 1665536: -0.00506503601, 1 << 40: -0.0751054808}
    werte = A.pruef_cue(np.array(list(fest), dtype=np.int64))
    ok = all(w == np.float32(v) for w, v in zip(werte, fest.values()))
    print(f"{'OK  ' if ok else 'FEHL'} pruef_cue: Festwerte wie im Kern")
    fehler += 0 if ok else 1
    erwartet = {
        "sauber": (0, {}),
        "stille": (1, {"stille_le_1_block": False}),
        "block1": (0, {"stille_le_1_block": True}),
        "block1p": (1, {"stille_le_1_block": False}),
        "versatz2": (1, {"raster_abw_le_1": False, "cue_abw_le_1": False}),
        "versatz1": (0, {"raster_abw_le_1": True, "cue_abw_le_1": True}),
        "spaet": (1, {"hoerbar_le_250_ms": False}),
        "herzschlag": (1, {"neustart_vor_herzschlag": False}),
        "watchdog": (1, {"watchdog_le_450_ms": False, "stille_le_450_ms": False}),
        "haenger": (0, {"watchdog_le_450_ms": True, "stille_le_450_ms": True}),
        "haenger_selbst": (0, {"watchdog_le_450_ms": True, "stille_le_450_ms": True}),
        "luecke_vorher": (0, {"raster_abw_le_1": True, "cue_abw_le_1": True, "stille_le_1_block": True}),
        "luecke_fenster": (2, {}),
    }
    wd_soll = {"watchdog": 460, "haenger": 300, "haenger_selbst": 55}
    for fall, (rc_soll, grenzen) in erwartet.items():
        erg, rc = lauf(fall)
        ev = erg["ereignisse"][0] if erg["ereignisse"] else {}
        ok = rc == rc_soll and all(erg["grenzen"][k]["ok"] == v for k, v in grenzen.items())
        if fall == "stille":
            ok = ok and abs(ev.get("stille_ms", 0) - 50.0) < 0.1
        if fall in ("block1", "block1p"):
            ok = ok and ev.get("stille_samples") == (256 if fall == "block1" else 257)
        if fall in ("watchdog", "haenger", "haenger_selbst"):
            ok = ok and ev.get("getoetet_von") == ("selbst" if fall == "haenger_selbst" else "systemd") and abs(ev.get("watchdog_ms", 0) - wd_soll[fall]) < 0.1 and ev.get("stille_ms", 0) > wd_soll[fall]
        if fall == "versatz1":
            ok = ok and ev.get("raster_abw_samples") == 1 and ev.get("cue_abw_samples") == 1
        if fall in ("sauber", "luecke_vorher"):
            ok = ok and ev.get("raster_abw_samples") == 0 and ev.get("cue_abw_samples") == 0
        if fall == "luecke_fenster":
            ok = ok and ev.get("graph_luecke") is True
        print(f"{'OK  ' if ok else 'FEHL'} {fall}: rc {rc} " +
              " ".join(f"{k}={v}" for k, v in ev.items() if k in ("stille_ms", "raster_abw_samples",
                                                                   "cue_abw_samples", "hoerbar_ms", "neustart_ms",
                                                                   "stille_samples",
                                                                   "watchdog_ms", "neustart_vor_herzschlag")))
        fehler += 0 if ok else 1
    print("test_auswertung:", "alles grün" if fehler == 0 else f"{fehler} Fehler")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
