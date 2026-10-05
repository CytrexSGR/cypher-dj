"""Messung gegen Andreas' Traktor-Markierungen (TYPE 0 Cue, TYPE 5 Loop) und zwei Grundlinien.

Stichproben (fest, aus der NML, sortiert nach lokalem Pfad, nur Eintraege mit Markierungen):
  test = jeder 7. (Index % 7 == 0), die ersten 120
  dev  = Index % 7 == 3, die ersten 60 (disjunkt zu test; nur zum Einstellen der Parameter)
  cues = alle Eintraege mit mindestens einem TYPE-0-Cue (Bewertung nur gegen die Cues)

Wahrheit je Track (Track.marken): Markierungen ohne die von Traktor gesetzten „AutoGrid“-Loops,
doppelte Markierungen auf demselben Schlag nur einmal.

Treffer (Messgeraet v2, Standard toleranz="schlag"): Vorschlag und Markierung werden auf den naechsten
Schlag des Traktor-Rasters gerundet (Grid-START, Beat = 60/BPM); Treffer, wenn sie hoechstens 4 Schlaege
(= 1 Takt) auseinander liegen. Grund: Markierungen liegen im Median wenige ms hinter der Takt-Eins, die
alte Millisekunden-Kante |dt| <= 1 Takt entschied deshalb bei rund 25 Markierungen per Zittern < 50 ms.
Zum Vergleich bleibt die alte Kante als toleranz=("ms", delta_s) waehlbar.

Grundlinien je Track auf demselben Raster wie der Detektor:
  (a)  alle 16-Takt-Grenzen ab dem Anker (Takt 0, 16, 32, ...) innerhalb der Dauer
  (b)  genau so viele Vorschlaege wie der Detektor: zufaellig aus den 16-Takt-Grenzen; reichen die
       nicht, wird zufaellig aus den uebrigen 8-Takt-Grenzen, dann aus allen Takten aufgefuellt (Saat fest)
Kontrollen: b16_ungefuellt (alte Fassung, nimmt hoechstens alle 16er), a16_versatz,
b8 (Zufall 8er, aufgefuellt aus allen Takten), b1 (Zufall auf allen Takten), alle mit gleicher Anzahl.
"""
import os
import time

import numpy as np

from . import lauf

NML = os.environ.get("CYPHERDJ_NML") or "/nicht/gesetzt/CYPHERDJ_NML"   # Traktor collection.nml; ungesetzt: Läufe melden die Variable im Fehler, der Test überspringt
SCHLAEGE_JE_TAKT = 4


def stichproben(sammlung):
    mit = [e for e in sammlung if e["marken"]]
    test = [e for i, e in enumerate(mit) if i % 7 == 0][:120]
    dev = [e for i, e in enumerate(mit) if i % 7 == 3][:60]
    cues = [e for e in mit if any(m["typ"] == "cue" for m in e["marken"])]
    return {"test": test, "dev": dev, "cues": cues, "n_mit": len(mit)}


def treffer(vors_s, marken_s, tol):
    """Alte Kante in Sekunden: Treffer, wenn |Vorschlag - Markierung| <= tol."""
    v = np.asarray(vors_s, float)
    m = np.asarray(marken_s, float)
    if len(v) == 0 or len(m) == 0:
        return 0, 0
    dist = np.abs(v[:, None] - m[None, :])
    hm = int((dist.min(axis=0) <= tol + 1e-6).sum())   # Markierungen mit Vorschlag
    hv = int((dist.min(axis=1) <= tol + 1e-6).sum())   # Vorschlaege nahe Markierung
    return hm, hv


def schlag(x_s, anker_s, beat_s):
    return np.rint((np.asarray(x_s, float) - anker_s) / beat_s).astype(int)


def treffer_schlag(vors_s, marken_s, anker_s, beat_s, max_schlaege=SCHLAEGE_JE_TAKT):
    """Messgeraet v2: beide Seiten auf den naechsten Schlag gerundet, Treffer bei <= max_schlaege."""
    v = schlag(vors_s, anker_s, beat_s)
    m = schlag(marken_s, anker_s, beat_s)
    if len(v) == 0 or len(m) == 0:
        return 0, 0
    dist = np.abs(v[:, None] - m[None, :])
    return int((dist.min(axis=0) <= max_schlaege).sum()), int((dist.min(axis=1) <= max_schlaege).sum())


def grenzen(starts, nummern, dauer_s, stufe, versatz=0):
    ok = ((nummern - versatz) % stufe == 0) & (starts >= 0) & (starts < dauer_s)
    return starts[ok]


