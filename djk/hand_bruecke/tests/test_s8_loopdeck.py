# Tests of s8_loopdeck (loops view model) and of its wiring in pult_bruecke.s8_tasten / s8_analog (fake reports, no device,
# no network: posts go into a list).
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import assignment as belegung  # noqa: E402
import s8_map as K  # noqa: E402
import s8_loopdeck as L  # noqa: E402


def zelle(farbe=3, nr=1):
    return {"id": f"z{nr}", "name": f"c{nr}", "farbe": farbe, "art": "loop", "sha256": "0" * 64, "gain_db": 0}


def lauf(z=None, verwaist=False, wartend=None):
    return {"zelle": z, "verwaist": verwaist, "ab_beat": 0, "versatz_beats": 0, "wartend": wartend, "zuletzt": z}


def stand_deck(zellen_je_spur=None, laeufe=None, raster="1"):
    """Deck with 4 tracks; zellen_je_spur: {spur: {zelle_nr: Zelle}}; laeufe: {spur: Lauf}."""
    spuren = []
    for s in range(1, 5):
        zs = [None] * 8
        for n, z in (zellen_je_spur or {}).get(s, {}).items():
            zs[n - 1] = z
        spuren.append({"spur_id": f"s{s}", "nr": s, "name": f"L1.{s}", "fader_db": 0, "mute": False, "filter": 0,
                       "zellen": zs, "lauf": (laeufe or {}).get(s) or lauf()})
    return {"gruppe_id": "g1", "platz": 1, "raster": raster, "spuren": spuren}


# -- model ------------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("paar,pad,erwartet", [
    (0, 1, (1, 1)), (0, 4, (4, 1)), (0, 5, (1, 2)), (0, 8, (4, 2)),
    (1, 1, (1, 3)), (1, 8, (4, 4)), (2, 6, (2, 6)), (3, 1, (1, 7)), (3, 8, (4, 8)),
])
def test_pad_ziel(paar, pad, erwartet):
    s = L.LoopSicht()
    s.paar = paar
    assert L.pad_ziel(s, pad) == erwartet


def test_pad_befehl_start_and_focus():
    s = L.LoopSicht()
    s.paar = 1
    d = stand_deck({3: {3: zelle()}})
    assert L.pad_befehl(s, 2, 3, False, d) == ("/loopdeck/start", {"deck": 2, "spur": 3, "zelle": 3})
    assert s.fokus == 3


def test_pad_befehl_shift_stops_the_track():
    s = L.LoopSicht()
    d = stand_deck({2: {1: zelle()}})
    assert L.pad_befehl(s, 1, 2, True, d) == ("/loopdeck/stopp", {"deck": 1, "spur": 2})
    assert s.fokus == 2
    # SHIFT + pad stops even when the cell under the pad is empty
    assert L.pad_befehl(s, 1, 4, True, d) == ("/loopdeck/stopp", {"deck": 1, "spur": 4})


def test_pad_befehl_empty_cell_or_no_deck_does_nothing():
    s = L.LoopSicht()
    assert L.pad_befehl(s, 1, 1, False, stand_deck()) is None
    assert L.pad_befehl(s, 1, 1, False, None) is None
    assert L.pad_befehl(s, 1, 1, True, None) is None


def dimm(i):
    return tuple(int(c * L.DIMM) for c in L.PALETTE[i])


