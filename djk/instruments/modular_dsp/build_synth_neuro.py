#!/usr/bin/env python3
"""Generator for demos/synth-neuro.json (the neuro / reese bass). The graph is too wide to keep by hand (about 110 nodes);
this script is its source. Run: python3 build_synth_neuro.py [out.json]; defaults write beispiele/synth-neuro.json.

Signal flow (one voice, mono legato bass):
  note -> glide (3-way morph) -> hz
  OSC   wavetable unison (3 copies, wave morph tri..saw..square), FM from a sine modulator (audio-rate hz modulation),
        ring modulation morph with the same modulator
  DIRT  falter (wavefolder, tri..sine) -> saett (tanh drive)
  FILTER one of seven moving filters over `wahl` (comb, notch, band-pass, ladder LP, vowel, MS-20 LP, diode LP)
  MOTION cutoff = position * 2^(depth * (env * a + lfo * b + s&h * c) / 12): 3 decays (mseg), tempo-synced LFO with 7
         divisions and 3 shapes, sample and hold clocked by the LFO
  OUT   amp ADSR, crossover high-pass (24 dB) for the dirt path, band limit, chorus width, soft ceiling (tanh);
        the sine sub bypasses everything non-linear and stays mono
"""
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
import ausbau as ab

# ---- tunables (measured, see the report) -------------------------------------------------------------------------
OSC_PEGEL = 0.6        # unison sum -> fold input
RING_GAIN = 1.4        # ring product -> level of the dry saw
CEIL_A_DB = -8.0       # drive into the output tanh (small-signal gain A * C)
CEIL_C = 0.60          # output ceiling of the dirt path
SUB_MAX = 0.35         # sub amplitude at knob 1
PEGEL = {              # per-type level match of the seven filters (all measured on the default dirt)
    "comb": 0.69, "notch": 0.83, "bp": 2.07, "ladder": 2.0, "formant": 0.51, "ms20": 0.64, "diode": 1.53,
}
RATES = [8, 4, 2, 1, 0.5, 0.25, 0.125]     # LFO beats per cycle; knob 3 middle = 1 beat
TYPEN = ["comb", "notch", "bp", "ladder", "formant", "ms20", "diode"]  # knob 7 middle = ladder low-pass

knoten, kanten, namen = [], [], {}


def n(id, art, **w):
    knoten.append({"id": id, "art": art, **w})


def e(von, nach, verz=0):
    k = {"von": von, "nach": nach}
    if verz:
        k["verzoegerung"] = verz
    kanten.append(k)


def knob(id, nr, lo, hi, log=0, name=None):
    k = {"id": id, "art": "regler", "nr": nr, "min": lo, "max": hi}
    if log:
        k["log"] = 1
    knoten.append(k)
    if name:
        namen[str(nr)] = name


# ---- knobs -------------------------------------------------------------------------------------------------------
knob("k_pos", 1, 70, 7000, 1, "Cutoff")
knob("k_vok", 1, 0, 4)
knob("k_depth", 2, 0, 72, 0, "Depth")
knob("k_depth_v", 2, 0, 3)
knob("k_rate", 3, 0, 1, 0, "Rate")
knob("k_fold", 4, -6, 30, 0, "Fold")
knob("k_drive", 5, -6, 24, 0, "Drive")
knob("k_det", 6, 0, 50, 0, "Detune")
knob("k_typ", 7, 0, 1, 0, "Type")
knob("k_sub", 8, 0, SUB_MAX, 0, "Sub")
knob("k_reso", 9, 0, 0.9, 0, "Resonance")
knob("k_q", 9, 0, 1)
knob("k_fb", 9, 0, 0.9)
knob("k_env", 10, 0, 1, 0, "Env Amt")
knob("k_lfo", 11, 0, 1.2, 0, "LFO Amt")
knob("k_sh", 12, 0, 0.4, 0, "S&H Amt")
knob("k_shape", 13, 0, 1, 0, "LFO Shape")
knob("k_decay", 14, 0, 1, 0, "Env Decay")
knob("k_fm", 15, 0, 1, 0, "FM Amt")
knob("k_ratio", 16, -12, 36, 0, "FM Ratio")
knob("k_ring", 17, 0, 0.6, 0, "Ring")
knob("k_sym", 18, -0.5, 0.5, 0, "Fold Sym")
knob("k_form", 19, 0, 1, 0, "Fold Shape")
knob("k_split", 20, 60, 200, 1, "Crossover")
knob("k_width", 21, 0, 0.7, 0, "Width")
knob("k_rel", 22, 0.03, 1.0, 1, "Release")
knob("k_glide", 23, 0, 1, 0, "Glide")
knob("k_wave", 24, 0.3333, 1.0, 0, "Wave")

