"""D1 K2b (Spec 6.13): djk-klang kennt die Gruppe arr1 (Produktions-Slot 1, Surge aus djk-instrumente --arr1); 1.9 T3.4: und arr2."""
import importlib.machinery
import importlib.util
from pathlib import Path

import pytest

_P = Path(__file__).resolve().parent.parent / "djk-klang"
_L = importlib.machinery.SourceFileLoader("djk_klang", str(_P))
dk = importlib.util.module_from_spec(importlib.util.spec_from_loader("djk_klang", _L))
_L.exec_module(dk)


def test_arr1_spricht_den_socket_des_produktions_slots(monkeypatch, tmp_path):
    """D1 K2b (Spec 6.13): djk-klang kennt arr1; laden und hoeren gehen an wirt-arr1.sock der Instanz, Vorgabe-Note 60."""
    gesendet = []

    def falsch_rufe(sock, befehl):
        gesendet.append((sock, befehl))
        return {"ok": True, "name": "Lead"}

    monkeypatch.setattr(dk, "rufe", falsch_rufe)
    monkeypatch.setattr(dk, "EIGENE", tmp_path)
    (tmp_path / "lead.fxp").write_bytes(b"x")
    assert dk.main(["--instanz", "f", "arr1", "lade", "lead"]) == 0
    assert gesendet[-1] == ("/dev/shm/cypherdj-f/wirt-arr1.sock", {"befehl": "lade", "pfad": str((tmp_path / "lead.fxp").resolve())})
    assert dk.main(["--instanz", "f", "arr1", "hoere"]) == 0
    assert gesendet[-1][1] == {"befehl": "note", "note": 60, "velocity": 100, "dauer": 1.0}
    # Negativ-Kontrolle: bass bleibt auf seinem Socket, eine unbekannte Gruppe sendet nichts
    assert dk.main(["--instanz", "f", "bass", "hoere"]) == 0
    assert gesendet[-1] == ("/dev/shm/cypherdj-f/wirt-bass.sock", {"befehl": "note", "note": 36, "velocity": 100, "dauer": 1.0})
    n = len(gesendet)
    with pytest.raises(SystemExit):
        dk.main(["--instanz", "f", "arr3", "hoere"])
    assert len(gesendet) == n


def test_arr2_spricht_den_socket_des_zweiten_produktions_slots(monkeypatch, tmp_path):
    """1.9 (L10, T3.4): djk-klang kennt arr2; laden, hoeren und zeige gehen an wirt-arr2.sock der Instanz, Vorgabe-Note 60; arr1 bleibt auf seinem Socket."""
    gesendet = []

    def falsch_rufe(sock, befehl):
        gesendet.append((sock, befehl))
        return {"ok": True, "name": "Pad", "xml": "<patch/>"}

    monkeypatch.setattr(dk, "rufe", falsch_rufe)
    monkeypatch.setattr(dk, "EIGENE", tmp_path)
    (tmp_path / "pad.fxp").write_bytes(b"x")
    assert dk.main(["--instanz", "f", "arr2", "lade", "pad"]) == 0
    assert gesendet[-1] == ("/dev/shm/cypherdj-f/wirt-arr2.sock", {"befehl": "lade", "pfad": str((tmp_path / "pad.fxp").resolve())})
    assert dk.main(["--instanz", "f", "arr2", "hoere"]) == 0
    assert gesendet[-1] == ("/dev/shm/cypherdj-f/wirt-arr2.sock", {"befehl": "note", "note": 60, "velocity": 100, "dauer": 1.0})
    assert dk.main(["--instanz", "f", "arr2", "hoere", "72", "2"]) == 0
    assert gesendet[-1][1] == {"befehl": "note", "note": 72, "velocity": 100, "dauer": 2.0}
    # Negativ-Kontrolle: arr1 bleibt auf wirt-arr1.sock, ohne Instanz fehlt das Suffix wie bei den anderen Gruppen
    assert dk.main(["--instanz", "f", "arr1", "hoere"]) == 0
    assert gesendet[-1][0] == "/dev/shm/cypherdj-f/wirt-arr1.sock"
    monkeypatch.delenv("CYPHERDJ_INSTANZ", raising=False)
    assert dk.main(["arr2", "hoere"]) == 0
    assert gesendet[-1][0] == "/dev/shm/cypherdj/wirt-arr2.sock"


def test_arr2_steht_im_hilfetext_und_im_aufrufmuster():
    assert "arr2" in dk.__doc__ and "djk-instrumente --arr2" in dk.__doc__
    assert dk.GRUPPEN["arr2"] == 60 and dk.GRUPPEN["arr1"] == 60
