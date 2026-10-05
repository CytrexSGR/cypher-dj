"""Tests für erzeuge_folgen.py und pruefe_folgen.py (Format §19.0, Semantik folgen/FORMAT.md)."""
import json
import shutil
import sys
from pathlib import Path

import jsonschema

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_folgen  # noqa: E402

OSC = json.loads((HIER / "osc.json").read_text(encoding="utf-8"))
VALIDATOR = jsonschema.Draft202012Validator(json.loads((HIER / "folge.schema.json").read_text(encoding="utf-8")))


def _zeile_aendern(tmp_path, name, erkennung, neu_osc):
    zeilen = (HIER / "folgen" / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()
    i = next(k for k, z in enumerate(zeilen) if erkennung in z)
    z = json.loads(zeilen[i])
    z["osc"] = neu_osc
    zeilen[i] = json.dumps(z)
    pfad = tmp_path / f"{name}.jsonl"
    pfad.write_text("\n".join(zeilen) + "\n", encoding="utf-8")
    return pfad


def test_drei_folgen_gruen_und_aktuell():
    for name in ("uhr_golden", "storno", "protokollfehler"):
        assert pruefe_folgen.pruefe_datei(HIER / "folgen" / f"{name}.jsonl", OSC, VALIDATOR) == []
    assert pruefe_folgen.pruefe_aktuell(HIER / "folgen") == []


def test_storno_nutzt_nur_tempo_rampe_und_storno():
    adressen = {json.loads(z)["osc"][0] for z in (HIER / "folgen" / "storno.jsonl").read_text(encoding="utf-8").splitlines()
                if json.loads(z)["t"] == "sende"}
    assert adressen == {"/k/set/neu", "/k/tempo/rampe", "/k/storno"}


def test_falsche_typen_ohne_absicht_ist_rot(tmp_path):
    pfad = _zeile_aendern(tmp_path, "uhr_golden", '"/k/tempo/rampe"',
                          ["/k/tempo/rampe", ",hsdd", 2, "pruefstand", 128.0, 132.0])
    assert any("hat laut osc.json ,hsddd" in f for f in pruefe_folgen.pruefe_datei(pfad, OSC, VALIDATOR))


def test_gelogene_absicht_ist_rot(tmp_path):
    pfad = _zeile_aendern(tmp_path, "protokollfehler", '"dauer_beats fehlt"',
                          ["/k/tempo/rampe", ",hsddd", 3, "pruefstand", 64.0, 132.0, 32.0])
    assert any("absicht falsche_typen, aber" in f for f in pruefe_folgen.pruefe_datei(pfad, OSC, VALIDATOR))


def test_von_hand_geaenderte_folge_ist_rot(tmp_path):
    ordner = tmp_path / "folgen"
    shutil.copytree(HIER / "folgen", ordner)
    pfad = ordner / "uhr_golden.jsonl"
    pfad.write_text(pfad.read_text(encoding="utf-8").replace("3237188", "3237189"), encoding="utf-8")
    assert "uhr_golden.jsonl ist nicht, was erzeuge_folgen.py erzeugt (von Hand geändert oder veraltet)" \
        in pruefe_folgen.pruefe_aktuell(ordner)


def test_unbekanntes_feld_wird_ignoriert(tmp_path):
    zeilen = (HIER / "folgen" / "storno.jsonl").read_text(encoding="utf-8").splitlines()
    z = json.loads(zeilen[3])
    z["herleitung"] = "§4.2, Zusatzfeld einer späteren Scheibe"
    zeilen[3] = json.dumps(z)
    pfad = tmp_path / "storno.jsonl"
    pfad.write_text("\n".join(zeilen) + "\n", encoding="utf-8")
    assert pruefe_folgen.pruefe_datei(pfad, OSC, VALIDATOR) == []


def test_uhr_golden_unterscheidet_gerundetes_s0(tmp_path):
    """Review 2026-09-23: uhr_golden ist NICHT für beide Lesarten von s0 gleich. Der /uhr-Schritt bei
    Blockanfang 4 286 976 (vor Beat 192) liegt mit gerundetem s0 3,53e-6 Beats neben dem erwarteten Wert,
    außerhalb der Toleranz 1e-6. Ein Kern mit int64-s0 wird hier rot, auch wenn die /takt-Samples selbst
    (3 588 923 und 4 287 105) in beiden Lesarten gleich bleiben."""
    import karte
    import test_karte

    # dieselbe Konstruktion wie in erzeuge_folgen.uhr_golden(): 128 BPM, Rampe 128 -> 132 ab Beat 128 über 32 Beats
    ungerundet = karte.Karte(128.0)
    ungerundet.rampe(128.0, 132.0, 32.0)
    gerundet = test_karte.KarteMitGerundetemS0(128.0)
    gerundet.rampe(128.0, 132.0, 32.0)
    schritt_ungerundet = ungerundet.beat(4_286_976)
    schritt_gerundet = gerundet.beat(4_286_976)
    assert abs(schritt_ungerundet - 191.9940923076923) < 1e-9
    assert abs(schritt_gerundet - 191.99409583333335) < 1e-9
    assert abs(schritt_ungerundet - schritt_gerundet) > 1e-6, \
        "gerundetes s0 verfehlt die beat-Toleranz 1e-6 am /uhr-Schritt in uhr_golden"
