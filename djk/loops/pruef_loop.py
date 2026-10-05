#!/usr/bin/env python3
"""Prüf-Loop für die Loop-Boxen (Plan MVP 2): <ordner>/<name>/loop.json + loop.f32 mit einem Burst (96 Samples,
Spitze 0,15, dieselbe Form wie das Prüf-Kit pruef-impuls aus Strudel Stufe 1) auf jedem der angegebenen Beats.
Aufruf: pruef_loop.py <ordner> <name> [--takte 1] [--beats 0.5,1.5,2.5,3.5]"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

SPB = 22500


def burst() -> np.ndarray:
    t = np.arange(96)
    f = np.exp(-t / 20.0) * np.sin(t / 3.0)
    return (0.15 / np.abs(f).max() * f).astype("<f4")


def schreibe(ordner: Path, name: str, takte: int, beats: list) -> Path:
    frames = takte * 4 * SPB
    x = np.zeros((frames, 2), dtype="<f4")
    b = burst()
    for beat in beats:
        s = int(round(beat * SPB))
        if not 0 <= s <= frames - b.size:
            raise ValueError(f"Beat {beat} liegt nicht im Loop ({takte} Takt(e))")
        x[s:s + b.size, 0] += b
        x[s:s + b.size, 1] += b
    d = Path(ordner) / name
    d.mkdir(parents=True, exist_ok=True)
    x.tofile(d / "loop.f32")
    (d / "loop.json").write_text(json.dumps({"schema": 1, "name": name, "beats": 4 * takte, "bpm": 128, "frames": frames,  # Scheibe 3: beats
                                             
                                             "datei": "loop.f32", "quelle": "pruef_loop.py", "erstellt": ""}, indent=1))
    return d


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("ordner")
    ap.add_argument("name")
    ap.add_argument("--takte", type=int, default=1)
    ap.add_argument("--beats", default="0.5,1.5,2.5,3.5")
    a = ap.parse_args(argv)
    d = schreibe(Path(a.ordner), a.name, a.takte, [float(v) for v in a.beats.split(",")])
    print(f"pruef-loop {a.name}: {a.takte} Takt(e), Bursts auf Beat {a.beats}, nach {d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
