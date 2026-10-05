"""Tonart wie Mixed In Key, mit quelloffenen Verfahren: tonart(pfad) -> {camelot, konfidenz, ...}.

Gewählt nach Schritt 2a (Messung gegen MIK-TKEY, 600 Tracks, berichte/schritt2a_tonart.json):
  Grundton   Essentia KeyExtractor, Profil edma (PARAMETER unten)
  Geschlecht Moll, außer alle vier Stimmen (KeyExtractor edma, bgate, braw und libKeyFinder) nennen
             dieselbe Durtonart und edma ist sich sicher (Stärke >= DUR_SCHWELLE). Grund: MIK nennt in
             diesem Bestand 99 % Moll; die Dur-Aussagen der Profile sind fast immer die gleichnamige
             Molltonart bei MIK. Ohne Dur-Weg könnte die Funktion aber keine Durtonart erkennen
             (Probe: reiner C-Dur-Dreiklang), deshalb die strenge Ausnahme.
  Konfidenz  logistische Kalibrierung auf P(Treffer = MIK) aus edma-Stärke und der Zahl der Stimmen
             (edmm, bgate, braw, libKeyFinder), die denselben Grundton nennen. Koeffizienten aus der
             Stichprobe, geprüft über Artist-Hälften (Bericht).
Nur CPU, kein Ton.
"""
from __future__ import annotations

import math
import os
import subprocess
from pathlib import Path

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np

from .camelot import aus_keyfinder, aus_name, zu_camelot

SR = 44100
KF_CLI = Path.home() / "cypher-dj/cues/venv-mik/bin/keyfinder-stdin"
PARAMETER: dict = {}   # KeyExtractor-Standard; keine der 7 Varianten war über Artist-Hälften stabil besser (Bericht)
DUR_SCHWELLE = 0.9
# Dur-Weg je Modus (Schritt 3, Holdout): (Stimmen, die dieselbe Durtonart wie edma nennen müssen, Schwelle).
#   bestand  ausgeliefert, für diesen Bestand (MIK 99 % Moll): Holdout 120 artistfrei 76,7 %, MIK-Dur 33 % (8/24)
#   offen    für Material mit unbekanntem Dur-Anteil: Holdout 63,3 %, MIK-Dur 87,5 % (21/24).
#            Nach Ansicht der Dur-Tracks gebildet, also auf Dur-Seite optimistisch (Bericht Schritt 3).
#   moll     nie Dur (= dur_schwelle=None)
MODI = ("bestand", "offen", "moll")
DUR_STIMMEN_OFFEN = ("bgate", "braw")
# P(Treffer) = sigmoid(K0 + K_STAERKE * edma_staerke + K_EINIG * n_einig), angepasst in Schritt 2a
K0, K_STAERKE, K_EINIG = -3.9115, 2.6022, 1.0016

_es = None


def _essentia():
    global _es
    if _es is None:
        import essentia
        essentia.log.infoActive = False
        essentia.log.warningActive = False
        import essentia.standard as es
        _es = es
    return _es


def dekodiere(pfad: str | os.PathLike, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(pfad), "-ac", "1", "-ar", str(sr),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def _keyfinder(x: np.ndarray, sr: int) -> tuple[int, bool] | None:
    out = subprocess.run([str(KF_CLI), str(sr)], input=x.astype(np.float32).tobytes(),
                         capture_output=True, check=True).stdout.decode().split()
    return aus_keyfinder(int(out[0])) if out else None


def konfidenz(staerke: float, n_einig: int) -> float:
    z = K0 + K_STAERKE * staerke + K_EINIG * n_einig
    return 1.0 / (1.0 + math.exp(-z))


def entscheide(stimmen: dict[str, tuple[int, bool] | None], staerke_edma: float,
               dur_schwelle: float | None = DUR_SCHWELLE,
               dur_stimmen: tuple[str, ...] = ("bgate", "braw", "kf"),
               dur_weg: bool | None = None) -> tuple[int, bool, int]:
    """Regel aus Schritt 2a. stimmen: edma, edmm, bgate, braw, kf -> (grundton, moll) oder None.

    Rückgabe (grundton, moll, n_einig). Reine Funktion, damit dieselbe Regel auf dem Cache gemessen
    werden kann, die hier gerechnet wird.
    """
    g, moll_edma = stimmen["edma"]
    n_einig = sum(1 for k in ("edmm", "bgate", "braw", "kf") if stimmen.get(k) and stimmen[k][0] == g)
    # dur_weg=None: alte Bedeutung (dur_schwelle None = kein Dur-Weg); True: Dur-Weg, Schwelle None = ohne Schwelle
    if dur_weg is None:
        dur_weg = dur_schwelle is not None
    dur = (dur_weg and not moll_edma and (dur_schwelle is None or staerke_edma >= dur_schwelle)
           and all(stimmen.get(k) == (g, False) for k in dur_stimmen))
    return g, not dur, n_einig


def tonart_signal(x: np.ndarray, sr: int = SR, dur_schwelle: float | None = DUR_SCHWELLE,
                  modus: str = "bestand") -> dict:
    """modus: bestand (Standard), offen (unbekannter Dur-Anteil), moll (nie Dur). dur_schwelle=None heißt wie
    bisher: kein Dur-Weg (gilt nur im Modus bestand)."""
    es = _essentia()
    stimmen, staerke = {}, {}
    for prof in ("edma", "edmm", "bgate", "braw"):
        key, scale, st = es.KeyExtractor(profileType=prof, sampleRate=sr, **PARAMETER)(x)
        stimmen[prof], staerke[prof] = aus_name(key, scale), float(st)
    stimmen["kf"] = _keyfinder(x, sr) if KF_CLI.exists() else None
    if modus == "bestand":
        g, moll, n_einig = entscheide(stimmen, staerke["edma"], dur_schwelle)
    elif modus == "offen":
        g, moll, n_einig = entscheide(stimmen, staerke["edma"], None, DUR_STIMMEN_OFFEN, dur_weg=True)
    elif modus == "moll":
        g, moll, n_einig = entscheide(stimmen, staerke["edma"], None)
    else:
        raise ValueError(f"unbekannter modus {modus!r}, erlaubt: {sorted(MODI)}")
    return {"camelot": zu_camelot(g, moll),
            "konfidenz": round(konfidenz(staerke["edma"], n_einig), 3),
            "grundton": g, "moll": moll, "modus": modus, "n_einig": n_einig, "staerke_edma": round(staerke["edma"], 4),
            "stimmen": {k: (zu_camelot(*v) if v else None) for k, v in stimmen.items()}}


def tonart(pfad: str | os.PathLike, dur_schwelle: float | None = DUR_SCHWELLE, modus: str = "bestand") -> dict:
    """Tonart eines Audio-Files (alles, was ffmpeg liest) in Camelot, wie MIK sie schreiben würde."""
    return tonart_signal(dekodiere(pfad), SR, dur_schwelle, modus)


if __name__ == "__main__":
    import json
    import sys
    for p in sys.argv[1:]:
        print(p, json.dumps(tonart(p), ensure_ascii=False))
