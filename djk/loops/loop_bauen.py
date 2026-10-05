#!/usr/bin/env python3
"""Loop für die Loop-Boxen bauen (Plan MVP 2, ADR 025): aus einer eigenen Aufnahme, die schon bei 128 BPM genau N Takte
lang ist (±10 ms), wird <ziel>/<name>/loop.json + loop.f32 (48 kHz, Stereo, float32 verschränkt, genau N · 90 000
Frames). Kein Strecken: eine Aufnahme in einem anderen Tempo wird abgelehnt.
Aufruf: loop_bauen.py <datei> --takte N --name NAME [--ziel ~/.config/cypherdj/loops]"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

RATE = 48000
SPB = 22500
TOLERANZ = 480  # 10 ms


def lies(datei: Path) -> np.ndarray:
    roh = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(datei), "-ar", str(RATE), "-ac", "2",
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(roh, dtype="<f4").copy()
    if x.size == 0 or x.size % 2:
        raise ValueError(f"{datei}: keine Stereo-Daten")
    return x.reshape(-1, 2)


def baue(datei: Path, takte: int, name: str, ziel: Path) -> Path:
    if takte not in (1, 2, 4, 8):
        raise ValueError(f"Takte {takte}: erlaubt sind 1, 2, 4, 8")
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", name):
        raise ValueError(f"Name {name!r}: erlaubt ist [a-z0-9_-]{{1,32}}")
    ziel = Path(ziel).expanduser()
    if (ziel / name).exists():
        raise ValueError(f"{ziel / name} gibt es schon")
    x = lies(Path(datei))
    soll = takte * 4 * SPB
    if abs(x.shape[0] - soll) > TOLERANZ:
        raise ValueError(f"{datei}: {x.shape[0]} Frames, erwartet {soll} ±{TOLERANZ} (128 BPM, {takte} Takt(e))")
    y = np.zeros((soll, 2), dtype="<f4")
    n = min(soll, x.shape[0])
    y[:n] = x[:n]
    if not np.all(np.isfinite(y)):
        raise ValueError(f"{datei}: NaN oder Inf")
    neu = ziel / f".{name}.neu"
    shutil.rmtree(neu, ignore_errors=True)
    neu.mkdir(parents=True)
    y.tofile(neu / "loop.f32")
    (neu / "loop.json").write_text(json.dumps({"schema": 1, "name": name, "beats": 4 * takte, "bpm": 128, "frames": soll,  # Scheibe 3: beats
                                              
                                               "datei": "loop.f32", "quelle": Path(datei).name,
                                               "erstellt": time.strftime("%Y-%m-%d %H:%M")}, indent=1))
    neu.rename(ziel / name)
    return ziel / name


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("datei")
    ap.add_argument("--takte", type=int, required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--ziel", default="~/.config/cypherdj/loops")
    a = ap.parse_args(argv)
    try:
        d = baue(Path(a.datei), a.takte, a.name, Path(a.ziel))
    except ValueError as e:
        print(f"loop_bauen: {e}", file=sys.stderr)
        return 2
    print(f"loop {a.name}: {a.takte} Takt(e), nach {d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
