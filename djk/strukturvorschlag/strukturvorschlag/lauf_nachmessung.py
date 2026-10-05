"""Nachmessung nach der Pruefung (2026-09-26): Messgeraet v2 (Schlag-Raster, faire Grundlinie (b),
bereinigte Wahrheit), Parameter v1 und v2 UNVERAENDERT (kein neues Einstellen).

Mengen: test (Pflicht), cues (188 echte Cues), frisch (Index % 7 == 5, erste 120), gepoolt test+frisch.
Dazu: Empfindlichkeit gegen die alte ms-Kante (+-50 ms), Raster-Rueckfall, Klassen, Zeitachse
(Kick-Huelle gegen Traktor-Grid), Unversehrtheit der NML. Nur Merkmals-Cache, ein Prozess, nice 19.
Schreibt berichte/nachmessung.json und berichte/rohdaten_nachmessung.json.

Aufruf (aus djk/strukturvorschlag):  python3 -m strukturvorschlag.lauf_nachmessung <cache-dir>
"""
import hashlib
import json
import os
import sys
import time

import numpy as np

from . import nml, messung, detektor, lauf, raster as rastermod, VERSION
from .lauf_messung import LastWaechter, last1, kurz, HIER

VERGLEICH = ("a16", "b16", "b16_ungefuellt", "b8", "b1")


def urteil(e, boot):
    d = e["detektor"]
    z = {}
    for k in ("a16", "b16"):
        z[k] = {"punkt_recall": d["recall"] > e[k]["recall"],
                "punkt_praez": d["praezision_min"] > e[k]["praezision_min"],
                "signifikant_recall": boot[k]["recall_diff_ki95"][0] > 0,
                "signifikant_praez": boot[k]["praez_diff_ki95"][0] > 0}
    z["bestanden_punkt"] = all(v["punkt_recall"] and v["punkt_praez"] for k, v in z.items() if k in ("a16", "b16"))
    z["bestanden_signifikant"] = all(v["signifikant_recall"] and v["signifikant_praez"]
                                     for k, v in z.items() if k in ("a16", "b16"))
    return z


def messe(tracks, p, nur_cues=False, toleranz="schlag", saaten=100):
    e = messung.bewerte(tracks, p, nur_cues=nur_cues, n_saaten=saaten, toleranz=toleranz)
    boot = {k: messung.bootstrap(e["detektor"]["zeilen"], e[k]["zeilen"]) for k in VERGLEICH}
    return {"kennzahlen": kurz(e), "bootstrap": boot, "urteil": urteil(e, boot)}


def knapp(tracks, p):
    """Markierungen, deren naechster Detektor-Vorschlag 1,00 bis 1,03 Takte entfernt ist (alte Kante)."""
    n = 0
    for t in tracks:
        v, _ = t.detektor(p)
        vs = np.array([x["sekunde"] for x in v])
        if len(vs) == 0:
            continue
        for m in t.marken():
            d = np.abs(vs - m).min() / t.tol
            n += int(1.0 < d <= 1.03)
    return n


def zeitachse(tracks, cache):
    """Maximum der Kick-Huelle (Tiefband-Onsets), gefaltet auf den Traktor-Beat ab Grid, in ms."""
    off = []
    for t in tracks:
        fm, _ = lauf.frame_merkmale_fuer(t.e["pfad"], cache)
        env = rastermod.kick_huelle(fm)
        fps = fm["sr"] / fm["hop"]
        tt = np.arange(len(env)) / fps
        ph = ((tt - t.schlag_anker) / t.beat) % 1.0
        ph[ph >= 0.5] -= 1.0
        bins = np.linspace(-0.5, 0.5, 101)
        h, _ = np.histogram(ph, bins=bins, weights=env)
        c, _ = np.histogram(ph, bins=bins)
        j = int(np.argmax(h / np.maximum(c, 1)))
        off.append((bins[j] + bins[j + 1]) / 2 * t.beat * 1000)
    off = np.array(off)
    roh = {"median_ms": float(np.median(off)), "p10_ms": float(np.percentile(off, 10)),
           "p90_ms": float(np.percentile(off, 90)), "n": int(len(off))}
    roh["nach_fensterausgleich_ms"] = roh["median_ms"] + rastermod.KICK_VERSATZ_S * 1000
    return roh


