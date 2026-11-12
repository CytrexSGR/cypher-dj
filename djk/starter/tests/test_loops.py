import json
import os
import re
from pathlib import Path

import numpy as np
import pytest

from starter import __main__ as starter_main
from starter import storage as ablage, loops
from starter.tools import WerkzeugFehlt

NAMEN = {"starter-909-groove": 8, "starter-neuro-bass": 16, "starter-poly-chords": 16}
BEAT = 22500  # loops.ts:15


def _lies(ordner: Path):
    j = json.loads((ordner / "loop.json").read_text())
    return j, np.frombuffer((ordner / j["datei"]).read_bytes(), dtype="<f4").reshape(-1, 2)


@pytest.fixture(scope="module")
def gebaut(tmp_path_factory):
    """One real render of the three loops (needs cargo), shared by the tests that only read."""
    t = tmp_path_factory.mktemp("loops")
    home = t / "home"
    home.mkdir()
    alt = {k: os.environ.get(k) for k in ("HOME", "XDG_DATA_HOME", "CYPHERDJ_LOOP_ORDNER")}
    os.environ.update(HOME=str(home), XDG_DATA_HOME=str(home / ".local" / "share"))
    try:
        wurzel = t / "loops"
        r = loops.baue_loops(wurzel)
        yield wurzel, r, home
    finally:
        for k, v in alt.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_description_lists_the_three_loops():
    b = loops.beschreibung()
    assert {x["name"]: x["beats"] for x in b} == NAMEN
    for x in b:
        assert re.fullmatch(r"[a-z0-9_-]{1,32}", x["name"])
        assert x["beats"] in (1, 2, 4, 8, 16, 32)
        for h in x["hits"]:
            assert re.fullmatch(r"\d+@[0-9.]+(:[0-9.]+)?", h), h
            assert float(h.split("@")[1].split(":")[0]) < x["beats"]


@pytest.mark.parametrize("name", sorted(NAMEN))
def test_each_loop_meets_the_core_rules(gebaut, name):
    wurzel, r, _ = gebaut
    assert r[name] == "neu"
    j, x = _lies(wurzel / name)
    beats = NAMEN[name]
    assert j["schema"] == 1 and j["name"] == name and j["beats"] == beats and j["bpm"] == 128
    assert j["frames"] == beats * BEAT and j["datei"] == "loop.f32"
    assert j["quelle"].startswith("starter:") and j["erstellt"]
    assert (wurzel / name / "loop.f32").stat().st_size == j["frames"] * 8
    assert x.shape == (beats * BEAT, 2)
    assert np.all(np.isfinite(x))
    assert 20 * np.log10(np.abs(x).max()) <= -1.0 + 1e-3
    assert 20 * np.log10(np.sqrt(np.mean(x.astype("float64") ** 2)) + 1e-12) > -60
    assert not any(p.name.startswith(".") for p in wurzel.iterdir())


def test_loops_are_seamless_the_second_cycle_carries_the_tail_of_the_first(gebaut):
    """A loop kept from the second rendered cycle starts with a sounding tail, not from silence at the first hit."""
    wurzel, _, _ = gebaut
    _, x = _lies(wurzel / "starter-poly-chords")
    assert 20 * np.log10(np.abs(x[:2000]).max() + 1e-12) > -60


def test_wav_copy_for_the_library(gebaut):
    _, _, home = gebaut
    wav = home / ".local" / "share" / "cypherdj" / "starter" / "klaenge" / "loops"
    assert sorted(p.name for p in wav.iterdir()) == sorted(f"{n}_128bpm.wav" for n in NAMEN)
    assert (wav / "starter-909-groove_128bpm.wav").read_bytes()[:4] == b"RIFF"


def test_second_run_keeps_everything_and_renders_nothing(gebaut, monkeypatch):
    wurzel, _, _ = gebaut
    vorher = (wurzel / "starter-neuro-bass" / "loop.f32").read_bytes()
    monkeypatch.setattr(loops, "_rendere", lambda *a, **k: pytest.fail("rendered although kept"))
    r = loops.baue_loops(wurzel)
    assert set(r.values()) == {"behalten"}
    assert (wurzel / "starter-neuro-bass" / "loop.f32").read_bytes() == vorher


def test_schreibe_loop_layout_and_keep(tmp_path):
    x = (np.random.default_rng(1).standard_normal((8 * BEAT, 2)) * 0.1).astype("float32")
    assert ablage.schreibe_loop(tmp_path, "t-loop", 8, x, "starter:drums-909") == "neu"
    j = json.loads((tmp_path / "t-loop" / "loop.json").read_text())
    assert (j["schema"], j["name"], j["beats"], j["bpm"], j["frames"], j["datei"], j["quelle"]) == \
        (1, "t-loop", 8, 128, 8 * BEAT, "loop.f32", "starter:drums-909")
    assert re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d", j["erstellt"])
    assert (tmp_path / "t-loop" / "loop.f32").read_bytes() == x.tobytes()
    (tmp_path / "t-loop" / "loop.f32").write_bytes(b"edited")
    assert ablage.schreibe_loop(tmp_path, "t-loop", 8, x, "starter:drums-909") == "behalten"
    assert (tmp_path / "t-loop" / "loop.f32").read_bytes() == b"edited"


@pytest.mark.parametrize("name,beats,frames,wert", [
    ("t", 8, 8 * BEAT - 1, 0.0),       # wrong length
    ("t", 3, 3 * BEAT, 0.0),           # beats the core does not know
    ("Bad Name", 8, 8 * BEAT, 0.0),    # name rule
    ("t", 8, 8 * BEAT, float("nan")),  # not finite
])
def test_schreibe_loop_refuses_what_the_core_would_refuse(tmp_path, name, beats, frames, wert):
    x = np.full((frames, 2), wert, dtype="float32")
    ziel = tmp_path / "loops"
    with pytest.raises(ValueError):
        ablage.schreibe_loop(ziel, name, beats, x, "starter:x")
    assert not ziel.exists()


def test_loop_folder_follows_the_instance_rule(tmp_path):
    assert loops.loop_ordner("") == Path.home() / ".config" / "cypherdj" / "loops"
    assert loops.loop_ordner("f") == Path("/dev/shm/cypherdj-f/loops")


def test_stage_without_cargo_says_so_and_returns_4(monkeypatch, capsys):
    def fehlt(*a, **k):
        raise WerkzeugFehlt("cargo", "cargo not usable: test")
    monkeypatch.setattr(loops, "baue_loops", fehlt)
    assert starter_main.stufe_loops() == 4
    assert "cargo not usable" in capsys.readouterr().err
    assert "loops" in starter_main.UMGESETZT
