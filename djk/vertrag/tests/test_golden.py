"""pruefe_golden.py: grün über die erzeugten Folgen, rot bei jeder Mutation unten (Datei, Zeile und Feld im Befund)."""
import json
import pathlib
import shutil
import sys

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_golden as pg  # noqa: E402
import schema_lader as sl  # noqa: E402


def _kopie(tmp_path):
    ziel = tmp_path / "folgen"
    shutil.copytree(HIER / "folgen", ziel, ignore=shutil.ignore_patterns("material"))
    return ziel


def _zeilen(name):
    return [json.loads(z) for z in (HIER / "folgen" / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()]


def test_erzeugte_folgen_sind_gruen(capsys):
    assert pg.main([]) == 0
    assert "pruefe_folgen.py (02) über denselben Ordner: grün" in capsys.readouterr().out


def test_falscher_wert_wird_mit_ort_gemeldet(tmp_path, capsys):
    ordner = _kopie(tmp_path)
    p = ordner / "teil_rampe.jsonl"
    text = p.read_text(encoding="utf-8")
    assert text.count('"wert":-7.5,') == 1
    p.write_text(text.replace('"wert":-7.5,', '"wert":-7.4,'), encoding="utf-8")
    assert pg.main(["--ordner", str(ordner)]) == 1
    aus = capsys.readouterr().out
    assert "teil_rampe.jsonl Zeile " in aus
    assert "weicht von der Herleitung ab in ['wert']: {\"wert\": -7.4} statt {\"wert\": -7.5}" in aus


def test_fehlende_folge_und_fremde_datei_sind_rot(tmp_path, capsys):
    ordner = _kopie(tmp_path)
    (ordner / "zu_spaet.jsonl").unlink()
    (ordner / "neu_erfunden.jsonl").write_text((ordner / "ki_stopp.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
    assert pg.main(["--ordner", str(ordner)]) == 1
    aus = capsys.readouterr().out
    assert "FEHLER zu_spaet.jsonl fehlt" in aus and "FEHLER neu_erfunden.jsonl: Datei ohne Eintrag in INDEX.json" in aus


def test_handlung_vor_der_vorigen_ist_rot():
    zeilen = _zeilen("zu_spaet")
    sende = [i for i, z in enumerate(zeilen) if z["t"] == "sende"]
    zeilen[sende[1]], zeilen[sende[2]] = zeilen[sende[2]], zeilen[sende[1]]
    fehler = pg.pruefe_folge("zu_spaet.jsonl", zeilen, zeilen, sl.registry(), sl.validator("folge.schema.json"))
    assert any("liegt vor der vorigen Handlung" in f for f in fehler)


def test_erwarte_nicht_mit_falscher_adresse_ist_rot():
    zeilen = _zeilen("hand_gewinnt")
    z = next(z for z in zeilen if z["t"] == "erwarte_nicht")
    z["osc"][0] = "/k/teil"
    z["osc"][1] = ",hssisddfiiss"
    z["osc"][2:] = [None] * 12
    fehler = pg.pruefe_folge("hand_gewinnt.jsonl", zeilen, zeilen, sl.registry(), sl.validator("folge.schema.json"))
    assert any("/k/teil kommt nie vom Kern oder der Notbahn" in f for f in fehler)


def test_teil_rampe_traegt_die_zahlen_aus_19_3():
    werte = {(z["sample"], z["pfad"]): z["wert"] for z in _zeilen("teil_rampe") if z["t"] == "wert"}
    assert werte[(1800000, "deck/2/fader")] == -7.5
    starts = [z["osc"][5] for z in _zeilen("teil_rampe") if z["t"] == "erwarte" and z["osc"][0] == "/q" and z["osc"][4] == 2]
    assert 1440000 in starts
    ende = [z["osc"][5] for z in _zeilen("teil_rampe") if z["t"] == "erwarte" and z["osc"][0] == "/q" and z["osc"][4] == 3]
    assert 2160000 in ende
