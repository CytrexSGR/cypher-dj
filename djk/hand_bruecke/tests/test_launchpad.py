# Tests of launchpad (Launchpad Mini MK3 step grid of the SEQ deck): fake MIDI device, fake page, no hardware, no network.
import copy
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import launchpad as lp  # noqa: E402

TEXT = ("folge Drums  bk:rb  1bar\n"
        "noten kick 36  1/16  x... o... x... ....   ; Kick\n"
        "noten hat 42  1/16  .... x... .... x...\n"
        "noten bass  1/16  c2 ~ . . d#2 . . . . . . . . . . .\n"
        "noten lead  1/16  . . . . . . . . . . . . . . . .\n")


def stand():
    return {"1": None, "2": {"gruppe_id": "g", "folgen": [
        {"name": "Drums", "stumm": False, "editierbar": True, "laenge_beats": 4, "text": TEXT, "zeilen": [
            {"id": "kick", "art": "noten", "teiler": 0.25, "ton": 36, "zellen": "x...o...x......."},
            {"id": "hat", "art": "noten", "teiler": 0.25, "ton": 42, "zellen": "....x.......x..."},
            {"id": "bass", "art": "noten", "teiler": 0.25, "zellen": "x...x..........."},
            {"id": "lead", "art": "noten", "teiler": 0.25, "zellen": "." * 16},
            {"id": "vel", "art": "werte", "teiler": 0.25, "ziel": "vel"}]},
        {"name": "Two", "stumm": True, "editierbar": True, "laenge_beats": 4, "text": "", "zeilen": []}]},
        "3": None, "4": None}


def pad(reihe_unten, spalte):
    return bytes([0x90, 10 * reihe_unten + spalte, 100])


def raster():
    r = lp.Raster()
    r.setze_stand(stand())
    return r


def test_programmer_mode_and_rgb_bytes():
    assert lp.programmer_modus(True) == bytes.fromhex("f0 00 20 29 02 0d 0e 01 f7")
    assert lp.programmer_modus(False) == bytes.fromhex("f0 00 20 29 02 0d 0e 00 f7")
    assert lp.led_sysex([(81, (127, 0, 5)), (11, (1, 2, 3))]) == bytes.fromhex("f0 00 20 29 02 0d 03 03 51 7f 00 05 03 0b 01 02 03 f7")


def test_press_decoding():
    assert lp.druck(pad(8, 1)) == ("pad", 0, 0), "the top row of the grid is row 8"
    assert lp.druck(pad(1, 8)) == ("pad", 7, 7)
    assert lp.druck(bytes([0x90, 81, 0])) is None, "note on with velocity 0 is a release"
    assert lp.druck(bytes([0xB0, 91, 127])) == ("oben", "hoch")
    assert lp.druck(bytes([0xB0, 94, 127])) == ("oben", "rechts")
    assert lp.druck(bytes([0xB0, 89, 127])) == ("folge", 0)
    assert lp.druck(bytes([0xB0, 19, 127])) == ("folge", 7)
    assert lp.druck(bytes([0xB0, 89, 0])) is None


def test_two_rows_per_lane_and_colours():
    leds = raster().leds(None)
    kick, hat, bass = lp.LANE_FARBEN[0], lp.LANE_FARBEN[1], lp.LANE_FARBEN[2]
    assert leds[81] == kick                                    # kick cell 1, top row
    assert leds[85] == lp.skaliert(kick, lp.GEISTER)           # cell 5 is a ghost note: second brightness step
    assert leds[71] == kick                                    # kick cell 9 = second row of the lane, column 1
    assert leds[75] == lp.skaliert(kick, lp.BEAT_DIMM)         # empty cell 13 starts a beat: dim marker
    assert leds[82] == (0, 0, 0)                               # empty, not a beat start
    assert leds[65] == hat and leds[55] == hat                 # hat cells 5 and 13 (rows 6 and 5 from the bottom)
    assert leds[41] == bass and leds[45] == bass
    assert leds[95] == (0, 0, 0), "Session button stays off while a deck exists"


def test_pattern_buttons_right_column():
    leds = raster().leds(None)
    assert leds[89] == lp.FOLGE_GEWAEHLT and leds[79] == lp.FOLGE_STUMM
    assert leds[69] == (0, 0, 0), "no third pattern: unlit"
    r = raster()
    assert r.waehle_folge(1) and r.folge()[0] == 1
    assert not r.waehle_folge(5)
    assert r.leds(None)[79] == lp.FOLGE_GEWAEHLT


def test_no_deck_is_dark_except_session():
    r = lp.Raster()
    r.setze_stand({"1": None, "2": None, "3": None, "4": None})
    leds = r.leds(None)
    assert leds[95] == lp.ROT
    assert [i for i, c in leds.items() if c != (0, 0, 0)] == [95]


def test_lowest_place_with_a_deck():
    s = stand()
    s["1"] = copy.deepcopy(s["2"])
    assert lp.deck_platz(s)[0] == 1
    assert lp.deck_platz({"1": None})  is None


