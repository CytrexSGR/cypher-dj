"""baender.json gegen §6.2: grün für die erzeugte Datei, rot für eine verschobene Bandgrenze (Mutationsprobe)."""
import copy
import json
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import erzeuge_baender as eb  # noqa: E402
import pruefe_baender as pb  # noqa: E402
import vertragstext  # noqa: E402


def _vertrag():
    return pb.baender_aus_vertrag(vertragstext.lies())


def test_text_und_erzeuger_nennen_dieselben_grenzen():
    assert _vertrag() == [(n, lo, hi) for n, lo, hi in eb.BAENDER]


def test_erzeugte_datei_ist_gruen():
    fehler, zeilen = pb.pruefe(eb.baue(), _vertrag())
    assert fehler == [] and len(zeilen) == 7


def test_verschobene_grenze_ist_rot():
    d = eb.baue()
    d["baender"][0]["sos"] = [[float(v) for v in z] for z in eb.band_sos(33.0, 90.0)]   # sub unten 30 -> 33 Hz (+10 %)
    fehler, _ = pb.pruefe(d, _vertrag())
    assert len(fehler) == 1 and fehler[0].startswith("sub: -3-dB-Punkte 33.")


def test_knapp_innerhalb_bleibt_gruen():
    d = eb.baue()
    d["baender"][0]["sos"] = [[float(v) for v in z] for z in eb.band_sos(30.5, 90.0)]   # +1,7 %: noch in ±2 %
    assert pb.pruefe(d, _vertrag())[0] == []


def test_vertauschte_baender_sind_rot():
    d = copy.deepcopy(eb.baue())
    d["baender"][0], d["baender"][1] = d["baender"][1], d["baender"][0]
    assert any(f.startswith("Reihenfolge/Namen") for f in pb.pruefe(d, _vertrag())[0])


def test_fehlende_datei_ist_rot(tmp_path):
    assert pb.main([str(tmp_path / "gibt_es_nicht.json")]) == 1


def test_json_auf_platte_gleich_erzeuger():
    """Koeffizienten bitgleich mit dem Erzeuger (Kern, Werkstatt und Attrappe rechnen aus derselben Tabelle); nur die
    Versionsangabe in "quelle" darf nach einem scipy-Wechsel abweichen, die Zahlen nicht."""
    platte, neu = json.loads((HIER / "baender.json").read_text(encoding="utf-8")), eb.baue()
    platte.pop("quelle")
    neu.pop("quelle")
    assert platte == neu
