"""`similar_to` rows by nearest neighbours over the cached Pass B features (table `merkmal`).

Per item at most k neighbours, nearest first in `wert` (the distance), only inside the same `item.art`. The vector is
log(zentroid_hz) and six shares or ratios, each z-scored over its art group. Imports scipy, so tags_messen loads this module
only when the neighbours are built.
"""
from __future__ import annotations

import json
import sqlite3

import numpy as np
from scipy.spatial import cKDTree

from . import tags_store as speicher

SCHLUESSEL = ("zentroid_hz", "anteil_sub", "anteil_tief_mitten", "anteil_hoch", "anteil_luft", "crest", "korrelation")
HERKUNFT = "gemessen"


def _vektor(daten: str) -> list[float] | None:
    try:
        m = json.loads(daten)
        v = [float(m[k]) for k in SCHLUESSEL]
    except (ValueError, KeyError, TypeError):
        return None
    v[0] = float(np.log(max(v[0], 1.0)))
    return v if all(np.isfinite(v)) else None


def baue_aehnliche(store: sqlite3.Connection, k: int = 5) -> int:
    """Rebuild every similar_to row of herkunft gemessen; returns their count. Rows of other producers stay."""
    gruppen: dict[str, tuple[list[str], list[list[float]]]] = {}
    zeilen = store.execute("SELECT i.id AS id, i.art AS art, m.daten AS daten FROM item i JOIN merkmal m ON 'datei:' || m.sha = i.id "
                           "ORDER BY i.id")
    for z in zeilen:
        v = _vektor(z["daten"])
        if v is not None:
            ids, vek = gruppen.setdefault(z["art"], ([], []))
            ids.append(z["id"])
            vek.append(v)

    neu: list[tuple[str, str, float]] = []
    for ids, vek in gruppen.values():
        if len(ids) < 2:
            continue
        x = np.asarray(vek, dtype=np.float64)
        sd = x.std(axis=0)
        x = (x - x.mean(axis=0)) / np.where(sd > 1e-12, sd, 1.0)
        kk = min(k, len(ids) - 1)
        abstand, index = cKDTree(x).query(x, k=kk + 1)
        for i, (ds, js) in enumerate(zip(abstand, index)):
            kandidaten = [(round(float(d), 12), ids[j]) for d, j in zip(ds, js) if j != i]
            kandidaten.sort()                                   # ties broken by id
            neu.extend((ids[i], nach, d) for d, nach in kandidaten[:kk])

    jetzt = speicher._jetzt()
    with speicher.schreiben(store):
        store.execute("DELETE FROM relation WHERE art = 'similar_to' AND herkunft = ?", (HERKUNFT,))
    for a in range(0, len(neu), speicher.CHUNK):
        with speicher.schreiben(store):
            store.executemany("INSERT OR IGNORE INTO relation(von, art, nach, herkunft, wert, zeit) "
                              f"VALUES (?, 'similar_to', ?, '{HERKUNFT}', ?, ?)",
                              [(v, n, d, jetzt) for v, n, d in neu[a:a + speicher.CHUNK]])
    return len(neu)