n("note", "note")

# ---- fresh-note trigger: a strike while the previous gate was low. Phase resets (unison, modulator, sub) use it, so a
# legato note (new strike while one is held) keeps every phase and cannot click ---------------------------------------
n("g_prev", "mul", b=-1)
n("g_inv", "add", a=1)
n("fresh", "mul")
e("note.gate", "g_prev.a", 1)
e("g_prev.aus", "g_inv.b"); e("note.trig", "fresh.a"); e("g_inv.aus", "fresh.b")
FRESH = "fresh.aus"

# ---- glide: 0 = none, middle = 20 ms, top = 100 ms (time constants), morph between ---------------------------------
n("gl1", "glatt", zeit=0.02)
n("gl2", "glatt", zeit=0.10)
n("w_gl", "wahl", n=3, modus=1, norm=1)
e("note.hz", "gl1.x"); e("note.erste", "gl1.setzen")
e("note.hz", "gl2.x"); e("note.erste", "gl2.setzen")
e("note.hz", "w_gl.e1"); e("gl1.aus", "w_gl.e2"); e("gl2.aus", "w_gl.e3")
e("k_glide.aus", "w_gl.wahl")
HZ = "w_gl.aus"

# ---- modulator sine (FM and ring) ----------------------------------------------------------------------------------
n("m_hz", "transponiere")
n("mod", "sinus")
e(HZ, "m_hz.hz"); e("k_ratio.aus", "m_hz.st")
e("m_hz.aus", "mod.hz"); e(FRESH, "mod.sync")
n("fm_a", "mul"); n("fm_b", "mul"); n("hz_fm", "add")
e("mod.aus", "fm_a.a"); e("k_fm.aus", "fm_a.b")
e("fm_a.aus", "fm_b.a"); e(HZ, "fm_b.b")
e(HZ, "hz_fm.a"); e("fm_b.aus", "hz_fm.b")

# ---- oscillator: unison on the analog table (sine, tri, saw, square), position from knob 24 ------------------------------
n("osc", "wavetable", tabelle=4, kopien=3, zufall=1, saat=7, glatt=10, breite=0)
n("osc_p", "mul", b=OSC_PEGEL)
e("hz_fm.aus", "osc.hz"); e(FRESH, "osc.trig"); e("k_det.aus", "osc.verstimmung"); e("k_wave.aus", "osc.pos")
e("osc.aus", "osc_p.a")
n("ring_p", "mul"); n("ring_g", "mul", b=RING_GAIN)
e("osc_p.aus", "ring_p.a"); e("mod.aus", "ring_p.b"); e("ring_p.aus", "ring_g.a")
n("w_ring", "wahl", n=2, modus=1, norm=1)
e("osc_p.aus", "w_ring.e1"); e("ring_g.aus", "w_ring.e2"); e("k_ring.aus", "w_ring.wahl")

# ---- dirt ---------------------------------------------------------------------------------------------------------
n("fold", "falter", ueber=1)
e("w_ring.aus", "fold.x"); e("k_fold.aus", "fold.antrieb"); e("k_sym.aus", "fold.symmetrie"); e("k_form.aus", "fold.form")
n("sat", "saett")
e("fold.aus", "sat.x"); e("k_drive.aus", "sat.antrieb")
X = "sat.aus"

