#!/usr/bin/env python3
"""Builds the Baukasten instrument `synth-kraken` ("Kraken"): graph (demos/) and front panel (paneele/).

    python3 build_kraken.py            # writes demos/synth-kraken.json and paneele/synth-kraken.json
    python3 build_kraken.py --tabelle  # prints the knob map and the patch field as Markdown tables (for the device document)

Kraken is a semi-modular synthesizer that joins an East-coast voice (three oscillators into a choice of four filters) and a West-coast
voice (sine into wavefolder into a low-pass gate). Version 2 adds a 16 x 16 patch field (the `matrix` block `feld`: sixteen sources as
rows, sixteen destinations as columns, pins in two sets A and B with a Morph knob between them), two function generators (`funktion`)
in place of the two LFOs and a real low-pass gate (`lpg`) in place of the stand-in of version 1. The modulation that version 1 had on
fixed `>` knobs is now the default pins of set A. The knob table K below is the one place that names the knobs: the knob number is the
position in K, and the presets (build_kraken_presets.py) refer to knobs by id, never by number.

Signal path (4 voices, latency 0, stereo only from the delay and the reverb on):

  note -> glide (a `wahl` morph over the raw pitch and four `glatt` smoothers; knob 0 = raw pitch)
  EAST   VCO 1 (saw / pulse / triangle) + VCO 2 (saw / pulse / triangle) + ring (VCO 1 x VCO 2) + noise + VCO 3 (sine, the modulator)
         + a share of the folded West signal + FEEDBACK + the patch column Filter In -> DRIVE (`saett`) -> FILTER (`wahl` over ladder / sem
         / ms20 / diode) -> ENV 2 x velocity
  WEST   sine -> wavefolder (`falter`) -> GATE (`lpg`, the vactrol model; cv = Open + strike envelope, times the key gate) -> x velocity
         The West voice does not pass the amp envelope; a short Gate Decay plucks it while the key is held, Gate Open makes it drone,
         and the key gate (released with ENV 2 Release) ends it.
  voice = (East + West + the patch column Out) x (1 + the patch column Amp) -> DC block -> DELAY -> REVERB -> Volume
  FEEDBACK: the voice behind the amp, through a `saett`, back into the filter input over an edge with `verzoegerung` 1.
  PATCH FIELD `feld`: rows = VCO 1, VCO 2, VCO 3, Noise, Ring, West, Filter, Gate, Env 1, Env 2, Func 1, Func 2, S&H, Chaos, Key,
  Velocity; every edge into a row is delayed one sample (the translator also does that by itself), the columns feed their
  destinations in the same sample. Column ranges at pin value 1 are the constants COLS below.
  Modulation: ENV 1 (filter, knob), FUNC 1 and FUNC 2 (function generators, free-running with Cycle), S&H (stepped random, clocked by
  FUNC 2 `ende`), CHAOS (Lorenz), DRIFT (per voice, per oscillator).
"""
import json
import math
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
NAME = "synth-kraken"
TITEL = "Kraken"
STIMMEN = 4

