#!/usr/bin/env python3
"""Writes the eight factory presets of `synth-kraken` (Kraken).

    python3 build_kraken_presets.py     # writes ../../ui/presets/factory/modular/synth-kraken-*.preset.json

Each preset gives its knobs by id (see the knob table K of build_kraken.py) in the units of that table; a selector is given as its option
index. Everything else stays at the default. The file holds all 60 knobs normalised 0..1, so a later change of a default cannot change a
preset, and a knob added later to the table only needs its id here.

Version 2 (patch field): a preset carries its pins (`stifte`, a list of [set, row, column, value], see steckfeld.ts; the list REPLACES the
graph's default pins, a preset without the field plays the defaults). The eight presets of version 1 are carried over by knob id; the
twelve fixed modulation knobs of version 1 that became pins (`ENTFALLEN`) are converted into the pins of set A through the range of the
column at pin value 1 (`v1_stifte`; the same conversion that gave the default pins of the graph from the version 1 defaults). The two LFO
rates are carried over as FUNC 1 / FUNC 2 times (rise = fall = 0.5 / rate, the same frequency as a cycling triangle).
Then the patch field presets (`P2`): knobs by id plus pins by row and column label (`ST`), all sounds that need the field.
`python3 build_kraken_presets.py --verlust` prints what a v1 preset had on the removed knobs and the pins it gets now.
"""
import json
import math
import pathlib

import sys

from build_kraken import K, KK, OPTIONEN, ZEILEN, SPALTEN, COLS, R

# knobs of version 1 that are pins now (a v1 preset that did not name one played the version 1 default of V1_VORGABE)
ENTFALLEN = ("fm31", "fm32", "fm3w", "l1_pitch", "l1_cut", "l1_pw", "l2_fold", "l2_cut", "ch_cut", "ch_fold")
V1_VORGABE = {"fm31": 0.03, "fm32": 0.02, "fm3w": 0.4, "l1_pitch": 5, "l1_cut": 2, "l1_pw": 0.1, "l2_fold": 2, "l2_cut": 2, "ch_cut": 2, "ch_fold": 2}
# LFO rate (Hz) -> the times of the function generator that replaced the LFO
RATE_ZU_FUNC = {"l1_rate": ("f1_rise", "f1_fall"), "l2_rate": ("f2_rise", "f2_fall")}

ZIEL = pathlib.Path(__file__).resolve().parents[2] / "ui" / "presets" / "factory" / "modular"
GRAPH = "synth-kraken"
NOTIZ = "Measured by render, not heard yet (2026-11-19)."
SAW, PULSE, TRI = 0, 1, 2
LP, BOTH, VCA = 0, 1, 2
LADDER, SEM, MS20, DIODE = 0, 1, 2, 3
KEY, LOW = 0, 1

# East voice silent / West voice silent (the other voice of a preset starts from the defaults, so a pure sound switches the rest off)
NUR_WEST = {"v1_lv": 0, "v2_lv": 0, "ring_lv": 0, "noise_lv": 0, "v3_lv": 0, "r_west": 0, "fb_amt": 0}
NUR_OST = {"w_lv": 0}


def norm(kid, wert):
    _, _, _, lo, hi, log, *_ = KK[kid]
    assert lo <= wert <= hi, (kid, wert)
    if kid in OPTIONEN:
        return wert / (len(OPTIONEN[kid]) - 1)
    return (math.log(wert / lo) / math.log(hi / lo)) if log else (wert - lo) / (hi - lo)


def vorgabe(kid):
    return norm(kid, KK[kid][6])


