# Tests of seq_sicht (S8 SEQ screen model): pattern choice, cell window, playhead per pattern length.
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from seq_view import seq_sicht  # noqa: E402

KICK = "x...x...x...x..."


def zeile(name="kick", zellen=KICK, teiler=0.25, art="noten"):
    z = {"id": name, "art": art, "name": name, "teiler": teiler}
    if zellen is not None:
        z["zellen"] = zellen
    return z


def folge(name="Drums", laenge=4, zeilen=None, stumm=False, editierbar=True):
    return {"name": name, "stumm": stumm, "editierbar": editierbar, "laenge_beats": laenge,
            "zeilen": [zeile()] if zeilen is None else zeilen}


def platz(*folgen):
    return {"gruppe_id": "g1", "folgen": list(folgen)}


def test_empty_place():
    assert seq_sicht(None, 0.0) == {"leer": True, "kopf": "", "zeilen": []}
    assert seq_sicht({"folgen": []}, 0.0)["leer"] is True


def test_one_pattern_wraps_at_its_length():
    for beat in (1.30, 5.30):
        s = seq_sicht(platz(folge()), beat)
        assert s["leer"] is False
        assert s["kopf"] == "Drums  1/1"
        assert s["zeilen"][0]["kopf_index"] == 5
        assert s["zeilen"][0]["zellen"] == KICK


def test_32_cells_page_with_the_playhead():
    cells = "x..." * 8
    s = seq_sicht(platz(folge(laenge=8, zeilen=[zeile(zellen=cells)])), 5.0)
    z = s["zeilen"][0]
    assert z["zellen"] == cells[16:32]
    assert z["kopf_index"] == 4


def test_12_cells_wrap_at_12():
    cells = "x..." * 3
    z = seq_sicht(platz(folge(laenge=3, zeilen=[zeile(zellen=cells)])), 3.1)["zeilen"][0]
    assert z["zellen"] == cells + "    "
    assert z["kopf_index"] == 0


def test_rows_keep_their_own_playhead():
    zl = [zeile("kick"), zeile("hat", "x.x.x.x.", teiler=0.5)]
    z = seq_sicht(platz(folge(zeilen=zl)), 1.3)["zeilen"]
    assert [r["kopf_index"] for r in z] == [5, 2]


def test_first_audible_pattern_is_chosen():
    s = seq_sicht(platz(folge("A", stumm=True), folge("B")), 0.0)
    assert s["kopf"] == "B  2/2"
    s = seq_sicht(platz(folge("A", editierbar=False), folge("B", editierbar=False)), 0.0)
    assert s["leer"] is True


def test_no_beat_gives_no_playhead():
    assert seq_sicht(platz(folge()), None)["zeilen"][0]["kopf_index"] is None


def test_only_note_rows_and_at_most_eight():
    zl = [zeile(f"r{i}") for i in range(10)] + [zeile("curve", None, art="werte")]
    z = seq_sicht(platz(folge(zeilen=zl)), 0.0)["zeilen"]
    assert len(z) == 8
    assert all(r["name"] != "curve" for r in z)


def test_seq_bild_with_an_empty_place_does_not_raise():
    from s8_display import seq_bild
    st = SimpleNamespace(seq_platz=lambda n: None, projekt_beat=lambda b: None)
    assert seq_bild(st, 1, 120.0).shape == (272, 480, 3)
