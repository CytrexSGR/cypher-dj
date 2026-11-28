"""Tests for generate_insert.py: the insert vocabulary (docs/interfaces/insert_module.json) against its generated files and
against presets/geraete.ts. The C++ side (path length, uniqueness, parity with the DJ-side komp/* rows) is test_insert_vertrag in
djk/core/signalbox/tests."""
import copy
import json
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import generate_insert as erzeuge_insert  # noqa: E402


def vertrag():
    return json.loads(erzeuge_insert.VERTRAG.read_text(encoding="utf-8"))


def test_erzeugte_dateien_sind_aktuell():
    for rel, soll in erzeuge_insert.erzeuge(vertrag()).items():
        assert (erzeuge_insert.WURZEL / rel).read_text(encoding="utf-8") == soll, rel


def test_veraltete_datei_wird_erkannt():
    daten = vertrag()
    daten["arten"][0]["parameter"][1]["vorgabe"] = -20
    erzeugt = erzeuge_insert.erzeuge(daten)
    rel = "djk/core/signalbox/src/insert_zeilen.inc"
    assert (erzeuge_insert.WURZEL / rel).read_text(encoding="utf-8") != erzeugt[rel]


def test_zaehlung_und_tabellenzeilen():
    """The count follows the contract: rows per instance times instances (the instances come from the contract, the rows per instance are pinned: komp 10,
    eq 86 (d1..d8 x 3, dyn_attack, dyn_release since strand 5 slice 2, sc since strand 5 slice 4), saett 6 (kurve and decke since strand 5 slice 1), rack 4 macro rows (slice 4c), lim 3, host 1 (plan 1.11 T4), utility 5 (arr-fx slice 1), bk 65 (an and k1..k64, arr-bk slice 3 and the widenings), gate 8, mb 24 (strand 1 slice 4), trans 6 and bild 7 (strand 5 slice 3)); every one a table row."""
    z = erzeuge_insert.ausfalten(vertrag())
    je_instanz = {"komp": 10, "eq": 86, "saett": 6, "rack": 4, "lim": 3, "host": 1, "utility": 5, "bk": 65, "gate": 8, "mb": 24, "trans": 6, "bild": 7}   # rows per instance (pinned here)
    n = {a["art"]: a["instanzen"] for a in vertrag()["arten"]}                                               # instances (the pool sizes, from the contract)
    erwartet = {art: n[art] * je_instanz[art] for art in je_instanz}
    soll = sum(erwartet.values())
    assert len(z) == soll
    assert sum(1 for r in z if r["tabelle"]) == soll
    assert all(r["tabelle"] for r in z if r["art"] == "rack"), "every macro row is a table row (slice 4c)"
    assert {r["art"]: sum(1 for q in z if q["art"] == r["art"]) for r in z} == erwartet
    assert max(len(r["pfad"]) for r in z) == 24   # ins/utility/8/mono_unter (20 before the utility kind), ins/bild/16/breite_mitte too (strand 5 slice 3); the three-digit slots ins/eq/160/b8/platz (19) stay shorter


def test_poolgroessen_sind_die_gemessenen():
    """The pool sizes of eq and saett come from the cost table of slice 4b T11 (docs/architecture/stand/routing-1-10.md), not from the spec's starting
    values 4 and 8. A change of either number is a decision with a new measurement: this pin goes red first.
    2026-11-06: eq 2 on Andreas' decision (lane gate 1650 us, measured quiet, routing-1-10.md section "EQ pool 2").
    2026-11-10 (arr-fx slice 2): eq 8, saett 4, lim 2 on the order of the generalprobe; the cost of the full pool is measured and reported with the change.
    2026-11-26 (pool 160): komp and eq 160 each, one of each for every channel strip at 128 tracks (the core change this pin followed).
    2026-11-27 (strand 5 slice 3): saett 32 (clippers on drum strips), the new kinds trans 32 and bild 16 (plan decisions D7 to D9)."""
    n = {a["art"]: a["instanzen"] for a in vertrag()["arten"]}
    assert n == {"komp": 160, "eq": 160, "saett": 32, "rack": 12, "lim": 8, "host": 8, "utility": 8, "bk": 8, "gate": 16, "mb": 8, "trans": 32, "bild": 16}
    assert all(a["tabelle"] for a in vertrag()["arten"] if a["art"] in ("komp", "eq", "saett"))


def test_zu_langer_pfad_wird_abgelehnt():
    daten = vertrag()
    daten["arten"][0]["parameter"][1]["name"] = "schwelle" + "x" * 12   # ins/komp/12/ + 20 characters = 31 + 1
    with pytest.raises(ValueError, match="at most 31"):
        erzeuge_insert.erzeuge(daten)


def test_doppelter_pfad_wird_abgelehnt():
    daten = vertrag()
    daten["arten"][0]["parameter"][2]["name"] = "schwelle"
    with pytest.raises(ValueError, match="duplicate"):
        erzeuge_insert.erzeuge(daten)


def test_bereiche_gleich_geraete_ts():
    ts = erzeuge_insert.GERAETE_TS.read_text(encoding="utf-8")
    assert erzeuge_insert.pruefe_geraete(vertrag(), ts) == []


def test_bereich_gegen_geraete_ts_ist_rot_bei_abweichung():
    daten = copy.deepcopy(vertrag())
    daten["arten"][0]["parameter"][1]["max"] = 6          # komp schwelle 0 -> 6
    daten["arten"][1]["gruppen"][0]["parameter"][4]["max"] = 20   # eq q 18 -> 20
    fehler = erzeuge_insert.pruefe_geraete(daten, erzeuge_insert.GERAETE_TS.read_text(encoding="utf-8"))
    assert any("komp/schwelle" in f for f in fehler)
    assert any("eq/q" in f for f in fehler)


def test_unbekannte_plugin_id_ist_rot():
    daten = copy.deepcopy(vertrag())
    daten["arten"][0]["parameter"][1]["geraet"] = "thresh_gibt_es_nicht"
    fehler = erzeuge_insert.pruefe_geraete(daten, erzeuge_insert.GERAETE_TS.read_text(encoding="utf-8"))
    assert any("thresh_gibt_es_nicht" in f for f in fehler)
