"""The starter kits: sounds rendered from the shipped drum graphs, written in the core's kit format."""
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
AUSBLENDE = 240  # 5 ms, as kit_build.py AUSBLENDE
STILLE = 10 ** (-90 / 20)  # trailing samples below -90 dBFS are cut
SPITZE = 10 ** (-1 / 20)  # peak limit -1 dBFS
VELOCITY = 0.9
OFF_S = 0.125


def beschreibung() -> list[dict]:
    return json.loads((Path(__file__).with_name("kits.json")).read_text())


def bearbeite(x: np.ndarray) -> np.ndarray:
    """Cuts the silent tail, fades out 5 ms, scales a peak above -1 dBFS down to -1 dBFS."""
    laut = np.flatnonzero(np.abs(x).max(axis=1) >= STILLE)
    n = int(laut[-1]) + 1 if laut.size else 1
    x = np.array(x[:n], dtype="float32")
    aus = min(AUSBLENDE, n)
    x[n - aus:] *= np.linspace(1.0, 0.0, aus, dtype="float32")[:, None]
    spitze = float(np.abs(x).max())
    if spitze > SPITZE:
        x *= np.float32(SPITZE / spitze)
    return x


def _oneshot_ordner() -> Path:
    daten = os.environ.get("XDG_DATA_HOME")
    basis = Path(daten) if daten else Path.home() / ".local" / "share"
    return basis / "cypherdj" / "starter" / "klaenge" / "oneshots"


def _rendere(kit: dict) -> list[tuple[int, str, np.ndarray]]:
    from . import render
    quelle = DJK / "instruments" / "modular_dsp" / "demos" / f"{kit['graph']}.json"
    familie = kit["graph"].split("-")[-1]  # 909 | 808
    wavs = _oneshot_ordner() / familie
    klaenge = []
    with tempfile.TemporaryDirectory(prefix="starter-render-") as tmp:
        for k in kit["klaenge"]:
            wav = Path(tmp) / "k.wav"
            render.render_hits(quelle, wav, [(k["note"], 0.0, VELOCITY)], k["dauer_s"], OFF_S)
            x = bearbeite(render.lies_wav_f32(wav))
            klaenge.append((k["note"], k["name"], x))
            graphen.schreibe_wenn_fehlt(render.schreibe_wav_f32(x, RATE), wavs / (k["name"].replace(":", "-") + ".wav"))
    return klaenge


def baue_kits(wurzel: Path | None = None, nur: tuple[str, ...] | None = None) -> dict[str, str]:
    """Writes the kits that are absent; returns {kit: "neu" | "behalten" | "beschaedigt"} ("beschaedigt": the folder exists but the core would refuse it; it is kept). Rendering (cargo) only happens for a kit
    that has to be written. `gm` is written as a copy of `starter` when the folder has neither `gm` nor `techno`
    (an existing gm would stop sorgeFuerGmKit from building one from techno, gm_kit.ts:46-50)."""
    wurzel = wurzel or ablage.kit_ordner()
    ergebnis: dict[str, str] = {}
    for kit in beschreibung():
        if nur is not None and kit["name"] not in nur:
            continue
        ziel = wurzel / kit["name"]
        if os.path.lexists(ziel):
            grund = ablage.pruefe_kit(ziel)
            if grund:
                print(f"kept kit {kit['name']} (damaged: {grund}); delete the folder to have it rebuilt", file=sys.stderr)
            ergebnis[kit["name"]] = "beschaedigt" if grund else "behalten"
            continue
        ergebnis[kit["name"]] = ablage.schreibe_kit(wurzel, kit["name"], _rendere(kit))
    starter = wurzel / "starter"
    if (nur is None or "gm" in nur) and (nur is None or "starter" in nur) and starter.is_dir() \
            and not os.path.lexists(wurzel / "gm") and not os.path.lexists(wurzel / "techno") \
            and ablage.pruefe_kit(starter) is None:
        ergebnis["gm"] = ablage.kopiere_kit(wurzel, "starter", "gm")
    elif (nur is None or "gm" in nur) and os.path.lexists(wurzel / "gm"):
        ergebnis["gm"] = "behalten"
    return ergebnis
