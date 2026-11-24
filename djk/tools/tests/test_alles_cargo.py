"""alles_cargo.sh with a stub `cargo` and stub test executables: the binaries are run directly, and one that cannot start,
dies, or prints no result line makes the run red (never 0 tests)."""
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

SKRIPT = Path(__file__).resolve().parents[1] / "alles_cargo.sh"


def exe(pfad: Path, body: str) -> str:
    pfad.write_text("#!/bin/bash\n" + body + "\n")
    pfad.chmod(pfad.stat().st_mode | stat.S_IEXEC)
    return str(pfad)


def lauf(tmp: Path, tests: dict):
    """tests: name -> executable path (or a path that does not exist). Package baukasten_dsp for all, plus the two timing binaries."""
    inst = tmp / "inst"
    inst.mkdir()
    zeilen = []
    ok = 'echo "running 1 test"; echo "test result: ok. 3 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.1s"'
    alle = dict(tests)
    for z in ("drum_synth", "trommeln"):
        alle[z] = exe(tmp / z, ok)
    for name, pfad in alle.items():
        zeilen.append(json.dumps({"reason": "compiler-artifact", "package_id": "path+file:///x/dsp#baukasten_dsp@0.1.0",
                                  "manifest_path": str(inst / "Cargo.toml"), "target": {"name": name},
                                  "profile": {"test": True}, "executable": pfad}))
    (tmp / "artefakte").write_text("\n".join(zeilen) + "\n")
    b = tmp / "bin"
    b.mkdir()
    exe(b / "cargo", f'''case "$*" in *--no-run*) cat "{tmp}/artefakte";; *--doc*) echo "   Doc-tests x"; echo "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.0s";; *) echo "unexpected cargo call $*" >&2; exit 9;; esac''')
    exe(b / "rustc", 'echo /nonexistent')
    r = subprocess.run(["bash", str(SKRIPT), str(inst), "2", "2"], capture_output=True, text=True,
                       env=dict(os.environ, PATH=f"{b}:{os.environ['PATH']}"))
    return r


def test_binaries_run_directly_and_results_are_counted(tmp_path):
    ok = 'echo "test result: ok. 3 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.1s"'
    r = lauf(tmp_path, {"a": exe(tmp_path / "a", ok), "b": exe(tmp_path / "b", ok)})
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.count("test result: ok. 3 passed") == 4 + 2  # a, b, the two timing binaries in the pool (their timing tests skipped), and the two timing runs
    assert "unexpected cargo call" not in r.stderr  # no per-target cargo test


def test_the_binary_runs_in_its_package_dir(tmp_path):
    r = lauf(tmp_path, {"a": exe(tmp_path / "a", 'echo "cwd=$(pwd)"; echo "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0s"')})
    assert f"cwd={tmp_path}/inst" in r.stdout


def test_a_binary_that_cannot_start_is_red(tmp_path):
    r = lauf(tmp_path, {"weg": str(tmp_path / "gibt-es-nicht")})
    assert r.returncode == 1


def test_a_binary_that_crashes_without_output_is_red(tmp_path):
    r = lauf(tmp_path, {"abbruch": exe(tmp_path / "abbruch", "kill -SEGV $$")})
    assert r.returncode == 1


def test_exit_zero_without_a_result_line_is_red(tmp_path):
    r = lauf(tmp_path, {"leer": exe(tmp_path / "leer", "echo hallo")})
    assert r.returncode == 1 and "printed no 'test result:' line" in r.stdout


def test_a_failing_test_is_red_and_keeps_its_name(tmp_path):
    body = 'echo "test boese ... FAILED"; echo "test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0s"; exit 101'
    r = lauf(tmp_path, {"rot": exe(tmp_path / "rot", body)})
    assert r.returncode == 1 and "test boese ... FAILED" in r.stdout


def _fake_exe(tmp_path, ausgabe, rc=0):
    exe = tmp_path / "t-1"
    exe.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$@\" > '{tmp_path}/args.txt'\necho '{ausgabe}'\nexit {rc}\n")
    exe.chmod(0o755)
    return exe


def _rerun(tmp_path, exe, namen):
    spec = tmp_path / "spec.txt"
    spec.write_text("".join(f"{tmp_path}|{exe}|{n}\n" for n in namen))
    return subprocess.run(["bash", str(SKRIPT), "--rerun", str(tmp_path), str(spec)], capture_output=True, text=True, env={**os.environ, "TMPDIR": str(tmp_path)})


@pytest.mark.skipif(shutil.which("rustc") is None, reason="needs rustc for the library path")
def test_rerun_mode_runs_only_the_named_tests_exactly_and_serially(tmp_path):
    exe = _fake_exe(tmp_path, "test result: ok. 2 passed; 0 failed")
    r = _rerun(tmp_path, exe, ["m::a", "m::b"])
    assert r.returncode == 0 and f"Running {exe}  [cwd={tmp_path}]" in r.stdout
    assert (tmp_path / "args.txt").read_text().split() == ["--test-threads=1", "--exact", "m::a", "m::b"]


@pytest.mark.skipif(shutil.which("rustc") is None, reason="needs rustc for the library path")
def test_rerun_mode_is_red_for_a_binary_without_result_line_or_with_a_failure(tmp_path):
    assert _rerun(tmp_path, _fake_exe(tmp_path, "nothing"), ["m::a"]).returncode == 1
    assert _rerun(tmp_path, _fake_exe(tmp_path, "test result: FAILED. 0 passed; 1 failed", 101), ["m::a"]).returncode == 1
