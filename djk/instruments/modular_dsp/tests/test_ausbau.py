"""Tests for ausbau.py (the building blocks) and measure_null.py (the null harness).

Each block is applied to a toy graph (note, saw, pulse, ladder, `ausgang`). The result must be accepted by the translator (through
the release example `render_kit`), have unique node ids and no dead node, give every knob the vorgabe its class demands, and the
toy rendered with all block knobs at their vorgabe must be byte-equal to the toy without the block (the null property). With the
block's amount knobs at 1 the sound must change (a block wired to nothing would pass the null trivially).

    python3 -m pytest djk/instruments/modular_dsp/tests/test_ausbau.py
"""
import copy
import json
import pathlib
import shutil
import subprocess
import sys

import numpy as np
import pytest

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import ausbau as A  # noqa: E402
import measure_null as M  # noqa: E402


@pytest.fixture(scope="module")
def arbeit():
    d = M.MESSUNG / "test-ausbau-tmp"
    d.mkdir(parents=True, exist_ok=True)
    M.werkzeug_bauen()
    yield d
    shutil.rmtree(d, ignore_errors=True)


def spielzeug(stereo=False):
    """note -> saw + pulse -> ladder (cutoff from a knob, a filter envelope with a decay knob) -> VCA with velocity -> ausgang."""
    k, e = [], []
    g = {"format": "baukasten/2", "name": "spielzeug", "stimmen": 4, "regler_namen": {"1": "Cutoff", "2": "Decay"}, "knoten": k, "kanten": e}

    def n(id, art, **w):
        k.append({"id": id, "art": art, **w})

    def c(a, b):
        e.append({"von": a, "nach": b})
    n("note", "note")
    n("k_cut", "regler", nr=1, min=100, max=8000, log=1)
    n("k_dec", "regler", nr=2, min=0.05, max=2, log=1)
    n("osc_hz", "transponiere")
    c("note.hz", "osc_hz.hz")
    n("saw", "saege")
    c("osc_hz.aus", "saw.hz")
    n("pw", "konst", wert=0.3)
    n("puls", "puls")
    c("osc_hz.aus", "puls.hz")
    c("pw.aus", "puls.pwm")
    n("saw_g", "mul", b=0.4)
    c("saw.aus", "saw_g.a")
    n("puls_g", "mul", b=0.2)
    c("puls.aus", "puls_g.a")
    n("mix", "add")
    c("saw_g.aus", "mix.a")
    c("puls_g.aus", "mix.b")
    n("fenv", "adsr", a=0.002, d=0.3, s=0.5, r=0.3)
    c("note.gate", "fenv.gate")
    c("note.trig", "fenv.trig")
    c("k_dec.aus", "fenv.d")
    n("rel", "mul", b=2.0)
    c("k_dec.aus", "rel.a")
    c("rel.aus", "fenv.r")
    n("env_st", "mul", b=24.0)
    c("fenv.aus", "env_st.a")
    n("cut_st", "add")
    c("env_st.aus", "cut_st.a")
    n("cutoff", "transponiere")
    c("k_cut.aus", "cutoff.hz")
    c("cut_st.aus", "cutoff.st")
    n("lad", "ladder", reso=0.3)
    c("mix.aus", "lad.x")
    c("cutoff.aus", "lad.cutoff")
    n("vel_k", "mul", b=0.6)
    c("note.vel", "vel_k.a")
    n("amp", "add", a=0.4)
    c("vel_k.aus", "amp.b")
    n("vca", "mul")
    c("lad.aus", "vca.a")
    c("amp.aus", "vca.b")
    n("aus", "ausgang")
    if stereo:
        c("vca.aus", "aus.l")
        c("vca.aus", "aus.r")
    else:
        c("vca.aus", "aus.x")
    return g


# ---- cases: (block applied to a toy copy, knobs at 1 for "on") ------------------------------------------------------------------------

