"""Schritt 2a, Lauf: je Track die Tonart-Kandidaten einzeln und einzeln getimt.

Schritt 1 hat alle Profile in einem Block getimt; hier läuft jedes Verfahren für sich, damit die
Laufzeit je Verfahren stimmt. Dazu tonart.py aus dem Repo-Wurzelverzeichnis, das in Schritt 1 fehlte.
Ergebnis: ~/cypher-dj/cues/merkmale/tonart_2a.csv (eine Zeile je Track). Setzt fort, wenn die Datei
schon Zeilen hat. Nur CPU, Nice 19, Lastprüfung vor jedem Block.

Aufruf: cd djk && ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.tonart_zeiten [--prozesse 3]
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import os
import time
import traceback
from multiprocessing import get_context
from pathlib import Path

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("OMP_NUM_THREADS", "1")

from .stichprobe import CACHE

REPO = Path(__file__).resolve().parents[2]
AUS = CACHE / "tonart_2a.csv"
FELDER = ["id", "tp_key", "tp_r", "tp_vorsprung", "t_tp",
          "t_dekodieren", "x_edmm_key", "x_edmm_staerke", "t_edmm", "x_braw_key", "t_braw",
          "x_kf_key", "t_kf", "fehler"]

_es = None
_tp = None


def _init() -> None:
    global _es, _tp
    os.nice(19 - os.nice(0))
    import essentia
    essentia.log.infoActive = False
    essentia.log.warningActive = False
    import essentia.standard as es
    spec = importlib.util.spec_from_file_location("tonart_wurzel", REPO / "tonart.py")
    tp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tp)
    _es, _tp = es, tp


def _eins(zeile: dict) -> dict:
    from . import merkmale as m
    from .camelot import aus_name, zu_camelot
    z = {"id": zeile["id"], "fehler": ""}
    try:
        t = time.perf_counter()                         # tonart.py so, wie es im Repo steht (eigene Dekodierung)
        _, cam, r, vorsprung, _ = _tp.tonart(_tp.chroma(zeile["pfad"]))
        z.update(tp_key=cam, tp_r=round(float(r), 5), tp_vorsprung=round(float(vorsprung), 5),
                 t_tp=round(time.perf_counter() - t, 4))

        t = time.perf_counter()
        x = m.dekodiere(zeile["pfad"])
        z["t_dekodieren"] = round(time.perf_counter() - t, 4)
        for prof in ("edmm", "braw"):
            t = time.perf_counter()
            key, scale, staerke = _es.KeyExtractor(profileType=prof, sampleRate=m.SR)(x)
            z[f"x_{prof}_key"] = zu_camelot(*aus_name(key, scale))
            z[f"t_{prof}"] = round(time.perf_counter() - t, 4)
            if prof == "edmm":
                z["x_edmm_staerke"] = round(float(staerke), 5)
        t = time.perf_counter()
        z["x_kf_key"], _ = m.keyfinder(x)
        z["t_kf"] = round(time.perf_counter() - t, 4)
    except Exception:
        z["fehler"] = traceback.format_exc(limit=2).replace("\n", " | ")
    return z


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prozesse", type=int, default=3)
    ap.add_argument("--block", type=int, default=30)
    ap.add_argument("--max-last", type=float, default=6.0)
    a = ap.parse_args()
    os.nice(19 - os.nice(0))
    with open(CACHE / "labels.csv") as f:
        zeilen = list(csv.DictReader(f))
    fertig = set()
    if AUS.exists():
        with open(AUS) as f:
            fertig = {r["id"] for r in csv.DictReader(f) if not r["fehler"]}
    offen = [z for z in zeilen if z["id"] not in fertig]
    neu = not AUS.exists()
    t0 = time.time()
    with open(AUS, "a", newline="") as f, get_context("spawn").Pool(a.prozesse, initializer=_init) as pool:
        w = csv.DictWriter(f, fieldnames=FELDER)
        if neu:
            w.writeheader()
        for i in range(0, len(offen), a.block):
            while (l := os.getloadavg()[0]) > a.max_last:
                print(f"  Last {l:.2f} > {a.max_last}, warte 60 s", flush=True)
                time.sleep(60)
            for z in pool.imap_unordered(_eins, offen[i:i + a.block]):
                w.writerow(z)
            f.flush()
            print(f"  {min(i + a.block, len(offen))}/{len(offen)} · {time.time() - t0:.0f} s · "
                  f"Last {os.getloadavg()[0]:.2f}", flush=True)


if __name__ == "__main__":
    main()
