# Tests of apc_produktion (the APC20 as the project mixer in PRODUCTION): what each control sends, the LEDs, the track step.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import apc_production as A  # noqa: E402

SP = [{"nr": 3, "id": "s3", "mute": True, "solo": False, "arm": False}, {"nr": 4, "id": "s4", "mute": False, "solo": True, "arm": True}]
LAGE = {"produktion": True, "bank": 0, "laeuft": False, "spalten": SP + [None] * 6, "spuren": [{"id": "s3"}, {"id": "s4"}, {"id": "s9"}]}


def test_faders_go_to_the_track_rows_on_channel_16():
    assert A.uebersetze(bytes([0xB0, 7, 100]), LAGE) == [("kern", bytes([0xBF, 3, A.fader_cc(100)]))], "column 1 = track nr 3"
    assert A.uebersetze(bytes([0xB1, 7, 5]), LAGE) == [("kern", bytes([0xBF, 4, A.fader_cc(5)]))]
    assert A.uebersetze(bytes([0xB2, 7, 5]), LAGE) == [], "a column without a track"
    assert A.uebersetze(bytes([0xB0, 14, 90]), LAGE) == [("kern", bytes([0xBF, 100, A.fader_cc(90)]))], "master fader = pm/fader"


def test_buttons_mute_solo_arm():
    assert A.uebersetze(bytes([0x90, 50, 127]), LAGE) == [("kern", bytes([0x9F, 3, 127]))], "activator = mute of track 3"
    assert A.uebersetze(bytes([0x80, 50, 127]), LAGE) == [("kern", bytes([0x8F, 3, 0]))]
    assert A.uebersetze(bytes([0x91, 49, 127]), LAGE) == [("kern", bytes([0x9F, 68, 127]))], "solo = 64 + nr"
    assert A.uebersetze(bytes([0x91, 48, 127]), LAGE) == [("http", "/controller/pult/arm", {"nr": 4})]
    assert A.uebersetze(bytes([0x81, 48, 127]), LAGE) == [], "arm acts on the press only"
    assert A.uebersetze(bytes([0x90, 53, 127]), LAGE) == [], "the clip grid does nothing in PRODUCTION"
    assert A.uebersetze(bytes([0x90, 82, 127]), LAGE) == []


def test_shift_functions_from_the_cc16_burst():
    assert A.uebersetze(bytes([0xB0, 16, 0]), LAGE) == A._start_stopp(), "play while stopped starts"
    assert A.uebersetze(bytes([0xB0, 16, 0]), {**LAGE, "laeuft": True}) == [], "play while running does nothing"
    assert A.uebersetze(bytes([0xB1, 16, 0]), {**LAGE, "laeuft": True}) == A._start_stopp(), "stop while running stops"
    assert A.uebersetze(bytes([0xB1, 16, 0]), LAGE) == []
    assert A.uebersetze(bytes([0xB0, 17, 0]), LAGE) == [], "only CC 16 of a burst triggers"
    assert A.uebersetze(bytes([0xB4, 16, 0]), LAGE) == [("http", "/controller/pult/bank", {"schritt": -1})]
    assert A.uebersetze(bytes([0xB5, 16, 0]), LAGE) == [("http", "/controller/pult/bank", {"schritt": 1})]
    assert A.uebersetze(bytes([0xB6, 16, 0]), LAGE) == [("fokus", -1)]
    assert A.uebersetze(bytes([0xB7, 16, 0]), LAGE) == [("fokus", 1)]
    assert A.uebersetze(bytes([0xB2, 16, 0]), LAGE) == [], "rec is not used yet"


def test_leds_and_neighbour():
    l = A.leds(LAGE)
    assert l[(0, 50)] == 127 and l[(0, 49)] == 0 and l[(1, 49)] == 127 and l[(1, 48)] == 127
    assert l[(2, 50)] == 0 and l[(0, 53)] == 0 and l[(0, 82)] == 0
    assert A.nachbar(LAGE["spuren"], "s4", 1) == "s9" and A.nachbar(LAGE["spuren"], "s3", -1) is None
    assert A.nachbar(LAGE["spuren"], None, 1) == "s3"


def test_kern_leds_wait_in_production_and_come_back():
    gesendet = []
    p = A.ApcProduktion(lambda *a: None, gesendet.append, lambda b: None, holen=lambda *a: {})
    p.lage = {"produktion": True}
    assert p.vom_kern(bytes([0x90, 57, 1])) is False, "in PRODUCTION a DJ LED waits"
    p.lage = {}
    assert p.vom_kern(bytes([0x91, 57, 0])) is True
    assert p.dj_leds == {(0, 57): bytes([0x90, 57, 1]), (1, 57): bytes([0x91, 57, 0])}


def test_fader_taper_is_the_page_taper():
    import re
    js = (Path(__file__).resolve().parents[2] / "ui" / "public" / "production" / "fader_curve.js").read_text()
    anker = re.search(r"export const ANKER = (\[\[.*?\]\]);", js).group(1)
    assert [tuple(x) for x in __import__("json").loads(anker)] == [tuple(x) for x in A.ANKER], "the bridge reads the fader like the page"
    assert A.fader_cc(0) == 0 and A.fader_cc(3) == 0, "the bottom is off"
    assert A.fader_cc(127) == 127, "the top is +6 dB"
    db = lambda cc: A.DB_MIN + cc / 127 * (A.DB_MAX - A.DB_MIN)
    assert abs(db(A.fader_cc(108)) - A.db_von_pos(108 / 127)) < 0.3, "0 dB sits at 85 % like on the page"
    assert abs(A.db_von_pos(0.5) - (-18)) < 1e-9, "half travel = -18 dB, as the page's fader at half travel"