def _mod_env(g):
    r = A.mod_env(g, "me", 10, [("cutoff", 24, "cutoff.st"), ("pwm", 0.5, "puls.pwm")])
    return r, {14: 1.0, 15: 1.0}


def _lfo2(g):
    ziele = [("cutoff.st", 12), ("puls.pwm", 0.3), ("osc_hz.cent", 100), ("lad.reso", 0.3), ("vca.b", 0.5)]
    r = A.lfo2(g, "l2", 20, ziele)
    return r, {24: 1.0}


def _lfo2_sync(g):
    r = A.lfo2(g, "l2", 20, [("cutoff.st", 12), ("puls.pwm", 0.3)])
    return r, {24: 1.0, 22: 1.0, 23: 1.0}


def _lfo_klein(g):
    r = A.lfo_klein(g, "lk", 30, [("cutoff.st", 12), ("puls.pwm", 0.3), ("osc_hz.cent", 100)])
    return r, {31: 1.0}


def _huellen(g):
    r = A.huellen_zeit(g, "fenv", attack=(40, 0.002), decay=(41, 0.3), sustain=(42, 0.5), release=(43, 0.3))
    return r, {40: 1.0, 41: 0.0, 42: 1.0, 43: 1.0}


def _zeit_konst(g):
    # fenv.a carries the node constant 0.002 in the toy; the knob (mitte = that constant) takes its place as the source
    r = A.zeit_faktor(g, "zk", 44, None, 0.002, 0.0005, 5)
    A.kante(g, r["aus"], "fenv.a")
    return r, {44: 1.0}


def _glide(g):
    r = A.glide(g, "gl", 50, "note.hz", "note.erste")
    intern = tuple(f"gl_g{i}.x" for i in range(6)) + ("gl_w.e1",)
    A.umhaengen(g, "note.hz", r["aus"], ausser=intern)
    return r, {50: 1.0}


def _schluessel(g):
    r = A.schluesselfolge(g, "kf", 51, "note.hz", "cut_st.aus")
    return r, {51: 1.0}


def _osc2(g):
    r = A.osc2(g, "o2", 52, "B", "osc_hz.aus", "pw.aus")
    A.summe_erweitern(g, "o2_mix", "mix.aus", r["aus"])
    return r, {52: 1.0, 53: 1.0, 57: 1.0, 58: 0.5}


def _vel_tiefe(g):
    r = A.vel_tiefe(g, "vt", 60, "note.vel", "vel_k.aus")
    A.umhaengen(g, "vel_k.aus", r["aus"], ausser=("vt_t.a",))
    return r, {60: 1.0}


def _vel_cut(g):
    r = A.vel_zu_cutoff(g, "vc", 61, "note.vel", "cut_st.aus")
    return r, {61: 1.0}


def _stimmung(g):
    r = A.stimmung(g, "tu", 62, "note.hz")
    A.eingang_von(g, "osc_hz.hz")[0]["von"] = r["aus"]
    return r, {62: 1.0}


def _env_menge(g):
    r = A.filter_env_menge(g, "fm", 63, "fenv.aus", "cut_st.aus")
    return r, {63: 1.0}


def _fx_mono(g):
    r = A.fx_ende(g, "fx", 20, ("x", "vca.aus"))
    g["kanten"] = [x for x in g["kanten"] if x["nach"] != "aus.x"]
    A.kante(g, r["l"], "aus.l")
    A.kante(g, r["r"], "aus.r")
    return r, {20: 1.0, 24: 1.0, 26: 1.0}


def _fx_stereo(g):
    r = A.fx_ende(g, "fx", 20, ("lr", "vca.aus", "vca.aus"), pingpong=False)
    g["kanten"] = [x for x in g["kanten"] if x["nach"] not in ("aus.l", "aus.r")]
    A.kante(g, r["l"], "aus.l")
    A.kante(g, r["r"], "aus.r")
    return r, {20: 1.0, 24: 1.0, 25: 1.0}