# ---- knob table: (id, name, min, max, log, default (in knob units), panel format, unit) -------------------------------------
# The knob number is the position in this list (1..60; 61..64 are free). Version 2 keeps the number of every kept knob; the new
# knobs sit in the slots the `>` knobs, the X-MOD knobs and the two LFO rates of version 1 left. Selectors have min 0 and max n-1 (the default is the option
# index): the panel sends index / (n - 1), the graph's `regler` node of a selector runs 0..1 (a `wahl` splits it into n zones).
# Presets name knobs by id and give a selector as its option index.
WAVE = ["Saw", "Pulse", "Tri"]
OPTIONEN = {
    "v1_wave": WAVE, "v2_wave": WAVE,
    "v3_range": ["Key", "Low"],
    "g_mode": ["LP", "Both", "VCA"],
    "f_type": ["Ladder", "SEM", "MS-20", "Diode"],
    "f1_cycle": ["Off", "On"], "f2_cycle": ["Off", "On"],
}
K_ROHE = [
    # VCO 1
    ("v1_wave", "VCO1 Wave", 0, 2, 0, 1, "raw", "mode"),
    ("v1_pitch", "VCO1 Pitch", -24, 24, 0, 0, "raw", "st"),
    ("v1_fine", "VCO1 Fine", -50, 50, 0, 0, "raw", "ct"),
    ("v1_pw", "VCO1 PW", -1, 1, 0, 0.4, "percent", None),
    ("v1_lv", "VCO1 Level", 0, 1, 0, 0.6, "percent", None),
    # VCO 2
    ("v2_wave", "VCO2 Wave", 0, 2, 0, 0, "raw", "mode"),
    ("v2_pitch", "VCO2 Pitch", -24, 24, 0, 0, "raw", "st"),
    ("v2_fine", "VCO2 Fine", -50, 50, 0, 7, "raw", "ct"),
    ("v2_lv", "VCO2 Level", 0, 1, 0, 0.5, "percent", None),
    # RING / NOISE
    ("ring_lv", "Ring Level", 0, 1, 0, 0.1, "percent", None),
    ("noise_lv", "Noise Level", 0, 1, 0, 0.03, "percent", None),
    # VCO 3 (the modulator: a sine)
    ("v3_pitch", "VCO3 Pitch", -36, 36, 0, 12, "raw", "st"),
    ("v3_range", "VCO3 Range", 0, 1, 0, 0, "raw", "mode"),
    ("v3_lv", "VCO3 Level", 0, 1, 0, 0.05, "percent", None),
    # PATCH FIELD (slots 15 to 17 were X-MOD in version 1: the cross-modulation is now default pins)
    ("morph", "Morph", 0, 1, 0, 0, "percent", None),
    # FUNC 1 (slots 15..17 and 43..49 held the X-MOD knobs and the two LFOs of version 1)
    ("f1_rise", "Func1 Rise", 0.001, 20, 1, 0.35, "raw", "s"),
    ("f1_fall", "Func1 Fall", 0.001, 20, 1, 0.35, "raw", "s"),
    # WEST
    ("w_pitch", "West Pitch", -24, 24, 0, 0, "raw", "st"),
    ("w_fine", "West Fine", -50, 50, 0, 0, "raw", "ct"),
    ("w_fold", "West Fold", 0, 36, 0, 10, "raw", "dB"),
    ("w_sym", "West Symmetry", -1, 1, 0, 0, "percent", None),
    ("w_shape", "Fold Shape", 0, 1, 0, 0.5, "percent", None),
    ("w_lv", "West Level", 0, 1, 0, 0.35, "percent", None),
    # GATE
    ("g_mode", "Gate Mode", 0, 2, 0, 1, "raw", "mode"),
    ("g_open", "Gate Open", 0, 1, 0, 0.2, "percent", None),
    ("g_strike", "Gate Strike", 0, 1, 0, 0.6, "percent", None),
    ("g_decay", "Gate Decay", 0.02, 4, 1, 0.35, "raw", "s"),
    # FILTER
    ("f_type", "Filter Type", 0, 3, 0, 0, "raw", "mode"),
    ("f_cut", "Cutoff", 40, 16000, 1, 1800, "hz", None),
    ("f_reso", "Resonance", 0, 1, 0, 0.25, "percent", None),
    ("f_drive", "Drive", 0, 1, 0, 0.2, "percent", None),
    ("f_env", "Filter Env", -60, 60, 0, 24, "raw", "st"),
    ("f_key", "Filter Key", 0, 3, 0, 0.8, "raw", "x"),
    # ROUTE
    ("r_west", "West>Filter", 0, 1, 0, 0.15, "percent", None),
    # ENV 1 (filter)
    ("e1_a", "Env1 Attack", 0.001, 5, 1, 0.005, "raw", "s"),
    ("e1_d", "Env1 Decay", 0.02, 8, 1, 0.4, "raw", "s"),
    ("e1_s", "Env1 Sustain", 0, 1, 0, 0.3, "percent", None),
    ("e1_r", "Env1 Release", 0.02, 8, 1, 0.3, "raw", "s"),
    # ENV 2 (amp of the East voice)
    ("e2_a", "Env2 Attack", 0.001, 5, 1, 0.004, "raw", "s"),
    ("e2_d", "Env2 Decay", 0.02, 8, 1, 1.0, "raw", "s"),
    ("e2_s", "Env2 Sustain", 0, 1, 0, 0.8, "percent", None),
    ("e2_r", "Env2 Release", 0.02, 8, 1, 0.3, "raw", "s"),
    ("f1_shape", "Func1 Shape", -1, 1, 0, 0, "raw", None),
    ("f1_cycle", "Func1 Cycle", 0, 1, 0, 1, "raw", "mode"),
    # FUNC 2 (its end pulse clocks the S&H)
    ("f2_rise", "Func2 Rise", 0.001, 20, 1, 1 / 6, "raw", "s"),
    ("f2_fall", "Func2 Fall", 0.001, 20, 1, 1 / 6, "raw", "s"),
    ("f2_shape", "Func2 Shape", -1, 1, 0, 0, "raw", None),
    ("f2_cycle", "Func2 Cycle", 0, 1, 0, 1, "raw", "mode"),
    ("sh_slew", "S&H Slew", 0, 500, 0, 0, "raw", "ms"),
    # CHAOS
    ("ch_rate", "Chaos Rate", 0.01, 50, 1, 0.6, "hz", None),
    ("v_sens", "Vel Sens", 0, 1, 0, 0.6, "percent", None),
    ("g_reso", "Gate Reso", 0, 1, 0, 0, "percent", None),
    # FEEDBACK
    ("fb_amt", "Feedback", 0, 1, 0, 0.05, "percent", None),
    # FX
    ("fx_dtime", "Echo Time", 20, 900, 1, 340, "ms", None),
    ("fx_dfb", "Echo Feedback", 0, 0.9, 0, 0.35, "percent", None),
    ("fx_dmix", "Echo Mix", 0, 0.8, 0, 0.12, "percent", None),
    ("fx_hmix", "Reverb Mix", 0, 0.8, 0, 0.12, "percent", None),
    # MASTER
    ("glide", "Glide", 0, 1, 0, 0, "percent", None),
    ("drift", "Drift", 0, 1, 0, 0.3, "percent", None),
    ("vol", "Volume", -30, 6, 0, 0, "db", None),
]
K = [(i + 1, *k) for i, k in enumerate(K_ROHE)]       # (nr, id, name, min, max, log, default, format, unit)
KK = {k[1]: k for k in K}                              # by id
assert len(K) == 60 and len(KK) == 60