def test_led_farben_off_dim_bright_blink():
    s = L.LoopSicht()
    d = stand_deck({1: {1: zelle(3), 2: zelle(3, 2)}, 2: {1: zelle(5)}, 3: {1: zelle(7), 2: zelle(7, 3)}},
                   {2: lauf(1), 3: lauf(None, wartend={"zelle": 1, "ab_beat": 4})})
    f0 = L.led_farben(s, d, 0.0)   # blink phase on
    f1 = L.led_farben(s, d, 0.25)  # blink phase off
    assert len(f0) == 8
    assert f0[0] == dimm(3)                       # pad 1 = track 1 cell 1: filled, idle -> dim
    assert f0[1] == L.PALETTE[5]                  # pad 2 = track 2 cell 1: playing -> bright
    assert f0[2] == L.PALETTE[7]                  # pad 3 = track 3 cell 1: pending -> blinks, on
    assert f1[2] == dimm(7)                       # ... and off (2 Hz: 0.25 s per phase)
    assert L.led_farben(s, d, 0.5)[2] == L.PALETTE[7]
    assert f0[3] == (0, 0, 0)                     # pad 4 = track 4 cell 1: empty -> off
    assert f0[4] == dimm(3)                       # pad 5 = track 1 cell 2 (lower row)
    assert f0[5] == (0, 0, 0)
    assert f0[6] == dimm(7)                       # pad 7 = track 3 cell 2


def test_led_farben_orphaned_track_lights_no_cell_and_no_deck_is_dark():
    s = L.LoopSicht()
    d = stand_deck({1: {1: zelle(3)}}, {1: lauf(1, verwaist=True)})
    assert L.led_farben(s, d, 0.0)[0] == dimm(3)
    assert L.led_farben(s, None, 0.0) == [(0, 0, 0)] * 8


def test_led_farben_follow_the_row_pair():
    s = L.LoopSicht()
    s.paar = 3  # rows 7 and 8
    d = stand_deck({1: {7: zelle(1)}, 4: {8: zelle(2)}}, {4: lauf(8)})
    f = L.led_farben(s, d, 0.0)
    assert f[0] == dimm(1)
    assert f[7] == L.PALETTE[2]
    assert f[1] == f[2] == f[3] == (0, 0, 0)


def test_palette_has_16_rgb_triples():
    assert len(L.PALETTE) == 16
    assert all(len(c) == 3 and all(0 <= v <= 255 for v in c) for c in L.PALETTE)


def test_farbe_out_of_range_is_clamped_into_the_palette():
    s = L.LoopSicht()
    d = stand_deck({1: {1: zelle(99)}})
    assert L.led_farben(s, d, 0.0)[0] != (0, 0, 0)


def test_paar_drehen_clamps():
    s = L.LoopSicht()
    L.paar_drehen(s, -3)
    assert s.paar == 0
    L.paar_drehen(s, 1)
    assert s.paar == 1
    L.paar_drehen(s, 9)
    assert s.paar == 3
    L.paar_drehen(s, -1)
    assert s.paar == 2


def test_raster_drehen_clamps():
    assert L.RASTER == ["1/4", "1/2", "1", "takt", "4takte"]
    assert L.raster_drehen("1", 1) == "takt"
    assert L.raster_drehen("1", -1) == "1/2"
    assert L.raster_drehen("1/4", -5) == "1/4"
    assert L.raster_drehen("4takte", 5) == "4takte"
    assert L.raster_drehen("1/4", 9) == "4takte"
    assert L.raster_drehen("???", 1) == "takt"  # unknown grid counts as "1"


def test_szene_befehl_upper_and_lower_row():
    s = L.LoopSicht()
    assert L.szene_befehl(s, 1, False) == ("/loopdeck/szene", {"deck": 1, "zeile": 1})
    assert L.szene_befehl(s, 1, True) == ("/loopdeck/szene", {"deck": 1, "zeile": 2})
    s.paar = 2
    assert L.szene_befehl(s, 2, False) == ("/loopdeck/szene", {"deck": 2, "zeile": 5})
    assert L.szene_befehl(s, 2, True) == ("/loopdeck/szene", {"deck": 2, "zeile": 6})


def test_capture_befehl():
    assert L.capture_befehl(2) == ("/loopdeck/laden", {"deck": 2, "quelle": {"von_deck": 2}})


# -- wiring in the bridge ---------------------------------------------------------------------------------------------

class FakeSeite:
    """Stands in for loopdeck_seite.LoopdeckSeite: collects posts, serves a fixed stand."""

    def __init__(self):
        self.posts = []
        self.decks = {1: None, 2: None}
        self.raster = {}

    def senden(self, pfad, body):
        self.posts.append((pfad, body))

    def deck(self, nr):
        return self.decks.get(nr)


