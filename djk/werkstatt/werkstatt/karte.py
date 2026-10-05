"""Tempo-Karte der Quelle (SCHNITTSTELLEN §1.1, §13.2 `tempo_karte_quelle`).

Aus erkannten Schlagzeiten (Sekunden) wird eine glatte Karte Schlag-Nummer -> Quell-Sekunde:
  1. nummerieren: doppelte Treffer (Abstand unter einer halben Grundperiode) fallen weg; jeder
     Abstand wird in lokalen Schlagperioden gezaehlt; ein Abstand, der nicht nahe an einer ganzen
     Zahl liegt, trennt die Kette. Die Karte stuetzt sich auf die laengste Kette (Intro ohne Puls,
     Breaks mit Phasensprung des Werkzeugs bleiben draussen und werden gemeldet);
  2. glaetten mit Modellwahl: Kandidaten sind Glaettungs-Splines (Kernbreite h = 4 bis 256 Schlaege,
     lam = h**4) und die Gerade (konstantes Tempo). Gewaehlt wird per Block-Kreuzvalidierung ueber
     die inneren Bloecke (je BLOCK Schlaege; der erste und der letzte Block waeren Extrapolation) das
     glatteste Modell, dessen Fehler hoechstens einen Standardfehler ueber dem kleinsten liegt
     (1-SE-Regel). Ein starres Stueck bekommt so eine Gerade, ein driftendes einen Spline.
     GCV (scipy-Vorgabe) bleibt nur als Vergleich: am 20-ms-Raster von beat_this waehlt es zu wenig
     Glaettung und laesst ein starres Stueck wackeln (Plan 05, Task 3 und Task 7);
  3. Eintraege je ganzer Nummer: [quell_sekunde, quell_beat] mit quell_beat = v * Nummer
     (v = tempo_vielfaches aus §12.3; Halb- und Doppeltempo aendern nur die Zaehlung).
"""
from dataclasses import dataclass, field, replace
import numpy as np
from scipy.interpolate import make_smoothing_spline

MIN_SCHLAEGE = 8
TOLERANZ = 0.15      # Abstand gilt als ganzzahlig, wenn |r - rund(r)| <= 0,15 Perioden
HALBFENSTER = 8      # lokale Periode: Mittel der Ein-Schlag-Abstaende, je 8 davor und danach
BLOCK = 16           # Schlaege je Block der Kreuzvalidierung (4 Takte)
KERNBREITEN = tuple(float(h) for h in 2.0 ** np.arange(2, 8.01, 0.5)) + (np.inf,)   # inf = Gerade


@dataclass
class Karte:
    sekunden: np.ndarray            # Quell-Sekunde je Eintrag, streng steigend
    beats: np.ndarray               # quell_beat je Eintrag (v * Nummer)
    vielfaches: float = 1.0
    info: dict = field(default_factory=dict)

    def gezaehlt(self, vielfaches):
        """Dieselbe Karte mit anderer Schlagzaehlung (Halb- oder Doppeltempo, §12.3)."""
        return replace(self, beats=self.beats / self.vielfaches * vielfaches, vielfaches=vielfaches)

    def als_liste(self):
        """Datenform `tempo_karte_quelle`: [[quell_sekunde, quell_beat], ...]."""
        return [[round(float(s), 6), round(float(b), 6)] for s, b in zip(self.sekunden, self.beats)]

    def beat_bei(self, t):
        """quell_beat zur Quell-Sekunde t; linear zwischen den Eintraegen, ausserhalb mit dem Tempo
        des ersten bzw. letzten Abschnitts weitergerechnet."""
        t = np.asarray(t, dtype=float)
        s, b = self.sekunden, self.beats
        q = np.interp(t, s, b)
        q = np.where(t < s[0], b[0] + (t - s[0]) * (b[1] - b[0]) / (s[1] - s[0]), q)
        return np.where(t > s[-1], b[-1] + (t - s[-1]) * (b[-1] - b[-2]) / (s[-1] - s[-2]), q)

    def sekunde_bei(self, q):
        """Quell-Sekunde zum quell_beat q (Umkehrung von beat_bei)."""
        q = np.asarray(q, dtype=float)
        s, b = self.sekunden, self.beats
        t = np.interp(q, b, s)
        t = np.where(q < b[0], s[0] + (q - b[0]) * (s[1] - s[0]) / (b[1] - b[0]), t)
        return np.where(q > b[-1], s[-1] + (q - b[-1]) * (s[-1] - s[-2]) / (b[-1] - b[-2]), t)

    def bpm_lokal(self):
        """Tempo je Abschnitt zwischen zwei Eintraegen (BPM in quell_beats)."""
        return 60.0 * np.diff(self.beats) / np.diff(self.sekunden)

    def bpm_gesamt(self):
        """Mittleres Tempo: Steigung der Ausgleichsgeraden quell_beat ueber Sekunde."""
        return float(60.0 * np.polyfit(self.sekunden, self.beats, 1)[0])


