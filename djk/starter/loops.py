"""The starter loops: 128 BPM loops rendered from the shipped graphs, written in the core's loop format."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

from . import storage as ablage, graphs as graphen, tools as werkzeuge

DJK = Path(__file__).resolve().parents[1]
RATE = 48000
BPM = 128
BEAT_FRAMES = 22500  # RATE * 60 / BPM, loop.cpp
SPITZE = 10 ** (-1 / 20)  # peak limit -1 dBFS


def beschreibung() -> list[dict]:
    return json.loads((Path(__file__).with_name("loops.json")).read_text())


def loop_ordner(instanz: str = "") -> Path:
    """The core's loop folder per instance (main.cpp, paths.ts loopOrdnerVorgabe): ~/.config/cypherdj/loops, or
    /dev/shm/cypherdj-<i>/loops for a test instance."""
    if instanz:
        return Path(f"/dev/shm/cypherdj-{instanz}/loops")
    return Path.home() / ".config" / "cypherdj" / "loops"


def _wav_ordner() -> Path:
    daten = os.environ.get("XDG_DATA_HOME")
    basis = Path(daten) if daten else Path.home() / ".local" / "share"
    return basis / "cypherdj" / "starter" / "klaenge" / "loops"


def _hits(loop: dict, zyklen: int) -> list[tuple[int, float, float]]:
    """`NOTE@BEAT[:VEL]` of the description, repeated for `zyklen` cycles, as (note, seconds, velocity)."""
    aus = []
    for z in range(zyklen):
        for h in loop["hits"]:
            note, _, rest = h.partition("@")
            beat, _, vel = rest.partition(":")
            aus.append((int(note), (z * loop["beats"] + float(beat)) * 60.0 / BPM, float(vel) if vel else 0.9))
    return aus


def rendere_loop(loop: dict) -> np.ndarray:
    """Renders two cycles and keeps the second, so the tail of the first cycle sounds at the start (seamless).
    A peak above -1 dBFS is scaled down. Shape (beats * 22500, 2)."""
    from . import render
    frames = loop["beats"] * BEAT_FRAMES
    graph = DJK / "instruments" / "modular_dsp" / "demos" / f"{loop['graph']}.json"
    dauer = 2 * loop["beats"] * 60.0 / BPM + 0.01  # a little over, the slice below is exact
    with tempfile.TemporaryDirectory(prefix="starter-render-") as tmp:
        wav = Path(tmp) / "l.wav"
        render.render_hits(graph, wav, _hits(loop, 2), dauer, loop["off_beats"] * 60.0 / BPM)
        x = render.lies_wav_f32(wav)
    x = x[frames:2 * frames]
    if x.shape[0] < frames:
        x = np.concatenate([x, np.zeros((frames - x.shape[0], 2), dtype="float32")])
    x = np.array(x, dtype="float32")
    spitze = float(np.abs(x).max())
    if spitze > SPITZE:
        x *= np.float32(SPITZE / spitze)
    return x


def _rendere(loop: dict) -> np.ndarray:
    return rendere_loop(loop)


def baue_loops(wurzel: Path | None = None, instanz: str = "") -> dict[str, str]:
    """Writes the loops that are absent; returns {loop: "neu" | "behalten"}. Rendering (cargo) only happens for a loop
    that has to be written. Each new loop also lands as a WAV in the starter sound folder (library root, task 13)."""
    wurzel = wurzel or loop_ordner(instanz)
    ergebnis: dict[str, str] = {}
    for loop in beschreibung():
        if os.path.lexists(wurzel / loop["name"]):
            ergebnis[loop["name"]] = "behalten"
            continue
        x = _rendere(loop)
        ergebnis[loop["name"]] = ablage.schreibe_loop(wurzel, loop["name"], loop["beats"], x, f"starter:{loop['graph']}")
        from . import render
        graphen.schreibe_wenn_fehlt(render.schreibe_wav_f32(x, RATE), _wav_ordner() / f"{loop['name']}_{BPM}bpm.wav")
    return ergebnis