class FakeDeck:
    def __init__(self):
        self.calls = []

    def hotcue(self, *a, **k):
        self.calls.append(("hotcue", a, k))

    def loop(self, *a, **k):
        self.calls.append(("loop", a, k))

    def loop_groesse(self, *a):
        self.calls.append(("loop_groesse", a))

    def spulen(self, *a):
        self.calls.append(("spulen", a))


@pytest.fixture
def bruecke():
    import pult_bridge as pult_bruecke
    b = pult_bruecke.Bruecke.__new__(pult_bruecke.Bruecke)
    b.monitor = False
    b.deck = FakeDeck()
    b.loopdeck = FakeSeite()
    b.loops = {1: L.LoopSicht(), 2: L.LoopSicht()}
    b.loop_groesse = {1: 4, 2: 4}
    b.stand = {"ansicht": {1: "deck", 2: "deck"}, "loop_groesse": b.loop_groesse}
    b.tasten = K.tasten()
    b.analog = K.analog()
    b.analog_loops = set()
    b.analog_v7 = {}
    b.midi = []
    b.senden = b.midi.append
    b.monitor = False
    return b


def bericht(*namen, nibble=None):
    """Report 0x01 (26 bytes) with the buttons `namen` (like "left_pad_1") held."""
    r = bytearray(26)
    r[0] = 0x01
    for name, b, m, _, _ in K.tasten():
        if name in namen:
            r[b] |= m
    for b, v in (nibble or {}).items():
        r[b] = v
    return bytes(r)


def druecke(b, *namen):
    """Press `namen` (down report), then release (empty report)."""
    leer = bericht()
    alt = b.s8_tasten(leer, None)
    alt = b.s8_tasten(bericht(*namen), alt)
    return b.s8_tasten(leer, alt)


def test_screen_button_1_cycles_four_views(bruecke):
    b = bruecke
    folge = []
    for _ in range(5):
        druecke(b, "left_screen_left_1")
        folge.append(b.stand["ansicht"][1])
    assert folge == ["studio", "seq", "loops", "deck", "studio"]
    assert b.stand["ansicht"][2] == "deck"
    assert b.midi == []


def test_deck_button_toggles_deck_and_loops_on_the_right_side(bruecke):
    b = bruecke
    druecke(b, "right_deck")
    assert b.stand["ansicht"] == {1: "deck", 2: "loops"}
    druecke(b, "right_deck")
    assert b.stand["ansicht"][2] == "deck"
    b.stand["ansicht"][1] = "seq"
    druecke(b, "left_deck")
    assert b.stand["ansicht"][1] == "loops"
    assert b.midi == []  # DECK is no longer forwarded as MIDI


def test_pads_start_cells_in_loops_view_and_hot_cues_elsewhere(bruecke):
    b = bruecke
    b.loopdeck.decks[1] = stand_deck({2: {1: zelle()}})
    druecke(b, "left_pad_1")
    assert b.deck.calls[0][0] == "hotcue" and b.loopdeck.posts == []
    b.deck.calls.clear()
    b.stand["ansicht"][1] = "loops"
    druecke(b, "left_pad_2")
    assert b.loopdeck.posts == [("/loopdeck/start", {"deck": 1, "spur": 2, "zelle": 1})]
    druecke(b, "left_pad_3")  # empty cell
    assert len(b.loopdeck.posts) == 1
    assert b.deck.calls == []


def test_shift_pad_stops_the_track(bruecke):
    b = bruecke
    b.stand["ansicht"][2] = "loops"
    b.loopdeck.decks[2] = stand_deck({1: {1: zelle()}})
    druecke(b, "right_shift", "right_pad_1")
    assert b.loopdeck.posts == [("/loopdeck/stopp", {"deck": 2, "spur": 1})]


