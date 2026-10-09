"""Welle 3 Task 4 (Plan 2026-10-06-welle3-beatmatch.md): eine Fassung im Zieltempo für vorhandenes Material, aus dem
Original gerendert wie korrigieren (dieselbe Karte, dieselben Korrekturen, dieselbe Stimmung), Name <bpm>_r1."""
import numpy as np
import pytest

from klickhilfe import klick, sha_baum
from werkstatt import fassung, kette
from werkstatt.bestand import lies_json
from werkstatt.index import zaehle
from werkstatt.karte import Karte

SR = 48000


@pytest.fixture
def material(tmp_path):
    p = tmp_path / "klick134.wav"
    s = klick(p)
    b = tmp_path / "bestand"
    mid = kette.einlesen(p, b, karte=Karte(sekunden=s, beats=np.arange(len(s), dtype=float)))["material_id"]
    return b, mid


def einsaetze(ordner, n_beats, bpm):
    """Je Quell-Beat n das erste Frame mit |x| > 0,05 ab 30 ms vor dem Soll; Rückgabe Abweichung vom Soll in Frames."""
    f = lies_json(ordner / "fassung.json")
    x = np.fromfile(ordner / "basis.f32", dtype="<f4").reshape(-1, 2)[:, 0]
    fpb = 60.0 / bpm * SR
    aus = []
    for n in range(2, n_beats):
        soll = f["erster_schlag_frame"] + n * fpb
        a = int(soll - 0.030 * SR)
        idx = np.flatnonzero(np.abs(x[a:a + int(fpb)]) > 0.05)
        if idx.size:
            aus.append(a + int(idx[0]) - soll)
    return np.asarray(aus)


def test_fassung_132_aus_vorhandenem_material(material):
    b, mid = material
    r1 = b / mid / "fassungen" / "128000_r1"
    vorher = sha_baum(r1)
    r = fassung.neue_fassung(b, mid, 132.0)
    assert r["status"] == "neu" and r["fassung"] == "132000_r1"
    f = lies_json(b / mid / "fassungen" / "132000_r1" / "fassung.json")
    f128 = lies_json(r1 / "fassung.json")
    assert f["basis_bpm"] == 132.0 and f["fassung"] == 1
    assert abs(f["beats"] - f128["beats"]) < 0.05
    musik = lambda g: g["frames"] - g["erster_schlag_frame"]   # noqa: E731
    assert abs(musik(f) - musik(f128) * 128.0 / 132.0) < 0.05 * SR
    assert f["stimmung_korrektur_cent"] == f128["stimmung_korrektur_cent"]
    assert sha_baum(r1) == vorher                      # die 128er bleibt unberührt
    assert zaehle(b) == (1, 2)                         # im Index: ein Material, zwei Fassungen
    assert fassung.neue_fassung(b, mid, 132.0)["status"] == "vorhanden"


def test_fassung_lage_der_schlaege_wie_die_128er(material):
    """Die Schläge liegen in der 132er Fassung so nah an ihrem Raster wie in der 128er an ihrem (R3 zieht Transienten
    in beiden gleich vor): Median-Unterschied höchstens 1 ms, größter Betrag höchstens 2 ms."""
    b, mid = material
    fassung.neue_fassung(b, mid, 132.0)
    d128 = einsaetze(b / mid / "fassungen" / "128000_r1", 40, 128.0)
    d132 = einsaetze(b / mid / "fassungen" / "132000_r1", 40, 132.0)
    assert len(d128) >= 30 and len(d132) >= 30
    assert abs(np.median(d132) - np.median(d128)) <= 48
    assert np.abs(d132).max() <= 96


def test_fassung_ausserhalb_bereich_und_basis(material):
    b, mid = material
    for bpm in (59.0, 200.5):
        with pytest.raises(ValueError):
            fassung.neue_fassung(b, mid, bpm)
    assert fassung.neue_fassung(b, mid, 128.0)["status"] == "vorhanden"   # Negativ-Kontrolle: die Basis gibt es schon


def test_fassung_deckel_zwei_zusatztempi(material):
    """Höchstens zwei Fassungen außer 128 je Material; die dritte wird gemeldet, nicht angelegt, nichts gelöscht."""
    b, mid = material
    assert fassung.neue_fassung(b, mid, 130.0)["status"] == "neu"
    assert fassung.neue_fassung(b, mid, 132.0)["status"] == "neu"
    r = fassung.neue_fassung(b, mid, 134.0)
    assert r["status"] == "voll" and sorted(r["fassungen"]) == ["130000_r1", "132000_r1"]
    assert sorted(p.name for p in (b / mid / "fassungen").iterdir()) == ["128000_r1", "130000_r1", "132000_r1"]
