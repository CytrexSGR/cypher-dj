"""Tests für erzeuge_osc.py und den Vergleich der erzeugten Dateien in pruefe_osc.py."""
import json
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import erzeuge_osc  # noqa: E402
import pruefe_osc  # noqa: E402
import vertragstext  # noqa: E402

OSC = HIER / "osc.json"


def test_erzeugte_dateien_sind_aktuell():
    assert pruefe_osc.pruefe(vertragstext.VERTRAG, OSC, True) == []


def test_veraltete_dateien_sind_rot(tmp_path):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    daten["adressen"][0]["felder"][1]["bereich"] = [1024, 65535]
    falsch = tmp_path / "osc.json"
    falsch.write_text(json.dumps(daten), encoding="utf-8")
    fehler = pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, True)
    assert "osc_adressen.h ist nicht aktuell: python3 djk/vertrag/erzeuge_osc.py" in fehler
    assert "osc_adressen.ts ist nicht aktuell: python3 djk/vertrag/erzeuge_osc.py" in fehler


def test_schluesselwort_als_feldname_wird_abgelehnt():
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    daten["adressen"][0]["felder"][0]["name"] = "delete"
    with pytest.raises(ValueError, match="taugt nicht als Bezeichner"):
        erzeuge_osc.erzeuge(daten)


def test_bezeichner_sind_eindeutig_und_vollstaendig():
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    namen = [erzeuge_osc.bezeichner(e["adresse"]) for e in daten["adressen"]]
    assert len(set(namen)) == 69 and "k_loop_rec" in namen and "e_mitschnitt" in namen and "k_loop_laden" in namen and "e_loop" in namen and "k_deck_hotcue_setzen" in namen and "q_stand" in namen


# Scheibe 3 (Resampling, E1 in Form des Plan-Reviews Q2): /erz/ev trägt nach den festen Feldern einen optionalen
# Schwanz aus Paaren (nr, wert). Der Vertrag beschreibt ihn einmal; neue Parameter sind neue Codes, kein neuer Typ.
def test_schwanz_von_erz_ev_steht_in_beiden_erzeugten_dateien():
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    ev = next(e for e in daten["adressen"] if e["adresse"] == "/erz/ev")
    assert ev["typen"] == ",iiiiddf" and ev["schwanz"]["typen"] == "if"
    dateien = erzeuge_osc.erzeuge(daten)
    assert 'inline constexpr std::string_view erz_ev = "if";' in dateien["osc_adressen.h"]
    assert "enum class ErzParameter : std::int32_t { begin = 0, end = 1 };" in dateien["osc_adressen.h"]
    assert "schwanz: 'if'" in dateien["osc_adressen.ts"]
    assert "export const ERZ_PARAMETER = { begin: 0, end: 1 } as const;" in dateien["osc_adressen.ts"]


def test_schwanz_mit_falschem_typ_ist_rot(tmp_path):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    ev = next(e for e in daten["adressen"] if e["adresse"] == "/erz/ev")
    ev["schwanz"]["typen"] = "ix"
    falsch = tmp_path / "osc.json"
    falsch.write_text(json.dumps(daten), encoding="utf-8")
    fehler = pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False)
    assert "/erz/ev: ungültiger Schwanz ix" in fehler