def test_scene_and_capture_buttons(bruecke):
    b = bruecke
    b.stand["ansicht"][1] = "loops"
    b.loops[1].paar = 1
    druecke(b, "left_screen_right_1")
    druecke(b, "left_screen_right_2")
    druecke(b, "left_capture")
    assert b.loopdeck.posts == [("/loopdeck/szene", {"deck": 1, "zeile": 3}), ("/loopdeck/szene", {"deck": 1, "zeile": 4}),
                                ("/loopdeck/laden", {"deck": 1, "quelle": {"von_deck": 1}})]
    assert b.midi == []


def test_buttons_are_forwarded_in_deck_view(bruecke):
    b = bruecke
    druecke(b, "left_capture")
    druecke(b, "left_screen_right_1")
    druecke(b, "left_on_1")
    assert b.loopdeck.posts == []
    assert len(b.midi) == 6  # three presses and three releases reach the kern


def test_browse_encoder_moves_the_row_pair_in_loops_view(bruecke):
    b = bruecke
    b.stand["ansicht"][1] = "loops"
    alt = b.s8_tasten(bericht(nibble={1: 0x00}), None)
    b.s8_tasten(bericht(nibble={1: 0x20}), alt)  # browse: high nibble 0 -> 2 = +2 detents
    assert b.loops[1].paar == 2
    assert not [c for c in b.deck.calls if c[0] == "spulen"]
    # deck view still moves the track
    b.stand["ansicht"][1] = "deck"
    alt = b.s8_tasten(bericht(nibble={1: 0x00}), None)
    b.s8_tasten(bericht(nibble={1: 0x10}), alt)
    assert [c for c in b.deck.calls if c[0] == "spulen"] == [("spulen", (1, 1))]


def test_loop_encoder_steps_the_grid_in_loops_view(bruecke):
    b = bruecke
    b.stand["ansicht"][2] = "loops"
    b.loopdeck.decks[2] = stand_deck(raster="1")
    alt = b.s8_tasten(bericht(nibble={2: 0x00}), None)
    alt = b.s8_tasten(bericht(nibble={2: 0x01}), alt)
    assert b.loopdeck.posts == [("/loopdeck/raster", {"deck": 2, "raster": "takt"})]
    # a second turn before the next poll builds on the last request
    b.s8_tasten(bericht(nibble={2: 0x02}), alt)
    assert b.loopdeck.posts[-1] == ("/loopdeck/raster", {"deck": 2, "raster": "4takte"})
    assert b.deck.calls == []


def test_loop_encoder_without_a_loop_deck_is_silent(bruecke):
    b = bruecke
    b.stand["ansicht"][1] = "loops"
    alt = b.s8_tasten(bericht(nibble={1: 0x00}), None)
    b.s8_tasten(bericht(nibble={1: 0x01}), alt)
    assert b.loopdeck.posts == []


def test_loop_encoder_keeps_its_deck_meaning_elsewhere(bruecke):
    b = bruecke
    alt = b.s8_tasten(bericht(nibble={1: 0x00}), None)
    b.s8_tasten(bericht(nibble={1: 0x01}), alt)
    assert b.loop_groesse[1] == 8
    assert b.loopdeck.posts == []


# -- belegung ---------------------------------------------------------------------------------------------------------

def test_faengt_ab_loops_view_adds_buttons():
    for kanal in (13, 14):
        for note in (16, 35, 36, 37, 38, 44, 45, 49):
            assert belegung.faengt_ab(kanal, note, "loops") is True
            for ansicht in (None, "deck", "studio", "seq"):
                assert belegung.faengt_ab(kanal, note, ansicht) is False, (kanal, note, ansicht)
        assert belegung.faengt_ab(kanal, 19) is True
        assert belegung.faengt_ab(kanal, 19, "loops") is True
    assert belegung.faengt_ab(15, 49, "loops") is False
    assert belegung.faengt_ab(15, 19) is False


# -- loopdeck_seite (fake HTTP, no thread) -----------------------------------------------------------------------------

