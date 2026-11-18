#!/usr/bin/env python3
"""Synth upgrade wave 1, task D: the newer Baukasten functions reach `wavetable-reese`, `wavetable-supersaw` and `wavetable-chor`
as NEW knobs (from 10 up). Refuses a second run.

    python3 patch_wavetable_neu.py          # patches demos/wavetable-*.json in place

Knobs (class in brackets, see ausbau.py), common to all three graphs:
  10 Warp mode [N selector: Off, Bend, Asym, Sync; vorgabe 0]      -> `osz.warp` (the knob range is 0..3, the engine rounds)
  11 Warp depth [F, -1..1, default 0.5]                            -> `osz.tiefe`
  12 Stack [N selector: Off, Octave, Octave + fifth; vorgabe 0]    -> `osz.stapel` (read at `trig`, needs `kopien` >= 2)
  13 Chaos rate [F, 0.05..20 Hz log, default 0.3 Hz]
  14 Chaos to position [GB, +-1]: a Lorenz `chaos` node (per voice, seeded), joined into the position sum as its last term
wavetable-reese: 15 Clean sub [G], 16 Sub octave [F: -1, -2], 17 Phase mod [G, 0..0.5 cycles], 18 Band drive [G]
wavetable-supersaw: 15 Chorus [G], 16 Chorus mode [F]
wavetable-chor: 15 Phase mod [G, 0..0.5 cycles], 16 Chorus [G], 17 Chorus mode [F]

At the default every new term is exactly 0.0 (or an input that is 0, which the engine treats as the plain path), so the graphs
render byte for byte as before: `measure_null.py run wavetable-reese|wavetable-supersaw|wavetable-chor` proves it against the
commit the plan was cut from.
"""
import json
import pathlib
import sys

import ausbau as A

HIER = pathlib.Path(__file__).resolve().parent
SUB_GAIN = 1.0                 # clean sub: a sine of this peak, times the knob, times the amp envelope, joins in front of the output level
CHORUS_MAX = 0.5               # chorus knob at 1 = this mix
BAND_HZ = 180                  # band drive: the crossover
BAND_DB = 15                   # band drive: drive of the extra saturator on the upper band


def schreibe(pfad, g):
    out = ['{', '  "format": "baukasten/2",', f'  "name": "{g["name"]}",', f'  "stimmen": {g["stimmen"]},']
    out.append('  "regler_namen": ' + json.dumps(dict(sorted(g["regler_namen"].items(), key=lambda kv: int(kv[0]))), ensure_ascii=False) + ',')
    out.append('  "knoten": [')
    out.append(",\n".join("    " + json.dumps(n, ensure_ascii=False) for n in g["knoten"]))
    out.append('  ],')
    out.append('  "kanten": [')
    out.append(",\n".join("    " + json.dumps(e, ensure_ascii=False) for e in g["kanten"]))
    out.append('  ]')
    out.append('}')
    pfad.write_text("\n".join(out) + "\n")


def sperre(g, id, nr, term):
    """Gate a feature that sits at 0 by default so its blocks are not computed while it is off. A `wahl` (switch mode, 2 inputs)
    reads the constant 0.0 first and `term` second; it is selected by a second `regler` node on the feature's own knob `nr`
    (range 0..1000: exactly 0 at knob 0, 1 or more at any knob above 0.0005). While the knob is at 0 the branch of `term` (the
    steps that feed nothing else) is skipped by the engine (zweige.rs), and the output is exactly 0.0, which is what the
    ungated term was at amount 0, so the old signal stays byte for byte."""
    sel = A.regler(g, f"{id}_sel", nr, 0, 1000, vorgabe=0)
    return _wahl0(g, id, term, sel)


def _wahl0(g, id, term, sel):
    A.knoten(g, id, "wahl", n=2, blende=10, e1=0.0)
    A.kante(g, term, f"{id}.e2")
    A.kante(g, sel, f"{id}.wahl")
    return f"{id}.aus"


