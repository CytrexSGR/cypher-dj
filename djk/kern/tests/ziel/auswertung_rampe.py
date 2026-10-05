#!/usr/bin/env python3
"""Auswertung des Prüfklicks in einer Tempo-Rampe am Ziel (Scheibe 08): jeder Klick-Einsatz der Aufnahme wird einem
Kern-Sample zugeordnet und gegen llround(sample(b)) der Tempo-Karte mit derselben Rampe gehalten (SCHNITTSTELLEN.md
§1.1, §1.3; Referenz djk/vertrag/karte.py aus Scheibe 02, nicht der Kern selbst).

Zuordnung wie in Scheibe 01 (djk/pruefstand/klick/auswertung.py): der Aufnehmer schreibt den Blockanfang seines ersten
Frames (mono_ns) in <wav>.json, der Prüfer hat jedes /uhr protokolliert; dasselbe mono_ns heißt derselbe Zyklus, also
Aufnahme-Frame 0 = Kern-Sample K0. Einsatz-Erkennung: einsaetze() aus derselben Datei.
Versatz d = K0 + Einsatz - llround(sample(b)); fest heißt: für jeden ausgewerteten Klick gleich dem des ersten.
Grün: die 33 Schläge b = ab_beat .. ab_beat + 32 der Rampe sind alle da und liegen alle auf dem festen Versatz, ebenso
jeder Klick davor und danach; Instrument lückenlos (sonst 2: Lauf wiederholen).

Aufruf: auswertung_rampe.py --wav A.wav --pruefer P.jsonl [--meta meta.txt]
Ausgabe: JSON auf stdout. Rückgabe 0 grün, 1 rot, 2 unbrauchbar.
"""
import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np
from scipy.io import wavfile

DJK = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DJK / "pruefstand" / "klick"))
sys.path.insert(0, str(DJK / "vertrag"))
from auswertung import einsaetze  # noqa: E402  (Scheibe 01)
try:  # Scheibe 01: treibt die eigene Senke den Graphen, lebt jeder eigene Knoten genau einmal? (meta.txt, graph.sh)
    from auswertung import graph_pruefen  # noqa: E402
except ImportError:
    graph_pruefen = None
from karte import Karte, ziel_sample  # noqa: E402  (Scheibe 02)

warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--pruefer", required=True)
    ap.add_argument("--meta", help="meta.txt des Laufs (graph.sh): Gruppe am eigenen Treiber?")
    a = ap.parse_args()
    _, d = wavfile.read(a.wav)
    meta = json.load(open(a.wav + ".json"))
    L = d[:, 0].astype(np.float64)
    uhr, zus = [], {}
    for zeile in open(a.pruefer):
        z = json.loads(zeile)
        if "zusammenfassung" in z:
            zus = z["zusammenfassung"]
        elif z.get("adresse") == "/uhr":
            uhr.append((z["werte"][1], z["werte"][0]))
    erg = {"wav": a.wav, "frames": int(len(L)), "aufnahme": meta, "zusammenfassung": zus}
    k0 = [s for m, s in uhr if m == meta["erster_mono_ns"]]
    if len(k0) != 1 or "rampe" not in zus:
        erg["ergebnis"], erg["grund"] = "unbrauchbar", "keine eindeutige Zuordnung Frame 0 -> Kern-Sample oder keine Rampe"
        print(json.dumps(erg, ensure_ascii=False, indent=1))
        return 2
    K0 = int(k0[0])
    t0, t1 = meta["erster_mono_ns"], meta["erster_mono_ns"] + int(len(L) / 48000.0 * 1e9)
    fenster = sorted((m, s) for m, s in uhr if t0 <= m <= t1)
    per = meta["quantum"] / 48000.0 * 1e9
    uhr_luecken = sum(1 for (m0, s0), (m1, s1) in zip(fenster, fenster[1:])
                      if s1 - s0 != meta["quantum"] or abs((m1 - m0) - per) > 0.5 * per)
    erg["instrument"] = {"aufnehmer_luecken": meta["luecken"], "aufnehmer_ueberlauf": meta["ueberlauf"],
                         "uhr_luecken_im_fenster": uhr_luecken, "kern_sample_bei_frame_0": K0}
    r = zus["rampe"]
    karte = Karte(128.0)
    karte.rampe(r["ab_beat"], r["ziel_bpm"], r["dauer_beats"])
    e = einsaetze(L)
    s = K0 + e
    beats, dv = [], []
    for si in s:  # nächster ganzer Beat nach der Referenzkarte
        b = round(karte.beat(float(si)))
        beats.append(b)
        dv.append(int(si) - ziel_sample(karte, float(b)))
    V = dv[0] if dv else None
    in_rampe = [(b, x) for b, x in zip(beats, dv) if r["ab_beat"] <= b <= r["ab_beat"] + r["dauer_beats"]]
    erg.update({
        "klicks": len(e), "versatz_samples": V,
        "streuung_samples": (max(dv) - min(dv)) if dv else None,
        "beats_lueckenlos": bool(beats) and all(b1 - b0 == 1 for b0, b1 in zip(beats, beats[1:])),
        "in_rampe_klicks": len(in_rampe),
        "in_rampe_auf_versatz": sum(1 for _, x in in_rampe if x == V),
        "abweichungen": [[b, x - V] for b, x in zip(beats, dv) if x != V][:40],
        "rampe_quittungen": [q["status"] for q in r.get("quittungen", [])],
    })
    soll_rampe = int(r["dauer_beats"]) + 1
    gruen = (erg["in_rampe_klicks"] == soll_rampe and erg["in_rampe_auf_versatz"] == soll_rampe
             and erg["streuung_samples"] == 0 and erg["beats_lueckenlos"])
    erg["ergebnis"] = "gruen" if gruen else "rot"
    graph_ok = True
    if a.meta and graph_pruefen:
        g = graph_pruefen(a.meta, meta["quantum"])
        erg["instrument"]["graph"] = g
        graph_ok = g["senke_treibt"] is not False and g["knoten_ok"]
    if meta["luecken"] or meta["ueberlauf"] or uhr_luecken or not graph_ok:
        erg["ergebnis"], erg["grund"] = "unbrauchbar", ("Instrument lückenhaft (Aufnehmer, /uhr-Strom oder fremder "
                                                        "Treiber), Lauf wiederholen")
    print(json.dumps(erg, ensure_ascii=False, indent=1))
    return {"gruen": 0, "rot": 1}.get(erg["ergebnis"], 2)


if __name__ == "__main__":
    sys.exit(main())
