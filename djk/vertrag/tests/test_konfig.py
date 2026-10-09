"""Tests für pruefe_konfig.py."""
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_konfig  # noqa: E402
import vertragstext  # noqa: E402

SCHEMA = json.loads((HIER / "konfig.schema.json").read_text(encoding="utf-8"))


def test_gruen():
    assert pruefe_konfig.pruefe(vertragstext.lies(), SCHEMA) == []


def schema_schluessel(schema):
    """(Datei, Schlüssel) aus konfig.schema.json, ohne die Pflichtangabe version."""
    return {(datei, k) for datei, teil in schema["$defs"].items() for k in teil["properties"] if k != "version"}


def test_schluessel_am_text_wie_im_schema():
    im_text = vertragstext.konfig_schluessel(vertragstext.lies())
    im_schema = schema_schluessel(SCHEMA)
    assert len(im_schema) > 0 and len(im_text) == len(im_schema)
    assert {(d, k) for d, k, _, _ in im_text} == im_schema


def test_falsche_vorgabe_ist_rot():
    schema = json.loads(json.dumps(SCHEMA))
    schema["$defs"]["kern.toml"]["properties"]["udp_port"]["default"] = 47101
    assert "kern.toml.udp_port: Vorgabe Text 47100, Schema 47101" in pruefe_konfig.pruefe(vertragstext.lies(), schema)


def test_fehlender_schluessel_ist_rot():
    schema = json.loads(json.dumps(SCHEMA))
    del schema["$defs"]["werkstatt.toml"]["properties"]["stimmung_max_cent"]
    assert "werkstatt.toml: stimmung_max_cent steht im Text, fehlt im Schema" in \
        pruefe_konfig.pruefe(vertragstext.lies(), schema)


def test_offenes_schema_ist_rot():
    schema = json.loads(json.dumps(SCHEMA))
    schema["$defs"]["kern.toml"]["additionalProperties"] = True
    fehler = pruefe_konfig.pruefe(vertragstext.lies(), schema)
    assert "kern.toml: unbekannter Schlüssel start_bmp wird nicht abgelehnt" in fehler
