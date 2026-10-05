"""Deck-Grammatik und Betrieb: die Zahlen aus §4.4, §5.5, §16.1 und §6.1 stehen in den Folgen; Mutationen fallen auf."""
import json
import math
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import folgen_vergleich as fv  # noqa: E402
import pruefe_golden as pg  # noqa: E402
import vertragstext  # noqa: E402


def _zeilen(name):
    return [json.loads(z) for z in (HIER / "folgen" / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()]


def test_hotcue_ziele():
    werte = [z["wert"] for z in _zeilen("hotcue_phase") if z["t"] == "deck_wert"]
    assert [round(w - 1.0, 9) for w in werte] == [64.3, 63.6, 64.45]
    assert abs(werte[0] - 1.0 - pg.anker(vertragstext.lies())["hotcue_phase"]) < 1e-9


def test_falsche_deckposition_wird_gemeldet():
    zeilen = _zeilen("hotcue_phase")
    beob, w, d, m = fv.ideale_beobachtung(zeilen)
    falsch = lambda deck, feld, s: d(deck, feld, s) + 1.0
    assert sum(1 for _, art, _ in fv.pruefe(zeilen, beob, w, falsch, m) if art == "deck_wert") == 3


def test_politik_raster_naechster_punkt():
    q5 = [z["osc"] for z in _zeilen("politik_raster") if z["t"] == "erwarte" and z["osc"][0] == "/q" and z["osc"][4] == 5]
    assert [(o[5], o[6]) for o in q5] == [(945000, 42.0), (1080000, 48.0)]


def test_laden_trim_und_grenze():
    werte = {(z["sample"], z["pfad"]): z["wert"] for z in _zeilen("laden") if z["t"] == "wert"}
    assert abs(werte[(135000, "deck/1/trim")] - -6.6) < 1e-9 and werte[(270000, "deck/2/trim")] == 24.0


def test_notbahn_schleife_ist_ein_master_takt():
    """§6.1: die Schleife ist takt_frames lang; hier unabhängig von karte.py mit den Formeln aus §1.3 nachgerechnet."""
    r = lambda x: int(math.floor(x + 0.5))
    m124 = next(z for z in _zeilen("notbahn_124") if z["t"] == "messung" and z["name"] == "schleife_frames")
    assert m124["wert"] == r(64 * 48000 * 60 / 124) - r(60 * 48000 * 60 / 124) == 92904
    t = 32 * 60 / ((128 + 132) / 2)
    k = (132 - 128) / t
    sample = lambda b: 1440000 + 48000 * 120 * (b - 64) / (128 + math.sqrt(128 ** 2 + 120 * k * (b - 64)))
    m132 = next(z for z in _zeilen("notbahn_rampe") if z["t"] == "messung" and z["name"] == "schleife_frames")
    assert m132["wert"] == r(sample(72)) - r(sample(68)) == 89469     # Takt [68, 72) in der Rampe 128 → 132


def test_autonomie_1_eq_erwartet_vorschlag_und_keine_quittung():
    zeilen = _zeilen("autonomie_1_eq")
    assert any(z["t"] == "ws_erwarte" and z["daten"] == {"id": 1, "ergebnis": {"status": "vorgeschlagen"}} for z in zeilen)
    assert any(z["t"] == "erwarte_nicht" and z["osc"][:4] == ["/q", ",hsihds", None, "cypher"] for z in zeilen)
