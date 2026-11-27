"""voice_build.py: phrases become one slotted loop (generated sines only)."""
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(__file__)
CLI = os.path.join(HERE, "..", "voice_build.py")
RATE = 48000


def sine(path, freq):
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency={freq}:duration=0.6:sample_rate={RATE}", "-ac", "1", str(path)], check=True)


def run(args):
    return subprocess.run([sys.executable, CLI, *map(str, args)], capture_output=True, text=True)


def test_two_phrases_make_two_slots(tmp_path):
    a, b = tmp_path / "a.wav", tmp_path / "b.wav"
    sine(a, 440)
    sine(b, 660)
    loops = tmp_path / "loops"
    loops.mkdir()
    r = run([a, b, "--stil", "fluester", "--name", "v1", "--loops", loops, "--notiz", "test"])
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout.strip().splitlines()[-1])
    slot = round(4 * 1 * 60 / 128 * RATE)
    assert out == {"name": "v1", "ordner": str(loops / "v1"), "beats": 8, "frames": 2 * slot, "phrasen": 2}
    meta = json.loads((loops / "v1" / "loop.json").read_text())
    assert meta["schema"] == 1 and meta["beats"] == 8 and meta["bpm"] == 128
    assert meta["frames"] == 2 * slot and meta["quelle"] == "cypher" and meta["notiz"] == "test"
    x = np.fromfile(loops / "v1" / "loop.f32", dtype="<f4").reshape(-1, 2)
    assert x.shape[0] == 2 * slot
    assert np.abs(x[slot:slot + 4800]).max() > 0.001  # second slot starts with sound
    r2 = run([a, "--stil", "roh", "--name", "v1", "--loops", loops])
    assert r2.returncode != 0 and "exists" in r2.stderr


def test_roh_style_keeps_slot_length(tmp_path):
    a = tmp_path / "a.wav"
    sine(a, 300)
    loops = tmp_path / "loops"
    loops.mkdir()
    r = run([a, "--stil", "roh", "--takte", "2", "--bpm", "100", "--name", "r", "--loops", loops])
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["frames"] == round(8 * 60 / 100 * RATE)


def test_name_outside_the_pattern_is_refused_and_creates_nothing(tmp_path):
    a = tmp_path / "a.wav"
    sine(a, 440)
    loops = tmp_path / "loops"
    loops.mkdir()
    for name in ["../x", "A", "a b", "x" * 33, "a/b", ".", ".."]:
        r = run([a, "--stil", "roh", "--name", name, "--loops", loops])
        assert r.returncode == 2 and "name must match" in r.stderr, (name, r.stderr)
    assert list(loops.iterdir()) == []
    assert list(tmp_path.glob("x")) == []
    r = run([a, "--stil", "roh", "--name", "x" * 32, "--loops", loops])
    assert r.returncode == 0, r.stderr


def test_a_failing_phrase_removes_the_half_written_folder(tmp_path):
    a, kaputt = tmp_path / "a.wav", tmp_path / "kaputt.wav"
    sine(a, 440)
    kaputt.write_text("not audio")
    loops = tmp_path / "loops"
    loops.mkdir()
    r = run([a, kaputt, "--stil", "roh", "--name", "halb", "--loops", loops])
    assert r.returncode == 1
    assert not (loops / "halb").exists()
    (loops / "stehen").mkdir()
    assert [p.name for p in loops.iterdir()] == ["stehen"]
