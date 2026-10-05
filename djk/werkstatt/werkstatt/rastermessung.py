"""Messinstrument fuer die Warp-Mechanik: Einsaetze eines Klick-Signals am Ausgang gegen das starre Raster
der Basis. Verfahren wortgleich wie `auswerten` in proben/07-werkstatt-zerleger/b_timemap.py (Hochpass
500 Hz, messwerk.anschlaege mit 2-ms-Fenster, Schwelle 0,3, Ruhe 60 ms; Rest gegen ein starres Raster
mit freier Phase, entwirrt, Median ab). Taugt nur fuer Klick-Kontrollen, nicht fuer Musik (dafuer das
Tief-Band-Instrument aus fa.py in Scheibe 23)."""
import subprocess
import numpy as np

from .messwerk import anschlaege, paare, raster_rest

SR = 48000


def lade_f32_mono_hp(pfad, af="highpass=500"):
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2",
           "-i", str(pfad), "-ac", "1", "-af", af, "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype="<f4").astype(float)


def miss_starr(pfad_f32, basis_bpm, soll_s=None):
    """Rest der Einsaetze gegen das starre Raster 60/basis_bpm. soll_s: erwartete Einsatzzeiten (s) am
    Ausgang (erster_schlag_frame + q * Periode), dann zusaetzlich der absolute Abstand."""
    periode = 60.0 / basis_bpm
    x = lade_f32_mono_hp(pfad_f32)
    t = anschlaege(x, SR, fenster_ms=2.0, schwelle=0.3, ruhe_ms=60.0)
    r = raster_rest(t, periode)
    pm = periode * 1000
    for i in range(1, len(r)):
        r[i] += round((r[i - 1] - r[i]) / pm) * pm
    r = r - np.median(r)
    e = {"einsaetze": int(len(t)), "rest_rms_ms": round(float(np.sqrt((r ** 2).mean())), 2),
         "rest_max_ms": round(float(np.abs(r).max()), 2),
         "drift_linear_ms_pro_min": round(float(np.polyfit(t, r, 1)[0] * 60), 2) if len(t) > 3 else None}
    if soll_s is not None:
        d = paare(t, np.asarray(soll_s, dtype=float), fang_s=0.03)
        e["gegen_soll"] = {"gepaart": int(len(d)), "von": int(len(soll_s)),
                           "mittel_ms": round(float(d.mean()), 2) if len(d) else None,
                           "max_abs_ms": round(float(np.abs(d).max()), 2) if len(d) else None}
    return e
