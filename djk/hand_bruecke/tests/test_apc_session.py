# Tests of apc_session (the APC20 in SESSION mode): the pure model (grid, scenes, stop, window) and the bridge wiring.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import apc_session as S  # noqa: E402


def zelle(n):
    return {"sha": "h%d" % n, "frames": 1000}


def lauf(zelle_nr=None, wartend=None):
    return {"zelle": zelle_nr, "verwaist": False, "ab_beat": 0, "versatz_beats": 0, "wartend": wartend, "zuletzt": None}


def spalte(i, zellen=None, l=None):
    z = zellen if zellen is not None else [zelle(k) for k in range(1, 9)]
    return {"spur_id": "s%d" % i, "kurz": "C%d" % i, "name": "c%d" % i, "art": "audio", "deck": 1, "spur": 1, "zellen": z, "lauf": l or lauf()}


def stand(n=8, geparkt=None, spez=None):
    spalten = [spalte(i + 1, **(spez or {}).get(i, {})) for i in range(n)]
    return {"raster": "1", "szenen": [], "beat": 0, "bpm": 120, "container": [{"buchstabe": "A", "typ": "loops", "name": "L", "spalten": spalten}],
            "geparkt": geparkt or []}


# -- C1: model -----------------------------------------------------------------------------------------------------
def test_led_farbe_five_cases():
    sp = spalte(1, zellen=[None, zelle(2), zelle(3), {"halten": True}, zelle(5), None, None, None],
                l=lauf(3, wartend={"zelle": 5, "ab_beat": 8}))
    assert S.led_farbe(sp, 1) == 0, "empty"
    assert S.led_farbe(sp, 4) == 0, "halten"
    assert S.led_farbe(sp, 2) == 5, "filled"
    assert S.led_farbe(sp, 3) == 1, "playing"
    assert S.led_farbe(sp, 5) == 2, "pending start"
    stopp = spalte(1, l=lauf(3, wartend={"zelle": None, "ab_beat": 8}))
    assert S.led_farbe(stopp, 3) == 4, "pending stop on the playing cell"
    assert S.led_farbe(stopp, 2) == 5
    assert S.led_farbe(None, 1) == 0


def test_taste_grid_start_follows_the_window():
    st = stand()
    assert S.taste(st, (0, 0), 4, 54) == ("/session/start", {"spur_id": "s5", "zelle": 2}), "row 2, column 5"
    assert S.taste(st, (0, 3), 4, 57) == ("/session/start", {"spur_id": "s5", "zelle": 8})
    assert S.taste(st, (0, 3), 4, 54) == ("/session/start", {"spur_id": "s5", "zelle": 5}), "window row 3: row 2 is cell 5"
    assert S.taste(st, (2, 0), 0, 53) == ("/session/start", {"spur_id": "s3", "zelle": 1}), "window column 2"


def test_taste_on_the_playing_cell_stops_its_column():
    st = stand(spez={2: {"l": lauf(4)}, 3: {"l": lauf(4, wartend={"zelle": None, "ab_beat": 8})}, 5: {"l": lauf(4, wartend={"zelle": 6, "ab_beat": 8})}})
    assert S.taste(st, (0, 0), 2, 56) == ("/session/stopp", {"spur_id": "s3"}), "playing cell 4: stop"
    assert S.taste(st, (0, 0), 2, 55) == ("/session/start", {"spur_id": "s3", "zelle": 3}), "another cell launches"
    assert S.taste(st, (0, 0), 3, 56) == ("/session/start", {"spur_id": "s4", "zelle": 4}), "pending stop: launch again"
    assert S.taste(st, (0, 0), 5, 56) == ("/session/stopp", {"spur_id": "s6"}), "still playing under a pending launch of another cell"
    verwaist = stand(spez={0: {"l": {**lauf(1), "verwaist": True}}})
    assert S.taste(verwaist, (0, 0), 0, 53) == ("/session/start", {"spur_id": "s1", "zelle": 1}), "an orphaned run launches"


