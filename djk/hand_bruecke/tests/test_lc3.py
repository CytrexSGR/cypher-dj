# Tests of lc3 (Launch Control 3 feedback): which place is the device, what each encoder shows, which bytes go out.
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
    assert set(s) == set(range(13, 29))
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
    assert len(alle) == 16 * 3
    assert lc3.nachrichten(s, s) == []
    neu = dict(s)
    neu[13] = (21, "fx/3 Resonance")   # same colour, new name: no LED message
    assert [n[0] for n in lc3.nachrichten(neu, s)] == [0xF0, 0xF0]
    assert lc3.daw_modus(True) == bytes([0x9F, 0x0C, 0x7F]) and lc3.daw_modus(False) == bytes([0x9F, 0x0C, 0x00])


def test_text_is_ascii_and_cut():
    t = lc3.anzeige_text(13, 0, "Dämpfung sehr lang und noch länger")
    assert t[-1] == 0xF7 and len(t) == 9 + lc3.TEXT_MAX + 1
    assert all(0x20 <= b <= 0x7E for b in t[9:-1])
