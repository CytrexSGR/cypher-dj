import os
import pwd
import subprocess
import sys
from pathlib import Path

import pytest

from testumgebung import saubere_umgebung, schreibpfad_pruefen

DJK = Path(__file__).resolve().parents[2]
CYPHERDJ_VARIABLEN = ["CYPHERDJ_KATALOG", "CYPHERDJ_MEDIATHEK", "CYPHERDJ_ANALYSE", "CYPHERDJ_RENDER",
                      "CYPHERDJ_PYTHON", "CYPHERDJ_MUSIK", "CYPHERDJ_NML"]


def echtes_home() -> Path:
    return Path(pwd.getpwuid(os.getuid()).pw_dir)


def test_home_liegt_in_tmp(tmp_path):
    assert Path(os.environ["HOME"]).resolve().is_relative_to(tmp_path.resolve())
    assert Path.home().resolve().is_relative_to(tmp_path.resolve())
    for name in ("XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"):
        assert Path(os.environ[name]).resolve().is_relative_to(tmp_path.resolve()), name
    assert not [n for n in os.environ if n.startswith("CYPHERDJ_")]


def test_schreibpfad_pruefen_lehnt_graphenordner_ohne_fixture_ab(tmp_path):
    ohne_fixture = echtes_home() / ".config" / "cypherdj" / "baukasten"
    with pytest.raises(AssertionError):
        schreibpfad_pruefen(ohne_fixture, tmp_path)
    schreibpfad_pruefen(Path.home() / ".config" / "cypherdj" / "baukasten", tmp_path)
    schreibpfad_pruefen(tmp_path, tmp_path)
    with pytest.raises(AssertionError):
        schreibpfad_pruefen(tmp_path / ".." / "draussen", tmp_path)


def test_saubere_umgebung_ohne_cypherdj(tmp_path, monkeypatch):
    for n in CYPHERDJ_VARIABLEN:
        monkeypatch.setenv(n, "/echt/" + n)
    monkeypatch.setenv("CARGO_TARGET_DIR", "/ziel")
    env = saubere_umgebung(tmp_path, echtes_home())
    assert not [n for n in env if n.startswith("CYPHERDJ_")]
    assert env["HOME"].startswith(str(tmp_path))
    assert env["CARGO_TARGET_DIR"] == "/ziel"
    assert env["PATH"] == os.environ["PATH"]
    assert env["CARGO_HOME"] and env["RUSTUP_HOME"]


def test_fixture_loescht_cypherdj_variablen(tmp_path):
    """A child pytest with the fixture, started with CYPHERDJ_* set and a real-looking HOME, must see neither."""
    kind = tmp_path / "kind"
    kind.mkdir()
    (kind / "conftest.py").write_text("from testumgebung import isoliert  # noqa: F401\n")
    (kind / "test_kind.py").write_text(
        "import os\n"
        "def test_sauber(tmp_path):\n"
        "    assert not [n for n in os.environ if n.startswith('CYPHERDJ_')]\n"
        "    assert os.environ['HOME'].startswith(str(tmp_path))\n")
    env = {"PATH": os.environ["PATH"], "HOME": str(echtes_home()), "PYTHONPATH": str(DJK)}
    for n in CYPHERDJ_VARIABLEN:
        env[n] = "/echt/" + n
    if "PYTEST_DISABLE_PLUGIN_AUTOLOAD" in os.environ:
        env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"]
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--rootdir", str(kind),
                        str(kind)], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
