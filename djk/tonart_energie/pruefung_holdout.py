"""Prüfung am Ziel: energie(pfad) auf MIK-Tracks, die weder in der Stichprobe noch in einem ihrer Alben sind.

Der Holdout ist nach Pfad sortiert und gleichmäßig verteilt (floor(i·N/n)). Dazu 3 Stichproben-Tracks als
Wiedergabe-Kontrolle: energie(pfad) muss dort denselben Wert liefern wie das Modell auf den Cache-Merkmalen.
3 Prozesse, Nice 19, nur CPU, Lastprüfung vor jedem Block.

Aufruf: cd djk && nice -n 19 ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.pruefung_holdout [--n 60]
"""
from __future__ import annotations

import argparse
import json
import os
import time
from multiprocessing import get_context

from . import energie_level  # noqa: F401  (setzt die Thread-Grenzen vor numpy)
import numpy as np
import pandas as pd

from .energie_modell import BERICHTE, CACHE, last_warten


def _init() -> None:
    os.nice(19 - os.nice(0))
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    log = open(CACHE / "holdout.stderr.log", "a")
    os.dup2(log.fileno(), 2)
    from . import energie_level
    energie_level._laden()


def _eins(pfad: str) -> tuple[str, dict | None, str | None, float]:
    from .energie_level import energie
    t = time.perf_counter()
    try:
        return pfad, energie(pfad), None, time.perf_counter() - t
    except Exception as e:                                       # noqa: BLE001
        return pfad, None, repr(e), time.perf_counter() - t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--prozesse", type=int, default=3)
    a = ap.parse_args()
    os.nice(19 - os.nice(0))
    tags = pd.read_csv(CACHE / "tags.csv", dtype=str).fillna("")
    stich = pd.read_csv(CACHE / "labels.csv", dtype=str).fillna("")
    ok = tags[tags["energy"].str.fullmatch(r"\d+") & tags["tkey"].str.fullmatch(r"\d{1,2}[AB]")]
    frei = ok[~ok["pfad"].isin(stich["pfad"]) & ~ok["album"].isin(stich["album"])].sort_values("pfad")
    idx = [int(i * len(frei) / a.n) for i in range(a.n)]
    hold = frei.iloc[idx]
    kontrolle = stich.sort_values("pfad").iloc[[0, 300, 599]]
    print(f"gültig {len(ok)}, frei (Pfad und Album nicht in Stichprobe) {len(frei)}, Holdout {len(hold)}", flush=True)

    pfade = list(kontrolle["pfad"]) + list(hold["pfad"])
    res, t0 = {}, time.time()
    with get_context("spawn").Pool(a.prozesse, initializer=_init) as pool:
        for i in range(0, len(pfade), 15):
            last_warten()
            for pfad, r, err, dt in pool.imap_unordered(_eins, pfade[i:i + 15]):
                res[pfad] = {"ergebnis": r, "fehler": err, "t_s": dt}
            print(f"  {min(i + 15, len(pfade))}/{len(pfade)} · {time.time() - t0:.0f} s · Last {os.getloadavg()[0]:.2f}",
                  flush=True)

    # Wiedergabe-Kontrolle: Modell auf Cache-Merkmalen (CSV + npz) gegen energie(pfad)
    from .energie_level import aus_merkmalen, paket
    d = pd.read_csv(CACHE / "merkmale.csv").set_index("pfad")
    klassen = json.load(open(os.path.expanduser(
        "~/cypher-dj/cues/venv-mik/modelle/mtg_jamendo_moodtheme-discogs-effnet-1.json")))["classes"]
    wiedergabe = []
    for pfad in kontrolle["pfad"]:
        zeile = d.loc[pfad].to_dict()
        z = np.load(CACHE / "npz" / f"{zeile['id']}.npz")
        zeile.update({f"jam56_{c}": float(v) for c, v in zip(klassen, z["jamendo56"])})
        cache_w = aus_merkmalen(zeile)["wert"]
        live = res[pfad]["ergebnis"]
        wiedergabe.append({"pfad": pfad, "cache_wert": cache_w, "live_wert": live and live["wert"],
                           "mik": int(zeile["energy"])})

    y, lv, wv, fehler = [], [], [], []
    for _, r in hold.iterrows():
        e = res[r["pfad"]]
        if e["ergebnis"] is None:
            fehler.append((r["pfad"], e["fehler"]))
            continue
        y.append(int(r["energy"])); lv.append(e["ergebnis"]["level"]); wv.append(e["ergebnis"]["wert"])
    y, lv, wv = map(np.array, (y, lv, wv))
    median_train = float(np.median(pd.read_csv(CACHE / "labels.csv")["energy"]))
    out = {
        "n_holdout": int(len(hold)), "n_ok": int(len(y)), "fehler": fehler,
        "modell": {k: paket()[k] for k in ("name", "satz")},
        "mae": float(np.mean(np.abs(lv - y))), "exakt": float(np.mean(lv == y)),
        "pm1": float(np.mean(np.abs(lv - y) <= 1)),
        "median_grundlinie": {"wert": median_train, "mae": float(np.mean(np.abs(median_train - y))),
                              "exakt": float(np.mean(y == median_train)),
                              "pm1": float(np.mean(np.abs(y - median_train) <= 1))},
        "mik_verteilung": {int(k): int(v) for k, v in zip(*np.unique(y, return_counts=True))},
        "modell_verteilung": {int(k): int(v) for k, v in zip(*np.unique(lv, return_counts=True))},
        "wiedergabe_kontrolle": wiedergabe,
        "t_median_s": float(np.median([v["t_s"] for v in res.values()])),
        "zeilen": [{"pfad": p, "mik": int(hold.set_index("pfad").loc[p, "energy"]), **(res[p]["ergebnis"] or {})}
                   for p in hold["pfad"]],
        "laufzeit_s": time.time() - t0,
    }
    (BERICHTE / "schritt2b_holdout.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(json.dumps({k: v for k, v in out.items() if k != "zeilen"}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
