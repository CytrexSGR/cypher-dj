# Tests of the loops view controls that are not pads: value laws of faders and knobs, the post throttle, the routing of the
# analog rows in pult_bruecke.s8_analog (fake reports, no device, no network) and the mute buttons.
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import loopdeck_page as loopdeck_seite  # noqa: E402
import s8_map as K  # noqa: E402
import s8_loopdeck as L  # noqa: E402
from test_s8_loopdeck import FakeDeck, bericht, druecke, stand_deck  # noqa: E402


# -- value laws -------------------------------------------------------------------------------------------------------

def test_fader_db_law():
    assert L.fader_db(0) == -200.0            # the model's fader floor (FADER_MIN in djk/ui/project/model.ts)
    assert L.fader_db(127) == pytest.approx(0.0)
    assert L.fader_db(64) == pytest.approx(40 * __import__("math").log10(64 / 127))
    assert L.fader_db(200) == pytest.approx(0.0)  # clamped at the top
    assert L.fader_db(1) < L.fader_db(2) < L.fader_db(127)


def test_filter_wert_law_and_detent():
    assert L.filter_wert(64) == 0.0
    for v in (62, 63, 65, 66):
        assert L.filter_wert(v) == 0.0, v
    assert L.filter_wert(67) == pytest.approx(3 / 63)
    assert L.filter_wert(61) == pytest.approx(-3 / 63)
    assert L.filter_wert(127) == pytest.approx(1.0)
    assert L.filter_wert(0) == -1.0
    assert L.filter_wert(300) == 1.0


# -- throttle ---------------------------------------------------------------------------------------------------------

def test_drossel_keeps_the_last_value_and_sends_on_the_next_tick():
    d = L.Drossel(abstand=1 / 30)
    d.setze("k", 1, 0.0)
    assert d.faellig(0.0) == [("k", 1)]
    d.setze("k", 2, 0.01)
    d.setze("k", 3, 0.02)
    assert d.faellig(0.02) == []                      # too early
    assert d.faellig(0.04) == [("k", 3)]              # the latest value only
    assert d.faellig(0.5) == []                       # nothing pending


def test_drossel_skips_a_value_equal_to_the_last_sent_one():
    d = L.Drossel(abstand=1 / 30)
    d.setze("k", 5, 0.0)
    assert d.faellig(0.0) == [("k", 5)]
    d.setze("k", 5, 1.0)
    assert d.faellig(1.0) == []


def test_drossel_grundwert_is_the_starting_point_without_a_post():
    d = L.Drossel(abstand=1 / 30)
    d.grundwert("k", 7)
    d.setze("k", 7, 0.0)
    assert d.faellig(0.0) == []
    d.setze("k", 8, 0.0)
    assert d.faellig(0.0) == [("k", 8)]


def test_drossel_controls_are_independent():
    d = L.Drossel(abstand=1 / 30)
    d.setze("a", 1, 0.0)
    d.setze("b", 2, 0.0)
    assert sorted(d.faellig(0.0)) == [("a", 1), ("b", 2)]


# -- mutes ------------------------------------------------------------------------------------------------------------

def test_mute_befehl_toggles_from_the_stand_and_remembers_the_request():
    deck = stand_deck()
    deck["spuren"][1]["mute"] = True
    anst = {}
    assert L.mute_befehl(1, 1, deck, anst) == ("/loopdeck/spur", {"deck": 1, "spur": 1, "mute": True})
    assert L.mute_befehl(1, 1, deck, anst) == ("/loopdeck/spur", {"deck": 1, "spur": 1, "mute": False})  # twice before a poll
    assert L.mute_befehl(1, 2, deck, anst) == ("/loopdeck/spur", {"deck": 1, "spur": 2, "mute": False})  # stand says muted
    assert L.mute_befehl(1, 3, None, anst) is None


# -- wiring in the bridge ---------------------------------------------------------------------------------------------

def analog_bericht(**roh):
    """Report 0x02 (109 bytes) with raw values {analog name: 0..4095}."""
    r = bytearray(109)
    r[0] = 0x02
    for name, b, _, _, _ in K.analog():
        if name in roh:
            r[b], r[b + 1] = roh[name] & 0xFF, roh[name] >> 8
    return bytes(r)


def roh(v7):
    """Raw 12-bit value that reads as `v7` through K.zu_7bit."""
    return int(round(v7 / 127 * K.ANALOG_MAX))


