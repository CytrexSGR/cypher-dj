"""Detektor v1: Neuheit je Band an Taktgrenzen, Bevorzugung von Phrasengrenzen, Klassen.

Neuheit an Grenze i (zwischen Takt i-1 und i): d_b = mittel(dB_b[i:i+w]) - mittel(dB_b[i-w:i]).
Wert = Summe g_b * |d_b| (dB). Phrasenbonus multipliziert den Wert an 8/16/32-Takt-Grenzen
(relativ zum Phrasenversatz). Spitzen: lokales Maximum im Radius, Wert >= Schwelle, Mindestabstand.
"""
from dataclasses import dataclass, field, asdict
import numpy as np

from . import merkmale


@dataclass
class Parameter:
    """Voreinstellung = v1 (auf dev 60 Tracks gewaehlt, berichte/messung.json). PROFILE["v2"]: auf
    dev_gross 508 Tracks gewaehlt (berichte/messung_v2.json), zaehlt nur Zunahmen."""
    w: int = 2                       # Fensterbreite in Takten je Seite
    gewichte: tuple = (1.0, 1.0, 1.0)  # tief, mitte, hoch
    boden_db: float = 60.0           # dB unter Bandmaximum werden abgeschnitten
    schwelle_db: float = 6.0         # Mindestwert (roh) fuer einen Vorschlag
    bonus: dict = field(default_factory=lambda: {4: 0.25, 8: 0.6, 16: 1.0, 32: 1.2})
    phase: str = "anker"             # Phrasenversatz: "anker" (Takt 0) oder "geschaetzt"
    radius: int = 2                  # lokales Maximum ueber +-radius Takte
    min_abstand: int = 2             # Takte zwischen zwei Vorschlaegen
    max_je_min: float = 3.0          # Deckel: Vorschlaege je Minute (None = kein Deckel)
    anfang: bool = True              # Klasse "anfang" am ersten Takt mit Musik
    klasse_db: float = 5.0           # |d_tief| ab hier: break / drop-rein
    mehr_db: float = 3.0             # d_mitte/d_hoch ab hier: mehr rein / weniger
    richtung: str = "beide"          # "beide": |d|; "steigend": nur Zunahmen zaehlen (max(d, 0))

    def als_dict(self):
        d = asdict(self)
        d["bonus"] = {str(k): v for k, v in self.bonus.items()}
        d["gewichte"] = list(self.gewichte)
        return d


PROFILE = {
    "v1": {},
    "v2": {"gewichte": (1.0, 0.5, 1.0), "schwelle_db": 2.0, "richtung": "steigend"},
}


def profil(name):
    return Parameter(**PROFILE[name])


def neuheit(db, w):
    """db: n x 3 (NaN erlaubt). -> d (n x 3) mit d[i] = rechts - links; Grenzen ohne 2 gueltige
    Takte je Seite bekommen 0."""
    n = len(db)
    d = np.zeros_like(db)
    for i in range(1, n):
        li = db[max(0, i - w):i]
        re = db[i:i + w]
        ol = ~np.isnan(li[:, 0])
        orr = ~np.isnan(re[:, 0])
        if ol.sum() < min(2, w) or orr.sum() < min(2, w):
            continue
        d[i] = re[orr].mean(axis=0) - li[ol].mean(axis=0)
    return d


def phrasen_stufe(nummer, versatz):
    k = int(nummer) - int(versatz)
    for s in (32, 16, 8, 4):
        if k % s == 0:
            return s
    return 0


def phrasen_versatz(nummern, wert):
    s = [wert[(nummern - o) % 8 == 0].sum() for o in range(8)]
    return int(np.argmax(s))


def aufbereiten(db, p):
    db = db.copy()
    for j in range(3):
        mx = np.nanmax(db[:, j]) if np.any(~np.isnan(db[:, j])) else 0.0
        db[:, j] = np.maximum(db[:, j], mx - p.boden_db)
    return db


def werte(db, p):
    d = neuheit(aufbereiten(db, p), p.w)
    g = np.asarray(p.gewichte)
    x = np.maximum(d, 0) if getattr(p, "richtung", "beide") == "steigend" else np.abs(d)
    return d, (x * g).sum(axis=1)


