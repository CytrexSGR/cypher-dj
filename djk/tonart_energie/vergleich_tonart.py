"""Schritt 2a, Auswertung: Tonart-Kandidaten gegen MIK-TKEY auf der ganzen Stichprobe (600).

Quellen (alle im Cache ~/cypher-dj/cues/merkmale/):
  merkmale.csv          Schritt 1: libKeyFinder (kf_key), KeyExtractor je Profil (essx_*), eigene HPCP-Kette (ess_*)
  tonart_2a.csv         tonart_zeiten.py: tonart.py aus dem Repo-Wurzelverzeichnis + Einzel-Zeiten je Verfahren
  tonart_varianten.csv  tonart_varianten.py: KeyExtractor mit Parameter-Varianten

Kennzahlen je Verfahren: exakt, Nachbar (exakt oder ±1 auf dem Rad bei gleichem Buchstaben oder
Paralleltonart gleiche Zahl), MIREX-Punkte, Grundton gleich, Moll-Anteil der Schätzungen,
Top-5-Verwechslungen (als Paar und als Intervallklasse), Laufzeit.
Auswahl von Varianten nur auf einer Artist-Hälfte, Prüfung auf der anderen (und umgekehrt).

Aufruf: cd djk && python3 -m tonart_energie.vergleich_tonart   → berichte/schritt2a_tonart.json
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from .camelot import MIREX_GEWICHT, aus_camelot, beziehung, zu_camelot

CACHE = Path.home() / "cypher-dj/cues/merkmale"
BERICHT = Path(__file__).parent / "berichte/schritt2a_tonart.json"
NAMEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def intervall(geschaetzt: str, wahr: str) -> str:
    """Verwechslung als Intervallklasse: Grundton-Abstand (Halbtöne, Schätzung minus Wahrheit) + Geschlecht."""
    tg, mg = aus_camelot(geschaetzt)
    tw, mw = aus_camelot(wahr)
    d = (tg - tw) % 12
    d = d - 12 if d > 6 else d
    ges = "gleiches Geschlecht" if mg == mw else ("Dur statt Moll" if mw else "Moll statt Dur")
    return f"{d:+d} HT, {ges}"


def als_moll(code: str) -> str:
    """Gleicher Grundton, Moll (Dur-Schätzung wird zur gleichnamigen Molltonart)."""
    t, _ = aus_camelot(code)
    return zu_camelot(t, True)


def kennzahlen(pred: pd.Series, wahr: pd.Series) -> dict:
    ok = pred.notna()
    p, w = pred[ok].astype(str), wahr[ok].astype(str)
    b = Counter(beziehung(x, y) for x, y in zip(p, w))
    n = len(p)
    fehler = [(y, x) for x, y in zip(p, w) if x != y]
    paare = Counter(f"MIK {y} → {x} ({beziehung(x, y)})" for y, x in fehler).most_common(5)
    klassen = Counter(intervall(x, y) for y, x in fehler).most_common(5)
    return {
        "n": n,
        "exakt": round(b["gleich"] / n, 4),
        "nachbar": round((b["gleich"] + b["quinte"] + b["parallel"]) / n, 4),
        "nur_nachbar": round((b["quinte"] + b["parallel"]) / n, 4),
        "mirex": round(sum(MIREX_GEWICHT[k] * v for k, v in b.items()) / n, 4),
        "beziehungen": {k: b[k] for k in MIREX_GEWICHT},
        "grundton_gleich": round(float(np.mean([aus_camelot(x)[0] == aus_camelot(y)[0] for x, y in zip(p, w)])), 4),
        "moll_anteil_schaetzung": round(float(np.mean([x.endswith("A") for x in p])), 4),
        "top5_paare": [[k, v] for k, v in paare],
        "top5_intervalle": [[k, v] for k, v in klassen],
    }


GEWAEHLT = ("schritt1", 0.9)   # (Variante, Dur-Schwelle) für tonart.py; nach der Messung gesetzt


def haelfte(artist: str) -> int:
    return int(hashlib.sha1(str(artist).encode()).hexdigest(), 16) % 2


def zeiten(s: pd.Series) -> dict:
    s = s.dropna().astype(float)
    return {"median_s": round(float(s.median()), 4), "p90_s": round(float(s.quantile(0.9)), 4), "n": int(len(s))}


def laden() -> tuple[pd.DataFrame, pd.DataFrame | None]:
    d = pd.read_csv(CACHE / "merkmale.csv").copy()
    z = CACHE / "tonart_2a.csv"
    if z.exists():
        t = pd.read_csv(z)
        t = t[t.fehler.isna()].drop_duplicates("id", keep="last").drop(columns="fehler")
        d = d.merge(t, on="id", how="left", suffixes=("", "_2a"))
    v = CACHE / "tonart_varianten.csv"
    var = None
    if v.exists() and v.stat().st_size > 200:
        var = pd.read_csv(v)
        var = var[var.fehler.isna()].drop_duplicates(["id", "variante", "profil"], keep="last")
    return d, var


def regel_messen(d: pd.DataFrame, var: pd.DataFrame | None, variante: str, dur_schwelle: float | None) -> pd.DataFrame:
    """Die Regel aus tonart.entscheide auf den Cache angewandt (dieselbe Funktion, kein Nachbau)."""
    from .tonart import entscheide
    if variante == "schritt1":
        k = {p: d.set_index("id")[f"essx_{p}_key"] for p in ("edma", "edmm", "bgate", "braw")}
        st = d.set_index("id").essx_edma_staerke
    else:
        v = var[var.variante == variante]
        k = {p: v[v.profil == p].set_index("id").key for p in ("edma", "edmm", "bgate", "braw")}
        st = v[v.profil == "edma"].set_index("id").staerke
    k["kf"] = d.set_index("id").kf_key
    zeilen = []
    for i in d.id:
        if i not in st.index:
            continue
        stimmen = {p: (aus_camelot(k[p][i]) if isinstance(k[p].get(i), str) else None) for p in k}
        g, moll, n = entscheide(stimmen, float(st[i]), dur_schwelle)
        zeilen.append({"id": i, "pred": zu_camelot(g, moll), "staerke": float(st[i]), "n_einig": n})
    r = pd.DataFrame(zeilen).set_index("id")
    r["wahr"] = d.set_index("id").tkey.reindex(r.index)
    r["treffer"] = (r.pred == r.wahr).astype(int)
    return r


def konfidenz_anpassen(r: pd.DataFrame, haelften: pd.Series) -> dict:
    """Logistische Kalibrierung P(treffer | staerke, n_einig); Prüfung über Artist-Hälften."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import brier_score_loss, roc_auc_score
    X, y = r[["staerke", "n_einig"]].values, r.treffer.values
    h = haelften.reindex(r.index).values
    pruef = {}
    for a in (0, 1):
        m = LogisticRegression(C=10.0).fit(X[h == a], y[h == a])
        p = m.predict_proba(X[h != a])[:, 1]
        stufen = pd.cut(p, [0, .4, .6, .8, .9, 1.0])
        tab = pd.DataFrame({"p": p, "y": y[h != a], "s": stufen}).groupby("s", observed=True).agg(
            vorhergesagt=("p", "mean"), getroffen=("y", "mean"), n=("y", "size"))
        pruef[f"angepasst_auf_{a}_geprueft_auf_{1 - a}"] = {
            "brier": round(float(brier_score_loss(y[h != a], p)), 4),
            "brier_konstant": round(float(brier_score_loss(y[h != a], np.full(len(p), y[h == a].mean()))), 4),
            "auc": round(float(roc_auc_score(y[h != a], p)), 4),
            "zuverlaessigkeit": {str(k): {kk: round(float(vv), 3) for kk, vv in v.items()} for k, v in tab.iterrows()}}
    m = LogisticRegression(C=10.0).fit(X, y)
    return {"K0": float(m.intercept_[0]), "K_STAERKE": float(m.coef_[0][0]), "K_EINIG": float(m.coef_[0][1]),
            "pruefung": pruef}


