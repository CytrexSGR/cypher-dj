"""Folgenformat, Zusätze von Scheibe 09 (folgen/FORMAT.md Punkte 13 bis 22): jede neue Schritt-Art ist gültig gegen
folge.schema.json und ohne ihr Pflichtfeld ungültig; die alten Schritt-Arten tragen bereich und herleitung; die drei
Folgen von Scheibe 02 bleiben grün; eine reine Rechner-Folge braucht kein /k/set/neu, eine gemischte schon."""
import json
import pathlib
import subprocess
import sys

import jsonschema
import pytest

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_folgen  # noqa: E402  (Scheibe 02, von 09 um die Rechner-Ausnahme ergänzt)

OSC = json.loads((HIER / "osc.json").read_text(encoding="utf-8"))
BEISPIELE = {
    "erwarte_nicht": {"t": "erwarte_nicht", "ab_sample": 0, "bis_sample": 48000,
                      "osc": ["/e/invariante", ",ssihd", None, None, None, None, None]},
    "erlaube": {"t": "erlaube", "ab_sample": 0, "bis_sample": 48000,
                "osc": ["/e/invariante", ",ssihd", "hoerschein", None, None, None, None], "herleitung": "Punkt 22 a"},
    "buendel": {"t": "buendel", "sample": 0, "nachrichten": [["/erz/fenster", ",iiiiddh", 1, 1, 66, 0, 4.0, 12.0, 0]]},
    "deck_wert": {"t": "deck_wert", "sample": 0, "deck": 1, "feld": "quell_beat", "wert": 16.5, "toleranz": 0.01},
    "messung": {"t": "messung", "sample": 0, "name": "stille_ms", "wert": 0, "toleranz": 0},
    "aktion": {"t": "aktion", "sample": 0, "was": "kern_kill9"},
    "ws_sende": {"t": "ws_sende", "sample": 0, "typ": "hallo", "daten": {"rolle": "mcp", "name": "x", "protokoll": 1}},
    "ws_erwarte": {"t": "ws_erwarte", "ab_sample": 0, "bis_sample": 48000, "typ": "willkommen", "daten": {"autonomie": 1}},
    "rechner_frage": {"t": "rechner_frage", "zeile": {"id": 1, "methode": "spielarten", "parameter": {}}},
    "rechner_antwort": {"t": "rechner_antwort", "zeile": {"id": 1, "ergebnis": []}},
}
PFLICHT = {"erwarte_nicht": "osc", "erlaube": "herleitung", "buendel": "nachrichten", "deck_wert": "feld",
           "messung": "name", "aktion": "was", "ws_sende": "daten", "ws_erwarte": "typ", "rechner_frage": "zeile",
           "rechner_antwort": "zeile"}


def _v():
    return jsonschema.Draft202012Validator(json.loads((HIER / "folge.schema.json").read_text(encoding="utf-8")))


@pytest.mark.parametrize("art", sorted(BEISPIELE))
def test_neue_schritt_art_ist_gueltig(art):
    assert [f.message for f in _v().iter_errors(BEISPIELE[art])] == []


@pytest.mark.parametrize("art", sorted(PFLICHT))
def test_ohne_pflichtfeld_ungueltig(art):
    kaputt = {k: w for k, w in BEISPIELE[art].items() if k != PFLICHT[art]}
    assert not _v().is_valid(kaputt)


def test_alte_schritt_arten_tragen_bereich_herleitung_und_ab_sample():
    z = {"t": "erwarte", "ab_sample": 0, "bis_sample": 10, "osc": ["/e/ki", ",ish", 1, None, None],
         "bereich": "ki", "herleitung": "§5.9"}
    assert _v().is_valid(z)
    assert not _v().is_valid(dict(z, bereich="gibt_es_nicht"))


def test_folgen_von_02_bleiben_gruen():
    r = subprocess.run([sys.executable, str(HIER / "pruefe_folgen.py")], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout[-800:]


def test_reine_rechner_folge_braucht_keine_zeitachse(tmp_path):
    p = tmp_path / "rechner.jsonl"
    p.write_text("".join(json.dumps(BEISPIELE[a]) + "\n" for a in ("rechner_frage", "rechner_antwort")), encoding="utf-8")
    assert pruefe_folgen.pruefe_datei(p, OSC, _v()) == []
    p.write_text(p.read_text(encoding="utf-8") + json.dumps(BEISPIELE["aktion"]) + "\n", encoding="utf-8")
    assert any("erste Zeile muss sende /k/set/neu" in f for f in pruefe_folgen.pruefe_datei(p, OSC, _v()))
