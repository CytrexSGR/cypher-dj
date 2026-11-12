"""Renders one drum sound with the render_kit example of baukasten_dsp."""
from __future__ import annotations

import struct
import subprocess
from pathlib import Path

import numpy as np

from . import tools as werkzeuge
from .tools import WerkzeugFehlt


def lies_wav_f32(pfad: Path) -> np.ndarray:
    """Float WAV as an array of shape (n, 2)."""
    roh = pfad.read_bytes()
    if roh[:4] != b"RIFF" or roh[8:12] != b"WAVE":
        raise ValueError(f"{pfad}: not a WAV file")
    pos, fmt, daten = 12, None, None
    while pos + 8 <= len(roh):
        kennung, groesse = roh[pos:pos + 4], struct.unpack("<I", roh[pos + 4:pos + 8])[0]
        koerper = roh[pos + 8:pos + 8 + groesse]
        if kennung == b"fmt ":
            fmt = struct.unpack("<HHIIHH", koerper[:16])
        elif kennung == b"data":
            daten = koerper
        pos += 8 + groesse + (groesse & 1)
    if fmt is None or daten is None or fmt[0] != 3 or fmt[5] != 32:
        raise ValueError(f"{pfad}: expected 32-bit float WAV")
    kanaele = fmt[1]
    x = np.frombuffer(daten[: len(daten) // (4 * kanaele) * 4 * kanaele], dtype="<f4").reshape(-1, kanaele)
    if kanaele == 1:
        x = np.repeat(x, 2, axis=1)
    return x[:, :2].astype("float32")


def schreibe_wav_f32(x: np.ndarray, rate: int = 48000) -> bytes:
    """Stereo 32-bit float WAV bytes of an array (n, 2)."""
    daten = np.ascontiguousarray(x, dtype="<f4").tobytes()
    kopf = b"RIFF" + struct.pack("<I", 36 + len(daten)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 2, rate, rate * 8, 8, 32)
    return kopf + b"data" + struct.pack("<I", len(daten)) + daten


def render_hits(graph: Path, aus: Path, hits: list[tuple[int, float, float]], dauer_s: float, off_s: float) -> None:
    """Plays `hits` (note, seconds, velocity) through `graph`; writes a 48 kHz stereo float WAV to `aus`."""
    programm = werkzeuge.cargo_beispiel("render_kit")
    liste = ",".join(f"{n}@{t}:{v}" for n, t, v in hits)
    r = subprocess.run(["nice", "-n", "10", str(programm), str(graph), str(aus), "--hits", liste,
                        "--dauer", str(dauer_s), "--off", str(off_s)], capture_output=True, text=True)
    if r.returncode != 0:
        raise WerkzeugFehlt("render_kit", f"render_kit failed for {graph.name}: " + (r.stderr.strip() or f"exit {r.returncode}"))
