import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pytest

from starter import storage as ablage


def _klaenge(n=3):
    rng = np.random.default_rng(1)
    return [(36 + i, f"bd:{i}", (rng.standard_normal((100 + i, 2)) * 0.1).astype("float32")) for i in range(n)]


def test_kit_json_meets_core_rules(tmp_path):
    assert ablage.schreibe_kit(tmp_path, "starter", _klaenge()) == "neu"
    kit = tmp_path / "starter"
    j = json.loads((kit / "kit.json").read_text())
    assert j["schema"] == 1 and j["name"] == "starter"
    noten = [k["note"] for k in j["klaenge"]]
    assert len(set(noten)) == len(noten) and all(type(n) is int and 0 <= n <= 127 for n in noten)
    for k in j["klaenge"]:
        assert k["datei"] == f"{k['note']}.f32"
        assert 0 < k["frames"] <= 480000
        raw = (kit / k["datei"]).read_bytes()
        assert len(raw) == k["frames"] * 8
        assert np.all(np.isfinite(np.frombuffer(raw, dtype="<f4")))
    assert ablage.pruefe_kit(kit) is None


def test_core_rules_refuse_bad_kits(tmp_path):
    ablage.schreibe_kit(tmp_path, "k", _klaenge())
    (tmp_path / "k" / "37.f32").write_bytes(b"\0" * 7)
    assert "size" in ablage.pruefe_kit(tmp_path / "k")
    assert ablage.pruefe_kit(tmp_path / "nichts") is not None


def test_too_long_or_bad_note_is_refused_before_publishing(tmp_path):
    with pytest.raises(ValueError):
        ablage.schreibe_kit(tmp_path, "lang", [(36, "x", np.zeros((480001, 2), "float32"))])
    with pytest.raises(ValueError):
        ablage.schreibe_kit(tmp_path, "note", [(128, "x", np.zeros((10, 2), "float32"))])
    assert not (tmp_path / "lang").exists() and not (tmp_path / "note").exists()
    assert [p.name for p in tmp_path.iterdir() if p.name != "home"] == []


def test_existing_kit_is_kept_byte_identical(tmp_path):
    (tmp_path / "starter").mkdir()
    (tmp_path / "starter" / "kit.json").write_text("meins")
    assert ablage.schreibe_kit(tmp_path, "starter", _klaenge()) == "behalten"
    assert (tmp_path / "starter" / "kit.json").read_text() == "meins"
    assert [p.name for p in (tmp_path / "starter").iterdir()] == ["kit.json"]


def test_interrupted_write_leaves_no_kit_and_next_run_cleans_up(tmp_path, monkeypatch):
    def kaputt(*a, **k):
        raise KeyboardInterrupt
    monkeypatch.setattr(os, "rename", kaputt)
    with pytest.raises(KeyboardInterrupt):
        ablage.schreibe_kit(tmp_path, "starter", _klaenge())
    monkeypatch.undo()
    assert not (tmp_path / "starter").exists()
    # a hard kill leaves the folder of a dead process behind
    toter = subprocess.Popen([sys.executable, "-c", "pass"])
    toter.wait()
    alt = tmp_path / f".starter.neu-{toter.pid}"
    alt.mkdir()
    (alt / "36.f32").write_bytes(b"x")
    lebend = tmp_path / f".andere.neu-{os.getpid()}"
    lebend.mkdir()
    assert ablage.schreibe_kit(tmp_path, "starter", _klaenge()) == "neu"
    assert not alt.exists() and lebend.exists()
    assert ablage.pruefe_kit(tmp_path / "starter") is None


def test_copy_sets_name(tmp_path):
    ablage.schreibe_kit(tmp_path, "starter", _klaenge())
    assert ablage.kopiere_kit(tmp_path, "starter", "gm") == "neu"
    j = json.loads((tmp_path / "gm" / "kit.json").read_text())
    assert j["name"] == "gm"
    assert (tmp_path / "gm" / "36.f32").read_bytes() == (tmp_path / "starter" / "36.f32").read_bytes()
    assert ablage.kopiere_kit(tmp_path, "starter", "gm") == "behalten"


def test_kit_ordner_follows_environment(tmp_path, monkeypatch):
    assert ablage.kit_ordner() == tmp_path / "home" / ".config" / "cypherdj" / "kits"
    monkeypatch.setenv("CYPHERDJ_KIT_ORDNER", str(tmp_path / "x"))
    assert ablage.kit_ordner() == tmp_path / "x"


def test_vorgaben_aus_tabelle(tmp_path, monkeypatch):
    """Kit, graph, loop and demo-project defaults equal the storage table; core kinds stay at the old place (a link after the setup), the demo project follows CYPHERDJ_HEIM (vorgabe neu)."""
    import storage as tabelle  # the package djk/ablage, not starter/storage.py
    from starter import demo, graphs as graphen, loops

    assert Path(tabelle.__file__).resolve() == Path(__file__).resolve().parents[2] / "ablage" / "__init__.py"
    home = tmp_path / "home"
    monkeypatch.setenv("CYPHERDJ_HEIM", str(tmp_path / "heim"))
    assert ablage.kit_ordner() == tabelle.ordner("kits") == home / ".config" / "cypherdj" / "kits"
    assert graphen.graphen_ordner() == tabelle.ordner("geraete") == home / ".config" / "cypherdj" / "baukasten"
    assert loops.loop_ordner("") == tabelle.ordner("loops") == home / ".config" / "cypherdj" / "loops"
    assert demo.projekt_wurzel("") == tabelle.ordner("projekte") == tmp_path / "heim" / "werke" / "projekte"
    # an empty value counts as unset
    monkeypatch.setenv("CYPHERDJ_KIT_ORDNER", "")
    monkeypatch.setenv("CYPHERDJ_BK_ORDNER", "")
    assert ablage.kit_ordner() == home / ".config" / "cypherdj" / "kits"
    assert graphen.graphen_ordner() == home / ".config" / "cypherdj" / "baukasten"
    # the defaults really come from the table: another table, other places
    import copy
    geaendert = copy.deepcopy(tabelle._lade())
    for art in ("kits", "geraete", "loops", "projekte"):
        geaendert["arten"][art]["alt"] = geaendert["arten"][art]["neu"] = "{HOME}/anders/" + art
    monkeypatch.setattr(tabelle, "_tabelle", geaendert)
    monkeypatch.delenv("CYPHERDJ_KIT_ORDNER")
    monkeypatch.delenv("CYPHERDJ_BK_ORDNER")
    assert ablage.kit_ordner() == home / "anders" / "kits"
    assert graphen.graphen_ordner() == home / "anders" / "geraete"
    assert loops.loop_ordner("") == home / "anders" / "loops"
    assert demo.projekt_wurzel("") == home / "anders" / "projekte"
    # a test instance keeps its own places
    assert loops.loop_ordner("f") == Path("/dev/shm/cypherdj-f/loops")
    assert demo.projekt_wurzel("f") == Path("/dev/shm/cypherdj-f/projekte")
