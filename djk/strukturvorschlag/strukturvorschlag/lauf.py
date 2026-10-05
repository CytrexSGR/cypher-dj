"""Ein Track -> Vorschlags-JSON (Schema docs/architektur/stand/strukturvorschlag.md).

Aufruf:  python3 -m strukturvorschlag.lauf <mp3> [--nml collection.nml] [--aus datei.json] [--eigen]
Raster: Traktor-Grid aus der NML, falls Eintrag und Grid vorhanden; sonst eigene Schaetzung aus TBPM.
"""
import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np

from . import SCHEMA, VERSION, audio, merkmale, nml, raster as rastermod, detektor


def _cache_datei(cache_dir, pfad):
    st = os.stat(pfad)
    h = hashlib.sha1(f"{os.path.abspath(pfad)}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:16]
    return os.path.join(cache_dir, f"fm_{h}.npz")


def frame_merkmale_fuer(pfad, cache_dir=None):
    if cache_dir:
        cd = _cache_datei(cache_dir, pfad)
        if os.path.exists(cd):
            z = np.load(cd)
            return {k: z[k] for k in ("t", "p", "flach", "fluss")} | {
                "sr": int(z["sr"]), "hop": int(z["hop"]), "dauer_s": float(z["dauer_s"])}, True
    y = audio.lade_mono(pfad, merkmale.SR)
    fm = merkmale.frame_merkmale(y, merkmale.SR)
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        tmp = cd + ".tmp.npz"
        np.savez(tmp, **{k: fm[k] for k in ("t", "p", "flach", "fluss")}, sr=fm["sr"], hop=fm["hop"],
                 dauer_s=fm["dauer_s"])
        os.replace(tmp, cd)
    return fm, False


# Traktor zaehlt den Encoder-Vorlauf der Quelle-MP3 mit (LAME: 1105 Samples = 25,057 ms bei 44,1 kHz),
# unsere eigene Dekodierung (audio.lade_mono, ffmpeg) schneidet ihn ab -- Grid_ms aus der NML liegt darum
# auf der eigenen (vorlauf-freien) fm-Zeitachse systematisch zu spaet. vorlauf_s korrigiert den Anker,
# analog zu djk/cues/bibliothek.ts verschiebeTraktor() (Befund 2026-09-26, ~/messungen/
# 2026-09-26-djk-encoder-vorlauf/befund.md). Vorgabe 0.0 (kein Aufrufer setzt ihn bisher) haelt bestehende
# Ergebnisse/Tests unveraendert -- Verdrahtung mit ffprobe start_time je Datei ist ein offener naechster Schritt.
def raster_fuer(fm, eintrag, tags, erzwinge_eigen=False, p=None, vorlauf_s=0.0):
    if (not erzwinge_eigen and eintrag and eintrag.get("grid_ms") is not None
            and eintrag.get("bpm_traktor")):
        anker_s = max(0.0, eintrag["grid_ms"] / 1000.0 - vorlauf_s)
        r = rastermod.raster_aus_anker(fm["dauer_s"], eintrag["bpm_traktor"], anker_s)
        r["quelle"] = "traktor"
        return r
    tbpm = (tags or {}).get("tbpm") or (eintrag or {}).get("bpm_traktor")
    return rastermod.eigene_schaetzung(fm, tbpm, detektor.eins_waehler_fuer(fm, p))


def analysiere(pfad, eintrag=None, p=None, erzwinge_eigen=False, cache_dir=None, tags=None, vorlauf_s=0.0):
    p = p or detektor.Parameter()
    t0 = time.perf_counter()
    fm, aus_cache = frame_merkmale_fuer(pfad, cache_dir)
    t_dek = time.perf_counter() - t0
    if tags is None:
        tags = audio.lies_tags(pfad)
    r = raster_fuer(fm, eintrag, tags, erzwinge_eigen, p, vorlauf_s)
    db, fl = merkmale.takt_merkmale(fm, r["starts"], r["takt_s"])
    vors, info = detektor.erkenne(db, fl, r, p, fm["dauer_s"])
    for v in vors:
        v["quelle"] = "strukturvorschlag"
    return {
        "schema": SCHEMA, "version": VERSION, "datei": os.path.abspath(pfad),
        "dauer_s": round(float(fm["dauer_s"]), 3),
        "raster": {"quelle": r["quelle"], "zeitachse": "traktor" if r["quelle"] == "traktor" else "dekodiert",
                   "bpm": round(r["bpm"], 4), "anker_s": round(r["anker_s"], 4),
                   "takt_s": round(r["takt_s"], 5), "phrasen_versatz": info["phrasen_versatz"],
                   "takte": int(len(r["nummern"]))},
        "tags": {"tbpm": tags.get("tbpm"), "tkey": tags.get("tkey"), "energy": tags.get("energy")},
        "parameter": p.als_dict(),
        "vorschlaege": vors,
        "laufzeit_s": {"gesamt": round(time.perf_counter() - t0, 3), "merkmale": round(t_dek, 3),
                       "aus_cache": aus_cache},
        "_intern": {"nummern": r["nummern"], "starts": r["starts"], "db": db, "fl": fl,
                    "bpm": float(r["bpm"]), "anker_s": float(r["anker_s"]), "takt_s": float(r["takt_s"])},
    }


def ohne_intern(erg):
    return {k: v for k, v in erg.items() if not k.startswith("_")}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mp3")
    ap.add_argument("--nml", default=None)
    ap.add_argument("--ordner", default="0101 Beatport")
    ap.add_argument("--aus", default=None)
    ap.add_argument("--eigen", action="store_true", help="Traktor-Grid ignorieren, eigenes Raster")
    ap.add_argument("--profil", choices=sorted(detektor.PROFILE), default="v1")
    a = ap.parse_args(argv)
    eintrag = None
    if a.nml:
        eintrag = nml.eintrag_zu(a.mp3, nml.lies_sammlung(a.nml, a.ordner))
    erg = ohne_intern(analysiere(a.mp3, eintrag, p=detektor.profil(a.profil), erzwinge_eigen=a.eigen))
    txt = json.dumps(erg, ensure_ascii=False, indent=1)
    if a.aus:
        with open(a.aus, "w", encoding="utf-8") as f:
            f.write(txt)
    else:
        sys.stdout.write(txt + "\n")


if __name__ == "__main__":
    main()
