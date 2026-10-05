"""Merkmals-Lauf über die Stichprobe: 3 Prozesse, Nice 19, nur CPU, Lastprüfung vor jedem Block.

Setzt fort: Tracks mit vorhandener json/<id>.json werden übersprungen.
Am Ende: merkmale.csv (Merkmale + Labels) und labels.csv im Cache-Verzeichnis.

Aufruf: python -m tonart_energie.lauf [--prozesse 3] [--block 30] [--max-last 6] [--nur-tabelle]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import traceback
from multiprocessing import get_context
from pathlib import Path

from .stichprobe import CACHE, lies

_es = None
_tf = None


def _init() -> None:
    global _es, _tf
    os.nice(19 - os.nice(0))
    log = open(CACHE / "lauf.stderr.log", "a")
    os.dup2(log.fileno(), 2)                                   # TF-Geschwätz aus der Konsole
    import essentia
    essentia.log.infoActive = False
    essentia.log.warningActive = False
    import essentia.standard as es
    from . import merkmale
    _es = es
    _tf = merkmale.TFModelle(es)


def _eins(zeile: dict) -> tuple[str, str | None, float]:
    from . import merkmale
    t = time.perf_counter()
    try:
        merkmale.verarbeite(zeile, _es, _tf)
        return zeile["pfad"], None, time.perf_counter() - t
    except Exception:
        return zeile["pfad"], traceback.format_exc(limit=3), time.perf_counter() - t


def last() -> float:
    return os.getloadavg()[0]


def tabelle() -> tuple[int, Path]:
    zeilen, labels = [], []
    for j in sorted((CACHE / "json").glob("*.json")):
        d = json.loads(j.read_text())
        z, mm = d["zeile"], d["merkmale"]
        lab = {"id": mm["id"], "pfad": z["pfad"], "artist": z["artist"], "album": z["album"], "title": z["title"],
               "genre": z["genre"], "tkey": z["tkey"], "energy": z["energy"], "tbpm": z["tbpm"], "dauer_s": z["dauer_s"]}
        labels.append(lab)
        zeilen.append({**lab, **{k: v for k, v in mm.items() if k != "id"}})
    zeilen.sort(key=lambda r: r["pfad"])
    labels.sort(key=lambda r: r["pfad"])
    spalten = list(dict.fromkeys(k for r in zeilen for k in r))
    ziel = CACHE / "merkmale.csv"
    with open(ziel, "w", newline="") as f:
        w = csv.DictWriter(f, spalten)
        w.writeheader()
        w.writerows(zeilen)
    with open(CACHE / "labels.csv", "w", newline="") as f:
        w = csv.DictWriter(f, list(labels[0]) if labels else ["id"])
        w.writeheader()
        w.writerows(labels)
    return len(zeilen), ziel


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prozesse", type=int, default=3)
    ap.add_argument("--block", type=int, default=30)
    ap.add_argument("--max-last", type=float, default=6.0)
    ap.add_argument("--nur-tabelle", action="store_true")
    a = ap.parse_args()
    os.nice(19 - os.nice(0))
    if not a.nur_tabelle:
        from .merkmale import track_id
        stich = lies(CACHE / "stichprobe.csv")
        offen = [z for z in stich if not (CACHE / "json" / f"{track_id(z['pfad'])}.json").exists()]
        print(f"Stichprobe {len(stich)}, offen {len(offen)}", flush=True)
        fehler = []
        t0 = time.time()
        with get_context("spawn").Pool(a.prozesse, initializer=_init) as pool:
            for i in range(0, len(offen), a.block):
                while (l := last()) > a.max_last:
                    print(f"  Last {l:.2f} > {a.max_last}, warte 60 s", flush=True)
                    time.sleep(60)
                for pfad, err, dt in pool.imap_unordered(_eins, offen[i:i + a.block]):
                    if err:
                        fehler.append((pfad, err))
                        print(f"  FEHLER {pfad}: {err.splitlines()[-1]}", flush=True)
                print(f"  {min(i + a.block, len(offen))}/{len(offen)} · {time.time() - t0:.0f} s · Last {last():.2f}",
                      flush=True)
        (CACHE / "fehler.json").write_text(json.dumps(fehler, indent=1))
        print(f"fertig in {time.time() - t0:.0f} s, Fehler {len(fehler)}", flush=True)
    n, ziel = tabelle()
    print(f"Tabelle {ziel}: {n} Zeilen", flush=True)


if __name__ == "__main__":
    sys.exit(main())
