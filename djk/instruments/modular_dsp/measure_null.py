#!/usr/bin/env python3
"""Bit-exact null harness for the synth build-out (plan synth-ausbau, Decision 4). Successor of measure_drift_hull.py, table driven.

    python3 measure_null.py run <graph> [--alt <git-ref>]     exit 0 only if every case below holds
    python3 measure_null.py list                              the registered graphs

Three sets of cases per graph, rendered with the release example `render_kit` (32-bit float WAV, so "equal" means every sample
bit for bit, not just after 16-bit rounding):

  1. Null. The old graph (`git show <ref>:<path>`) and the new graph with every new knob at its `vorgabe`. Cases: the default case,
     every factory preset of the graph (absent knobs at the new graph's `vorgabe`, as presets/apply.ts fills them) on the line
     probe, and the default on the chord probe with a velocity ramp. On the old side every knob that exists in both graphs is set
     explicitly to the value the new side starts with. The two WAVs must be byte-equal.
  2. Feature on. Each entry of `merkmale`: the new graph with those knobs moved must differ from the new graph in its null state,
     peak and RMS inside the audit range, no NaN.
  3. Extremes. Every new knob alone at 0 and at 1, all others at `vorgabe`: no NaN, no DC above the limit, peak below the clip bound.

A tolerance instead of byte equality is allowed only for a block that is proven not bit-transparent; then `toleranz_db` of the
graph entry names the bound (at most -120 dBFS) and the entry's `toleranz_grund` the reason. Task 2 found no such block.

Probes (`render_kit` has no host tempo: a synced `lfo` stands at beat 0 there, a constant value; it still differs from "off"):
  linie  A2 C#3 E3 A3 one after the other (0.45 s held, velocity 0.8), then a different chord (B2 D#3 F#3 B3, so a voice that glides has somewhere to go) for 0.45 s, 1.5 s tail
  rampe  the chord A2 C#3 E3 A3 struck together at velocities 0.25 0.5 0.75 1.0, held 1.5 s

Adding a graph (Tasks 11-13): one entry in GRAPHEN. Fields of `Graph`: `neu` path of the new graph relative to the repo root,
`alt_pfad` the path in the old ref (default `neu`), `alt_ref` the old ref (default eb4dc6e8, `--alt` overrides), `presets` the file
prefix of its factory presets in ui/presets/werk/baukasten (`<prefix>-*.preset.json`, plus `presets_extra` names), `neue`
the new knob numbers (default: every number in the new graph that the old one lacks), `null_zustand` {nr: value} forced on the new
side in the null cases (for a knob whose vorgabe is not its "off"), `merkmale` the feature-on cases `(name, {nr: value})` or
`(name, {nr: value}, probe)`, and the audit limits.
"""
import concurrent.futures
import dataclasses
import json
import math
import pathlib
import subprocess
import sys

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
REPO = HIER.parents[2]
WERKZEUG = HIER.parent / "target" / "release" / "examples" / "render_kit"
PRESETS = REPO / "djk" / "ui" / "presets" / "werk" / "baukasten"
MESSUNG = pathlib.Path.home() / "messungen" / "2026-11-11-synth-ausbau"
SR = 48_000

PROBEN = {
    "linie": ["--hits", "45@0:0.8,49@0.5:0.8,52@1:0.8,57@1.5:0.8,47@2:0.8,51@2:0.8,54@2:0.8,59@2:0.8", "--off", "0.45", "--dauer", "4.5"],
    "rampe": ["--hits", "45@0:0.25,49@0:0.5,52@0:0.75,57@0:1.0", "--off", "1.5", "--dauer", "3.5"],
}
DRIFT_VOR = "62dac099^"      # the commit before the Drift knob: the old side of the harness proof