# name, overrides by knob id, (art, unterart, charakter, genre, einsatz, energie), text
P = [
    # ---- bass
    ("Ladder Bass",
     {**NUR_OST, "v1_wave": SAW, "v1_lv": 0.9, "v2_wave": SAW, "v2_pitch": -12, "v2_fine": 6, "v2_lv": 0.8, "ring_lv": 0, "noise_lv": 0, "fm31": 0, "fm32": 0,
      "f_type": LADDER, "f_cut": 220, "f_reso": 0.35, "f_drive": 0.3, "f_env": 36, "f_key": 0.5, "e1_d": 0.25, "e1_s": 0.1,
      "e2_d": 0.6, "e2_s": 0.7, "e2_r": 0.12, "l1_pitch": 0, "l1_cut": 0, "l2_cut": 0, "ch_cut": 0, "fb_amt": 0, "fx_dmix": 0, "fx_hmix": 0.05, "drift": 0.15, "vol": 6},
     ("bass", "analog", ["tight", "punchy", "deep"], ["techno", "house"], ["drop", "mixdown"], 3),
     "Round bass from two saws an octave apart through the ladder filter, with a quick filter snap on every note."),
    ("Diode Acid",
     {**NUR_OST, "v1_wave": SAW, "v1_lv": 1.0, "v2_lv": 0, "ring_lv": 0, "noise_lv": 0, "fm31": 0, "v3_lv": 0,
      "f_type": DIODE, "f_cut": 280, "f_reso": 0.78, "f_drive": 0.45, "f_env": 42, "f_key": 0.3, "e1_d": 0.2, "e1_s": 0.0,
      "e2_d": 0.5, "e2_s": 0.6, "e2_r": 0.1, "glide": 0.35, "l1_pitch": 0, "l1_cut": 0, "l2_cut": 0, "ch_cut": 0, "fb_amt": 0.06, "fx_dmix": 0.15, "fx_dtime": 380, "fx_hmix": 0.05, "vol": 6},
     ("bass", "acid", ["aggressive", "dirty", "tight"], ["acid", "techno"], ["drop", "build"], 4),
     "Squelching diode-ladder acid bass: one saw, high resonance, a fast decaying filter sweep and a short glide between notes."),
    # ---- lead
    ("Hard MS-20 Lead",
     {**NUR_OST, "v1_wave": PULSE, "v1_pw": 0.55, "v1_lv": 0.55, "v2_wave": SAW, "v2_fine": 12, "v2_lv": 0.5, "ring_lv": 0.05, "noise_lv": 0.0, "fm31": 0.1, "fm32": 0.04,
      "v3_pitch": 7, "v3_lv": 0.0, "f_type": MS20, "f_cut": 2400, "f_reso": 0.62, "f_drive": 0.5, "f_env": 18, "f_key": 1.2, "e1_d": 0.5, "e1_s": 0.3,
      "e2_a": 0.005, "e2_d": 1.0, "e2_s": 0.85, "e2_r": 0.25, "l1_rate": 5.5, "l1_pitch": 9, "l1_cut": 0, "l2_cut": 0, "ch_cut": 0, "fb_amt": 0.1,
      "fx_dtime": 330, "fx_dmix": 0.18, "fx_hmix": 0.12, "vol": -5},
     ("lead", "mono", ["bright", "aggressive", "thick"], ["techno", "trance"], ["drop", "build"], 5),
     "A hard, biting lead: pulse and saw bent a little by the sine modulator, pushed into the MS-20 filter at high resonance."),
    # ---- pad
    ("SEM Pad",
     {**NUR_OST, "v1_wave": SAW, "v1_lv": 0.5, "v2_wave": SAW, "v2_fine": 11, "v2_lv": 0.5, "ring_lv": 0, "noise_lv": 0.04, "v3_lv": 0.1, "v3_pitch": 0, "fm31": 0.0, "fm32": 0.0,
      "f_type": SEM, "f_cut": 1400, "f_reso": 0.3, "f_drive": 0.05, "f_env": 14, "f_key": 0.6, "e1_a": 1.2, "e1_d": 3.0, "e1_s": 0.6, "e1_r": 2.0,
      "e2_a": 1.0, "e2_d": 2.0, "e2_s": 0.9, "e2_r": 2.2, "l1_rate": 0.15, "l1_pitch": 4, "l1_cut": 6, "ch_rate": 0.2, "ch_cut": 5, "fb_amt": 0.0, "drift": 0.7,
      "fx_dtime": 520, "fx_dmix": 0.22, "fx_hmix": 0.4, "vol": 0},
     ("pad", "atmosphere", ["soft", "wide", "evolving"], ["ambient", "progressive"], ["intro", "breakdown"], 2),
     "A slow pad from two drifting saws in the SEM filter; envelope, a slow triangle and a chaos source breathe the cutoff."),
    # ---- West
    ("Bongo Pluck",
     {**NUR_WEST, "w_lv": 0.9, "w_pitch": -12, "w_fold": 14, "w_sym": 0.0, "w_shape": 0.3, "g_mode": BOTH, "g_open": 0.0, "g_strike": 1.0, "g_decay": 0.12,
      "v3_pitch": 7, "fm3w": 0.9, "e2_r": 0.2, "l2_fold": 0, "ch_fold": 0, "l1_pitch": 0, "drift": 0.1, "fx_dtime": 300, "fx_dmix": 0.2, "fx_hmix": 0.15, "vol": 3},
     ("pluck", "synth", ["punchy", "tight", "dry"], ["downtempo", "breaks"], ["drop", "transition"], 4),
     "A wooden bongo hit from a folded sine and a short gate decay: every key plucks, however long it is held."),
    ("Fold Drone",
     {"v1_wave": SAW, "v1_lv": 0.25, "v2_lv": 0, "ring_lv": 0, "noise_lv": 0.02, "v3_lv": 0, "w_lv": 0.8, "w_pitch": -12, "w_fold": 18, "w_sym": 0.25, "w_shape": 0.6,
      "g_mode": BOTH, "g_open": 0.85, "g_strike": 0.2, "g_decay": 1.5, "r_west": 0.35, "f_type": SEM, "f_cut": 1500, "f_reso": 0.3, "f_env": 6,
      "e2_a": 1.5, "e2_d": 2.0, "e2_s": 0.9, "e2_r": 2.5, "ch_rate": 0.25, "ch_fold": 14, "ch_cut": 8, "l2_rate": 0.5, "l2_fold": 6, "l1_pitch": 3, "fb_amt": 0.1, "drift": 0.5,
      "fx_dtime": 620, "fx_dmix": 0.2, "fx_hmix": 0.45, "vol": -3.5},
     ("pad", "drone", ["dark", "evolving", "thick"], ["ambient", "idm"], ["intro", "breakdown"], 2),
     "A dark drone from a sine folded over and over, the gate wide open; a chaos source keeps pushing the fold."),
    # ---- FM bell
    ("FM Bell",
     {**NUR_WEST, "w_lv": 0.85, "w_pitch": 0, "w_fold": 2, "w_shape": 0.7, "v3_range": KEY, "v3_pitch": 21.5, "fm3w": 1.8, "g_mode": BOTH, "g_open": 0.1, "g_strike": 1.0, "g_decay": 1.6,
      "e2_r": 1.2, "l2_fold": 0, "ch_fold": 0, "l1_pitch": 0, "drift": 0.1, "fx_dtime": 380, "fx_dmix": 0.22, "fx_hmix": 0.3, "vol": 0},
     ("keys", "bell", ["bright", "metallic", "airy"], ["ambient", "downtempo"], ["intro", "breakdown"], 2),
     "A glassy FM bell: the modulator sits at an inharmonic ratio above the folded sine and the gate lets it ring out."),
    # ---- texture
    ("Self Mover",
     {"v1_wave": TRI, "v1_lv": 0.4, "v2_wave": PULSE, "v2_pitch": 7, "v2_lv": 0.3, "ring_lv": 0.35, "noise_lv": 0.1, "v3_range": LOW, "v3_pitch": 10, "v3_lv": 0.2,
      "fm31": 0.2, "fm32": 0.15, "fm3w": 1.5, "w_lv": 0.35, "w_fold": 16, "g_mode": BOTH, "g_open": 0.5, "g_strike": 0.4, "g_decay": 0.6, "r_west": 0.4,
      "f_type": MS20, "f_cut": 900, "f_reso": 0.72, "f_drive": 0.4, "f_env": 10, "e2_a": 0.6, "e2_s": 0.9, "e2_r": 1.5,
      "l1_rate": 0.3, "l1_cut": 14, "l1_pw": 0.6, "l2_rate": 1.6, "l2_cut": 16, "l2_fold": 10, "ch_rate": 0.7, "ch_cut": 20, "ch_fold": 12, "fb_amt": 0.5, "drift": 0.8,
      "fx_dtime": 450, "fx_dfb": 0.55, "fx_dmix": 0.3, "fx_hmix": 0.35, "vol": -6},
     ("fx", "texture", ["evolving", "metallic", "dark"], ["idm", "ambient"], ["transition", "intro"], 3),
     "A restless texture: feedback from the output, a free-running modulator and three random sources keep it moving by itself."),
]



