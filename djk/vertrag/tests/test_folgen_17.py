"""expandiere_sicher: die Wahl §14.2 hinein, die 14 Teile aus §14.1 heraus; Rechner-Folgen ohne Zeitachse (FORMAT 17)."""
import copy
import json
import pathlib
import sys

import jsonschema

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import folgen_vergleich as fv  # noqa: E402
import herleitung as h  # noqa: E402
import pruefe_folgen  # noqa: E402  (Scheibe 02)
import vertragstext  # noqa: E402

OSC = json.loads((HIER / "osc.json").read_text(encoding="utf-8"))
FOLGE = HIER / "folgen" / "expandiere_sicher.jsonl"


def _zeilen():
    return [json.loads(z) for z in FOLGE.read_text(encoding="utf-8").splitlines()]


def _v():
    return jsonschema.Draft202012Validator(json.loads((HIER / "folge.schema.json").read_text(encoding="utf-8")))


def test_frage_traegt_die_wahl_aus_14_2_und_die_antwort_die_teile_aus_14_1():
    plan, wahl = h.plan_und_wahl(vertragstext.lies())
    frage, antwort = _zeilen()
    assert frage["t"] == "rechner_frage" and frage["zeile"]["parameter"]["wahl"] == wahl
    assert antwort["t"] == "rechner_antwort" and antwort["zeile"]["ergebnis"]["plan"]["teile"] == plan["teile"]


def test_rechner_antwort_mit_basstausch_einen_takt_frueher_ist_rot():
    zeilen = _zeilen()
    gut = copy.deepcopy(zeilen[1]["zeile"])
    gut["ergebnis"]["plan"]["id"] = "p1"
    gut["ergebnis"]["vorhersage"] = {"grenzen_ok": True}
    assert fv.pruefe(zeilen, [{"rechner": gut}], None) == []
    gut["ergebnis"]["plan"]["teile"][4]["ab_beat"] = 472.0
    assert [art for _, art, _ in fv.pruefe(zeilen, [{"rechner": gut}], None)] == ["fehlt"]


def test_rechner_folge_besteht_die_pruefung_von_02():
    assert pruefe_folgen.pruefe_datei(FOLGE, OSC, _v()) == []


def test_ausnahme_gilt_nur_fuer_reine_rechner_folgen(tmp_path):
    p = tmp_path / "gemischt.jsonl"
    p.write_text(FOLGE.read_text(encoding="utf-8") + '{"t":"aktion","sample":0,"was":"kern_kill9"}\n', encoding="utf-8")
    assert any("erste Zeile muss sende /k/set/neu" in f for f in pruefe_folgen.pruefe_datei(p, OSC, _v()))
