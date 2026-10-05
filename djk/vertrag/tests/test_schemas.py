"""Schemas gegen die Beispiele im Vertragstext: grün am echten Text, rot bei jeder der Mutationen unten."""
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_schemas as ps  # noqa: E402
import schema_lader as sl  # noqa: E402
import vertragstext  # noqa: E402

TEXT = vertragstext.lies()


def _pruefe(text):
    return ps.pruefe(text, ps.lade_zuordnung(), ps.lade_kuratiert())


def test_echter_text_ist_gruen_und_zaehlt_15_abnahmebeispiele():
    fehler, zahl = _pruefe(TEXT)
    assert fehler == []
    assert zahl["abnahme_text"] == 15 and zahl["abnahme_gueltig"] == 15
    assert zahl["pflicht_proben"] > 200


def test_beispiel_ohne_pflichtfeld_im_text_ist_rot():
    alt = '"baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"urteil":"ok","gruende":[]}'
    assert TEXT.count(alt) == 1
    fehler, _ = _pruefe(TEXT.replace(alt, '"baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"gruende":[]}'))
    assert any(f.startswith("14.5#1 (Variante 0) gegen hoerschein.schema.json: 'urteil' is a required property")
               for f in fehler), fehler


def test_neues_beispiel_ohne_zuordnung_ist_rot():
    anker = "### 14.4 Spielart"
    fehler, _ = _pruefe(TEXT.replace(anker, '`{"id":"v6","plan_id":"p18"}`\n\n' + anker, 1))
    assert "14.3#2: Beispiel im Text ohne Zuordnung: '{\"id\":\"v6\",\"plan_id\":\"p18\"}'" in fehler


def test_geaenderter_beispielanfang_ist_rot():
    fehler, _ = _pruefe(TEXT.replace('{"id":"u3","art":"gut|daneben|ab"', '{"id":"u3","art":"gut|daneben|weg"', 1))
    assert any(f.startswith("14.9#1: Text geändert") for f in fehler), fehler


def test_ohne_pflichtfeld_wird_jedes_schema_abgelehnt():
    v = sl.validator("wahl.schema.json")
    wahl = {"id": "w9", "von": "cypher", "material_id": "3fa1c09b2e7d4410", "spielart": "sicher", "start_takt": 113,
            "hoerschein": "h12", "einstieg_quell_beat": 64.0, "deck": 2}
    assert v.is_valid(wahl)
    for feld in wahl:
        kaputt = {k: w for k, w in wahl.items() if k != feld}
        assert not v.is_valid(kaputt), feld


def test_unbekanntes_zusatzfeld_ist_erlaubt():
    """§ Regeln für Änderungen: JSON-Nachrichten dürfen neue optionale Felder bekommen."""
    wahl = {"id": "w9", "von": "cypher", "material_id": "3fa1c09b2e7d4410", "spielart": "sicher", "start_takt": 113,
            "hoerschein": "h12", "einstieg_quell_beat": 64.0, "deck": 2, "neu_in_version_1_1": True}
    assert sl.validator("wahl.schema.json").is_valid(wahl)
