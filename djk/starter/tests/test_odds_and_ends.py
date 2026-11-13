"""Follow-ups of the "base for new users" reviews (Kanban t_747a905b): small defects of the starter steps."""
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from starter import __main__ as starter_main
from starter import storage as ablage, demo, graphs as graphen, loops, tools as werkzeuge
from starter.tools import WerkzeugFehlt

TOTE_PID = 4194000  # no such process (below pid_max 4194304, far above what runs here)
BEAT = 22500


def _skript(pfad: Path, text: str) -> Path:
    pfad.write_text("#!/bin/sh\n" + text)
    pfad.chmod(0o755)
    return pfad


# graph copies get the mode of an ordinary file, not mkstemp's 0600
def test_graph_copy_has_the_mode_of_a_plain_file(tmp_path):
    alt = os.umask(0o022)
    try:
        assert graphen.schreibe_wenn_fehlt(b"{}", tmp_path / "bk" / "g.json")
    finally:
        os.umask(alt)
    assert stat.S_IMODE((tmp_path / "bk" / "g.json").stat().st_mode) == 0o644


def test_graph_copy_follows_a_stricter_umask(tmp_path):
    alt = os.umask(0o077)
    try:
        assert graphen.schreibe_wenn_fehlt(b"{}", tmp_path / "bk" / "g.json")
    finally:
        os.umask(alt)
    assert stat.S_IMODE((tmp_path / "bk" / "g.json").stat().st_mode) == 0o600


# cargo's own words reach the user
def test_cargo_failure_shows_the_end_of_cargos_stderr(tmp_path, monkeypatch):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    _skript(bin_ / "cargo", 'echo "compiling" >&2\necho "error: could not compile baukasten_dsp (boom)" >&2\nexit 101\n')
    monkeypatch.setenv("PATH", f"{bin_}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CARGO_TARGET_DIR", str(tmp_path / "t"))
    with pytest.raises(WerkzeugFehlt) as e:
        werkzeuge.cargo_beispiel("render_kit")
    assert "cargo not usable" in e.value.hinweis
    assert "could not compile baukasten_dsp (boom)" in e.value.hinweis


# leftovers of a killed run are cleaned by the next run
def _probe_programm(tmp_path: Path) -> Path:
    return _skript(tmp_path / "probe", 'for n in orchester-schlag.f32 orchester-schlag-schichten.f32 feder-ir.f32; do echo x > "$1/$n"; done\n')


def test_stale_probe_folder_of_a_dead_process_is_removed(tmp_path, monkeypatch):
    monkeypatch.setattr(werkzeuge, "cargo_beispiel", lambda n: _probe_programm(tmp_path))
    samples = tmp_path / "bk" / "samples"
    tot, lebt, fremd = samples / f".proben-{TOTE_PID}-abc", samples / f".proben-{os.getppid()}-abc", samples / ".proben-notes"
    for d in (tot, lebt, fremd):
        d.mkdir(parents=True)
        (d / "x").write_text("x")
    assert len(graphen.installiere_proben(tmp_path / "bk")) == 3
    assert not tot.exists()
    assert lebt.exists() and fremd.exists(), "a living process's folder and foreign names stay"
    assert sorted(p.name for p in samples.iterdir() if p.name.startswith(".proben-")) == sorted([lebt.name, fremd.name])


def test_probe_folder_of_this_run_is_gone_after_the_run(tmp_path, monkeypatch):
    monkeypatch.setattr(werkzeuge, "cargo_beispiel", lambda n: _probe_programm(tmp_path))
    graphen.installiere_proben(tmp_path / "bk")
    assert not [p for p in (tmp_path / "bk" / "samples").iterdir() if p.name.startswith(".proben-")]


def test_stale_demo_folder_of_a_dead_process_is_removed(tmp_path):
    wurzel = tmp_path / "projekte"
    tot, lebt = wurzel / f".demo.neu-{TOTE_PID}", wurzel / f".demo.neu-{os.getppid()}"
    for d in (tot, lebt):
        d.mkdir(parents=True)
    assert demo.kopiere_demo(wurzel) == "neu"
    assert not tot.exists() and lebt.exists()


def test_a_huge_pid_in_a_leftover_name_does_not_crash(tmp_path):
    wurzel = tmp_path / "projekte"
    (wurzel / f".demo.neu-{'9' * 20}").mkdir(parents=True)
    assert demo.kopiere_demo(wurzel) == "neu"


# loops: a damaged loop is not "kept", and a WAV lost to an abort is made again
def _loop_x():
    return (np.random.default_rng(3).standard_normal((8 * BEAT, 2)) * 0.1).astype("float32")


def test_damaged_loop_json_is_reported_and_returns_4(tmp_path, monkeypatch, capsys):
    wurzel = tmp_path / "loops"
    ablage.schreibe_loop(wurzel, "starter-909-groove", 8, _loop_x(), "starter:drums-909")
    (wurzel / "starter-909-groove" / "loop.json").write_text("{kaputt")
    monkeypatch.setattr(loops, "_rendere", lambda *a, **k: pytest.fail("rendered a kept loop"))
    monkeypatch.setattr(loops, "loop_ordner", lambda i="": wurzel)
    monkeypatch.setattr(loops, "beschreibung", lambda: [b for b in json.loads((Path(loops.__file__).with_name("loops.json")).read_text())
                                                          if b["name"] == "starter-909-groove"])
    r = loops.baue_loops(wurzel)
    assert r == {"starter-909-groove": "beschaedigt"}
    assert starter_main.stufe_loops() == 4
    cap = capsys.readouterr()
    assert "kept loop starter-909-groove" not in cap.out
    assert "damaged" in cap.err and "starter-909-groove" in cap.err


def test_loop_with_wrong_size_is_damaged(tmp_path):
    wurzel = tmp_path / "loops"
    ablage.schreibe_loop(wurzel, "t", 8, _loop_x(), "starter:x")
    assert ablage.pruefe_loop(wurzel / "t") is None
    (wurzel / "t" / "loop.f32").write_bytes(b"short")
    assert ablage.pruefe_loop(wurzel / "t")
    (wurzel / "t" / "loop.f32").unlink()
    assert ablage.pruefe_loop(wurzel / "t")


def test_missing_wav_of_an_intact_loop_is_made_again_without_rendering(tmp_path, monkeypatch):
    eins = loops.beschreibung()[0]
    name, beats = eins["name"], eins["beats"]
    monkeypatch.setattr(loops, "beschreibung", lambda: [eins])
    wurzel = tmp_path / "loops"
    x = (np.random.default_rng(4).standard_normal((beats * BEAT, 2)) * 0.1).astype("float32")
    ablage.schreibe_loop(wurzel, name, beats, x, "starter:x")
    wav = loops._wav_ordner() / f"{name}_{loops.BPM}bpm.wav"
    assert not wav.exists()
    monkeypatch.setattr(loops, "_rendere", lambda *a, **k: pytest.fail("rendered a kept loop"))
    r = loops.baue_loops(wurzel)
    assert r[name] == "behalten"
    assert wav.read_bytes()[:4] == b"RIFF"
    from starter import render
    assert np.array_equal(render.lies_wav_f32(wav), x)
    wav.write_bytes(b"mine")
    loops.baue_loops(wurzel)
    assert wav.read_bytes() == b"mine", "an existing WAV is never replaced"
