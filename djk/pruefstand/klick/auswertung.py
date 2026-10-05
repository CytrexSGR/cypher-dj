#!/usr/bin/env python3
"""Auswertung eines Prüflaufs der Scheibe 01 am Ziel: jeder Klick-Einsatz in der Aufnahme wird einem Kern-Sample
zugeordnet und gegen llround(sample_at(b)) gehalten (SCHNITTSTELLEN.md §1.1, §1.3 konstantes Segment).

Zuordnung ohne Kern-Protokoll: der Aufnehmer schreibt den Blockanfang seines ersten Frames (mono_ns, aus
jack_get_cycle_times) in <wav>.json; der Prüfer hat jedes /uhr des Kerns protokolliert (sample, mono_ns je Zyklus).
Dasselbe mono_ns heißt derselbe Zyklus desselben Treibers, also Aufnahme-Frame 0 = Kern-Sample K0.
Einsatz = erstes Sample mit |x| > 0,05 nach mindestens 2000 stillen Samples (Vorlage
proben/01-audio-kern/a-cpp-jack/analyse_klick.py). Versatz d = K0 + Einsatz - llround(sample_at(b)).

Vor dem Urteil über den Kern wird das Instrument geprüft: Lücken oder Überläufe im Aufnehmer und Sprünge im /uhr-Strom
während der Aufnahme machen den Lauf unbrauchbar (Rückgabe 2, Lauf wiederholen), nicht rot. Mit --meta (meta.txt von
lauf.sh) zusätzlich: die eigene Senke muss den Graphen treiben (in pw-top ohne „+“, mit dem Quantum der Aufnahme) und
Kern, Notbahn und Aufnehmer der Instanz je genau einmal leben; sonst hing die Gruppe an einem fremden Treiber
(beobachtet in der Planungsprobe: Versatz 256 statt 512, dann Sprung beim Treiberwechsel).

Aufruf: auswertung.py --wav A.wav --pruefer P.jsonl --erwarte-klicks 101 [--bpm 128] [--meta meta.txt]
Ausgabe: JSON auf stdout. Rückgabe 0 grün, 1 rot, 2 unbrauchbar (Instrument oder Zuordnung).
"""
import argparse
import json
import sys
import warnings

import numpy as np
from scipy.io import wavfile

warnings.filterwarnings("ignore", category=wavfile.WavFileWarning)  # PEAK-Block von libsndfile


def einsaetze(x, schwelle=0.05, ruhe=2000):
    ueber = np.flatnonzero(np.abs(x) > schwelle)
    if ueber.size == 0:
        return np.array([], dtype=np.int64)
    luecke = np.diff(ueber) > ruhe
    return np.concatenate(([ueber[0]], ueber[1:][luecke])).astype(np.int64)