def warp_stapel(g, info):
    """Knobs 10..12: the wavetable's `warp`, `tiefe` and `stapel` inputs. A wired 0 is the plain path in the engine."""
    info.neu(10, "Warp mode", 0.0, "N", stufen=(4, 0))
    A.kante(g, A.regler(g, "k_warp", 10, 0, 3, vorgabe=0), "osz.warp")
    A._f(g, info, "k_wtiefe", 11, "Warp depth", -1, 1, 0.5)
    A.kante(g, "k_wtiefe.aus", "osz.tiefe")
    info.neu(12, "Stack", 0.0, "N", stufen=(3, 0))
    A.kante(g, A.regler(g, "k_stapel", 12, 0, 2, vorgabe=0), "osz.stapel")


def dc_weiche(g, quellen):
    """A warp (bend, asym, sync) moves the mean of the wave: the extreme positions of the warp knob would leave a DC offset above the
    limit of the example graphs (-50 dB; wavetable-supersaw sync -36 dB). `quellen` {side: (source port, target input port)} is the
    point where the signal passes on to the VCA. Mode Off keeps the old wire (the first candidate of a switch-mode `wahl`, so the
    old path is untouched bit for bit); the three warp modes take the same signal through a 25 Hz high-pass."""
    # 2-way `wahl`: the knob 0..3 is clamped to 0..1 by the switch, so mode Off picks the old wire and every warp mode the high-pass.
    # One candidate for all three modes: the high-pass feeds exactly one candidate, so its branch is exclusive and skipped in mode Off.
    for c, (quelle, ziel) in quellen.items():
        A.knoten(g, f"dcw_{c}", "svf", cutoff=25, reso=0)
        A.kante(g, quelle, f"dcw_{c}.x")
        alt = A.eingang_von(g, ziel)
        assert len(alt) == 1 and alt[0]["von"] == quelle, (ziel, alt)
        w = A._wahl(g, f"dcw_w_{c}", 2, [quelle, f"dcw_{c}.hp"], "k_warp.aus")
        alt[0]["von"] = w


def chaos_position(g, info, saat, pos_eingang):
    """Knobs 13, 14: a Lorenz chaos node, scaled by a bipolar knob, as the last input `pos_eingang` of the position sum."""
    A.knoten(g, "chaos", "chaos", form=0, saat=saat)
    A.kante(g, A._f(g, info, "k_crate", 13, "Chaos rate", 0.05, 20, 0.3, log=True), "chaos.rate")
    amt = A._g_bi(g, info, "k_cpos", 14, "Chaos to position", 1.0)
    A.kante(g, A.mul(g, "cha_pos", "chaos.aus", amt), pos_eingang)


def phasenmod(g, info, nr):
    """A sine at the note pitch, times a knob of 0..0.5 cycles, into `osz.pm`."""
    A.knoten(g, "pm_sin", "sinus")
    A.kante(g, "note.hz", "pm_sin.hz")
    amt = A._g_uni(g, info, "k_pm", nr, "Phase mod", 0.5)
    A.kante(g, sperre(g, "pm_gate", nr, A.mul(g, "pm_sig", "pm_sin.aus", amt)), "osz.pm")


def chorus(g, info, nr):
    """Chorus after the output level (the `fx_ende` pattern: amount G, mode F), in front of the output."""
    r = A.fx_ende(g, "fx", nr, ("lr", "pegel_l.aus", "pegel_r.aus"), abschnitte=("chorus",))
    # the chorus at full mix lifts the level by about 4 dB (peak 1.26 on the chord probe of wavetable-chor): the knob's full travel is a
    # mix of CHORUS_MAX, so the extreme positions stay below the clip bound
    for e in g["kanten"]:
        if e["von"] == "fx_k_ch.aus" and e["nach"].endswith(".mix"):
            e["von"] = A.mul(g, e["nach"].split(".")[0] + "_mx", "fx_k_ch.aus", CHORUS_MAX)
    for e in g["kanten"]:
        if e["nach"] in ("aus.l", "aus.r"):
            e["von"] = r["l"] if e["nach"] == "aus.l" else r["r"]
    for k in ("namen", "vorgaben", "klassen", "stufen"):
        getattr(info, k).update(r[k])