@dataclasses.dataclass
class Graph:
    neu: str
    alt_pfad: str = ""
    alt_ref: str = "eb4dc6e8"
    presets: str = ""
    presets_extra: tuple = ()
    neue: tuple = ()
    null_zustand: dict = dataclasses.field(default_factory=dict)
    merkmale: list = dataclasses.field(default_factory=list)
    peak_max: float = 1.0           # clip bound of tests/synth_*.rs (extreme positions must stay below 1.0)
    rms_min_db: float = -60.0       # audit range of the feature-on cases: not silent ...
    rms_max_db: float = -3.0        # ... and not a wall
    dc_max_db: float = -50.0        # the existing DC limit of beispiele_konvention.rs and synth_*.rs
    toleranz_db: float = None       # None = byte equality
    toleranz_grund: str = ""


POLY = "djk/instruments/modular_dsp/demos/synth-poly.json"
MONO = "djk/instruments/modular_dsp/demos/synth-mono.json"
NEURO = "djk/instruments/modular_dsp/demos/synth-neuro.json"
# the 8 factory presets of synth-mono that carry knobs 1..32 only (the two newer ones use knobs 33..60, so they are no null case)
SYNTH_MONO_WERK = tuple(f"synth-mono-{n}" for n in ("acid-303", "dnb-sub", "goa-lead", "hoover-growl", "house-bass", "ms-20-screamer", "rolling-techno-bass", "sync-lead"))
# the eight factory presets synth-poly had before the build-out: the null cases of the poly entries (the presets of the build-out use new knobs; the glob
# `presets` of such an entry matches nothing on purpose, `presets_extra` names the files)
POLY_ALTE = dict(presets="synth-poly-(nur-alte)", presets_extra=tuple(f"synth-poly-{n}" for n in (
    "brass", "detroit-strings", "dnb-atmosphere", "goa-lead-stack", "house-chord-stab", "juno-pad", "pluck", "trance-supersaw")))
