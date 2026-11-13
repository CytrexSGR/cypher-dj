"""Tool lookup for the starter: the Rust examples of baukasten_dsp, built once on demand."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

DJK = Path(__file__).resolve().parents[1]
INSTRUMENTE = DJK / "instruments"
HINWEIS_CARGO = "cargo not usable: kits, loops and graph samples need the Rust toolchain (INSTALL.md section 1)"


class WerkzeugFehlt(Exception):
    """A tool a step needs is missing or does not run. `hinweis` says what to do, for stderr."""

    def __init__(self, werkzeug: str, hinweis: str):
        super().__init__(hinweis)
        self.werkzeug = werkzeug
        self.hinweis = hinweis


def ziel_ordner() -> Path:
    return Path(os.environ.get("CARGO_TARGET_DIR") or INSTRUMENTE / "target")


def cargo_beispiel(name: str) -> Path:
    """Path of the release example `name` of baukasten_dsp; builds all examples once when it is missing."""
    pfad = ziel_ordner() / "release" / "examples" / name
    if pfad.is_file() and os.access(pfad, os.X_OK):
        return pfad
    try:
        r = subprocess.run(["nice", "-n", "10", "cargo", "build", "--release", "-j6", "-p", "baukasten_dsp",
                            "--examples"], cwd=INSTRUMENTE, capture_output=True, text=True)
    except (FileNotFoundError, OSError) as e:
        raise WerkzeugFehlt("cargo", HINWEIS_CARGO) from e
    if r.returncode != 0:
        ende = "\n".join((r.stderr or "").strip().splitlines()[-8:])  # cargo's own words, the end of them
        raise WerkzeugFehlt("cargo", HINWEIS_CARGO + (f"\ncargo said:\n{ende}" if ende else ""))
    if not pfad.is_file():
        raise WerkzeugFehlt("cargo", HINWEIS_CARGO)
    return pfad
