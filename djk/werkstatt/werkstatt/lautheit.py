"""Lautheit der Quelle (`material.json` `lautheit_quelle`) und der Fassung (`fassung.json` `lautheit`, daraus
setzt der Kern beim Laden den Trim, SCHNITTSTELLEN §1.5, §13.2). Verfahren aus fa.py (`lautheit`: BS.1770-4
mit Gates, Echtspitze per 4-fach-Ueberabtastung, Crest = Spitze gegen RMS); `lufs_je_takt` ungegatet je Takt
ab der Takt-Eins der Fassung (fa.py rechnet ab Sample 0, die Fassung zaehlt Takte ab `erste_eins_quell_beat`)."""
import numpy as np

from . import fa


def lautheit(x):
    """x: (n, 2) float bei 48 kHz. Rueckgabe lufs_integriert, echtspitze_dbtp, crest_db."""
    d = fa.lautheit(np.asarray(x, dtype=np.float64))
    return {"lufs_integriert": float(d["lufs"]), "echtspitze_dbtp": float(d["true_peak_dbtp"]),
            "crest_db": float(d["crest_db"])}


def lufs_je_takt(x, ab_frame, frames_je_takt):
    """Ungegatete Lautheit je vollem Takt ab `ab_frame`; stille Takte als None (Schema erlaubt null)."""
    z = fa.k_filter(np.asarray(x, dtype=np.float64))
    werte = []
    for a in range(int(ab_frame), len(z) - int(frames_je_takt) + 1, int(frames_je_takt)):
        ms = float(np.mean(z[a:a + int(frames_je_takt)] ** 2, axis=0).sum())
        werte.append(None if ms <= 1e-12 else round(-0.691 + 10.0 * np.log10(ms), 2))
    return werte