def main() -> dict:
    d, var = laden()
    d["haelfte"] = d.artist.map(haelfte)
    wahr = d.set_index("id").tkey
    verfahren: dict[str, pd.Series] = {}
    laufzeit: dict[str, dict] = {}

    verfahren["libKeyFinder"] = d.set_index("id").kf_key
    for prof in ["edma", "edmm", "bgate", "braw", "temperley", "krumhansl", "shaath"]:
        verfahren[f"KeyExtractor {prof}"] = d.set_index("id")[f"essx_{prof}_key"]
        verfahren[f"eigene HPCP36 + Key {prof}"] = d.set_index("id")[f"ess_{prof}_key"]
    if "tp_key" in d:
        verfahren["tonart.py (Repo-Wurzel)"] = d.set_index("id").tp_key
        laufzeit["tonart.py (Repo-Wurzel)"] = zeiten(d.t_tp) | {"inkl_dekodieren": True}
        laufzeit["libKeyFinder"] = zeiten(d.t_kf) | {"inkl_dekodieren": False}
        laufzeit["KeyExtractor edmm"] = zeiten(d.t_edmm) | {"inkl_dekodieren": False}
        laufzeit["KeyExtractor braw"] = zeiten(d.t_braw) | {"inkl_dekodieren": False}
        laufzeit["Dekodieren (ffmpeg, 44,1 kHz mono float)"] = zeiten(d.t_dekodieren_2a)
        # Reproduzierbarkeit gegen Schritt 1
        rep = {"edmm": float(np.mean(d.x_edmm_key == d.essx_edmm_key)),
               "braw": float(np.mean(d.x_braw_key == d.essx_braw_key)),
               "libKeyFinder": float(np.mean(d.x_kf_key == d.kf_key))}
    else:
        rep = {}

    # abgeleitet: Grundton der Schätzung, Tongeschlecht immer Moll (MIK-Labels sind zu 99 % Moll)
    for name in ["KeyExtractor edma", "KeyExtractor bgate", "KeyExtractor braw", "KeyExtractor edmm", "libKeyFinder"]:
        verfahren[f"{name} → Moll"] = verfahren[name].map(als_moll)

    varianten_tabelle = {}
    if var is not None:
        for (vn, prof), g in var.groupby(["variante", "profil"]):
            s = g.set_index("id").key
            verfahren[f"KeyExtractor {prof} [{vn}]"] = s
            verfahren[f"KeyExtractor {prof} [{vn}] → Moll"] = s.map(als_moll)
            laufzeit[f"KeyExtractor {prof} [{vn}]"] = zeiten(g.t) | {"inkl_dekodieren": False}

    ergebnis = {name: kennzahlen(s.reindex(wahr.index), wahr) for name, s in verfahren.items()}
    for name in ergebnis:
        if name in laufzeit:
            ergebnis[name]["laufzeit"] = laufzeit[name]

    # Auswahl auf einer Artist-Hälfte, Prüfung auf der anderen
    kreuz = {}
    hmap = d.set_index("id").haelfte
    kandidaten = [n for n in verfahren if n.startswith("KeyExtractor") or n == "libKeyFinder"]
    for wahl in (0, 1):
        ids_w, ids_p = hmap.index[hmap == wahl], hmap.index[hmap != wahl]
        auf_w = {n: float(np.mean(verfahren[n].reindex(ids_w) == wahr.reindex(ids_w))) for n in kandidaten}
        bestes = max(auf_w, key=auf_w.get)
        kreuz[f"auswahl_haelfte_{wahl}"] = {
            "gewaehlt": bestes, "exakt_auswahlhaelfte": round(auf_w[bestes], 4),
            "exakt_pruefhaelfte": round(float(np.mean(verfahren[bestes].reindex(ids_p) == wahr.reindex(ids_p))), 4),
            "n_auswahl": int(len(ids_w)), "n_pruef": int(len(ids_p)),
            "top3_auswahl": sorted(auf_w.items(), key=lambda kv: -kv[1])[:3]}

    # die gewählte Regel (tonart.py) auf dem Cache: je Variante, mit und ohne Dur-Weg
    regel = {}
    for vn in ["schritt1"] + (sorted(var.variante.unique()) if var is not None else []):
        for ds in (None, 0.9, 0.85, 0.8):
            r = regel_messen(d, var, vn, ds)
            name = f"Regel edma-Grundton [{vn}] Dur-Schwelle {ds}"
            e = kennzahlen(r.pred, r.wahr)
            e["dur_vorhergesagt"] = int((~r.pred.str.endswith("A")).sum())
            e["dur_davon_mik_gleich"] = int(((~r.pred.str.endswith("A")) & (r.pred == r.wahr)).sum())
            ergebnis[name] = e
            regel[(vn, ds)] = r
    bericht_regel = {}
    wahl = globals().get("GEWAEHLT")
    if wahl in regel:
        bericht_regel = {"variante": wahl[0], "dur_schwelle": wahl[1],
                         "konfidenz": konfidenz_anpassen(regel[wahl], d.set_index("id").haelfte)}

    rangliste = sorted(((n, e["exakt"], e["nachbar"], e["mirex"]) for n, e in ergebnis.items()), key=lambda r: -r[1])
    bericht = {"n": int(len(wahr)), "wahrheit": "MIK TKEY (Camelot)",
               "label_verteilung": dict(Counter(wahr)),
               "basislinie_haeufigste_klasse": {"klasse": Counter(wahr).most_common(1)[0][0],
                                               "exakt": round(Counter(wahr).most_common(1)[0][1] / len(wahr), 4)},
               "reproduzierbarkeit_gegen_schritt1": rep,
               "kreuzpruefung_artist_haelften": kreuz,
               "rangliste_exakt": rangliste,
               "gewaehlte_regel": bericht_regel,
               "laufzeiten_je_track": laufzeit,
               "verfahren": ergebnis}
    if var is not None and "stimmung_hz" in var:
        st = var.drop_duplicates("id").stimmung_hz
        bericht["stimmung_hz"] = {"median": float(st.median()), "p10": float(st.quantile(.1)),
                                  "p90": float(st.quantile(.9)), "anteil_abweichung_ueber_5hz": float(np.mean(abs(st - 440) > 5))}
    BERICHT.write_text(json.dumps(bericht, ensure_ascii=False, indent=1))
    return bericht


if __name__ == "__main__":
    b = main()
    for n, ex, nb, mx in b["rangliste_exakt"][:25]:
        print(f"{ex:.3f}  {nb:.3f}  {mx:.3f}  {n}")
    print(json.dumps(b["kreuzpruefung_artist_haelften"], ensure_ascii=False, indent=1))