def klasse(d, fl_links, fl_rechts, p):
    tief, mitte, hoch = d
    if tief <= -p.klasse_db:
        return "break"
    if tief >= p.klasse_db and (tief + mitte + hoch) > 0:
        return "drop/rein"
    if max(mitte, hoch) >= p.mehr_db:
        if mitte >= p.mehr_db and fl_links > 0 and fl_rechts < 0.85 * fl_links and abs(tief) < p.klasse_db:
            return "vocal?"
        return "mehr rein"
    if min(mitte, hoch) <= -p.mehr_db:
        return "weniger"
    return "wechsel"


def erkenne(db, fl, raster, p=None, dauer_s=None):
    """-> (vorschlaege, info). db/fl je Takt passend zu raster['nummern']."""
    p = p or Parameter()
    nummern = raster["nummern"]
    starts = raster["starts"]
    d, wert = werte(db, p)
    versatz = 0 if p.phase == "anker" else phrasen_versatz(nummern, wert)
    stufe = np.array([phrasen_stufe(k, versatz) for k in nummern])
    faktor = 1.0 + np.array([p.bonus.get(int(s), 0.0) for s in stufe])
    adj = wert * faktor
    kandidaten = []
    for i in range(len(adj)):
        if wert[i] < p.schwelle_db:
            continue
        lo, hi = max(0, i - p.radius), min(len(adj), i + p.radius + 1)
        if adj[i] >= adj[lo:hi].max():
            kandidaten.append(i)
    kandidaten.sort(key=lambda i: -adj[i])
    dauer = dauer_s if dauer_s is not None else (starts[-1] + raster["takt_s"])
    deckel = None if p.max_je_min is None else max(1, int(round(p.max_je_min * dauer / 60.0)))
    gewaehlt = []
    for i in kandidaten:
        if deckel is not None and len(gewaehlt) >= deckel:
            break
        if all(abs(i - j) >= p.min_abstand for j in gewaehlt):
            gewaehlt.append(i)
    ref = 24.0
    vors = []
    for i in sorted(gewaehlt):
        fl_l = np.nanmean(fl[max(0, i - p.w):i]) if i > 0 else 0.0
        fl_r = np.nanmean(fl[i:i + p.w])
        vors.append({"sekunde": round(float(starts[i]), 3), "takt": int(nummern[i]),
                     "phrase": int(stufe[i]) or None,
                     "klasse": klasse(d[i], float(np.nan_to_num(fl_l)), float(np.nan_to_num(fl_r)), p),
                     "staerke": round(float(min(1.0, adj[i] / ref)), 3),
                     "wert_db": round(float(wert[i]), 2),
                     "baender_db": {b: round(float(d[i][j]), 2) for j, b in enumerate(merkmale.BAND_NAMEN)}})
    if p.anfang:
        tot = 10 * np.log10(np.nansum(10 ** (db / 10), axis=1) + 1e-10)
        gueltig = ~np.isnan(db[:, 0])
        if gueltig.any():
            med = np.nanmedian(tot[gueltig])
            erste = next((i for i in range(len(tot)) if gueltig[i] and tot[i] > med - 15), None)
            if erste is not None and all(abs(v["takt"] - int(nummern[erste])) >= 2 for v in vors):
                vors.append({"sekunde": round(float(max(0.0, starts[erste])), 3), "takt": int(nummern[erste]),
                             "phrase": int(stufe[erste]) or None, "klasse": "anfang", "staerke": 0.5,
                             "wert_db": 0.0, "baender_db": {b: 0.0 for b in merkmale.BAND_NAMEN}})
                vors.sort(key=lambda v: v["sekunde"])
    return vors, {"phrasen_versatz": versatz, "wert": wert, "adj": adj}


def eins_waehler_fuer(fm, p=None):
    """Punktzahl einer Takt-Eins-Lage: Beat-Neuheit (je Band, 4 Beats je Seite) wird fuer alle Lagen
    gleich berechnet; gezaehlt wird die Summe der Quadrate an den Beats, die in dieser Lage Takt-Eins
    sind. Strukturwechsel fallen auf die Eins, also gewinnt die richtige Lage."""
    p = p or Parameter()

    def f(r):
        beat_s = r["takt_s"] / 4
        starts = (r["starts"][:, None] + np.arange(4)[None, :] * beat_s).ravel()
        db, _ = merkmale.takt_merkmale(fm, starts, beat_s)
        _, wert = werte(db, Parameter(w=4, boden_db=p.boden_db, gewichte=p.gewichte))
        return float((wert[0::4] ** 2).sum())
    return f