GRAPHEN = {
    # harness proof: the Drift work. Knob 28 at 0.0 must reproduce the result of measure_drift_hull.py ...
    "poly-drift-aus": Graph(neu=POLY, alt_ref=DRIFT_VOR, **POLY_ALTE, neue=(28,), null_zustand={28: 0.0},
                            merkmale=[("drift 0.25", {28: 0.25}), ("drift 1", {28: 1.0})]),
    "mono-drift-aus": Graph(neu=MONO, alt_ref=DRIFT_VOR, presets_extra=SYNTH_MONO_WERK, neue=(32,), null_zustand={32: 0.0},
                            merkmale=[("drift 0.25", {32: 0.25}), ("drift 1", {32: 1.0})]),
    # ... and at the graph's own vorgabe 0.25 on both sides (old = the committed graph itself, the knob set explicitly on both)
    # synth-mono full-synth stage (Task 11): knobs 33..60; the default case has Drift 0.25 on both sides
    "synth-mono": Graph(neu=MONO, presets_extra=SYNTH_MONO_WERK,
                        merkmale=[("menv cutoff", {42: 1.0}), ("menv pitch", {40: 1.0}), ("menv pwm", {41: 1.0}),
                                  *[(f"lfo2 {t} {s}", {46: i / 4, 47: a}) for i, t in enumerate(("cutoff", "pitch", "pwm", "reso", "amp"))
                                    for s, a in (("+1", 1.0), ("-1", 0.0))],
                                  ("vel cutoff", {49: 1.0}, "rampe"), ("vel depth 0", {48: 0.0}, "rampe"), ("vel depth 2", {48: 1.0}, "rampe"),
                                  ("delay mix", {57: 1.0}), ("reverb mix", {59: 1.0}), ("chorus", {53: 1.0}), ("master tune", {50: 1.0}),
                                  ("osc1 octave", {51: 1.0}), ("osc1 fine", {52: 1.0}), ("filter attack", {33: 1.0}),
                                  ("filter release", {34: 0.0}), ("amp attack", {35: 1.0})]),
    # synth-neuro (Task 13): knobs 25..45 (44 stays free). LFO 2 target knob = option / 4 (Cutoff Fold Pitch Drive Amp); the sync knob
    # position 3 / 6 = 1/4 note. Velocity depth is class G here (the old graph has no velocity path, see build_synth_neuro.py).
    "synth-neuro": Graph(neu=NEURO, presets_extra=tuple("synth-neuro-" + n for n in (
        "classic-reese", "fold-scream", "goa-zap", "neuro-growl", "notch-sweep", "sub-only", "talking-bass", "techno-rumble-bass")), neue=tuple(list(range(25, 44)) + [45]), merkmale=[
        ("amp attack 1", {25: 1.0}), ("amp decay 0", {26: 0.0}), ("amp sustain 0", {27: 0.0}),
        ("osc2 level", {28: 0.8}),
        *[(f"lfo2 {z} {'+1' if w else '-1'}", {35: i / 4, 36: float(w)}) for i, z in enumerate(("cutoff", "fold", "pitch", "drive", "amp")) for w in (1, 0)],
        ("lfo2 sync quarter", {35: 0.0, 36: 1.0, 34: 0.5}),
        ("key follow", {37: 1.0}), ("velocity depth", {38: 1.0}), ("velocity to cutoff +1", {39: 1.0}),
        ("master tune +1", {40: 1.0}), ("delay mix", {43: 0.5}), ("reverb mix", {45: 0.5}),
    ]),
    "poly-drift-gleich": Graph(neu=POLY, alt_ref="HEAD", **POLY_ALTE, neue=(28,), merkmale=[("drift 1", {28: 1.0})]),
    # synth-poly build-out (Task 12): knob 28 stays as it is (0.25 both sides); the eight old factory presets are the null cases, the
    # presets of the build-out use new knobs and are no null cases
    "synth-poly": Graph(
        neu=POLY, **POLY_ALTE,
        merkmale=[
            ("mod env to pitch", {35: 1.0}), ("mod env to pwm", {36: 1.0, 12: 0.8}), ("mod env to cutoff", {37: 1.0}),
            ("mod env to osc2 pitch", {38: 1.0, 46: 1.0}), ("osc2 level", {46: 1.0}),
            *[(f"lfo2 target {t} amount {a:+d}", {42: t / 4, 43: 0.5 + 0.5 * a, 39: 0.6}) for t in range(5) for a in (1, -1)],
            ("velocity to cutoff", {56: 1.0}), ("master tune", {57: 1.0}),
            ("filter attack", {29: 1.0}), ("filter release", {30: 0.0}), ("velocity depth", {55: 1.0}, "rampe"), ("lfo shape saw", {44: 0.0, 24: 1.0}),
        ]),
}


# ---- rendering ------------------------------------------------------------------------------------------------------------------

def werkzeug_bauen():
    if not WERKZEUG.exists():
        subprocess.run(["nice", "-n", "19", "cargo", "build", "--release", "-j", "6", "-p", "baukasten_dsp", "--example", "render_kit"],
                       cwd=HIER.parent, check=True, capture_output=True)
    return WERKZEUG


def render(graph, wav, knoepfe, probe="linie"):
    """Render `graph` (a file) to `wav`; `knoepfe` {nr: value}. Raises with the renderer's message when the graph is refused."""
    arg = [str(werkzeug_bauen()), str(graph), str(wav)] + PROBEN[probe] + [f"{n}={v!r}" for n, v in sorted(knoepfe.items())]
    p = subprocess.run(["nice", "-n", "19"] + arg, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"render_kit {graph}: {p.stderr.strip() or p.stdout.strip()}")
    return pathlib.Path(wav)


def lies(wav):
    """The float WAV of render_kit as an (n, 2) float32 array."""
    d = pathlib.Path(wav).read_bytes()
    i = d.index(b"data")
    return np.frombuffer(d[i + 8:], dtype="<f4").reshape(-1, 2)


def masse(wav):
    y = lies(wav)
    ok = bool(np.isfinite(y).all())
    y = np.nan_to_num(y)
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
    dc = float(np.abs(y.astype(np.float64).mean(axis=0)).max())
    db = lambda v: round(20 * math.log10(max(v, 1e-9)), 2)
    return {"endlich": ok, "peak": round(float(np.abs(y).max()), 4), "rms_db": db(rms), "dc_db": db(dc)}


