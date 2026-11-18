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
prefix of its factory presets in ui/presets/factory/modular (`<prefix>-*.preset.json`, plus `presets_extra` names), `neue`
the new knob numbers (default: every number in the new graph that the old one lacks), `null_zustand` {nr: value} forced on the new
side in the null cases (for a knob whose vorgabe is not its "off"), `merkmale` the feature-on cases `(name, {nr: value})` or
`(name, {nr: value}, probe)`, and the audit limits.
"""
import concurrent.futures
import dataclasses
import json
import math
import os
import pathlib
import subprocess
import sys

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
REPO = HIER.parents[2]
# CARGO_TARGET_DIR (as cargo reads it) moves the build folder out of the tree, so a worktree never touches the shared target folder;
# MESSE_NULL_AUS (or MESSUNG_DIR) moves the raw output
WERKZEUG = pathlib.Path(os.environ.get("CARGO_TARGET_DIR") or HIER.parent / "target") / "release" / "examples" / "render_kit"
PRESETS = REPO / "djk" / "ui" / "presets" / "factory" / "modular"
MESSUNG = pathlib.Path(os.environ.get("MESSE_NULL_AUS") or os.environ.get("MESSUNG_DIR") or pathlib.Path.home() / "messungen" / "2026-11-11-synth-ausbau")
SR = 48_000

PROBEN = {
    "linie": ["--hits", "45@0:0.8,49@0.5:0.8,52@1:0.8,57@1.5:0.8,47@2:0.8,51@2:0.8,54@2:0.8,59@2:0.8", "--off", "0.45", "--dauer", "4.5"],
    "rampe": ["--hits", "45@0:0.25,49@0:0.5,52@0:0.75,57@0:1.0", "--off", "1.5", "--dauer", "3.5"],
    # the drum kits: the two probes above play only notes 45 to 59 and never kick, snare, clap or closed hat, so the per-group level
    # knobs of drums-909 / drums-808 need their own. `kit` = every 909 drum, `kit808` = the same plus Boom, Cowbell and Clave.
    "kit": ["--hits", "36@0:0.9,38@0.75:0.9,39@1.5:0.9,37@2.25:0.9,42@3:0.9,44@3.5:0.9,46@4:0.9,41@5:0.9,45@5.5:0.9,48@6:0.9,49@6.5:0.9,51@9:0.9",
            "--off", "0.2", "--dauer", "12"],
    "kit808": ["--hits", "36@0:0.9,38@0.75:0.9,39@1.5:0.9,37@2.25:0.9,42@3:0.9,44@3.5:0.9,46@4:0.9,41@5:0.9,45@5.5:0.9,48@6:0.9,49@6.5:0.9,51@9:0.9,"
               "35@12:0.9,56@13:0.9,75@14:0.9", "--off", "0.2", "--dauer", "16"],
}
AUFW_POLY_BASIS = "3b54ff71f23372a012c2ba7abb72a0f2f38dc17d"   # main when the synth upgrade wave 1 plan was committed
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
    null_proben: tuple = ()         # extra probes: one more null case each for the standard state and for every factory preset
    gleich_faelle: list = dataclasses.field(default_factory=list)   # `(name, {nr: value}, probe)` that must stay byte equal to the null state
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
# every factory preset synth-mono has today (the two newer ones use knobs 33..60, which exist on both sides of the wave-1 null)
SYNTH_MONO_ALLE = SYNTH_MONO_WERK + ("synth-mono-dub-bass", "synth-mono-evolving-lead")
# the eight factory presets synth-poly had before the build-out: the null cases of the poly entries (the presets of the build-out use new knobs; the glob
# `presets` of such an entry matches nothing on purpose, `presets_extra` names the files)
POLY_ALTE = dict(presets="synth-poly-(nur-alte)", presets_extra=tuple(f"synth-poly-{n}" for n in (
    "brass", "detroit-strings", "dnb-atmosphere", "goa-lead-stack", "house-chord-stab", "juno-pad", "pluck", "trance-supersaw")))
# the wavetable graphs of the synth upgrade (wave 1, task D): the commit the plan was cut from is the old side
WT = "djk/instruments/modular_dsp/demos/"
WT_BASIS = "3b54ff71f"
WT_WARP = [("warp bend", {10: 1 / 3}), ("warp asym", {10: 2 / 3}), ("warp sync", {10: 1.0}),
           ("warp bend -1", {10: 1 / 3, 11: 0.0}), ("warp bend +1", {10: 1 / 3, 11: 1.0}), ("warp asym -1", {10: 2 / 3, 11: 0.0}),
           ("warp asym +1", {10: 2 / 3, 11: 1.0}), ("warp sync +1", {10: 1.0, 11: 1.0}), ("warp bend +1, chord", {10: 1 / 3, 11: 1.0}, "rampe")]
WT_STAPEL = [("stack octave", {12: 0.5}), ("stack octave + fifth", {12: 1.0}), ("stack octave + fifth, chord", {12: 1.0}, "rampe")]
WT_CHAOS = [("chaos to position +1", {14: 1.0}), ("chaos to position -1", {14: 0.0}), ("chaos fast", {13: 1.0, 14: 1.0}), ("chaos slow", {13: 0.0, 14: 1.0})]
# F knobs behind an Off selector or a zero amount: byte equal to the null state at both stops, alone and together
WT_GLEICH = [(f"{n} {v}", {k: v}, "linie") for n, k in (("warp depth", 11), ("chaos rate", 13)) for v in (0.0, 1.0)] + [
    ("all F at 0", {11: 0.0, 13: 0.0}, "rampe"), ("all F at 1", {11: 1.0, 13: 1.0}, "rampe")]
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
    # synth-mono upgrade wave 1 (plan 2026-11-18, Task A): knobs 58 (chaos rate), 61 (chaos to cutoff), 62 (chaos to osc 2 pitch), 63 (clean sub).
    # The old side is the graph before that wave (the commit the branch was cut from; `--alt` overrides). Null cases: the default, all ten factory
    # presets synth-mono has today (they use knobs that exist on both sides) and the chord / velocity probe. Knob 58 is free and reaches the
    # sound only through 61 and 62, so it must stay byte equal at both ends of its travel (`gleich_faelle`, both probes).
    "synth-mono-neu": Graph(
        neu=MONO, alt_ref="3b54ff71f", presets_extra=SYNTH_MONO_ALLE, neue=(58, 61, 62, 63),
        merkmale=[("chaos cutoff +1", {61: 1.0}), ("chaos cutoff -1", {61: 0.0}), ("chaos osc2 pitch +1", {62: 1.0}),
                  ("chaos osc2 pitch -1", {62: 0.0}), ("clean sub", {63: 1.0}), ("clean sub half", {63: 0.5}, "rampe"),
                  ("chaos cutoff fast", {61: 1.0, 58: 1.0}), ("chaos cutoff slow", {61: 1.0, 58: 0.0}),
                  ("chaos both and sub", {61: 0.75, 62: 0.75, 63: 0.5}, "rampe")],
        gleich_faelle=[(f"chaos rate {w} alone ({p})", {58: w}, p) for w in (0.0, 1.0) for p in ("linie", "rampe")]),
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
    # synth-neuro upgrade, wave 1: knobs 46..56 (warp, stack, phase mod, chaos, drift), old side = the commit the branch was cut from
    # (`--alt $(git merge-base HEAD main)`). Null cases: default (linie and rampe), every factory preset of synth-neuro (`synth-neuro-*`).
    # Warp mode / stack positions are knob positions: warp 1/3 bend, 2/3 asym, 1 sync; stack 0.5 octave, 1 octave + fifth.
    # Class F knobs behind an "off" must leave the null state byte equal, at both ends (`gleich_faelle`).
    "synth-neuro-aufwertung": Graph(
        neu=NEURO, presets="synth-neuro", neue=tuple(range(46, 57)), null_proben=("rampe",),
        gleich_faelle=[
            *[(f"warp off, depth {w} {p}", {47: w}, p) for w in (0.0, 1.0) for p in ("linie", "rampe")],
            ("warp off, lfo1 to depth +1", {48: 1.0}, "linie"), ("warp off, lfo1 to depth -1", {48: 0.0}, "linie"),
            *[(f"phase mod 0, ratio {i}", {51: i / 4}, "linie") for i in range(5)],
            *[(f"chaos amounts 0, rate {r}", {52: r}, "linie") for r in (0.0, 0.5, 1.0)],
        ],
        merkmale=[
            *[(f"warp {m} depth {d}", {46: v, 47: dv}) for m, v in (("bend", 1 / 3), ("asym", 2 / 3), ("sync", 1.0)) for d, dv in (("-1", 0.0), ("+1", 1.0), ("default", 0.75))],
            ("lfo1 to warp depth +1", {46: 1 / 3, 48: 1.0}), ("lfo1 to warp depth -1", {46: 1 / 3, 48: 0.0}),
            ("stack octave", {49: 0.5}, "rampe"), ("stack octave + fifth", {49: 1.0}, "rampe"),
            *[(f"phase mod ratio {r}", {50: 0.5, 51: i / 4}) for i, r in enumerate((0.5, 1, 2, 3, 4))],
            ("phase mod max", {50: 1.0, 51: 1.0}),
            ("chaos to wave +1", {53: 1.0}), ("chaos to wave -1", {53: 0.0}), ("chaos to wave, rate max", {53: 1.0, 52: 1.0}),
            ("chaos to cutoff +1", {54: 1.0}), ("chaos to cutoff -1", {54: 0.0}),
            ("chaos to fold +1", {55: 1.0}), ("chaos to fold -1", {55: 0.0}),
            ("drift", {56: 1.0}),
            ("all new on, extreme", {46: 1 / 3, 47: 0.0, 49: 1.0, 50: 1.0, 51: 1.0, 53: 1.0, 54: 1.0, 55: 1.0, 56: 1.0}, "rampe"),
        ]),
    # drums (backlog sound, task 1): the seven per-group level knobs 33..39 (dB, vorgabe 0.5 = 0 dB). The factory presets carry knobs 1..32 only.
    # On the 909 knob 39 has no drum (note 56 is a crash there, note 75 silent): its case must be byte equal, on the probe that plays both.
    "drums-909": Graph(neu="djk/instruments/modular_dsp/demos/drums-909.json", alt_ref="b69e82be", presets="drums-909", neue=tuple(range(33, 40)),
                       null_proben=("kit",),
                       merkmale=[(n, {k: 1.0}, "kit") for n, k in (("kick level", 33), ("snare level", 34), ("clap level", 35), ("tom level", 36),
                                                                    ("hat level", 37), ("cymbal level", 38))],
                       gleich_faelle=[("perc level has no 909 drum", {39: 1.0}, "kit808")]),
    "drums-808": Graph(neu="djk/instruments/modular_dsp/demos/drums-808.json", alt_ref="b69e82be", presets="drums-808", neue=tuple(range(33, 40)),
                       null_proben=("kit808",),
                       merkmale=[(n, {k: 1.0}, "kit808") for n, k in (("kick level", 33), ("snare level", 34), ("clap level", 35), ("tom level", 36),
                                                                       ("hat level", 37), ("cymbal level", 38), ("perc level", 39))]),
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
    # synth-poly upgrade wave 1 (Task B of 2026-11-18-synth-upgrade-new-blocks.md): table position, warp, stack, phase mod and chaos on top of the
    # build-out. Old side = the graph at the commit the branch was cut from (`git merge-base HEAD main`); null cases = default, EVERY factory preset
    # synth-poly has (the glob matches all ten), the chord/velocity probe. Run: python3 measure_null.py run synth-poly-aufw --alt $(git merge-base HEAD main)
    # knob positions: 45 position (centre = the saw), 52/64 bipolar (0.5 = off), 59 warp mode = mode / 3, 60 depth -1..1, 61 stack = option,
    # 53 phase mod 0..0.5 cycles, 58 ratio option / 6 (0.5 1 2 3 4 5 7), 62 chaos rate, 63 chaos to cutoff bipolar
    "synth-poly-aufw": Graph(
        neu=POLY, alt_ref=AUFW_POLY_BASIS, presets="synth-poly",
        merkmale=[
            ("position 0", {45: 0.0}), ("position 1", {45: 1.0}), ("position 0.3", {45: 0.3}),
            ("mod env to position +1", {52: 1.0, 45: 0.2}), ("mod env to position -1", {52: 0.0, 45: 0.8}),
            ("chaos to position +1", {64: 1.0}), ("chaos to position -1", {64: 0.0}), ("chaos position fast", {64: 1.0, 62: 0.9}),
            ("chaos to cutoff +1", {63: 1.0}), ("chaos to cutoff -1", {63: 0.0}),
            *[(f"warp {m} depth {d:+d}", {59: i / 3, 60: 0.5 + 0.5 * d}) for i, m in ((1, "bend"), (2, "asym"), (3, "sync")) for d in (1, -1)],
            ("warp sync depth 0.5", {59: 1.0, 60: 0.75}),
            ("stack octave", {61: 1.0}, "rampe"),
            ("phase mod 0.5 ratio 2", {53: 1.0}), ("phase mod 0.25 ratio 2", {53: 0.5}),
            *[(f"phase mod ratio {r}", {53: 0.6, 58: i / 6}) for i, r in enumerate(("0.5", "1", "2", "3", "4", "5", "7"))],
            ("phase mod max + warp bend +1, ratio 7", {53: 1.0, 58: 1.0, 59: 1 / 3, 60: 1.0}),
            ("phase mod max + warp asym -1, ratio 7", {53: 1.0, 58: 1.0, 59: 2 / 3, 60: 0.0}),
            ("phase mod max + warp sync +1, ratio 7", {53: 1.0, 58: 1.0, 59: 1.0, 60: 1.0}),
            ("everything on", {45: 0.8, 52: 1.0, 64: 1.0, 63: 1.0, 59: 1 / 3, 60: 1.0, 61: 1.0, 53: 1.0, 58: 1.0}, "rampe"),
        ],
        # review focus: an N selector at its first position with the F knobs behind it at ANY value is still the old sound
        gleich_faelle=[
            *[(f"F knobs at {w} {pr}", {58: w, 60: w, 62: w}, pr) for w in (0.0, 1.0) for pr in ("linie", "rampe")],
            *[(f"ratio {i}", {58: i / 6}, "linie") for i in range(7)],
            ("warp depth only", {60: 0.0}, "rampe"), ("chaos rate only", {62: 1.0}, "rampe"),
            ("ratio and rate together", {58: 1.0, 62: 0.0}, "rampe"),
        ]),
    # recipe graph drums-kick (backlog sound, task 7): knob 7 Pitch decay is new, the Tune range grows downwards to 36 Hz and `mitte`
    # keeps knob position 0.5 at the old value; the base is the commit before the change
    "drums-kick-rezept": Graph(
        neu="djk/instruments/modular_dsp/demos/recipes/drums-kick.json", alt_ref="ae343277d", presets="drums-kick", neue=(7,),
        merkmale=[("pitch decay 0", {7: 0.0}), ("pitch decay 1", {7: 1.0})]),
    # synth upgrade wave 1, task D: knobs 10.. of the three wavetable graphs (null state = every new knob at its vorgabe; the F knobs behind an
    # Off selector or a zero amount must not change a bit, `gleich_faelle`). Warp mode knob position = option / 3, stack = option / 2.
    "wavetable-reese": Graph(
        neu=WT + "wavetable-reese.json", alt_ref=WT_BASIS, presets="wavetable-reese",
        merkmale=[*WT_WARP, *WT_STAPEL, *WT_CHAOS, ("sub", {15: 1.0}), ("sub octave -2", {15: 1.0, 16: 1.0}), ("phase mod", {17: 1.0}),
                  ("phase mod half", {17: 0.5}), ("phase mod max + bend 1", {17: 1.0, 10: 1 / 3, 11: 1.0}), ("band drive", {18: 1.0}),
                  ("band drive half", {18: 0.5})],
        gleich_faelle=[*WT_GLEICH, ("sub octave alone", {16: 1.0}, "linie")]),
    "wavetable-supersaw": Graph(
        neu=WT + "wavetable-supersaw.json", alt_ref=WT_BASIS, presets="wavetable-supersaw",
        merkmale=[*WT_WARP, *WT_STAPEL, *WT_CHAOS, ("chorus I", {15: 1.0}), ("chorus II", {15: 1.0, 16: 0.5}), ("chorus I+II", {15: 1.0, 16: 1.0}),
                  ("chorus I, chord", {15: 1.0}, "rampe")],
        gleich_faelle=[*WT_GLEICH, ("chorus mode alone", {16: 1.0}, "linie")]),
    "wavetable-chor": Graph(
        neu=WT + "wavetable-chor.json", alt_ref=WT_BASIS, presets="wavetable-chor",
        merkmale=[*WT_WARP, *WT_STAPEL, *WT_CHAOS, ("phase mod", {15: 1.0}), ("phase mod half", {15: 0.5}),
                  ("phase mod max + bend 1", {15: 1.0, 10: 1 / 3, 11: 1.0}), ("chorus I", {16: 1.0}), ("chorus II", {16: 1.0, 17: 0.5}),
                  ("chorus I+II", {16: 1.0, 17: 1.0}), ("chorus I, chord", {16: 1.0}, "rampe")],
        gleich_faelle=[*WT_GLEICH, ("chorus mode alone", {17: 1.0}, "linie")]),
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

    ergebnis = {"graph": name, "alt_ref": ref, "neue_knoepfe": neue, "null": {}, "merkmale": {}, "gleich": {}, "extreme": {}}
    ok = True
    with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("MESSE_NULL_ARBEITER", "4"))) as pool:
        # set 1: null
        nullfaelle = [("standard", "linie", {}), ("standard-rampe", "rampe", {})]
        nullfaelle += [(p.name.replace(".preset.json", ""), "linie", preset_knoepfe(p)) for p in preset_dateien(cfg)]
        for extra in cfg.null_proben:
            nullfaelle += [(f"standard-{extra}", extra, {})]
            nullfaelle += [(p.name.replace(".preset.json", "") + f"-{extra}", extra, preset_knoepfe(p)) for p in preset_dateien(cfg)]

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

        # set 2b: cases that must stay byte equal to the null state (a knob without a drum behind it)
        def gleichfall(m):
            n, knoepfe, probe = m
            a, b = arbeit / f"g-{n}.aus.wav", arbeit / f"g-{n}.an.wav"
            render(neu_pfad, a, zustand(), probe)
            render(neu_pfad, b, zustand(knoepfe), probe)
            g = gleich(a, b)
            if g:
                a.unlink(), b.unlink()
            return n, {"identisch": g}

        for n, r in pool.map(gleichfall, cfg.gleich_faelle):
            ergebnis["gleich"][n] = r
            ok &= r["identisch"]
            if not r["identisch"]:
                print("EQUAL CASE FAILED", n)

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
    for n, r in erg["gleich"].items():
        print(f"equal    {n:44s} identical={r['identisch']}")
    print(f"extremes {sum(r['ok'] for r in erg['extreme'].values())}/{len(erg['extreme'])} ok")
    print("ALL OK" if ok else "FAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