def _fx_klein(g):
    r = A.fx_klein(g, "fx", 20, ("x", "vca.aus"), ["delay", "hall"])
    g["kanten"] = [x for x in g["kanten"] if x["nach"] != "aus.x"]
    A.kante(g, r["l"], "aus.l")
    A.kante(g, r["r"], "aus.r")
    return r, {22: 1.0, 24: 1.0}


FAELLE = {
    "mod_env": (_mod_env, False), "lfo2": (_lfo2, False), "lfo2_sync": (_lfo2_sync, False), "lfo_klein": (_lfo_klein, False),
    "huellen_zeit": (_huellen, False), "zeit_faktor_konstante": (_zeit_konst, False), "glide": (_glide, False),
    "schluesselfolge": (_schluessel, False), "osc2": (_osc2, False), "vel_tiefe": (_vel_tiefe, False),
    "vel_zu_cutoff": (_vel_cut, False), "stimmung": (_stimmung, False), "filter_env_menge": (_env_menge, False),
    "fx_ende_mono": (_fx_mono, False), "fx_ende_stereo": (_fx_stereo, True), "fx_klein": (_fx_klein, False),
}


def regler_knoten(g, nr):
    return [k for k in g["knoten"] if k["art"] == "regler" and k["nr"] == nr][0]


def f32_mitte(lo, hi):
    lo, hi, h = np.float32(lo), np.float32(hi), np.float32(0.5)
    return lo + (hi - lo) * h


@pytest.mark.parametrize("name", FAELLE)
def test_baustein_gegen_spielzeug(name, arbeit):
    bauen, stereo = FAELLE[name]
    alt = spielzeug(stereo)
    g = copy.deepcopy(alt)
    info, an = bauen(g)
    # the graph is well formed: unique ids, no dead node (every node reaches the output)
    ids = [k["id"] for k in g["knoten"]]
    assert len(ids) == len(set(ids)), "duplicate node id"
    ziele_von = {}
    for e in g["kanten"]:
        ziele_von.setdefault(e["nach"].split(".")[0], []).append(e["von"].split(".")[0])
    erreicht, stapel = set(), ["aus"]
    while stapel:
        n = stapel.pop()
        if n not in erreicht:
            erreicht.add(n)
            stapel += ziele_von.get(n, [])
    tot = set(ids) - erreicht
    assert not tot, f"dead nodes: {sorted(tot)}"
    # every knob has the vorgabe its class demands
    assert info["namen"].keys() == info["vorgaben"].keys() == info["klassen"].keys()
    for nr, klasse in info["klassen"].items():
        k = regler_knoten(g, nr)
        assert k.get("vorgabe") == info["vorgaben"][nr], (nr, k)
        if nr in info["stufen"]:
            n, i = info["stufen"][nr]
            assert k["vorgabe"] == (0 if n <= 1 else i / (n - 1)), (nr, "selector vorgabe is diskretWert(index, n)")
        if klasse == "G":
            assert k["vorgabe"] == 0 and k["min"] == 0 and "mitte" not in k and "log" not in k, (nr, k)
        elif klasse == "GB":
            assert k["vorgabe"] == 0.5 and k["min"] == -k["max"] and "mitte" not in k and "log" not in k, (nr, k)
            z = f32_mitte(k["min"], k["max"])
            assert z == 0 and not np.signbit(z), f"knob {nr}: -x..x at 0.5 is {z!r}, not +0.0"
        elif klasse == "N":
            assert k["vorgabe"] == 0.5 and "mitte" in k, (nr, k)
        else:
            assert klasse == "F" and 0 <= k["vorgabe"] <= 1, (nr, k)
    # the translator accepts it, and the null holds bit for bit
    pa, pg = arbeit / f"{name}.alt.json", arbeit / f"{name}.neu.json"
    pa.write_text(json.dumps(alt))
    pg.write_text(json.dumps(g))
    for probe in ("linie", "rampe"):
        wa, wn = arbeit / f"{name}.alt.wav", arbeit / f"{name}.neu.wav"
        M.render(pa, wa, {}, probe)
        M.render(pg, wn, {}, probe)
        assert M.gleich(wa, wn), f"{name}: not byte-equal to the toy at the vorgabe ({probe})"
        # and not wired to nothing: the amount knobs at 1 change the sound
        M.render(pg, wn, an, probe)
        if not (name == "glide" and probe == "rampe"):     # a chord on fresh voices has nothing to glide from (`erste` resets each)
            assert not M.gleich(wa, wn), f"{name}: knobs {an} change nothing ({probe})"
        assert M.masse(wn)["endlich"]