# ---- motion --------------------------------------------------------------------------------------------------------
# envelope: three decays, morph
for tag, d in (("s", 0.08), ("m", 0.25), ("l", 0.8)):
    n(f"env_{tag}", "mseg", stufen=4, halt=3,
      p1=1, t1=0.004, k1=0, p2=0.35, t2=d, k2=-0.6, p3=0.2, t3=d, k3=0, p4=0, t4=0.2, k4=0)
    e("note.gate", f"env_{tag}.gate"); e("note.trig", f"env_{tag}.trig")
n("w_env", "wahl", n=3, modus=1, norm=1)
e("env_s.aus", "w_env.e1"); e("env_m.aus", "w_env.e2"); e("env_l.aus", "w_env.e3"); e("k_decay.aus", "w_env.wahl")
n("env_a", "mul")
e("w_env.aus", "env_a.a"); e("k_env.aus", "env_a.b")
# lfo: triangle at seven divisions, rate chosen by knob 3
for i, t in enumerate(RATES):
    n(f"lfo{i}", "lfo", form=1, takt=t)
n("w_rate", "wahl", n=len(RATES), blende=5)
for i in range(len(RATES)):
    e(f"lfo{i}.aus", f"w_rate.e{i + 1}")
e("k_rate.aus", "w_rate.wahl")
# shape: square (hard tanh of the triangle) | triangle | sine (sine fold of the triangle is exactly a sine)
n("sq", "saett", antrieb=30)
n("sn", "falter", form=1, ueber=0)
n("w_shape", "wahl", n=3, modus=1, norm=1)
e("w_rate.aus", "sq.x"); e("w_rate.aus", "sn.x")
e("sq.aus", "w_shape.e1"); e("w_rate.aus", "w_shape.e2"); e("sn.aus", "w_shape.e3"); e("k_shape.aus", "w_shape.wahl")
n("lfo_a", "mul")
e("w_shape.aus", "lfo_a.a"); e("k_lfo.aus", "lfo_a.b")
# sample and hold on the LFO's own clock: a hard square from the same triangle gives one rising edge per cycle
n("clk", "saett", antrieb=40)
n("hold", "sh", glatt=20)
e("w_rate.aus", "clk.x"); e("clk.aus", "hold.trig")
n("sh_a", "mul")
e("hold.aus", "sh_a.a"); e("k_sh.aus", "sh_a.b")
# sum and depth
n("m_sum", "add")
e("env_a.aus", "m_sum.a"); e("lfo_a.aus", "m_sum.b"); e("sh_a.aus", "m_sum.c")
n("m_st", "mul")
e("m_sum.aus", "m_st.a"); e("k_depth.aus", "m_st.b")
n("cut", "transponiere"); e("k_pos.aus", "cut.hz"); e("m_st.aus", "cut.st")
n("st_d", "add", b=24); n("cut_d", "transponiere")
e("m_st.aus", "st_d.a"); e("k_pos.aus", "cut_d.hz"); e("st_d.aus", "cut_d.st")
n("m_v", "mul"); n("vok", "add")
e("m_sum.aus", "m_v.a"); e("k_depth_v.aus", "m_v.b"); e("k_vok.aus", "vok.a"); e("m_v.aus", "vok.b")