def test_seite_holen_reads_decks_and_clears_the_grid_request():
    import loopdeck_page as loopdeck_seite
    d1 = stand_deck()
    ruf = []

    def anfrage(pfad, body=None):
        ruf.append(pfad)
        return {"decks": {"1": d1, "2": None}, "beat": 0, "bpm": 120}

    sp = loopdeck_seite.LoopdeckSeite(lambda *a: None, {1: "loops", 2: "deck"}, anfrage=anfrage, starte=False)
    sp.raster[1] = "takt"
    assert sp.holen() is True
    assert ruf == ["/loopdeck/stand"]
    assert sp.deck(1) is d1 and sp.deck(2) is None and sp.raster == {}


def test_seite_holen_keeps_the_last_state_when_the_request_fails():
    import loopdeck_page as loopdeck_seite
    logs = []

    def anfrage(pfad, body=None):
        raise OSError("down")

    sp = loopdeck_seite.LoopdeckSeite(lambda *a: logs.append(a), {1: "loops", 2: "deck"}, anfrage=anfrage, starte=False)
    sp.decks[1] = stand_deck()
    assert sp.holen() is False
    assert sp.deck(1) is not None and len(logs) == 1


# -- FREEZE slice mode ------------------------------------------------------------------------------------------------

def spielend(farbe=5, beats=4, ab=8.0, versatz=0.0, spur=2):
    z = dict(zelle(farbe=farbe, nr=1), beats=beats)
    l = lauf(z=1)
    l.update(ab_beat=ab, versatz_beats=versatz)
    return stand_deck({spur: {1: z}}, {spur: l})


def test_freeze_umschalten_toggles():
    s = L.LoopSicht()
    assert s.slice is False
    assert L.freeze_umschalten(s) is True and s.slice is True
    assert L.freeze_umschalten(s) is False


def test_slice_befehl_uses_the_focus_track():
    s = L.LoopSicht()
    s.fokus = 3
    assert L.slice_befehl(s, 2, 6, spielend()) == ("/loopdeck/sprung", {"deck": 2, "spur": 3, "slice": 6})
    assert L.slice_befehl(s, 2, 6, None) is None


def test_slice_nr_from_position():
    d = spielend()
    z, l = d["spuren"][1]["zellen"][0], d["spuren"][1]["lauf"]
    assert L.slice_nr(z, l, 9.6) == 4          # 1.6 of 4 beats = 0.4 -> slice 4
    assert L.slice_nr(z, l, 8.0) == 1
    assert L.slice_nr(z, l, 11.99) == 8
    assert L.slice_nr(z, l, 12.0) == 1         # wraps
    assert L.slice_nr(z, l, None) is None
    assert L.slice_nr(None, l, 9.0) is None


def test_slice_led_farben_playing_loop_at_position_0_4():
    s = L.LoopSicht()
    s.fokus = 2
    f = L.slice_led_farben(s, spielend(farbe=5), 9.6)
    farbe = L.PALETTE[5]
    assert f[3] == farbe
    assert all(f[i] == tuple(int(c * L.DIMM) for c in farbe) for i in range(8) if i != 3)


def test_slice_led_farben_dark_when_the_focus_track_plays_nothing():
    s = L.LoopSicht()
    s.fokus = 1                                 # the loop plays on track 2
    assert L.slice_led_farben(s, spielend(), 9.6) == [L.AUS] * 8
    assert L.slice_led_farben(s, None, 9.6) == [L.AUS] * 8
    s.fokus = 2
    d = spielend()
    d["spuren"][1]["lauf"]["verwaist"] = True
    assert L.slice_led_farben(s, d, 9.6) == [L.AUS] * 8


def test_freeze_button_toggles_slice_mode_in_loops_view_only(bruecke):
    bruecke.stand["ansicht"][1] = "loops"
    druecke(bruecke, "left_freeze")
    assert bruecke.loops[1].slice is True and bruecke.loops[2].slice is False
    assert bruecke.midi == []
    druecke(bruecke, "left_freeze")
    assert bruecke.loops[1].slice is False
    bruecke.stand["ansicht"][1] = "deck"
    druecke(bruecke, "left_freeze")             # deck view: forwarded as MIDI, no mode
    assert bruecke.loops[1].slice is False and bruecke.midi


