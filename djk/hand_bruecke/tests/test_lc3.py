# Tests of lc3 (Launch Control 3 feedback): which place is the device, what each encoder shows, which bytes go out.
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import lc3  # noqa: E402

LERNEN = {
    "controller": [{"platz": 1, "port": "Midi-Bridge:LPD8: MIDI 1 (capture)", "name": "LPD8"},
                   {"platz": 2, "port": "Midi-Bridge:LC3 1: DAW In (capture)", "name": "LC3 1"}],
    "zuordnungen": [{"pfad": "fx/3/bk/4", "kanal": 16, "nr": 13, "platz": 2, "name": "fx/3 Cutoff"},
                    {"pfad": "deck/1/filter", "kanal": 16, "nr": 14, "platz": 2, "name": "deck/1/filter"},
                    {"pfad": "deck/2/filter", "kanal": 16, "nr": 14, "platz": 1, "name": "deck/2/filter"},   # another device, same CC
                    {"pfad": "xfader", "kanal": 1, "nr": 15, "platz": 2, "name": "xfader"}],                  # not a DAW mode encoder
}


def test_place_only_with_the_daw_port():
    assert lc3.platz_von(LERNEN) == 2
    plain = {"controller": [{"platz": 2, "port": "Midi-Bridge:LC3 1: MIDI In (capture)"}]}
    assert lc3.platz_von(plain) is None, "the plain MIDI port leaves the device alone"
    assert lc3.platz_von({}) is None


def test_soll_colours_by_group_and_names():
    s = lc3.soll(LERNEN, 2)
    assert set(s) == set(range(13, 29)) | set(range(37, 45))
    assert s[13] == (21, "fx/3 Cutoff")
    assert s[14] == (41, "deck/1/filter")
    assert s[15] == (0, "free"), "a CC on another channel is not an encoder of DAW mode"
    assert s[28] == (0, "free")


def test_messages_bytes_and_diff():
    s = lc3.soll(LERNEN, 2)
    alle = lc3.nachrichten(s, {})
    assert alle[0] == bytes([0xB0, 13, 21])
    assert alle[1] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x04, 13, 0x44, 0xF7])
    assert alle[2] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x06, 13, 0x00]) + b"fx/3 Cutoff" + bytes([0xF7])
    assert len(alle) == 16 * 3 + 8, "16 encoders (LED, config, text) and 8 button LEDs"
    assert lc3.nachrichten(s, s) == []
    neu = dict(s)
    neu[13] = (21, "fx/3 Resonance")   # same colour, new name: no LED message
    assert [n[0] for n in lc3.nachrichten(neu, s)] == [0xF0, 0xF0]
    assert lc3.daw_modus(True) == bytes([0x9F, 0x0C, 0x7F]) and lc3.daw_modus(False) == bytes([0x9F, 0x0C, 0x00])


def test_text_is_ascii_and_cut():
    t = lc3.anzeige_text(13, 0, "Dämpfung sehr lang und noch länger")
    assert t[-1] == 0xF7 and len(t) == 9 + lc3.TEXT_MAX + 1
    assert all(0x20 <= b <= 0x7E for b in t[9:-1])


def test_soll_skips_learned_buttons_and_pads():
    lernen = {"zuordnungen": [{"pfad": "fx/3/bk/4", "kanal": 16, "nr": 13, "platz": 2, "name": "fx/3 Cutoff"},
                              {"pfad": "deck/1/play", "kanal": 16, "nr": 14, "platz": 2, "typ": "note", "art": "taste", "name": "Deck 1 Play"},
                              {"pfad": "deck/1/kill/lo", "kanal": 16, "nr": 15, "platz": 2, "art": "taste", "name": "Kill"}]}
    s = lc3.soll(lernen, 2)
    assert s[13] == (21, "fx/3 Cutoff")
    assert s[14] == (lc3.FARBE_AUS, "free"), "a note entry does not light an encoder"
    assert s[15] == (lc3.FARBE_AUS, "free"), "a switch entry on a CC does not either"


