#!/usr/bin/env python3
"""Klick-Träger-Fassung für die Kern-Hand (Scheibe 35): ein Material nach SCHNITTSTELLEN §6.4, §13.1, §13.2 wie die
Klick-Fassung der Scheibe 31 (tests/deck/klick_fassung.py: dasselbe Raster, dieselbe Klickform, derselbe Schreibweg),
aber links je Beat ein Klick mit Pegel 0,5 und rechts ein Träger von 12 kHz, 4 Samples je Periode:

    links:  Klick des Quell-Beats q ab Frame llround(q · 60 / bpm · 48 000), Form wie klick_fassung.klickform(), · 0,5
    rechts: A · (0, 1, 0, −1)[f mod 4], A = --traeger (Vorgabe 0,5)

Wozu: am Ziel liegt ein Fader-Griff auf einem Sample. Der Träger zeigt die Verstärkung an jedem Sample (die Hülle
e[n] = sqrt(y[n]² + y[n+1]²) ist bei fester Verstärkung konstant, auch nach einer Phasendrehung im Kanalzug), die
Klicks links legen Kern-Sample und Aufnahme-Frame aufeinander (Einsatz des Quell-Beats q bei §13.1).

Aufruf:  traeger_fassung.py --ziel /dev/shm/cypherdj-i/material --material-id c1c0000000000035 --beats 128
         [--traeger 0.5] [--erste-eins 0] [--bpm 128]
Ausgabe: eine JSON-Zeile wie klick_fassung.py.
"""
import argparse
import json
import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "deck"))
import klick_fassung as kf  # noqa: E402

KLICK_PEGEL = 0.5


def erzeuger(beats, bpm, traeger, freq=None, ohne_klick=False):
    form = kf.klickform() * KLICK_PEGEL
    anfaenge = [] if ohne_klick else [kf.klick_frame(q, 0, bpm) for q in range(beats)]
    muster = (np.array([0.0, 1.0, 0.0, -1.0]) * traeger).astype(np.float32)

    def erzeuge(lo, hi):
        x = np.zeros((hi - lo, 2), dtype=np.float32)
        for a in anfaenge:
            if a >= hi or a + kf.KLICK_LAENGE <= lo:
                continue
            i0, i1 = max(a, lo), min(a + kf.KLICK_LAENGE, hi)
            x[i0 - lo:i1 - lo, 0] = form[i0 - a:i1 - a]
        if freq:  # Sinus bekannter Amplitude (Pegelprobe, Scheibe 35 /pegel): traeger · sin(2π f n / 48 000)
            x[:, 1] = (traeger * np.sin(2 * math.pi * freq * np.arange(lo, hi) / kf.RATE)).astype(np.float32)
        else:
            x[:, 1] = muster[np.arange(lo, hi) % 4]
        return x

    return erzeuge


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ziel", required=True)
    ap.add_argument("--material-id", default="c1c0000000000035")
    ap.add_argument("--beats", type=int, default=128)
    ap.add_argument("--bpm", type=float, default=128.0)
    ap.add_argument("--traeger", type=float, default=0.5, help="Amplitude A des 12-kHz-Trägers rechts")
    ap.add_argument("--freq", type=float, default=None, help="rechts ein Sinus dieser Frequenz statt des 12-kHz-Musters")
    ap.add_argument("--ohne-klick", action="store_true", help="links Stille")
    ap.add_argument("--erste-eins", dest="eins", type=int, default=0, help="erste_eins_quell_beat (0 bis 3)")
    ap.add_argument("--lufs", type=float, default=-16.0, help="lautheit.lufs_integriert (Trim = ziel_lufs − lufs)")
    a = ap.parse_args(argv)
    a.fassung, a.erster, a.nachlauf_beats = 1, 0, 1.0
    a.nan_bei, a.duenn, a.falsche_pruefsumme = None, False, False
    a.frames = int(math.ceil((a.beats + a.nachlauf_beats) * 60.0 / a.bpm * kf.RATE))
    pathlib.Path(a.ziel).mkdir(parents=True, exist_ok=True)
    ordner, frames, sha = kf.ein_material(a.ziel, a.material_id, a, {"basis": erzeuger(a.beats, a.bpm, a.traeger, a.freq, a.ohne_klick)},
                                          "basis")
    print(json.dumps({"material_id": a.material_id, "ordner": ordner, "frames": frames, "sha256": sha,
                      "dauer_s": round(frames / kf.RATE, 3), "traeger": a.traeger, "erste_eins": a.eins}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
