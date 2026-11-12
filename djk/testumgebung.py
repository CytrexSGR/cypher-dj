"""Test isolation for the Python tests of the public tools (starter, bibliothek).

Every test runs with HOME and the XDG folders inside its own tmp_path and without any CYPHERDJ_* variable, so no test
can read or write a real user path (~/.config/cypherdj, ~/.local/share/cypherdj, the media library, the project folder).
The Rust toolchain lives under the real HOME: CARGO_HOME, RUSTUP_HOME and CARGO_TARGET_DIR stay as they are (rustup fails
with a foreign HOME otherwise).

Use in a conftest.py:  from testumgebung import isoliert  # noqa: F401  (autouse fixture)
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

# Variables that survive the cleaning.
_BEHALTEN = ("PATH", "CARGO_HOME", "RUSTUP_HOME", "CARGO_TARGET_DIR")


def saubere_umgebung(tmp: Path, echt_home: Path) -> dict[str, str]:
    """The environment of a test process: HOME and XDG inside tmp, no CYPHERDJ_*, PATH and the cargo variables kept."""
    home = tmp / "home"
    env = {
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_DATA_HOME": str(home / ".local" / "share"),
    }
    for name in _BEHALTEN:
        if name in os.environ:
            env[name] = os.environ[name]
    env.setdefault("CARGO_HOME", str(echt_home / ".cargo"))
    env.setdefault("RUSTUP_HOME", str(echt_home / ".rustup"))
    return env


def schreibpfad_pruefen(p: Path, tmp: Path) -> None:
    """Raises AssertionError when p is not inside tmp (after resolving symlinks and '..')."""
    echt = Path(os.path.realpath(p))
    wurzel = Path(os.path.realpath(tmp))
    if echt != wurzel and wurzel not in echt.parents:
        raise AssertionError(f"write path outside the test directory: {p} (test directory {tmp})")


@pytest.fixture(autouse=True)
def isoliert(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """HOME, XDG_* into tmp_path/home, every CYPHERDJ_* variable deleted. Returns the clean environment."""
    echt_home = Path(os.environ.get("HOME", str(Path.home())))
    env = saubere_umgebung(tmp_path, echt_home)
    for name in [n for n in os.environ if n.startswith("CYPHERDJ_")]:
        monkeypatch.delenv(name)
    for name in ("HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "CARGO_HOME", "RUSTUP_HOME"):
        monkeypatch.setenv(name, env[name])
    Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
    return env
