"""Fixtures der Golden-Folgen (folgen/material/): JSON gültig gegen material.schema.json und fassung.schema.json und
gleich dem, was erzeuge_material.py daraus rechnet; Audiodaten deterministisch (sha256 und Größe frames·2·4 wie in
fassung.json, §13.2); ein verfälschtes Feld und eine falsche Prüfsumme fallen auf."""
import copy
import json
import pathlib
import shutil
import sys

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import erzeuge_material as em  # noqa: E402
import schema_lader as sl  # noqa: E402


def _lies(mid):
    o = em.FIXTURES / mid
    return (json.loads((o / "material.json").read_text(encoding="utf-8")),
            json.loads((o / "fassungen" / "128000_r1" / "fassung.json").read_text(encoding="utf-8")))


def test_jede_fixture_ist_gueltig_und_hergeleitet():
    vm, vf = sl.validator("material.schema.json"), sl.validator("fassung.schema.json")
    for mid in em.SPEC:
        m, f = _lies(mid)
        assert [e.message for e in vm.iter_errors(m)] == [] and [e.message for e in vf.iter_errors(f)] == [], mid
        assert m == em.material_json(mid) and f == em.fassung_json(mid), f"{mid}: JSON weicht von erzeuge_material ab"


def test_trim_zahlen_der_fixtures():
    """Die Folgen rechnen mit Trim = ziel_lufs − lufs_integriert (§1.5): 0 dB außer c3 (−6,6) und d4 (+24 begrenzt)."""
    assert {mid: em.SPEC[mid][1] for mid in em.SPEC} == {
        "f0000000000000a1": -16.0, "f0000000000000b2": -16.0, "f0000000000000c3": -9.4, "f0000000000000d4": -45.0,
        "f0000000000000e5": -16.0, "f000000000000096": -16.0, "f000000000000128": -16.0}


def test_ohne_pflichtfeld_oder_mit_falscher_analyse_quelle_ungueltig():
    _, f = _lies("f0000000000000b2")
    vf = sl.validator("fassung.schema.json")
    ohne = copy.deepcopy(f)
    del ohne["sha256"]
    assert not vf.is_valid(ohne)
    assert not vf.is_valid(dict(f, analyse_quelle="stems"))       # §13.1: ohne Stems immer basis


def test_ziel_schreibt_dateien_mit_richtiger_pruefsumme(tmp_path):
    assert em.schreibe_ziel(tmp_path) == 0
    o = tmp_path / "f0000000000000e5" / "fassungen" / "128000_r1"
    f = json.loads((o / "fassung.json").read_text(encoding="utf-8"))
    assert (o / "basis.f32").stat().st_size == f["frames"] * 2 * 4 == 32 * 22500 * 8
    assert [(o / s["datei"]).stat().st_size for s in f["schuesse"]] == [4800 * 8, 4800 * 8]


def test_falsche_pruefsumme_wird_gemeldet(tmp_path, monkeypatch, capsys):
    kopie = tmp_path / "fixtures"
    shutil.copytree(em.FIXTURES, kopie)
    p = kopie / "f0000000000000b2" / "fassungen" / "128000_r1" / "fassung.json"
    f = json.loads(p.read_text(encoding="utf-8"))
    f["sha256"] = "0" * 64
    p.write_text(json.dumps(f), encoding="utf-8")
    monkeypatch.setattr(em, "FIXTURES", kopie)
    assert em.schreibe_ziel(tmp_path / "ziel") == 1
    assert "FEHLER f0000000000000b2/basis.f32: sha256 weicht von fassung.json ab" in capsys.readouterr().out
