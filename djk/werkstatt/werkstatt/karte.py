"""Tempo-Karte der Quelle (INTERFACES §1.1, §13.2 `tempo_karte_quelle`).

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
import logging
from dataclasses import dataclass, field, replace
import numpy as np
from scipy.interpolate import make_smoothing_spline

LOG = logging.getLogger(__name__)
MIN_SCHLAEGE = 8
TOLERANZ = 0.15      # Abstand gilt als ganzzahlig, wenn |r - rund(r)| <= 0,15 Perioden
# Ketten verbinden (2026-10-17): zwei Ketten gehoeren zusammen, wenn sie dasselbe Raster tragen.
FENSTER_VERBINDEN = 64     # Schlaege je Seite fuer die lokale Geraden-Anpassung (16 Takte). Messung am Bestand:
                           # bei 16 Schlaegen verfehlt Meindl (die ersten Schlaege nach dem Bruch liegen 60 ms daneben),
                           # bei 32 trifft er die Phase knapp (-0,064), bei 64 sicher (-0,012)
PERIODEN_TOL = 0.01        # relative Periodenabweichung der Fenster-Geraden; am Bestand lagen die verbundenen
                           # Paare bei hoechstens 0,4 %, ein echter Tempowechsel liegt bei 3 % und mehr
PHASE_TOL = 0.1            # Phase der spaeteren Kette auf dem Raster der frueheren, in Perioden
ANKER_FENSTER = 192        # Schlaege der bisher aufgenommenen Kette, die das Raster fuer den Anker tragen (48 Takte)
ANKER_NAH = 64             # Schlaege der Kandidatin am nahen Ende fuer Periode und Phase
EXTRAPOLATION_MAX = 400    # Anker: hoechstens so viele Schlaege Luecke zwischen dem Fenster der aufgenommenen Kette und der
                           # naechsten Kandidatin. Periodenfehler der 64-Schlaege-Geraden bei 8 ms Streuung: 5e-5 s je
                           # Schlag, ueber 400 Schlaege 21 ms = 0,05 Perioden bei 150 BPM, also unter der Haelfte von PHASE_TOL
ANTEIL_MIN = 0.9           # Warnung, wenn die gewaehlte Kette weniger Schlaege traegt
RAND_MAX_S = 30.0          # Warnung, wenn Anfang oder Ende der Kette so weit vom ersten/letzten Schlag liegen
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


def _anschluss(za, na, zb, nb):
    """Passt Kette B (Zeiten zb, lokale Nummern nb ab 0) auf das Raster der davor liegenden Kette A?
    Rueckgabe: die Nummer, die B's Nummer 0 im Raster von A traegt (Zaehlung der Luecke nach Raster,
    nicht nach Schlaganzahl), oder None.

    Je Kette eine Gerade durch die letzten bzw. ersten FENSTER_VERBINDEN Schlaege (lokal, damit ein
    langsam driftendes Stueck die Pruefung nicht verwirft). Beide Geraden werden in der Mitte der
    Luecke verglichen, also nur eine halbe Luecke weit extrapoliert:
      1. Perioden gleich: |aB - aA| / aA <= PERIODEN_TOL;
      2. Phase: der Rest von (Index nach A) - (Index nach B) zur naechsten ganzen Zahl <= PHASE_TOL
         Perioden. Ein Halbschlag-Sprung (0,5) und ein Viertelschlag (0,25) fallen durch.
    Beide Ketten brauchen mindestens MIN_SCHLAEGE Schlaege."""
    if len(za) < MIN_SCHLAEGE or len(zb) < MIN_SCHLAEGE:
        return None
    ta, na_ = np.asarray(za[-FENSTER_VERBINDEN:], float), np.asarray(na[-FENSTER_VERBINDEN:], float)
    tb, nb_ = np.asarray(zb[:FENSTER_VERBINDEN], float), np.asarray(nb[:FENSTER_VERBINDEN], float)
    aa, ca = np.polyfit(na_, ta, 1)                    # z = ca + aa * Nummer(A)
    ab, cb = np.polyfit(nb_, tb, 1)                    # z = cb + ab * lokale Nummer(B)
    if not (aa > 0 and ab > 0) or abs(ab - aa) / aa > PERIODEN_TOL:
        return None
    tm = (float(za[-1]) + float(zb[0])) / 2.0
    k_f = (tm - ca) / aa - (tm - cb) / ab              # Nummer im Raster von A, die B's lokaler 0 entspricht
    k = int(np.rint(k_f))
    if abs(k_f - k) > PHASE_TOL or k + int(nb[0]) <= int(na[-1]):
        return None
    return k


def _verbinde(stuecke):
    """Verbindet aufeinanderfolgende Ketten, deren Raster zusammenpasst (_anschluss). Die Nummern der
    spaeteren Kette werden um die gezaehlte Luecke verschoben. Rueckgabe (stuecke, anzahl verbunden)."""
    aus = [stuecke[0]]
    verbunden = 0
    for zb, nb in stuecke[1:]:
        za, na = aus[-1]
        k = _anschluss(za, na, zb, nb)
        if k is None:
            aus.append((zb, nb))
        else:
            aus[-1] = (np.concatenate([za, zb]), np.concatenate([na, nb + k]))
            verbunden += 1
    return aus, verbunden


def _robuste_gerade(n, z, tol=PHASE_TOL, runden=3):
    """Gerade z = c + a * n; Schlaege, die mehr als tol Perioden daneben liegen (Off-Beat-Reste am Rand einer Kette),
    werden ausgelassen und die Gerade neu angepasst. Rueckgabe (a, c)."""
    n = np.asarray(n, float)
    z = np.asarray(z, float)
    a, c = np.polyfit(n, z, 1)
    for _ in range(runden):
        gut = np.abs(z - (c + a * n)) <= tol * a
        if gut.sum() < MIN_SCHLAEGE or gut.all():
            break
        a, c = np.polyfit(n[gut], z[gut], 1)
    return float(a), float(c)


def _anker(stuecke):
    """Nimmt zusaetzlich zum Nachbar-Verbinden jede uebrige Kette auf, die das Raster der Hauptkette (laengste)
    traegt, auch wenn Stoerketten dazwischen liegen (Off-Beat-Tracking im Break, Doppeltempo-Schlaege).

    Von der Hauptkette nach aussen, je Seite Kette fuer Kette in der Reihenfolge der Zeit. Das Raster der bisher
    aufgenommenen Kette wird aus ihren ANKER_FENSTER Randschlaegen an dieser Seite angepasst (robuste Gerade
    Nummer -> Sekunde, _robuste_gerade) und ueber die Luecke verlaengert. Die Kandidatin wird aufgenommen, wenn
      1. ihre Periode (Gerade durch ihre ANKER_NAH Schlaege am nahen Ende) innerhalb PERIODEN_TOL der Periode des
         Rasters liegt,
      2. der Median der Phase dieser ANKER_NAH Schlaege auf dem verlaengerten Raster (abzueglich der ganzen
         Nummer) innerhalb PHASE_TOL liegt, und
      3. die Luecke hoechstens EXTRAPOLATION_MAX Schlaege misst.
    Drift ist doppelt begrenzt: das Raster wird nach jeder Aufnahme neu angepasst (nie eine Gerade der Hauptkette
    ueber den ganzen Titel), und die Extrapolation ist gedeckelt. Das Fenster ist gross (ANKER_FENSTER), weil die
    ersten Schlaege einer Kette hinter einer Stoerung selbst unsauber sind: am Bestand (Wake up fucked up) verfehlte
    ein Fenster von 64 Schlaegen das Raster um 0,1 Schlaege, eines von 192 trifft es auf 0,01 bis 0,05. Eine
    abgelehnte Kette (Stoerkette) faellt weg; die naechste Kandidatin wird gegen dasselbe Raster geprueft, die Luecke
    bleibt Luecke, die Nummern springen nach Raster. Ein Tempowechsel faellt an 1. oder 2., ein Halbschlag-Versatz an 2.
    Rueckgabe: (die eine Kette, info) mit info = {angeschlossen, stoerketten, stuecke: [Hauptkette und aufgenommene
    Stuecke mit Schlagzahl, Beginn, Ende, Phase und Rest-Streuung in ms]}."""
    haupt = max(range(len(stuecke)), key=lambda i: len(stuecke[i][0]))
    zh, nh = np.asarray(stuecke[haupt][0], float), np.asarray(stuecke[haupt][1], int)

    def rest_ms(z, n):
        a, c = _robuste_gerade(n, z)
        return float(np.std(z - (c + a * np.asarray(n, float))) * 1000.0)

    stats = [{"rolle": "haupt", "schlaege": int(len(zh)), "von_s": float(zh[0]), "bis_s": float(zh[-1]),
              "phase": 0.0, "rest_ms": rest_ms(zh, nh)}]
    angeschlossen = 0
    stoer = 0
    seiten = []
    for richtung, kandidaten in ((+1, stuecke[haupt + 1:]), (-1, stuecke[:haupt][::-1])):
        zs, ns = [], []                                  # aufgenommene Stuecke dieser Seite, in Reihenfolge nach aussen
        rand_z, rand_n = zh, nh                          # bisher aufgenommene Kette dieser Seite (mit Hauptkette)
        for zb, nb in kandidaten:
            zb, nb = np.asarray(zb, float), np.asarray(nb, int)
            if len(zb) < MIN_SCHLAEGE:
                stoer += 1
                continue
            if richtung > 0:
                fz, fn = rand_z[-ANKER_FENSTER:], rand_n[-ANKER_FENSTER:]
                bz, bn = zb[:ANKER_NAH], nb[:ANKER_NAH]
                luecke = bz[0] - fz[-1]
            else:
                fz, fn = rand_z[:ANKER_FENSTER], rand_n[:ANKER_FENSTER]
                bz, bn = zb[-ANKER_NAH:], nb[-ANKER_NAH:]
                luecke = fz[0] - bz[-1]
            af, cf = _robuste_gerade(fn, fz)             # z = cf + af * Nummer
            ab = np.polyfit(bn, bz, 1)[0]
            if not (af > 0 and ab > 0) or abs(ab - af) / af > PERIODEN_TOL or luecke / af > EXTRAPOLATION_MAX:
                stoer += 1
                continue
            m = float(np.median((bz - cf) / af - bn))    # Nummer im Raster, die der lokalen 0 der Kandidatin entspricht
            k = int(np.rint(m))
            ph = m - k
            nn = nb + k
            if abs(ph) > PHASE_TOL or (richtung > 0 and nn[0] <= rand_n[-1]) or (richtung < 0 and nn[-1] >= rand_n[0]):
                stoer += 1
                continue
            zs.append(zb)
            ns.append(nn)
            rand_z = np.concatenate([rand_z, zb]) if richtung > 0 else np.concatenate([zb, rand_z])
            rand_n = np.concatenate([rand_n, nn]) if richtung > 0 else np.concatenate([nn, rand_n])
            stats.append({"rolle": "rechts" if richtung > 0 else "links", "schlaege": int(len(zb)),
                          "von_s": float(zb[0]), "bis_s": float(zb[-1]), "phase": round(float(ph), 4),
                          "rest_ms": rest_ms(zb, nn)})
            angeschlossen += 1
        seiten.append((zs, ns))
    (zr, nr), (zl, nl) = seiten
    z = np.concatenate(zl[::-1] + [zh] + zr)
    n = np.concatenate(nl[::-1] + [nh] + nr)
    n = n - n[0]                                         # Nummern ab 0 (links der Hauptkette waren sie negativ)
    stats.sort(key=lambda x: x["von_s"])
    return (z, n.astype(int)), {"angeschlossen": angeschlossen, "stoerketten": stoer, "stuecke": stats}


def _warnungen(z, zk, n_gesamt):
    """Meldungen, wenn die gewaehlte Kette die Schlagliste nicht traegt: unter ANTEIL_MIN der Schlaege,
    oder Anfang bzw. Ende mehr als RAND_MAX_S Sekunden vor bzw. hinter dem ersten/letzten erkannten Schlag."""
    w = []
    if len(zk) < ANTEIL_MIN * n_gesamt:
        w.append(f"gewaehlte Kette traegt nur {len(zk)} von {n_gesamt} Schlaegen ({100.0 * len(zk) / n_gesamt:.0f} %)")
    if zk[0] - z[0] > RAND_MAX_S:
        w.append(f"Anfang verfehlt: Kette beginnt bei {zk[0]:.1f} s, erster Schlag bei {z[0]:.1f} s")
    if z[-1] - zk[-1] > RAND_MAX_S:
        w.append(f"Ende verfehlt: Kette endet bei {zk[-1]:.1f} s, letzter Schlag bei {z[-1]:.1f} s")
    return w


def nummeriere(zeiten, toleranz=TOLERANZ, halb=HALBFENSTER):
    """Laengste Kette konsistenter Schlaege und ihre Nummern.

    Ketten, die nur ein einzelnes zu kurzes oder zu langes Intervall trennt, aber auf demselben Raster
    liegen (gleiche Periode, Phase innerhalb PHASE_TOL), werden verbunden (_anschluss, _verbinde).

    Rueckgabe: (zeiten der Kette, nummern ab 0, info) mit info = {roh, ohne_doppelte, ketten_roh,
    ketten (nach dem Verbinden), ketten_verbunden, kette_schlaege, periode_s, warnungen}."""
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
    stuecke = [(z[a:b], np.concatenate([[0], np.cumsum(np.rint(r[a:b - 1]).astype(int))])) for a, b in ketten]
    stuecke, verbunden = _verbinde(stuecke)
    n_ketten = len(stuecke)
    if len(stuecke) > 1 and max(len(s[0]) for s in stuecke) >= MIN_SCHLAEGE:
        (zk, nummern), anker = _anker(stuecke)
    else:
        zk, nummern = max(stuecke, key=lambda s: len(s[0]))
        anker = {"angeschlossen": 0, "stoerketten": n_ketten - 1, "stuecke": []}
    if len(zk) < MIN_SCHLAEGE:
        raise ValueError(f"laengste Kette zu kurz: {len(zk)} < {MIN_SCHLAEGE}")
    info = {"roh": roh, "ohne_doppelte": int(len(z)), "ketten_roh": len(ketten), "ketten": n_ketten,
            "ketten_verbunden": verbunden, "ketten_angeschlossen": anker["angeschlossen"],
            "stoerketten": anker["stoerketten"], "anker_stuecke": anker["stuecke"], "kette_schlaege": int(len(zk)), "periode_s": round(periode, 6),
            "warnungen": _warnungen(z, zk, len(z))}
    for w in info["warnungen"]:
        LOG.warning("Beat-Karte: %s", w)
    return zk, nummern, info


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
