"""Takt-Eins der Quelle (SCHNITTSTELLEN §1.1 `erste_eins_quell_beat`, §12.3 Tor `eins`).

Verfahren 1 (beat_this): jede erkannte Downbeat-Zeit im Bereich der Karte wird auf den naechsten
ganzen quell_beat gelegt; die Lage mod 4, die am haeufigsten vorkommt, ist die Eins.
Verfahren 2 (Tief-Band, Zweitverfahren nach §12.3): Energie 30 bis 250 Hz im ersten Sechzehntel
jedes ganzen quell_beat (wie `energie_profil16` in proben/08-analyse-passung/fa.py, dort Baender
sub 30-90 und tief 90-250), gemittelt je Lage mod 4; die staerkste Lage ist die Eins."""
import numpy as np
from scipy import signal


def eins_beat_this(downbeats, karte):
    """Rueckgabe (eins 0..3 oder None, zaehlung je Lage [4])."""
    d = np.asarray(downbeats, dtype=float)
    d = d[(d >= karte.sekunden[0]) & (d <= karte.sekunden[-1])]
    if len(d) == 0:
        return None, [0, 0, 0, 0]
    lage = np.rint(karte.beat_bei(d)).astype(int) % 4
    zaehl = np.bincount(lage, minlength=4)
    return int(np.argmax(zaehl)), [int(v) for v in zaehl]


def eins_tiefband(x, sr, karte, lo=30.0, hi=250.0):
    """Rueckgabe (eins 0..3, vorsprung, energie je Lage [4]); vorsprung = (erste - zweite) / erste."""
    sos = signal.butter(4, [lo, hi], "bandpass", fs=sr, output="sos")
    y = signal.sosfiltfilt(sos, np.asarray(x, dtype=float))
    kum = np.concatenate([[0.0], np.cumsum(y * y)])
    q = np.arange(0, int(np.floor(karte.beats[-1] - 0.25)) + 1)
    a = np.clip(np.rint(karte.sekunde_bei(q) * sr).astype(int), 0, len(y))
    b = np.clip(np.rint(karte.sekunde_bei(q + 0.25) * sr).astype(int), 0, len(y))
    e = (kum[b] - kum[a]) / np.maximum(1, b - a)
    energie = np.array([e[q % 4 == k].mean() if np.any(q % 4 == k) else 0.0 for k in range(4)])
    folge = np.sort(energie)
    vorsprung = float((folge[-1] - folge[-2]) / folge[-1]) if folge[-1] > 0 else 0.0
    return int(np.argmax(energie)), round(vorsprung, 3), [float(v) for v in energie]
