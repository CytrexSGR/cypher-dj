import importlib.machinery
import importlib.util
from pathlib import Path

import pytest

_P = Path(__file__).resolve().parent.parent / "djk-klang"
_L = importlib.machinery.SourceFileLoader("djk_klang", str(_P))
dk = importlib.util.module_from_spec(importlib.util.spec_from_loader("djk_klang", _L))
_L.exec_module(dk)


def test_finde_klang_eigene_vor_werk_und_pfad(tmp_path):
    eigene, werk = tmp_path / "e", tmp_path / "w"
    (werk / "Basses").mkdir(parents=True)
    eigene.mkdir()
    (eigene / "tief.fxp").write_bytes(b"e")
    (werk / "tief.fxp").write_bytes(b"w2")
    (werk / "Basses" / "Acid Bass.fxp").write_bytes(b"w")
    assert dk.finde_klang("tief", eigene, werk) == eigene / "tief.fxp"
    assert dk.finde_klang("Basses/Acid Bass", eigene, werk) == werk / "Basses" / "Acid Bass.fxp"
    assert dk.finde_klang(str(werk / "tief.fxp"), eigene, werk) == werk / "tief.fxp"
    with pytest.raises(FileNotFoundError):
        dk.finde_klang("nix", eigene, werk)


def test_speichere_archiviert_statt_zu_ueberschreiben(tmp_path):
    assert dk.speichere(tmp_path, "tief", b"eins", "T1").read_bytes() == b"eins"
    dk.speichere(tmp_path, "tief", b"zwei", "T2")
    assert (tmp_path / "tief.fxp").read_bytes() == b"zwei"
    assert (tmp_path / ".alt" / "tief-T2.fxp").read_bytes() == b"eins"
    for schlecht in ("../weg", ".versteckt", "a/b", ""):
        with pytest.raises(ValueError):
            dk.speichere(tmp_path, schlecht, b"x", "T3")


def test_liste_filtert_ohne_gross_klein(tmp_path):
    eigene, werk = tmp_path / "e", tmp_path / "w"
    (werk / "Basses").mkdir(parents=True)
    (werk / "Leads").mkdir()
    eigene.mkdir()
    (eigene / "tiefbass.fxp").write_bytes(b"")
    (werk / "Basses" / "Acid Bass.fxp").write_bytes(b"")
    (werk / "Leads" / "Saw Lead.fxp").write_bytes(b"")
    assert dk.liste(eigene, werk, "bass") == [("own", "tiefbass"), ("factory", "Basses/Acid Bass")]
    assert dk.liste(eigene, tmp_path / "fehlt", "") == [("own", "tiefbass")]


def test_zuweisungen_parsen():
    assert dk.zuweisungen(["a_filter1_cutoff=-30.0", "a_filter1_type.deactivated=0"]) == \
        {"a_filter1_cutoff": "-30.0", "a_filter1_type.deactivated": "0"}
    with pytest.raises(ValueError):
        dk.zuweisungen(["ohne_gleich"])


def test_liste_mit_kaputtem_regex_wirft_valueerror(tmp_path):
    with pytest.raises(ValueError):
        dk.liste(tmp_path, tmp_path, "[")


def test_rufe_ohne_wirt_und_bei_timeout_sauberer_exit(tmp_path, monkeypatch):
    with pytest.raises(SystemExit) as e:
        dk.rufe(str(tmp_path / "fehlt.sock"), {"befehl": "zustand"})
    assert "not running" in str(e.value)

    def zu_langsam(*a, **k):
        raise TimeoutError("timed out")
    monkeypatch.setattr(dk, "sende", zu_langsam)
    with pytest.raises(SystemExit) as e:
        dk.rufe("x", {"befehl": "zustand"})
    assert "no answer" in str(e.value)


def test_aufteilen_setze_nach_fahrbar():
    bereiche = {"a_filter1_cutoff": {}, "a_filter1_resonance": {}}
    fahr, rest = dk.aufteilen({"a_filter1_cutoff": "-30", "a_filter1_type": "2", "a_filter1_resonance.x": "1"}, bereiche)
    assert fahr == {"a_filter1_cutoff": "-30"}
    assert rest == {"a_filter1_type": "2", "a_filter1_resonance.x": "1"}


def test_dauer_parsen():
    assert dk.dauer("16") == 16.0 and dk.dauer("16s") == 16.0 and dk.dauer("0") == 0.0
    with pytest.raises(ValueError):
        dk.dauer("lang")


def test_bass_param_und_params_senden_die_wirtbefehle(monkeypatch, capsys):
    """RB-338 W1 4.2: param NAME WERT und params gehen als Wirt-Befehle an den Socket der Instanz."""
    gesendet = []

    def falsch_rufe(sock, befehl):
        gesendet.append((sock, befehl))
        return {"ok": True, "params": {"Cutoff": 0.5, "Env Mod": 0.4}} if befehl["befehl"] == "params" else {"ok": True}

    monkeypatch.setattr(dk, "rufe", falsch_rufe)
    assert dk.main(["--instanz", "f", "bass", "param", "Cutoff", "0.5"]) == 0
    assert gesendet[-1] == ("/dev/shm/cypherdj-f/wirt-bass.sock", {"befehl": "param", "name": "Cutoff", "wert": 0.5})
    assert dk.main(["--instanz", "f", "bass", "param", "Env", "Mod", "0.25"]) == 0
    assert gesendet[-1][1] == {"befehl": "param", "name": "Env Mod", "wert": 0.25}
    assert dk.main(["--instanz", "f", "bass", "params"]) == 0
    assert gesendet[-1][1] == {"befehl": "params"}
    assert capsys.readouterr().out.splitlines()[-2:] == ["Cutoff = 0.5", "Env Mod = 0.4"]


def test_bass_param_ausserhalb_oder_unlesbar_sendet_nichts(monkeypatch):
    gesendet = []
    monkeypatch.setattr(dk, "rufe", lambda sock, befehl: gesendet.append(befehl) or {"ok": True})
    for schlecht in (["param", "Cutoff", "1.5"], ["param", "Cutoff", "-0.1"], ["param", "Cutoff", "laut"]):
        with pytest.raises(ValueError):
            dk.main(["--instanz", "f", "bass"] + schlecht)
    with pytest.raises(SystemExit):  # param ohne Wert: argparse-Fehler wie die anderen Unterbefehle
        dk.main(["--instanz", "f", "bass", "param", "Cutoff"])
    assert gesendet == []