def test_taste_empty_halten_and_missing_column():
    st = stand(2, spez={0: {"zellen": [None, {"halten": True}] + [zelle(3)] * 6}})
    assert S.taste(st, (0, 0), 0, 53) is None, "empty cell"
    assert S.taste(st, (0, 0), 0, 54) is None, "halten cell"
    assert S.taste(st, (0, 0), 5, 53) is None, "no column 6"
    assert S.taste(st, (0, 0), 5, 52) is None


def test_taste_stop_scene_and_stop_all():
    st = stand()
    assert S.taste(st, (0, 0), 2, 52) == ("/session/stopp", {"spur_id": "s3"})
    assert S.taste(st, (0, 3), 0, 84) == ("/session/szene", {"zeile": 6})
    assert S.taste(st, (0, 0), 0, 82) == ("/session/szene", {"zeile": 1})
    assert S.taste(st, (0, 0), 0, 81) == ("/session/stopp", {})
    assert S.taste(st, (0, 0), 3, 81) is None, "stop all is channel 1 only"
    assert S.taste(st, (0, 0), 3, 84) is None, "scene keys are channel 1 only"


def test_columns_in_container_order_geparkt_last():
    st = stand(7, geparkt=[[spalte(9)]])
    assert S.taste(st, (0, 0), 7, 53) == ("/session/start", {"spur_id": "s9", "zelle": 1})


def test_sichtbar_window():
    st = stand(10)
    g = S.sichtbar(st, (2, 3))
    assert len(g) == 5 and all(len(r) == 8 for r in g)
    assert g[0][0] is st["container"][0]["spalten"][2]["zellen"][3], "cell 4 of column 3"
    assert S.sichtbar(stand(3), (0, 0))[0][5] is None, "no column"
    assert S.sichtbar(None, (0, 0)) == [[None] * 8 for _ in range(5)]


def test_verschiebe_clamps():
    assert S.verschiebe((0, 0), "links", 20) == (0, 0)
    assert S.verschiebe((0, 0), "rechts", 20) == (1, 0)
    assert S.verschiebe((12, 0), "rechts", 20) == (12, 0), "n - 8"
    assert S.verschiebe((0, 0), "rechts", 5) == (0, 0), "fewer than 8 columns"
    assert S.verschiebe((0, 0), "hoch", 8) == (0, 0)
    assert S.verschiebe((0, 2), "runter", 8) == (0, 3)
    assert S.verschiebe((0, 3), "runter", 8) == (0, 3), "3 rows"
    assert S.verschiebe((4, 3), "hoch", 20) == (4, 2)


def test_leds_grid_and_scenes():
    st = stand(2, spez={0: {"l": lauf(3)}})
    ls = {(c, n): v for c, n, v in S.leds(st, (0, 0))}
    assert ls[(0, 55)] == 1 and ls[(0, 53)] == 5 and ls[(1, 53)] == 5
    assert ls[(2, 53)] == 0, "no column 3"
    assert ls[(0, 84)] == 1 and ls[(0, 82)] == 0, "scene LED of the row with a playing cell"
    ls = {(c, n): v for c, n, v in S.leds(st, (0, 2))}
    assert ls[(0, 82)] == 1, "window row 3: scene 1 of the window is row 3"
    assert ls[(0, 53)] == 1 and ls[(0, 57)] == 5, "cell 3 plays and is the first visible row"


def test_no_live_project_everything_dark():
    assert all(v == 0 for _, _, v in S.leds(None, (0, 0)))
    assert len(S.leds(None, (0, 0))) == 8 * 5 + 5
    assert S.taste(None, (0, 0), 0, 53) is None
    assert S.taste(None, (0, 0), 0, 82) is None, "no live project: no scene launch"
    assert S.taste(None, (0, 0), 0, 81) is None


def test_column_without_cells_stays_dark():
    st = stand(1, spez={0: {"zellen": []}})
    assert all(v == 0 for c, n, v in S.leds(st, (0, 0)) if c == 0 and n != 82)
    assert S.taste(st, (0, 0), 0, 53) is None