class Pult:
    """The bridge with fake reports: `.melde(**v7)` feeds one analog report, `.t` is the clock."""

    def __init__(self):
        import pult_bridge as pult_bruecke
        b = self.b = pult_bruecke.Bruecke.__new__(pult_bruecke.Bruecke)
        self.t = 0.0
        self.gesendet, self.alt, self.enc_alt, self.enc_rest = {}, None, {}, {}
        self.posts = []
        b.monitor = False
        b.deck = FakeDeck()
        b.loopdeck = loopdeck_seite.LoopdeckSeite(lambda *a: None, {}, anfrage=lambda p, body=None, **k: self.posts.append((p, body)),
                                                  starte=False)
        b.loops = {1: L.LoopSicht(), 2: L.LoopSicht()}
        b.loop_groesse = {1: 4, 2: 4}
        b.stand = {"ansicht": {1: "deck", 2: "deck"}, "loop_groesse": b.loop_groesse}
        b.tasten = K.tasten()
        b.analog = K.analog()
        b.encoder = K.encoder()
        b.analog_loops, b.analog_v7, b.abholung, b.midi_zuletzt, b.rueck = set(), {}, {}, {}, {}
        b.jetzt = lambda: self.t
        b.midi = []
        b.senden = b.midi.append

    def deck(self, seite=1, **spur):
        """A loop deck for side `seite`; `spur` = {nr: {field: value}} model values of the tracks."""
        d = stand_deck()
        for nr, felder in spur.items():
            d["spuren"][nr - 1].update(felder)
        self.b.loopdeck.decks[seite] = d
        return d

    def melde(self, dt=0.01, **v7):
        self.t += dt
        self.alt = self.b.s8_analog(analog_bericht(**{k: roh(v) for k, v in v7.items()}), self.alt, self.gesendet, self.enc_alt,
                                    self.enc_rest)

    def tick(self):
        self.t += 0.05
        self.b.loopdeck.tick(self.t)
        self.posts.clear()
        self.b.loopdeck.leeren()
        return list(self.posts)

    def midi_reihen(self, kanal):
        return [m for m in self.b.midi if m[0] == 0xB0 | (kanal - 1) and 20 <= m[1] <= 27]


@pytest.fixture
def pult():
    return Pult()


def test_fader_does_not_jump_to_the_physical_position(pult):
    """Measured: model 0 dB, fader 20 -> 21 posted -31.3 dB. Now nothing goes out until the fader reaches the model value."""
    pult.b.stand["ansicht"][1] = "loops"
    pult.deck()
    for v in (20, 21, 60, 126):
        pult.melde(left_fader_1=v)
        assert pult.tick() == []
    pult.melde(left_fader_1=127)                       # reached 0 dB: picked up
    assert pult.tick() == [("/loopdeck/spur", {"deck": 1, "spur": 1, "fader_db": pytest.approx(0.0)})]
    assert pult.midi_reihen(13) == []


def test_fader_crossing_the_model_value_picks_up_and_then_follows(pult):
    pult.b.stand["ansicht"][1] = "loops"
    pult.deck()["spuren"][1]["fader_db"] = -20.0       # v7 40
    pult.melde(left_fader_2=100)
    pult.melde(left_fader_2=50)
    assert pult.tick() == []
    pult.melde(left_fader_2=30)                        # crossed 40 downwards
    assert pult.tick() == [("/loopdeck/spur", {"deck": 1, "spur": 2, "fader_db": pytest.approx(L.fader_db(30))})]
    pult.melde(left_fader_2=90)                        # after the pickup it follows, up as well
    assert pult.tick() == [("/loopdeck/spur", {"deck": 1, "spur": 2, "fader_db": pytest.approx(L.fader_db(90))})]


def test_knob_soft_takeover_on_the_filter(pult):
    pult.b.stand["ansicht"][2] = "loops"
    d = pult.deck(2)
    d["spuren"][2]["filter"] = 0.5                     # v7 ~ 95.5
    pult.melde(right_fx_dial_3=64)
    pult.melde(right_fx_dial_3=90)
    assert pult.tick() == []
    pult.melde(right_fx_dial_3=100)
    assert pult.tick() == [("/loopdeck/spur", {"deck": 2, "spur": 3, "filter": pytest.approx(L.filter_wert(100))})]
    assert pult.midi_reihen(14) == []


def test_control_at_the_model_value_posts_at_once(pult):
    pult.b.stand["ansicht"][1] = "loops"
    pult.deck()                                        # filter 0: the knob sits in its detent
    pult.melde(left_fx_dial_1=64)
    pult.melde(left_fx_dial_1=66)
    assert pult.tick() == [("/loopdeck/spur", {"deck": 1, "spur": 1, "filter": 0.0})]