def test_zeit_faktor_mit_konstante_gibt_die_konstante_bitgleich_zurueck(arbeit):
    g = {"knoten": [], "kanten": []}
    r = A.zeit_faktor(g, "z", 7, None, 0.002, 0.0005, 5)
    k = regler_knoten(g, 7)
    assert k["mitte"] == 0.002 and k["vorgabe"] == 0.5 and k["log"] == 1
    # the engine's value at knob 0.5 is `mitte` by branch: the f32 of the constant, exactly what the node constant parses to
    assert np.float32(k["mitte"]) == np.float32(0.002)
    assert r["klassen"] == {7: "N"}
    # with a source: factor 1.0 at the centre
    g = {"knoten": [], "kanten": []}
    A.zeit_faktor(g, "z", 7, "x.aus", None, 0.1, 10)
    assert regler_knoten(g, 7)["mitte"] == 1.0


def test_schluesselfolge_folgt_dem_logarithmus():
    fehler = [abs(A.schluessel_modell(hz) - 12 * np.log2(hz / A.HZ_REF)) for hz in np.geomspace(16.5, 4200, 400)]
    assert max(fehler) < 0.45, max(fehler)
    assert A.schluessel_modell(A.HZ_REF) == pytest.approx(0, abs=1e-9)


def test_osc2_stufe_a_meldet_klar():
    with pytest.raises(NotImplementedError, match="tier A"):
        A.osc2({"knoten": [], "kanten": []}, "o", 1, "A", "x.aus", "y.aus")


def test_knopfnummer_doppelt_wird_abgelehnt():
    info = A._Info()
    info.neu(1, "a", 0.0, "G")
    with pytest.raises(ValueError, match="used twice"):
        info.neu(1, "b", 0.0, "G")


# ---- the harness proves itself before it judges a graph ----------------------------------------------------------------------------------

def _ref_da(ref):
    return subprocess.run(["git", "-C", str(M.REPO), "rev-parse", "--verify", "-q", ref + "^{commit}"], capture_output=True).returncode == 0


# the harness proof compares against the work repo's history; a copy without it (the public export) has no old side to compare with
braucht_verlauf = pytest.mark.skipif(not _ref_da(M.DRIFT_VOR), reason="needs the git history of the work repo (the commit before the Drift knob)")


@braucht_verlauf
def test_harness_drift_aus_besteht(arbeit):
    ok, erg = M.laufen("poly-drift-aus", M.GRAPHEN["poly-drift-aus"], arbeit=arbeit / "h1")
    assert ok, json.dumps(erg)[:2000]
    assert len(erg["null"]) >= 10 and all(r["identisch"] for r in erg["null"].values())


@braucht_verlauf
def test_harness_faengt_einen_unterschied(arbeit):
    # positive control: Drift at 0.25 on the new side against the pre-drift graph must be reported as not equal
    cfg = M.Graph(neu=M.POLY, alt_ref=M.DRIFT_VOR, neue=(28,), null_zustand={28: 0.25})
    ok, erg = M.laufen("kontrolle", cfg, arbeit=arbeit / "h2")
    assert not ok and not erg["null"]["standard"]["identisch"]