def test_pad_in_slice_mode_posts_sprung_with_the_focus(bruecke):
    bruecke.stand["ansicht"][2] = "loops"
    bruecke.loopdeck.decks[2] = spielend()
    druecke(bruecke, "right_freeze")
    druecke(bruecke, "right_on_2")
    assert bruecke.loops[2].fokus == 2
    druecke(bruecke, "right_pad_7")
    assert bruecke.loopdeck.posts == [("/loopdeck/sprung", {"deck": 2, "spur": 2, "slice": 7})]


def test_on_buttons_pick_the_focus_and_do_not_mute_in_slice_mode(bruecke):
    bruecke.stand["ansicht"][1] = "loops"
    bruecke.loopdeck.decks[1] = spielend()
    bruecke.loopdeck.mute = {}
    druecke(bruecke, "left_freeze")
    druecke(bruecke, "left_on_2")
    assert bruecke.loops[1].fokus == 2 and bruecke.loopdeck.posts == []
    druecke(bruecke, "left_freeze")             # mode off: on_3 mutes again
    druecke(bruecke, "left_on_3")
    assert [p[0] for p in bruecke.loopdeck.posts] == ["/loopdeck/spur"]
    assert bruecke.loops[1].fokus == 2


def test_leaving_the_loops_view_clears_the_slice_mode(bruecke):
    bruecke.stand["ansicht"][1] = "loops"
    druecke(bruecke, "left_freeze")
    assert bruecke.loops[1].slice is True
    druecke(bruecke, "left_deck")
    assert bruecke.stand["ansicht"][1] == "deck" and bruecke.loops[1].slice is False
    druecke(bruecke, "left_deck")               # back in loops: mode stays off
    assert bruecke.stand["ansicht"][1] == "loops" and bruecke.loops[1].slice is False


def test_slice_mode_is_per_side(bruecke):
    bruecke.stand["ansicht"].update({1: "loops", 2: "loops"})
    druecke(bruecke, "left_freeze")
    druecke(bruecke, "left_deck")               # left leaves: only left clears
    druecke(bruecke, "right_freeze")
    assert bruecke.loops[1].slice is False and bruecke.loops[2].slice is True


# -- knob layers of the channel strip (CZ1) ---------------------------------------------------------------------------

def test_layers_and_texts():
    assert L.SCHICHTEN == ("filter", "tief", "mitte", "hoch", "hall", "delay")
    assert [L.SCHICHT_TEXT[s] for s in L.SCHICHTEN] == ["FLT", "LO", "MID", "HI", "HALL", "DLY"]
    assert L.LoopSicht().schicht == "filter"


@pytest.mark.parametrize("note,shift,erwartet", [
    (31, False, "filter"), (32, False, "tief"), (33, False, "mitte"), (34, False, "hoch"),
    (31, True, "hall"), (32, True, "delay"), (33, True, "tief"), (34, True, "tief"),  # SHIFT + 33/34: no change
])
def test_schicht_waehlen_table(note, shift, erwartet):
    s = L.LoopSicht()
    s.schicht = "tief"
    aenderung = L.schicht_waehlen(s, note, shift)
    assert s.schicht == erwartet
    assert aenderung is (erwartet != "tief")


def test_schicht_waehlen_ignores_other_notes_and_reports_no_change_for_the_same_layer():
    s = L.LoopSicht()
    s.schicht = "hoch"
    for note in (30, 35, 16):
        assert L.schicht_waehlen(s, note, False) is False
        assert L.schicht_waehlen(s, note, True) is False
    assert s.schicht == "hoch"
    assert L.schicht_waehlen(s, 34, False) is False


