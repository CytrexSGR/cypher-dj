"""Light analysis of catalogued samples (browser plan 1): the tempo of loops and the root note of one-shots.

numpy and scipy only. The values are estimates for sorting and searching, not measurements: the tempo is snapped so that the clip is a
whole number of bars (a prior prefers 1, 2, 4, 8 and 16 bars, the lengths loops are cut to; the tempo carries a confidence, `bpm_sicher`,
and only a sure one becomes the catalogue's `bpm`, a guess goes to `bpm_geschaetzt`), the root note is stored as the minor key of that note (the true mode is not known). Results are written to the
feature cache (`MerkmalCache.ergaenze`), never to the catalogue file; the next build reads them from there. Every file that was tried
gets the marker `cypher_analyse`, so a failed or unpitched file is not tried again.
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from key_energy.camelot import aus_name, zu_camelot

MARKER = "cypher_analyse"
MAX_SEKUNDEN = 30
MIN_BPM, MAX_BPM = 70.0, 180.0
TAKT_TOLERANZ = 0.03            # the clip length may differ from a whole number of bars by this much (tempo window of the autocorrelation)
MIN_TEMPO_SCORE = 0.12          # below this the onset envelope is not periodic enough to call a tempo sure
MIN_GESCHAETZT_SCORE = 0.05     # below this not even a guess is named
TAKT_ZAHLEN = (1, 2, 4, 8, 16)  # loops are cut to these bar counts; any other count is a prior against (NICHT_POT_FAKTOR)
NICHT_POT_FAKTOR = 0.5
SICHER_ABSTAND = 1.25           # a sure tempo beats the other power-of-two bar counts in the window by this factor
MIN_KLARHEIT = 0.85             # normalised autocorrelation peak below which the sound counts as unpitched
STILLE_RMS = 1e-4
_TONNAMEN = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def _np():
    import numpy as np
    return np


def _onset_huelle(x, sr: int):
    """Spectral-flux onset envelope: (envelope, frames per second)."""
    np = _np()
    n_fft, hop = 1024, 256
    if len(x) < n_fft * 2:
        return None, 0.0
    fenster = np.hanning(n_fft).astype("float32")
    n = 1 + (len(x) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    spek = np.abs(np.fft.rfft(x[idx] * fenster, axis=1))
    spek = np.log1p(spek * 20.0)
    fluss = np.maximum(spek[1:] - spek[:-1], 0.0).sum(axis=1)
    return fluss - fluss.mean(), sr / hop


def _autokorrelation(h):
    np = _np()
    n = len(h)
    f = np.fft.rfft(h, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    return ac / ac[0] if ac[0] > 0 else ac


def _wert(ac, lag: float, rel: float) -> float:
    """Largest autocorrelation value within `rel` of a (fractional) lag."""
    lo = max(1, int(math.floor(lag * (1 - rel))))
    hi = min(len(ac) - 1, int(math.ceil(lag * (1 + rel))))
    return float(ac[lo:hi + 1].max()) if hi >= lo else 0.0


def _kandidaten(x, sr: int) -> list[tuple[int, float, float]]:
    """[(bars, bpm, raw score)] for every bar count in the 70 to 180 BPM window; empty for clips too short, silent or aperiodic data."""
    np = _np()
    x = np.asarray(x, dtype="float32")
    dauer = len(x) / sr if sr > 0 else 0.0
    if dauer < 4 * 60 / MAX_BPM or float(np.sqrt(np.mean(x * x))) < STILLE_RMS:
        return []
    huelle, fps = _onset_huelle(x, sr)
    if huelle is None or float(np.abs(huelle).max()) == 0.0:
        return []
    ac = _autokorrelation(huelle)
    aus: list[tuple[int, float, float]] = []
    for takte in range(max(1, math.ceil(dauer * MIN_BPM / 240)), int(dauer * MAX_BPM / 240) + 1):
        bpm = takte * 240.0 / dauer
        if not MIN_BPM <= bpm <= MAX_BPM:
            continue
        lag = fps * 60.0 / bpm
        if lag * 3 * (1 + TAKT_TOLERANZ) >= len(ac):
            continue
        punkte = [_wert(ac, lag * k, TAKT_TOLERANZ) for k in (1, 2, 3)]
        score = (punkte[0] + 0.5 * punkte[1] + 0.25 * punkte[2]) / 1.75
        score *= math.exp(-0.5 * (math.log2(bpm / 120.0) / 0.6) ** 2)   # a mild prior for the common range settles half/double time
        aus.append((takte, bpm, score))
    return aus


def bewerte_tempo(x, sr: int) -> tuple[float, bool] | None:
    """(bpm, sicher) of a loop, or None. Loops are cut to 1, 2, 4, 8 or 16 bars, so a bar count that is not one of these is penalised (prior).

    `sicher` only when the signal and the prior agree: the winner is a power-of-two bar count, it is also the best candidate by the raw signal,
    its score reaches MIN_TEMPO_SCORE, and no other power-of-two bar count in the window scores within SICHER_ABSTAND of it. Everything else that
    still gets a value (a power-of-two winner above MIN_GESCHAETZT_SCORE) is a guess: the caller must not treat it as a fact."""
    kand = _kandidaten(x, sr)
    if not kand:
        return None
    gewichtet = [(t, b, sc * (1.0 if t in TAKT_ZAHLEN else NICHT_POT_FAKTOR), sc) for t, b, sc in kand]
    takte, bpm, gew, roh = max(gewichtet, key=lambda c: c[2])
    if takte not in TAKT_ZAHLEN or roh < MIN_GESCHAETZT_SCORE:
        return None
    bester_roh = max(c[3] for c in gewichtet)
    pot_andere = [c[3] for c in gewichtet if c[0] in TAKT_ZAHLEN and c[0] != takte]
    sicher = (roh >= MIN_TEMPO_SCORE and roh >= bester_roh and (not pot_andere or roh >= SICHER_ABSTAND * max(pot_andere)))
    return round(bpm, 1), sicher


def schaetze_tempo(x, sr: int) -> float | None:
    """Tempo in BPM of a loop (see `bewerte_tempo`), sure or not; None when no bar-aligned tempo can be named."""
    r = bewerte_tempo(x, sr)
    return r[0] if r else None


def _f0(seg, sr: int) -> tuple[float, float] | None:
    """(f0 in Hz, clarity) of one segment from its bias-corrected normalised autocorrelation; None below MIN_KLARHEIT."""
    np = _np()
    if len(seg) < 2048 or float(np.sqrt(np.mean(seg * seg))) < STILLE_RMS:
        return None
    fenster = np.hanning(len(seg)).astype("float32")
    s = (seg - seg.mean()) * fenster
    n = len(s)
    ac = np.fft.irfft(np.abs(np.fft.rfft(s, 2 * n)) ** 2)[:n]
    wac = np.fft.irfft(np.abs(np.fft.rfft(fenster, 2 * n)) ** 2)[:n]
    ac = ac / np.maximum(wac, 1e-9 * wac[0])   # undo the triangular bias of the windowed autocorrelation
    if ac[0] <= 0:
        return None
    ac = ac / ac[0]
    lmin, lmax = int(sr / 1200), min(int(sr / 30), n // 2)
    if lmax <= lmin + 2:
        return None
    teil = ac[lmin:lmax]
    hoechst = float(teil.max())
    if hoechst < MIN_KLARHEIT:
        return None
    kandidaten = [i for i in range(1, len(teil) - 1) if teil[i] >= teil[i - 1] and teil[i] >= teil[i + 1] and teil[i] >= 0.9 * hoechst]
    if not kandidaten:
        return None
    i = kandidaten[0]
    a, b, c = float(teil[i - 1]), float(teil[i]), float(teil[i + 1])
    nenner = a - 2 * b + c
    lag = lmin + i + (0.5 * (a - c) / nenner if nenner != 0 else 0.0)
    return sr / lag, hoechst


def schaetze_grundton(x, sr: int) -> str | None:
    """Root note of a one-shot as a Camelot minor code ('8A' for A minor); None when unpitched (noise, drums) or silent.

    f0 from the normalised autocorrelation of two segments of the loudest half second (after the attack), 150 ms apart (50 ms when the
    sound is short): clarity below MIN_KLARHEIT in either one, or a pitch that moves more than 0.04 octave (a kick's sweep), is rejected."""
    np = _np()
    x = np.asarray(x, dtype="float32")
    if len(x) < sr // 10 or float(np.sqrt(np.mean(x * x))) < STILLE_RMS:
        return None
    halb = max(sr // 2, 1)
    schritt = max(sr // 10, 1)
    start = max((float(np.sum(x[i:i + halb] ** 2)), i) for i in range(0, max(len(x) - halb, 0) + 1, schritt))[1] + int(0.05 * sr)
    nutz = x[start:]
    if len(nutz) >= 8192 + int(0.15 * sr):
        laenge, abstand = 8192, int(0.15 * sr)
    elif len(nutz) >= 4096 + int(0.05 * sr):
        laenge, abstand = 4096, int(0.05 * sr)
    else:
        return None
    a, b = _f0(nutz[:laenge], sr), _f0(nutz[abstand:abstand + laenge], sr)
    if a is None or b is None or abs(math.log2(a[0] / b[0])) > 0.04:
        return None
    midi = 69 + 12 * math.log2(a[0] / 440.0)
    return zu_camelot(*aus_name(_TONNAMEN[int(round(midi)) % 12], "minor"))


def _lies_audio(pfad: Path):
    """(mono float32 samples of at most MAX_SEKUNDEN, sample rate, full duration in seconds or None); raises on failure."""
    np = _np()
    try:
        import soundfile
        with soundfile.SoundFile(str(pfad)) as f:
            sr = f.samplerate
            gesamt = f.frames / sr if sr else None
            daten = f.read(frames=sr * MAX_SEKUNDEN, dtype="float32", always_2d=True)
        return daten.mean(axis=1), sr, gesamt
    except Exception:
        pass
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("no decoder")
    sr = 44100
    r = subprocess.run([exe, "-v", "error", "-t", str(MAX_SEKUNDEN), "-i", str(pfad), "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
                       capture_output=True, timeout=60)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("decoder failed")
    x = np.frombuffer(r.stdout[: len(r.stdout) // 4 * 4], dtype="<f4")
    return x, sr, None


def analysiere_datei(pfad: Path, typ: str) -> dict[str, str]:
    """`{'bpm': '128.0'}` for loops, `{'camelot': '8A'}` for one-shots, always with the tried marker; only the marker on any failure."""
    ergebnis = {MARKER: "1"}
    try:
        x, sr, gesamt = _lies_audio(Path(pfad))
        if typ == "loop":
            if gesamt is None or gesamt <= MAX_SEKUNDEN + 0.5:   # a longer clip was cut: its length says nothing about whole bars
                r = bewerte_tempo(x, sr)
                if r:
                    ergebnis["bpm"] = f"{r[0]:.1f}"
                    ergebnis["bpm_sicher"] = "1" if r[1] else "0"
        elif typ == "oneshot":
            key = schaetze_grundton(x, sr)
            if key:
                ergebnis["camelot"] = key
    except Exception:
        pass
    return ergebnis


def _unter(pfad: str, ordner: list[str]) -> bool:
    return any(pfad == o or pfad.startswith(o.rstrip("/") + "/") for o in ordner)


def waehle(ziel: Path, unter: list[str], maximal: int | None):
    """Rows of the catalogue file (opened read only) that still need a value: [(typ, pfad)]."""
    import sqlite3
    ordner = sorted({os.path.abspath(u) for u in unter} | {os.path.realpath(u) for u in unter})
    db = sqlite3.connect(ziel.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        zeilen = db.execute("SELECT typ, pfad FROM katalog WHERE pfad IS NOT NULL AND "
                            "((typ='loop' AND bpm IS NULL) OR (typ='oneshot' AND (camelot IS NULL OR camelot='')))").fetchall()
    finally:
        db.close()
    rows = [(t, p) for t, p in zeilen if _unter(p, ordner)]
    return rows[:maximal] if maximal else rows


def analysiere(ziel: Path, unter: list[str], cache, maximal: int | None, tick) -> tuple[int, int]:
    """Analyses the selected rows two at a time and writes through `cache.ergaenze`. Returns (analysiert, mit_wert)."""
    todo: list[tuple[str, str, int, int]] = []
    for typ, pfad in waehle(ziel, unter, maximal):
        try:
            st = os.stat(pfad)
        except OSError:
            continue
        tags = cache.tags_von(pfad, st.st_size, st.st_mtime_ns)
        if tags is None or MARKER in tags:
            continue
        todo.append((typ, pfad, st.st_size, st.st_mtime_ns))
    analysiert = mit_wert = 0
    tick("analyse", 0, len(todo))
    with ThreadPoolExecutor(max_workers=2) as pool:
        ergebnisse = pool.map(lambda t: analysiere_datei(Path(t[1]), t[0]), todo)
        for n, ((typ, pfad, groesse, mtime), neu) in enumerate(zip(todo, ergebnisse), 1):
            if cache.ergaenze(pfad, groesse, mtime, neu):
                analysiert += 1
                mit_wert += 1 if ("bpm" in neu or "camelot" in neu) else 0
            tick("analyse", n, len(todo), letzter=n == len(todo))
    return analysiert, mit_wert