def stift(satz, zeile, spalte, wert):
    """one pin by row and column label; the value is clamped to -1..1 and rounded"""
    return [satz, ZEILEN.index(zeile), SPALTEN.index(spalte), round(max(-1.0, min(1.0, wert)), 4)]


def v1_stifte(ue):
    """The pins of set A that give a v1 preset its modulation back. Every value is the v1 knob (the preset's or, where it named none, the v1 default)
    turned into a pin through the range of the column at pin 1 (COLS): a Func is 0..1 where the v1 LFO swung -1..1, so a swing of the old amplitude A
    is the pin 2 x A / range; S&H and Chaos are -1..1 like the old sources (pin = A / range)."""
    v = {**V1_VORGABE, **{k: ue[k] for k in ENTFALLEN if k in ue}}
    r = R
    l = [
        ("VCO 3", "VCO 1 Pitch", v["fm31"] / math.log(2) / r["VCO 1 Pitch"] * 12),   # ratio -> semitones (12 / ln 2 per unit), as the default pins were derived
        ("VCO 3", "VCO 2 Pitch", v["fm32"] / math.log(2) / r["VCO 2 Pitch"] * 12),
        ("VCO 3", "West Pitch", v["fm3w"] / r["West Pitch"]),            # the index is the pin x 8
        ("Func 1", "VCO 1 Pitch", 2 * v["l1_pitch"] / 100 / r["VCO 1 Pitch"]),
        ("Func 1", "VCO 2 Pitch", 2 * v["l1_pitch"] / 100 / r["VCO 2 Pitch"]),
        ("Func 1", "VCO 3 Pitch", 2 * v["l1_pitch"] / 100 / r["VCO 3 Pitch"]),
        ("Func 1", "PW", 2 * v["l1_pw"] / r["PW"]),
        ("Func 1", "Cutoff", 2 * v["l1_cut"] / r["Cutoff"]),
        ("S&H", "Fold", v["l2_fold"] / r["Fold"]),
        ("S&H", "Cutoff", v["l2_cut"] / r["Cutoff"]),
        ("Chaos", "Fold", v["ch_fold"] / r["Fold"]),
        ("Chaos", "Cutoff", v["ch_cut"] / r["Cutoff"]),
    ]
    return norm_stifte([stift(0, z, sp, w) for z, sp, w in l])


