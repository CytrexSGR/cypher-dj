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
    """Slice 4b T12: the pools of eq and saett are the measured sizes (T11), so the count follows the contract: rows per instance times instances.
    komp 12 x 10, eq 2 x 59 (pool 2 since 2026-11-06), saett 1 x 4 are table rows (242), and since slice 4c the rack 12 x 4 macro rows too (48): 290;
    the master limiter lim 1 x 3 adds 3: 293."""
    z = erzeuge_insert.ausfalten(vertrag())
    assert len(z) == 120 + 2 * 59 + 4 + 48 + 3
    assert sum(1 for r in z if r["tabelle"]) == 242 + 48 + 3
    assert all(r["tabelle"] for r in z if r["art"] == "rack"), "every macro row is a table row (slice 4c)"
    assert {r["art"]: sum(1 for q in z if q["art"] == r["art"]) for r in z} == {"komp": 120, "eq": 118, "saett": 4, "rack": 48, "lim": 3}
    assert max(len(r["pfad"]) for r in z) == 20


def test_poolgroessen_sind_die_gemessenen():
    """The pool sizes of eq and saett come from the cost table of slice 4b T11 (docs/architecture/stand/routing-1-10.md), not from the spec's starting
    values 4 and 8. A change of either number is a decision with a new measurement: this pin goes red first.
    2026-11-06: eq 2 on Andreas' decision (lane gate 1650 us, measured quiet, routing-1-10.md section "EQ pool 2")."""
    n = {a["art"]: a["instanzen"] for a in vertrag()["arten"]}
    assert n == {"komp": 12, "eq": 2, "saett": 1, "rack": 12, "lim": 1}
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
