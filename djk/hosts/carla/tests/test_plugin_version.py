"""plugin_scan.version_von(): the plugin version from the bundle files, and the index version (browser plan 6 task 8)."""
import json
from pathlib import Path

import plugin_scan


def vst3(wurzel, name, inhalt):
    b = Path(wurzel) / f"{name}.vst3"
    (b / "Contents" / "Resources").mkdir(parents=True)
    if inhalt is not None:
        (b / "Contents" / "Resources" / "moduleinfo.json").write_text(inhalt)
    return str(b)


def lv2(wurzel, name, ttl):
    b = Path(wurzel) / f"{name}.lv2"
    b.mkdir()
    (b / "manifest.ttl").write_text("@prefix lv2: <http://lv2plug.in/ns/lv2core#> .\n")
    if ttl is not None:
        (b / "plugin.ttl").write_text(ttl)
    return str(b)


def test_vst3_version_aus_moduleinfo(tmp_path):
    b = vst3(tmp_path, "x", json.dumps({"Name": "x", "Version": "1.4.2"}))
    assert plugin_scan.version_von(b, "vst3") == "1.4.2"


def test_vst3_moduleinfo_mit_kommentaren(tmp_path):
    b = vst3(tmp_path, "c", '// generated\n{ /* the module */ "Name": "c", "Version": "2.0.1" }\n')
    assert plugin_scan.version_von(b, "vst3") == "2.0.1"


def test_lv2_version_aus_ttl(tmp_path):
    b = lv2(tmp_path, "y", "<urn:y> a lv2:Plugin ;\n    lv2:minorVersion 2 ;\n    lv2:microVersion 7 .\n")
    assert plugin_scan.version_von(b, "lv2") == "2.7"


def test_fehlende_oder_kaputte_dateien_geben_leer(tmp_path):
    assert plugin_scan.version_von(vst3(tmp_path, "a", None), "vst3") == ""
    assert plugin_scan.version_von(vst3(tmp_path, "b", "{ not json"), "vst3") == ""
    assert plugin_scan.version_von(vst3(tmp_path, "d", json.dumps({"Name": "d"})), "vst3") == ""
    assert plugin_scan.version_von(vst3(tmp_path, "e", json.dumps({"Version": 3})), "vst3") == ""
    assert plugin_scan.version_von(lv2(tmp_path, "f", None), "lv2") == ""
    assert plugin_scan.version_von(lv2(tmp_path, "g", "lv2:minorVersion 2 .\n"), "lv2") == ""
    assert plugin_scan.version_von(str(tmp_path / "nope.vst3"), "vst3") == ""
    assert plugin_scan.version_von(str(tmp_path / "nope.lv2"), "lv2") == ""
    assert plugin_scan.version_von(str(tmp_path), "other") == ""


def test_index_version_ist_3_und_ein_alter_index_wird_verworfen(tmp_path):
    assert plugin_scan.VERSION == 3
    alt = tmp_path / "index.json"
    alt.write_text(json.dumps({"version": 1, "eintraege": [{"id": "x", "buendel": "/a"}], "uebersprungen": []}))
    d = plugin_scan.lade_index(str(alt))
    assert d["version"] == 3 and d["eintraege"] == []
    neu = tmp_path / "neu.json"
    neu.write_text(json.dumps({"version": 3, "eintraege": [{"id": "x"}], "uebersprungen": []}))
    assert plugin_scan.lade_index(str(neu))["eintraege"] == [{"id": "x"}]


def test_scanne_schreibt_die_version_auch_fuer_blockierte_eintraege(tmp_path, monkeypatch):
    b = vst3(tmp_path, "blk", json.dumps({"Version": "9.9.9"}))
    monkeypatch.setattr(plugin_scan, "pruefe_discovery", lambda: {"pfad": "/x", "groesse": 1})
    monkeypatch.setattr(plugin_scan, "entdecke", lambda format_, pfad: ([], "abgestuerzt"))
    index = tmp_path / "index.json"
    plugin_scan.scanne([str(tmp_path)], str(index))
    es = json.loads(index.read_text())["eintraege"]
    assert len(es) == 1 and es[0]["status"] == "blockiert" and es[0]["version"] == "9.9.9" and es[0]["pfad"] == b
