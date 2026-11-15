#!/usr/bin/env python3
"""Builds the Baukasten instrument `bass-banddrive` ("Band Drive Bass"): graph (demos/) and front panel (paneele/).

    python3 build_banddrive.py            # writes demos/bass-banddrive.json and paneele/bass-banddrive.json
    python3 build_banddrive.py --tabelle  # prints the knob map as a Markdown table (for the device document)

The knob table below is the single source of the knob numbers, ranges and defaults.

Signal path (one voice, mono, last note wins):
  note -> glide (a `wahl` morph over the raw pitch and four `glatt` smoothers; knob 0 = raw pitch)
  wavetable (3 detuned copies, table 4 `analog`, position = knob + wave envelope + LFO) + a hard-synced saw (Bite)
    -> low-pass (svf, 4 poles) per side, cutoff = knob moved by an envelope and by velocity
    -> kreuz (3 bands) per side
         lo   : clean, summed to mono, plus the clean sine sub at the (glided) note pitch
         mid  : wavefolder (`falter`, ueber 0: no oversampling, no latency), drive compensation, vowel filter (`formant`),
                high-pass at the low split so the fold cannot refill the sub region
         hi   : tanh saturator (`saett`), drive compensation, level (Air)
    -> mid + high go through a soft ceiling (tanh around CEILING); the clean low part is added after it, so it stays mono and untouched
    -> amp envelope -> output gain -> out
The compensation of each drive stage is a polynomial in dB over the knob (DRIVE_COMP), fitted to the render of the test phrase.
"""
import json
import math
import pathlib
import sys

HIER = pathlib.Path(__file__).parent

# (nr, id, name, min, max, log, default in knob units, panel format, unit)
K = [
    (1, "k_pos", "Wave position", 0, 1, 0, 0.6, "percent", None),
    (2, "k_wamt", "Wave env amount", -1, 1, 0, 0.35, "percent", None),
    (3, "k_lrate", "Wave LFO rate", 0.05, 12, 1, 2.0, "hz", None),
    (4, "k_ldepth", "Wave LFO depth", 0, 1, 0, 0.85, "percent", None),
    (5, "k_det", "Detune", 0, 40, 0, 7, "raw", "ct"),
    (6, "k_breite", "Width", 0, 1, 0, 0.5, "percent", None),
    (7, "k_bite", "Bite", 0, 1, 0, 0.35, "percent", None),
    (8, "k_sub", "Sub level", 0, 1, 0, 0.7, "percent", None),
    (9, "k_glide", "Glide", 0, 1, 0, 0, "percent", None),
    (10, "k_cut", "Cutoff", 80, 8000, 1, 3200, "hz", None),
    (11, "k_reso", "Resonance", 0, 0.85, 0, 0.25, "percent", None),
    (12, "k_fenv", "Env amount", 0, 60, 0, 26, "raw", "st"),
    (13, "k_fdec", "Env decay", 0.03, 1.5, 1, 0.18, "raw", "s"),
    (14, "k_low", "Low split", 60, 250, 1, 120, "hz", None),
    (15, "k_high", "High split", 800, 4000, 1, 1500, "hz", None),
    (16, "k_mdrive", "Mid drive", 0, 1, 0, 0.6, "percent", None),
    (17, "k_vowel", "Vowel", 0, 4, 0, 1.2, "raw", "a-u"),
    (18, "k_vmove", "Vowel move", 0, 1, 0, 0.9, "percent", None),
    (19, "k_hdrive", "High drive", 0, 1, 0, 0.55, "percent", None),
    (20, "k_air", "Air", 0, 1.5, 0, 1.0, "percent", None),
    (21, "k_att", "Attack", 0.001, 0.2, 1, 0.004, "raw", "s"),
    (22, "k_ds", "Decay/Sustain", 0, 1, 0, 0.8, "percent", None),
    (23, "k_rel", "Release", 0.02, 1.5, 1, 0.12, "raw", "s"),
    (24, "k_out", "Output", -24, 6, 0, -1.5, "db", None),
]