# -- C2: wiring ----------------------------------------------------------------------------------------------------
class Welt:
    def __init__(self, st=None):
        self.st, self.ansicht, self.rufe, self.leds, self.logs = st, "studio", [], [], []
        self.fehler = None

    def holen(self, pfad, body=None, kopf=None):
        self.rufe.append((pfad, body, kopf))
        if self.fehler:
            raise self.fehler
        if pfad == "/session/stand":
            return self.st if self.st is not None else {"ok": False, "grund": "kein_projekt", "text": "x"}
        return {"ok": True}

    def apc(self, dj=None):
        return S.ApcSession(lambda *a: self.logs.append(a), self.leds.append, self.holen, ansicht=lambda: self.ansicht,
                            wiederhole=lambda: list(dj or []))


def test_grid_press_posts_and_is_taken():
    w = Welt(stand())
    a = w.apc()
    a._abfrage_einmal()
    assert a.vom_apc(bytes([0x90, 53, 127])) is True
    a._arbeite_einen()
    post = [r for r in w.rufe if r[0] == "/session/start"]
    assert post == [("/session/start", {"spur_id": "s1", "zelle": 1}, {"x-djk-quelle": "andreas"})]


def test_note_off_and_zero_velocity_are_taken_but_do_nothing():
    w = Welt(stand())
    a = w.apc()
    a._abfrage_einmal()
    assert a.vom_apc(bytes([0x80, 53, 0])) is True
    assert a.vom_apc(bytes([0x90, 53, 0])) is True
    assert a.q.empty()


def test_other_controls_pass_unchanged():
    a = Welt(stand()).apc()
    assert a.vom_apc(bytes([0xB0, 7, 100])) is False, "fader"
    assert a.vom_apc(bytes([0x90, 50, 127])) is False, "activator"
    assert a.vom_apc(bytes([0x90, 49, 127])) is False, "solo"
    assert a.vom_apc(bytes([0xB0, 14, 90])) is False, "master"
    assert a.vom_apc(bytes([0xB0, 47, 90])) is False, "cue level"
    assert a.vom_apc(bytes([0x90, 81, 127])) is True, "stop all"
    assert a.vom_apc(bytes([0x91, 81, 127])) is False, "81 on another channel"
    assert a.vom_apc(bytes([0xB0, 16, 0])) is False, "shift + play is not taken"


def test_shift_arrows_move_the_window():
    w = Welt(stand(12, spez={8: {"l": lauf(1)}}))
    a = w.apc()
    a._abfrage_einmal()
    w.leds.clear()
    assert a.vom_apc(bytes([0xB5, 16, 0])) is True, "right"
    assert a.fenster == (1, 0)
    assert bytes([0x97, 53, 1]) in w.leds, "column 9 now at channel 8"
    assert a.vom_apc(bytes([0xB7, 16, 0])) is True, "down"
    assert a.fenster == (1, 1)
    assert a.vom_apc(bytes([0xB5, 17, 0])) is True, "rest of the burst is taken too"
    assert a.fenster == (1, 1)


def test_leds_only_on_change():
    w = Welt(stand())
    a = w.apc()
    a._abfrage_einmal()
    n = len(w.leds)
    assert n == 45
    a._abfrage_einmal()
    assert len(w.leds) == n, "no flood at 4 Hz"
    w.st = stand(8, spez={0: {"l": lauf(2)}})
    a._abfrage_einmal()
    assert len(w.leds) == n + 2, "cell 2 of column 1 and scene 2"
    assert bytes([0x90, 54, 1]) in w.leds


def test_leaving_studio_turns_leds_off_once_and_stops_polling():
    dj = [bytes([0x90, 55, 3])]
    w = Welt(stand())
    a = w.apc(dj)
    a._abfrage_einmal()
    w.leds.clear()
    w.rufe.clear()
    w.ansicht = "dj"
    a._abfrage_einmal()
    assert bytes([0x90, 53, 0]) in w.leds and bytes([0x90, 55, 3]) in w.leds, "dark, then the DJ LED is replayed"
    assert all(m[2] == 0 for m in w.leds if m != dj[0])
    n = len(w.leds)
    a._abfrage_einmal()
    assert len(w.leds) == n and w.rufe == [], "once, and no more polling"
    assert a.vom_apc(bytes([0x90, 53, 127])) is False
    assert not a.an()


def test_production_mode_does_not_use_session():
    w = Welt(stand())
    w.ansicht = "produktion"
    assert not w.apc().an()


