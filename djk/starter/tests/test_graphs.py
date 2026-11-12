import os
import subprocess
import sys
from pathlib import Path

import pytest

from starter import graphs as graphen

DJK = Path(__file__).resolve().parents[2]
BEISPIELE = DJK / "instruments" / "modular_dsp" / "demos"


def quellen() -> list[Path]:
    return graphen.quellen_der_beispiele(DJK)


def test_quellen_ohne_manifest():
    q = quellen()
    assert len(q) == 124
    assert "MANIFEST.json" not in {p.name for p in q}
    assert len({p.name for p in q}) == 124


def test_leerer_ordner_bekommt_alle_graphen(tmp_path):
    ziel = tmp_path / "bk"
    r = graphen.installiere_graphen(quellen(), ziel)
    assert len(r["neu"]) == 124 and r["behalten"] == [] and r["uebersprungen"] == []
    for q in quellen():
        assert (ziel / q.name).read_bytes() == q.read_bytes()
    assert not [p for p in ziel.iterdir() if p.suffix != ".json"], "no temp leftovers"


def test_geaenderter_graph_bleibt_und_zweiter_lauf_ist_leer(tmp_path):
    ziel = tmp_path / "bk"
    graphen.installiere_graphen(quellen(), ziel)
    (ziel / "drums-909.json").write_text('{"vom":"nutzer"}')
    r = graphen.installiere_graphen(quellen(), ziel)
    assert r["neu"] == []
    assert len(r["behalten"]) == 124 and "drums-909" in r["behalten"]
    assert (ziel / "drums-909.json").read_text() == '{"vom":"nutzer"}'


def test_unzulaessiger_name_wird_uebersprungen(tmp_path):
    quelle = tmp_path / "source"
    quelle.mkdir()
    (quelle / "Bad Name.json").write_text("{}")
    (quelle / "gut.json").write_text("{}")
    (quelle / "MANIFEST.json").write_text("{}")
    ziel = tmp_path / "bk"
    r = graphen.installiere_graphen([quelle / "Bad Name.json", quelle / "gut.json", quelle / "MANIFEST.json"], ziel)
    assert r["neu"] == ["gut"]
    assert "Bad Name" in r["uebersprungen"]
    assert not (ziel / "Bad Name.json").exists() and not (ziel / "MANIFEST.json").exists()


def test_ordner_folgt_bk_ordner(tmp_path, monkeypatch):
    assert graphen.graphen_ordner() == Path.home() / ".config" / "cypherdj" / "baukasten"
    monkeypatch.setenv("CYPHERDJ_BK_ORDNER", str(tmp_path / "x"))
    assert graphen.graphen_ordner() == tmp_path / "x"


def test_proben_nur_wenn_fehlend(tmp_path, monkeypatch):
    """The sample generator is not even looked up when all three files exist (second run needs no cargo)."""
    from starter import tools as werkzeuge
    ziel = tmp_path / "bk"
    (ziel / "samples").mkdir(parents=True)
    for n in ("orchester-schlag.f32", "orchester-schlag-schichten.f32", "feder-ir.f32"):
        (ziel / "samples" / n).write_bytes(b"x")

    def nie(name):
        raise AssertionError("cargo_beispiel called")
    monkeypatch.setattr(werkzeuge, "cargo_beispiel", nie)
    assert graphen.installiere_proben(ziel) == []


def test_proben_mit_attrappe_und_behalten(tmp_path, monkeypatch):
    from starter import tools as werkzeuge
    prog = tmp_path / "erzeuge_probe"
    prog.write_text("#!/bin/sh\nmkdir -p \"$1\"\nfor n in orchester-schlag orchester-schlag-schichten feder-ir; do "
                    "printf neu > \"$1/$n.f32\"; done\n")
    prog.chmod(0o755)
    monkeypatch.setattr(werkzeuge, "cargo_beispiel", lambda name: prog)
    ziel = tmp_path / "bk"
    (ziel / "samples").mkdir(parents=True)
    (ziel / "samples" / "feder-ir.f32").write_bytes(b"alt")
    neu = graphen.installiere_proben(ziel)
    assert sorted(neu) == ["orchester-schlag-schichten.f32", "orchester-schlag.f32"]
    assert (ziel / "samples" / "feder-ir.f32").read_bytes() == b"alt"
    assert (ziel / "samples" / "orchester-schlag.f32").read_bytes() == b"neu"


def test_cli_ohne_cargo_gibt_4_und_graphen_stehen(tmp_path, isoliert):
    env = dict(isoliert)
    env["PATH"] = "/usr/bin:/bin"
    env["CARGO_TARGET_DIR"] = str(tmp_path / "leer-ziel")
    env["CYPHERDJ_PYTHON"] = sys.executable
    assert not any(Path(d, "cargo").exists() for d in env["PATH"].split(":"))
    r = subprocess.run([str(DJK / "start" / "djk-starter"), "--nur", "graphen"], env=env, capture_output=True,
                       text=True)
    assert r.returncode == 4, r.stdout + r.stderr
    assert ("cargo not usable: kits, loops and graph samples need the Rust toolchain (INSTALL.md section 1)"
            in r.stderr)
    ordner = Path(env["HOME"]) / ".config" / "cypherdj" / "baukasten"
    assert len(list(ordner.glob("*.json"))) == 124
    assert "installed drums-909" in r.stdout


def test_cli_aufruf_fehler_gibt_2(isoliert):
    env = dict(isoliert)
    env["CYPHERDJ_PYTHON"] = sys.executable
    r = subprocess.run([str(DJK / "start" / "djk-starter"), "--nur", "quatsch"], env=env, capture_output=True, text=True)
    assert r.returncode == 2
    r = subprocess.run([str(DJK / "start" / "djk-starter"), "--instanz", "z"], env=env, capture_output=True, text=True)
    assert r.returncode == 2
