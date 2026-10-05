"""Gesamtmessung: Merkmale (Cache), Einstellen auf dev, Messung auf test und cues, Grundlinien,
Raster-Rueckfall, Ablationen. Schreibt berichte/messung.json und berichte/rohdaten.json.

Aufruf (aus djk/strukturvorschlag):  nice -n 19 python3 -m strukturvorschlag.lauf_messung [--cache DIR]
"""
import argparse
import itertools
import json
import os
import sys
import threading
import time

import numpy as np

from . import nml, messung, detektor, VERSION

HIER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class LastWaechter(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.max1 = 0.0
        self.stop = False

    def run(self):
        while not self.stop:
            self.max1 = max(self.max1, last1())
            time.sleep(2)


def last1():
    with open("/proc/loadavg") as f:
        return float(f.read().split()[0])


def gitter():
    boni = {"ohne": {}, "mild": {8: 0.25, 16: 0.5, 32: 0.5}, "stark": {4: 0.25, 8: 0.6, 16: 1.0, 32: 1.2}}
    for w, sch, mjm, bn, ph, g, mab in itertools.product(
            (2, 4, 8), (2.0, 4.0, 6.0), (1.0, 1.5, 2.0, 3.0), boni, ("anker", "geschaetzt"),
            ((1.0, 0.7, 0.7), (1.0, 1.0, 1.0), (1.0, 0.5, 1.0)), (2, 4, 8)):
        yield bn, detektor.Parameter(w=w, schwelle_db=sch, max_je_min=mjm, bonus=boni[bn], phase=ph,
                                     gewichte=g, radius=2, min_abstand=mab, anfang=True)


def ziel(ergebnis):
    d, a = ergebnis["detektor"], ergebnis["a16"]
    return min(d["recall"] / max(a["recall"], 1e-9), d["praezision_min"] / max(a["praezision_min"], 1e-9))


def kurz(e):
    return {k: {kk: vv for kk, vv in v.items() if kk != "zeilen"} for k, v in e.items()}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(HIER, ".cache"))
    ap.add_argument("--aus", default=os.path.join(HIER, "berichte"))
    a = ap.parse_args(argv)
    l0 = last1()
    if l0 > 4:
        print(f"1-min-Last {l0} > 4: nicht gestartet", file=sys.stderr)
        return 2
    os.nice(19)
    waechter = LastWaechter()
    waechter.start()
    t_start = time.time()
    samm = nml.lies_sammlung(messung.NML)
    sp = messung.stichproben(samm)
    alle = {e["pfad"]: e for k in ("dev", "test", "cues") for e in sp[k]}
    _, zeiten = messung.lade_tracks(list(alle.values()), a.cache, prozesse=3)
    tr = {p: messung.Track(e, a.cache) for p, e in alle.items()}
    dev = [tr[e["pfad"]] for e in sp["dev"]]
    test = [tr[e["pfad"]] for e in sp["test"]]
    cues = [tr[e["pfad"]] for e in sp["cues"]]

    # 1) Einstellen nur auf dev
    tuning = []
    for bn, p in gitter():
        e = messung.bewerte(dev, p)
        tuning.append({"bonus": bn, "p": p, "ziel": ziel(e), "det": kurz(e)["detektor"], "a16": kurz(e)["a16"]})
    tuning.sort(key=lambda x: -x["ziel"])
    best = tuning[0]["p"]

    # 2) Messung test, cues
    e_test = messung.bewerte(test, best, n_saaten=100)
    e_cues = messung.bewerte(cues, best, nur_cues=True, n_saaten=100)
    boot = {k: messung.bootstrap(e_test["detektor"]["zeilen"], e_test[k]["zeilen"])
            for k in ("a16", "b16", "a16_versatz", "b8", "b1")}
    boot_c = {k: messung.bootstrap(e_cues["detektor"]["zeilen"], e_cues[k]["zeilen"])
              for k in ("a16", "b16", "b8", "b1")}

    # 3) Ablationen auf test (nur Bericht, keine Auswahl)
    abl = {}
    for name, aend in {"ohne_anfang": {"anfang": False}, "phase_anker": {"phase": "anker"},
                       "phase_geschaetzt": {"phase": "geschaetzt"}, "ohne_bonus": {"bonus": {}}}.items():
        q = detektor.Parameter(**{**best.__dict__, **aend})
        abl[name] = kurz(messung.bewerte(test, q))["detektor"]
    # Klassenbeitrag
    klassen = {}
    for t in test:
        v, _ = t.detektor(best)
        ms = t.marken()
        for x in v:
            hm, hv = t.treffer([x["sekunde"]], ms)
            k = klassen.setdefault(x["klasse"], [0, 0])
            k[0] += 1
            k[1] += hv

    # 4) Raster-Rueckfall: eigenes Raster statt Traktor-Grid auf test
    rf_tracks, abw = [], []
    for e in sp["test"]:
        t2 = messung.Track(e, a.cache, erzwinge_eigen=True)
        rf_tracks.append(t2)
        if e.get("grid_ms") is not None and e.get("bpm_traktor"):
            beat_t = 60.0 / e["bpm_traktor"]
            d = (t2.r["anker_s"] - e["grid_ms"] / 1000.0)
            beat_off = ((d + beat_t / 2) % beat_t) - beat_t / 2
            takt_off = int(round((d - beat_off) / beat_t)) % 4
            abw.append({"datei": os.path.basename(e["pfad"]), "bpm_traktor": e["bpm_traktor"],
                        "bpm_eigen": round(t2.r["bpm"], 3), "tbpm": t2.tags.get("tbpm"),
                        "beat_versatz_ms": round(beat_off * 1000, 1), "eins_lage": takt_off})
    e_rf = kurz(messung.bewerte(rf_tracks, best))

    # 5) Rohdaten je Track (test und cues)
    roh = []
    for name, menge, nur in (("test", test, False), ("cues", cues, True)):
        for t in menge:
            v, info = t.detektor(best)
            ms = t.marken(nur)
            roh.append({"menge": name, "datei": t.e["pfad"], "raster": {k: (float(v2) if not isinstance(v2, str) else v2)
                        for k, v2 in t.r.items() if k in ("bpm", "anker_s", "takt_s", "quelle")},
                        "toleranz_s": round(t.tol, 4), "phrasen_versatz": info["phrasen_versatz"],
                        "marken": [{"s": round(m["ms"] / 1000, 3), "typ": m["typ"], "name": m["name"]}
                                   for m in t.e["marken"] if (m["typ"] == "cue" or not nur)],
                        "marken_bewertet_s": [round(x, 3) for x in ms],
                        "vorschlaege": v, "treffer": dict(zip(("marken", "vorschlaege"), t.treffer(
                            [x["sekunde"] for x in v], ms))),
                        "laufzeit_s": t.laufzeit, "merkmale_s": round(zeiten[t.e["pfad"]][0], 3)})
    waechter.stop = True
    rz = np.array([zeiten[p][0] for p in zeiten if not zeiten[p][1]])
    det_zeit = []
    for t in test:
        t0 = time.perf_counter()
        t.detektor(best)
        det_zeit.append(time.perf_counter() - t0)
    aus = {
        "version": VERSION, "datum": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "stichprobe": {"eintraege_mit_markierungen": sp["n_mit"], "test": len(test), "dev": len(dev),
                       "cues_tracks": len(cues),
                       "cues": sum(len(t.marken(True)) for t in cues),
                       "ueberlappung_test_cues": len({t.e['pfad'] for t in test} & {t.e['pfad'] for t in cues}),
                       "test_ohne_grid": sum(1 for t in test if t.r["quelle"] != "traktor")},
        "gewaehlt": best.als_dict(), "tuning_top10": [{"bonus": x["bonus"], "p": x["p"].als_dict(),
                                                     "ziel": x["ziel"], "det": x["det"], "a16": x["a16"]}
                                                    for x in tuning[:10]],
        "tuning_n": len(tuning),
        "test": kurz(e_test), "test_bootstrap": boot, "cues": kurz(e_cues), "cues_bootstrap": boot_c,
        "ablation_test": abl, "klassen_test": {k: {"n": v[0], "nahe_markierung": v[1]} for k, v in klassen.items()},
        "raster_rueckfall_test": e_rf, "raster_abweichung": abw,
        "laufzeit": {"merkmale_s_median": float(np.median(rz)) if len(rz) else None,
                     "merkmale_s_max": float(rz.max()) if len(rz) else None, "neu_berechnet": int(len(rz)),
                     "detektor_s_median": float(np.median(det_zeit)), "gesamt_s": round(time.time() - t_start, 1)},
        "last": {"vorher_1min": l0, "max_1min_waehrend": waechter.max1},
    }
    os.makedirs(a.aus, exist_ok=True)
    with open(os.path.join(a.aus, "messung.json"), "w", encoding="utf-8") as f:
        json.dump(aus, f, ensure_ascii=False, indent=1, default=float)
    with open(os.path.join(a.aus, "rohdaten.json"), "w", encoding="utf-8") as f:
        json.dump(roh, f, ensure_ascii=False, indent=0, default=float)
    print(json.dumps({k: aus[k] for k in ("stichprobe", "gewaehlt", "laufzeit", "last")}, default=float, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
