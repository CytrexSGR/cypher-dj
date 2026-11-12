#!/usr/bin/env python3
"""Builds the full-synth stage of demos/synth-mono.json (knobs 33..60). Refuses a second run.

    python3 patch_mono_ausbau.py            # patches demos/synth-mono.json in place

Appended knobs (class in brackets, see ausbau.py): 33 Filter attack [N], 34 Filter release [N, factor on knob 22], 35 Amp attack [N],
36..39 ModEnv A D S R [F], 40..42 ModEnv to pitch / PWM / cutoff [G bipolar], 43..46 LFO 2 rate / shape / sync / target [F],
47 LFO 2 amount [G bipolar], 48 Velocity depth [N], 49 Velocity to cutoff [G bipolar], 50 Master tune [G bipolar],
51 Osc 1 octave [N], 52 Osc 1 fine [G bipolar], 53 Chorus [G], 54 Chorus mode [F], 55 Delay time [F], 56 Delay feedback [F],
57 Delay mix [G], 58 free (no reverb decay knob), 59 Reverb mix [G], 60 Delay ping-pong [F].

Every modulation joins an old signal through an `add` whose new term is exactly 0.0 at the default; every old constant stays in the
same multiplication (the attack constants become `mitte` knobs). The mono output feeds the chorus; l = r = the old output at the
default. `measure_null.py run synth-mono` proves the whole thing byte for byte against the old graph.
"""
import json
import pathlib

import ausbau as A

HIER = pathlib.Path(__file__).resolve().parent
PFAD = HIER / "demos" / "synth-mono.json"

g = json.loads(PFAD.read_text())
if any(k["id"] == "menv_env" for k in g["knoten"]):
    raise SystemExit("already patched")
K, E = g["knoten"], g["kanten"]
namen = {}


def nimm(r):
    namen.update({str(nr): n for nr, n in r.get("namen", {}).items()})


def umlegen(nach, neu):
    """Replace the single edge into `nach` by one from `neu`."""
    i = [i for i, e in enumerate(E) if e["nach"] == nach]
    assert len(i) == 1, (nach, i)
    E[i[0]]["von"] = neu


# ---- 33, 35: the fixed attack constants become knobs IN MILLISECONDS (the plate reads "1 ms"), `mitte` = the old constant -----------------
# knob (ms) x 0.001 feeds the old multiplication in place of the constant b: 1.0 x f32(0.001) and 2.0 x f32(0.001) are exact, so the old
# product comes back bit for bit at the default (the null test proves it).
for nr, node, alt_ms, lo_ms, name in ((33, "fenv_a_f", 1.0, 0.1, "Filter attack"), (35, "aenv_a_f", 2.0, 0.2, "Amp attack")):
    k = A.knoten_von(g, node)
    assert k.pop("b") == alt_ms * 0.001
    port = A.regler(g, f"k_{node}", nr, lo_ms, 2000.0, log=True, vorgabe=0.5, mitte=alt_ms)
    A.kante(g, A.mul(g, f"{node}_ms", port, 0.001), f"{node}.b")
    namen[str(nr)] = name

# ---- 34: filter release = a factor on the release both envelopes share (knob 22) --------------------------------------------------------
r = A.zeit_faktor(g, "fenv_rel", 34, "fenv_r_f.aus", None, 0.25, 4.0, name="Filter release")
umlegen("fenv.r", r["aus"])
nimm(r)

# ---- 36..42: MOD ENV (retriggers like the other two envelopes: through the mode trigger) -----------------------------------------------
m = A.mod_env(g, "menv", 36, [("pitch", 24, "hz_m.st"), ("pwm", 0.6, "pw.aus", "aus"), ("cutoff", 60, "mod_st.aus", "aus")])
umlegen("menv_env.trig", "mode_trig.aus")
nimm(m)