def sub(g, info):
    """Reese knobs 15, 16: a clean sine one or two octaves below the note, through the amp envelope, joined in front of the output level
    (after the filter, both saturators and the DC block)."""
    amt = A._g_uni(g, info, "k_sub", 15, "Clean sub", 1.0)
    info.neu(16, "Sub octave", 0.0, "F", stufen=(2, 0))
    okt = A.regler(g, "k_subokt", 16, 0, 1, vorgabe=0)
    f = A._wahl(g, "sub_okt", 2, [], okt, e1=0.5, e2=0.25)
    A.knoten(g, "sub_osc", "sinus")
    A.kante(g, A.mul(g, "sub_hz", "note.hz", f), "sub_osc.hz")
    term = sperre(g, "sub_gate", 15, A.mul(g, "sub_env", A.mul(g, "sub_lv", "sub_osc.aus", amt), "env.aus"))
    for c in "lr":
        A.einspeisen(g, f"sub_in_{c}", f"pegel_{c}.a", A.mul(g, f"sub_g_{c}", term, SUB_GAIN) if SUB_GAIN != 1.0 else term)


def banddrive(g, info, nr):
    """Reese knob 18: a 2-band `kreuz` at BAND_HZ per side, extra saturation on the upper band only, joined in front of the DC block as
    `old + (driven upper band - upper band) x amount` (exactly +-0.0 at amount 0)."""
    amt = A._g_uni(g, info, "k_band", nr, "Band drive", 1.0)
    for c in "lr":
        A.knoten(g, f"bd_kr_{c}", "kreuz", baender=2, fc1=BAND_HZ)
        A.kante(g, f"drive_{c}.aus", f"bd_kr_{c}.x")
        A.knoten(g, f"bd_sat_{c}", "saett", antrieb=BAND_DB)
        A.kante(g, f"bd_kr_{c}.hi", f"bd_sat_{c}.x")
        diff = A.add(g, f"bd_diff_{c}", f"bd_sat_{c}.aus", A.mul(g, f"bd_neg_{c}", f"bd_kr_{c}.hi", -1))
        A.einspeisen(g, f"bd_in_{c}", f"dcblock_{c}.x", sperre(g, f"bd_gate_{c}", nr, A.mul(g, f"bd_ext_{c}", diff, amt)))


def patch(name, stufen="wscpbf"):
    pfad = HIER / "demos" / f"{name}.json"
    g = json.loads(pfad.read_text())
    if any(k["id"] == "k_warp" for k in g["knoten"]):
        sys.exit(f"{name} already patched")
    info = A._Info()
    if "w" in stufen:
        warp_stapel(g, info)
    if "w" in stufen and name != "wavetable-reese":
        l, r = ("filter_l.tp", "filter_r.tp") if name == "wavetable-supersaw" else ("osz.l", "osz.r")
        dc_weiche(g, {"l": (l, "vca_l.a"), "r": (r, "vca_r.a")})
    if "c" in stufen:
        if name == "wavetable-chor":
            chaos_position(g, info, 5, "pos.d")
        else:
            chaos_position(g, info, 3 if name == "wavetable-reese" else 4, "pos.c")
    if name == "wavetable-reese":
        if "s" in stufen:
            sub(g, info)
        if "p" in stufen:
            phasenmod(g, info, 17)
        if "b" in stufen:
            banddrive(g, info, 18)
    elif name == "wavetable-supersaw":
        if "f" in stufen:
            chorus(g, info, 15)
    else:
        if "p" in stufen:
            phasenmod(g, info, 15)
        if "f" in stufen:
            chorus(g, info, 16)
    g["regler_namen"].update({str(nr): n for nr, n in info.namen.items()})
    return pfad, g, info


if __name__ == "__main__":
    for n in ("wavetable-reese", "wavetable-supersaw", "wavetable-chor"):
        pfad, g, info = patch(n)
        schreibe(pfad, g)
        print(n, len(g["knoten"]), "nodes", len(g["kanten"]), "edges, knobs", sorted(info.namen))