def test_box_colour_lights_encoders_in_rgb():
    lernen = {"zuordnungen": [{"pfad": "erz/5/bk/3", "kanal": 16, "nr": 13, "platz": 2, "name": "erz/5 Cutoff", "box": 1},
                              {"pfad": "erz/5/bk/4", "kanal": 16, "nr": 14, "platz": 2, "name": "erz/5 Reso", "box": 12},
                              {"pfad": "erz/5/bk/9", "kanal": 16, "nr": 15, "platz": 2, "name": "erz/5 Nine"}]}
    s = lc3.soll(lernen, 2)
    assert s[13] == (lc3.BOX_FARBEN[0], "erz/5 Cutoff"), "the first box in use is the first colour"
    assert s[14] == (lc3.BOX_FARBEN[1], "erz/5 Reso"), "the colour is the rank of the box among the boxes in use, not its index"
    assert s[15] == (13, "erz/5 Nine"), "without box: the colour of the group as before"
    m = lc3.nachrichten(s, {})
    assert m[0] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x01, 0x53, 13, 127, 0, 0, 0xF7]), "RGB SysEx, index = the CC"


def test_buttons_box_white_off():
    lernen = {"zuordnungen": [{"pfad": "erz/5/bk/3", "kanal": 1, "nr": 37, "platz": 2, "name": "x", "box": 6},
                              {"pfad": "deck/1/play", "kanal": 1, "nr": 38, "platz": 2, "art": "taste", "name": "Deck 1 Play"},
                              {"pfad": "deck/1/pfl", "kanal": 1, "nr": 39, "platz": 1, "art": "taste", "name": "other place"},
                              {"pfad": "deck/1/cue", "kanal": 1, "nr": 40, "platz": 2, "typ": "note", "art": "taste", "name": "a note"}]}
    s = lc3.soll(lernen, 2)
    assert s[37] == (lc3.BOX_FARBEN[0], None)
    assert s[38] == (lc3.FARBE_SONST, None), "learned without a box: white"
    assert s[39] == (lc3.FARBE_AUS, None) and s[40] == (lc3.FARBE_AUS, None), "free, another place, or a note: off"
    assert all(s[i] == (lc3.FARBE_AUS, "free") for i in lc3.ENCODER)
    m = lc3.nachrichten(s, {})
    assert bytes([0xB0, 38, 3]) in m and bytes([0xB0, 39, 0]) in m
    assert not any(n[6:8] == bytes([0x04, 37]) or n[6:8] == bytes([0x06, 37]) for n in m if n[0] == 0xF0), "no display message for a button"
    assert lc3.nachrichten(s, s) == []


def test_box_palette_matches_the_page():
    quelle = (Path(__file__).resolve().parents[2] / "ui" / "public" / "device_window.js").read_text(encoding="utf-8")
    m = re.search(r"CTL_FARBEN = \[([^\]]*)\]", quelle)
    assert m, "CTL_FARBEN not found in device_window.js"
    hexe = re.findall(r"#([0-9a-fA-F]{6})", m.group(1))
    assert len(hexe) == len(lc3.BOX_FARBEN), "the page and the LEDs have the same number of box colours (same hues, same order)"
    assert len(set(lc3.BOX_FARBEN)) == len(lc3.BOX_FARBEN)
    led = re.search(r"CTL_LED = \[([^\]]*)\]", quelle)
    assert led, "CTL_LED not found in device_window.js"
    rgb = [tuple(round(int(h[i:i + 2], 16) * 127 / 255) for i in (0, 2, 4)) for h in re.findall(r"#([0-9a-fA-F]{6})", led.group(1))]
    assert rgb == lc3.BOX_FARBEN, "CTL_LED of the page must be BOX_FARBEN scaled to 0..255: the title bars show the LED colours"



