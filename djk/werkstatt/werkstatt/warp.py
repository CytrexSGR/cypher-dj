"""Warp per Timemap auf das starre Raster der Set-Basis (SCHNITTSTELLEN §12.3, §13.1; ADR 011 Entscheidung 2.3).

Die Karte der Quelle (§13.2 `tempo_karte_quelle`: quell_sekunde -> quell_beat) wird zur Timemap fuer
`rubberband -3 --timemap`: jeder Eintrag (s, q) geht von Quell-Frame round(s * 48000) auf Ziel-Frame
erster_schlag_frame + q * 60 / basis_bpm * 48000 (starres Raster, §13.1). Vor dem ersten und nach dem
letzten Eintrag gilt das Randtempo der Karte; daraus folgen erster_schlag_frame und die Ziellaenge.
Float rein, Float raus; die -12 dB Luft (08 NP K5) setzt der Aufrufer vorher (pegel.py). Die
Stimmungskorrektur laeuft im selben Aufruf (-p in Halbtoenen, §12.3)."""
import subprocess
from dataclasses import dataclass
from pathlib import Path
import numpy as np
import soundfile as sf

SR = 48000


def frames_je_beat(basis_bpm):
    """Ziel-Frames je quell_beat auf dem starren Raster (128 BPM: 22 500 exakt)."""
    return 60.0 / basis_bpm * SR


@dataclass
class Timemap:
    quelle: np.ndarray          # Quell-Frames der Anker (int64, streng steigend)
    ziel: np.ndarray            # Ziel-Frames der Anker (int64, streng steigend)
    erster_schlag_frame: int    # Ziel-Frame von quell_beat 0
    ziel_frames: int            # Laenge der Ausgabe


ANKER_ABSTAND_BEATS = 2.0   # Planprobe 15 (2026-09-23): Anker je Ziel-Beat lassen R3 driften
                            # (konst134: 0,57 ms RMS, -1,81 ms/min), je 2 Ziel-Beats starr (0,14 ms RMS)


def ausduennen(ziel, mindest_frames):
    """Indizes der Anker, die mindestens `mindest_frames` Ziel-Abstand zum vorigen behaltenen haben;
    der erste und der letzte bleiben immer."""
    behalten = [0]
    for j in range(1, len(ziel) - 1):
        if ziel[j] - ziel[behalten[-1]] >= mindest_frames:
            behalten.append(j)
    behalten.append(len(ziel) - 1)
    return np.array(behalten)


def timemap(karte, basis_bpm, quell_frames, abstand_beats=ANKER_ABSTAND_BEATS):
    """Anker aus der Karte (ausgeduennt auf `abstand_beats` Ziel-Beats); Randtempo aus den ersten bzw.
    letzten zwei Eintraegen der vollen Karte."""
    s = np.asarray(karte.sekunden, dtype=float)
    q = np.asarray(karte.beats, dtype=float)
    if len(s) < 2 or np.any(np.diff(s) <= 0) or np.any(np.diff(q) <= 0):
        raise ValueError("Karte muss mindestens zwei streng steigende Eintraege haben")
    fpb = frames_je_beat(basis_bpm)
    per_anfang = (s[1] - s[0]) / (q[1] - q[0])       # Quell-Sekunden je quell_beat am Anfang
    per_ende = (s[-1] - s[-2]) / (q[-1] - q[-2])
    null_s = s[0] - q[0] * per_anfang                # Quell-Sekunde von quell_beat 0
    if null_s < 0:
        raise ValueError(f"quell_beat 0 laege vor dem Dateianfang ({null_s:.3f} s)")
    erster = int(round(null_s / per_anfang * fpb))
    quelle = np.rint(s * SR).astype(np.int64)
    ziel = (erster + np.rint(q * fpb)).astype(np.int64)
    if quelle[-1] >= quell_frames:
        raise ValueError("Karte reicht ueber das Dateiende")
    ende = int(ziel[-1] + round((quell_frames - quelle[-1]) / (per_ende * SR) * fpb))
    i = ausduennen(ziel, abstand_beats * fpb - 0.5)
    return Timemap(quelle[i], ziel[i], erster, ende)


def schreibe_timemap(tm, pfad):
    with open(pfad, "w") as f:
        for a, b in zip(tm.quelle, tm.ziel):
            f.write(f"{int(a)} {int(b)}\n")


def warp(ein_wav, aus_wav, tm, korrektur_cent=0.0, mit_timemap=True):
    """rubberband R3 offline. ein_wav: Float-WAV 48 kHz Stereo (mit Luft). mit_timemap=False ist der
    FEHLERFALL aus b_timemap (`ohne_r3`: nur Zieldauer). Rueckgabe: Befehl als Liste."""
    aus_wav = Path(aus_wav)
    cmd = ["rubberband", "-3", "-q", "--ignore-clipping"]
    if mit_timemap:
        karte_datei = aus_wav.with_suffix(".timemap.txt")
        schreibe_timemap(tm, karte_datei)
        cmd += ["--timemap", str(karte_datei)]
    cmd += ["-D", f"{tm.ziel_frames / SR:.9f}"]
    if korrektur_cent:
        cmd += ["-p", f"{korrektur_cent / 100.0:.6f}"]
    cmd += [str(ein_wav), str(aus_wav)]
    subprocess.run(cmd, check=True, capture_output=True)
    return cmd


def lies_float_wav(pfad):
    y, sr = sf.read(str(pfad), dtype="float32", always_2d=True)
    if sr != SR or y.shape[1] != 2:
        raise ValueError(f"{pfad}: {sr} Hz, {y.shape[1]} Kanaele statt 48000 Hz Stereo")
    return y


def schreibe_f32(y, pfad):
    """basis.f32: float32, verschraenkt Stereo, Little Endian, ohne Kopf (§13.1)."""
    np.ascontiguousarray(y, dtype="<f4").tofile(str(pfad))


def lies_f32(pfad):
    return np.fromfile(str(pfad), dtype="<f4").reshape(-1, 2)
