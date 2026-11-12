"""Kit folders in the core's format (core/src/kit.cpp:18-60): kit.json schema 1 plus raw interleaved float32 files."""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import time
from pathlib import Path

import numpy as np

KIT_NOTEN = 128
KIT_MAX_FRAMES = 480000  # kit.h:14
KIT_MAX_BYTES = 256 << 20  # kit.h:15


def kit_ordner() -> Path:
    """CYPHERDJ_KIT_ORDNER or $HOME/.config/cypherdj/kits (paths.ts:51)."""
    vorgabe = os.environ.get("CYPHERDJ_KIT_ORDNER")
    return Path(vorgabe) if vorgabe else Path.home() / ".config" / "cypherdj" / "kits"


def pruefe_kit(ordner: Path) -> str | None:
    """None when the core would load this kit folder, else the first reason (same rules as kit.cpp:30-60)."""
    try:
        j = json.loads((ordner / "kit.json").read_text())
    except (OSError, ValueError) as e:
        return f"kit.json: {e}"
    if not isinstance(j, dict) or j.get("schema") != 1:
        return "kit.json: schema is not 1"
    klaenge = j.get("klaenge")
    if not isinstance(klaenge, list) or not klaenge:
        return "kit.json: no sounds"
    noten: set[int] = set()
    gesamt = 0
    for k in klaenge:
        if not isinstance(k, dict) or type(k.get("note")) is not int:
            return "sound without integer note"
        note = k["note"]
        if not 0 <= note < KIT_NOTEN:
            return f"note {note} outside 0..127"
        if note in noten:
            return f"note {note} twice"
        noten.add(note)
        datei = k.get("datei")
        if (not isinstance(datei, str) or not 5 <= len(datei) <= 64 or "/" in datei or ".." in datei
                or not datei.endswith(".f32")):
            return f"file name {datei!r} not allowed"
        frames = k.get("frames")
        if type(frames) is not int or not 0 < frames <= KIT_MAX_FRAMES:
            return f"{datei}: frames {frames}"
        gesamt += frames * 8
        if gesamt > KIT_MAX_BYTES:
            return "kit larger than 256 MiB"
        try:
            roh = (ordner / datei).read_bytes()
        except OSError:
            return f"{datei} missing"
        if len(roh) != frames * 8:
            return f"{datei}: size does not match frames"
        if not np.all(np.isfinite(np.frombuffer(roh, dtype="<f4"))):
            return f"{datei}: NaN or Inf"
    return None


def _pid_lebt(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def raeume_alte(wurzel: Path) -> None:
    """Removes `.<name>.neu-<pid>` folders whose process is gone."""
    if not wurzel.is_dir():
        return
    for p in wurzel.iterdir():
        name, _, pid = p.name.rpartition(".neu-")
        if name.startswith(".") and pid.isdigit() and p.is_dir() and not _pid_lebt(int(pid)):
            shutil.rmtree(p, ignore_errors=True)


def _veroeffentliche(wurzel: Path, name: str, schreibe) -> str:
    """Builds the kit through `schreibe(tmpdir)` and renames it to <wurzel>/<name>; an existing one is kept."""
    ziel = wurzel / name
    wurzel.mkdir(parents=True, exist_ok=True)
    raeume_alte(wurzel)
    if os.path.lexists(ziel):
        return "behalten"
    tmp = wurzel / f".{name}.neu-{os.getpid()}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    try:
        schreibe(tmp)
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


def schreibe_kit(wurzel: Path, name: str, klaenge: list[tuple[int, str, np.ndarray]]) -> str:
    """Writes kit `name` (sounds: note, name, array (n, 2)). Returns "neu", or "behalten" when the folder exists."""
    def schreibe(tmp: Path) -> None:
        eintraege = []
        for note, kname, x in klaenge:
            x = np.ascontiguousarray(x, dtype="<f4")
            if x.ndim != 2 or x.shape[1] != 2:
                raise ValueError(f"sound {kname}: shape {x.shape}, expected (n, 2)")
            datei = f"{note}.f32"
            (tmp / datei).write_bytes(x.tobytes())
            eintraege.append({"note": note, "name": kname, "datei": datei, "frames": int(x.shape[0])})
        (tmp / "kit.json").write_text(json.dumps({"schema": 1, "name": name, "klaenge": eintraege}, indent=1) + "\n")
        grund = pruefe_kit(tmp)
        if grund:
            raise ValueError(f"kit {name} would be refused by the core: {grund}")
    return _veroeffentliche(wurzel, name, schreibe)


def kopiere_kit(wurzel: Path, quelle: str, ziel: str) -> str:
    """Copies kit folder `quelle` to `ziel` with `name` set to `ziel`. "neu" or "behalten"."""
    def schreibe(tmp: Path) -> None:
        for p in (wurzel / quelle).iterdir():
            if p.is_file():
                shutil.copyfile(p, tmp / p.name)
        j = json.loads((tmp / "kit.json").read_text())
        j["name"] = ziel
        (tmp / "kit.json").write_text(json.dumps(j, indent=1) + "\n")
    return _veroeffentliche(wurzel, ziel, schreibe)


LOOP_BEATS = (1, 2, 4, 8, 16, 32)
LOOP_BEAT_FRAMES = 22500  # loops.ts:15, loop.cpp: 128 BPM at 48 kHz


def schreibe_loop(wurzel: Path, name: str, beats: int, x: np.ndarray, quelle: str) -> str:
    """Writes loop `name` in the core's loop format (loop_build.py:43-55): loop.json schema 1 plus loop.f32 (interleaved
    float32 stereo, beats * 22500 frames). "neu", or "behalten" when the folder exists. Refuses what the core refuses."""
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", name):
        raise ValueError(f"loop name {name!r}: allowed is [a-z0-9_-]{{1,32}}")
    if beats not in LOOP_BEATS:
        raise ValueError(f"loop {name}: {beats} beats, allowed are {LOOP_BEATS}")
    x = np.ascontiguousarray(x, dtype="<f4")
    frames = beats * LOOP_BEAT_FRAMES
    if x.shape != (frames, 2):
        raise ValueError(f"loop {name}: shape {x.shape}, expected ({frames}, 2)")
    if not np.all(np.isfinite(x)):
        raise ValueError(f"loop {name}: NaN or Inf")

    def schreibe(tmp: Path) -> None:
        (tmp / "loop.f32").write_bytes(x.tobytes())
        (tmp / "loop.json").write_text(json.dumps(
            {"schema": 1, "name": name, "beats": beats, "bpm": 128, "frames": frames, "datei": "loop.f32",
             "quelle": quelle, "erstellt": time.strftime("%Y-%m-%d %H:%M")}, indent=1) + "\n")
    return _veroeffentliche(wurzel, name, schreibe)