# ---- the seven filters ----------------------------------------------------------------------------------------------
n("f_ka", "kamm", daempf=0.3)
e(X, "f_ka.x"); e("cut.aus", "f_ka.hz"); e("k_fb.aus", "f_ka.fb")
n("f_ka_p", "mul", b=PEGEL["comb"]); e("f_ka.aus", "f_ka_p.a")
n("f_no", "sem", form=0.5)
e(X, "f_no.x"); e("cut.aus", "f_no.cutoff"); e("k_reso.aus", "f_no.reso")
n("f_no_p", "mul", b=PEGEL["notch"]); e("f_no.aus", "f_no_p.a")
n("f_bp", "sem", form=0)
e(X, "f_bp.x"); e("cut.aus", "f_bp.cutoff"); e("k_reso.aus", "f_bp.reso")
n("f_bp_p", "mul", b=PEGEL["bp"]); e("f_bp.bp", "f_bp_p.a")
n("f_ld", "ladder")
e(X, "f_ld.x"); e("cut.aus", "f_ld.cutoff"); e("k_reso.aus", "f_ld.reso")
n("f_ld_p", "mul", b=PEGEL["ladder"]); e("f_ld.aus", "f_ld_p.a")
n("f_fo", "formant")
e(X, "f_fo.x"); e("vok.aus", "f_fo.vokal"); e("k_q.aus", "f_fo.q")
n("f_fo_p", "mul", b=PEGEL["formant"]); e("f_fo.aus", "f_fo_p.a")
n("f_ms", "ms20", modus=1, antrieb=0.3)
e(X, "f_ms.x"); e("cut.aus", "f_ms.cutoff"); e("k_reso.aus", "f_ms.reso")
n("f_ms_p", "mul", b=PEGEL["ms20"]); e("f_ms.tp", "f_ms_p.a")
n("f_di", "diode", antrieb=6, bass=0.3)
e(X, "f_di.x"); e("cut_d.aus", "f_di.cutoff"); e("k_reso.aus", "f_di.reso")
n("f_di_p", "mul", b=PEGEL["diode"]); e("f_di.aus", "f_di_p.a")
n("w_typ", "wahl", n=7)
for i, t in enumerate(TYPEN):
    src = {"comb": "f_ka_p", "notch": "f_no_p", "bp": "f_bp_p", "ladder": "f_ld_p", "formant": "f_fo_p", "ms20": "f_ms_p", "diode": "f_di_p"}[t]
    e(f"{src}.aus", f"w_typ.e{i + 1}")
e("k_typ.aus", "w_typ.wahl")

# ---- amp, crossover, output ------------------------------------------------------------------------------------------
n("env", "adsr", a=0.002, d=0.3, s=0.85, r=0.15)
e("note.gate", "env.gate"); e("note.trig", "env.trig"); e("k_rel.aus", "env.r")
n("vca", "mul"); e("w_typ.aus", "vca.a"); e("env.aus", "vca.b")
n("xo", "svf", pole=4, reso=0)
e("vca.aus", "xo.x"); e("k_split.aus", "xo.cutoff")
n("bl", "svf", pole=2, cutoff=14000, reso=0)
e("xo.hp", "bl.x")
# width: the chorus sees only the band above twice the crossover (a 12 dB high-pass); what lies below it is added to both
# sides dry, so everything under about 100 Hz stays exactly mono: low = mid - high
n("split2", "transponiere", st=12); n("w_hi", "svf", pole=2, reso=0)
n("hi_neg", "mul", b=-1); n("low", "add")
e("k_split.aus", "split2.hz"); e("split2.aus", "w_hi.cutoff")
n("ch", "chorus", modus=1)
e("bl.tp", "w_hi.x"); e("w_hi.hp", "ch.x"); e("k_width.aus", "ch.mix")
e("w_hi.hp", "hi_neg.a"); e("bl.tp", "low.a"); e("hi_neg.aus", "low.b")
for s in ("l", "r"):
    n(f"ce_in_{s}", "add")
    e(f"ch.{s}", f"ce_in_{s}.a"); e("low.aus", f"ce_in_{s}.b")
    n(f"ce_{s}", "saett", antrieb=CEIL_A_DB)
    n(f"ce_{s}_p", "mul", b=CEIL_C)
    e(f"ce_in_{s}.aus", f"ce_{s}.x"); e(f"ce_{s}.aus", f"ce_{s}_p.a")
