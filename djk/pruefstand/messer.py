"""Messer des Chaos-Prüfstands (Scheibe 16), offline auf der Aufnahme am Ziel (SCHNITTSTELLEN §19.5).

Alle Funktionen arbeiten auf float-Arrays mit 48 kHz, Indizes sind Frames der Aufnahme.
- stille:        Dauer-Signal (Prüfton): Läufe, in denen alle Kanäle mindestens `mindest` Samples unter `schwelle` liegen
                 (Schwelle und Mindestlänge wie proben/10-robustheit-betrieb/f2/absturz/auswertung2.py).
- bloecke:       Block-Klassierung je Quantum: stille / gleich (wie der vorige Block) / neu (Vorlage auswertung2.py).
- spruenge:      Naht-Messer: |x[n] - x[n-1]| > schwelle (Vorlage nachpruefung/src/sprung.c), Klick-Einsätze ausgenommen.
- einsaetze:     Klick-Einsätze wie proben/01-audio-kern/a-cpp-jack/analyse_klick.py.
- phasen, raster_versatz, klick_pausen: Raster am Ziel ohne Kern-Protokoll (Phase jedes Klicks gegen das Beat-Raster).
- raster_luecken: Lücken am Ziel beim Kern mit Prüfklick: lässt der Kern einen Zyklus aus, läuft seine Uhr innen stetig
                 weiter und jeder spätere Klick kommt um eine Periode später an (Scheibe 08, auswertung_luecken.py).
- schleife_treue: Stille in voller Auflösung auch beim Prüfklick: in der Schleife gleicht jedes Frame dem Frame einen Takt
                 früher (die Notbahn spielt den letzten Takt aus ihrem Verlauf, SCHNITTSTELLEN §6.1, ADR 016).
"""
import numpy as np

SR = 48000


def laeufe(maske):
    """Zusammenhängende True-Läufe einer Maske: (anfaenge, laengen) als int64-Arrays."""
    m = np.asarray(maske, dtype=np.int8)
    d = np.diff(np.concatenate(([0], m, [0])))
    a = np.flatnonzero(d == 1)
    e = np.flatnonzero(d == -1)
    return a.astype(np.int64), (e - a).astype(np.int64)


def betrag(x):
    """Betrag über alle Kanäle: (n,) bleibt, (n, k) wird zum Maximum je Frame."""
    x = np.asarray(x, dtype=np.float64)
    return np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=1)


def stille(x, schwelle=1e-4, mindest=16):
    """Liste (anfang, laenge) aller Stellen, an denen das Signal mindestens `mindest` Samples lang unter `schwelle` bleibt."""
    a, l = laeufe(betrag(x) < schwelle)
    k = l >= mindest
    return [(int(s), int(n)) for s, n in zip(a[k], l[k])]


def bloecke(x, quantum):
    """Klasse je vollem Block: 'stille' (alle |x| < 1e-6), 'gleich' (bitgleich wie der vorige), 'neu'."""
    x = np.asarray(x, dtype=np.float32)
    n = len(x) // quantum
    klassen = []
    vorher = None
    for j in range(n):
        b = x[j * quantum:(j + 1) * quantum]
        if np.all(np.abs(b) < 1e-6):
            klassen.append("stille")
        elif vorher is not None and np.array_equal(b, vorher):
            klassen.append("gleich")
        else:
            klassen.append("neu")
        vorher = b
    return klassen


def einsaetze(x, schwelle=0.05, ruhe=2000):
    """Erster Index jedes Klicks: |x| > schwelle nach mindestens `ruhe` Samples darunter."""
    ueber = np.flatnonzero(np.abs(np.asarray(x, dtype=np.float64)) > schwelle)
    if ueber.size == 0:
        return np.array([], dtype=np.int64)
    neu = np.diff(ueber) > ruhe
    return np.concatenate(([ueber[0]], ueber[1:][neu])).astype(np.int64)


def spruenge(x, schwelle=0.01, ausnahmen=()):
    """Naht-Messer. Rückgabe (indizes, werte, max_natuerlich): Index n heißt |x[n] - x[n-1]| > schwelle.
    `ausnahmen` sind Fenster [a, e), in denen Sprünge natürlich sind (Klick-Einsätze), sie zählen nicht."""
    x = np.asarray(x, dtype=np.float64)
    if len(x) < 2:
        return np.array([], dtype=np.int64), np.array([]), 0.0
    d = np.abs(np.diff(x))
    frei = np.ones(len(d), dtype=bool)
    for a, e in ausnahmen:
        frei[max(int(a) - 1, 0):max(int(e) - 1, 0)] = False
    ueber = (d > schwelle) & frei
    rest = d[frei & ~ueber]
    idx = np.flatnonzero(ueber) + 1
    return idx.astype(np.int64), d[ueber], float(rest.max()) if rest.size else 0.0


def phasen(e, spb, e0=None):
    """Phase jedes Einsatzes gegen das Raster eines Bezugseinsatzes e0 (Vorgabe: erster Einsatz), in Samples,
    gefaltet auf (-spb/2, spb/2]. spb = Samples je Beat (22500 bei 128 BPM)."""
    e = np.asarray(e, dtype=np.float64)
    if e.size == 0:
        return e
    bezug = float(e[0] if e0 is None else e0)
    r = e - bezug
    p = r - np.round(r / spb) * spb
    p[p <= -spb / 2] += spb
    return p