# ---- fixed design values ---------------------------------------------------------------------------------------------------
TRIM = 0.40              # level of the East oscillator sum in front of the filter
NOISE_TRIM = 0.5         # the noise is much louder than an oscillator of the same knob position
WEST_TRIM = 0.45          # level of the West branch (after the fold, before the gate)
DRIVE_DB = 18.0          # drive knob at 1
DRIVE_PRE = 2.0          # fixed gain in front of the drive stage, taken out again behind it
DRIVE_COMP = 0.35        # share of the level the drive knob takes back at 1
KEY_HZ = 1.0             # key follow adds knob x note Hz to the cutoff
DRIFT_CENTS = 15.0       # Drift knob at 1: one drift node (-1..1) times this many cents
LOW_HZ = (0.1, 30.0)     # VCO 3 in Low range: the Pitch knob sweeps this range, exponentially
LPG_MIN_HZ = 20.0        # the gate's low-pass at a closed control
LPG_MAX_HZ = 16000.0     # ... and at an open one
FB_PRE_DB = 6.0          # drive of the feedback `saett`
FB_GAIN = 0.4             # feedback at 1: the saturated voice output times this goes back into the filter input
RESO_SCALE = {"ladder": 0.98, "sem": 1.0, "ms20": 0.85, "diode": 0.95}   # the Resonance knob at 1 stops just short of self-oscillation
DIODE_BASS = 0.4         # share of the bass the diode ladder loses at high resonance that is given back
GLIDE_ZEITEN = (0.015, 0.04, 0.1, 0.25)
LPG_ABKLING_PER_S = 1 / 0.3   # Gate Decay (s) times this is the vactrol decay scale `abkling` (the port clamps it to 0.1..10)
COL_AUDIO_GAIN = 0.5     # the audio columns Filter In, Gate In and Out: tanh, then this gain (pin 1 of a full-scale source is about a VCO at Level 0.9)
KEY_C3_HZ = 130.8128     # the Key row is the note pitch in octaves above this
KEY_FLOOR_HZ = 0.001     # added to the note frequency in the key tracker: an idle voice (0 Hz) rests at -17 octaves instead of running away

# ---- patch field: row and column labels (fixed, a contract with the panel and the hand tool) and the range of each column at pin 1
ZEILEN = ["VCO 1", "VCO 2", "VCO 3", "Noise", "Ring", "West", "Filter", "Gate", "Env 1", "Env 2", "Func 1", "Func 2", "S&H", "Chaos", "Key", "Velocity"]
SPALTEN = ["VCO 1 Pitch", "VCO 2 Pitch", "VCO 3 Pitch", "West Pitch", "PW", "Fold", "Symmetry", "Filter In", "Cutoff", "Resonance", "Gate In",
           "Gate CV", "Func 1 Tempo", "Func 2 Tempo", "Amp", "Out"]
# (column, value at pin 1, unit, what the sum of the column does). The column value is a_j = sum of pin x source; the destination gets a_j x range.
COLS = [
    ("VCO 1 Pitch", 12.0, "st", "semitones added to VCO 1 pitch (exponential FM from an audio source)"),
    ("VCO 2 Pitch", 12.0, "st", "semitones added to VCO 2 pitch"),
    ("VCO 3 Pitch", 12.0, "st", "semitones added to VCO 3 pitch (both ranges)"),
    ("West Pitch", 8.0, "idx", "linear FM of the West sine: deviation = column x 8 x VCO 3 frequency, so a VCO 3 pin is the FM index (up to 8)"),
    ("PW", 1.0, "unit", "added to the pulse width of VCO 1 (unit of the VCO1 PW knob) and to that of VCO 2"),
    ("Fold", 20.0, "dB", "dB added to the West fold drive"),
    ("Symmetry", 1.0, "unit", "added to the West fold symmetry (unit of the knob)"),
    ("Filter In", COL_AUDIO_GAIN, "gain", "audio into the filter input, through a tanh and a gain of 0.5"),
    ("Cutoff", 40.0, "st", "semitones added to the filter cutoff (with Filter Env, Key and the knob)"),
    ("Resonance", 1.0, "unit", "added to the Resonance knob (clamped 0..1 by the filter)"),
    ("Gate In", COL_AUDIO_GAIN, "gain", "audio into the low-pass gate, added to the West voice, through a tanh and a gain of 0.5"),
    ("Gate CV", 1.0, "unit", "added to the gate control (1 opens the gate fully; the port clamps 0..1.5)"),
    ("Func 1 Tempo", 4.0, "oct", "octaves: both rates of FUNC 1 are multiplied by 2^(column x 4)"),
    ("Func 2 Tempo", 4.0, "oct", "octaves: both rates of FUNC 2"),
    ("Amp", 1.0, "unit", "added to the gain of the voice (1 + column): +1 doubles it, -1 mutes it"),
    ("Out", COL_AUDIO_GAIN, "gain", "audio joined at the voice output through a tanh and a gain of 0.5, shaped by ENV 2 x velocity"),
]
assert [c[0] for c in COLS] == SPALTEN and len(ZEILEN) == 16
R = {c[0]: c[1] for c in COLS}
ZEILEN_QUELLE = [
    "VCO 1 after its wave selector, before its level (-1..1)", "VCO 2, same", "VCO 3, the sine modulator, before its level",
    "white noise (about -1..1) at the noise trim", "VCO 1 x VCO 2", "the folded West sine, before its level (-1..1)",
    "the output of the selected filter, before the amp", "the low-pass gate output, before velocity",
    "ENV 1 (0..1)", "ENV 2 (0..1)", "FUNC 1 (0..1)", "FUNC 2 (0..1)", "S&H, stepped random (-1..1), clocked by FUNC 2 `ende`",
    "Chaos (Lorenz), about -1..1", "note pitch in octaves above C3 (C2 = -1, C4 = +1)", "note velocity (0..1)",
]
assert len(ZEILEN_QUELLE) == 16
# Default pins of set A (row, column, value): the modulation of the version 1 default patch, which sat on fixed `>` knobs.
# FUNC 1 and FUNC 2 are 0..1, the version 1 LFO was -1..1: a swing of the same size is the pin of the old amplitude A times 2 (the mean
# moves up by A). Pitch 5 ct (0.05 st) -> 0.1 st swing; cutoff 2 st -> 4 st; PW 0.1 -> 0.2. S&H and Chaos are -1..1 as before.
# The West vibrato of version 1 (5 ct) has no pin: the West Pitch column is linear FM.
STIFTE_A = [
    ("VCO 3", "VCO 1 Pitch", 0.0433),   # FM 3>1  0.03  (x 17.3 st per unit ratio / 12)
    ("VCO 3", "VCO 2 Pitch", 0.0289),   # FM 3>2  0.02
    ("VCO 3", "West Pitch", 0.05),      # FM 3>West 0.4 / 8
    ("Func 1", "VCO 1 Pitch", 0.0083),  # LFO1 > Pitch 5 ct
    ("Func 1", "VCO 2 Pitch", 0.0083),
    ("Func 1", "VCO 3 Pitch", 0.0083),
    ("Func 1", "PW", 0.2),              # LFO1 > PW 0.1
    ("Func 1", "Cutoff", 0.1),          # LFO1 > Cutoff 2 st
    ("S&H", "Fold", 0.1),               # LFO2 > Fold 2 dB
    ("S&H", "Cutoff", 0.05),            # LFO2 > Cutoff 2 st
    ("Chaos", "Fold", 0.1),             # Chaos > Fold 2 dB
    ("Chaos", "Cutoff", 0.05),          # Chaos > Cutoff 2 st
]
STIFTE_A_ROH = sorted([[0, ZEILEN.index(z), SPALTEN.index(sp), w] for z, sp, w in STIFTE_A], key=lambda x: (x[0], x[1], x[2]))
DELAY_DAEMPF = 4000
ST_PER_DB = 12 / (20 * math.log10(2))   # transponiere: gain = 2^(st/12), so dB x 1.9932 semitones