# sub: sine at the (glided) note pitch, phase-locked to the strike, under the same amp envelope; never touches the dirt
n("sub", "sinus")
e(HZ, "sub.hz"); e(FRESH, "sub.sync")
n("sub_e", "mul"); n("sub_l", "mul")
e("sub.aus", "sub_e.a"); e("env.aus", "sub_e.b")
e("sub_e.aus", "sub_l.a"); e("k_sub.aus", "sub_l.b")
n("aus", "ausgang")
e("ce_l_p.aus", "aus.l"); e("ce_r_p.aus", "aus.r"); e("sub_l.aus", "aus.x")


# ======================================================================================================================
# Synth build-out (knobs 25..45, appended; 1..24 never change). Every new knob is class G (exactly 0 effect at its default),
# N (the old value at its default through `mitte`) or F (free, only audible through a G knob), see ausbau.py.
# ======================================================================================================================
G = {"knoten": knoten, "kanten": kanten}


def namen_von(r):
    for nr, name in r["namen"].items():
        namen[str(nr)] = name


# ---- MASTER TUNE (40): +-100 ct on the glided pitch, so oscillators, modulator and sub follow ------------------------------
tune = ab.stimmung(G, "tune", 40, HZ)
ab.umhaengen(G, HZ, tune["aus"], ausser=("tune_hz.hz",))
tune["namen"] = {40: "Master tune"}
namen_von(tune)
HZT = tune["aus"]

# ---- AMP ENV (25..27): the old fixed A 2 ms, D 300 ms, S 85 % are the `mitte` values -------------------------------------------
# The attack knob is in milliseconds (a 2 ms attack must read "2 ms" on the panel, not "0.00 s"): knob (ms, `mitte` 2) x 0.001 -> env.a.
# 2.0 * f32(0.001) is exactly f32(0.002) (a power-of-two scaling), the null test proves it.
at = ab._Info()
at_k = ab._n_mitte(G, at, "env_a_k", 25, "Amp attack", 0.5, 5000, 2.0, log=True)
ab.kante(G, ab.mul(G, "env_a_s", at_k, 0.001), "env.a")
namen_von(at.ergebnis())
amp_env = ab.huellen_zeit(G, "env", decay=(26, 0.3), sustain=(27, 0.85))
amp_env["namen"] = {26: "Amp decay", 27: "Amp sustain"}
namen_von(amp_env)

# ---- OSC 2 (28..31): one simple oscillator (sine, triangle, saw, square), phase-locked to the strike, mixed in before the fold.
# A minimal form of ausbau.osc2 tier B (that helper always builds semitone, sync and ring knobs; this synth keeps four) --------
o2 = ab._Info()
o2_lv = ab._g_uni(G, o2, "o2_k_lv", 28, "Osc2 level", OSC_PEGEL)
o2_wave = ab._wahl_knopf(G, o2, "o2_k_wave", 29, "Osc2 wave", 4, 2)
o2_okt = ab._wahl_knopf(G, o2, "o2_k_okt", 30, "Osc2 octave", 5, 2)
o2.neu(31, "Osc2 detune", 0.5, "F")
o2_det = ab.regler(G, "o2_k_det", 31, -50, 50, vorgabe=0.5)
o2_cent = ab.add(G, "o2_cent", ab._wahl(G, "o2_okt", 5, [], o2_okt, **{f"e{i + 1}": -2400 + 1200 * i for i in range(5)}), o2_det)
ab.knoten(G, "o2_hz", "transponiere")
ab.kante(G, HZT, "o2_hz.hz"); ab.kante(G, o2_cent, "o2_hz.cent")
for art in ("sinus", "dreieck", "saege", "puls"):
    ab.knoten(G, f"o2_{art}", art)
    ab.kante(G, "o2_hz.aus", f"o2_{art}.hz"); ab.kante(G, FRESH, f"o2_{art}.sync")
o2_w = ab._wahl(G, "o2_wave", 4, [f"o2_{a}.aus" for a in ("sinus", "dreieck", "saege", "puls")], o2_wave)
ab.einspeisen(G, "o2_in", "fold.x", ab.mul(G, "o2_out", o2_w, o2_lv))
namen_von(o2.ergebnis())

