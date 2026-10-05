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


def test_36_schluessel_am_text():
    assert len(vertragstext.konfig_schluessel(vertragstext.lies())) == 36  # 34 + filter_guete (A27) + hand_osc (35 B-O)


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
