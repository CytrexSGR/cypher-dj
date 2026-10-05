"""Schritt 3: Holdout für Tonart (und zweiter Energie-Holdout), gerechnet mit dem ausgelieferten Befehl analyse.

Warum: Regel, Moll-Voreinstellung und Dur-Schwelle 0.9 wurden auf den 600 Stichproben-Tracks gewählt; die
73,8 % dort sind eine Auswahl-Zahl. Hier laufen Tracks, die weder Pfad noch Album noch Artist mit der
Stichprobe teilen:
  A  120 Tracks, gleichmäßig über den nach Pfad sortierten freien Bestand (floor(i·N/120))
  B  alle MIK-Durtracks (TKEY „…B“), die Pfad und Album nicht mit der Stichprobe teilen (Artist-Überlappung
     erlaubt, sonst blieben zu wenige), um die Moll-Voreinstellung an echtem Dur zu messen.
Je Verfahren (edma, edmm, bgate, braw, libKeyFinder, Regel mit/ohne Dur-Weg, jeweils roh und → Moll)
dieselben Kennzahlen wie Schritt 2a. Energie auf A gegen die konstante Grundlinie 6 (Median der Stichprobe).

Aufruf: cd djk && nice -n 19 ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.pruefung_holdout_tonart
"""
from __future__ import annotations

from . import energie_level  # noqa: F401

import json
import os
import time
from collections import Counter

import numpy as np
import pandas as pd

from .analyse import lauf
from .camelot import aus_camelot, zu_camelot
from .energie_modell import BERICHTE, CACHE
from .tonart import DUR_SCHWELLE, entscheide
from .vergleich_tonart import als_moll, kennzahlen

ROH = CACHE / "holdout_tonart.jsonl"


def auswahl(n_a: int = 120) -> pd.DataFrame:
    tags = pd.read_csv(CACHE / "tags.csv", dtype=str).fillna("")
    stich = pd.read_csv(CACHE / "labels.csv", dtype=str).fillna("")
    ok = tags[tags["energy"].str.fullmatch(r"\d+") & tags["tkey"].str.fullmatch(r"\d{1,2}[AB]")]
    frei = ok[~ok["pfad"].isin(stich["pfad"]) & ~ok["album"].isin(stich["album"])]
    frei_a = frei[~frei["artist"].str.lower().isin(set(stich["artist"].str.lower()))].sort_values("pfad")
    a = frei_a.iloc[[int(i * len(frei_a) / n_a) for i in range(n_a)]].assign(teil="A")
    b = frei[frei["tkey"].str.endswith("B") & ~frei["pfad"].isin(a["pfad"])].sort_values("pfad").assign(teil="B")
    return pd.concat([a, b])


def regel_aus_stimmen(t: dict, dur_schwelle) -> str:
    st = {k: aus_camelot(v) if v else None for k, v in t["stimmen"].items()}
    g, moll, _ = entscheide(st, t["staerke_edma"], dur_schwelle)
    return zu_camelot(g, moll)


