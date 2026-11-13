"""The demo project: four tracks (kit, Cypher Modular bass, RB-338 acid line, Cypher Modular chords), no audio file.
Copied into the project root as `demo/` only when that name is free; an existing project is never touched."""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from . import storage as ablage

QUELLE = Path(__file__).resolve().parent / "demo" / "project.json"


def projekt_wurzel(instanz: str = "") -> Path:
    """Project root of an instance, the rule of projektWurzelVorgabe (storage.ts:54-56)."""
    if instanz != "" and not re.fullmatch(r"[a-z]", instanz):
        raise ValueError(f"instance {instanz!r}: a to z expected")
    return Path.home() / "cypherdj-projekte" if instanz == "" else Path(f"/dev/shm/cypherdj-{instanz}/projekte")


def kopiere_demo(wurzel: Path) -> str:
    """Writes <wurzel>/demo/project.json and an empty undo.jsonl (storage.ts:151). "neu", or "behalten" when `demo` exists."""
    ziel = wurzel / "demo"
    wurzel.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(ziel):
        return "behalten"
    ablage.raeume_tote(wurzel, re.compile(r"\.demo\.neu-(\d+)"))
    tmp = wurzel / f".demo.neu-{os.getpid()}"   # dot name: the project list ignores it (SLUG)
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    try:
        shutil.copyfile(QUELLE, tmp / "project.json")
        (tmp / "undo.jsonl").write_text("")
        os.rename(tmp, ziel)  # fails on an existing non-empty folder: nothing is replaced
    except OSError:
        shutil.rmtree(tmp, ignore_errors=True)
        if os.path.lexists(ziel):
            return "behalten"
        raise
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return "neu"