# ---- graph -----------------------------------------------------------------------------------------------------------------
def vorgabe(k):
    _, _, _, lo, hi, log, d, *_ = k
    return (math.log(d / lo) / math.log(hi / lo)) if log else (d - lo) / (hi - lo)


def graph():
    knoten, kanten = [], []

    def n(id, art, **w):
        knoten.append({"id": id, "art": art, **w})
        return id

    def e(a, b, verz=False):
        kanten.append({"von": a, "nach": b, **({"verzoegerung": 1} if verz else {})})

    def mul(id, a, b=None, **w):
        """Product: a and b are ports (strings) or numbers (fixed values)."""
        extra = {pin: q for pin, q in (("a", a), ("b", b)) if isinstance(q, (int, float))}
        n(id, "mul", **extra, **w)
        for pin, q in (("a", a), ("b", b)):
            if isinstance(q, str):
                e(q, f"{id}.{pin}")
        return f"{id}.aus"

    def add(id, *q, **w):
        extra = {pin: v for pin, v in zip("abcd", q) if isinstance(v, (int, float))}
        n(id, "add", **extra, **w)
        for pin, v in zip("abcd", q):
            if isinstance(v, str):
                e(v, f"{id}.{pin}")
        return f"{id}.aus"

    def wahl(id, anzahl, ein, knopf, **w):
        """Selector over the ports `ein` (strings) or fixed values (numbers), a knob selects."""
        extra = {f"e{i}": v for i, v in enumerate(ein, start=1) if isinstance(v, (int, float))}
        n(id, "wahl", n=anzahl, modus=0, norm=1, **extra, **w)
        for i, v in enumerate(ein, start=1):
            if isinstance(v, str):
                e(v, f"{id}.e{i}")
        e(knopf, f"{id}.wahl")
        return f"{id}.aus"

    def trans(id, hz, st=None, cent=None):
        n(id, "transponiere")
        if isinstance(hz, (int, float)):
            knoten[-1]["hz"] = hz
        else:
            e(hz, f"{id}.hz")
        if st is not None:
            e(st, f"{id}.st")
        if cent is not None:
            e(cent, f"{id}.cent")
        return f"{id}.aus"

    n("note", "note")
    for nr, kid, name, lo, hi, log, d, _, _ in K:
        # a selector knob is a 0..1 position for `wahl` (norm 1), whatever its number of options
        w = dict(id=kid, art="regler", nr=nr, min=0, max=1) if kid in OPTIONEN else dict(id=kid, art="regler", nr=nr, min=lo, max=hi)
        if log:
            w["log"] = 1
        v = round(vorgabe(KK[kid]), 6)
        if v != 0.5:
            w["vorgabe"] = v
        knoten.append(w)
    k = lambda kid: f"{kid}.aus"

    # --- pitch with glide: morph over raw pitch and four smoothers
    n("gl_sel", "wahl", n=5, modus=1, norm=1)
    e("note.hz", "gl_sel.e1")
    for i, z in enumerate(GLIDE_ZEITEN, start=1):
        n(f"gl{i}", "glatt", zeit=z)
        e("note.hz", f"gl{i}.x")
        e("note.erste", f"gl{i}.setzen")
        e(f"gl{i}.aus", f"gl_sel.e{i + 1}")
    e(k("glide"), "gl_sel.wahl")
    TON = "gl_sel.aus"

    # --- patch field: column j of the field is `feld.a{j+1}`; the range of a column at pin 1 is R[...] (see COLS)
    n("feld", "matrix", zeilen=ZEILEN, spalten=SPALTEN, stifte=STIFTE_A_ROH)
    e(k("morph"), "feld.morph")
    col = lambda name: f"feld.a{SPALTEN.index(name) + 1}"
    scaled = lambda id, name: mul(id, col(name), R[name])

    # --- modulators: two function generators (triggered by the note, Cycle makes them free-run), S&H clocked by FUNC 2, chaos
    for i in (1, 2):
        n(f"f{i}", "funktion")
        e("note.trig", f"f{i}.trig")
        e(k(f"f{i}_rise"), f"f{i}.steigen"); e(k(f"f{i}_fall"), f"f{i}.fallen"); e(k(f"f{i}_shape"), f"f{i}.form"); e(k(f"f{i}_cycle"), f"f{i}.zyklus")
        e(scaled(f"f{i}_tempo", f"Func {i} Tempo"), f"f{i}.tempo")
    n("snh", "sh"); e("f2.ende", "snh.trig"); e(k("sh_slew"), "snh.glatt")
    n("chaos", "chaos", form=0, saat=3); e(k("ch_rate"), "chaos.rate")
    n("env1", "adsr", a=0.005, d=0.4, s=0.3, r=0.3)
    n("env2", "adsr", a=0.004, d=1.0, s=0.8, r=0.3)
    for nm, pre in (("env1", "e1"), ("env2", "e2")):
        e("note.gate", f"{nm}.gate"); e("note.trig", f"{nm}.trig")
        for pin in "adsr":
            e(k(f"{pre}_{pin}"), f"{nm}.{pin}")
    # velocity: (1 - Vel Sens) + Vel Sens x velocity (0.4 + 0.6 x velocity at the default)
    vel = add("vel_g", 1.0, mul("vel_neg", k("v_sens"), -1.0), mul("vel_k", "note.vel", k("v_sens")))
    amp = mul("amp", "env2.aus", vel)

    # --- Key row: the note pitch in octaves above C3, found by a servo loop (p += tanh(hz / (C3 x 2^p) - 1) / ln 2, quadratic near
    # the fixed point, a step of at most 1.44 octaves); two delayed edges close the loop. The floor of 1 mHz keeps an idle voice bounded.
    n("key_st", "mul", b=-12.0)
    e("key_p.aus", "key_st.a", verz=True)
    key_hz = add("key_hz", "note.hz", KEY_FLOOR_HZ)
    key_m = trans("key_m", key_hz, "key_st.aus")
    key_err = add("key_err", mul("key_r", key_m, 1.0 / KEY_C3_HZ), -1.0)
    n("key_s", "saett"); e(key_err, "key_s.x")
    n("key_p", "add"); e(mul("key_step", "key_s.aus", 1.0 / math.log(2)), "key_p.a"); e("key_p.aus", "key_p.b", verz=True)

    # --- drift: one node per oscillator (own seed), -1..1, times the Drift knob in cents
    drift_ct = mul("drift_ct", k("drift"), DRIFT_CENTS)
    drift = {}
    for i, o in enumerate(("v1", "v2", "v3", "w"), start=1):
        n(f"dr_{o}", "drift", rate=0.3, fest=0.5, saat=40 + i)
        drift[o] = mul(f"dr_{o}_ct", f"dr_{o}.aus", drift_ct)

    # --- VCO 3, the modulator: a sine that follows the key (Key) or runs free at 0.1..30 Hz (Low); the column VCO 3 Pitch adds semitones
    pc3 = scaled("pc_v3", "VCO 3 Pitch")
    key3 = trans("v3_key", TON, add("v3_st", k("v3_pitch"), pc3), drift["v3"])
    low3 = trans("v3_low", LOW_HZ[0], add("v3_low_st", mul("v3_low_m", add("v3_low_p", k("v3_pitch"), 36.0), 12 * math.log2(LOW_HZ[1] / LOW_HZ[0]) / 72), pc3))
    hz3 = wahl("v3_hz", 2, [key3, low3], k("v3_range"))
    n("v3", "sinus"); e(hz3, "v3.hz")
    MOD = "v3.aus"

    # --- VCO 1 and 2: three waves behind a selector; the column VCO n Pitch is an exponential FM input (semitones)
    def vco(o, spalte):
        cent = add(f"{o}_cent", k(f"{o}_fine"), drift[o])
        hz = trans(f"{o}_hz", TON, add(f"{o}_st", k(f"{o}_pitch"), scaled(f"pc_{o}", spalte)), cent)
        n(f"{o}_saw", "saege"); e(hz, f"{o}_saw.hz")
        n(f"{o}_pls", "puls"); e(hz, f"{o}_pls.hz")
        e(add(f"{o}_pwm", k(f"{o}_pw"), mul(f"pc_pw_{o}", col("PW"), R["PW"])) if o == "v1" else mul(f"pc_pw_{o}", col("PW"), R["PW"]), f"{o}_pls.pwm")
        n(f"{o}_tri", "dreieck"); e(hz, f"{o}_tri.hz")
        return wahl(f"{o}_sel", 3, [f"{o}_saw.aus", f"{o}_pls.aus", f"{o}_tri.aus"], k(f"{o}_wave"))
    osc1 = vco("v1", "VCO 1 Pitch")
    osc2 = vco("v2", "VCO 2 Pitch")

    # --- noise through a fixed tilt-free path, ring modulator
    n("rauschen", "rauschen")
    noise_t = mul("noise_t", "rauschen.aus", NOISE_TRIM)
    ring = mul("ring", osc1, osc2)
    east_a = add("east_a", mul("lv1", osc1, k("v1_lv")), mul("lv2", osc2, k("v2_lv")), mul("lv_ring", ring, k("ring_lv")),
                 mul("lv_noise", noise_t, k("noise_lv")))
    east_src = mul("east_src", add("east_b", east_a, mul("lv3", MOD, k("v3_lv"))), TRIM)

    # --- WEST: sine (linear FM from the column West Pitch: deviation = column x 8 x VCO 3 frequency) -> wavefolder
    w_cent = add("w_cent", k("w_fine"), drift["w"])
    w_hz = trans("w_hz", TON, k("w_pitch"), w_cent)
    n("w_sin", "sinus"); e(w_hz, "w_sin.hz")
    e(mul("w_fm", mul("w_fmh", col("West Pitch"), hz3), R["West Pitch"]), "w_sin.fm")
    n("w_fal", "falter", ueber=0)
    e("w_sin.aus", "w_fal.x")
    e(add("w_antrieb", k("w_fold"), scaled("pc_fold", "Fold")), "w_fal.antrieb")
    e(add("w_symm", k("w_sym"), mul("pc_sym", col("Symmetry"), R["Symmetry"])), "w_fal.symmetrie"); e(k("w_shape"), "w_fal.form")
    west = mul("west", mul("west_lv", "w_fal.aus", k("w_lv")), WEST_TRIM)

    # --- GATE: a real low-pass gate (`lpg`). Control c = Open + (1 - Open) x Strike x fast envelope, times the key gate (released with
    # ENV 2 Release), plus the column Gate CV; the Mode knob is the lpg `modus` (LP, Both, VCA), Gate Decay scales the vactrol decay and the
    # strike envelope, Gate Reso is the feedback of the low-pass mode. The column Gate In joins the West signal in front of it.
    n("g_hold", "adsr", a=0.002, d=0.05, s=1.0, r=0.3)
    e("note.gate", "g_hold.gate"); e("note.trig", "g_hold.trig"); e(k("e2_r"), "g_hold.r")
    n("g_env", "adsr", a=0.001, d=0.35, s=0.0, r=0.05)
    e("note.gate", "g_env.gate"); e("note.trig", "g_env.trig"); e(k("g_decay"), "g_env.d")
    strike = mul("g_strike_e", mul("g_one_open", add("g_om", 1.0, mul("g_neg", k("g_open"), -1)), k("g_strike")), "g_env.aus")
    ctl = mul("g_ctl", "g_hold.aus", add("g_c0", k("g_open"), strike))
    n("gi_sat", "saett"); e(col("Gate In"), "gi_sat.x")
    n("lpg", "lpg")
    e(add("g_x", west, mul("gi_g", "gi_sat.aus", R["Gate In"])), "lpg.x")
    e(add("g_cv", mul("g_ctl3", mul("g_ctl2", ctl, ctl), ctl), col("Gate CV")), "lpg.cv")      # squared: the vactrol of the lpg opens much earlier than the stand-in did
    e(mul("g_modus", k("g_mode"), 2.0), "lpg.modus")
    e(mul("g_abk", k("g_decay"), LPG_ABKLING_PER_S), "lpg.abkling")
    e(k("g_reso"), "lpg.reso")
    west_out = mul("west_out", mul("west_trim", "lpg.aus", 0.4), vel)

    # --- cutoff: knob + key follow (Hz), transposed by ENV 1 (knob) and the column Cutoff (semitones)
    cut_st = add("cut_st", mul("env1_st", "env1.aus", k("f_env")), scaled("pc_cut", "Cutoff"))
    cut_base = add("cut_base", k("f_cut"), mul("key_hz_m", "note.hz", mul("key_k", k("f_key"), KEY_HZ)))
    cutoff = trans("cut", cut_base, cut_st)

    # --- filter input: East oscillators + a share of the folded West signal + feedback (delayed edge) + the column Filter In, drive, then the four filters
    n("fb_in", "add")
    e(east_src, "fb_in.a"); e(mul("route", west, k("r_west")), "fb_in.b")      # fb_in.c: feedback, see below
    n("fi_sat", "saett"); e(col("Filter In"), "fi_sat.x"); e(mul("fi_g", "fi_sat.aus", R["Filter In"]), "fb_in.d")
    drv_db = mul("drv_db", k("f_drive"), DRIVE_DB)
    drv_g = add("drv_g", 1.0 / DRIVE_PRE, mul("drv_c", k("f_drive"), -DRIVE_COMP / DRIVE_PRE))
    n("drv", "saett"); e(mul("drv_in", "fb_in.aus", DRIVE_PRE), "drv.x"); e(drv_db, "drv.antrieb")
    f_in = mul("f_in", "drv.aus", drv_g)
    reso = add("reso_t", k("f_reso"), mul("pc_reso", col("Resonance"), R["Resonance"]))
    n("f_ladder", "ladder"); e(f_in, "f_ladder.x"); e(cutoff, "f_ladder.cutoff"); e(mul("reso_l", reso, RESO_SCALE["ladder"]), "f_ladder.reso")
    n("f_sem", "sem", form=0); e(f_in, "f_sem.x"); e(cutoff, "f_sem.cutoff"); e(mul("reso_s", reso, RESO_SCALE["sem"]), "f_sem.reso")
    n("f_ms20", "ms20", modus=1); e(f_in, "f_ms20.x"); e(cutoff, "f_ms20.cutoff"); e(mul("reso_m", reso, RESO_SCALE["ms20"]), "f_ms20.reso")
    n("f_diode", "diode", bass=DIODE_BASS); e(f_in, "f_diode.x"); e(cutoff, "f_diode.cutoff"); e(mul("reso_d", reso, RESO_SCALE["diode"]), "f_diode.reso")
    filt = wahl("f_sel", 4, ["f_ladder.aus", "f_sem.aus", "f_ms20.tp", "f_diode.aus"], k("f_type"))
    east_out = mul("east_out", filt, amp)

    # --- the voice: East + West + the column Out (through ENV 2 x velocity), times 1 + the column Amp; feedback; DC block
    n("out_sat", "saett"); e(col("Out"), "out_sat.x")
    out_col = mul("out_col", mul("out_g", "out_sat.aus", R["Out"]), amp)
    voice = mul("voice", add("voice_sum", east_out, west_out, out_col), add("amp_g", 1.0, mul("pc_amp", col("Amp"), R["Amp"])))
    n("fb_sat", "saett", antrieb=FB_PRE_DB); e(voice, "fb_sat.x")
    e(mul("fb_g", "fb_sat.aus", mul("fb_amt_g", k("fb_amt"), FB_GAIN)), "fb_in.c", verz=True)
    n("dc", "svf", cutoff=10, reso=0); e(voice, "dc.x")

    # --- the rows of the patch field (every edge into a row is delayed one sample)
    for i, quelle in enumerate([osc1, osc2, MOD, noise_t, ring, "w_fal.aus", filt, "lpg.aus", "env1.aus", "env2.aus", "f1.aus", "f2.aus",
                                "snh.aus", "chaos.aus", "key_p.aus", "note.vel"], start=1):
        e(quelle, f"feld.e{i}", verz=True)

    # --- FX on the voice sum: delay (mix, time and feedback straight from their regler nodes), then the reverb (mix likewise)
    n("delay", "delay", daempf=DELAY_DAEMPF, pingpong=1, max=1000)
    e("dc.hp", "delay.x"); e(k("fx_dtime"), "delay.zeit"); e(k("fx_dfb"), "delay.fb"); e(k("fx_dmix"), "delay.mix")
    n("hall", "hall", decay=2.0)
    e("delay.l", "hall.l"); e("delay.r", "hall.r"); e(k("fx_hmix"), "hall.mix")

    # --- master: Volume in dB through transponiere
    n("vol_st", "mul", b=ST_PER_DB); e(k("vol"), "vol_st.a")
    n("vol_g", "transponiere", hz=1.0); e("vol_st.aus", "vol_g.st")
    n("aus", "ausgang")
    for c in "lr":
        mul(f"master_{c}", f"hall.{c}", "vol_g.aus")
        e(f"master_{c}.aus", f"aus.{c}")
    return {"format": "baukasten/2", "name": NAME, "stimmen": STIMMEN,
            "regler_namen": {str(x[0]): x[2] for x in K}, "knoten": knoten, "kanten": kanten}


