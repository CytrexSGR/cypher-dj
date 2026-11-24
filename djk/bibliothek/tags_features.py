"""Pass B of the tag hook: spectral features of an audio file, character words and a coarse class from them.

`merkmale_von` reads at most one window of a file (`soundfile.read` with `start` and `frames`, so a 600 MB track never loads
whole), averages one 4096-point power spectrum and derives ten numbers. `charakter_aus` maps them to the measurable character
words by FIXED absolute thresholds (`SCHWELLEN`); `klasse_aus` gives a coarse instrument class where the catalogue has none.

Calibration (v2): the class rules were fitted on 347 real catalogue files that carry an instrument label (seed 1 of
~/messungen/2026-11-23-browser-7/passb.py) and checked on 357 other labelled files. A class stays only where its precision on
both sets is high; bass, snare, clap, tom, perc and synth were measured at 14 to 56 percent and are NOT written (the spectrum
cannot tell them apart from the neighbours). The character thresholds have no labels to be measured against: they were moved so
that no judgement word marks more than about a third of the real files (a word that fits most files says nothing). The words
of real material remain for the ear to judge.

numpy and soundfile are imported here, at module level; tags_messen imports this module only when Pass B runs.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

MERKMAL_VERSION = 3          # 3: punchy and tight are no longer written (cached rows of v2 are measured again); 2: thresholds recalibrated against real labelled files
FENSTER = 4096               # points of the averaged spectrum
STILLE = 1e-4                # window RMS below this is silence: no words, no class
MIN_SAMPLES = 100            # shorter files give no features

# Character words. punchy and tight are not measured: they barely separate (punchy 31 % of drum classes vs 17 % of others), a user may still set them. Each entry names the measured correlate (the vocabulary's bedeutung.messgroesse) and the rule.
SCHWELLEN = {
    "bright": {"zentroid_hz": ("min", 3000.0)},                                  # high spectral centroid (27 % of real files)
    "dark": {"zentroid_hz": ("max", 200.0)},                                     # low spectral centroid (31 %, was 400 Hz: 39 %)
    "warm": {"anteil_tief_mitten": ("min", 0.30)},                               # share of the 100-200 Hz band
    "deep": {"zentroid_hz": ("max", 150.0), "anteil_sub": ("min", 0.70)},        # low centroid and share below 100 Hz (21 %, was 26 %)
    "airy": {"anteil_luft": ("min", 0.25)},                                      # share above 10 kHz
    "wide": {"seitenanteil": ("min", 0.20)},                                     # side share of the energy
    "mono": {"korrelation": ("min", 0.98)},                                      # left and right nearly identical (a fact of the file, not a judgement)
}
BAENDER = {"tiefst": (0.0, 40.0), "sub": (0.0, 100.0), "tief_mitten": (100.0, 200.0), "hoch": (4000.0, 10000.0), "luft": (10000.0, 1e9)}


def _lies(pfad: Path, max_s: float):
    try:
        info = sf.info(str(pfad))
        if info.frames < MIN_SAMPLES:
            return None, 0
        n = min(info.frames, int(max_s * info.samplerate))
        start = min(int(info.frames * 0.2), info.frames - n) if info.frames > n else 0
        daten, sr = sf.read(str(pfad), start=start, frames=n, dtype="float32", always_2d=True)
    except (OSError, RuntimeError, ValueError):
        return None, 0
    if daten.shape[0] < MIN_SAMPLES:
        return None, 0
    return daten, sr


def merkmale_von(pfad: Path, max_s: float = 10.0) -> dict[str, float] | None:
    """The features of one window of the file, or None when it cannot be read or is shorter than 100 samples."""
    daten, sr = _lies(Path(pfad), max_s)
    if daten is None:
        return None
    mono = daten.mean(axis=1).astype(np.float64)
    rms = float(np.sqrt(np.mean(mono ** 2)))
    spitze = float(np.max(np.abs(mono)))

    # one averaged power spectrum over frames of FENSTER points (a short window is zero padded to one frame)
    if len(mono) < FENSTER:
        mono_p = np.pad(mono, (0, FENSTER - len(mono)))
    else:
        mono_p = mono
    fenster = np.hanning(FENSTER)
    starts = range(0, len(mono_p) - FENSTER + 1, FENSTER // 2)
    spektren = np.array([np.abs(np.fft.rfft(mono_p[s:s + FENSTER] * fenster)) ** 2 for s in starts])
    p = spektren.mean(axis=0)
    f = np.fft.rfftfreq(FENSTER, 1.0 / sr)
    gesamt = float(p.sum()) + 1e-30

    def anteil(lo: float, hi: float) -> float:
        return float(p[(f >= lo) & (f < hi)].sum() / gesamt)

    # fast decay: seconds from the envelope peak (10 ms blocks) until it falls below 10 percent of it; steady = whole window
    block = max(1, int(0.01 * sr))
    n_block = len(mono) // block
    if n_block >= 2:
        env = np.sqrt(np.mean(mono[:n_block * block].reshape(n_block, block) ** 2, axis=1))
        i = int(np.argmax(env))
        unter = np.nonzero(env[i:] < 0.1 * env[i])[0]
        abfall = float(unter[0] * block / sr) if len(unter) else len(mono) / sr
    else:
        abfall = len(mono) / sr

    # spectral flux: mean L1 change of the normalised spectrum between neighbouring frames
    if len(spektren) > 1:
        norm = spektren / (spektren.sum(axis=1, keepdims=True) + 1e-30)
        fluss = float(np.mean(np.abs(np.diff(norm, axis=0)).sum(axis=1)) / 2)
    else:
        fluss = 0.0

    if daten.shape[1] >= 2:
        links, rechts = daten[:, 0].astype(np.float64), daten[:, 1].astype(np.float64)
        mitte, seite = (links + rechts) / 2, (links - rechts) / 2
        em, es = float(np.sum(mitte ** 2)), float(np.sum(seite ** 2))
        seitenanteil = es / (em + es) if em + es > 1e-20 else 0.0
        sl, sr_ = float(links.std()), float(rechts.std())
        korrelation = float(np.corrcoef(links, rechts)[0, 1]) if sl > 1e-9 and sr_ > 1e-9 else 1.0
    else:
        seitenanteil, korrelation = 0.0, 1.0

    return {
        "zentroid_hz": float((f * p).sum() / gesamt),
        "anteil_tiefst": anteil(*BAENDER["tiefst"]),
        "anteil_sub": anteil(*BAENDER["sub"]),
        "anteil_tief_mitten": anteil(*BAENDER["tief_mitten"]),
        "anteil_hoch": anteil(*BAENDER["hoch"]),
        "anteil_luft": anteil(*BAENDER["luft"]),
        "crest": spitze / rms if rms > 0 else 0.0,
        "abfall": abfall,
        "seitenanteil": float(seitenanteil),
        "korrelation": korrelation,
        "fluss": fluss,
        "rms": rms,
        "dauer_s": len(mono) / sr,
    }


def _still(m: dict[str, float]) -> bool:
    return m.get("rms", 0.0) < STILLE


def charakter_aus(m: dict[str, float]) -> list[str]:
    """The character words whose thresholds all hold (silence has none)."""
    if _still(m):
        return []
    worte = []
    for wort, regeln in SCHWELLEN.items():
        if all((m[k] >= v) if art == "min" else (m[k] <= v) for k, (art, v) in regeln.items()):
            worte.append(wort)
    return worte


def klasse_aus(m: dict[str, float], art: str) -> str | None:
    """A coarse instrument class (kick or hihat) or None; only for loops and one-shots, never for silence.

    Measured on labelled real files (precision on 347 / 357 files): kick 0.78 / 0.76, hihat 0.83 / 0.81. Every other class
    the earlier rules gave was mostly wrong (the old bass rule marked 63 of 66 kicks as bass) and is not given any more.
    """
    if art not in ("loop", "oneshot") or _still(m):
        return None
    if m["zentroid_hz"] < 95 and m["anteil_sub"] > 0.6:
        return "kick"
    if m["zentroid_hz"] > 5500 and m["anteil_hoch"] + m["anteil_luft"] > 0.5 and m["anteil_sub"] < 0.01 and m["dauer_s"] < 3.0:
        return "hihat"
    return None