# fixed design values
TABLE = 4            # `analog`: sine, triangle, saw, square
COPIES = 3
DRIVE_MAX_DB = {"mid": 30.0, "hi": 30.0}
# compensation in dB at knob position d (0..1): -(a d + b d^2), fitted by tests/bass_banddrive.rs (`kalibriere`)
DRIVE_COMP = {"mid": (0.0, 0.0), "hi": (0.0, 0.0)}
CEILING = 0.7        # tanh ceiling of the mid and high part
LEVEL = {"wt": 0.5, "bite": 0.35, "sub": 0.4}
SUB2 = 0.35         # second partial of the sub relative to the fundamental
SRC_TRIM = 0.4       # level of the filtered sources
PRE = {"mid": 4.0, "hi": 4.0}   # fixed gain in front of each drive stage, taken out again behind it: the drive is a level-matched stage
ST_PER_DB = 12 / (20 * math.log10(2))   # transponiere: gain = 2^(st/12), so dB * 1.9932 semitones
LFO_CUT_ST = 60      # the wave LFO also swings the cutoff by up to +-60 semitones at depth 1
VEL_ST = 18          # velocity 0.. 1 shifts the cutoff by up to -18 semitones


def vorgabe(k):
    _, _, _, lo, hi, log, d, *_ = k
    return (math.log(d / lo) / math.log(hi / lo)) if log else (d - lo) / (hi - lo)


def lade_kalibrierung():
    p = HIER / "bau_banddrive_kalibrierung.json"
    if p.exists():
        DRIVE_COMP.update({k: tuple(v) for k, v in json.loads(p.read_text()).items()})