def test_eq_law():
    assert L.eq_db(64) == 0 and L.eq_db(62) == 0 and L.eq_db(66) == 0   # centre detent
    assert L.eq_db(0) == -26 and L.eq_db(127) == 6
    assert -26 < L.eq_db(30) < 0 < L.eq_db(100) < 6
    assert [L.eq_db(v) for v in range(127)] == sorted(L.eq_db(v) for v in range(127))


def test_eq_v7_is_the_inverse_within_one_step():
    for v in list(range(0, 62)) + list(range(67, 128)):
        assert abs(L.eq_v7(L.eq_db(v)) - v) <= 1, v
    assert L.eq_v7(0.0) == 64
    assert L.eq_v7(-26) == 0 and L.eq_v7(-200) == 0 and L.eq_v7(6) == 127 and L.eq_v7(20) == 127


def test_send_law():
    assert L.send_db(0) == -200 and L.send_db(127) == 0
    assert L.send_db(60) == L.fader_db(60) and L.send_db(200) == 0


def test_schicht_feld():
    assert L.schicht_feld("filter") == ("filter", None)
    assert [L.schicht_feld(s) for s in ("tief", "mitte", "hoch")] == [("eq", "tief"), ("eq", "mitte"), ("eq", "hoch")]
    assert L.schicht_feld("hall") == ("send", "hall") and L.schicht_feld("delay") == ("send", "delay")


def streifen(**k):
    sp = {"filter": 0.25, "eq": {"tief": -3.0, "mitte": 0.0, "hoch": 4.0}, "kill": {"tief": False, "mitte": True, "hoch": False},
          "send": {"hall": -12.0, "delay": -200.0}}
    sp.update(k)
    return sp


def test_modell_wert():
    sp = streifen()
    assert [L.modell_wert(sp, s) for s in L.SCHICHTEN] == [0.25, -3.0, 0.0, 4.0, -12.0, -200.0]
    assert L.modell_wert({"filter": 0}, "filter") == 0.0
    assert L.modell_wert({"filter": 0}, "tief") is None and L.modell_wert({"eq": {}}, "tief") is None
    assert L.modell_wert({}, "hall") is None and L.modell_wert(None, "filter") is None


def test_schicht_druck_per_layer():
    sp = streifen()
    assert L.schicht_druck(1, 2, "tief", sp) == ("/loopdeck/spur", {"deck": 1, "spur": 2, "kill": {"tief": True}})
    assert L.schicht_druck(1, 2, "mitte", sp) == ("/loopdeck/spur", {"deck": 1, "spur": 2, "kill": {"mitte": False}})
    assert L.schicht_druck(2, 3, "hoch", sp) == ("/loopdeck/spur", {"deck": 2, "spur": 3, "kill": {"hoch": True}})
    assert L.schicht_druck(1, 1, "filter", sp) == ("/loopdeck/spur", {"deck": 1, "spur": 1, "filter": 0})
    assert L.schicht_druck(1, 1, "hall", sp) == ("/loopdeck/spur", {"deck": 1, "spur": 1, "send": {"hall": -200}})
    assert L.schicht_druck(1, 4, "delay", sp) == ("/loopdeck/spur", {"deck": 1, "spur": 4, "send": {"delay": -200}})


def test_schicht_druck_without_a_track_does_nothing():
    assert L.schicht_druck(1, 1, "tief", None) is None
    assert L.schicht_druck(1, 1, "filter", None) is None
    assert L.schicht_druck(1, 1, "hoch", {"filter": 0}) == ("/loopdeck/spur", {"deck": 1, "spur": 1, "kill": {"hoch": True}})


# -- pending memory of the kill and send presses (CZ2 fix) ------------------------------------------------------------

def test_schicht_druck_kill_toggles_from_the_pending_value():
    sp, anst = streifen(), {}
    assert L.schicht_druck(1, 2, "tief", sp, anst)[1]["kill"] == {"tief": True}
    assert L.schicht_druck(1, 2, "tief", sp, anst)[1]["kill"] == {"tief": False}     # second press before the poll: back off
    assert L.schicht_druck(1, 2, "tief", sp, anst)[1]["kill"] == {"tief": True}
    assert L.schicht_druck(1, 2, "mitte", sp, anst)[1]["kill"] == {"mitte": False}   # other bands and tracks are independent
    assert L.schicht_druck(1, 3, "tief", sp, anst)[1]["kill"] == {"tief": True}


