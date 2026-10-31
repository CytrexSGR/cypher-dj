"""Takt-Eins der Quelle (INTERFACES §1.1 `erste_eins_quell_beat`, §12.3 Tor `eins`).

Verfahren 1 (beat_this): jede erkannte Downbeat-Zeit im Bereich der Karte wird auf den naechsten
ganzen quell_beat gelegt; die Lage mod 4, die am haeufigsten vorkommt, ist die Eins.
Verfahren 2 (Tief-Band, Zweitverfahren nach §12.3): Energie 30 bis 250 Hz im ersten Sechzehntel
jedes ganzen quell_beat (wie `energie_profil16` in proben/08-analyse-passung/fa.py, dort Baender
sub 30-90 und tief 90-250), gemittelt je Lage mod 4; die staerkste Lage ist die Eins.
Seit 2026-10-11 nur noch Messwert, nicht mehr Entscheidung: bei 4-auf-den-Boden ist der Vorsprung Rauschen (Median 0,0185
ueber 46 Tracks, ~/messungen/2026-10-11-grid-phase/BERICHT.md M4).

Entscheidung (`entscheide_eins`, Bericht M3/M5/M6): beat_this legt die Downbeat-Lage je 30-s-Chunk neu fest; bei
halbtaktsymmetrischen Loops ist die Mehrheit ueber den Song Zufall (Wahrheit war in 4 von 4 belegten Faellen die
Minderheit). Darum fuehrt die Entscheidung den Mehrheitsanteil mit und zieht, wo er unter 0,85 liegt und das
Kick-Kriterium (erster Kick im Kartenbereich = Takt-Eins) greift, bei Halbtakt-Abweichung die Kick-Lage vor."""
import numpy as np
from scipy import signal

MEHRHEIT_SCHWELLE = 0.85     # Anteil der Mehrheits-Lage an allen Downbeats im Kartenbereich
KICK_BESTAETIGT_MIN = 0.5     # darunter hat beat_this keine Meinung: ein Kick-Treffer ist kein zweiter Zeuge (Review B5)
KICK_KARTE_MAX_S = 1.0       # Kick-Kriterium nur, wenn die Karte hoechstens 1 s nach dem Dateianfang beginnt
KICK_MAX_BEAT = 16           # und der erste Kick in den ersten 16 Beats einsetzt


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


def eins_anteil(zaehlung):
    """Anteil der staerksten Lage an allen Stimmen (0.0 ohne Stimmen)."""
    z = [int(v) for v in zaehlung]
    return max(z) / sum(z) if sum(z) > 0 else 0.0


def _kickstaerke(x, sr, karte):
    """Je ganzem Kartenbeat die Tief-Huellkurve (40 bis 120 Hz, Hilbert, 30 Hz geglaettet), Maximum im Fenster
    [-20 ms, +60 ms] um den Schlag. Detektor aus ~/messungen/2026-10-11-grid-phase/skripte/erstkick.py."""
    x = np.asarray(x, dtype=float)
    y = signal.sosfiltfilt(signal.butter(4, [40, 120], "bandpass", fs=sr, output="sos"), x)
    env = signal.sosfiltfilt(signal.butter(2, 30, fs=sr, output="sos"), np.abs(signal.hilbert(y)))
    n = int(np.floor(karte.beats[-1]))
    t = karte.sekunde_bei(np.arange(0, n))
    a = np.clip(np.rint((t - 0.02) * sr).astype(int), 0, len(env))
    b = np.clip(np.rint((t + 0.06) * sr).astype(int), 0, len(env))
    return np.array([env[i:j].max() if j > i else 0.0 for i, j in zip(a, b)])