def test_page_buttons_step_the_program_and_unknown_presses_are_named():
    assert lc3.programm_schritt(bytes([0xB0, 106, 127])) == -1
    assert lc3.programm_schritt(bytes([0xB0, 107, 127])) == 1
    assert lc3.programm_schritt(bytes([0xB0, 107, 0])) is None      # the release
    assert lc3.programm_schritt(bytes([0xBF, 13, 64])) is None      # an encoder
    assert lc3.unbekannter_druck(bytes([0xB0, 103, 127])) == (1, 103)
    assert lc3.unbekannter_druck(bytes([0xB0, 37, 127])) is None    # a numbered button
    assert lc3.unbekannter_druck(bytes([0xB0, 106, 127])) is None
    assert lc3.unbekannter_druck(bytes([0x90, 12, 127])) is None


def test_values_go_back_to_rested_encoders_only():
    lernen = {"zuordnungen": [{"pfad": "spur/1/bk/13", "kanal": 0, "nr": 13, "platz": 2, "wert": 0.5},
                              {"pfad": "spur/1/bk/11", "kanal": 16, "nr": 14, "platz": 2, "wert": 1},
                              {"pfad": "spur/1/bk/9", "kanal": 0, "nr": 15, "platz": 2},                      # no value known
                              {"pfad": "spur/1/bk/14", "kanal": 0, "nr": 37, "platz": 2, "art": "taste", "wert": 0.25},   # a button
                              {"pfad": "spur/1/bk/2", "kanal": 0, "nr": 16, "platz": 1, "wert": 0.1}]}       # another place
    w = lc3.werte(lernen, 2)
    assert w == {13: 64, 14: 127}
    alle = lc3.wert_nachrichten(w, {}, {}, 100.0)
    assert alle == [(13, bytes([0xBF, 13, 64])), (14, bytes([0xBF, 14, 127]))], "channel 16, the encoder's own CC"
    assert lc3.wert_nachrichten(w, {13: 64, 14: 127}, {}, 100.0) == [], "the device holds these values already"
    assert lc3.wert_nachrichten(w, {13: 10}, {13: 99.5, 14: 98.0}, 100.0) == [(14, bytes([0xBF, 14, 127]))], "an encoder that just moved is left alone"
    assert lc3.encoder_wert(bytes([0xBF, 13, 77])) == (13, 77)
    assert lc3.encoder_wert(bytes([0xB0, 37, 127])) is None, "a button is not an encoder"


def test_program_goes_on_the_display():
    fokus = {"plaetze": [{"platz": 1}, {"platz": 2, "programm": {"nr": 2, "von": 4, "name": "FILTER ENV"}}]}
    assert lc3.programm_von(fokus, 2) == (2, 4, "FILTER ENV")
    assert lc3.programm_von(fokus, 1) is None and lc3.programm_von({}, 2) is None
    assert lc3.programm_zeilen("OSCILLATORS \u00b7 MIXER \u00b7 FILTER \u00b7 TUNE") == ("OSCILLATORS MIXER", "FILTER TUNE")
    assert lc3.programm_zeilen("FILTER ENV \u00b7 AMP ENV \u00b7 LFO \u00b7 VOICE \u00b7 AMP") == ("FILTER ENV AMP ENV", "LFO VOICE AMP")
    assert lc3.programm_zeilen("MOD") == ("MOD", "")
    n = lc3.programm_anzeige((2, 4, "MOD \u00b7 A VERY LONG BOX NAME INDEED"))
    assert n[0] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x04, 54, 2, 0xF7])
    assert n[1] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x06, 54, 0]) + b"PROGRAM 2/4" + bytes([0xF7])
    assert n[2] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x06, 54, 1]) + b"MOD" + bytes([0xF7])
    assert n[3] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x06, 54, 2]) + b"A VERY LONG BOX NA" + bytes([0xF7])
    assert n[4] == bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x16, 0x04, 54, 0x7F, 0xF7])