# ---- panel -----------------------------------------------------------------------------------------------------------------
def knob(cid, kk, **w):
    nr, kid, name, lo, hi, log, d, fmt, unit = kk
    c = {"id": cid, "type": "knob", "label": name, "bind": {"param": f"k{nr}"}, "format": fmt, "default": round(vorgabe(kk), 6)}
    if unit:
        c["unit"] = unit
    c.update(w)
    return c


def selector(cid, kk, **w):
    nr, kid, name, lo, hi, log, d, fmt, unit = kk
    c = {"id": cid, "type": "selector", "label": name, "bind": {"param": f"k{nr}"}, "options": OPTIONEN[kid], "default": int(d)}
    c.update(w)
    return c


# Cabinet view (page `rack`): where each row of the patch field has its output jack (a section id) and each column its input jack (a control id, or a section
# when the column has no knob of its own). S&H sits on FUNC 2 (its clock), Key and Velocity on MASTER (Glide, Vel Sens); the audio columns and Amp/Out go to their section.
FELD_QUELLEN = ["vco1", "vco2", "vco3", "ringnoise", "ringnoise", "west", "filter", "gate", "env1", "env2", "func1", "func2", "func2", "chaos", "master", "master"]
FELD_HILFE = "Sources are rows, destinations are columns. A pin (or a cable in the Cabinet view) sends a source to a destination."


