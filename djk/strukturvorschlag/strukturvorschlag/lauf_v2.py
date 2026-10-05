"""Zweite Runde (nach dem Scheitern von v1 auf test): groessere dev-Menge, frische Pruefmenge.

dev_gross = Index % 7 in {1,2,3,4} (Eintraege mit Markierungen, nach Pfad sortiert)
frisch    = Index % 7 == 5, die ersten 120 (vorher nie angesehen, genau ein Blick)
test      = Index % 7 == 0 (schon fuer v1 benutzt; v2 dort nur als zweiter Blick berichtet)
Einstellen nur auf dev_gross. v1 bleibt unveraendert als Vergleich.
Schreibt berichte/messung_v2.json.
"""
import itertools
import json
import os
import sys
import time

import numpy as np

from . import nml, messung, detektor
from .lauf_messung import LastWaechter, last1, kurz, ziel, HIER

V1 = dict(w=2, gewichte=(1.0, 1.0, 1.0), schwelle_db=6.0, bonus={4: 0.25, 8: 0.6, 16: 1.0, 32: 1.2},
          phase="anker", radius=2, min_abstand=2, max_je_min=3.0, anfang=True)


def gitter():
    boni = {"ohne": {}, "stark": {4: 0.25, 8: 0.6, 16: 1.0, 32: 1.2}}
    for ri, w, sch, mjm, bn, g in itertools.product(("steigend", "beide"), (2, 4), (2.0, 4.0, 6.0),
                                                     (2.0, 3.0, 4.0), boni, ((1.0, 1.0, 1.0), (1.0, 0.5, 1.0))):
        yield detektor.Parameter(w=w, schwelle_db=sch, max_je_min=mjm, bonus=boni[bn], phase="anker",
                                 gewichte=g, radius=2, min_abstand=2, anfang=True, richtung=ri)


def main(cache):
    l0 = last1()
    if l0 > 4:
        print(f"1-min-Last {l0} > 4: nicht gestartet", file=sys.stderr)
        return 2
    os.nice(19)
    lw = LastWaechter()
    lw.start()
    t0 = time.time()
    samm = nml.lies_sammlung(messung.NML)
    mit = [e for e in samm if e["marken"]]
    dev_e = [e for i, e in enumerate(mit) if i % 7 in (1, 2, 3, 4)]
    frisch_e = [e for i, e in enumerate(mit) if i % 7 == 5][:120]
    test_e = messung.stichproben(samm)["test"]
    _, zeiten = messung.lade_tracks(dev_e + frisch_e, cache, prozesse=2)
    dev = [messung.Track(e, cache) for e in dev_e]
    tuning = []
    for p in gitter():
        e = messung.bewerte(dev, p)
        tuning.append((ziel(e), p, kurz(e)["detektor"], kurz(e)["a16"], kurz(e)["b16"]))
    tuning.sort(key=lambda x: -x[0])
    v2 = tuning[0][1]
    v1 = detektor.Parameter(**V1)
    e_dev_v1 = kurz(messung.bewerte(dev, v1))
    frisch = [messung.Track(e, cache) for e in frisch_e]
    test = [messung.Track(e, cache) for e in test_e]
    aus = {"dev_n": len(dev), "frisch_n": len(frisch), "v2": v2.als_dict(), "dev_v1": e_dev_v1,
           "tuning_top10": [{"ziel": z, "p": p.als_dict(), "det": d, "a16": a, "b16": b} for z, p, d, a, b in tuning[:10]],
           "tuning_n": len(tuning)}
    for name, menge in (("frisch", frisch), ("test_zweiter_blick", test)):
        for vn, p in (("v1", v1), ("v2", v2)):
            e = messung.bewerte(menge, p, n_saaten=100)
            aus[f"{name}_{vn}"] = kurz(e)
            aus[f"{name}_{vn}_bootstrap"] = {k: messung.bootstrap(e["detektor"]["zeilen"], e[k]["zeilen"])
                                             for k in ("a16", "b16", "b8", "b1")}
    kl = {}
    for t in frisch:
        v, _ = t.detektor(v2)
        for x in v:
            _, hv = t.treffer([x["sekunde"]], t.marken())
            k = kl.setdefault(x["klasse"], [0, 0])
            k[0] += 1
            k[1] += hv
    aus["klassen_frisch_v2"] = {k: {"n": a, "nahe_markierung": b} for k, (a, b) in kl.items()}
    neu = np.array([z[0] for z in zeiten.values() if not z[1]])
    lw.stop = True
    aus["laufzeit"] = {"merkmale_neu": int(len(neu)),
                       "merkmale_s_median": float(np.median(neu)) if len(neu) else None,
                       "merkmale_s_p90": float(np.percentile(neu, 90)) if len(neu) else None,
                       "merkmale_s_max": float(neu.max()) if len(neu) else None,
                       "gesamt_s": round(time.time() - t0, 1)}
    aus["last"] = {"vorher_1min": l0, "max_1min_waehrend": lw.max1}
    with open(os.path.join(HIER, "berichte", "messung_v2.json"), "w", encoding="utf-8") as f:
        json.dump(aus, f, ensure_ascii=False, indent=1, default=float)
    print(json.dumps({k: aus[k] for k in ("dev_n", "frisch_n", "v2", "laufzeit", "last")}, default=float))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