# ---- VELOCITY (38): the old graph ignores the velocity, so there is no old path to scale: a class G depth knob, 0 = as before,
# 1 = gain follows the velocity (gain = 1 + depth * (vel - 1)); it joins the amp envelope with the LFO 2 amp target -------------
vi = ab._Info()
vel_k = ab._g_uni(G, vi, "vel_k", 38, "Velocity depth", 1.0)
ab.add(G, "vel_m1", "note.vel", -1)
ab.add(G, "vel_g", 1, ab.mul(G, "vel_d", "vel_m1.aus", vel_k))
namen_von(vi.ergebnis())
ab.add(G, "tr_g", 1)                                    # 1 + the LFO 2 amp term (joined below)
ab.mul(G, "amp_gain", "tr_g.aus", "vel_g.aus")
ab.mul(G, "env_t", "env.aus", "amp_gain.aus")
ab.umhaengen(G, "env.aus", "env_t.aus", ausser=("env_t.a",))   # vca and sub read the shaped envelope

# ---- LFO 2 (32..36): five targets. Cutoff, fold and drive in the units of their old knobs (semitones, dB), pitch in cents, amp as
# a gain offset around 1. The cutoff term joins the semitone sum m_st that the six cutoff filters read (the vowel filter has its own position input and ignores it) --------------------------------
lfo = ab.lfo2(G, "l2", 32, ziele=[
    ("m_st.aus", 36, "aus"),               # cutoff: +-36 semitones at full amount
    ("fold.antrieb", 18),                  # fold: +-18 dB
    ("tune_hz.cent", 600),                 # pitch: +-6 semitones
    ("sat.antrieb", 18),                   # drive: +-18 dB
    ("tr_g.b", 0.5),                       # amp: gain 1 +- 0.5
])
namen_von(lfo)
cut_tip = "l2_z_zin0.aus"                  # the cutoff semitone sum after the LFO 2 term

# ---- FILTER key follow (37) and velocity to cutoff (39) on the same sum ------------------------------------------------------
kf = ab.schluesselfolge(G, "kf", 37, HZT, cut_tip)
namen_von(kf)
vc = ab.vel_zu_cutoff(G, "vc", 39, "note.vel", kf["aus"], skala=36)
namen_von(vc)

# ---- DELAY (41..43) and REVERB (45; 44 stays free: one fixed 2.2 s hall, no decay knob). The sub stays dry on `aus.x` ------------
fx = ab.fx_ende(G, "fx", 41, ("lr", "ce_l_p.aus", "ce_r_p.aus"), abschnitte=("delay", "hall"), nrs={"hall_mix": 45},
                pingpong=False, hall_stufen=(2.2,))
namen_von(fx)
for k in kanten:
    if k["nach"] == "aus.l":
        k["von"] = fx["l"]
    elif k["nach"] == "aus.r":
        k["von"] = fx["r"]


def graph():
    return {"format": "baukasten/2", "name": "synth-neuro", "stimmen": 1,
            "regler_namen": dict(sorted(namen.items(), key=lambda kv: int(kv[0]))),
            "knoten": knoten, "kanten": kanten}


def schreibe(pfad):
    # one node or edge per line keeps diffs readable
    g = graph()
    z = ['{', '  "format": "baukasten/2",', '  "name": "synth-neuro",', '  "stimmen": 1,',
         '  "regler_namen": ' + json.dumps(g["regler_namen"], ensure_ascii=False) + ',', '  "knoten": [']
    z += ["    " + json.dumps(k, ensure_ascii=False) + ("," if i < len(knoten) - 1 else "") for i, k in enumerate(knoten)]
    z += ['  ],', '  "kanten": [']
    z += ["    " + json.dumps(k, ensure_ascii=False) + ("," if i < len(kanten) - 1 else "") for i, k in enumerate(kanten)]
    z += ['  ]', '}', '']
    open(pfad, "w").write("\n".join(z))


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HIER, "demos", "synth-neuro.json")
    schreibe(out)
    print(out, len(knoten), "nodes", len(kanten), "edges")
