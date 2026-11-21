"""The default regler values of attrappe_leitstand come from pult.json (container core V7): the list cannot drift from the contract."""
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import mock_conductor as al  # noqa: E402
import generate_pult as erzeuge_pult  # noqa: E402

# the families outside pult.json (written out here, not read from the module under test)
GLOBAL = {"xfader", "master/pegel", "master/kleber", "cue/mix", "cue/pegel", "cue/split", "fx/1/notenwert", "fx/2/notenwert",
          "fx/1/rueckkopplung", "fx/2/rueckkopplung", "fx/1/rueckweg", "fx/2/rueckweg", "fx/3/rueckweg", "fx/4/rueckweg",
          "duck/tiefe", "duck/release", "color/art", "color/param", "spektrum/kanal"}


def _pult_pfade():
    d = erzeuge_pult.laden()
    alle = {p for f in erzeuge_pult.FAMILIEN for p in erzeuge_pult.regler_pfade(d, f)}
    return {p for p in alle if not p.endswith("/transport")}


def test_vorgaben_ohne_entfernte_kanaele():
    assert not [p for p in al.VORGABE if p.startswith("erz/")]
    assert "deck/3/fader" not in al.VORGABE and "deck/4/fader" not in al.VORGABE
    assert "pad/2/gate/sc" in al.VORGABE
    assert al.VORGABE["pad/2/gate/sc"] == 0.0


def test_vorgaben_gleich_pult_plus_globale_zeilen():
    assert set(al.VORGABE) == _pult_pfade() | GLOBAL


def test_vorgaben_werte_je_zeile():
    v = al.VORGABE
    assert v["deck/1/fader"] == -200.0 and v["bus/1/trim"] == 0.0 and v["pad/1/ziel"] == 0.0
    assert v["deck/2/bk/1"] == 0.5 and v["strom/16/bk/64"] == 0.5
    assert v["bus/2/lim/decke"] == -0.3 and v["deck/1/komp/schwelle"] == -18.0 and v["pad/2/util/breite"] == 100.0
    assert v["deck/3/stem/drums"] == 0.0 and v["deck/4/stem/other"] == 0.0
