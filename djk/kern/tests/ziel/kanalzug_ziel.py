#!/usr/bin/env python3
"""Messung am Ziel für Scheibe 25: Prüfklick (ROADMAP Z1) im Kanal deck/2, aufgenommen vom JACK-Aufnehmer am Monitor
der eigenen Null-Senke (ziel.f32: float32, vier Kanäle verschränkt, Master L/R, Cue L/R; djk/kern/tests/neustart/
aufnehmer4.cpp). Kein Ton an echte Ausgänge. Einsätze: ein Sample über 1e-5 nach mindestens 5 000 Samples darunter.
Pegel eines Klicks: Energie über 2 048 Samples ab 16 Samples vor dem Einsatz (der Klick klingt nach 96 Samples ab, der
LR8 hält ihn einige ms, der nächste Klick kommt nach 22 500).

Arten:
  rampe  (teil_rampe): der erste hörbare Klick ist Beat 64 (Fader öffnet dort). Beat 80 gegen Beat 96: −7,5 dB ±0,1.
  hand   (hand_gewinnt): Beat 64 wie oben. Nach dem Griff bei Sample 1 620 000 (Beat 72) steht der Pegel: je Klasse
         (Schlag 1, sonst) Spanne der Beats 73 bis 95 höchstens 0,05 dB; vorher steigt er (Beat 70 → 71 um 15/32 dB ±0,05).
  stumm  (Negativ-Kontrolle fader_zu): mindestens 20 s vor dem ersten Einsatz alles <= 1e-6 (−120 dBFS), danach
         mindestens 8 Einsätze im Abstand 22 500 ±1 (Positiv-Gegenprobe: das Instrument sieht Klicks).
Instrument: Einsätze müssen im Abstand 22 500 ±1 Samples liegen (128 BPM), sonst Rückgabe 2.
Aufruf: kanalzug_ziel.py <lauf-ordner> rampe|hand|stumm   Ausgabe: eine JSON-Zeile. Rückgabe 0 grün, 1 rot, 2 Instrument.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

SCHWELLE = 1e-5
BEAT = 22_500


def einsaetze(x: np.ndarray) -> list[int]:
    """Samples über der Schwelle, deren vorheriges Sample über der Schwelle mehr als 5 000 Samples zurückliegt."""
    aus: list[int] = []
    letzt = -10**9
    for i in np.flatnonzero(np.abs(x) > SCHWELLE):
        if i - letzt > 5000:
            aus.append(int(i))
        letzt = int(i)
    return aus


def energie_db(x: np.ndarray, e: int) -> float:
    s = x[max(e - 16, 0):e + 2048].astype(np.float64)
    return 10.0 * math.log10(float(np.sum(s * s)) + 1e-300)


def main() -> int:
    ordner, art = Path(sys.argv[1]), sys.argv[2]
    roh = np.fromfile(ordner / "ziel.f32", dtype=np.float32)
    x = roh[: len(roh) // 4 * 4].reshape(-1, 4)[:, 0]  # Master links
    e = einsaetze(x)
    abstaende = np.diff(e) if len(e) > 1 else np.array([])
    aus = {"art": art, "frames": int(len(x)), "einsaetze": len(e)}
    if len(e) < 2 or np.any(np.abs(abstaende - BEAT) > 1):
        aus["instrument"] = f"Abstände nicht 22 500 ±1: {sorted(set(abstaende.tolist()))[:6]}"
        print(json.dumps(aus, ensure_ascii=False))
        return 2
    gruen = True
    if art in ("rampe", "hand"):
        beat = {64 + k: s for k, s in enumerate(e)}  # erster hörbarer Klick = Beat 64
        if art == "rampe":
            d = energie_db(x, beat[80]) - energie_db(x, beat[96])
            aus["beat80_gegen_96_db"] = round(d, 4)
            aus["beat72_gegen_96_db"] = round(energie_db(x, beat[72]) - energie_db(x, beat[96]), 4)
            gruen = abs(d + 7.5) <= 0.1
        else:
            eins = [energie_db(x, beat[b]) for b in range(73, 96) if b % 4 == 0]
            sonst = [energie_db(x, beat[b]) for b in range(73, 96) if b % 4 != 0]
            vorher = energie_db(x, beat[71]) - energie_db(x, beat[70])
            aus["spanne_schlag1_db"] = round(max(eins) - min(eins), 4)
            aus["spanne_sonst_db"] = round(max(sonst) - min(sonst), 4)
            aus["beat70_nach_71_db"] = round(vorher, 4)
            gruen = aus["spanne_schlag1_db"] <= 0.05 and aus["spanne_sonst_db"] <= 0.05 and abs(vorher - 15 / 32) <= 0.05
    elif art == "stumm":
        vor = x[: e[0]]
        aus["stumm_s"] = round(len(vor) / 48000.0, 2)
        aus["stumm_max"] = float(np.max(np.abs(vor))) if len(vor) else None
        aus["stumm_max_dbfs"] = round(20 * math.log10(aus["stumm_max"]), 1) if aus["stumm_max"] else -math.inf
        gruen = len(vor) >= 20 * 48000 and aus["stumm_max"] is not None and aus["stumm_max"] <= 1e-6 and len(e) >= 8
    else:
        print(f"Art {art!r} unbekannt", file=sys.stderr)
        return 2
    aus["gruen"] = gruen
    print(json.dumps(aus, ensure_ascii=False))
    return 0 if gruen else 1


if __name__ == "__main__":
    sys.exit(main())
