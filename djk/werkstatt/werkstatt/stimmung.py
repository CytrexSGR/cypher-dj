"""Stimmung und Tonart der Quelle (SCHNITTSTELLEN §12.3 „Stimmung“, §13.2 `tonart`; ADR 012 Entscheidung 2).

Werkzeug 1 (eigen): Spektralspitzen und gewichtetes Kreismittel aus fa.py (`spitzen`, wie `stimmung_cent`),
dazu die Richtungsschaerfe R = |Summe| / Summe der Betraege. Werkzeug 2: Essentia TuningFrequencyExtractor,
Median ueber die Rahmen (wie proben/08-analyse-passung/nachpruefung/essentia_gegenprobe.py; AGPL-3.0, nur
Pruefmittel). Korrigiert wird nur, wenn R >= 0,1, beide auf hoechstens 10 Cent (Kreisabstand) uebereinstimmen
und ihr Kreismittel unter `stimmung_max_cent` (35) liegt; sonst keine Korrektur und eine Warnung.
Vorzeichen: stimmung_cent < 0 heisst zu tief; die Korrektur ist die angewandte Verschiebung = -Mittel
(Beispiel 09: stimmung_cent -8 -> stimmung_korrektur_cent +8)."""
import numpy as np

from . import fa

MAX_CENT = 35.0       # §2.1 stimmung_max_cent
EINIG_CENT = 10.0     # §12.3 „auf hoechstens 10 Cent“
R_MIN = 0.1           # ADR 012 Entscheidung 2 „mit R >= 0,1“


def kreis_abstand(a, b):
    """a - b in Cent auf dem Kreis [-50, 50)."""
    return float((a - b + 50.0) % 100.0 - 50.0)


def kreis_mittel(a, b):
    z = np.exp(2j * np.pi * a / 100.0) + np.exp(2j * np.pi * b / 100.0)
    return float(np.angle(z) / (2 * np.pi) * 100.0)


def eigen(x_mono48):
    """(cent, R) aus Spektralspitzen 30 bis 2000 Hz; (None, None) ohne Spitzen."""
    f, mag = fa.spitzen(np.asarray(x_mono48, dtype=float))
    if len(f) == 0:
        return None, None
    st = 12 * np.log2(f / 440.0)
    z = (mag * np.exp(2j * np.pi * (st - np.round(st)))).sum()
    return float(np.angle(z) / (2 * np.pi) * 100.0), float(np.abs(z) / mag.sum())


def essentia_cent(x_mono44):
    import essentia.standard as es
    tf = np.asarray(es.TuningFrequencyExtractor()(np.asarray(x_mono44, dtype=np.float32)))
    tf = tf[np.isfinite(tf) & (tf > 0)]
    return None if len(tf) == 0 else float(1200.0 * np.log2(np.median(tf) / 440.0))


def tonart(x_mono48, stimmung_cent):
    c = fa.chroma(np.asarray(x_mono48, dtype=float), stimmung_cent)
    t = fa.tonart_aus_chroma(c)
    return {"camelot": t["camelot"], "r": t["r"], "vorsprung": t["vorsprung"]}


def entscheide(c_eigen, r, c_zweit, max_cent=MAX_CENT, einig_cent=EINIG_CENT, r_min=R_MIN):
    """Rueckgabe {korrektur_cent, grund, warnung}; warnung ist None, wenn korrigiert wird."""
    if c_eigen is None or c_zweit is None or r is None:
        return {"korrektur_cent": 0.0, "grund": "unbestimmt", "warnung": "Stimmung nicht bestimmbar, nicht korrigiert"}
    if r < r_min:
        return {"korrektur_cent": 0.0, "grund": "r_klein",
                "warnung": f"Stimmung unsicher (R {r:.2f} unter {r_min:g}), nicht korrigiert"}
    d = kreis_abstand(c_eigen, c_zweit)
    if abs(d) > einig_cent:
        return {"korrektur_cent": 0.0, "grund": "uneinig",
                "warnung": f"Stimmung uneinig ({c_eigen:+.1f} gegen {c_zweit:+.1f} ct), nicht korrigiert"}
    m = kreis_mittel(c_eigen, c_zweit)
    if abs(m) >= max_cent:
        return {"korrektur_cent": 0.0, "grund": "zu_weit",
                "warnung": f"Stimmung {m:+.1f} ct, nicht unter {max_cent:g} ct, nicht korrigiert"}
    return {"korrektur_cent": round(-m, 1), "grund": "korrigiert", "warnung": None}
