"""Schritt 2a, Lauf 2: Essentia-KeyExtractor mit Parameter-Varianten je Track.

Befund aus dem Cache: alle guten Profile treffen den MIK-Grundton zu ~74-75 %, sie unterscheiden sich
fast nur im Tongeschlecht. Hier wird deshalb geprüft, ob andere Analyse-Parameter (Auflösung,
Frequenzbereich, Stimmungsschätzung, Ausschnitt) den Grundton verbessern. Auswahl der Variante auf
einer Artist-Hälfte, Prüfung auf der anderen (vergleich_tonart.py).

Ausgabe: ~/cypher-dj/cues/merkmale/tonart_varianten.csv (lang: id, variante, profil, key, staerke, t).
Aufruf: cd djk && ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.tonart_varianten [--prozesse 3]
"""
from __future__ import annotations

import argparse
import csv
import os
import time
import traceback
from multiprocessing import get_context

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import numpy as np

from .stichprobe import CACHE

AUS = CACHE / "tonart_varianten.csv"
PROFILE = ("edma", "edmm", "bgate", "braw")
# name -> (KeyExtractor-Parameter, Ausschnitt-Funktion oder None, Stimmung schätzen?)
VARIANTEN = {
    "standard": ({}, None, False),
    "hpcp36": ({"hpcpSize": 36}, None, False),
    "fenster16k": ({"frameSize": 16384, "hopSize": 8192}, None, False),
    "bis1000hz": ({"maxFrequency": 1000}, None, False),
    "ab100hz": ({"minFrequency": 100}, None, False),
    "stimmung": ({}, None, True),
    "mitte70": ({}, "mitte70", False),
    "fenster16k_hpcp36": ({"frameSize": 16384, "hopSize": 8192, "hpcpSize": 36}, None, False),
}
FELDER = ["id", "variante", "profil", "key", "staerke", "t", "stimmung_hz", "fehler"]
_es = None


def _init() -> None:
    global _es
    os.nice(19 - os.nice(0))
    import essentia
    essentia.log.infoActive = False
    essentia.log.warningActive = False
    import essentia.standard as es
    _es = es


def stimmung(x: np.ndarray, es, sr: int) -> float:
    """Median der Frame-Stimmung (Essentia TuningFrequencyExtractor), auf 427..453 Hz begrenzt."""
    f = es.TuningFrequencyExtractor(frameSize=4096, hopSize=8192)(x)
    f = np.asarray(f)
    return float(np.clip(np.median(f), 427.0, 453.0)) if len(f) else 440.0


def _eins(zeile: dict) -> list[dict]:
    from . import merkmale as m
    from .camelot import aus_name, zu_camelot
    zeilen = []
    try:
        x = m.dekodiere(zeile["pfad"])
        t = time.perf_counter()
        f_st = stimmung(x, _es, m.SR)
        t_st = time.perf_counter() - t
        n = len(x)
        for name, (par, ausschnitt, mit_stimmung) in VARIANTEN.items():
            xx = x[int(n * 0.15): int(n * 0.85)] if ausschnitt == "mitte70" else x
            p = dict(par)
            if mit_stimmung:
                p["tuningFrequency"] = f_st
            for prof in PROFILE:
                t = time.perf_counter()
                key, scale, staerke = _es.KeyExtractor(profileType=prof, sampleRate=m.SR, **p)(xx)
                dt = time.perf_counter() - t + (t_st if mit_stimmung else 0.0)
                zeilen.append({"id": zeile["id"], "variante": name, "profil": prof,
                               "key": zu_camelot(*aus_name(key, scale)), "staerke": round(float(staerke), 5),
                               "t": round(dt, 4), "stimmung_hz": round(f_st, 3), "fehler": ""})
    except Exception:
        zeilen.append({"id": zeile["id"], "fehler": traceback.format_exc(limit=2).replace("\n", " | ")})
    return zeilen


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
            for zz in pool.imap_unordered(_eins, offen[i:i + a.block]):
                w.writerows(zz)
            f.flush()
            print(f"  {min(i + a.block, len(offen))}/{len(offen)} · {time.time() - t0:.0f} s · "
                  f"Last {os.getloadavg()[0]:.2f}", flush=True)


if __name__ == "__main__":
    main()