def norm_stifte(l):
    """sorted by (set, row, column), no zero value, no position twice (the last wins)"""
    je = {(e[0], e[1], e[2]): e for e in l}
    return sorted((e for e in je.values() if e[3] != 0), key=lambda e: (e[0], e[1], e[2]))


def uebertrage(ue):
    """v1 overrides by id -> v2 overrides by id, and the dropped (id, value) pairs"""
    neu, verloren = {}, {}
    for kid, w in ue.items():
        if kid in ENTFALLEN:
            verloren[kid] = w
        elif kid in RATE_ZU_FUNC:
            for ziel in RATE_ZU_FUNC[kid]:
                neu[ziel] = round(0.5 / w, 4)
        else:
            neu[kid] = w
    return neu, verloren


# ---- the patch field presets (version 2): knobs by id (everything else at the default of the knob table) and the pins by row / column label
def ST(*pins):
    return norm_stifte([stift(*p) for p in pins])


P2 = [
    # Krell: random pitch steps from S&H (clocked by Func 2) play a melody by themselves; Func 2 shapes every step into a pluck (Amp column), Func 1 slowly
    # sweeps the filter and, through the Func 2 Tempo column, speeds the whole thing up and down: the modulators modulate each other.
    ("Krell",
     {"w_lv": 0, "v1_wave": PULSE, "v1_pw": 0.45, "v1_lv": 1.0, "v2_wave": SAW, "v2_pitch": 7, "v2_fine": 7, "v2_lv": 0.75, "ring_lv": 0, "noise_lv": 0.0,
      "f_type": LADDER, "f_cut": 1400, "f_reso": 0.45, "f_drive": 0.4, "f_env": 0, "f_key": 0.5, "e2_a": 0.01, "e2_d": 2.0, "e2_s": 1.0, "e2_r": 0.6,
      "f1_rise": 3.1, "f1_fall": 4.7, "f2_rise": 0.28, "f2_fall": 0.03, "sh_slew": 25, "ch_rate": 0.4, "fb_amt": 0.0, "drift": 0.4,
      "fx_dtime": 375, "fx_dfb": 0.5, "fx_dmix": 0.28, "fx_hmix": 0.3, "vol": 6},
     ST((0, "S&H", "VCO 1 Pitch", 0.5), (0, "S&H", "VCO 2 Pitch", 0.5), (0, "S&H", "Cutoff", 0.2), (0, "Func 2", "Amp", -0.9),
        (0, "Func 1", "Cutoff", 0.35), (0, "Func 1", "Func 2 Tempo", 0.2), (0, "Chaos", "PW", 0.3), (0, "Func 1", "Resonance", 0.2)),
     ("lead", "arp", ["evolving", "metallic", "smooth"], ["idm", "ambient"], ["intro", "transition"], 3),
     "A self-playing machine melody: random steps of a sample and hold pluck out a tune while two function generators bend its tempo and filter."),

    # Cross-Mod Growl: the sine modulator, VCO 1 and VCO 2 frequency-modulate each other at audio rate (pitch columns), the ring modulator is patched into the
    # filter input and Func 1 wobbles the modulator and the cutoff together: a growl whose timbre is a conversation between oscillators.
    ("Cross-Mod Growl",
     {**NUR_OST, "v1_wave": SAW, "v1_lv": 0.6, "v2_wave": SAW, "v2_pitch": -12, "v2_fine": 7, "v2_lv": 0.45, "ring_lv": 0, "noise_lv": 0, "v3_pitch": 0, "v3_lv": 0,
      "f_type": MS20, "f_cut": 900, "f_reso": 0.45, "f_drive": 0.5, "f_env": 14, "f_key": 0.5, "e1_d": 0.35, "e1_s": 0.2, "e2_d": 1.0, "e2_s": 0.8, "e2_r": 0.2,
      "f1_rise": 0.35, "f1_fall": 0.35, "fb_amt": 0.0, "fx_dmix": 0.0, "fx_hmix": 0.08, "drift": 0.2, "vol": 0},
     ST((0, "VCO 3", "VCO 1 Pitch", 0.55), (0, "VCO 1", "VCO 2 Pitch", 0.15), (0, "VCO 2", "VCO 1 Pitch", 0.2), (0, "Ring", "Filter In", 0.5),
        (0, "Func 1", "VCO 3 Pitch", 0.25), (0, "Func 1", "Cutoff", 0.4), (0, "Env 1", "VCO 1 Pitch", 0.05)),
     ("bass", "fm", ["dirty", "thick", "evolving"], ["dubstep", "techno"], ["drop", "build"], 4),
     "A growling bass: a sine, a saw and a detuned saw bend each other's pitch at audio rate, while a slow wobble moves the modulator and the filter."),
    # Feedback Drone: the filter and the low-pass gate are patched back into their own inputs and into each other's (rows Filter and Gate, columns Filter In and
    # Gate In); a chaos source and two slow function generators keep the loop from settling.
    ("Feedback Drone",
     {"v1_wave": TRI, "v1_lv": 0.3, "v2_lv": 0, "ring_lv": 0, "noise_lv": 0.0, "v3_lv": 0, "w_pitch": -12, "w_fold": 9, "w_shape": 0.5, "w_lv": 0.6,
      "g_mode": BOTH, "g_open": 0.8, "g_strike": 0.0, "g_decay": 1.0, "g_reso": 0.2, "r_west": 0.3, "f_type": SEM, "f_cut": 900, "f_reso": 0.5, "f_drive": 0.2, "f_env": 0, "f_key": 0.5,
      "e2_a": 1.5, "e2_d": 2.0, "e2_s": 1.0, "e2_r": 2.5, "f1_rise": 5.0, "f1_fall": 7.0, "f2_rise": 2.5, "f2_fall": 3.5, "sh_slew": 500, "ch_rate": 0.3, "fb_amt": 0.0,
      "fx_dtime": 520, "fx_dfb": 0.5, "fx_dmix": 0.25, "fx_hmix": 0.45, "drift": 0.6, "vol": 0},
     ST((0, "Filter", "Filter In", 0.35), (0, "Gate", "Gate In", 0.4), (0, "Gate", "Filter In", 0.3), (0, "Filter", "Gate In", 0.15),
        (0, "Chaos", "Cutoff", 0.25), (0, "Func 1", "Gate CV", -0.3), (0, "Func 2", "Resonance", 0.3), (0, "S&H", "Fold", 0.2)),
     ("pad", "drone", ["dark", "evolving", "thick"], ["ambient", "idm"], ["intro", "breakdown"], 2),
     "A dark drone that feeds on itself: the filter and the gate listen to their own output and to each other, and chaos keeps the loop breathing."),
    # Two Faces: set A is a calm glassy pad (the modulator bends the West sine, Func 1 swells the fold), set B a machine (Func 2 pulses the gate, S&H picks pitches,
    # the ring modulator is patched into the filter); the Morph knob (k15) fades from one to the other.
    ("Two Faces",
     {"v1_wave": TRI, "v1_lv": 0.35, "v2_wave": SAW, "v2_lv": 0.25, "v2_fine": 9, "ring_lv": 0.0, "noise_lv": 0.0, "v3_pitch": 19, "v3_lv": 0, "w_pitch": 0, "w_fold": 6, "w_lv": 0.5,
      "g_mode": BOTH, "g_open": 0.85, "g_strike": 0.0, "g_decay": 0.4, "r_west": 0.2, "f_type": SEM, "f_cut": 1500, "f_reso": 0.3, "f_env": 0, "f_key": 0.6,
      "e2_a": 0.8, "e2_d": 2.0, "e2_s": 1.0, "e2_r": 1.2, "f1_rise": 4.0, "f1_fall": 4.0, "f2_rise": 0.06, "f2_fall": 0.09, "sh_slew": 10, "ch_rate": 0.5, "fb_amt": 0.0,
      "fx_dtime": 380, "fx_dfb": 0.4, "fx_dmix": 0.2, "fx_hmix": 0.35, "morph": 0.0, "drift": 0.4, "vol": 0},
     ST((0, "VCO 3", "West Pitch", 0.22), (0, "Func 1", "Fold", 0.2), (0, "Chaos", "Cutoff", 0.1), (0, "Func 1", "Cutoff", 0.15),
        (1, "Func 2", "Gate CV", 0.28), (1, "Func 2", "Amp", -0.4), (1, "S&H", "VCO 1 Pitch", 0.35), (1, "S&H", "VCO 2 Pitch", 0.35),
        (1, "Ring", "Filter In", 0.4), (1, "Func 2", "Cutoff", 0.3)),
     ("pad", "atmosphere", ["evolving", "metallic", "transparent"], ["ambient", "idm"], ["intro", "transition"], 3),
     "Two sounds in one: a calm glassy pad in set A and a pulsing machine in set B, joined by the Morph knob."),
    # Glass Rain: Func 2 plucks the low-pass gate again and again, its tempo is pushed around by Func 1 and a chaos source, and a sample and hold re-tunes the
    # modulator with every drop, so every bell is another inharmonic timbre of the same note.
    ("Glass Rain",
     {"v1_lv": 0, "v2_lv": 0, "ring_lv": 0, "noise_lv": 0, "v3_lv": 0, "v3_pitch": 12, "w_pitch": 0, "w_fold": 3, "w_shape": 0.7, "w_lv": 1.0,
      "g_mode": BOTH, "g_open": 0.0, "g_strike": 0.0, "g_decay": 0.12, "g_reso": 0.0, "r_west": 0.0, "f_cut": 6000, "f_reso": 0.1, "f_env": 0, "f_key": 0.0,
      "e2_a": 0.02, "e2_d": 2.0, "e2_s": 1.0, "e2_r": 1.5, "f1_rise": 4.0, "f1_fall": 6.0, "f2_rise": 0.003, "f2_fall": 0.55, "sh_slew": 0, "ch_rate": 0.5, "fb_amt": 0.0,
      "fx_dtime": 430, "fx_dfb": 0.5, "fx_dmix": 0.3, "fx_hmix": 0.5, "drift": 0.3, "vol": 6},
     ST((0, "Func 2", "Gate CV", 0.18), (0, "S&H", "VCO 3 Pitch", 0.6), (0, "VCO 3", "West Pitch", 0.25), (0, "S&H", "Fold", 0.25),
        (0, "Func 1", "Func 2 Tempo", 0.3), (0, "Chaos", "Func 2 Tempo", 0.12)),
     ("keys", "bell", ["bright", "airy", "metallic"], ["ambient", "idm"], ["intro", "breakdown"], 2),
     "A rain of glass bells that plays itself: every drop re-tunes the FM modulator, and chaos and a slow wave scatter the rhythm of the drops."),
    # Gate Walker: Func 2 pulses the gate of the West sub and the East filter in a steady rhythm and S&H picks the next small pitch step and fold depth each pulse:
    # a bass line that walks by itself.
    ("Gate Walker",
     {"v1_wave": SAW, "v1_lv": 0.35, "v2_lv": 0, "ring_lv": 0, "noise_lv": 0, "v3_lv": 0, "w_pitch": 0, "w_fold": 10, "w_shape": 0.4, "w_lv": 0.9,
      "g_mode": BOTH, "g_open": 0.0, "g_strike": 0.0, "g_decay": 0.08, "r_west": 0.0, "f_type": LADDER, "f_cut": 260, "f_reso": 0.35, "f_drive": 0.25, "f_env": 0, "f_key": 0.5,
      "e2_a": 0.005, "e2_d": 1.0, "e2_s": 1.0, "e2_r": 0.2, "f2_rise": 0.005, "f2_fall": 0.4, "sh_slew": 15, "ch_rate": 0.5, "fb_amt": 0.0,
      "fx_dmix": 0.1, "fx_dtime": 250, "fx_hmix": 0.06, "drift": 0.1, "vol": 6},
     ST((0, "Func 2", "Gate CV", 0.18), (0, "Func 2", "Cutoff", 0.45), (0, "S&H", "VCO 1 Pitch", 0.25), (0, "S&H", "Fold", 0.35), (0, "S&H", "Cutoff", 0.2)),
     ("bass", "sub", ["deep", "tight", "evolving"], ["techno", "minimal"], ["drop", "build"], 3),
     "A sub bass that walks by itself: a function generator pulses the gate and filter, and a sample and hold picks a new small pitch step and fold depth each time."),
]


