"""Tag-Inventur des Beatport-Ordners und feste Stichprobe.

Liest je MP3 per ffprobe die Tags (TKEY, EnergyLevel, comment, TBPM, artist, album, title, genre)
und schreibt tags.csv. Die Stichprobe nimmt aus allen Tracks mit gültigem Camelot-TKEY UND
EnergyLevel 1..10, nach Pfad sortiert, n gleichmäßig verteilte Indizes (floor(i*N/n)).
Nur lesend auf den Musikordner.

Aufruf: python -m tonart_energie.stichprobe [--n 600]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .camelot import aus_camelot

QUELLE = Path(os.environ.get("CYPHERDJ_MUSIK") or "/nicht/gesetzt/CYPHERDJ_MUSIK")
CACHE = Path.home() / "cypher-dj/cues/merkmale"
FELDER = ["pfad", "artist", "album", "title", "genre", "tkey", "energy", "comment", "tbpm", "dauer_s"]


def tags_lesen(pfad: Path) -> dict:
    out = subprocess.run(
        ["nice", "-n", "19", "ffprobe", "-v", "error", "-show_entries",
         "format=duration:format_tags=artist,album,title,genre,TKEY,EnergyLevel,comment,TBPM",
         "-of", "json", str(pfad)], capture_output=True, text=True)
    try:
        fmt = json.loads(out.stdout).get("format", {})
    except json.JSONDecodeError:
        fmt = {}
    t = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
    return {"pfad": str(pfad), "artist": t.get("artist", ""), "album": t.get("album", ""),
            "title": t.get("title", ""), "genre": t.get("genre", ""), "tkey": t.get("tkey", ""),
            "energy": t.get("energylevel", ""), "comment": t.get("comment", ""),
            "tbpm": t.get("tbpm", ""), "dauer_s": fmt.get("duration", "")}


def gueltig(z: dict) -> bool:
    if aus_camelot(z["tkey"]) is None:
        return False
    try:
        return 1 <= int(z["energy"]) <= 10
    except ValueError:
        return False


def waehle(zeilen: list[dict], n: int) -> list[dict]:
    kand = sorted((z for z in zeilen if gueltig(z)), key=lambda z: z["pfad"])
    N = len(kand)
    if N <= n:
        return kand
    return [kand[(i * N) // n] for i in range(n)]


def inventur(quelle: Path = QUELLE, prozesse: int = 3) -> list[dict]:
    dateien = sorted(p for p in quelle.rglob("*") if p.suffix.lower() == ".mp3")
    with ThreadPoolExecutor(prozesse) as ex:
        return list(ex.map(tags_lesen, dateien))


def schreibe(zeilen: list[dict], ziel: Path) -> None:
    ziel.parent.mkdir(parents=True, exist_ok=True)
    with open(ziel, "w", newline="") as f:
        w = csv.DictWriter(f, FELDER)
        w.writeheader()
        w.writerows(zeilen)


def lies(ziel: Path) -> list[dict]:
    with open(ziel, newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=600)
    a = ap.parse_args()
    tags_csv = CACHE / "tags.csv"
    zeilen = lies(tags_csv) if tags_csv.exists() else inventur()
    if not tags_csv.exists():
        schreibe(zeilen, tags_csv)
    stich = waehle(zeilen, a.n)
    schreibe(stich, CACHE / "stichprobe.csv")
    print(f"MP3 gesamt {len(zeilen)} · mit TKEY {sum(aus_camelot(z['tkey']) is not None for z in zeilen)}"
          f" · mit Energy {sum(z['energy'].strip().isdigit() for z in zeilen)}"
          f" · gültig beide {sum(gueltig(z) for z in zeilen)} · Stichprobe {len(stich)}")


if __name__ == "__main__":
    os.nice(0)
    main()