def test_nothing_is_posted_without_a_loop_deck(pult):
    pult.b.stand["ansicht"][1] = "loops"
    for v in (10, 60, 127, 0):
        pult.melde(left_fader_1=v)
    assert pult.tick() == [] and pult.b.abholung == {}


def test_pickup_is_lost_when_the_view_is_left(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(left_fader_1=127)
    assert pult.tick()
    b.ansicht_setzen(1, "deck")
    b.ansicht_setzen(1, "loops")
    pult.melde(left_fader_1=100)
    assert pult.tick() == []                           # entering again: not picked up
    pult.melde(left_fader_1=127)
    assert pult.tick()


def test_pickup_is_lost_when_the_track_behind_the_control_changes(pult):
    pult.b.stand["ansicht"][1] = "loops"
    d = pult.deck()
    pult.melde(left_fader_1=127)
    assert pult.tick()
    d["spuren"][0]["spur_id"] = "other"                # another deck / track now sits behind the fader
    pult.melde(left_fader_1=100)
    assert pult.tick() == []
    pult.melde(left_fader_1=127)                       # reaches the model value again: picked up again
    assert pult.tick() == [("/loopdeck/spur", {"deck": 1, "spur": 1, "fader_db": pytest.approx(0.0)})]


def test_pickup_is_lost_when_the_model_changes_elsewhere_while_the_control_rests(pult):
    pult.b.stand["ansicht"][1] = "loops"
    d = pult.deck()
    pult.melde(left_fader_1=127)
    assert pult.tick()
    d["spuren"][0]["fader_db"] = -30.0                 # changed on the page
    pult.melde(dt=0.2, left_fader_1=127)               # not at rest long enough
    assert pult.b.abholung["left_fader_1"].abgeholt
    pult.melde(dt=0.6, left_fader_1=127)               # at rest, model far away: lost
    assert pult.tick() == []
    assert "fader_db" in L.nicht_abgeholt(pult.b.abholung, 1)[1]
    pult.melde(left_fader_1=100)
    assert pult.tick() == []
    pult.melde(left_fader_1=5)                         # crosses the new model value (v7 ~ 22)
    assert pult.tick()


def test_a_change_of_one_step_while_resting_keeps_the_pickup(pult):
    pult.b.stand["ansicht"][1] = "loops"
    d = pult.deck()
    pult.melde(left_fader_1=127)
    assert pult.tick()
    d["spuren"][0]["fader_db"] = L.fader_db(126)       # one step off
    pult.melde(dt=1.0, left_fader_1=127)
    assert pult.b.abholung["left_fader_1"].abgeholt


def test_marker_for_controls_that_are_not_picked_up(pult):
    pult.b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(left_fader_3=10, left_fx_dial_3=10, left_fader_1=127)
    offen = {k: sorted(v) for k, v in L.nicht_abgeholt(pult.b.abholung, 1).items()}
    assert offen[3] == ["fader_db", "filter"] and "fader_db" not in offen[1]
    assert L.nicht_abgeholt(pult.b.abholung, 2) == {}


def test_same_move_in_deck_view_sends_midi_and_no_post(pult):
    pult.melde(left_fader_2=127)
    assert bytes([0xB0 | 12, 25, 127]) in pult.b.midi
    assert pult.tick() == []


def test_other_side_and_other_rows_stay_midi_while_one_side_shows_loops(pult):
    pult.b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(right_fader_1=127, mixer_fader_a=127)
    assert bytes([0xB0 | 13, 24, 127]) in pult.b.midi
    assert bytes([0xB0 | 8, 7, 127]) in pult.b.midi
    assert pult.tick() == []


def test_throttle_keeps_the_last_value_between_ticks(pult):
    pult.b.stand["ansicht"][1] = "loops"
    pult.deck()
    for v in (10, 127, 100, 90, 80):
        pult.melde(dt=0.0001, left_fader_1=v)
    seite = pult.b.loopdeck
    seite.tick(10.0)
    seite.tick(10.001)
    pult.posts.clear()
    seite.leeren()
    assert pult.posts == [("/loopdeck/spur", {"deck": 1, "spur": 1, "fader_db": pytest.approx(L.fader_db(80))})]


def test_leaving_sends_no_midi_and_holds_the_moved_controls_back(pult):
    b = pult.b
    pult.melde(left_fader_1=50, left_fader_2=70)       # deck view: forwarded, the deck has 50 and 70
    assert bytes([0xB0 | 12, 24, 50]) in b.midi
    b.midi.clear()
    b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(left_fader_1=100, left_fader_2=70)      # fader 1 moved, fader 2 not
    assert pult.midi_reihen(13) == []
    b.ansicht_setzen(1, "deck")
    assert pult.midi_reihen(13) == []                  # nothing on leaving
    pult.melde(left_fader_1=90, left_fader_2=70)
    assert pult.midi_reihen(13) == []                  # fader 1 still above the remembered 50: held back
    assert pult.gesendet["left_fader_1"] == 50         # gesendet still says what the deck really has
    pult.melde(left_fader_1=40, left_fader_2=70)       # crossed 50
    assert pult.midi_reihen(13) == [bytes([0xB0 | 12, 24, 40])]
    assert pult.gesendet["left_fader_1"] == 40
    pult.melde(left_fader_1=45, left_fader_2=71)       # follows; fader 2 (never moved in the loops view) forwards at once
    assert bytes([0xB0 | 12, 24, 45]) in b.midi and bytes([0xB0 | 12, 25, 71]) in b.midi


def test_leaving_and_returning_to_the_remembered_value_is_not_swallowed(pult):
    b = pult.b
    pult.melde(left_fader_1=50)
    b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(left_fader_1=100)
    b.ansicht_setzen(1, "deck")
    b.midi.clear()
    pult.melde(left_fader_1=50)                        # exactly the remembered value: reached, equals gesendet: nothing to say
    assert pult.midi_reihen(13) == [] and "left_fader_1" not in b.rueck
    pult.melde(left_fader_1=55)
    assert pult.midi_reihen(13) == [bytes([0xB0 | 12, 24, 55])]


def test_a_control_forwards_at_once_when_nothing_was_forwarded_before(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(left_fader_4=80)
    b.ansicht_setzen(1, "deck")
    pult.melde(left_fader_4=81)
    assert bytes([0xB0 | 12, 27, 81]) in pult.midi_reihen(13)


def test_entering_the_loops_view_again_drops_the_hold(pult):
    b = pult.b
    pult.melde(left_fader_1=50)
    b.stand["ansicht"][1] = "loops"
    pult.deck()
    pult.melde(left_fader_1=100)
    b.ansicht_setzen(1, "deck")
    assert "left_fader_1" in b.rueck
    b.ansicht_setzen(1, "loops")
    pult.melde(left_fader_1=100)
    assert "left_fader_1" not in b.rueck and b.midi_zuletzt["left_fader_1"] == 50


def test_leaving_one_side_keeps_the_marks_of_the_other(pult):
    b = pult.b
    b.stand["ansicht"] = {1: "loops", 2: "loops"}
    pult.deck(1)
    pult.deck(2)
    pult.melde(left_fader_1=10, right_fader_1=10)
    assert {"left_fader_1", "right_fader_1"} <= b.analog_loops
    b.ansicht_setzen(1, "deck")
    assert "left_fader_1" not in b.analog_loops and "left_fader_1" not in b.abholung
    assert "right_fader_1" in b.analog_loops and "right_fader_1" in b.abholung
    pult.melde(left_fader_1=10, right_fader_1=127)
    assert pult.tick() == [("/loopdeck/spur", {"deck": 2, "spur": 1, "fader_db": pytest.approx(0.0)})]


def test_changing_between_other_views_sends_nothing(pult):
    pult.b.ansicht_setzen(1, "studio")
    assert pult.b.midi == []


# -- sender queue (loopdeck_seite, no thread) --------------------------------------------------------------------------

def seite(**k):
    posts, logs = [], []

    def anfrage(pfad, body=None, **kw):
        posts.append((pfad, body, kw))
        r = k.get("antwort")
        if isinstance(r, Exception):
            raise r
        return r if r is not None else {"ok": True}
    s = loopdeck_seite.LoopdeckSeite(lambda *a: logs.append(a), {}, anfrage=anfrage, starte=False)
    s.decks = {1: stand_deck(), 2: stand_deck()}
    return s, posts, logs


def test_queue_merges_control_values_per_key():
    s, posts, _ = seite()
    for v in (1.0, 2.0, 3.0):
        s.regeln(1, 1, "fader_db", -v)
        s.tick(10.0 + v)
    s.regeln(1, 2, "filter", 0.5)
    s.tick(20.0)
    s.leeren()
    assert [(p, b) for p, b, _ in posts] == [("/loopdeck/spur", {"deck": 1, "spur": 1, "fader_db": -3.0}),
                                             ("/loopdeck/spur", {"deck": 1, "spur": 2, "filter": 0.5})]


def test_queue_merges_a_value_queued_before_it_was_sent():
    s, posts, _ = seite()
    s.regeln(1, 1, "fader_db", -1.0)
    s.tick(10.0)
    s.regeln(1, 1, "fader_db", -2.0)
    s.tick(10.5)                                       # the first one is still queued: replaced
    s.leeren()
    assert [b["fader_db"] for _, b, _ in posts] == [-2.0]


def test_pad_posts_are_never_merged_and_go_ahead_of_control_values():
    s, posts, _ = seite()
    s.regeln(1, 1, "fader_db", -1.0)
    s.tick(10.0)
    s.senden("/loopdeck/start", {"deck": 1, "spur": 1, "zelle": 1})
    s.senden("/loopdeck/start", {"deck": 1, "spur": 1, "zelle": 1})
    s.senden("/loopdeck/szene", {"deck": 1, "zeile": 1})
    s.leeren()
    assert [p for p, _, _ in posts] == ["/loopdeck/start", "/loopdeck/start", "/loopdeck/szene", "/loopdeck/spur"]


def test_control_values_need_a_deck_for_that_side():
    s, posts, _ = seite()
    s.decks[1] = None
    s.regeln(1, 1, "fader_db", -1.0)
    s.regeln(2, 1, "fader_db", -1.0)
    s.tick(10.0)
    s.leeren()
    assert [b["deck"] for _, b, _ in posts] == [2]


@pytest.mark.parametrize("grund", ["projekt_offen", "kein_loopdeck"])
def test_a_poll_answered_with_no_deck_blocks_control_values(grund):
    class Fehler(Exception):
        def read(self):
            return ('{"ok": false, "grund": "%s"}' % grund).encode()
    s, posts, logs = seite(antwort=Fehler())
    assert s.holen() is False and s.decks == {1: None, 2: None}
    s.regeln(1, 1, "fader_db", -1.0)
    s.tick(10.0)
    posts.clear()
    s.leeren()
    assert posts == []


def test_errors_are_logged_once_per_reason_and_five_seconds(monkeypatch):
    s, posts, logs = seite(antwort={"ok": False, "grund": "zelle_leer", "text": "x"})
    uhr = [100.0]
    monkeypatch.setattr(loopdeck_seite.time, "monotonic", lambda: uhr[0])
    for _ in range(5):
        s._melde("/loopdeck/start", {"deck": 1})
    assert len(logs) == 1
    uhr[0] += 5.1
    s._melde("/loopdeck/start", {"deck": 1})
    assert len(logs) == 2


def test_new_server_answers_are_not_errors():
    s, posts, logs = seite(antwort={"ok": True, "gestartet": [1], "abgelehnt": [{"spur": 2, "grund": "zelle_laedt"}]})
    s.senden("/loopdeck/szene", {"deck": 1, "zeile": 1})
    s.leeren()
    assert logs == []
    s2, _, logs2 = seite(antwort={"ok": False, "grund": "zelle_laedt", "text": "loading"})
    s2._melde("/loopdeck/start", {"deck": 1})
    assert len(logs2) == 1                              # a refusal is logged like the others, not raised


def test_capture_gets_ten_seconds_and_is_not_retried():
    s, posts, _ = seite(antwort=OSError("timed out"))
    s.senden("/loopdeck/laden", {"deck": 1, "quelle": {"von_deck": 1}})
    s.senden("/loopdeck/start", {"deck": 1, "spur": 1, "zelle": 1})
    s.leeren()
    laden = [kw for p, _, kw in posts if p == "/loopdeck/laden"]
    assert laden == [{"timeout": 10.0}]
    assert [kw for p, _, kw in posts if p == "/loopdeck/start"] == [{}]


def test_optimistic_mute_and_grid_survive_a_poll_while_their_post_is_queued():
    s, posts, _ = seite(antwort={"ok": True, "decks": {"1": stand_deck()}, "beat": 4, "bpm": 120})
    s.mute[(1, 2)] = True
    s.raster[1] = "takt"
    s.senden("/loopdeck/spur", {"deck": 1, "spur": 2, "mute": True})
    s.senden("/loopdeck/raster", {"deck": 1, "raster": "takt"})
    assert s.holen()
    assert s.mute == {(1, 2): True} and s.raster == {1: "takt"}     # posts still queued
    s.leeren()
    assert s.holen()
    assert s.mute == {} and s.raster == {}                          # answered: the next poll brings the real state


def test_optimistic_values_without_a_post_are_cleared_by_the_next_poll():
    s, _, _ = seite(antwort={"ok": True, "decks": {}, "beat": 0, "bpm": 120})
    s.mute[(1, 1)] = True
    assert s.holen()
    assert s.mute == {}


def druecke_taste(b, name):
    leer = bericht()
    alt = b.s8_tasten(leer, None)
    alt = b.s8_tasten(bericht(name), alt)
    b.s8_tasten(leer, alt)


def test_on_buttons_toggle_mutes_in_loops_view(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    pult.deck()["spuren"][2]["mute"] = True
    druecke_taste(b, "left_on_1")
    druecke_taste(b, "left_on_3")
    b.loopdeck.leeren()
    assert pult.posts == [("/loopdeck/spur", {"deck": 1, "spur": 1, "mute": True}),
                          ("/loopdeck/spur", {"deck": 1, "spur": 3, "mute": False})]
    assert b.midi == [] and b.loopdeck.mute == {(1, 1): True, (1, 3): False}


def test_on_buttons_are_midi_in_deck_view(pult):
    druecke_taste(pult.b, "left_on_2")
    pult.b.loopdeck.leeren()
    assert pult.posts == [] and pult.b.midi


# -- Abholung per layer (CZ1) -----------------------------------------------------------------------------------------

def test_abholung_eq_picks_up_only_at_the_model_value_and_posts_db():
    ab = L.Abholung(1, 2, "eq:mitte")
    modell = -10.0                                     # v7 about 38
    assert ab.schritt(100, modell, "k", 0.0) is False
    assert ab.schritt(60, modell, "k", 0.1) is False
    assert ab.schritt(30, modell, "k", 0.2) is True    # crossed downwards
    assert ab.wert(30) == L.eq_db(30)
    assert ab.schritt(110, modell, "k", 0.3) is True   # follows afterwards


def test_abholung_eq_at_the_model_value_in_the_detent_picks_up_at_once():
    ab = L.Abholung(1, 1, "eq:tief")
    assert ab.schritt(65, 0.0, "k", 0.0) is True and ab.wert(65) == 0.0


def test_abholung_send_uses_the_capped_fader_law():
    ab = L.Abholung(2, 1, "send:hall")
    assert ab.schritt(0, -200.0, "k", 0.0) is True and ab.wert(0) == -200.0
    ab = L.Abholung(2, 1, "send:delay")
    assert ab.schritt(20, -6.0, "k", 0.0) is False
    assert ab.schritt(110, -6.0, "k", 0.1) is True and ab.wert(110) == L.send_db(110)
    assert ab._ziel(5.0) == 0.0                        # a model above 0 dB is picked up at the top


def test_abholung_resting_model_change_drops_the_pickup_per_layer():
    ab = L.Abholung(1, 1, "eq:hoch")
    ab.schritt(64, 0.0, "k", 0.0)
    assert ab.abgeholt
    ab.schritt(64, 5.0, "k", 0.1)                      # model moved far while the knob rests
    assert ab.schritt(64, 5.0, "k", 0.7) is False


def test_a_new_abholung_for_another_feld_starts_not_picked_up():
    a = L.Abholung(1, 1, "filter")
    a.schritt(64, 0.0, "k", 0.0)
    assert a.abgeholt
    b = L.Abholung(1, 1, "eq:tief")
    assert b.abgeholt is False and b.kennung is None
    assert b.schritt(100, -10.0, "k", 0.0) is False


def test_abholung_old_fields_are_unchanged():
    assert L.Abholung(1, 1, "filter").wert(100) == L.filter_wert(100)
    assert L.Abholung(1, 1, "fader_db").wert(100) == L.fader_db(100)


# -- layers wired into the bridge (CZ2) -------------------------------------------------------------------------------

def druecke_mit_shift(b, seite, name):
    """Hold SHIFT of `seite` and press `name`, then release both."""
    leer = bericht()
    alt = b.s8_tasten(leer, None)
    alt = b.s8_tasten(bericht(f"{seite}_shift", name), alt)
    b.s8_tasten(leer, alt)


def spur_posts(posts, spur, deck=None):
    """The posts of track `spur` (of side `deck`) without fader values (unreported controls of the fake report sit at 0)."""
    return [(p, b) for p, b in posts if b["spur"] == spur and "fader_db" not in b and deck in (None, b["deck"])]


def streifen_deck(pult, seite=1, k=None):
    d = pult.deck(seite)
    for sp in d["spuren"]:
        sp.update(eq={"tief": 0.0, "mitte": 0.0, "hoch": 0.0}, kill={"tief": False, "mitte": False, "hoch": False},
                  send={"hall": -200.0, "delay": -200.0})
    for nr, felder in (k or {}).items():
        d["spuren"][nr - 1].update(felder)
    return d


def test_fx_buttons_pick_the_layer(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    druecke(b, "left_fx_3")
    assert b.loops[1].schicht == "mitte" and b.loops[2].schicht == "filter"
    druecke_mit_shift(b, "left", "left_fx_2")
    assert b.loops[1].schicht == "delay"
    druecke_mit_shift(b, "left", "left_fx_4")           # SHIFT + fx_4: no change
    assert b.loops[1].schicht == "delay"
    assert not [m for m in b.midi if m[1] in (31, 32, 33, 34)]       # nothing of the fx buttons went out as MIDI


def test_fx_buttons_are_midi_outside_the_loops_view(pult):
    druecke(pult.b, "left_fx_2")
    assert pult.b.loops[1].schicht == "filter" and pult.b.midi


def test_layer_lo_knob_posts_eq_db_after_pickup(pult):
    pult.b.stand["ansicht"][1] = "loops"
    streifen_deck(pult, k={2: {"eq": {"tief": -10.0, "mitte": 0.0, "hoch": 0.0}}})
    druecke(pult.b, "left_fx_2")                        # layer LO
    pult.melde(left_fx_dial_2=100)
    pult.melde(left_fx_dial_2=60)
    assert spur_posts(pult.tick(), 2) == []             # not picked up (model -10 dB is about v7 38)
    pult.melde(left_fx_dial_2=30)
    assert spur_posts(pult.tick(), 2) == [("/loopdeck/spur", {"deck": 1, "spur": 2, "eq": {"tief": pytest.approx(L.eq_db(30))}})]
    assert pult.midi_reihen(13) == []


def test_layer_hall_knob_posts_send(pult):
    pult.b.stand["ansicht"][2] = "loops"
    streifen_deck(pult, 2)
    druecke_mit_shift(pult.b, "right", "right_fx_1")    # layer HALL
    pult.melde(right_fx_dial_4=0)                       # model -200 = knob at 0: picked up at once
    pult.melde(right_fx_dial_4=90)
    assert spur_posts(pult.tick(), 4) == [("/loopdeck/spur", {"deck": 2, "spur": 4, "send": {"hall": pytest.approx(L.send_db(90))}})]


def test_layer_switch_drops_the_knob_pickups_of_that_side_only(pult):
    b = pult.b
    b.stand["ansicht"][1] = b.stand["ansicht"][2] = "loops"
    streifen_deck(pult, 1)
    streifen_deck(pult, 2)
    pult.melde(left_fx_dial_1=64, left_fader_1=127, right_fx_dial_1=64)
    assert b.abholung["left_fx_dial_1"].abgeholt and b.abholung["right_fx_dial_1"].abgeholt
    assert b.abholung["left_fx_dial_1"].feld == "filter"
    druecke(b, "left_fx_3")                             # layer MID on the left
    assert "left_fx_dial_1" not in b.abholung and "right_fx_dial_1" in b.abholung and "left_fader_1" in b.abholung
    pult.melde(left_fx_dial_1=100)                      # model 0 dB (v7 64): 100 is on one side, no pickup yet
    assert b.abholung["left_fx_dial_1"].feld == "eq:mitte" and not b.abholung["left_fx_dial_1"].abgeholt
    assert spur_posts(pult.tick(), 1, 1) == []
    pult.melde(left_fx_dial_1=60)
    assert spur_posts(pult.tick(), 1, 1) == [("/loopdeck/spur", {"deck": 1, "spur": 1, "eq": {"mitte": pytest.approx(L.eq_db(60))}})]


def test_stale_pickup_of_another_layer_is_replaced_in_loops_regler(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult)
    pult.melde(left_fx_dial_1=64)
    b.loops[1].schicht = "hoch"                         # layer changed without the button path
    pult.melde(left_fx_dial_1=64)
    assert b.abholung["left_fx_dial_1"].feld == "eq:hoch"


def test_shift_on_posts_kill_filter_reset_and_send_off(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult, k={1: {"kill": {"tief": False, "mitte": False, "hoch": True}}})
    druecke(b, "left_fx_4")                             # layer HI
    druecke_mit_shift(b, "left", "left_on_3")           # kill on track 3, band hoch
    druecke_mit_shift(b, "left", "left_on_1")           # track 1 has hoch killed: back on
    druecke(b, "left_fx_1")                             # layer FILTER
    druecke_mit_shift(b, "left", "left_on_2")
    druecke_mit_shift(b, "left", "left_fx_1")           # layer HALL
    druecke_mit_shift(b, "left", "left_on_4")
    b.loopdeck.leeren()
    assert pult.posts == [("/loopdeck/spur", {"deck": 1, "spur": 3, "kill": {"hoch": True}}),
                          ("/loopdeck/spur", {"deck": 1, "spur": 1, "kill": {"hoch": False}}),
                          ("/loopdeck/spur", {"deck": 1, "spur": 2, "filter": 0}),
                          ("/loopdeck/spur", {"deck": 1, "spur": 4, "send": {"hall": -200}})]
    assert b.loops[1].schicht == "hall" and [m[1] for m in b.midi if m[0] == 0x9C] == [13] * 5   # only the SHIFT button itself
    assert b.loopdeck.mute == {}                         # SHIFT + on is not a mute


def test_on_without_shift_still_mutes_in_every_layer(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult)
    druecke(b, "left_fx_3")
    druecke(b, "left_on_2")
    b.loopdeck.leeren()
    assert pult.posts == [("/loopdeck/spur", {"deck": 1, "spur": 2, "mute": True})]


def test_shift_on_in_slice_mode_keeps_the_focus_use(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult)
    druecke(b, "left_freeze")
    druecke(b, "left_on_3")
    assert b.loops[1].fokus == 3
    b.loopdeck.leeren()
    assert pult.posts == []


def test_shift_on_without_a_loop_deck_posts_nothing(pult):
    pult.b.stand["ansicht"][1] = "loops"
    druecke_mit_shift(pult.b, "left", "left_on_1")
    pult.b.loopdeck.leeren()
    assert pult.posts == []


def test_queue_merges_eq_and_send_values_per_key():
    s, posts, _ = seite()
    s.regeln(1, 1, "eq:tief", -3.0)
    s.regeln(1, 1, "eq:mitte", 2.0)
    s.regeln(1, 1, "send:hall", -9.0)
    s.tick(10.0)
    s.regeln(1, 1, "eq:tief", -4.0)                    # a newer value of a key already queued replaces it
    s.tick(10.5)
    s.leeren()
    bodies = [b for _, b, _ in posts]
    merged = {}
    for b in bodies:
        assert b["deck"] == 1 and b["spur"] == 1
        for k in ("eq", "send"):
            merged.setdefault(k, {}).update(b.get(k, {}))
    assert merged == {"eq": {"tief": -4.0, "mitte": 2.0}, "send": {"hall": -9.0}}
    assert sum(1 for b in bodies if "eq" in b) == 1    # one post carries both bands: nothing dropped, nothing doubled


def test_queue_keeps_two_layers_of_one_track_when_moved_fast():
    s, posts, _ = seite()
    s.regeln(1, 2, "eq:hoch", 1.0)
    s.regeln(1, 2, "filter", 0.5)
    s.tick(10.0)
    s.leeren()
    seen = {}
    for _, b, _ in posts:
        seen.update({k: v for k, v in b.items() if k not in ("deck", "spur")})
    assert seen == {"eq": {"hoch": 1.0}, "filter": 0.5}


def test_two_kill_presses_before_a_poll_toggle_back(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult)
    druecke(b, "left_fx_3")                             # layer MID
    druecke_mit_shift(b, "left", "left_on_1")
    druecke_mit_shift(b, "left", "left_on_1")
    b.loopdeck.leeren()
    assert pult.posts == [("/loopdeck/spur", {"deck": 1, "spur": 1, "kill": {"mitte": True}}),
                          ("/loopdeck/spur", {"deck": 1, "spur": 1, "kill": {"mitte": False}})]


def test_the_pending_kill_is_cleared_by_the_poll_after_the_answer(pult):
    b = pult.b
    b.loopdeck.anfrage = lambda p, body=None, **k: ({"ok": True, "decks": {"1": streifen_deck(pult), "2": None}}
                                                    if p == "/loopdeck/stand" else pult.posts.append((p, body)) or {"ok": True})
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult)
    druecke(b, "left_fx_3")
    druecke_mit_shift(b, "left", "left_on_1")
    b.loopdeck.leeren()
    assert b.loopdeck.streifen                          # still remembered until a poll has seen the answered post
    assert b.loopdeck.holen()
    assert b.loopdeck.streifen == {}
    druecke_mit_shift(b, "left", "left_on_1")           # the stand says not killed again: kills
    b.loopdeck.leeren()
    assert pult.posts[-1][1]["kill"] == {"mitte": True}


def test_two_send_presses_before_a_poll_restore_the_value(pult):
    b = pult.b
    b.stand["ansicht"][1] = "loops"
    streifen_deck(pult, k={1: {"send": {"hall": -9.0, "delay": -200.0}}})
    druecke_mit_shift(b, "left", "left_fx_1")           # HALL
    druecke_mit_shift(b, "left", "left_on_1")
    druecke_mit_shift(b, "left", "left_on_1")
    b.loopdeck.leeren()
    assert [p[1]["send"] for p in pult.posts] == [{"hall": -200}, {"hall": -9.0}]
