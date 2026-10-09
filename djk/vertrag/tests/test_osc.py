"""Tests für pruefe_osc.py (osc.json gegen den Vertragstext)."""
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_osc  # noqa: E402
import vertragstext  # noqa: E402

OSC = HIER / "osc.json"


def test_unveraenderte_datei_ist_gruen():
    assert pruefe_osc.pruefe(vertragstext.VERTRAG, OSC, False) == []


def test_verfaelschte_typen_in_json_ist_rot(tmp_path):
    falsch = tmp_path / "osc.json"
    falsch.write_text(OSC.read_text(encoding="utf-8").replace('",hssisddfiiss"', '",hssisddfiis"'), encoding="utf-8")
    fehler = pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False)
    assert any(f.startswith("/k/teil: Typ-Zeichenkette Text ,hssisddfiiss") for f in fehler)


def test_verfaelschte_typen_im_text_ist_rot(tmp_path):
    falsch = tmp_path / "SCHNITTSTELLEN.md"
    falsch.write_text(vertragstext.lies().replace("`/k/teil ,hssisddfiiss`", "`/k/teil ,hssisddfiis`"), encoding="utf-8")
    fehler = pruefe_osc.pruefe(falsch, OSC, False)
    assert any(f.startswith("/k/teil: Typ-Zeichenkette Text ,hssisddfiis ") for f in fehler)


def test_text_ohne_z1_ist_rot(tmp_path):
    falsch = tmp_path / "SCHNITTSTELLEN.md"
    falsch.write_text("\n".join(z for z in vertragstext.lies().split("\n") if "`/test/klick ,hssi`" not in z),
                      encoding="utf-8")
    fehler = pruefe_osc.pruefe(falsch, OSC, False)
    n = len(json.loads(OSC.read_text(encoding="utf-8"))["adressen"])
    assert f"Anzahl ungleich: Text {n - 1}, osc.json {n}" in fehler
    assert "/test/klick steht in osc.json, fehlt im Text" in fehler


def test_falscher_feldname_ist_rot(tmp_path):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    next(e for e in daten["adressen"] if e["adresse"] == "/k/tempo/rampe")["felder"][3]["name"] = "zielbpm"
    falsch = tmp_path / "osc.json"
    falsch.write_text(json.dumps(daten), encoding="utf-8")
    assert any(f.startswith("/k/tempo/rampe: Felder Text") for f in pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False))


def test_unbekannte_einheit_ist_rot(tmp_path):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    daten["adressen"][0]["felder"][1]["einheit"] = "hertz"
    falsch = tmp_path / "osc.json"
    falsch.write_text(json.dumps(daten), encoding="utf-8")
    assert "/k/hallo.port: Einheit 'hertz' unbekannt" in pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False)