def zufall(pool, n, rng):
    """Alte Fassung: hoechstens len(pool) Vorschlaege (nur noch als Kontrolle b16_ungefuellt)."""
    if len(pool) == 0 or n == 0:
        return np.array([])
    return rng.choice(pool, size=min(n, len(pool)), replace=False)


def zufall_gleich(pools, n, rng):
    """Genau n Positionen (sofern insgesamt vorhanden): zuerst zufaellig aus pools[0], den Rest
    zufaellig aus pools[1] ohne das schon Gezogene, usw."""
    gezogen = np.array([], float)
    for pool in pools:
        rest = n - len(gezogen)
        if rest <= 0:
            break
        frei = np.setdiff1d(np.asarray(pool, float), gezogen)
        if len(frei) == 0:
            continue
        gezogen = np.concatenate([gezogen, rng.choice(frei, size=min(rest, len(frei)), replace=False)])
    return np.sort(gezogen)


class Track:
    """Vorberechnete Taktmerkmale eines Tracks fuer schnelle Parameterlaeufe."""

    def __init__(self, eintrag, cache_dir, erzwinge_eigen=False):
        erg = lauf.analysiere(eintrag["pfad"], eintrag, cache_dir=cache_dir, erzwinge_eigen=erzwinge_eigen)
        ii = erg["_intern"]
        r = {"nummern": ii["nummern"], "starts": ii["starts"], "takt_s": ii["takt_s"], "bpm": ii["bpm"],
             "anker_s": ii["anker_s"], "quelle": erg["raster"]["quelle"]}
        self._setze(eintrag, erg["dauer_s"], r, ii["db"], ii["fl"])
        self.laufzeit = erg["laufzeit_s"]
        self.tags = erg["tags"]

    @classmethod
    def aus_werten(cls, eintrag, dauer_s, r, db=None, fl=None):
        """Ohne Audio (Tests, Nachrechnungen): r mit nummern, starts, takt_s, bpm, anker_s, quelle."""
        t = cls.__new__(cls)
        t._setze(eintrag, dauer_s, r, db, fl)
        t.laufzeit, t.tags = {}, {}
        return t

    def _setze(self, eintrag, dauer_s, r, db, fl):
        self.e = eintrag
        self.dauer = float(dauer_s)
        self.r = r
        self.db, self.fl = db, fl
        bpm_t = eintrag.get("bpm_traktor") or r["bpm"]
        self.tol = 4 * 60.0 / bpm_t
        # Schlag-Raster der Wahrheit: Traktor-Grid, wenn vorhanden, sonst das Raster des Tracks
        if eintrag.get("grid_ms") is not None and eintrag.get("bpm_traktor"):
            self.schlag_anker, self.beat = eintrag["grid_ms"] / 1000.0, 60.0 / eintrag["bpm_traktor"]
        else:
            self.schlag_anker, self.beat = r["anker_s"], r["takt_s"] / SCHLAEGE_JE_TAKT

    def marken(self, nur_cues=False):
        """Markierungen in s: ohne AutoGrid, eine je Schlag."""
        aus, gesehen = [], set()
        for m in self.e["marken"]:
            if nur_cues and m["typ"] != "cue":
                continue
            if m.get("name") == "AutoGrid":
                continue
            s = m["ms"] / 1000.0
            k = int(schlag([s], self.schlag_anker, self.beat)[0])
            if k in gesehen:
                continue
            gesehen.add(k)
            aus.append(s)
        return aus

    def treffer(self, vors_s, marken_s, toleranz="schlag"):
        if toleranz == "schlag":
            return treffer_schlag(vors_s, marken_s, self.schlag_anker, self.beat)
        _, delta = toleranz
        return treffer(vors_s, marken_s, self.tol + delta)

    def detektor(self, p):
        from . import detektor
        return detektor.erkenne(self.db, self.fl, self.r, p, self.dauer)


VERFAHREN = ["detektor", "a16", "b16", "b16_ungefuellt", "a16_versatz", "b8", "b1"]


def kandidaten(t, vs, info, rng):
    st, nu = t.r["starts"], t.r["nummern"]
    n = len(vs)
    g16 = grenzen(st, nu, t.dauer, 16)
    g8 = grenzen(st, nu, t.dauer, 8)
    g1 = st[(st >= 0) & (st < t.dauer)]
    return {
        "detektor": np.asarray(vs, float),
        "a16": g16,
        "b16": zufall_gleich([g16, g8, g1], n, rng),
        "b16_ungefuellt": zufall(g16, n, rng),
        "a16_versatz": grenzen(st, nu, t.dauer, 16, info["phrasen_versatz"]),
        "b8": zufall_gleich([g8, g1], n, rng),
        "b1": zufall_gleich([g1], n, rng),
    }


