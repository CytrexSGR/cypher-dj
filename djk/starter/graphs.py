"""The shipped Cypher Modular graphs and their sample files, copied into the user's graph folder."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import storage as ablage, tools as werkzeuge
from .tools import WerkzeugFehlt

GRAPH_NAME = re.compile(r"^[a-z0-9_-]{1,32}$")  # same rule as the page server (graphs.ts:18) and the core
PROBEN = ("orchester-schlag.f32", "orchester-schlag-schichten.f32", "feder-ir.f32")


def graphen_ordner() -> Path:
    """The core's graph folder: CYPHERDJ_BK_ORDNER or $HOME/.config/cypherdj/baukasten (graphs.ts:21-24)."""
    vorgabe = os.environ.get("CYPHERDJ_BK_ORDNER")
    return Path(vorgabe) if vorgabe else Path.home() / ".config" / "cypherdj" / "baukasten"


def quellen_der_beispiele(djk: Path) -> list[Path]:
    """Every demos/*.json and demos/recipes/*.json of baukasten_dsp except MANIFEST.json, sorted."""
    wurzel = djk / "instruments" / "modular_dsp" / "demos"
    alle = sorted(wurzel.glob("*.json")) + sorted((wurzel / "recipes").glob("*.json"))
    return [p for p in alle if p.name != "MANIFEST.json"]


def schreibe_wenn_fehlt(daten: bytes, ziel: Path) -> bool:
    """Writes `daten` to `ziel` only when nothing is there (a broken link counts as there). Temporary sibling first,
    then an atomic hard link that fails if `ziel` appeared meanwhile. Returns True when written."""
    if os.path.lexists(ziel):
        return False
    ziel.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".starter-", dir=ziel.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(daten)
        umask = os.umask(0)  # mkstemp makes 0600: a copy gets the mode any new file would get
        os.umask(umask)
        os.chmod(tmp, 0o666 & ~umask)
        try:
            os.link(tmp, ziel)
        except FileExistsError:
            return False
        except OSError:  # no hard links on this file system: rename (the check above was the guard)
            os.replace(tmp, ziel)
        return True
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def installiere_graphen(quellen: list[Path], ziel: Path) -> dict[str, list[str]]:
    """Copies graphs that are absent in `ziel`. Existing ones are kept whatever they contain."""
    r: dict[str, list[str]] = {"neu": [], "behalten": [], "uebersprungen": []}
    for q in quellen:
        name = q.stem
        if q.suffix != ".json" or q.name == "MANIFEST.json" or not GRAPH_NAME.match(name):
            r["uebersprungen"].append(name)
            continue
        if schreibe_wenn_fehlt(q.read_bytes(), ziel / q.name):
            r["neu"].append(name)
        else:
            r["behalten"].append(name)
    return r


def installiere_proben(ziel: Path) -> list[str]:
    """Writes the three generated sample files into <ziel>/samples when absent; returns the names written.
    The generator (a cargo example) only runs when at least one file is missing."""
    samples = ziel / "samples"
    fehlend = [n for n in PROBEN if not os.path.lexists(samples / n)]
    if not fehlend:
        return []
    programm = werkzeuge.cargo_beispiel("erzeuge_probe")
    samples.mkdir(parents=True, exist_ok=True)
    ablage.raeume_tote(samples, re.compile(r"\.proben-(\d+)-.*"))
    neu: list[str] = []
    with tempfile.TemporaryDirectory(prefix=f".proben-{os.getpid()}-", dir=samples) as tmp:
        r = subprocess.run(["nice", "-n", "10", str(programm), tmp], capture_output=True, text=True)
        if r.returncode != 0:
            raise WerkzeugFehlt("erzeuge_probe", "sample generator failed: " + (r.stderr.strip() or f"exit {r.returncode}"))
        for n in fehlend:
            quelle = Path(tmp) / n
            if quelle.is_file() and schreibe_wenn_fehlt(quelle.read_bytes(), samples / n):
                neu.append(n)
    return neu
