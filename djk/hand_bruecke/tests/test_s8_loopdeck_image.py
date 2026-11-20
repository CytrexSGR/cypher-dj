# Tests of the S8 loops view drawing: the column model (pure) and loops_bild (Pillow). No device, no network.
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import s8_loopdeck as L  # noqa: E402
from test_s8_loopdeck import lauf, stand_deck, zelle  # noqa: E402


def voll():
    zellen = {s: {n: dict(zelle(farbe=(s * 3 + n) % 16, nr=n), name=f"loop {s}.{n}", beats=4) for n in range(1, 9)} for s in range(1, 5)}
    laeufe = {1: lauf(z=1), 2: lauf(z=2, wartend={"zelle": 3, "ab_beat": 40}), 3: lauf(z=None), 4: lauf(z=4, verwaist=True)}
    laeufe[1].update(ab_beat=8.0, versatz_beats=0.0)
    return stand_deck(zellen, laeufe, raster="takt")


def test_spalten_playing_cell_progress_and_rows():
    sp = L.spalten(voll(), 0, 9.0)             # beat 9, started at 8, loop of 4 beats: a quarter in
    assert len(sp) == 4
    assert sp[0]["name"] == "loop 1.1" and sp[0]["p"] == pytest.approx(0.25)
    assert sp[2]["name"] == "-" and sp[2]["p"] == 0.0     # nothing plays
    assert sp[3]["name"] == "-"                            # orphaned: the cell is gone
    assert sp[0]["zeilen"][0]["name"] == "loop 1.1" and sp[0]["zeilen"][0]["zustand"] == "spielt"
    assert sp[1]["zeilen"][0]["name"] == "loop 2.1" and sp[1]["zeilen"][0]["zustand"] == "gefuellt"
    assert sp[1]["zeilen"][1]["name"] == "loop 2.2" and sp[1]["zeilen"][1]["zustand"] == "spielt"


def test_spalten_row_pair_and_pending_and_empty():
    sp = L.spalten(voll(), 1, None)            # rows 3-4
    assert sp[0]["zeilen"][0]["zelle"] == 3 and sp[0]["zeilen"][1]["zelle"] == 4
    assert sp[1]["zeilen"][0]["zustand"] == "wartend"      # track 2 waits for cell 3
    assert sp[0]["p"] == 0.0                               # no beat known
    leer = L.spalten(stand_deck(), 0, 5.0)
    assert all(c["name"] == "-" and z["zustand"] == "leer" for c in leer for z in c["zeilen"])
    assert [c["p"] for c in L.spalten(None, 0, 5.0)] == [0.0] * 4


def test_spalten_progress_wraps_with_versatz_and_is_clamped_before_the_start():
    d = voll()
    d["spuren"][0]["lauf"].update(ab_beat=8.0, versatz_beats=2.0)
    assert L.spalten(d, 0, 9.0)[0]["p"] == pytest.approx(0.75)
    assert L.spalten(d, 0, 11.0)[0]["p"] == pytest.approx(0.25)   # wrapped
    assert L.spalten(d, 0, 7.0)[0]["p"] == pytest.approx(0.5)     # before ab_beat: stands at the offset


def test_raster_text():
    assert [L.raster_text(r) for r in L.RASTER] == ["1/4", "1/2", "BEAT", "BAR", "4 BARS"]
    assert L.raster_text(None) == "-"


def test_footer_text():
    assert L.fuss_text(0, "takt", "tief") == "ROWS 1-2  GRID BAR  LO"
    assert L.fuss_text(1, "takt", "filter") == "ROWS 3-4  GRID BAR  FLT"
    assert L.fuss_text(3, "4takte", "delay") == "ROWS 7-8  GRID 4 BARS  DLY"
    assert L.fuss_text(0, "1/4") == "ROWS 1-2  GRID 1/4  FLT"        # the layer is always named
    assert [L.fuss_text(0, "1/4", s).split("  ")[-1] for s in L.SCHICHTEN] == ["FLT", "LO", "MID", "HI", "HALL", "DLY"]


@pytest.fixture
def anzeige():
    pytest.importorskip("PIL")
    pytest.importorskip("numpy")
    import s8_display as s8_anzeige
    return s8_anzeige


@pytest.mark.parametrize("stand", ["voll", "leer", "none", "dict"])
def test_loops_bild_has_the_display_size(anzeige, stand):
    deck = {"voll": voll, "leer": stand_deck, "none": lambda: None, "dict": dict}[stand]()
    for nr in (1, 2):
        bild = anzeige.loops_bild(deck, nr, 9.0, paar=1)
        assert bild.shape == (anzeige.H, anzeige.W, 3) and bild.dtype.name == "uint8"


def test_loops_bild_without_a_beat_and_a_full_stand_differ(anzeige):
    a = anzeige.loops_bild(voll(), 1, None)
    b = anzeige.loops_bild(None, 1, None)
    assert (a != b).any()


def test_loops_bild_slice_mode_draws_and_differs():
    pytest.importorskip("PIL")
    import s8_display as s8_anzeige
    a = s8_anzeige.loops_bild(voll(), 1, 9.0, 0)
    b = s8_anzeige.loops_bild(voll(), 1, 9.0, 0, slice_fokus=1)
    assert a.shape == b.shape and (a != b).any()


def test_loops_bild_marks_controls_that_have_not_picked_up(anzeige):
    a = anzeige.loops_bild(voll(), 1, None)
    b = anzeige.loops_bild(voll(), 1, None, offen={2: ["fader_db", "filter"]})
    assert (a != b).any()
    assert b.shape == a.shape


def test_loops_bild_names_the_layer_in_the_footer(anzeige, monkeypatch):
    gesehen = []
    echt = L.fuss_text
    monkeypatch.setattr(L, "fuss_text", lambda *a: gesehen.append(a) or echt(*a))
    anzeige.loops_bild(voll(), 1, 9.0, paar=1, schicht="mitte")
    anzeige.loops_bild(voll(), 1, 9.0)
    assert gesehen[0][2] == "mitte" and gesehen[1][2] == "filter"


def test_loops_bild_marks_a_killed_band_of_the_shown_eq_layer(anzeige):
    d = voll()
    d["spuren"][1]["kill"] = {"tief": False, "mitte": True, "hoch": False}
    mit = anzeige.loops_bild(d, 1, 9.0, schicht="mitte")
    d["spuren"][1]["kill"] = {"tief": True, "mitte": False, "hoch": False}
    ohne = anzeige.loops_bild(d, 1, 9.0, schicht="mitte")          # same layer, the band is not killed
    assert (mit != ohne).any()
    gleich = anzeige.loops_bild(d, 1, 9.0, schicht="filter")
    d["spuren"][1]["kill"] = {"tief": False, "mitte": True, "hoch": False}
    assert not (gleich != anzeige.loops_bild(d, 1, 9.0, schicht="filter")).any()   # no mark on the other layers


def test_kill_marks_lists_the_killed_tracks_of_the_layer():
    d = voll()
    d["spuren"][1]["kill"] = {"tief": False, "mitte": True, "hoch": False}
    d["spuren"][3]["kill"] = {"tief": True, "mitte": True, "hoch": False}
    assert L.kill_spuren(d, "mitte") == {2, 4}
    assert L.kill_spuren(d, "tief") == {4}
    assert L.kill_spuren(d, "filter") == set() and L.kill_spuren(d, "hall") == set() and L.kill_spuren(None, "mitte") == set()