def test_schicht_druck_send_close_is_restored_by_a_second_press():
    sp, anst = streifen(), {}
    assert L.schicht_druck(1, 2, "hall", sp, anst)[1]["send"] == {"hall": -200}
    assert L.schicht_druck(1, 2, "hall", sp, anst)[1]["send"] == {"hall": -12.0}     # the stand's value before the close
    assert L.schicht_druck(1, 2, "hall", sp, anst)[1]["send"] == {"hall": -200}      # and closed again


def test_schicht_druck_send_already_closed_in_the_stand_stays_closed():
    sp, anst = streifen(), {}                                                         # delay is -200 in the stand
    for _ in range(3):
        assert L.schicht_druck(1, 2, "delay", sp, anst)[1]["send"] == {"delay": -200}


def _deck(nr, ausgang_platz):
    d = stand_deck()
    return {**d, "platz": nr, "ausgang_platz": ausgang_platz}


@pytest.mark.parametrize("a1,a2,seite1,seite2", [
    (3, 4, 1, 2),   # LOOP 1 left (place 3), LOOP 2 right (place 4)
    (4, 3, 2, 1),   # swapped: LOOP 1 in place 4 sounds on the right side
    (1, 2, 1, 2),   # top row: deck/1 left, deck/2 right
    (2, 1, 2, 1),
    (1, 3, 1, 1),   # both left: the sides keep their own deck numbers
])
def test_seiten_decks_follows_the_channel_side(a1, a2, seite1, seite2):
    import loopdeck_page as loopdeck_seite
    d1, d2 = _deck(1, a1), _deck(2, a2)
    decks, nr = loopdeck_seite.seiten_decks({"1": d1, "2": d2})
    if seite1 == seite2:
        assert nr == {1: 1, 2: 2} and decks == {1: d1, 2: d2}
    else:
        assert decks[seite1] is d1 and decks[seite2] is d2
        assert nr[seite1] == 1 and nr[seite2] == 2


def test_seiten_decks_one_deck_sits_on_its_side_and_old_stand_keeps_the_numbers():
    import loopdeck_page as loopdeck_seite
    d1 = _deck(1, 4)
    decks, nr = loopdeck_seite.seiten_decks({"1": d1, "2": None})
    assert decks == {1: None, 2: d1} and nr == {2: 1, 1: 2}
    alt = stand_deck()   # a stand without ausgang_platz
    decks, nr = loopdeck_seite.seiten_decks({"1": alt, "2": None})
    assert decks == {1: alt, 2: None} and nr == {1: 1, 2: 2}


def test_requests_of_a_side_carry_the_deck_number_that_sounds_there():
    import loopdeck_page as loopdeck_seite
    posts = []

    def anfrage(pfad, body=None, **k):
        if pfad == "/loopdeck/stand":
            return {"decks": {"1": _deck(1, 4), "2": _deck(2, 3)}, "beat": 0, "bpm": 120}
        posts.append((pfad, body))
        return {"ok": True}

    sp = loopdeck_seite.LoopdeckSeite(lambda *a: None, {1: "loops", 2: "loops"}, anfrage=anfrage, starte=False)
    assert sp.holen() is True
    sp._melde("/loopdeck/start", {"deck": 1, "spur": 2, "zelle": 3})   # left side: the deck in place 3 is LOOP 2
    sp._melde("/loopdeck/laden", {"deck": 2, "quelle": {"von_deck": 2}})
    assert posts == [("/loopdeck/start", {"deck": 2, "spur": 2, "zelle": 3}),
                     ("/loopdeck/laden", {"deck": 1, "quelle": {"von_deck": 2}})]
