"""Schritt 2b: MIK-EnergyLevel (1..10) aus den gecachten Merkmalen lernen und ehrlich messen.

Aufteilung: GroupKFold nach Album, erweitert um Aufnahme-Dubletten (gleicher Artist + Titel unter
            verschiedenen Compilation-Alben landen in derselben Gruppe; Schritt 3), 5 Falten (gemischt, 5 Wiederholungen mit anderen Samen für die Streuung).
Modelle:    Median-Grundlinie · lineare Regression (OLS) · Ridge · Gradient Boosting (klein, feste Parameter).
Kennzahlen: MAE (auf dem gerundeten Level und auf dem stetigen Wert), exakt, ±1.
Merkmals-Wichtigkeit: standardisierte Ridge-Koeffizienten, Permutations-Wichtigkeit auf den Testfalten
                      (einzeln und je Merkmalsgruppe).
Deutlich besser heißt (vorab festgelegt): MAE-Senkung ≥ 10 % gegen die Median-Grundlinie UND das
95-%-Intervall der MAE-Differenz (Bootstrap über Alben) liegt ganz unter 0.

Keine Tag-Merkmale (TBPM, Genre, Tonart): energie(pfad) soll auf Tracks ohne MIK laufen.

Aufruf: cd djk && nice -n 19 ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.energie_modell
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, RidgeCV
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

CACHE = Path.home() / "cypher-dj/cues/merkmale"
HIER = Path(__file__).resolve().parent
BERICHTE = HIER / "berichte"
MODELL = HIER / "modell"

GRUPPEN = {
    "lautheit": ["lufs_int", "lra", "st_p10", "st_p50", "st_p90", "st_p95", "st_std", "st_max",
                 "anteil_laut", "anteil_nahe_max", "anteil_leise"],
    "pegel": ["spitze_dbfs", "rms_dbfs", "crest_db"],
    "baender": [f"band_{b}_{s}" for b in ("tief", "mitte", "hoch") for s in ("anteil", "std_db", "verlauf_spanne_db")],
    "spektrum": ["schwerpunkt_hz", "schwerpunkt_std_hz", "fluss_mittel", "fluss_std"],
    "rhythmus": ["onset_rate", "dyn_komplexitaet"],
    "dauer": ["dauer_s"],
    "musicnn_koepfe": ["tf_deam_valence", "tf_deam_arousal", "tf_emomusic_valence", "tf_emomusic_arousal",
                       "tf_muse_valence", "tf_muse_arousal", "tf_danceable", "tf_aggressive", "tf_party",
                       "tf_relaxed"],
    "effnet_koepfe": ["tf_engagement", "tf_approachability"] + [f"tf_jam_{n}" for n in (
        "energetic", "powerful", "fast", "party", "upbeat", "dark", "calm", "relaxing", "slow", "heavy")],
}
SIGNAL = [s for g in ("lautheit", "pegel", "baender", "spektrum", "rhythmus", "dauer") for s in GRUPPEN[g]]
KOEPFE = GRUPPEN["musicnn_koepfe"] + GRUPPEN["effnet_koepfe"]


def last_warten(max_last: float = 6.0) -> None:
    while (l := os.getloadavg()[0]) > max_last:
        print(f"  Last {l:.2f} > {max_last}, warte 60 s", flush=True)
        time.sleep(60)


def lade() -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    d = pd.read_csv(CACHE / "merkmale.csv").sort_values("pfad").reset_index(drop=True)
    vek = {"jamendo56": [], "musicnn_emb": [], "effnet_emb": []}
    for tid in d["id"]:
        z = np.load(CACHE / "npz" / f"{tid}.npz")
        for k in vek:
            vek[k].append(z[k])
    return d, {k: np.vstack(v).astype(np.float64) for k, v in vek.items()}


def matrizen(d: pd.DataFrame, vek: dict) -> dict[str, tuple[np.ndarray, list[str]]]:
    jam_namen = [f"jam56_{i:02d}" for i in range(56)]
    try:
        klassen = json.load(open(Path.home() / "cypher-dj/cues/venv-mik/modelle/mtg_jamendo_moodtheme-discogs-effnet-1.json"))["classes"]
        jam_namen = [f"jam56_{c}" for c in klassen]
    except OSError:
        pass
    s = d[SIGNAL].to_numpy(float)
    sk = d[SIGNAL + KOEPFE].to_numpy(float)
    return {
        "signal": (s, SIGNAL),
        "signal+koepfe": (sk, SIGNAL + KOEPFE),
        "signal+koepfe+jam56": (np.hstack([sk, vek["jamendo56"]]), SIGNAL + KOEPFE + jam_namen),
        "effnet_emb": (vek["effnet_emb"], [f"effnet_{i}" for i in range(1280)]),
        "musicnn_emb": (vek["musicnn_emb"], [f"musicnn_{i}" for i in range(200)]),
    }


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def cv_gruppen(d: pd.DataFrame) -> np.ndarray:
    """CV-Gruppen: Album, zusammengelegt über dieselbe Aufnahme (Artist + Titel normalisiert).

    Ohne das stehen dieselbe Aufnahme auf zwei Compilations in Trainings- und Testfalte (in der Stichprobe
    2 Paare: Hell Driver „Anti Parasite“, AnGy KoRe „Rebel (A.Paul Remix)“).
    """
    alben = d["album"].fillna("").astype(str).to_numpy()
    aufn = (d["artist"].map(_norm) + "|" + d["title"].map(_norm)).to_numpy()
    eltern = {a: a for a in alben}

    def wurzel(a):
        while eltern[a] != a:
            eltern[a] = eltern[eltern[a]]
            a = eltern[a]
        return a

    erstes: dict[str, str] = {}
    for alb, k in zip(alben, aufn):
        if k in erstes:
            eltern[wurzel(alb)] = wurzel(erstes[k])
        else:
            erstes[k] = alb
    return np.array([wurzel(a) for a in alben], dtype=str)


class Median:
    """Grundlinie: Median der Trainingslabels."""

    def fit(self, X, y):
        self.m_ = float(np.median(y))
        return self

    def predict(self, X):
        return np.full(len(X), self.m_)

    def get_params(self, deep=False):
        return {}

    def set_params(self, **p):
        return self


def modelle() -> dict:
    return {
        "median": Median(),
        "ols": make_pipeline(StandardScaler(), LinearRegression()),
        "ridge": make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-2, 4, 25))),
        "gbm": GradientBoostingRegressor(n_estimators=300, learning_rate=0.03, max_depth=2, subsample=0.8,
                                         min_samples_leaf=10, random_state=0),
    }


PAARE = [  # (Modell, Merkmalssatz); OLS nicht auf Embeddings (mehr Spalten als Tracks je Falte)
    ("median", "signal"),
    ("ols", "signal"), ("ols", "signal+koepfe"),
    ("ridge", "signal"), ("ridge", "signal+koepfe"), ("ridge", "signal+koepfe+jam56"),
    ("ridge", "effnet_emb"), ("ridge", "musicnn_emb"),
    ("gbm", "signal"), ("gbm", "signal+koepfe"), ("gbm", "signal+koepfe+jam56"),
]


def level(wert: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(wert), 1, 10).astype(int)


def kennzahlen(y: np.ndarray, wert: np.ndarray) -> dict:
    lv = level(wert)
    return {"mae": float(np.mean(np.abs(lv - y))), "mae_wert": float(np.mean(np.abs(wert - y))),
            "exakt": float(np.mean(lv == y)), "pm1": float(np.mean(np.abs(lv - y) <= 1)),
            "verteilung": {int(k): int(v) for k, v in zip(*np.unique(lv, return_counts=True))}}


def cv_vorhersage(modell, X, y, gruppen, seed: int) -> np.ndarray:
    wert = np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=5, shuffle=True, random_state=seed).split(X, y, gruppen):
        wert[te] = clone(modell).fit(X[tr], y[tr]).predict(X[te])
    return wert


def bootstrap_diff(y, a, b, gruppen, n=2000, seed=0) -> tuple[float, float]:
    """95-%-Intervall der MAE-Differenz (a − b, gerundete Level), Bootstrap über Alben."""
    fa, fb = np.abs(level(a) - y), np.abs(level(b) - y)
    g_ids, inv = np.unique(gruppen, return_inverse=True)
    sa, sb, cnt = (np.bincount(inv, w, len(g_ids)) for w in (fa, fb, np.ones(len(y))))
    rng = np.random.default_rng(seed)
    diffs = []
    for _ in range(n):
        k = rng.integers(0, len(g_ids), len(g_ids))
        diffs.append((sa[k].sum() - sb[k].sum()) / cnt[k].sum())
    return float(np.percentile(diffs, 2.5)), float(np.percentile(diffs, 97.5))


def permutation(modell, X, y, gruppen, spalten_gruppen: dict[str, list[int]], seed=0, wdh=5) -> dict:
    """Anstieg der MAE (stetiger Wert) auf den Testfalten, wenn eine Spaltengruppe permutiert wird."""
    rng = np.random.default_rng(seed)
    anstieg = {k: [] for k in spalten_gruppen}
    for tr, te in GroupKFold(n_splits=5, shuffle=True, random_state=seed).split(X, y, gruppen):
        m = clone(modell).fit(X[tr], y[tr])
        basis = np.mean(np.abs(m.predict(X[te]) - y[te]))
        for k, idx in spalten_gruppen.items():
            for _ in range(wdh):
                Xp = X[te].copy()
                perm = rng.permutation(len(te))
                Xp[:, idx] = Xp[perm][:, idx]                   # Gruppe gemeinsam permutieren
                anstieg[k].append(np.mean(np.abs(m.predict(Xp) - y[te])) - basis)
    return {k: float(np.mean(v)) for k, v in anstieg.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=5)
    a = ap.parse_args()
    os.nice(19 - os.nice(0))
    t0 = time.time()
    d, vek = lade()
    y = d["energy"].to_numpy(int)
    gruppen = cv_gruppen(d)
    M = matrizen(d, vek)
    print(f"{len(y)} Tracks, {d['album'].nunique()} Alben, {len(np.unique(gruppen))} CV-Gruppen, Energy {dict(zip(*np.unique(y, return_counts=True)))}")

    ergebnis, werte = {}, {}
    for mname, sname in PAARE:
        last_warten()
        X, _ = M[sname]
        je_seed = []
        for s in range(a.seeds):
            w = cv_vorhersage(modelle()[mname], X, y, gruppen, seed=s)
            je_seed.append(kennzahlen(y, w))
            if s == 0:
                werte[(mname, sname)] = w
        k0 = je_seed[0]
        streu = {m: [float(np.min([k[m] for k in je_seed])), float(np.max([k[m] for k in je_seed]))]
                 for m in ("mae", "exakt", "pm1")}
        ergebnis[f"{mname}|{sname}"] = {**k0, "spanne_ueber_seeds": streu,
                                        "mae_mittel_seeds": float(np.mean([k["mae"] for k in je_seed]))}
        print(f"  {mname:6s} {sname:22s} MAE {k0['mae']:.3f} (Wert {k0['mae_wert']:.3f}) exakt {k0['exakt']:.3f} "
              f"±1 {k0['pm1']:.3f}  Seeds MAE {streu['mae'][0]:.3f}..{streu['mae'][1]:.3f}  {k0['verteilung']}",
              flush=True)

    basis_w = werte[("median", "signal")]
    basis_mae = ergebnis["median|signal"]["mae"]
    for key, w in werte.items():
        if key[0] == "median":
            continue
        lo, hi = bootstrap_diff(y, w, basis_w, gruppen)
        e = ergebnis[f"{key[0]}|{key[1]}"]
        e["diff_zu_median_ci95"] = [lo, hi]
        e["senkung_mae"] = 1 - e["mae"] / basis_mae
        e["deutlich_besser"] = bool(e["senkung_mae"] >= 0.10 and hi < 0)

    # Bestes Modell: kleinste mittlere MAE über Seeds (gerundetes Level), Gleichstand → kleinere MAE auf Wert
    kandidaten = [k for k in ergebnis if not k.startswith("median")]
    bester = min(kandidaten, key=lambda k: (round(ergebnis[k]["mae_mittel_seeds"], 3), ergebnis[k]["mae_wert"]))
    bm, bs = bester.split("|")
    print(f"bestes: {bester}  deutlich besser als Median: {ergebnis[bester]['deutlich_besser']}")

    # Wichtigkeit
    last_warten()
    wichtig = {}
    Xs, sp_s = M["signal+koepfe"]
    ridge = modelle()["ridge"].fit(Xs, y)
    koef = ridge[-1].coef_
    wichtig["ridge_signal+koepfe_koef_std"] = dict(sorted(zip(sp_s, map(float, koef)), key=lambda t: -abs(t[1])))
    wichtig["ridge_alpha"] = float(ridge[-1].alpha_)
    gbm = modelle()["gbm"].fit(Xs, y)
    wichtig["gbm_signal+koepfe_impurity"] = dict(sorted(zip(sp_s, map(float, gbm.feature_importances_)),
                                                         key=lambda t: -t[1]))
    idx_g = {g: [sp_s.index(c) for c in cols] for g, cols in GRUPPEN.items()}
    idx_e = {c: [i] for i, c in enumerate(sp_s)}
    for mname in ("ridge", "gbm"):
        wichtig[f"perm_gruppe_{mname}"] = dict(sorted(
            permutation(modelle()[mname], Xs, y, gruppen, idx_g).items(), key=lambda t: -t[1]))
        wichtig[f"perm_einzeln_{mname}"] = dict(sorted(
            permutation(modelle()[mname], Xs, y, gruppen, idx_e, wdh=3).items(), key=lambda t: -t[1]))
    # Spearman zur Einordnung
    wichtig["spearman"] = dict(sorted(
        ((c, float(pd.Series(Xs[:, i]).corr(pd.Series(y), method="spearman"))) for i, c in enumerate(sp_s)),
        key=lambda t: -abs(t[1])))

    # Verwechslung des besten Modells (Seed 0)
    lv = level(werte[(bm, bs)])
    verw = pd.crosstab(pd.Series(y, name="mik"), pd.Series(lv, name="modell"))
    bericht = {
        "n": int(len(y)), "alben": int(d["album"].nunique()), "cv_gruppen": int(len(np.unique(gruppen))),
        "cv": "GroupKFold(5, shuffle) nach Album + Aufnahme-Dubletten, Seeds 0..%d; Kennzahlen = Seed 0" % (a.seeds - 1),
        "kriterium_deutlich": "MAE-Senkung >= 10 % UND 95-%-CI (Bootstrap über Alben) der MAE-Differenz < 0",
        "ergebnis": ergebnis, "bester": bester,
        "verwechslung_bester": {int(r): {int(c): int(verw.loc[r, c]) for c in verw.columns} for r in verw.index},
        "wichtigkeit": wichtig, "laufzeit_s": time.time() - t0,
    }
    BERICHTE.mkdir(exist_ok=True)
    (BERICHTE / "schritt2b_energie.json").write_text(json.dumps(bericht, indent=1, ensure_ascii=False))
    pd.DataFrame({"id": d["id"], "album": gruppen, "energy": y,
                  **{f"{m}|{s}": werte[(m, s)] for m, s in werte}}).to_csv(
        BERICHTE / "schritt2b_cv_vorhersagen.csv", index=False)

    # Speichern: bestes Modell auf allen 600 trainiert
    import joblib
    X, spalten = M[bs]
    final = modelle()[bm].fit(X, y)
    MODELL.mkdir(exist_ok=True)
    joblib.dump({"modell": final, "spalten": spalten, "satz": bs, "name": bm,
                 "cv": {k: ergebnis[bester][k] for k in ("mae", "mae_wert", "exakt", "pm1")},
                 "deutlich_besser": ergebnis[bester]["deutlich_besser"]}, MODELL / "energie.joblib", compress=3)
    print(f"gespeichert {MODELL / 'energie.joblib'} ({(MODELL / 'energie.joblib').stat().st_size} B), "
          f"{time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
