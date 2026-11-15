# Tests of s8_led: single-byte LED reports for the probe and the offset list parser.
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import s8_led  # noqa: E402


def test_einzel_bericht_lights_one_byte():
    b = s8_led.einzel_bericht(0x80, 60, 127)
    assert len(b) == 119
    assert b[0] == 0x80
    assert b[60] == 127
    assert b.count(0) == 117


def test_einzel_bericht_mixer_report_length():
    assert len(s8_led.einzel_bericht(0x82, 44, 255)) == 74


@pytest.mark.parametrize("args", [(0x80, 119, 1), (0x80, 0, 1), (0x83, 1, 1), (0x80, 5, 256)])
def test_einzel_bericht_refuses_bad_arguments(args):
    with pytest.raises(ValueError):
        s8_led.einzel_bericht(*args)


def test_probe_offsets_parses_lists_and_ranges():
    assert s8_led.probe_offsets("58,59,60,65-68") == [58, 59, 60, 65, 66, 67, 68]
    assert s8_led.probe_offsets("44-46,45") == [44, 45, 46]


@pytest.mark.parametrize("text", ["", "9-3"])
def test_probe_offsets_refuses_bad_text(text):
    with pytest.raises(ValueError):
        s8_led.probe_offsets(text)


# -- deck button LEDs (task 3) -----------------------------------------------------------------------------------------

KARTE_PFAD = Path(__file__).resolve().parents[1] / "s8_leds.json"


@pytest.fixture(scope="module")
def karte():
    return s8_led.lade_karte(KARTE_PFAD)


def test_lade_karte_reads_the_repo_file(karte):
    assert karte["links"]["play"] == 60
    assert karte["rechts"]["loop"] == [65, 66, 67, 68]


def test_lade_karte_refuses_a_foreign_version_or_a_missing_key(tmp_path):
    p = tmp_path / "k.json"
    p.write_text('{"version": 2}')
    with pytest.raises(ValueError):
        s8_led.lade_karte(p)
    p.write_text('{"version": 1}')
    with pytest.raises(ValueError):
        s8_led.lade_karte(p)


def test_pads_are_set_in_the_deck_colour(karte):
    f = s8_led.rahmen_fuer_seite(0x80, 1, {1, 3}, None, karte)
    assert len(f) == 119
    assert f[1:4] == bytes((0, 190, 220))
    assert f[4:7] == bytes((0, 11, 13))
    assert f[7:10] == bytes((0, 190, 220))


def test_buttons_do_not_blank_the_pads(karte):
    lage = {"decks": [{"deck": 1, "status": 2, "loop": None}]}
    f = s8_led.rahmen_fuer_seite(0x80, 1, {1, 3}, lage, karte)
    assert f[60] == 127
    assert f[65:69] == bytes((20,) * 4)
    assert f[1:25] == s8_led.rahmen_fuer_seite(0x80, 1, {1, 3}, None, None)[1:25]


def test_tasten_zustand(karte):
    assert s8_led.tasten_zustand({"status": 1, "loop": {"laenge": 4}}, karte) == {"play": 20, "loop": 127}
    assert s8_led.tasten_zustand(None, karte) == {"play": 20, "loop": 20}


def test_right_side_follows_deck_two(karte):
    lage = {"decks": [{"deck": 1, "status": 0}, {"deck": 2, "status": 2}]}
    f = s8_led.rahmen_fuer_seite(0x81, 2, set(), lage, karte)
    assert f[60] == 127
    assert f[1:4] == bytes((14, 9, 1))  # empty pad at 6 % of the deck B colour (240, 150, 30)


def test_missing_lage_or_card_give_a_valid_frame(karte):
    assert len(s8_led.rahmen_fuer_seite(0x80, 1, set(), None, karte)) == 119
    assert len(s8_led.rahmen_fuer_seite(0x80, 1, set(), {"decks": None}, karte)) == 119
    assert len(s8_led.rahmen_fuer_seite(0x81, 2, set(), None, None)) == 119