def sha1(pfad):
    h = hashlib.sha1()
    with open(pfad, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main(cache):
    l0 = last1()
    if l0 > 4:
        print(f"1-min-Last {l0} > 4: nicht gestartet", file=sys.stderr)
        return 2
    os.nice(19)
    lw = LastWaechter()
    lw.start()
    t0 = time.time()
    st_nml = os.stat(messung.NML)
    nml_vorher = {"sha1": sha1(messung.NML), "mtime": st_nml.st_mtime, "bytes": st_nml.st_size}
    samm = nml.lies_sammlung(messung.NML)
    sp = messung.stichproben(samm)
    mit = [e for e in samm if e["marken"]]
    frisch_e = [e for i, e in enumerate(mit) if i % 7 == 5][:120]
    tr = {}
    for e in sp["test"] + sp["cues"] + frisch_e:
        if e["pfad"] not in tr:
            tr[e["pfad"]] = messung.Track(e, cache)
    test = [tr[e["pfad"]] for e in sp["test"]]
    cues = [tr[e["pfad"]] for e in sp["cues"]]
    frisch = [tr[e["pfad"]] for e in frisch_e]
    neu = [t for t in tr.values() if not t.laufzeit.get("aus_cache", True)]
    v1, v2 = detektor.profil("v1"), detektor.profil("v2")

    def roh_marken(ts, nur=False):
        return sum(1 for t in ts for m in t.e["marken"] if (m["typ"] == "cue" or not nur))

    aus = {"version": VERSION, "datum": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "messgeraet": "v2: Schlag-Raster (Traktor-Grid), Treffer <= 4 Schlaege; (b) auf gleiche Anzahl "
                         "aufgefuellt (16er, dann 8er, dann alle Takte); ohne AutoGrid, eine Markierung je Schlag",
           "parameter": {"v1": v1.als_dict(), "v2": v2.als_dict()},
           "wahrheit": {"test_roh": roh_marken(test), "test_bewertet": sum(len(t.marken()) for t in test),
                        "cues_roh": roh_marken(cues, True), "cues_bewertet": sum(len(t.marken(True)) for t in cues),
                        "frisch_roh": roh_marken(frisch), "frisch_bewertet": sum(len(t.marken()) for t in frisch)},
           "neu_dekodiert": len(neu)}
    for name, menge, nur in (("test", test, False), ("cues", cues, True), ("frisch", frisch, False),
                             ("gepoolt", test + frisch, False)):
        for vn, p in (("v1", v1), ("v2", v2)):
            aus[f"{name}_{vn}"] = messe(menge, p, nur)
    # Empfindlichkeit: alte ms-Kante, +-50 ms (v1)
    aus["empfindlichkeit"] = {}
    for name, menge in (("test", test), ("frisch", frisch)):
        for tn, tol in (("schlag", "schlag"), ("ms", ("ms", 0.0)), ("ms+50", ("ms", 0.05)), ("ms-50", ("ms", -0.05))):
            e = kurz(messung.bewerte(menge, v1, toleranz=tol))
            aus["empfindlichkeit"][f"{name}_{tn}"] = {k: {"recall": e[k]["recall"], "praez": e[k]["praezision_min"],
                                                          "vorschlaege": e[k]["vorschlaege"]}
                                                      for k in ("detektor", "a16", "b16")}
    aus["knapp_verfehlt_alte_kante_test_v1"] = knapp(test, v1)
    # Raster-Rueckfall (eigenes Raster), test, v1
    rf = [messung.Track(e, cache, erzwinge_eigen=True) for e in sp["test"]]
    aus["raster_rueckfall_test_v1"] = messe(rf, v1, saaten=0)
    # Klassen
    for name, menge, p in (("test_v1", test, v1), ("frisch_v2", frisch, v2)):
        kl = {}
        for t in menge:
            v, _ = t.detektor(p)
            ms = t.marken()
            for x in v:
                _, hv = t.treffer([x["sekunde"]], ms)
                k = kl.setdefault(x["klasse"], [0, 0])
                k[0] += 1
                k[1] += hv
        aus[f"klassen_{name}"] = {k: {"n": a, "nahe_markierung": b} for k, (a, b) in kl.items()}
    aus["zeitachse_test"] = zeitachse(test, cache)
    roh = []
    for name, menge, nur in (("test", test, False), ("cues", cues, True)):
        for t in menge:
            v, _ = t.detektor(v1)
            ms = t.marken(nur)
            roh.append({"menge": name, "datei": t.e["pfad"],
                        "schlag_raster": {"anker_s": t.schlag_anker, "beat_s": t.beat},
                        "marken_bewertet_s": [round(x, 4) for x in ms],
                        "vorschlaege_v1": v,
                        "treffer_v1": dict(zip(("marken", "vorschlaege"), t.treffer([x["sekunde"] for x in v], ms)))})
    st2 = os.stat(messung.NML)
    aus["nml"] = {"vorher": nml_vorher, "nachher": {"sha1": sha1(messung.NML), "mtime": st2.st_mtime,
                                                    "bytes": st2.st_size}}
    lw.stop = True
    aus["last"] = {"vorher_1min": l0, "max_1min_waehrend": lw.max1, "gesamt_s": round(time.time() - t0, 1)}
    with open(os.path.join(HIER, "berichte", "nachmessung.json"), "w", encoding="utf-8") as f:
        json.dump(aus, f, ensure_ascii=False, indent=1, default=float)
    with open(os.path.join(HIER, "berichte", "rohdaten_nachmessung.json"), "w", encoding="utf-8") as f:
        json.dump(roh, f, ensure_ascii=False, indent=0, default=float)
    print(json.dumps({k: aus[k] for k in ("wahrheit", "neu_dekodiert", "last", "nml")}, default=float, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
