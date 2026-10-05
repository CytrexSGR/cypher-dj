"""Erkundung nur auf dev (60 Tracks): Wo liegen Andreas' Markierungen relativ zu Neuheitsspitzen?
Signierter Abstand Markierung - naechste Spitze (Takte), gegen gleich viele Zufallspositionen.
Nullhypothesen: kontinuierlich (gleichverteilt, wie in der ersten Fassung), auf ganzen Takten und auf
geraden Takten (Markierungen liegen auf Takten, meist geraden; nur so ist der Vergleich bei 0 fair).
Schreibt berichte/erkundung_dev.json."""
import collections
import json
import os
import sys

import numpy as np

from . import nml, messung, detektor
from .lauf_messung import HIER


def main(cache):
    sp = messung.stichproben(nml.lies_sammlung(messung.NML))
    dev = [messung.Track(e, cache) for e in sp["dev"]]
    p = detektor.Parameter(w=4, gewichte=(1.0, 0.7, 0.7), schwelle_db=0, max_je_min=1.5, min_abstand=4,
                           radius=2, bonus={}, anfang=False, phase="anker")
    h = collections.Counter()
    nullen = {"kontinuierlich": collections.Counter(), "takte": collections.Counter(),
              "gerade_takte": collections.Counter()}
    for t in dev:
        v, _ = t.detektor(p)
        pk = np.array([x["takt"] for x in v])
        if len(pk) == 0:
            continue
        for m in t.marken():
            x = (m - t.r["anker_s"]) / t.r["takt_s"]
            dd = x - pk
            h[int(np.round(dd[np.argmin(np.abs(dd))]))] += 1
        n, hoch = len(t.marken()), int(t.r["nummern"][-1])
        rng = np.random.default_rng(1)
        ziehung = {"kontinuierlich": rng.uniform(0, hoch, n), "takte": rng.integers(0, hoch + 1, n),
                   "gerade_takte": 2 * rng.integers(0, hoch // 2 + 1, n)}
        for name, xs in ziehung.items():
            for x in xs:
                dd = x - pk
                nullen[name][int(np.round(dd[np.argmin(np.abs(dd))]))] += 1
    aus = {"parameter": p.als_dict(), "n_markierungen": sum(h.values()),
           "abstand_takte": {k: {"markierungen": h[k], **{f"zufall_{nm}": c[k] for nm, c in nullen.items()}}
                             for k in range(-6, 9)}}
    with open(os.path.join(HIER, "berichte", "erkundung_dev.json"), "w", encoding="utf-8") as f:
        json.dump(aus, f, ensure_ascii=False, indent=1)
    for k in range(-6, 9):
        print(k, h[k], *[c[k] for c in nullen.values()])


if __name__ == "__main__":
    main(sys.argv[1])