def graph():
    knoten, kanten = [], []
    n = lambda **w: knoten.append(w)
    e = lambda a, b: kanten.append({"von": a, "nach": b})
    n(id="note", art="note")
    for nr, kid, name, lo, hi, log, d, _, _ in K:
        w = dict(id=kid, art="regler", nr=nr, min=lo, max=hi)
        if log:
            w["log"] = 1
        v = round(vorgabe(next(k for k in K if k[0] == nr)), 6)
        if v != 0.5:
            w["vorgabe"] = v
        n(**w)

    # --- pitch with glide: morph over raw pitch and four smoothers (15, 40, 100, 250 ms)
    n(id="gl_sel", art="wahl", n=5, modus=1, norm=1)
    e("note.hz", "gl_sel.e1")
    for i, z in enumerate((0.015, 0.04, 0.1, 0.25), start=1):
        n(id=f"gl{i}", art="glatt", zeit=z)
        e("note.hz", f"gl{i}.x")
        e("note.erste", f"gl{i}.setzen")
        e(f"gl{i}.aus", f"gl_sel.e{i + 1}")
    e("k_glide.aus", "gl_sel.wahl")
    TON = "gl_sel.aus"

    # --- modulators
    n(id="wenv", art="adsr", a=0.004, d=0.45, s=0, r=0.3)
    e("note.gate", "wenv.gate"); e("note.trig", "wenv.trig")
    n(id="lfo", art="lfo", form=0, neustart=1)
    e("k_lrate.aus", "lfo.rate"); e("note.trig", "lfo.trig")
    n(id="wmod", art="mul"); e("wenv.aus", "wmod.a"); e("k_wamt.aus", "wmod.b")
    n(id="lmod0", art="mul"); e("lfo.aus", "lmod0.a"); e("k_ldepth.aus", "lmod0.b")
    n(id="lmod", art="mul", b=0.5); e("lmod0.aus", "lmod.a")
    n(id="pos", art="add"); e("k_pos.aus", "pos.a"); e("wmod.aus", "pos.b"); e("lmod.aus", "pos.c")

    # --- sub: clean sine at the note pitch, also the sync master of the bite voice
    n(id="sub", art="sinus"); e(TON, "sub.hz")
    n(id="sub_g", art="mul", b=LEVEL["sub"]); e("sub.aus", "sub_g.a")
    n(id="sub_p", art="mul"); e("sub_g.aus", "sub_p.a"); e("k_sub.aus", "sub_p.b")

    # --- wavetable stack
    n(id="wt", art="wavetable", tabelle=TABLE, kopien=COPIES, saat=7)
    e(TON, "wt.hz"); e("note.trig", "wt.trig"); e("pos.aus", "wt.pos")
    e("k_det.aus", "wt.verstimmung"); e("k_breite.aus", "wt.breite")

    # --- bite: a saw hard-synced to the sub; its pitch rises with the wave envelope and swings with the LFO
    n(id="bite_w1", art="mul", b=14); e("wenv.aus", "bite_w1.a")
    n(id="bite_w2", art="mul", b=5); e("lfo.aus", "bite_w2.a")
    n(id="bite_st", art="add", c=7); e("bite_w1.aus", "bite_st.a"); e("bite_w2.aus", "bite_st.b")
    n(id="bite_hz", art="transponiere"); e(TON, "bite_hz.hz"); e("bite_st.aus", "bite_hz.st")
    n(id="bite_osc", art="saege"); e("bite_hz.aus", "bite_osc.hz"); e("sub.hart", "bite_osc.hart")
    n(id="bite_dc", art="svf", cutoff=30, reso=0); e("bite_osc.aus", "bite_dc.x")
    n(id="bite_g", art="mul", b=LEVEL["bite"]); e("bite_dc.hp", "bite_g.a")
    n(id="bite_p", art="mul"); e("bite_g.aus", "bite_p.a"); e("k_bite.aus", "bite_p.b")

    # --- filter on the sources: cutoff = knob moved by the filter envelope and by velocity
    n(id="fenv", art="adsr", a=0.001, d=0.18, s=0, r=0.08); e("note.gate", "fenv.gate"); e("note.trig", "fenv.trig"); e("k_fdec.aus", "fenv.d")
    n(id="fenv_st", art="mul"); e("fenv.aus", "fenv_st.a"); e("k_fenv.aus", "fenv_st.b")
    n(id="vel_m1", art="add", b=-1); e("note.vel", "vel_m1.a")
    n(id="vel_st", art="mul", b=VEL_ST); e("vel_m1.aus", "vel_st.a")
    n(id="cut_lfo", art="mul", b=LFO_CUT_ST); e("lmod0.aus", "cut_lfo.a")
    n(id="cut_st", art="add"); e("fenv_st.aus", "cut_st.a"); e("vel_st.aus", "cut_st.b"); e("cut_lfo.aus", "cut_st.c")
    n(id="cut", art="transponiere"); e("k_cut.aus", "cut.hz"); e("cut_st.aus", "cut.st")

    n(id="vowel_l", art="mul", b=4); e("lfo.aus", "vowel_l.a")
    n(id="vowel_l2", art="mul"); e("vowel_l.aus", "vowel_l2.a"); e("k_vmove.aus", "vowel_l2.b")
    n(id="vowel_e", art="mul", b=4); e("wenv.aus", "vowel_e.a")
    n(id="vowel_e2", art="mul"); e("vowel_e.aus", "vowel_e2.a"); e("k_vmove.aus", "vowel_e2.b")
    n(id="vowel", art="add"); e("k_vowel.aus", "vowel.a"); e("vowel_l2.aus", "vowel.b"); e("vowel_e2.aus", "vowel.c")

    # drive amounts (dB) and compensation gains
    def antrieb(band, knob):
        n(id=f"{band}_db", art="mul", b=DRIVE_MAX_DB[band]); e(f"{knob}.aus", f"{band}_db.a")
        a, b = DRIVE_COMP[band]
        n(id=f"{band}_c1", art="mul", b=-a * ST_PER_DB); e(f"{knob}.aus", f"{band}_c1.a")
        n(id=f"{band}_sq", art="mul"); e(f"{knob}.aus", f"{band}_sq.a"); e(f"{knob}.aus", f"{band}_sq.b")
        n(id=f"{band}_c2", art="mul", b=-b * ST_PER_DB); e(f"{band}_sq.aus", f"{band}_c2.a")
        n(id=f"{band}_cst", art="add"); e(f"{band}_c1.aus", f"{band}_cst.a"); e(f"{band}_c2.aus", f"{band}_cst.b")
        n(id=f"{band}_g", art="transponiere", hz=1.0 / PRE[band]); e(f"{band}_cst.aus", f"{band}_g.st")
    antrieb("mid", "k_mdrive")
    antrieb("hi", "k_hdrive")
    n(id="fold_form", art="konst", wert=0.4)

    for c in "lr":
        n(id=f"src0_{c}", art="add"); e(f"wt.{c}", f"src0_{c}.a"); e("bite_p.aus", f"src0_{c}.b")
        n(id=f"src_{c}", art="mul", b=SRC_TRIM); e(f"src0_{c}.aus", f"src_{c}.a")
        n(id=f"flt_{c}", art="svf", pole=4); e(f"src_{c}.aus", f"flt_{c}.x"); e("cut.aus", f"flt_{c}.cutoff"); e("k_reso.aus", f"flt_{c}.reso")
        n(id=f"kr_{c}", art="kreuz", baender=3); e(f"flt_{c}.tp", f"kr_{c}.x"); e("k_low.aus", f"kr_{c}.fc1"); e("k_high.aus", f"kr_{c}.fc2")
        # mid: fold, compensate, vowel, high-pass at the low split
        n(id=f"fpre_{c}", art="mul", b=PRE["mid"]); e(f"kr_{c}.mid", f"fpre_{c}.a")
        n(id=f"fold_{c}", art="falter", ueber=0); e(f"fpre_{c}.aus", f"fold_{c}.x"); e("mid_db.aus", f"fold_{c}.antrieb"); e("fold_form.aus", f"fold_{c}.form")
        n(id=f"foldg_{c}", art="mul"); e(f"fold_{c}.aus", f"foldg_{c}.a"); e("mid_g.aus", f"foldg_{c}.b")
        n(id=f"fmt_{c}", art="formant"); e(f"foldg_{c}.aus", f"fmt_{c}.x"); e("vowel.aus", f"fmt_{c}.vokal")
        n(id=f"midhp_{c}", art="svf", pole=4, reso=0); e(f"fmt_{c}.aus", f"midhp_{c}.x"); e("k_low.aus", f"midhp_{c}.cutoff")
        # high: tanh drive, compensate, Air
        n(id=f"spre_{c}", art="mul", b=PRE["hi"]); e(f"kr_{c}.hi", f"spre_{c}.a")
        n(id=f"sat_{c}", art="saett"); e(f"spre_{c}.aus", f"sat_{c}.x"); e("hi_db.aus", f"sat_{c}.antrieb")
        n(id=f"satg_{c}", art="mul"); e(f"sat_{c}.aus", f"satg_{c}.a"); e("hi_g.aus", f"satg_{c}.b")
        n(id=f"air_{c}", art="mul"); e(f"satg_{c}.aus", f"air_{c}.a"); e("k_air.aus", f"air_{c}.b")
        # ceiling of the stereo part
        n(id=f"mh_{c}", art="add"); e(f"midhp_{c}.hp", f"mh_{c}.a"); e(f"air_{c}.aus", f"mh_{c}.b")
        n(id=f"cl_in_{c}", art="mul", b=1 / CEILING); e(f"mh_{c}.aus", f"cl_in_{c}.a")
        n(id=f"cl_{c}", art="saett", antrieb=0); e(f"cl_in_{c}.aus", f"cl_{c}.x")
        n(id=f"cl_out_{c}", art="mul", b=CEILING); e(f"cl_{c}.aus", f"cl_out_{c}.a")

    # --- stereo image of mid and high: the side signal is high-passed at twice the low split, so nothing below the split differs between the sides
    n(id="ms_m0", art="add"); e("cl_out_l.aus", "ms_m0.a"); e("cl_out_r.aus", "ms_m0.b")
    n(id="ms_m", art="mul", b=0.5); e("ms_m0.aus", "ms_m.a")
    n(id="ms_s0", art="mul", b=-1); e("cl_out_r.aus", "ms_s0.a")
    n(id="ms_s1", art="add"); e("cl_out_l.aus", "ms_s1.a"); e("ms_s0.aus", "ms_s1.b")
    n(id="ms_s2", art="mul", b=0.5); e("ms_s1.aus", "ms_s2.a")
    n(id="ms_fc", art="mul", b=2); e("k_low.aus", "ms_fc.a")
    n(id="ms_hp", art="svf", pole=4, reso=0); e("ms_s2.aus", "ms_hp.x"); e("ms_fc.aus", "ms_hp.cutoff")
    n(id="ms_neg", art="mul", b=-1); e("ms_hp.hp", "ms_neg.a")
    n(id="st_l", art="add"); e("ms_m.aus", "st_l.a"); e("ms_hp.hp", "st_l.b")
    n(id="st_r", art="add"); e("ms_m.aus", "st_r.a"); e("ms_neg.aus", "st_r.b")

    # --- clean mono low part: low bands of both sides, plus the sub and the sources' own low content
    # The low outputs of the two kreuz nodes are not used: the sources' own content below the split (the fundamental and the second
    # partial) would beat against the sub (random start phases, detuned copies) and move the punch from note to note. The clean low
    # end is two sines at exactly f and 2f instead, the same two partials a saw has down there.
    n(id="sub2_hz", art="transponiere", st=12); e(TON, "sub2_hz.hz")
    n(id="sub2", art="sinus"); e("sub2_hz.aus", "sub2.hz")
    n(id="sub2_g", art="mul", b=LEVEL["sub"] * SUB2); e("sub2.aus", "sub2_g.a")
    n(id="sub2_p", art="mul"); e("sub2_g.aus", "sub2_p.a"); e("k_sub.aus", "sub2_p.b")
    n(id="tief", art="add"); e("sub_p.aus", "tief.a"); e("sub2_p.aus", "tief.b")

    # --- amp envelope: attack, decay time and sustain from one knob, release
    n(id="env", art="adsr", a=0.004, d=0.4, s=0.8, r=0.12)
    e("note.gate", "env.gate"); e("note.trig", "env.trig"); e("k_att.aus", "env.a"); e("k_ds.aus", "env.s"); e("k_rel.aus", "env.r")
    n(id="env_d0", art="mul", b=0.5); e("k_ds.aus", "env_d0.a")
    n(id="env_d", art="add", b=0.08); e("env_d0.aus", "env_d.a"); e("env_d.aus", "env.d")
    n(id="out_st", art="mul", b=ST_PER_DB); e("k_out.aus", "out_st.a")
    n(id="out_g", art="transponiere", hz=1.0); e("out_st.aus", "out_g.st")
    n(id="vca_g", art="mul"); e("env.aus", "vca_g.a"); e("out_g.aus", "vca_g.b")
    n(id="aus", art="ausgang")
    for c in "lr":
        n(id=f"sum_{c}", art="add"); e("tief.aus", f"sum_{c}.a"); e(f"st_{c}.aus", f"sum_{c}.b")
        n(id=f"vca_{c}", art="mul"); e(f"sum_{c}.aus", f"vca_{c}.a"); e("vca_g.aus", f"vca_{c}.b")
        # DC block: the high output of a 2-band kreuz at 12 Hz (LR4, flushes its states, so the tail never ends in subnormal floats)
        n(id=f"dcout_{c}", art="kreuz", baender=2, fc1=12); e(f"vca_{c}.aus", f"dcout_{c}.x")
        e(f"dcout_{c}.hi", f"aus.{c}")
    return {"format": "baukasten/2", "name": "bass-banddrive", "stimmen": 1,
            "regler_namen": {str(k[0]): k[2] for k in K}, "knoten": knoten, "kanten": kanten}


