"""Energie-Modell: Kennzahlen-Rechnung, gespeichertes Modell, Richtung und Negativkontrollen (ohne TF-Lauf)."""
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from tonart_energie import energie_modell as em

MODELL = em.MODELL / "energie.joblib"
CV = em.BERICHTE / "schritt2b_cv_vorhersagen.csv"


def test_kennzahlen_bekannter_fall():
    y = np.array([5, 6, 7, 8])
    k = em.kennzahlen(y, np.array([5.4, 6.6, 7.0, 5.9]))        # Level 5, 7, 7, 6
    assert k["mae"] == pytest.approx((0 + 1 + 0 + 2) / 4)
    assert k["exakt"] == pytest.approx(0.5) and k["pm1"] == pytest.approx(0.75)


def test_level_rundet_und_klemmt():
    assert list(em.level(np.array([0.2, 5.49, 5.51, 12.0]))) == [1, 5, 6, 10]


def test_median_grundlinie_konstant():
    m = em.Median().fit(None, np.array([5, 6, 6, 7, 9]))
    assert set(m.predict(np.zeros((3, 1)))) == {6.0}


def test_gruppen_cv_trennt_alben():
    y = np.arange(40) % 3 + 5
    g = np.repeat(np.arange(8), 5).astype(str)
    X = np.random.default_rng(0).normal(size=(40, 2))
    seen = []
    from sklearn.model_selection import GroupKFold
    for tr, te in GroupKFold(5, shuffle=True, random_state=0).split(X, y, g):
        assert not set(g[tr]) & set(g[te])
        seen += list(te)
    assert sorted(seen) == list(range(40))


@pytest.mark.skipif(not MODELL.exists(), reason="Modell noch nicht trainiert")
def test_gespeichertes_modell_nicht_entartet_und_nan_fest():
    from tonart_energie import energie_level as el
    pk = el.paket()
    assert pk["deutlich_besser"] is True and len(pk["spalten"]) == len(set(pk["spalten"]))
    # Negativkontrolle: fehlendes/NaN-Merkmal wird abgewiesen, nicht still vorhergesagt
    werte = {s: 0.0 for s in pk["spalten"]}
    werte[pk["spalten"][0]] = math.nan
    with pytest.raises(ValueError):
        el.aus_merkmalen(werte)
    with pytest.raises(KeyError):
        el.aus_merkmalen({})


@pytest.mark.skipif(not CV.exists(), reason="CV-Vorhersagen fehlen")
def test_cv_richtung_und_spreizung():
    d = pd.read_csv(CV)
    w = d["ridge|signal+koepfe+jam56"]
    # Richtung: MIK-hohe Tracks bekommen im Mittel höhere Werte als MIK-niedrige (außerhalb der eigenen Falte)
    assert w[d.energy >= 7].mean() - w[d.energy == 5].mean() > 0.5
    # nicht entartet: das Modell nutzt mindestens drei Level, die Grundlinie nur eins
    assert em.level(w.to_numpy()).tolist().count(6) < len(d) * 0.75
    assert len(set(em.level(w.to_numpy()))) >= 3
    assert set(em.level(d["median|signal"].to_numpy())) == {6}


def test_cv_gruppen_legt_aufnahme_dubletten_zusammen():
    import pandas as pd
    from tonart_energie.energie_modell import cv_gruppen
    d = pd.DataFrame({"album": ["Comp A", "Comp B", "EP", "EP", "Andere"],
                      "artist": ["Hell Driver", "Hell Driver", "X", "X", "Y"],
                      "title": ["Anti Parasite (Original Mix)", "Anti Parasite (Original Mix)", "Eins", "Zwei", "Eins"]})
    g = cv_gruppen(d)
    assert g[0] == g[1]            # dieselbe Aufnahme auf zwei Compilations
    assert g[2] == g[3]            # dasselbe Album
    assert g[0] != g[2] and g[4] != g[2]   # anderer Artist, gleicher Titel: keine Dublette