def graph_pruefen(pfad, quantum):
    """Liest meta.txt von lauf.sh: treibt die eigene Senke den Graphen, und lebt jeder eigene Knoten genau einmal?
    pw-top zeigt einen Follower mit „+“ vor dem Namen, aber nur, wenn es für den Knoten schon Messwerte hat; eine Zeile
    ohne Messwerte („???“ in W/Q) sagt nichts über den Treiber (in der Planungsprobe 4 von 9 Läufen): dann ist
    senke_treibt None (unbekannt) und kein Mangel; ein fremder Treiber fiele dann am Versatz auf (256 statt 512)."""
    zeilen = open(pfad).read().splitlines()
    senke = next((t.split("=", 1)[1] for z in zeilen[:1] for t in z.split() if t.startswith("senke=")), None)
    abschnitt, top, knoten = None, [], {}
    for z in zeilen:
        if z.startswith("== "):
            abschnitt = z[3:].strip()
        elif abschnitt == "pw-top" and senke and z.rstrip().endswith(" " + senke):
            top.append(z)
        elif abschnitt == "knoten" and "=" in z:
            k, v = z.split("=", 1)
            knoten[k.strip()] = int(v)
    s = top[-1] if top else ""
    teile = s.split()
    if not s or "???" in s:
        treibt = None
    else:
        treibt = ("+ " + senke) not in s and len(teile) > 2 and teile[2] == str(quantum)
    knoten_ok = bool(knoten) and all(v == 1 for v in knoten.values())
    return {"senke": senke, "senke_zeile": s.strip(), "senke_treibt": treibt, "knoten": knoten, "knoten_ok": knoten_ok}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--pruefer", required=True)
    ap.add_argument("--erwarte-klicks", type=int, required=True)
    ap.add_argument("--bpm", type=float, default=128.0)
    ap.add_argument("--meta")
    a = ap.parse_args()
    spb = 60.0 / a.bpm * 48000.0  # Samples je Beat, konstantes Segment ab Sample 0 (/k/set/neu)

    def soll(b):
        return int(np.floor(b * spb + 0.5))  # llround für positive Werte

    sr, d = wavfile.read(a.wav)
    meta = json.load(open(a.wav + ".json"))
    L, R = d[:, 0].astype(np.float64), d[:, 1].astype(np.float64)
    erg = {"wav": a.wav, "sr": int(sr), "frames": int(len(L)), "aufnahme": meta,
           "rechts_gleich_links": bool(np.array_equal(L, R)), "spitze": float(np.max(np.abs(L))) if len(L) else 0.0}

    uhr = []
    zusammenfassung = {}
    for zeile in open(a.pruefer):
        z = json.loads(zeile)
        if "zusammenfassung" in z:
            zusammenfassung = z["zusammenfassung"]
        elif z.get("adresse") == "/uhr":
            uhr.append((z["werte"][1], z["werte"][0], z["t_ns"]))
    k0 = [s for m, s, _ in uhr if m == meta["erster_mono_ns"]]
    erg["zuordnung"] = {"uhr_meldungen": len(uhr), "treffer": len(k0)}
    if len(k0) != 1:
        naechst = min((abs(m - meta["erster_mono_ns"]) for m, _, _ in uhr), default=None)
        erg["zuordnung"]["naechster_abstand_ns"] = naechst
        erg["ergebnis"], erg["grund"] = "unbrauchbar", "kein eindeutiges /uhr mit dem mono_ns des ersten Aufnahme-Blocks"
        print(json.dumps(erg, ensure_ascii=False, indent=1))
        return 2
    K0 = int(k0[0])
    erg["zuordnung"]["kern_sample_bei_frame_0"] = K0
    # Instrument: /uhr-Strom im Aufnahmefenster lückenlos (je Zyklus ein /uhr, Sample +Quantum, Zeit +1 Periode)?
    t0, t1 = meta["erster_mono_ns"], meta["erster_mono_ns"] + int(len(L) / 48000.0 * 1e9)
    fenster = sorted((m, smp) for m, smp, _ in uhr if t0 <= m <= t1)
    per = meta["quantum"] / 48000.0 * 1e9
    uhr_luecken = sum(1 for (m0, s0), (m1, s1) in zip(fenster, fenster[1:])
                      if s1 - s0 != meta["quantum"] or abs((m1 - m0) - per) > 0.5 * per)
    erg["instrument"] = {"aufnehmer_luecken": meta["luecken"], "aufnehmer_luecken_bei": meta.get("luecken_bei"),
                         "aufnehmer_ueberlauf": meta["ueberlauf"], "uhr_im_fenster": len(fenster),
                         "uhr_luecken_im_fenster": uhr_luecken}
    maengel = [t for t, schlecht in (("Aufnehmer-Lücke", meta["luecken"] != 0), ("Aufnehmer-Überlauf", meta["ueberlauf"] != 0),
                                       ("Sprung im /uhr-Strom", uhr_luecken != 0)) if schlecht]
    if a.meta:
        g = graph_pruefen(a.meta, meta["quantum"])
        erg["instrument"]["graph"] = g
        maengel += [t for t, schlecht in (("eigene Senke treibt nicht (fremder Treiber)", g["senke_treibt"] is False),
                                          ("eigene Knoten nicht je einmal", not g["knoten_ok"])) if schlecht]
    instrument_ok = not maengel
    grund_instrument = "Instrument unbrauchbar: " + ", ".join(maengel) + "; Lauf wiederholen"

    e = einsaetze(L)
    erg["klicks"] = int(e.size)
    if a.erwarte_klicks == 0:
        erg["ergebnis"] = "gruen" if (e.size == 0 and erg["spitze"] == 0.0) else "rot"
        if not instrument_ok:
            erg["ergebnis"], erg["grund"] = "unbrauchbar", grund_instrument
        print(json.dumps(erg, ensure_ascii=False, indent=1))
        return {"gruen": 0, "rot": 1}.get(erg["ergebnis"], 2)

    s = K0 + e
    b = np.floor(s / spb + 0.5).astype(np.int64)  # nächster ganzer Beat
    dv = np.array([int(si) - soll(bi) for si, bi in zip(s, b)], dtype=np.int64)
    n = min(a.erwarte_klicks, e.size)
    b, dv, e = b[:n], dv[:n], e[:n]
    V = int(dv[0]) if n else None
    pegel_soll = np.where(b % 4 == 0, 0.5, 0.25)
    pegel_ist = L[e] if n else np.array([])
    abw = dv - V if n else dv
    erg.update({
        "ausgewertet": int(n),
        "erster_beat": int(b[0]) if n else None,
        "letzter_beat": int(b[-1]) if n else None,
        "beats_lueckenlos": bool(n and np.all(np.diff(b) == 1)),
        "versatz_samples": V,
        "streuung_samples": int(dv.max() - dv.min()) if n else None,
        "max_abweichung_samples": int(np.max(np.abs(abw))) if n else None,
        "abweichungen_erste_20": [[int(bi), int(x)] for bi, x in zip(b, abw) if x != 0][:20],
        "eins_pegel_falsch": int(np.sum(np.abs(pegel_ist - pegel_soll) > 1e-4)) if n else None,
        "kern_quittung_erster_klick": [zusammenfassung.get("erster_klick_beat"), zusammenfassung.get("erster_klick_sample")],
    })
    gruen = (n == a.erwarte_klicks and erg["beats_lueckenlos"] and erg["streuung_samples"] == 0
             and erg["eins_pegel_falsch"] == 0 and erg["rechts_gleich_links"])
    erg["ergebnis"] = "gruen" if gruen else "rot"
    if not gruen and erg["streuung_samples"]:
        erg["grund"] = f"Klick-Einsätze streuen um {erg['streuung_samples']} Samples (max. Abweichung {erg['max_abweichung_samples']})"
    if not instrument_ok:
        erg["ergebnis"], erg["grund"] = "unbrauchbar", grund_instrument
    print(json.dumps(erg, ensure_ascii=False, indent=1))
    return {"gruen": 0, "rot": 1}.get(erg["ergebnis"], 2)


if __name__ == "__main__":
    sys.exit(main())
