"""Tests des Folgen-Läufers der Scheibe 25 (lauf25.py, dünne Ableitung des Läufers aus 08) gegen den Schein-Kern aus
Scheibe 08 (djk/kern/tests/leitstand/fake_kern.py), in Echtzeit, ohne Ton. Nur was 25 ergänzt (Plan 25, Nachtrag D):
1. Bereiche: Zeilen der Bereiche, die der Kern aus 25 nicht baut (hier deck), werden übersprungen und gezählt;
   Gegenprobe mit --bereiche zeitachse,regler,deck: dieselbe Folge rot, 0 übersprungen.
2. kern_kill9 ohne --unit: rot, der Grund nennt --unit.
3. kern_kill9 über den MainPID einer Unit, die nicht läuft: rot mit „kein MainPID“ (der Weg mit laufender Unit wird am
   Ziel gezeigt, Folge neustart).
Aufruf: python3 -m pytest -q djk/kern/tests/ziel/test_lauf25.py"""
import json
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
sys.path.insert(0, str(HIER.parent / "leitstand"))
import lauf25  # noqa: E402
from fake_kern import FakeKern  # noqa: E402
from test_attrappe_leitstand import folge, rampen_folge  # noqa: E402

DECK = [
    {"t": "sende", "sample": 9600, "osc": ["/k/deck/laden", ",hsisdii", 3, "leitstand", 2, "f0000000000000b2",
                                           128.0, 1, 0], "bereich": "deck"},
    {"t": "erwarte", "bis_sample": 57600, "osc": ["/q", ",hsihds", 3, "leitstand", 1, None, None, ""],
     "bereich": "deck"},
]
KILL = {"t": "aktion", "sample": 48000, "was": "kern_kill9", "bereich": "pruefstand"}


def fahre(kern, pfad, tmp_path, *extra):
    bericht = tmp_path / "bericht.json"
    rc = lauf25.main([pfad, "--kern-port", str(kern.port), "--port", "0", "--bericht", str(bericht), *extra])
    return rc, json.loads(bericht.read_text(encoding="utf-8")) if bericht.exists() else []


@pytest.fixture
def port_frei(monkeypatch):
    monkeypatch.delenv("CYPHERDJ_INSTANZ", raising=False)


def test_fremde_bereiche_uebersprungen(tmp_path, port_frei):
    zeilen = rampen_folge()[:3] + DECK + rampen_folge()[3:]
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, zeilen), tmp_path)
    assert rc == 0, b
    assert b[0]["uebersprungen"] == 2
    with FakeKern() as k:  # Gegenprobe: mit Bereich deck fährt er die Zeilen und wird rot
        rc2, b2 = fahre(k, folge(tmp_path, zeilen, "mit"), tmp_path, "--bereiche", "zeitachse,regler,deck")
    assert rc2 == 1 and b2[0]["uebersprungen"] == 0


def test_kill9_ohne_unit(tmp_path, port_frei):
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge()[:2] + [KILL]), tmp_path)
    assert rc == 1
    rot = [s for s in b[0]["schritte"] if not s["ok"]]
    assert rot and "--unit" in rot[0]["info"], rot


def test_kill9_unit_ohne_mainpid(tmp_path, port_frei):
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge()[:2] + [KILL]), tmp_path,
                      "--unit", "cypherdj-kern-gibt-es-nicht-25")
    assert rc == 1
    rot = [s for s in b[0]["schritte"] if not s["ok"]]
    assert rot and "kein MainPID" in rot[0]["info"], rot