def _ohne_doppelte(z, p0):
    """Streicht Treffer, die naeher als p0/2 am Vorgaenger liegen; von zwei zu nahen Treffern
    bleibt der, nach dessen Wegfall der Abstand zum Vorgaenger naeher an einem Vielfachen von p0
    liegt."""
    z = z.copy()
    while True:
        kurz = np.where(np.diff(z) < 0.5 * p0)[0]
        if len(kurz) == 0:
            return z
        i = int(kurz[0])

        def fehler(j):
            rest = np.delete(z, j)
            a = max(0, j - 1)
            if a + 1 >= len(rest):
                return 0.0
            r = (rest[a + 1] - rest[a]) / p0
            return abs(r - round(r))

        z = np.delete(z, i if fehler(i) < fehler(i + 1) else i + 1)


def nummeriere(zeiten, toleranz=TOLERANZ, halb=HALBFENSTER):
    """Laengste Kette konsistenter Schlaege und ihre Nummern.

    Rueckgabe: (zeiten der Kette, nummern ab 0, info) mit info = {roh, ohne_doppelte, ketten,
    kette_schlaege, periode_s}."""
    z = np.unique(np.asarray(zeiten, dtype=float))
    if len(z) < MIN_SCHLAEGE:
        raise ValueError(f"zu wenige Schlaege: {len(z)} < {MIN_SCHLAEGE}")
    roh = len(z)
    p0 = float(np.median(np.diff(z)))
    z = _ohne_doppelte(z, p0)
    ioi = np.diff(z)
    nahe = np.abs(ioi / p0 - 1.0) < 0.25
    periode = float(ioi[nahe].mean()) if nahe.any() else p0        # Mittel, nicht Median: 20-ms-Raster
    einzel = np.abs(ioi / periode - 1.0) <= toleranz
    mitte = (z[1:] + z[:-1]) / 2.0
    t_e, p_e = mitte[einzel], ioi[einzel]

    def lokal(t):
        i = int(np.searchsorted(t_e, t))
        s = p_e[max(0, i - halb):i + halb]
        return float(s.mean()) if len(s) else periode

    r = ioi / np.array([lokal(t) for t in mitte])
    passt = (np.abs(r - np.rint(r)) <= toleranz) & (np.rint(r) >= 1)
    grenzen = np.concatenate([[0], np.where(~passt)[0] + 1, [len(z)]])
    ketten = [(int(a), int(b)) for a, b in zip(grenzen[:-1], grenzen[1:]) if b - a >= 2]
    if not ketten:
        raise ValueError("keine Kette aus mindestens zwei Schlaegen")
    a, b = max(ketten, key=lambda k: k[1] - k[0])
    if b - a < MIN_SCHLAEGE:
        raise ValueError(f"laengste Kette zu kurz: {b - a} < {MIN_SCHLAEGE}")
    nummern = np.concatenate([[0], np.cumsum(np.rint(r[a:b - 1]).astype(int))])
    info = {"roh": roh, "ohne_doppelte": int(len(z)), "ketten": len(ketten),
            "kette_schlaege": int(b - a), "periode_s": round(periode, 6)}
    return z[a:b], nummern, info


def _modell(n, z, h):
    """Kandidat mit Kernbreite h (Schlaege); h = inf ist die Gerade. None = GCV (nur Vergleich)."""
    if h is not None and np.isinf(h):
        k = np.polyfit(n, z, 1)
        return lambda q: np.polyval(k, q)
    return make_smoothing_spline(n, z, lam=None if h is None else h ** 4)