def main() -> None:
    os.nice(max(0, 19 - os.nice(0)))
    h = auswahl()
    print(f"A {int((h.teil == 'A').sum())}, B-Zusatz {int((h.teil == 'B').sum())}, "
          f"Dur in A {int(h[h.teil == 'A'].tkey.str.endswith('B').sum())}", flush=True)
    fertig = {}
    if ROH.exists():
        for z in ROH.read_text().splitlines():
            r = json.loads(z)
            if not r.get("fehler"):
                fertig[r["pfad"]] = r
    offen = [p for p in h["pfad"] if p not in fertig]
    t0 = time.time()
    with open(ROH, "a") as f:
        for i, r in enumerate(lauf(offen, 3), 1):
            f.write(json.dumps(r, ensure_ascii=False) + "\n"); f.flush()
            fertig[r["pfad"]] = r
            if i % 15 == 0:
                print(f"  {i}/{len(offen)} · {time.time() - t0:.0f} s · Last {os.getloadavg()[0]:.2f}", flush=True)

    h = h.assign(**{"r": h["pfad"].map(fertig)})
    fehler = [(p, r and r.get("fehler")) for p, r in zip(h.pfad, h.r) if not r or r.get("fehler")]
    h = h[[bool(r) and not r.get("fehler") for r in h.r]].copy()
    ton = h.r.map(lambda r: r["tonart"])
    spalten = {f"KeyExtractor {k}": ton.map(lambda t, k=k: t["stimmen"][k]) for k in ("edma", "edmm", "bgate", "braw")}
    spalten["libKeyFinder"] = ton.map(lambda t: t["stimmen"]["kf"])
    for k in list(spalten):
        spalten[f"{k} → Moll"] = spalten[k].map(lambda c: als_moll(c) if c else None)
    spalten["Regel (ausgeliefert, Dur-Schwelle 0.9)"] = h.r.map(lambda r: r["camelot"])
    spalten["Regel ohne Dur-Weg (immer Moll)"] = ton.map(lambda t: regel_aus_stimmen(t, None))
    for s in (0.8, 0.7):
        spalten[f"Regel Dur-Schwelle {s}"] = ton.map(lambda t, s=s: regel_aus_stimmen(t, s))
    # Nachrechnung: die ausgelieferte Zahl muss aus den Stimmen wieder entstehen
    nachgerechnet = float(np.mean(ton.map(lambda t: regel_aus_stimmen(t, DUR_SCHWELLE)) == spalten[
        "Regel (ausgeliefert, Dur-Schwelle 0.9)"]))

    out = {"n_A": int((h.teil == "A").sum()), "n_B": int((h.teil == "B").sum()), "fehler": fehler,
           "regel_nachgerechnet_gleich": nachgerechnet}
    for teil, maske in (("A_artistfrei", h.teil == "A"),
                        ("dur_alle", h.tkey.str.endswith("B")),
                        ("A_plus_B", pd.Series(True, index=h.index))):
        w = h.loc[maske, "tkey"]
        e = {n: kennzahlen(s[maske], w) for n, s in spalten.items()}
        haeufig = Counter(w).most_common(1)[0]
        out[teil] = {"n": int(maske.sum()), "labels": dict(Counter(w)),
                     "grundlinie_haeufigste": {"klasse": haeufig[0], "exakt": round(haeufig[1] / len(w), 4)},
                     "verfahren": {n: {k: v[k] for k in ("n", "exakt", "nachbar", "mirex", "grundton_gleich",
                                                         "moll_anteil_schaetzung") if k in v} for n, v in e.items()}}
        print(f"\n{teil} n={out[teil]['n']}")
        for n, v in sorted(e.items(), key=lambda t: -t[1]["exakt"]):
            print(f"  {n:42s} exakt {v['exakt']:.3f} nachbar {v['nachbar']:.3f} grundton {v['grundton_gleich']:.3f}")

    # Konfidenz-Kalibrierung auf A
    a = h[h.teil == "A"]
    k = a.r.map(lambda r: r["konfidenz"]).to_numpy(float)
    treffer = (a.r.map(lambda r: r["camelot"]) == a.tkey).to_numpy(float)
    out["konfidenz_A"] = {"mittel_konfidenz": float(k.mean()), "trefferquote": float(treffer.mean()),
                          "brier": float(np.mean((k - treffer) ** 2)),
                          "brier_konstant": float(np.mean((treffer.mean() - treffer) ** 2)),
                          "obere_haelfte_treffer": float(treffer[k >= np.median(k)].mean()),
                          "untere_haelfte_treffer": float(treffer[k < np.median(k)].mean())}

    # Energie auf A (artistfrei) gegen konstante 6
    y = a.energy.astype(int).to_numpy()
    lv = a.r.map(lambda r: r["energie"]).to_numpy(int)
    wv = a.r.map(lambda r: r["energie_wert"]).to_numpy(float)
    out["energie_A"] = {"n": int(len(y)), "mae": float(np.mean(np.abs(lv - y))), "mae_wert": float(np.mean(np.abs(wv - y))),
                        "exakt": float(np.mean(lv == y)), "pm1": float(np.mean(np.abs(lv - y) <= 1)),
                        "konstant6": {"mae": float(np.mean(np.abs(6 - y))), "exakt": float(np.mean(y == 6)),
                                      "pm1": float(np.mean(np.abs(y - 6) <= 1))},
                        "mik_verteilung": {int(q): int(c) for q, c in zip(*np.unique(y, return_counts=True))},
                        "modell_verteilung": {int(q): int(c) for q, c in zip(*np.unique(lv, return_counts=True))}}
    out["t_median_s"] = float(np.median(h.r.map(lambda r: r["t_s"])))
    out["zeilen"] = [{"pfad": p, "teil": t, "mik_tkey": tk, "mik_energy": int(en), "camelot": r["camelot"],
                      "konfidenz": r["konfidenz"], "energie": r["energie"], "energie_wert": r["energie_wert"],
                      "stimmen": r["tonart"]["stimmen"], "staerke_edma": r["tonart"]["staerke_edma"]}
                     for p, t, tk, en, r in zip(h.pfad, h.teil, h.tkey, h.energy, h.r)]
    (BERICHTE / "schritt3_holdout_tonart.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(json.dumps({k: v for k, v in out.items() if k in ("konfidenz_A", "energie_A", "regel_nachgerechnet_gleich",
                                                             "fehler", "t_median_s")}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