def FELD_ZIELE(cid):
    return [cid("v1_pitch"), cid("v2_pitch"), cid("v3_pitch"), cid("w_pitch"), cid("v1_pw"), cid("w_fold"), cid("w_sym"), "filter", cid("f_cut"), cid("f_reso"),
            "gate", "gate", cid("f1_rise"), cid("f2_rise"), "master", "master"]


def panel():
    def c(kid, **w):
        kk = KK[kid]
        return selector(f"c{kk[0]}", kk, **w) if kid in OPTIONEN else knob(f"c{kk[0]}", kk, **w)
    cid = lambda kid: f"c{KK[kid][0]}"
    text = lambda tid, t, span: {"id": tid, "type": "label", "span": span, "text": t}
    hue = lambda sid, label, pre, span: {"id": sid, "type": "huelle", "span": span, "label": label,
                                         "of": {x: cid(f"{pre}_{x}") for x in "adsr"}}

    sektionen = [
        {"id": "vco1", "title": "VCO 1", "cols": 4, "page": "east", "controls": [
            c("v1_wave", span=4), c("v1_pitch"), c("v1_fine"), c("v1_pw"), c("v1_lv")]},
        {"id": "vco2", "title": "VCO 2", "cols": 3, "page": "east", "controls": [
            c("v2_wave", span=3), c("v2_pitch"), c("v2_fine"), c("v2_lv")]},
        {"id": "ringnoise", "title": "RING / NOISE", "cols": 2, "page": "east", "controls": [
            c("ring_lv"), c("noise_lv"), text("t_rn", "Ring is VCO 1 times VCO 2.", 2)]},
        {"id": "vco3", "title": "VCO 3", "cols": 3, "page": "east", "controls": [
            c("v3_range", span=3), c("v3_pitch"), c("v3_lv"), text("t_v3", "A sine. Low runs free. FM is patched.", 3)]},
        {"id": "filter", "title": "FILTER", "cols": 5, "page": "east", "controls": [
            {"id": "fk", "type": "filterkurve", "span": 5, "of": {"cutoff": cid("f_cut"), "reso": cid("f_reso"), "typ": cid("f_type")},
             "typen": [{"art": "lp", "pole": 4}, {"art": "lp", "pole": 2}, {"art": "lp", "pole": 2}, {"art": "lp", "pole": 4}]},
            c("f_type", span=5), c("f_cut"), c("f_reso"), c("f_drive"), c("f_env"), c("f_key")]},
        {"id": "env1", "title": "ENV 1", "cols": 4, "page": "east", "controls": [
            hue("e1hue", "Filter envelope", "e1", 4), c("e1_a"), c("e1_d"), c("e1_s"), c("e1_r")]},
        {"id": "env2", "title": "ENV 2", "cols": 4, "page": "east", "controls": [
            hue("e2hue", "Amp envelope", "e2", 4), c("e2_a"), c("e2_d"), c("e2_s"), c("e2_r")]},
        {"id": "west", "title": "WEST", "cols": 3, "page": "west", "controls": [
            c("w_pitch"), c("w_fine"), c("w_fold"), c("w_sym"), c("w_shape"), c("w_lv"),
            text("t_w", "A sine into a wavefolder.", 3)]},
        {"id": "gate", "title": "GATE", "cols": 4, "page": "west", "controls": [
            c("g_mode", span=4), c("g_open"), c("g_strike"), c("g_decay"), c("g_reso"),
            text("t_g", "Vactrol low-pass gate on West.", 4)]},
        {"id": "route", "title": "ROUTE", "cols": 1, "page": "west", "controls": [c("r_west")]},
        {"id": "func1", "title": "FUNC 1", "cols": 4, "page": "mod", "controls": [
            c("f1_cycle", span=4), c("f1_rise"), c("f1_fall"), c("f1_shape"),
            text("t_f1", "Envelope per note, or an LFO with Cycle.", 4)]},
        {"id": "func2", "title": "FUNC 2", "cols": 4, "page": "mod", "controls": [
            c("f2_cycle", span=4), c("f2_rise"), c("f2_fall"), c("f2_shape"), c("sh_slew"),
            text("t_f2", "Its end pulse clocks the S&H row.", 4)]},
        {"id": "chaos", "title": "CHAOS", "cols": 1, "page": "mod", "controls": [
            c("ch_rate"), text("t_ch", "Lorenz: never repeats.", 1)]},
        {"id": "feedback", "title": "FEEDBACK", "cols": 1, "page": "mod", "controls": [c("fb_amt")]},
        {"id": "fx", "title": "FX", "cols": 4, "page": "mod", "controls": [
            c("fx_dtime"), c("fx_dfb"), c("fx_dmix"), c("fx_hmix"), text("t_fx", "Echo, then reverb.", 4)]},
        {"id": "master", "title": "MASTER", "cols": 4, "page": "patch", "controls": [c("glide"), c("drift"), c("v_sens"), c("vol")]},
        # the patch field: its own page. The matrix control reads the labels and the default pins from the graph; its pins are not knobs (no bind)
        {"id": "feld", "title": "PATCH FIELD", "cols": 1, "page": "patch", "controls": [
            {"id": "t_feld", "type": "label", "text": FELD_HILFE},
            {"id": "matrix", "type": "matrix", "of": {"morph": cid("morph"), "quellen": FELD_QUELLEN, "ziele": FELD_ZIELE(cid),
                                                      "bereiche": [{"wert": r, "einheit": u} for _, r, u, _ in COLS]}}]},
        {"id": "morph", "title": "MORPH", "cols": 1, "page": "patch", "controls": [c("morph"), text("t_pa", "Blends set A into set B.", 1)]},
    ]
    return {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": NAME}, "title": TITEL, "akzent": "tuerkis",
            "pages": [{"id": "rack", "title": "Cabinet", "all": True}, {"id": "east", "title": "East"}, {"id": "west", "title": "West"},
                      {"id": "mod", "title": "Mod"}, {"id": "patch", "title": "Patch"}],
            # the cabinet reads like the signal flow: sources, West voice and filter, modulators, feedback and FX, the patch field with Morph and Master.
            # The order inside a page is the reading order of the controller programs (werk/build_pages.py): MASTER follows MORPH on the patch page.
            "layout": {"rows": [["vco1", "vco2", "ringnoise", "vco3"], ["west", "gate", "route", "filter"],
                                ["env1", "env2", "func1", "func2", "chaos"], ["feedback", "fx"], ["feld", "morph", "master"]]},
            "sections": sektionen}