def bewerte(tracks, p, nur_cues=False, saat=0, n_saaten=0, toleranz="schlag"):
    """-> dict je Verfahren: Summen und Kennzahlen, plus Zeilen je Track (fuer Bootstrap)."""
    zeilen = {k: [] for k in VERFAHREN}
    saat_zeilen = []
    for ti, t in enumerate(tracks):
        ms = t.marken(nur_cues)
        v, info = t.detektor(p)
        vs = [x["sekunde"] for x in v]
        n = len(vs)
        rng = np.random.default_rng(saat * 100003 + ti)
        kand = kandidaten(t, vs, info, rng)
        for k in VERFAHREN:
            hm, hv = t.treffer(kand[k], ms, toleranz)
            zeilen[k].append((hm, len(ms), hv, len(kand[k])))
        if n_saaten:
            st, nu = t.r["starts"], t.r["nummern"]
            pools = [grenzen(st, nu, t.dauer, 16), grenzen(st, nu, t.dauer, 8), st[(st >= 0) & (st < t.dauer)]]
            reihe = []
            for s in range(n_saaten):
                r2 = np.random.default_rng((1000 + s) * 100003 + ti)
                b = zufall_gleich(pools, n, r2)
                hm, hv = t.treffer(b, ms, toleranz)
                reihe.append((hm, hv, len(b)))
            saat_zeilen.append(reihe)
    aus = {}
    for k in VERFAHREN:
        z = np.array(zeilen[k], float).reshape(-1, 4)
        aus[k] = kennzahlen(z)
        aus[k]["zeilen"] = z
    if n_saaten:
        arr = np.array(saat_zeilen, float)  # tracks x saaten x 3
        nm = sum(len(t.marken(nur_cues)) for t in tracks)
        rec = arr[:, :, 0].sum(axis=0) / max(nm, 1)
        prc = arr[:, :, 1].sum(axis=0) / np.maximum(arr[:, :, 2].sum(axis=0), 1)
        det = aus["detektor"]
        aus["b16_saaten"] = {"n": n_saaten, "recall_mittel": float(rec.mean()), "recall_sd": float(rec.std()),
                             "recall_max": float(rec.max()), "praez_mittel": float(prc.mean()),
                             "praez_sd": float(prc.std()), "praez_max": float(prc.max()),
                             "detektor_recall_rang": int((rec >= det["recall"]).sum()),
                             "detektor_praez_rang": int((prc >= det["praezision_min"]).sum())}
    return aus


def kennzahlen(z):
    hm, nm, hv, nv = z.sum(axis=0) if len(z) else (0, 0, 0, 0)
    return {"recall": float(hm / nm) if nm else 0.0, "praezision_min": float(hv / nv) if nv else 0.0,
            "je_track": float(nv / len(z)) if len(z) else 0.0, "marken": int(nm), "vorschlaege": int(nv),
            "treffer_marken": int(hm), "treffer_vorschlaege": int(hv)}


def bootstrap(z_det, z_bas, n=2000, saat=7):
    """Gepaartes Bootstrap ueber Tracks: 95-%-Intervall der Differenz Detektor - Grundlinie."""
    rng = np.random.default_rng(saat)
    k = len(z_det)
    dr, dp = [], []
    for _ in range(n):
        i = rng.integers(0, k, k)
        a, b = z_det[i].sum(axis=0), z_bas[i].sum(axis=0)
        dr.append(a[0] / max(a[1], 1) - b[0] / max(b[1], 1))
        dp.append(a[2] / max(a[3], 1) - b[2] / max(b[3], 1))
    q = lambda x: [float(np.percentile(x, 2.5)), float(np.percentile(x, 97.5))]
    return {"recall_diff_ki95": q(dr), "praez_diff_ki95": q(dp)}


def lade_tracks(eintraege, cache_dir, prozesse=3, erzwinge_eigen=False):
    """Merkmale parallel vorberechnen (nice 19, <= 3 Prozesse), dann Tracks seriell aus dem Cache."""
    from concurrent.futures import ProcessPoolExecutor
    pfade = [e["pfad"] for e in eintraege]
    zeiten = {}
    with ProcessPoolExecutor(max_workers=prozesse, initializer=os.nice, initargs=(19,)) as ex:
        for pfad, (dt, cache) in zip(pfade, ex.map(_vorberechnen, pfade, [cache_dir] * len(pfade))):
            zeiten[pfad] = (dt, cache)
    tracks = [Track(e, cache_dir, erzwinge_eigen) for e in eintraege]
    return tracks, zeiten


def _vorberechnen(pfad, cache_dir):
    t0 = time.perf_counter()
    _, cache = lauf.frame_merkmale_fuer(pfad, cache_dir)
    return time.perf_counter() - t0, cache
