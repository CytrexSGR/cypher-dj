import numpy as np
import pytest

from strukturvorschlag import merkmale, raster, detektor
from synth import spur, SR, BPM, TAKT


def lauf(y, p=None):
    fm = merkmale.frame_merkmale(y, SR)
    r = raster.raster_aus_anker(fm["dauer_s"], BPM, 0.0)
    db, fl = merkmale.takt_merkmale(fm, r["starts"], r["takt_s"])
    return detektor.erkenne(db, fl, r, p or detektor.Parameter(), fm["dauer_s"])[0], fm


@pytest.fixture(scope="module")
def struktur():
    y = spur([(32, {"kick", "hat"}), (8, {"hat"}), (8, {"kick", "hat"}), (16, {"kick", "hat", "ton"})])
    return lauf(y)[0]


def nahe(vors, takt, tol=1):
    return [v for v in vors if abs(v["takt"] - takt) <= tol]


def test_break_bei_32(struktur):
    v = nahe(struktur, 32)
    assert v and v[0]["klasse"] == "break", struktur


def test_drop_bei_40(struktur):
    v = nahe(struktur, 40)
    assert v and v[0]["klasse"] == "drop/rein", struktur


def test_mehr_rein_bei_48(struktur):
    v = nahe(struktur, 48)
    assert v and v[0]["klasse"] in ("mehr rein", "vocal?"), struktur
    assert v[0]["baender_db"]["mitte"] > 3


def test_keine_vorschlaege_ausserhalb(struktur):
    erlaubt = {0, 32, 40, 48, 64}
    fremd = [v for v in struktur if min(abs(v["takt"] - k) for k in erlaubt) > 1]
    assert not fremd, fremd


def test_negativkontrolle_gleichfoermig():
    vors, _ = lauf(spur([(64, {"kick", "hat"})]))
    innen = [v for v in vors if v["klasse"] != "anfang" and 2 < v["takt"] < 60]
    assert innen == [], innen


def test_schema_felder(struktur):
    for v in struktur:
        assert set(v) >= {"sekunde", "takt", "phrase", "klasse", "staerke", "wert_db", "baender_db"}
        assert 0.0 <= v["staerke"] <= 1.0
        assert abs(v["sekunde"] - v["takt"] * TAKT) < 1e-2


def test_eigenes_raster_findet_takt():
    # Vorlauf von 0,3 s Stille, Wechsel an Takt 16: eigene Schaetzung muss Beat-Phase und Eins treffen
    y = spur([(16, {"kick", "hat"}), (8, {"hat"}), (16, {"kick", "hat", "ton"})])
    y = np.concatenate([np.zeros(int(0.3 * SR), np.float32), y])
    fm = merkmale.frame_merkmale(y, SR)
    r = raster.eigene_schaetzung(fm, 125.0, detektor.eins_waehler_fuer(fm))
    assert abs(r["bpm"] - 125.0) < 0.2
    d = (r["anker_s"] - 0.3) % TAKT
    assert min(d, TAKT - d) < 0.05, r["anker_s"]


def test_steigend_laesst_break_weg():
    y = spur([(32, {"kick", "hat"}), (8, {"hat"}), (8, {"kick", "hat"}), (16, {"kick", "hat", "ton"})])
    vors, _ = lauf(y, detektor.Parameter(richtung="steigend"))
    klassen = {v["takt"]: v["klasse"] for v in vors}
    assert not nahe(vors, 32), vors          # Bass faellt weg: kein Vorschlag
    assert nahe(vors, 40) and nahe(vors, 48), vors
    assert "break" not in klassen.values()