def test_failed_request_logs_one_line_and_keeps_going():
    w = Welt(stand())
    a = w.apc()
    w.fehler = OSError("down")
    a._abfrage_einmal()
    a._abfrage_einmal()
    assert len([l for l in w.logs if "failed" in str(l)]) == 1
    w.fehler = None
    a._abfrage_einmal()
    assert len(w.leds) == 45


def test_no_live_project_grid_dark_but_stop_all_still_none():
    w = Welt(None)
    a = w.apc()
    a._abfrage_einmal()
    assert all(m[2] == 0 for m in w.leds)
    assert a.vom_apc(bytes([0x90, 53, 127])) is True
    assert a.q.empty()


def test_kern_led_of_the_grid_is_held_back_in_session():
    a = Welt(stand()).apc()
    assert a.haelt_zurueck(bytes([0x90, 55, 1])) is True
    assert a.haelt_zurueck(bytes([0x90, 50, 1])) is False
    assert a.haelt_zurueck(bytes([0x90, 85, 1])) is True


# -- fix round 1 ---------------------------------------------------------------------------------------------------
def test_studio_to_production_replays_no_dj_led():
    dj = [bytes([0x90, 55, 3])]
    w = Welt(stand())
    a = w.apc(dj)
    a._abfrage_einmal()
    w.leds.clear()
    w.ansicht = "produktion"
    a._abfrage_einmal()
    assert dj[0] not in w.leds, "PRODUCTION keeps the grid dark"
    assert all(m[2] == 0 for m in w.leds), "only the darkening goes out"
    w.leds.clear()
    a._abfrage_einmal()
    assert w.leds == []


def test_only_kein_projekt_darkens_a_transient_refusal_keeps_the_stand():
    w = Welt(stand(12))
    a = w.apc()
    a._abfrage_einmal()
    a.vom_apc(bytes([0xB5, 16, 0]))
    w.leds.clear()
    w.holen_alt = w.holen
    w.holen = lambda pfad, body=None, kopf=None: {"ok": False, "grund": "beschaeftigt", "text": "x"}
    a.holen = w.holen
    a._abfrage_einmal()
    assert a.stand is not None and a.fenster == (1, 0) and w.leds == []
    a.holen = lambda pfad, body=None, kopf=None: {"ok": False, "grund": "kein_projekt", "text": "x"}
    a._abfrage_einmal()
    assert a.stand is None and a.fenster == (0, 0)
    assert all(m[2] == 0 for m in w.leds) and w.leds


def test_column_without_spur_id_is_skipped():
    st = stand(3)
    del st["container"][0]["spalten"][1]["spur_id"]
    assert [s["spur_id"] for s in S.spalten_von(st)] == ["s1", "s3"]
    assert S.taste(st, (0, 0), 1, 53) == ("/session/start", {"spur_id": "s3", "zelle": 1})


def test_malformed_stand_does_not_end_the_poll_or_the_press():
    w = Welt({"container": [{"spalten": [{"spur_id": "s1", "zellen": 5, "lauf": 7}]}]})
    a = w.apc()
    a._abfrage_einmal()      # does not raise
    assert len([l for l in w.logs if "failed" in str(l)]) == 1
    w.st = stand()
    a._abfrage_einmal()
    assert len(w.leds) == 45, "the next good stand works"


def test_bridge_holds_back_core_grid_led_in_session():
    import pult_bridge as P
    gesendet = []

    class Sitz:
        def send(self, port, data):
            gesendet.append(bytes(data))
    w = Welt(stand())
    b = P.Bruecke.__new__(P.Bruecke)
    b.apc = type("A", (), {"vom_kern": lambda self, d: True})()
    b.apc_session = w.apc()
    b.lock = __import__("threading").Lock()
    b.seq, b.p_apc_aus = Sitz(), 1
    b.led_vom_kern(bytes([0x90, 55, 1]))
    assert gesendet == [], "SESSION owns the grid"
    b.led_vom_kern(bytes([0x90, 50, 1]))
    assert gesendet == [bytes([0x90, 50, 1])], "other LEDs pass"
    w.ansicht = "dj"
    b.led_vom_kern(bytes([0x90, 55, 1]))
    assert gesendet[-1] == bytes([0x90, 55, 1]), "DJ view: the grid LED passes"
