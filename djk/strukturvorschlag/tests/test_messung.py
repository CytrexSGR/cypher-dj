import os
import numpy as np
from strukturvorschlag import messung, nml


def test_treffer_toleranz_ein_takt():
    hm, hv = messung.treffer([10.0, 50.0], [11.9, 30.0], tol=1.92)
    assert (hm, hv) == (1, 1)
    hm, hv = messung.treffer([10.0], [11.93], tol=1.92)
    assert (hm, hv) == (0, 0)


def test_grenzen_16():
    st = np.arange(-2, 100) * 2.0
    nu = np.arange(-2, 100)
    g = messung.grenzen(st, nu, 150.0, 16)
    assert list(g) == [0.0, 32.0, 64.0, 96.0, 128.0]


def test_lokaler_pfad():
    p = nml.lokaler_pfad("/:MP3 Itunes CDS/:0101 Beatport/:", "x.mp3", "0101 Beatport", "/m/01 MP3")
    assert p == "/m/01 MP3/0101 Beatport/x.mp3"
    assert nml.lokaler_pfad("/:Andere/:", "x.mp3", "0101 Beatport", "/m") is None


def test_nml_lesen_klein(tmp_path):
    x = tmp_path / "c.nml"
    x.write_text('<?xml version="1.0"?><NML><COLLECTION><ENTRY TITLE="t"><LOCATION DIR="/:A/:0101 Beatport/:" '
                 'FILE="a.mp3"></LOCATION><TEMPO BPM="125"></TEMPO>'
                 '<CUE_V2 TYPE="4" START="148.0" LEN="0" HOTCUE="0" NAME="AutoGrid"></CUE_V2>'
                 '<CUE_V2 TYPE="5" START="1000" LEN="3840" HOTCUE="1" NAME="n.n."></CUE_V2>'
                 '<CUE_V2 TYPE="0" START="500" LEN="0" HOTCUE="2" NAME="vocal"></CUE_V2>'
                 '</ENTRY></COLLECTION></NML>')
    s = nml.lies_sammlung(str(x), musik_wurzel="/m")
    assert s[0]["grid_ms"] == 148.0 and s[0]["bpm_traktor"] == 125.0
    assert [m["typ"] for m in s[0]["marken"]] == ["cue", "loop"]


def test_stichprobe_fest():
    if not os.path.exists(messung.NML):
        import pytest
        pytest.skip("CYPHERDJ_NML nicht gesetzt oder NML nicht eingehaengt")
    sp = messung.stichproben(nml.lies_sammlung(messung.NML))
    assert len(sp["test"]) == 120 and len(sp["dev"]) == 60
    assert not ({e["pfad"] for e in sp["test"]} & {e["pfad"] for e in sp["dev"]})
    assert sum(1 for e in sp["cues"] for m in e["marken"] if m["typ"] == "cue") == 188


# --- Messgeraet v2 (Nachpruefung 2026-09-26) ---------------------------------------------------
from strukturvorschlag import raster as rastermod

BPM_T, GRID_MS = 125.0, 148.0
TAKT_T = 4 * 60.0 / BPM_T


class Kuenstlich(messung.Track):
    """Track ohne Audio mit vorgegebenen Detektor-Vorschlaegen (Takt-Nummern)."""

    def __init__(self, takte_vors, marken_ms, takte=250, namen=None, typ="loop"):
        e = {"pfad": "x.mp3", "bpm_traktor": BPM_T, "grid_ms": GRID_MS,
             "marken": [{"ms": m, "typ": typ, "name": (namen or {}).get(i, "n.n.")} for i, m in enumerate(marken_ms)]}
        dauer = GRID_MS / 1000 + takte * TAKT_T
        r = rastermod.raster_aus_anker(dauer, BPM_T, GRID_MS / 1000)
        r["quelle"] = "traktor"
        messung.Track._setze(self, e, dauer, r, None, None)
        self.laufzeit, self.tags = {}, {}
        self._vors = [{"sekunde": round(GRID_MS / 1000 + k * TAKT_T, 3), "takt": k} for k in takte_vors]

    def detektor(self, p):
        return self._vors, {"phrasen_versatz": 0}


def ms_takt(k, extra_ms=0.0):
    return GRID_MS + k * TAKT_T * 1000 + extra_ms


def test_kante_ein_takt_plus_zittern():
    # Markierung 1 Takt + 3 ms nach dem Vorschlag (Andreas' Median liegt +3,3 ms hinter der Eins)
    t = Kuenstlich([32], [ms_takt(33, 3.0)])
    assert t.treffer([x["sekunde"] for x in t._vors], t.marken(), ("ms", 0.0)) == (0, 0)   # alte Kante: Fehlschlag
    assert t.treffer([x["sekunde"] for x in t._vors], t.marken()) == (1, 1)                # Schlag-Raster: Treffer
    # Negativkontrolle: 1 Takt + 1 Schlag bleibt ein Fehlschlag, auch gegen -40 ms Zittern
    t2 = Kuenstlich([32], [ms_takt(33, 60000 / BPM_T - 40)])
    assert t2.treffer([x["sekunde"] for x in t2._vors], t2.marken()) == (0, 0)


def test_bewerte_perfekt_verschoben_leer():
    marken = [ms_takt(k, 3.0) for k in (16, 64, 128)]
    p = None
    perfekt = messung.bewerte([Kuenstlich([16, 64, 128], marken)], p)["detektor"]
    assert perfekt["recall"] == 1.0 and perfekt["praezision_min"] == 1.0
    daneben = messung.bewerte([Kuenstlich([18, 66, 130], marken)], p)["detektor"]
    assert daneben["recall"] == 0.0 and daneben["praezision_min"] == 0.0
    leer = messung.bewerte([Kuenstlich([], marken)], p)
    assert leer["detektor"]["recall"] == 0.0 and leer["b16"]["vorschlaege"] == 0


def test_b16_gleiche_anzahl_auch_bei_kurzen_tracks():
    # 40 Takte: nur 3 Grenzen k%16==0 (0, 16, 32), Detektor schlaegt 8 vor
    t = Kuenstlich([2, 6, 10, 14, 18, 22, 26, 30], [ms_takt(4)], takte=40)
    e = messung.bewerte([t], None)
    assert e["detektor"]["vorschlaege"] == 8
    assert e["b16"]["vorschlaege"] == 8            # aufgefuellt aus 8er, dann allen Takten
    assert e["b16_ungefuellt"]["vorschlaege"] == 3  # alte Fassung: der gemeldete Fehler
    assert e["b8"]["vorschlaege"] == 8 and e["b1"]["vorschlaege"] == 8


def test_zufall_gleich_ohne_doppelte():
    rng = np.random.default_rng(0)
    g = messung.zufall_gleich([np.array([0.0, 32.0]), np.array([0.0, 16.0, 32.0, 48.0]), np.arange(0, 64.0, 2)], 10, rng)
    assert len(g) == 10 and len(set(g)) == 10
    assert {0.0, 32.0} <= set(g) and {16.0, 48.0} <= set(g)


def test_marken_ohne_autogrid_und_doppelte():
    t = Kuenstlich([], [52.27, ms_takt(10), ms_takt(10, 2.0), ms_takt(20)], namen={0: "AutoGrid"})
    assert len(t.marken()) == 2