# ---- 43..47: LFO 2 (targets: cutoff, pitch, PWM, resonance, amp) ----------------------------------------------------------------------
ziele = [("menv_in_cutoff.aus", 36.0, "aus"), ("hz_m.st", 2.0), ("menv_in_pwm.aus", 0.4, "aus"), ("f_lad.reso", 0.5), ("amp_g.aus", 0.5, "aus")]
l = A.lfo2(g, "lfo2", 43, ziele)
nimm(l)
rate = A.knoten_von(g, "lfo2_k_rate")
rate["max"] = 40
rate["vorgabe"] = A._vlog(2.0, 0.05, 40)
for nm, port in (("dio", "f_dio.reso"), ("ms", "f_ms.reso"), ("sem", "f_sem.reso")):     # the resonance target reaches all four filters
    A.einspeisen(g, f"lfo2_reso_{nm}", port, "lfo2_z_zw3.aus")

# ---- 48: velocity depth scales the accent behaviour (amp gain and the filter envelope boost) ------------------------------------------
v = A.vel_tiefe(g, "vdepth", 48, "note.vel", "acc_g.aus")
A.umhaengen(g, "acc_g.aus", v["aus"], ausser=("vdepth_t.a",))
boost = A.mul(g, "vdepth_boost", "boost_v.aus", "vdepth_k.aus")
A.umhaengen(g, "boost_v.aus", boost, ausser=("vdepth_boost.a",))
nimm(v)

# ---- 49: velocity to cutoff (joins the cutoff sum after MOD ENV and LFO 2) ---------------------------------------------------------------
c = A.vel_zu_cutoff(g, "vcut", 49, "note.vel", "lfo2_z_zin0.aus", skala=48)
nimm(c)

# ---- 50: master tune moves the oscillators (not the key track), 51/52: osc 1 octave and fine ----------------------------------------------
t = A.stimmung(g, "tune", 50, "glide_sel.aus")
umlegen("hz_m.hz", t["aus"])
nimm(t)
namen["50"] = "Master tune"
info = A._Info()
okt = A._wahl_knopf(g, info, "o1_k_okt", 51, "Osc1 octave", 5, 2, klasse="N")
fein = A.regler(g, "o1_k_fine", 52, -50, 50, vorgabe=0.5)
info.neu(52, "Osc1 fine", 0.5, "GB")
oktst = A._wahl(g, "o1_oct", 5, [], okt, blende=0, **{f"e{i + 1}": float(-24 + 12 * i) for i in range(5)})
A.knoten(g, "o1_t", "transponiere")
A.kante(g, "hz_m.aus", "o1_t.hz")
A.kante(g, oktst, "o1_t.st")
A.kante(g, fein, "o1_t.cent")
for osc in ("o1_tri", "o1_saw", "o1_pul"):
    umlegen(f"{osc}.hz", "o1_t.aus")
nimm(info.ergebnis())

# ---- 53..60: chorus, delay, reverb at the end of the path (mono source, one hall of 2.2 s, no decay knob) ---------------------------------
fx = A.fx_ende(g, "fx", 53, ("x", "pegel.aus"), hall_stufen=(2.2,), nrs={"hall_mix": 59, "pingpong": 60})
dz = A.knoten_von(g, "fx_k_dz")
dz["max"] = 1000
dz["vorgabe"] = A._vlog(375, 20, 1000)
nimm(fx)
E[:] = [e for e in E if e["nach"] != "aus.x"]
A.kante(g, fx["l"], "aus.l")
A.kante(g, fx["r"], "aus.r")

for nr in range(33, 61):
    if nr != 58:
        assert str(nr) in namen, nr
g["regler_namen"].update(namen)

out = ['{', '  "format": "baukasten/2",', f'  "name": "{g["name"]}",', f'  "stimmen": {g["stimmen"]},']
items = [f'"{k}": "{v}"' for k, v in sorted(g["regler_namen"].items(), key=lambda kv: int(kv[0]))]
lines = [", ".join(items[i:i + 6]) for i in range(0, len(items), 6)]
out.append('  "regler_namen": {' + (",\n                   ".join(lines)) + '},')
out.append('  "knoten": [')
out.append(",\n".join("    " + json.dumps(n, ensure_ascii=False) for n in K))
out.append('  ],')
out.append('  "kanten": [')
out.append(",\n".join("    " + json.dumps(e, ensure_ascii=False) for e in E))
out.append('  ]')
out.append('}')
PFAD.write_text("\n".join(out) + "\n")
print(f"synth-mono: {len(K)} nodes, {len(E)} edges")