def erster_kick(x, sr, karte):
    """Erster Kick im Kartenbereich. Rueckgabe {anwendbar, beat, lage, grund}; beat/lage None, wenn nicht anwendbar.
    Kick = Staerke >= 0,5 und die drei Folgebeats >= 0,4 des 90. Perzentils. Anwendbar nur, wenn die Karte hoechstens
    KICK_KARTE_MAX_S nach dem Dateianfang beginnt und der Kick in den ersten KICK_MAX_BEAT Beats einsetzt (sonst ist der
    Anfang ein Intro und die DJ-Konvention „erster Kick = Eins“ sagt nichts)."""
    nein = lambda g: {"anwendbar": False, "beat": None, "lage": None, "grund": g}
    if float(karte.sekunden[0]) > KICK_KARTE_MAX_S:
        return nein(f"Karte beginnt erst bei {float(karte.sekunden[0]):.2f} s (Grenze {KICK_KARTE_MAX_S:g} s)")
    ks = _kickstaerke(x, sr, karte)
    if len(ks) < 4 or not np.isfinite(ks).all() or np.percentile(ks, 90) <= 0:
        return nein("kein Tief-Signal im Kartenbereich")
    r = ks / np.percentile(ks, 90)
    erster = next((i for i in range(len(r) - 3) if r[i] >= 0.5 and (r[i + 1:i + 4] >= 0.4).all()), None)
    if erster is None:
        return nein("kein Kick gefunden")
    if erster >= KICK_MAX_BEAT:
        return nein(f"erster Kick erst bei Beat {erster} (Grenze {KICK_MAX_BEAT})")
    return {"anwendbar": True, "beat": int(erster), "lage": int(erster % 4), "grund": f"erster Kick bei Beat {erster}"}


def entscheide_eins(mehrheit, zaehlung, kick):
    """Takt-Eins aus Mehrheit (beat_this), Anteil und erstem Kick. Rueckgabe
    {eins 0..3, anteil, kick_lage, quelle 'mehrheit'|'kick'|'keine', unsicher, grund}.
      kick anwendbar, Abweichung 2 (Halbtakt), Anteil < 0,85  -> Kick-Lage (quelle kick, sicher)
      kick anwendbar, Abweichung 1 oder 3                      -> Mehrheit bleibt, unsicher
      kick anwendbar, Abweichung 2, Anteil >= 0,85             -> Mehrheit bleibt, unsicher (Widerspruch bei klarer Mehrheit)
      kick anwendbar, gleiche Lage                             -> Mehrheit, sicher ab Anteil 0,5 (zwei Zeugen), darunter unsicher
      kick nicht anwendbar                                     -> Mehrheit, unsicher genau dann, wenn Anteil < 0,85
      keine Stimmen                                            -> Kick-Lage bzw. 0, unsicher (kein Tief-Band-Rueckgriff)"""
    anteil = round(eins_anteil(zaehlung), 3)
    kl = kick["lage"] if kick.get("anwendbar") else None
    e = {"anteil": anteil, "kick_lage": kl}
    if mehrheit is None:
        return {**e, "eins": 0 if kl is None else kl, "quelle": "keine" if kl is None else "kick", "unsicher": True,
                "grund": "keine Downbeats im Kartenbereich" + ("" if kl is None else ", Lage des ersten Kicks genommen")}
    if kl is None:
        schwach = anteil < MEHRHEIT_SCHWELLE
        return {**e, "eins": int(mehrheit), "quelle": "mehrheit", "unsicher": schwach,
                "grund": f"Anteil {anteil:.2f}" + (f" < {MEHRHEIT_SCHWELLE}, Kick nicht anwendbar" if schwach else "")}
    d = (kl - mehrheit) % 4
    if d == 0:
        schwach = anteil < KICK_BESTAETIGT_MIN
        return {**e, "eins": int(mehrheit), "quelle": "mehrheit", "unsicher": schwach,
                "grund": f"Anteil {anteil:.2f}, Kick stimmt zu" + (f", aber Anteil < {KICK_BESTAETIGT_MIN}: kein zweiter Zeuge" if schwach else " (bestaetigt)")}
    if d == 2 and anteil < MEHRHEIT_SCHWELLE:
        return {**e, "eins": int(kl), "quelle": "kick", "unsicher": False,
                "grund": f"Anteil {anteil:.2f} < {MEHRHEIT_SCHWELLE}, erster Kick liegt einen halben Takt von der Mehrheit ({mehrheit})"}
    return {**e, "eins": int(mehrheit), "quelle": "mehrheit", "unsicher": True,
            "grund": f"Kick weicht um {d if d != 3 else 1} Beat{'s' if d == 2 else ''} ab, Anteil {anteil:.2f}"}