def zeile(o):
    return json.dumps(o, ensure_ascii=False, separators=(", ", ": "))


def schreibe_graph(pfad, g):
    with open(pfad, "w") as f:
        f.write('{\n  "format": "baukasten/2",\n  "name": "%s",\n  "stimmen": %d,\n' % (NAME, g["stimmen"]))
        f.write('  "regler_namen": ' + zeile(g["regler_namen"]).replace('", "', '",\n    "').replace("{", "{\n    ", 1).replace("}", "\n  }") + ",\n")
        f.write('  "knoten": [\n' + ",\n".join("    " + zeile(x) for x in g["knoten"]) + "\n  ],\n")
        f.write('  "kanten": [\n' + ",\n".join("    " + zeile(x) for x in g["kanten"]) + "\n  ]\n}\n")


def tabelle():
    z = ["| Knob | Id | Name | Range | Default |", "|---|---|---|---|---|"]
    for nr, kid, name, lo, hi, log, d, fmt, unit in K:
        if kid in OPTIONEN:
            bereich = " / ".join(OPTIONEN[kid])
            vor = OPTIONEN[kid][int(d)]
        else:
            bereich = f"{lo:g} .. {hi:g}{' log' if log else ''}{(' ' + unit) if unit and fmt == 'raw' else ''}"
            vor = f"{d:g}"
        z.append(f"| k{nr} | `{kid}` | {name} | {bereich} | {vor} |")
    return "\n".join(z)


def tabelle_feld():
    z = ["| Row | Source |", "|---|---|"]
    for i, (name, quelle) in enumerate(zip(ZEILEN, ZEILEN_QUELLE)):
        z.append(f"| {i + 1} · {name} | {quelle} |")
    z += ["", "| Column | At pin 1 | What it does |", "|---|---|---|"]
    for i, (name, r, unit, was) in enumerate(COLS):
        z.append(f"| {i + 1} · {name} | {r:g} {unit} | {was} |")
    z += ["", "| Default pin (set A) | Value |", "|---|---|"]
    for zl, sp, w in STIFTE_A:
        z.append(f"| {zl} -> {sp} | {w:g} |")
    return "\n".join(z)


if __name__ == "__main__":
    if "--tabelle" in sys.argv:
        print(tabelle())
        print()
        print(tabelle_feld())
        sys.exit(0)
    g = graph()
    schreibe_graph(HIER / "demos" / f"{NAME}.json", g)
    (HIER / "paneele" / f"{NAME}.json").write_text(json.dumps(panel(), indent=1, ensure_ascii=False) + "\n")
    print(g["name"], len(g["regler_namen"]), "knobs,", len(g["knoten"]), "nodes,", len(g["kanten"]), "edges")