def knob(cid, k, **w):
    nr, _, name, lo, hi, log, d, fmt, unit = k
    c = {"id": cid, "type": "knob", "label": name, "bind": {"param": f"k{nr}"}, "format": fmt, "default": round(vorgabe(k), 6)}
    if unit:
        c["unit"] = unit
    c.update(w)
    return c


def panel():
    kk = {k[0]: k for k in K}
    k = lambda nr, label=None: knob(f"c{nr}", kk[nr], **({"label": label} if label else {}))
    text = lambda cid, t, span: {"id": cid, "type": "label", "span": span, "text": t}
    return {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": "bass-banddrive"}, "title": "Band Drive Bass", "akzent": "violett",
            "layout": {"rows": [["source", "filter", "bands"], ["amp", "out"]]},
            "sections": [
                {"id": "source", "title": "SOURCE", "cols": 3, "controls": [k(1), k(2), k(3), k(4), k(5), k(6), k(7), k(8), k(9),
                    text("s1", "Wavetable stack, synced saw, clean sub.", 3)]},
                {"id": "filter", "title": "FILTER", "cols": 2, "controls": [
                    {"id": "fk", "type": "filterkurve", "span": 2, "of": {"cutoff": "c10", "reso": "c11"}, "typen": [{"art": "lp", "pole": 4}]},
                    k(10), k(11), k(12), k(13),
                    text("f1", "On the sources, not the sub.", 2)]},
                {"id": "bands", "title": "BANDS", "cols": 4, "controls": [k(14), k(15), k(16), k(17), k(18), k(19), k(20),
                    text("b1", "Low clean, mid folds, high tanh.", 4)]},
                {"id": "amp", "title": "AMP", "cols": 3, "controls": [
                    {"id": "ahue", "type": "huelle", "span": 3, "label": "Amp envelope", "of": {"a": "c21", "d": 0.4, "s": "c22", "r": "c23"}},
                    k(21), k(22), k(23)]},
                {"id": "out", "title": "OUTPUT", "cols": 1, "controls": [k(24)]},
            ]}


def schreibe(pfad, daten):
    pfad.write_text(json.dumps(daten, indent=1, ensure_ascii=False) + "\n")


def tabelle():
    z = ["| Knob | Name | Range | Default |", "|---|---|---|---|"]
    for nr, _, name, lo, hi, log, d, fmt, unit in K:
        z.append(f"| k{nr} | {name} | {lo:g} .. {hi:g}{' log' if log else ''}{(' ' + unit) if unit and fmt == 'raw' and unit != 'a-u' else ''} | {d:g} |")
    return "\n".join(z)


if __name__ == "__main__":
    lade_kalibrierung()
    if "--tabelle" in sys.argv:
        print(tabelle())
        sys.exit(0)
    g = graph()
    schreibe(HIER / "demos" / "bass-banddrive.json", g)
    schreibe(HIER / "paneele" / "bass-banddrive.json", panel())
    print(g["name"], len(g["regler_namen"]), "knobs,", len(g["knoten"]), "nodes")