def raster_versatz(e, spb, vor_ende, nach_anfang, e0=None):
    """Raster nach Rückkehr: Median-Phase der Einsätze nach `nach_anfang` minus Median-Phase vor `vor_ende`
    (beides gegen denselben Bezug). Dazu die Streuung (max - min der Phase) je Fenster. None, wenn ein Fenster leer ist."""
    e = np.asarray(e, dtype=np.int64)
    p = phasen(e, spb, e0)
    vor, nach = p[e < vor_ende], p[e >= nach_anfang]
    if vor.size == 0 or nach.size == 0:
        return None
    v = float(np.median(nach) - np.median(vor))
    v -= round(v / spb) * spb
    return {"versatz_samples": v, "streuung_vor": float(vor.max() - vor.min()),
            "streuung_nach": float(nach.max() - nach.min()), "klicks_vor": int(vor.size), "klicks_nach": int(nach.size)}


def klick_pausen(e, spb, a, b):
    """Stille bei Klick-Signal (Auflösung ein Schlag) im Fenster [a, b). Betrachtet werden die Abstände zwischen dem
    letzten Einsatz vor a, allen Einsätzen im Fenster und dem ersten danach; fehlt einer davor oder danach, zählt der
    Fensterrand, und dort erst ab einem halben Schlag (der nächste Klick kann knapp außerhalb liegen). Ein Abstand g
    über 1,5 Schlägen heißt round(g / spb) - 1 fehlende Klicks, am Rand floor((g - spb/2) / spb).
    stille_samples = längster Abstand minus ein Schlag, nur wenn ein Klick fehlt, sonst 0."""
    e = np.asarray(e, dtype=np.int64)
    vor, innen, nach = e[e < a], e[(e >= a) & (e < b)], e[e >= b]
    marken = [(int(vor[-1]), True)] if vor.size else [(int(a), False)]
    marken += [(int(x), True) for x in innen]
    marken += [(int(nach[0]), True)] if nach.size else [(int(b), False)]
    fehlend, laengster = 0, 0.0
    for (x0, k0), (x1, k1) in zip(marken, marken[1:]):
        g = float(x1 - x0)
        laengster = max(laengster, g)
        if k0 and k1:
            fehlend += int(round(g / spb)) - 1 if g > 1.5 * spb else 0
        else:
            fehlend += max(int(np.floor((g - spb / 2) / spb)), 0)
    return {"klicks": int(innen.size), "fehlende_klicks": fehlend,
            "stille_samples": (laengster - spb) if fehlend else 0.0, "laengster_abstand": laengster}


def schleife_treue(x, takt, a, b):
    """Vergleicht [a, b) mit [a - L, b - L] für L in den ganzen Zahlen um `takt` (Frames je Takt, bei 124 BPM nicht ganz)
    und nimmt das beste L. Rückgabe None, wenn das Fenster leer ist, sonst dict mit frames, takt_frames (L), abweichend
    (Frames mit einem Kanal |x[f] - x[f-L]| > 1e-6), max_abweichung und stille_frames (einen Takt früher über 1e-3 in
    irgendeinem Kanal, jetzt in allen Kanälen unter 1e-4: dort fehlt am Ziel, was die Schleife spielen müsste)."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    best = None
    for L in sorted({int(np.floor(takt)), int(np.ceil(takt))}):
        a2, b2 = max(int(a), L), min(int(b), len(x))
        if b2 - a2 <= 0:
            continue
        jetzt, vor = x[a2:b2], x[a2 - L:b2 - L]
        d = np.max(np.abs(jetzt - vor), axis=1)
        r = {"frames": int(b2 - a2), "takt_frames": L, "abweichend": int(np.sum(d > 1e-6)),
             "max_abweichung": float(d.max()),
             "stille_frames": int(np.sum((np.max(np.abs(vor), axis=1) > 1e-3) & (np.max(np.abs(jetzt), axis=1) < 1e-4)))}
        if best is None or r["abweichend"] < best["abweichend"]:
            best = r
    return best


def raster_luecken(e, spb, quantum):
    """Lücken am Ziel aus dem Klick-Raster: Phasensprünge zwischen zwei aufeinanderfolgenden Einsätzen, in Perioden.
    Rückgabe {luecken (Summe der Sprünge nach hinten, in Perioden), rueckwaerts (Sprünge nach vorn), krumm (Sprünge, die
    mehr als 2 Samples neben einem Vielfachen der Periode liegen), spruenge (je Sprung [einsatz, samples])}.
    Ein Sprung ist eine Phasenänderung über einer halben Periode; Einzel-Jitter von ±1 Sample zählt nicht."""
    e = np.asarray(e, dtype=np.int64)
    p = phasen(e, spb)
    if p.size < 2:
        return {"luecken": 0, "rueckwaerts": 0, "krumm": 0, "spruenge": []}
    d = np.diff(p)
    d = d - np.round(d / spb) * spb
    idx = np.flatnonzero(np.abs(d) > quantum / 2)
    luecken = int(sum(int(round(d[i] / quantum)) for i in idx if d[i] > 0))
    return {"luecken": luecken, "rueckwaerts": int(np.sum(d[idx] < 0)),
            "krumm": int(sum(1 for i in idx if abs(d[i] - round(d[i] / quantum) * quantum) > 2)),
            "spruenge": [[int(e[i + 1]), float(d[i])] for i in idx[:50]]}