def alle():
    """(name, overrides by id, pins, (art, unterart, charakter, genre, einsatz, energie), text)"""
    aus = []
    for name, ue_v1, bes, text in P:
        ue, _ = uebertrage(ue_v1)
        aus.append((name, ue, v1_stifte(ue_v1), bes, text))
    aus.extend(P2)
    return aus


# the defaults of the version 1 knobs reproduce the default pins of the graph (a self-check of v1_stifte against bau_kraken.STIFTE_A_ROH)
from build_kraken import STIFTE_A_ROH
_def = v1_stifte({})
assert len(_def) == len(STIFTE_A_ROH) and all(a[:3] == b[:3] and abs(a[3] - b[3]) < 1.5e-4 for a, b in zip(_def, STIFTE_A_ROH)), (_def, STIFTE_A_ROH)

def main():
    global ZIEL
    if "--verlust" in sys.argv:
        for name, ue, *_ in P:
            print(name, "v1 values of the removed knobs:", uebertrage(ue)[1], "->", len(v1_stifte(ue)), "pins")
        sys.exit(0)

    # tuning aids: `--ziel DIR` writes somewhere else (the harness plays it with KRAKEN_PRESETS=DIR), `--knoepfe JSON` overrides knobs by id in every preset
    if "--ziel" in sys.argv:
        ZIEL = pathlib.Path(sys.argv[sys.argv.index("--ziel") + 1])
    UEBER = json.loads(sys.argv[sys.argv.index("--knoepfe") + 1]) if "--knoepfe" in sys.argv else {}
    ZIEL.mkdir(parents=True, exist_ok=True)
    slugs = set()
    for name, ue, stifte, (art, unter, char, genre, eins, en), text in alle():
        ue = {**ue, **UEBER}
        assert set(ue) <= set(KK), set(ue) - set(KK)
        assert 10 <= len(text) <= 160, (name, len(text))
        slug = f"{GRAPH}-" + name.lower().replace(" ", "-")
        assert slug not in slugs, slug
        slugs.add(slug)
        werte = {f"knob{k[0]}": round(norm(k[1], ue[k[1]]) if k[1] in ue else vorgabe(k[1]), 5) for k in K}
        doc = {"schema": 1, "name": name, "geraet_typ": "instrument", "geraet": "baukasten", "graph": GRAPH, "werte": werte, "stifte": stifte,
               "beschreibung": {"art": art, "unterart": unter, "charakter": char, "genre": genre, "einsatz": eins, "energie": en, "text": text},
               "tags": [GRAPH, "semi-modular"], "notiz": NOTIZ,
               "angelegt": "2026-11-19T00:00:00.000Z", "geaendert": "2026-11-19T00:00:00.000Z"}
        (ZIEL / f"{slug}.preset.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(len(slugs), "presets in", ZIEL)


if __name__ == "__main__":
    main()