def waehle_kernbreite(n, z, block=BLOCK, kandidaten=KERNBREITEN):
    """Block-Kreuzvalidierung ueber die inneren Bloecke, 1-SE-Regel. Rueckgabe (h, h_min, bloecke);
    unter drei inneren Bloecken ist keine Streuung schaetzbar: dann die Gerade."""
    n = np.asarray(n, dtype=float)
    z = np.asarray(z, dtype=float)
    fold = (n // block).astype(int)
    innen = np.unique(fold)[1:-1]
    if len(innen) < 3:
        return np.inf, np.inf, int(len(innen))
    fehler = np.array([[np.mean((_modell(n[fold != f], z[fold != f], h)(n[fold == f]) - z[fold == f]) ** 2)
                        for f in innen] for h in kandidaten])
    mittel = fehler.mean(axis=1)
    se = fehler.std(axis=1, ddof=1) / np.sqrt(len(innen))
    i = int(np.argmin(mittel))
    j = max(k for k in range(len(kandidaten)) if mittel[k] <= mittel[i] + se[i])
    return kandidaten[j], kandidaten[i], int(len(innen))


def karte_aus_schlaegen(zeiten, vielfaches=1.0, glaettung="cv"):
    """Glatte Karte aus erkannten Schlagzeiten. glaettung: "cv" (Vorgabe, Modellwahl oben),
    "gcv" (nur Vergleich), "gerade" (beste feste BPM, der Fehlerfall) oder eine Kernbreite h."""
    z, n, info = nummeriere(zeiten)
    nf = n.astype(float)
    if glaettung == "cv":
        h, h_min, bloecke = waehle_kernbreite(nf, z)
        info.update({"glaettung": "cv", "bloecke_innen": bloecke,
                     "h_min": None if np.isinf(h_min) else h_min})
    elif glaettung == "gcv":
        h = None
        info["glaettung"] = "gcv"
    elif glaettung == "gerade":
        h = np.inf
        info["glaettung"] = "gerade"
    else:
        h = float(glaettung)
        info["glaettung"] = "fest"
    info["modell"] = "gerade" if h is not None and np.isinf(h) else "spline"
    info["h_schlaege"] = None if h is None or np.isinf(h) else h
    ganz = np.arange(0, n[-1] + 1, dtype=float)
    return Karte(sekunden=_modell(nf, z, h)(ganz), beats=vielfaches * ganz, vielfaches=vielfaches, info=info)


def karte_fest(zeiten, vielfaches=1.0):
    """FEHLERFALL-Karte: beste feste BPM (Ausgleichsgerade ueber die nummerierten Schlaege)."""
    return karte_aus_schlaegen(zeiten, vielfaches, glaettung="gerade")


def _ms(dq, karte, t):
    """Beat-Differenz dq an der Quell-Sekunde t in Millisekunden (lokale Periode der Karte)."""
    periode = np.interp(t, karte.sekunden[1:], np.diff(karte.sekunden) / np.diff(karte.beats))
    return dq * periode * 1000.0


def rest_gegen_wahrheit(karte, wahre_zeiten):
    """Rest der Karte gegen bekannte, aufeinanderfolgende Schlagzeiten im Bereich der Karte.
    Je wahrer Zeit s_j: d_j = q(s_j) - v*j. Der Median von d (ganzzahliger Versatz der Zaehlung
    plus konstante Phase) wird abgezogen; die konstante Phase kommt getrennt als versatz_ms
    (positiv = Karte spaeter als die Wahrheit). Der Rest ist, was ein Warp mit dieser Karte am
    Ausgang als Raster-Fehler liesse (wie `ohne_r3`/`map_r3` in proben/07 b_timemap, Median ab)."""
    w = np.asarray(wahre_zeiten, dtype=float)
    w = w[(w >= karte.sekunden[0]) & (w <= karte.sekunden[-1])]
    d = karte.beat_bei(w) - karte.vielfaches * np.arange(len(w))
    med = float(np.median(d))
    phase = med - karte.vielfaches * np.rint(med / karte.vielfaches)
    r = _ms(d - med, karte, w)
    return {"n": int(len(w)), "rest_rms_ms": round(float(np.sqrt(np.mean(r ** 2))), 2),
            "rest_p90_ms": round(float(np.percentile(np.abs(r), 90)), 2),
            "rest_max_ms": round(float(np.abs(r).max()), 2),
            "versatz_ms": round(float(-_ms(phase, karte, w[:1])[0]), 2)}


def vergleiche(karte_a, karte_b):
    """Karte b gegen Karte a an den Eintraegen von a im gemeinsamen Bereich.
    form_*: Abweichung ohne konstanten Versatz (Median ab); versatz_ms: konstanter Versatz,
    positiv = b spaeter als a."""
    t = karte_a.sekunden[(karte_a.sekunden >= karte_b.sekunden[0]) & (karte_a.sekunden <= karte_b.sekunden[-1])]
    if len(t) < MIN_SCHLAEGE:
        return {"n": int(len(t)), "form_p90_ms": None, "form_max_ms": None, "versatz_ms": None}
    d = karte_b.beat_bei(t) - karte_a.beat_bei(t)
    med = float(np.median(d))
    phase = med - np.rint(med)
    form = _ms(d - med, karte_a, t)
    return {"n": int(len(t)), "form_p90_ms": round(float(np.percentile(np.abs(form), 90)), 2),
            "form_max_ms": round(float(np.abs(form).max()), 2),
            "versatz_ms": round(float(-_ms(phase, karte_a, t[:1])[0]), 2)}