def gleich(a, b, toleranz_db=None):
    """Byte equality, or (tolerance fallback) every sample difference below `toleranz_db` dBFS."""
    if toleranz_db is None:
        return pathlib.Path(a).read_bytes() == pathlib.Path(b).read_bytes()
    x, y = lies(a), lies(b)
    return x.shape == y.shape and float(np.abs(x.astype(np.float64) - y).max()) < 10 ** (toleranz_db / 20)


# ---- graph and preset data -----------------------------------------------------------------------------------------------------------

def vorgaben(json_text):
    """{nr: vorgabe} from the first `regler` node of every number (document order, absent vorgabe = 0.5), as the engine reads it."""
    v = {}
    for k in json.loads(json_text)["knoten"]:
        if k["art"] == "regler" and k["nr"] not in v:
            v[k["nr"]] = k.get("vorgabe", 0.5)
    return v


def preset_knoepfe(datei):
    return {int(k[4:]): v for k, v in json.loads(pathlib.Path(datei).read_text())["werte"].items() if k.startswith("knob")}


def preset_dateien(cfg):
    """The factory preset files of a graph entry: the `presets` glob plus the names in `presets_extra`. An entry that names presets
    but resolves to none (or to a missing file) is an error: a null test must never pass because it found nothing to compare."""
    dateien = sorted(PRESETS.glob(f"{cfg.presets}-*.preset.json")) if cfg.presets else []
    dateien += [PRESETS / f"{n}.preset.json" for n in cfg.presets_extra]
    fehlt = [d.name for d in dateien if not d.exists()]
    if fehlt:
        raise FileNotFoundError(f"factory presets not found: {fehlt}")
    if (cfg.presets or cfg.presets_extra) and not dateien:
        raise FileNotFoundError(f"the graph entry names factory presets (presets={cfg.presets!r}) but none was found")
    return dateien


def _deutscher_pfad(pfad):
    """The path under the German folder names the repo had before 2026-11-13 (docs/veroeffentlichung/namen_ordner.tsv)."""
    zurueck = {}
    for z in (REPO / "docs/veroeffentlichung/namen_ordner.tsv").read_text().splitlines():
        if "\t" in z and not z.startswith("#"):
            de, en = z.split("\t")[:2]
            zurueck.setdefault(en, de)
    return "/".join(zurueck.get(t, t) for t in pfad.split("/"))