def test_playhead_column_white():
    leds = raster().leds(1.0)      # beat 1.0 = cell 5 (index 4) in every lane
    assert leds[85] == lp.WEISS and leds[65] == lp.WEISS and leds[45] == lp.WEISS   # set cells
    assert leds[25] == lp.WEISS_DIMM                                                # empty cell of the lead lane
    assert leds[81] == lp.LANE_FARBEN[0]
    assert raster().leds(4.0)[81] == lp.WEISS, "the playhead wraps at the pattern length (4 beats)"


def test_scrolling_and_paging():
    s = stand()
    f = s["2"]["folgen"][0]
    f["zeilen"].insert(4, {"id": "l5", "art": "noten", "teiler": 0.25, "zellen": "x" + "." * 31})
    r = lp.Raster()
    r.setze_stand(s)
    assert r.seite == 0 and r.leds(None)[94] == lp.PFEIL_FARBE and r.leds(None)[92] == lp.PFEIL_FARBE
    r.oben("runter")
    assert r.zeile == 1
    r.oben("runter")
    assert r.zeile == 1, "one lane beyond the four visible ones: clamped"
    assert r.leds(None)[81] != lp.LANE_FARBEN[0] and r.leds(None)[21] == lp.LANE_FARBEN[4]   # lane 5 now on the bottom pair
    r.oben("rechts")
    assert r.seite == 1 and r.leds(None)[21] == lp.skaliert(lp.LANE_FARBEN[4], lp.BEAT_DIMM)   # cell 17 is empty, a beat start
    assert r.zelle_unter(6, 0)[2] == 16, "the page shifts the cell numbers by 16"
    r.oben("rechts")
    assert r.seite == 1


def test_set_cell_trigger_lane():
    r = raster()
    ziel = r.zelle_unter(2, 0)                          # hat lane, cell 1, empty
    platz, text = r.umschalten(ziel[0], ziel[2])
    assert platz == 2
    assert "noten hat 42  1/16  x... x... .... x..." in text
    assert r.leds(None)[61] == lp.LANE_FARBEN[1], "optimistic: the local picture changes at once"


def test_remove_cell_and_second_press_builds_on_first():
    r = raster()
    k = r.zelle_unter(0, 0)
    _p, t1 = r.umschalten(k[0], k[2])
    assert "noten kick 36  1/16  .... o... x... ....   ; Kick" in t1
    h = r.zelle_unter(2, 0)
    _p, t2 = r.umschalten(h[0], h[2])
    assert ".... o..." in t2 and "x... x... .... x..." in t2


def test_pitched_lane_pitch_from_nearest_cell_before_or_c3():
    r = raster()
    z = r.zelle_unter(5, 0)                              # bass lane (rows 5,6), second row = cells 9..16, cell 9
    _p, t = r.umschalten(z[0], z[2])
    assert "noten bass  1/16  c2 ~ . . d#2 . . . d#2 . . . . . . ." in t
    r = raster()
    z = r.zelle_unter(6, 0)                              # lead lane, cell 1: nothing before it
    _p, t = r.umschalten(z[0], z[2])
    assert "noten lead  1/16  c3 . . . . . . . . . . . . . . ." in t


def test_remove_pitched_note_clears_its_ties():
    r = raster()
    z = r.zelle_unter(4, 0)                              # bass lane, cell 1 (set, tied to cell 2)
    _p, t = r.umschalten(z[0], z[2])
    assert "noten bass  1/16  . . . . d#2" in t


def test_text_edit_edge_cases():
    assert lp.zelle_text(TEXT, "nope", True, 0, True) is None
    assert lp.zelle_text(TEXT, "kick", True, 99, True) is None
    assert lp.zelle_text(TEXT, "kick", True, 15, True).count("x") == TEXT.count("x") + 1


class FakeGeraet:
    def __init__(self):
        self.gesendet, self.eingang, self.geschlossen, self.zustand = [], [], False, "new"

    def da(self):
        z, self.zustand = self.zustand, "kept"
        return z

    def senden(self, d):
        self.gesendet.append(d)

    def lesen(self):
        a, self.eingang = self.eingang, []
        return a

    def schliessen(self):
        self.geschlossen = True


class FakeTakt:
    def beat(self, bpm, jetzt):
        return None


def test_run_loop_programmer_mode_press_write_and_live_mode_at_end():
    g, geschrieben, stop = FakeGeraet(), [], threading.Event()
    s = stand()
    t = threading.Thread(target=lp.lauf, kwargs=dict(
        stop=stop, log=lambda *a: None, geraet=g, hole=lambda: copy.deepcopy(s),
        schreibe=lambda platz, text: geschrieben.append((platz, text)), takt=FakeTakt(), bpm=lambda: 120.0, tick=0.005))
    t.start()
    for _ in range(200):
        if len(g.gesendet) > 2:
            break
        time.sleep(0.01)
    g.eingang.append(pad(6, 1))                           # hat lane, cell 1
    for _ in range(300):
        if geschrieben:
            break
        time.sleep(0.01)
    stop.set()
    t.join(3)
    assert g.gesendet[0] == lp.programmer_modus(True)
    assert geschrieben and geschrieben[0][0] == 2 and "noten hat 42  1/16  x..." in geschrieben[0][1]
    assert g.gesendet[-1] == lp.programmer_modus(False) and g.geschlossen
    n_leds = [m for m in g.gesendet if m[6] == 0x03]
    assert n_leds and all(m[7] == 0x03 for m in n_leds)
