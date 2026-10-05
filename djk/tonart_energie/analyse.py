"""Tonart und Energie für Tracks ohne Mixed In Key: ein Ordner (oder einzelne Dateien) → JSON-Zeilen.

Je Track eine Zeile: {"pfad", "camelot", "konfidenz", "energie", "energie_wert", "tonart": {...}, "fehler"}.
Das Audio wird genau einmal über ffmpeg gelesen (44,1 kHz mono) und für beide Rechnungen geteilt.
Die Dateien werden nur gelesen, nie geschrieben: keine Tags, keine Nebendateien.
Nur CPU, Nice 19, höchstens 3 Prozesse, vor jedem Block 1-min-Last prüfen (> 6 → 60 s warten).

Aufruf (aus djk/):
  nice -n 19 ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.analyse "<Ordner>" [--prozesse 3] [--dur offen] > ergebnis.jsonl
"""
from __future__ import annotations

from . import energie_level  # noqa: F401  (setzt die Thread-Grenzen vor numpy)

import argparse
import json
import os
import sys
import time
from multiprocessing import get_context
from pathlib import Path

ENDUNGEN = {".mp3", ".flac", ".wav", ".aiff", ".aif", ".m4a", ".ogg", ".opus"}


def dateien(ziele: list[str]) -> list[str]:
    out = []
    for z in ziele:
        p = Path(z)
        if p.is_dir():
            out += sorted(str(f) for f in p.rglob("*") if f.is_file() and f.suffix.lower() in ENDUNGEN)
        elif p.is_file():
            out.append(str(p))
    return out


def analysiere(pfad: str, modus: str = "bestand") -> dict:
    from . import energie_level as el
    from .tonart import SR, tonart_signal
    t0 = time.perf_counter()
    try:
        m = el._laden()["merkmale"]
        assert m.SR == SR
        x = m.dekodiere(pfad)
        if len(x) < SR * 5:
            raise ValueError(f"zu kurz: {len(x) / SR:.1f} s")
        ton = tonart_signal(x, SR, modus=modus)
        en = el.aus_merkmalen(el.merkmale_aus_audio(x))
        return {"pfad": pfad, "camelot": ton["camelot"], "konfidenz": ton["konfidenz"],
                "energie": en["level"], "energie_wert": en["wert"], "tonart": ton,
                "t_s": round(time.perf_counter() - t0, 2), "fehler": None}
    except Exception as e:                                            # noqa: BLE001
        return {"pfad": pfad, "fehler": repr(e), "t_s": round(time.perf_counter() - t0, 2)}


def _init() -> None:
    os.nice(max(0, 19 - os.nice(0)))
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    if not os.environ.get("ANALYSE_STDERR_OFFEN"):
        os.dup2(os.open(os.devnull, os.O_WRONLY), 2)                # TF-Geschwätz weg
    from . import energie_level
    energie_level._laden()


def last_warten(max_last: float = 6.0) -> None:
    while (l := os.getloadavg()[0]) > max_last:
        print(f"Last {l:.2f} > {max_last}, warte 60 s", file=sys.stderr, flush=True)
        time.sleep(60)


def lauf(pfade: list[str], prozesse: int = 3, block: int = 15, modus: str = "bestand"):
    from functools import partial
    prozesse = max(1, min(3, prozesse))
    with get_context("spawn").Pool(prozesse, initializer=_init) as pool:
        for i in range(0, len(pfade), block):
            last_warten()
            yield from pool.imap(partial(analysiere, modus=modus), pfade[i:i + block])


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ziele", nargs="+", help="Ordner (rekursiv) oder Dateien")
    ap.add_argument("--prozesse", type=int, default=3)
    ap.add_argument("--dur", choices=("bestand", "offen", "moll"), default="bestand",
                    help="Dur-Weg: bestand (Standard, Techno-Bestand fast nur Moll), offen (unbekannter Dur-Anteil), moll")
    a = ap.parse_args(argv)
    os.nice(max(0, 19 - os.nice(0)))
    pfade = dateien(a.ziele)
    print(f"{len(pfade)} Dateien", file=sys.stderr, flush=True)
    for r in lauf(pfade, a.prozesse, modus=a.dur):
        print(json.dumps(r, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