def git_datei(ref, pfad):
    """File at an older commit; refs from before the folder rename find it under the German folder names."""
    for p in (pfad, _deutscher_pfad(pfad)):
        r = subprocess.run(["git", "-C", str(REPO), "show", f"{ref}:{p}"], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout
    raise FileNotFoundError(f"{pfad} not at {ref} (nor as {_deutscher_pfad(pfad)})")


# ---- the three sets ----------------------------------------------------------------------------------------------------------------------

def laufen(name, cfg, alt_ref=None, arbeit=None):
    """Run all cases of graph `name`; returns (ok, result dict). WAVs go to `arbeit` and are removed when a case passes."""
    arbeit = pathlib.Path(arbeit or MESSUNG / f"null-{name}-wav")
    arbeit.mkdir(parents=True, exist_ok=True)
    ref = alt_ref or cfg.alt_ref
    neu_text = (REPO / cfg.neu).read_text()
    alt_text = git_datei(ref, cfg.alt_pfad or cfg.neu)
    neu_pfad, alt_pfad = arbeit / "neu.json", arbeit / "alt.json"
    neu_pfad.write_text(neu_text)
    alt_pfad.write_text(alt_text)
    v_neu, v_alt = vorgaben(neu_text), vorgaben(alt_text)
    neue = list(cfg.neue) or sorted(set(v_neu) - set(v_alt))
    start = dict(v_neu)

    def zustand(extra=None, praeset=None):
        s = dict(start)
        s.update(praeset or {})
        s.update(cfg.null_zustand)
        s.update(extra or {})
        return s

    ergebnis = {"graph": name, "alt_ref": ref, "neue_knoepfe": neue, "null": {}, "merkmale": {}, "extreme": {}}
    ok = True
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        # set 1: null
        nullfaelle = [("standard", "linie", {}), ("standard-rampe", "rampe", {})]
        nullfaelle += [(p.name.replace(".preset.json", ""), "linie", preset_knoepfe(p)) for p in preset_dateien(cfg)]

        def null(fall):
            n, probe, praeset = fall
            s = zustand(praeset=praeset)
            a, b = arbeit / f"{n}.alt.wav", arbeit / f"{n}.neu.wav"
            render(alt_pfad, a, {k: w for k, w in s.items() if k in v_alt}, probe)
            render(neu_pfad, b, s, probe)
            g = gleich(a, b, cfg.toleranz_db)
            if g:
                a.unlink(), b.unlink()
            return n, {"identisch": g}

        for n, r in pool.map(null, nullfaelle):
            ergebnis["null"][n] = r
            ok &= r["identisch"]
            if not r["identisch"]:
                print("NULL TEST FAILED", n)

        # set 2: feature on
        def merkmal(m):
            n, knoepfe, probe = m[0], m[1], (m[2] if len(m) > 2 else "linie")
            a, b = arbeit / f"m-{n}.aus.wav", arbeit / f"m-{n}.an.wav"
            render(neu_pfad, a, zustand(), probe)
            render(neu_pfad, b, zustand(knoepfe), probe)
            ma = masse(b)
            r = {"an_ungleich_aus": not gleich(a, b), **ma}
            r["pegel_ok"] = ma["endlich"] and ma["peak"] <= cfg.peak_max and cfg.rms_min_db <= ma["rms_db"] <= cfg.rms_max_db
            a.unlink(), b.unlink()
            return n, r

        for n, r in pool.map(merkmal, cfg.merkmale):
            ergebnis["merkmale"][n] = r
            ok &= r["an_ungleich_aus"] and r["pegel_ok"]
            if not (r["an_ungleich_aus"] and r["pegel_ok"]):
                print("FEATURE CASE FAILED", n, r)

        # set 3: every new knob alone at 0 and 1
        def extrem(fall):
            nr, w = fall
            b = arbeit / f"x-{nr}-{w}.wav"
            render(neu_pfad, b, zustand({nr: w}), "linie")
            m = masse(b)
            b.unlink()
            m["ok"] = m["endlich"] and m["dc_db"] <= cfg.dc_max_db and m["peak"] < cfg.peak_max
            return f"k{nr}={w}", m

        for n, r in pool.map(extrem, [(nr, w) for nr in neue for w in (0.0, 1.0)]):
            ergebnis["extreme"][n] = r
            ok &= r["ok"]
            if not r["ok"]:
                print("EXTREME CASE FAILED", n, r)
    ergebnis["ok"] = bool(ok)
    return ok, ergebnis


def main(argv):
    if len(argv) >= 2 and argv[1] == "list":
        for n, c in GRAPHEN.items():
            print(f"{n:22s} {c.neu}  old={c.alt_ref}")
        return 0
    if len(argv) < 3 or argv[1] != "run" or argv[2] not in GRAPHEN:
        print(__doc__)
        return 2
    alt = argv[argv.index("--alt") + 1] if "--alt" in argv else None
    ok, erg = laufen(argv[2], GRAPHEN[argv[2]], alt)
    MESSUNG.mkdir(parents=True, exist_ok=True)
    (MESSUNG / f"null-{argv[2]}.json").write_text(json.dumps(erg, indent=1))
    for n, r in erg["null"].items():
        print(f"null     {n:44s} identical={r['identisch']}")
    for n, r in erg["merkmale"].items():
        print(f"feature  {n:44s} differs={r['an_ungleich_aus']} peak={r['peak']} rms={r['rms_db']} ok={r['pegel_ok']}")
    print(f"extremes {sum(r['ok'] for r in erg['extreme'].values())}/{len(erg['extreme'])} ok")
    print("ALL OK" if ok else "FAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
