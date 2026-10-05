#!/usr/bin/env python3
"""Auswertung des Lückenzählers am Ziel (Scheibe 08, SCHNITTSTELLEN.md §5.4, §5.9, ARCHITEKTUR §7).

Der Kern zählt Frame-Lücken selbst (der JACK-Xrun-Rückruf ist unter pipewire-jack blind, 10 Probe b). Das unabhängige
Instrument ist das Ziel: ein Zyklus, den der Kern auslässt, fehlt ihm (seine Uhr ist innen stetig, ADR 004), der
Treiber läuft weiter, die Notbahn gibt für diesen Block Stille aus, und jeder spätere Prüfklick kommt am Aufnehmer um
genau eine Periode später an als vorher. Gemessen wird also: der Versatz d = K0 + Einsatz - llround(sample_at(b)) je
Klick (konstant 128 BPM ab /k/set/neu), seine Sprünge zwischen zwei Klicks in Perioden, und daneben die Summe der
`zyklen` aller /e/luecke des Kerns, deren Sample zwischen diesen beiden Klicks liegt. Beide müssen je Klickpaar
gleich sein. Zusätzlich: frame_luecken im letzten /zustand/kern gleich der Zahl der /e/luecke seit /k/set/neu.
Verpasst der Aufnehmer selbst Zyklen, ist der Lauf unbrauchbar (Instrument; Rückgabe 2, wiederholen); einen
Treiberwechsel (großer oder negativer Sprung der Frame-Zeit, beide sehen ihn) übersteht die Messung.

Aufruf: auswertung_luecken.py --wav A.wav --pruefer P.jsonl --erwarte (keine|einige) [--kern-err K.err]
                             [--last-alle N] [--meta meta.txt]
  keine:  grün, wenn Ziel und Kern je 0 ausgelassene Perioden zeigen (Negativ-Kontrolle, Ruhelauf)
  einige: grün, wenn Ziel und Kern je Klickpaar übereinstimmen und mindestens eine ausgelassene Periode je zwei
          verbrannte Zyklen des Kerns im Fenster liegt (Fehlerfall künstliche Callback-Last, 10 K1b)
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
from auswertung import einsaetze  # noqa: E402  (Scheibe 01)
try:  # Scheibe 01: treibt die eigene Senke den Graphen, lebt jeder eigene Knoten genau einmal? (meta.txt, graph.sh)
    from auswertung import graph_pruefen  # noqa: E402
except ImportError:
    graph_pruefen = None

warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)
SPB = 60.0 / 128.0 * 48000.0  # Samples je Beat, konstant 128 ab Sample 0


def soll(b: int) -> int:
    return int(np.floor(b * SPB + 0.5))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--pruefer", required=True)
    ap.add_argument("--erwarte", choices=["keine", "einige"], required=True)
    ap.add_argument("--kern-err")
    ap.add_argument("--last-alle", type=int, default=0, help="Prüf-Last: jeder N-te Zyklus verbrennt (nur bei einige)")
    ap.add_argument("--meta", help="meta.txt des Laufs (graph.sh): Gruppe am eigenen Treiber?")
    a = ap.parse_args()
    _, d = wavfile.read(a.wav)
    meta = json.load(open(a.wav + ".json"))
    L = d[:, 0].astype(np.float64)
    uhr, luecken, zustand = [], [], None
    neue_zeitachse = False  # gezählt wird ab der Quittung gestartet von /k/set/neu (Generationsstart, §5.4)
    for zeile in open(a.pruefer):
        z = json.loads(zeile)
        adr = z.get("adresse")
        if adr == "/q" and z["werte"][2] == 2:
            neue_zeitachse = True
        elif adr == "/uhr":
            uhr.append((z["werte"][1], z["werte"][0]))
        elif adr == "/e/luecke" and neue_zeitachse:
            luecken.append(z["werte"])  # sample, frames, zyklen
        elif adr == "/zustand/kern" and neue_zeitachse:
            zustand = z["werte"]
    erg = {"aufnahme": meta, "e_luecke_seit_set_neu": len(luecken), "letzter_zustand": zustand}
    if a.kern_err:
        for zeile in open(a.kern_err):
            if zeile.startswith("{\"zyklen\""):
                erg["kern_ende"] = json.loads(zeile)
    k0 = [s for m, s in uhr if m == meta["erster_mono_ns"]]
    # Lücken des Aufnehmers: ein kleiner positiver Sprung der Frame-Zeit (1 bis 16 Perioden) heißt, er hat selbst
    # Zyklen verpasst, dann verschieben sich die Klicks auch ohne den Kern (Instrument unbrauchbar). Ein großer oder
    # negativer Sprung ist ein Treiberwechsel ohne Datenverlust (so auch der Kern, telemetrie.cpp; gemessen am
    # 2026-09-23: -2 463 488 Frames bei Kern und Aufnehmer zugleich); er zählt nicht, weil er in 32 Bit umläuft.
    selbst_verpasst = [l for l in meta.get("luecken_bei", [])
                       if 0 < l[1] <= 16 * int(meta["quantum"])]
    erg["aufnehmer_selbst_verpasst"] = selbst_verpasst
    graph_ok = True
    if a.meta and graph_pruefen:
        erg["graph"] = graph_pruefen(a.meta, meta["quantum"])
        graph_ok = erg["graph"]["senke_treibt"] is not False and erg["graph"]["knoten_ok"]
    if len(k0) != 1 or zustand is None or selbst_verpasst or meta["luecken"] > 16 or meta["ueberlauf"] or not graph_ok:
        erg["ergebnis"] = "unbrauchbar"
        erg["grund"] = ("Zuordnung Frame 0 -> Kern-Sample fehlt, kein /zustand/kern, Aufnehmer lückenhaft oder fremder "
                        "Treiber")
        print(json.dumps(erg, ensure_ascii=False, indent=1))
        return 2
    K0 = int(k0[0])
    per = int(meta["quantum"])
    e = einsaetze(L)
    s_ziel = K0 + e  # Kern-Sample, wenn der Kern keinen Zyklus ausgelassen hätte
    b = np.floor(s_ziel / SPB + 0.5).astype(np.int64)
    dv = [int(si) - soll(int(bi)) for si, bi in zip(s_ziel, b)]
    # Je Klick i: am Ziel C(i) = (d_i - d_0) / Periode ausgelassene Zyklen seit Klick 0. Der Kern meldet eine Lücke am
    # ersten Block nach ihr (Sample l). Sicher vor Klick i liegt sie, wenn l <= s_i; eine eigene Überlänge im Block des
    # Klicks meldet er erst am Block danach (l <= s_i + Periode), und ein Treiberwechsel (zyklen 0) kann am Ziel bis zu
    # eine Periode kosten (gemessen am 2026-09-23). Also: untere(i) <= C(i) <= obere(i).
    s0 = soll(int(b[0])) if len(b) else 0
    abweichend, unten_ges, oben_ges = [], 0, 0
    for i in range(1, len(dv)):
        c = (dv[i] - dv[0]) / per
        si = soll(int(b[i]))
        unten = sum(l[2] for l in luecken if s0 + per < l[0] <= si)
        oben = sum(max(l[2], 1) for l in luecken if s0 < l[0] <= si + per)
        if not (unten <= c <= oben):
            abweichend.append([int(b[i]), c, unten, oben])
        unten_ges, oben_ges = unten, oben
    ziel_summe = (dv[-1] - dv[0]) / per if len(dv) > 1 else 0.0
    kern_im_fenster = sum(l[2] for l in luecken if s0 < l[0] <= (soll(int(b[-1])) if len(b) else 0))
    treiberwechsel = sum(1 for l in luecken if l[2] == 0 and s0 < l[0] <= (soll(int(b[-1])) if len(b) else 0))
    erg.update({
        "kern_sample_bei_frame_0": K0, "klicks": int(len(e)),
        "erster_beat": int(b[0]) if len(b) else None, "letzter_beat": int(b[-1]) if len(b) else None,
        "ausgelassen_am_ziel": ziel_summe, "ausgelassen_laut_kern": kern_im_fenster,
        "treiberwechsel_laut_kern": treiberwechsel, "rahmen_letzter_klick": [unten_ges, oben_ges],
        "klicks_ausserhalb_rahmen": abweichend[:20],
        "zustand_frame_luecken": zustand[3], "zustand_ausgelassene_perioden": zustand[4],
        "zustand_gleich_meldungen": zustand[3] == len(luecken),
    })
    gleich = not abweichend and erg["zustand_gleich_meldungen"] and len(e) >= 20
    if a.erwarte == "keine":
        gruen = gleich and ziel_summe == 0 and zustand[3] == 0
    else:
        fenster_zyklen = (soll(int(b[-1])) - soll(int(b[0]))) / per if len(b) > 1 else 0.0
        erwartet = int(fenster_zyklen // a.last_alle) if a.last_alle > 0 else 1
        erg["verbrennungen_im_fenster_erwartet"] = erwartet
        # jede Verbrennung über einer Periode kostet mindestens einen Zyklus (10 K1b: 44 von 44); eine Randverbrennung
        # kann vor dem ersten oder nach dem letzten Klick liegen
        gruen = gleich and ziel_summe >= max(1, erwartet - 1)
    erg["ergebnis"] = "gruen" if gruen else "rot"
    print(json.dumps(erg, ensure_ascii=False, indent=1))
    return 0 if gruen else 1


if __name__ == "__main__":
    sys.exit(main())
