#!/usr/bin/env python3
"""Generates the Baukasten device `synth-poly` (graph + front panel).

    python3 build_synth_poly.py            # writes demos/synth-poly.json (the panel paneele/synth-poly.json is a hand file)

Why a script: the graph has several hundred nodes; one table here keeps the knob numbers and names in one place.
The device is described in docs/presets/geraete/GERAET-synth-poly.md.

Signal flow per voice (stereo from the oscillator on):

    note.hz --vibrato--> osc_hz --> unison (centre saw + three detuned pairs, JP-8000 spacing) + pulse + sub + noise
        --> Juno-style high-pass --> filter (ladder | SEM | diode, `wahl`) --> VCA (amp ADSR, velocity) --> soft limit
    all voices --> chorus (I | II | I+II) on the mid signal, dry stereo kept --> out

No new block: `wavetable` (type 32) already gives the unison. See the report for why.
"""
import json
import math
import pathlib

HIER = pathlib.Path(__file__).resolve().parent

# ---- tuning constants (measured, see GERAET-synth-poly.md) -----------------------------------------------------------------
JP_RATIOS = (1.0, 0.5716, 0.1774)       # outer, middle, inner pair detune relative to the outer one (Szabo's JP-8000 analysis: 0.1100 : 0.0629 : 0.0195)
PAN_RATIOS = (1.0, 0.6, 0.2)            # stereo spread of the pairs relative to the Width knob (linear spread of 6 copies: 1, 0.6, 0.2)
SIDE_ANCHORS = (0.0444, 0.3193, 0.5020, 0.5925, 0.5908)   # JP-8000 side level at mix 0, 0.25, 0.5, 0.75, 1 (-0.73764 m^2 + 1.2841 m + 0.044372)
CENTRE_MIX = (0.99785, 0.44419)         # JP-8000 centre level at mix 0 and 1 (-0.55366 m + 0.99785)
OSC_PEGEL = 0.5                         # oscillator level into the filters: the ladder and diode saturate their input, a hot input aliases
PEGEL = 0.40                            # master level before the soft limit
LIMIT = 5.0                             # soft limit per voice: tanh(LIMIT x) / LIMIT, ceiling 1 / LIMIT, so four voices stay below 1.0 before the chorus
CHORUS_DAEMPFUNG = 0.45                 # the chorus adds its wet on top of the dry: the dry level falls by this much at Chorus 1
GAIN_LADDER = 1.58                      # output trim of the ladder, so its level meets the SEM at the default
GAIN_DIODE = 1.55                       # output trim of the diode ladder (it loses bass with resonance)
DIODE_ST = 12                           # semitones: the diode peak sits at `cutoff`, its corner a tenth below, so shift it up to match the others
DIODE_BASS = 0.5                        # share of the resonance bass loss given back
DRIFT_CENT = 6.0                        # Drift knob at 1: oscillator pitch deviation per voice, +-cent
DRIFT_CUT = 12 * math.log2(1.08)          # Drift knob at 1: cutoff deviation per voice, +-8 % (12 * log2(1.08) semitones)
DRIFT_ENV = 0.10                        # Drift knob at 1: envelope times per voice, +-10 %
DRIFT_PW = 0.08                         # Drift knob at 1: pulse width per voice, +-0.08
STIMMEN = 8                             # voices: the graph runs all of them all the time, see the cost table in GERAET-synth-poly.md

K = []   # nodes
E = []   # edges


def node(id, art, **werte):
    K.append({"id": id, "art": art, **werte})
    return id


def edge(von, nach):
    E.append({"von": von, "nach": nach})


def regler(id, nr, lo, hi, log=False, vorgabe=None):
    node(id, "regler", nr=nr, min=lo, max=hi, **({"log": 1} if log else {}), **({"vorgabe": vorgabe} if vorgabe is not None else {}))
    return f"{id}.aus"


def mul(id, a, b=None, **w):
    """Product node: a and b are ports (strings) or numbers (fixed value)."""
    node(id, "mul", **({"b": b} if isinstance(b, (int, float)) else {}), **w)
    edge(a, f"{id}.a")
    if isinstance(b, str):
        edge(b, f"{id}.b")
    return f"{id}.aus"


def add(id, *quellen, **w):
    node(id, "add", **w)
    for p, q in zip("abcd", quellen):
        if isinstance(q, str):
            edge(q, f"{id}.{p}")
        else:
            K[-1][p] = q
    return f"{id}.aus"


NAMEN = {}


def name(nr, text):
    NAMEN[str(nr)] = text


# ---- knobs -----------------------------------------------------------------------------------------------------------------
# 1..8: the eight that matter on a controller; 9..27: fine tuning. The first regler node of a number is the one the panel reads.
name(1, "Cutoff");        cut = regler("k_cutoff", 1, 30, 12000, log=True)
name(2, "Resonance");     reso = regler("k_reso", 2, 0, 0.88)
name(3, "Env amount");    envamt = regler("k_env", 3, 0, 60)
name(4, "Detune")
det_a = regler("k_det_a", 4, 0, 1)
det_b = regler("k_det_b", 4, 0, 50)
name(5, "Attack");        att = regler("k_att", 5, 0.003, 3, log=True)
name(6, "Release");       rel = regler("k_rel", 6, 0.03, 6, log=True)
name(7, "Chorus");        chor = regler("k_chorus", 7, 0, 1)
chor_g = regler("k_chorus_g", 7, 1, 1 - CHORUS_DAEMPFUNG)
name(8, "Filter type");   typ = regler("k_typ", 8, 0, 1)

name(9, "Unison voices"); voices = regler("k_voices", 9, 0, 1)
name(10, "Unison mix")
mix_s = regler("k_mix_s", 10, 0, 1)
mix_c = regler("k_mix_c", 10, CENTRE_MIX[0], CENTRE_MIX[1])
name(11, "Width");        width = regler("k_width", 11, 0, 1)
name(12, "Pulse level");  pulse_lv = regler("k_pulse", 12, 0, 0.7)
name(13, "Pulse width");  pw = regler("k_pw", 13, -0.8, 0.8)
name(14, "Sub level");    sub_lv = regler("k_sub", 14, 0, 0.5)
name(15, "Noise")
noi_a = regler("k_noi_a", 15, 0, 1)
noi_b = regler("k_noi_b", 15, 0, 0.25)
name(16, "HP cutoff");    hp = regler("k_hp", 16, 8, 600, log=True)
name(17, "Filter colour")
col = regler("k_col", 17, 0, 1)
drive_l = regler("k_drive_l", 17, 0.6, 3)
drive_d = regler("k_drive_d", 17, -6, 12)
name(18, "Key follow");   kf = regler("k_kf", 18, 0, 4)
name(19, "Decay");        adec = regler("k_adec", 19, 0.1, 10, log=True)
name(20, "Sustain");      asus = regler("k_asus", 20, 0, 1)
name(21, "Filter decay"); fdec = regler("k_fdec", 21, 0.05, 6, log=True)
name(22, "Filter sustain"); fsus = regler("k_fsus", 22, 0, 1)
name(23, "LFO rate");     lrate = regler("k_lrate", 23, 0.05, 20, log=True)
name(24, "LFO to cutoff")
lc_a = regler("k_lc_a", 24, 0, 1)
lc_b = regler("k_lc_b", 24, 0, 12)
name(25, "LFO to PWM");   lpwm = regler("k_lpwm", 25, 0, 0.6)
name(26, "LFO to pitch")
lp_a = regler("k_lp_a", 26, 0, 1)
lp_b = regler("k_lp_b", 26, 0, 1)
lp_c = regler("k_lp_c", 26, 0, 40)
name(27, "Chorus mode");  cmode = regler("k_cmode", 27, 0, 1)
name(28, "Drift");        drift_amt = regler("k_drift", 28, 0, 1, vorgabe=0.25)   # 0 = exactly the sound before the knob existed

# ---- voice: note, LFO, vibrato -----------------------------------------------------------------------------------------------
node("note", "note")
node("lfo", "lfo", form=0)
# Per-voice analog drift (block `drift`): one source per destination, so pitch, cutoff, envelope time and pulse width wander
# independently. A constant share (fest) is the unit-to-unit spread, the slow wander is the temperature drift.
for nm, saat, fest in (("d_pitch", 21, 0.4), ("d_cut", 22, 0.4), ("d_env", 23, 0.7), ("d_pw", 24, 0.4)):
    node(nm, "drift", rate=0.3, fest=fest, saat=saat)
dr_pitch = mul("dr_pitch", mul("dr_pitch_a", "d_pitch.aus", drift_amt), DRIFT_CENT)
dr_cut = mul("dr_cut", mul("dr_cut_a", "d_cut.aus", drift_amt), DRIFT_CUT)
dr_pw = mul("dr_pw", mul("dr_pw_a", "d_pw.aus", drift_amt), DRIFT_PW)
env_f = add("env_f", 1.0, mul("dr_env", mul("dr_env_a", "d_env.aus", drift_amt), DRIFT_ENV))   # factor on every envelope time
att_f = mul("att_f", att, env_f)
rel_f = mul("rel_f", rel, env_f)
adec_f = mul("adec_f", adec, env_f)
fdec_f = mul("fdec_f", fdec, env_f)
edge(lrate, "lfo.rate")
vib1 = mul("vib_1", lp_a, lp_b)
vib = mul("vib", "vib_1.aus", lp_c)               # cubic: k^3 * 40 cent
vibr = mul("vibrato", "lfo.aus", vib)
node("osc_hz", "transponiere")
edge("note.hz", "osc_hz.hz")
edge(add("pitch_cent", vibr, dr_pitch), "osc_hz.cent")
node("sub_hz", "transponiere", st=-12)
edge("osc_hz.aus", "sub_hz.hz")

# ---- oscillators -------------------------------------------------------------------------------------------------------------
# Unison: centre saw + three pairs (kopien 2 = one copy at -x, one at +x). The outer pair gets the Detune value in cent, the middle
# and inner pairs 0.5716 and 0.1774 of it: the JP-8000 spacing. All 7 copies cost the same as one `wavetable` with kopien 7.
node("uc", "wavetable", tabelle=0, kopien=1, saat=11)
for nm, saat in (("u1", 14), ("u2", 12), ("u3", 13)):
    node(nm, "wavetable", tabelle=0, kopien=2, saat=saat)
for nm in ("uc", "u1", "u2", "u3"):
    edge("osc_hz.aus", f"{nm}.hz")
    edge("note.trig", f"{nm}.trig")
det = mul("det_ab", det_a, det_b)                 # squared: k^2 * 50 cent
edge(det, "u1.verstimmung")
edge(mul("det_2", det, JP_RATIOS[1]), "u2.verstimmung")
edge(mul("det_3", det, JP_RATIOS[2]), "u3.verstimmung")
edge(width, "u1.breite")
edge(mul("wid_2", width, PAN_RATIOS[1]), "u2.breite")
edge(mul("wid_3", width, PAN_RATIOS[2]), "u3.breite")

# Gains: JP-8000 centre/side curves; the pairs are gated by the Voices selector (3 / 5 / 7 saws), smoothed so a switch does not click.
node("seiten", "wahl", n=5, modus=1, **{f"e{i + 1}": v for i, v in enumerate(SIDE_ANCHORS)})
edge(mix_s, "seiten.wahl")
side = mul("seiten_g", "seiten.aus", 2 ** 0.5)    # a pair node already carries 1/sqrt(2) per copy
node("v2", "wahl", n=3, modus=1, e1=0, e2=1, e3=1)
node("v1", "wahl", n=3, modus=1, e1=0, e2=0, e3=1)
edge(voices, "v2.wahl")
edge(voices, "v1.wahl")
node("v2_glatt", "glatt", zeit=0.03)
node("v1_glatt", "glatt", zeit=0.03)
edge("v2.aus", "v2_glatt.x")
edge("v1.aus", "v1_glatt.x")
g3 = side
g2 = mul("g_2", side, "v2_glatt.aus")
g1 = mul("g_1", side, "v1_glatt.aus")
centre = mul("centre", "uc.aus", mix_c)

node("puls", "puls")
edge("osc_hz.aus", "puls.hz")
edge(add("pwm", pw, mul("pwm_lfo", "lfo.aus", lpwm), dr_pw), "puls.pwm")
node("sub", "puls")
edge("sub_hz.aus", "sub.hz")
node("rauschen", "rauschen")
noise_amt = mul("noise_k", noi_a, noi_b)          # squared: k^2 * 0.25
noise = mul("noise_g", "rauschen.aus", noise_amt)
pulse_t = mul("pulse_g", "puls.aus", pulse_lv)
sub_t = mul("sub_g", "sub.aus", sub_lv)
mono = add("mono", centre, pulse_t, sub_t, noise)

lanes = {}
for s, pin in (("l", "l"), ("r", "r")):
    a3 = mul(f"a3_{s}", f"u3.{pin}", g3)
    a2 = mul(f"a2_{s}", f"u2.{pin}", g2)
    a1 = mul(f"a1_{s}", f"u1.{pin}", g1)
    lanes[s] = add(f"osc_{s}", mono, a3, a2, a1)

# ---- filter ------------------------------------------------------------------------------------------------------------------
# cutoff = (Cutoff + KeyFollow * note Hz) transposed by (filter env * Env amount + LFO * depth) semitones
kf_hz = mul("kf_hz", "note.hz", kf)
base = add("cut_base", cut, kf_hz)
node("fenv", "adsr", a=0.01, d=0.3, s=0.5, r=0.3)
node("aenv", "adsr", a=0.01, d=0.3, s=0.5, r=0.3)
for nm, d_, s_ in (("fenv", fdec_f, fsus), ("aenv", adec_f, asus)):
    edge("note.gate", f"{nm}.gate")
    edge("note.trig", f"{nm}.trig")
    edge(att_f, f"{nm}.a")
    edge(d_, f"{nm}.d")
    edge(s_, f"{nm}.s")
    edge(rel_f, f"{nm}.r")
lfo_cut = mul("lfo_cut", "lfo.aus", mul("lc", lc_a, lc_b))   # squared: k^2 * 12 semitones
st = add("cut_st", mul("env_st", "fenv.aus", envamt), lfo_cut, dr_cut)
node("cutoff", "transponiere")
edge(base, "cutoff.hz")
edge(st, "cutoff.st")
node("cutoff_d", "transponiere")                  # the diode gets the same modulation, shifted up
edge(base, "cutoff_d.hz")
edge(add("cut_st_d", st, DIODE_ST), "cutoff_d.st")

# SEM form: the lower half of the Colour knob is a pure low-pass (form 0, a leaking high-pass would keep the filter from closing),
# the upper half sweeps low-pass -> notch (0.75) -> high-pass (1)
node("form", "wahl", n=3, modus=1, e1=0, e2=0, e3=1)
edge(col, "form.wahl")
form = "form.aus"

# velocity: 0.4 + 0.6 * vel; amplitude = amp env * velocity
vel = add("vel_g", 0.4, mul("vel_k", "note.vel", 0.6))
amp = mul("amp", "aenv.aus", vel)

mul("pegel", chor_g, PEGEL * LIMIT)
pre = {}
for s in ("l", "r"):
    node(f"hp_{s}", "svf")
    edge(mul(f"osc_g_{s}", lanes[s], OSC_PEGEL), f"hp_{s}.x")
    edge(hp, f"hp_{s}.cutoff")
    x = f"hp_{s}.hp"
    # ladder: drive on the input (tanh stage), trim after
    node(f"lad_{s}", "ladder")
    edge(mul(f"lad_in_{s}", x, drive_l), f"lad_{s}.x")
    edge("cutoff.aus", f"lad_{s}.cutoff")
    edge(reso, f"lad_{s}.reso")
    lad = mul(f"lad_g_{s}", f"lad_{s}.aus", GAIN_LADDER)
    node(f"sem_{s}", "sem")
    edge(x, f"sem_{s}.x")
    edge("cutoff.aus", f"sem_{s}.cutoff")
    edge(reso, f"sem_{s}.reso")
    edge(form, f"sem_{s}.form")
    node(f"di_{s}", "diode", bass=DIODE_BASS)
    edge(x, f"di_{s}.x")
    edge("cutoff_d.aus", f"di_{s}.cutoff")
    edge(reso, f"di_{s}.reso")
    edge(drive_d, f"di_{s}.antrieb")
    di = mul(f"di_g_{s}", f"di_{s}.aus", GAIN_DIODE)
    node(f"typ_{s}", "wahl", n=3)
    edge(lad, f"typ_{s}.e1")
    edge(f"sem_{s}.aus", f"typ_{s}.e2")
    edge(di, f"typ_{s}.e3")
    edge(typ, f"typ_{s}.wahl")
    v = mul(f"vca_{s}", f"typ_{s}.aus", amp)
    p = mul(f"pegel_{s}", v, "pegel.aus")
    node(f"grenze_{s}", "saett")
    edge(p, f"grenze_{s}.x")
    hinten = mul(f"hinten_{s}", f"grenze_{s}.aus", 1 / LIMIT)
    # the saturating filters and the limiter turn an asymmetric wave (a saw) into a DC offset: block it at 10 Hz
    node(f"dc_{s}", "svf", cutoff=10)
    edge(hinten, f"dc_{s}.x")
    pre[s] = f"dc_{s}.hp"

# ---- chorus: on the mid signal, the dry stereo stays (out = L + (chorus - mid)) -----------------------------------------------
summe = add("lr", pre["l"], pre["r"])
mid = mul("mid", summe, 0.5)
mneg = mul("mid_neg", summe, -0.5)
for i in (1, 2, 3):
    node(f"ch{i}", "chorus", modus=i)
    edge(mid, f"ch{i}.x")
    edge(chor, f"ch{i}.mix")
for s in ("l", "r"):
    node(f"cw_{s}", "wahl", n=3)
    for i in (1, 2, 3):
        edge(f"ch{i}.{s}", f"cw_{s}.e{i}")
    edge(cmode, f"cw_{s}.wahl")
    out = add(f"out_{s}", pre[s], f"cw_{s}.aus", mneg)
node("aus", "ausgang")
edge("out_l.aus", "aus.l")
edge("out_r.aus", "aus.r")

# ---- build-out (Slice 2): second oscillator, MOD ENV, LFO 2, filter envelope times, velocity depth, glide, tuning --------------------
# Every addition joins the old path as `old + term` (term 0.0 at the default) or `old x factor` (factor exactly 1.0 at the default), so
# the graph at the default knob positions renders byte-equal to the graph before (measure_null.py run synth-poly). Cost tier B':
# osc 2 is one copy, delay and reverb are not in this graph (they run as the channel's insert/send effects).
import ausbau as A

g = {"knoten": K, "kanten": E}
INFO = {"namen": {}, "vorgaben": {}, "klassen": {}, "stufen": {}}


def uebernimm(res, namen=None):
    """Collect names, vorgaben, classes and step counts of a block's knobs; `namen` {nr: name} renames."""
    for k in INFO:
        INFO[k].update(res[k])
    for nr, n in (namen or {}).items():
        INFO["namen"][nr] = n
    return res


def info_neu():
    return A._Info()


# 29, 30: the filter envelope gets its own attack and release as factors on the shared knobs 5 and 6 (class N, 1x at the centre)
uebernimm(A.huellen_zeit(g, "fenv", attack=(29, None, 0.1, 40.0), release=(30, None, 0.25, 4.0)),
          {29: "Filter attack", 30: "Filter release"})

# 54, 57: glide (per voice, from the pitch the voice last had) and master tune in front of the oscillators. The key-follow term keeps
# reading note.hz: the filter follows the played note, not the glide.
gl = uebernimm(A.glide(g, "gl", 54, "note.hz", "note.erste"))
A.umhaengen(g, "note.hz", gl["aus"], ausser=["gl_w.e1", "kf_hz.a"] + [f"gl_g{i}.x" for i in range(6)])
mt = uebernimm(A.stimmung(g, "mt", 57, gl["aus"]), {57: "Master tune"})
A.umhaengen(g, gl["aus"], mt["aus"], ausser=("mt_hz.hz",))

# 55: velocity depth multiplies the velocity term of the amplitude (0.4 + 0.6 vel): 1x at the centre
vt = uebernimm(A.vel_tiefe(g, "vt", 55, "note.vel", "vel_k.aus"))
A.umhaengen(g, "vel_k.aus", vt["aus"], ausser=("vt_t.a",))

# 44: LFO 1 shape; the existing sine `lfo` stays the middle candidate
info = info_neu()
for nm, form in (("lfo_saw", 2), ("lfo_tri", 1), ("lfo_sq", 3), ("lfo_sh", 4)):
    node(nm, "lfo", form=form)
    edge(lrate, f"{nm}.rate")
form_k = A._wahl_knopf(g, info, "k_lform", 44, "LFO shape", 5, 2, klasse="N")
lfo_w = A._wahl(g, "lfo_w", 5, ["lfo_saw.aus", "lfo_tri.aus", "lfo.aus", "lfo_sq.aus", "lfo_sh.aus"], form_k)
A.umhaengen(g, "lfo.aus", lfo_w, ausser=("lfo_w.e3",))
uebernimm(info.ergebnis())

# 46..51: oscillator 2, one copy (tier B): saw or pulse, octave, semitone, detune, hard sync. The ring modulation of the helper (knob 52)
# is dropped (cost tier B'), so is the pulse-width knob (53): the pulse follows the pulse width of oscillator 1.
o2 = A.osc2(g, "o2", 46, "B", "osc_hz.aus", "pwm.aus")
for k in ("o2_k_ring", "o2_rg", "o2_rp", "o2_sig"):
    K[:] = [n for n in K if n["id"] != k]
    E[:] = [e for e in E if not (e["von"].split(".")[0] == k or e["nach"].split(".")[0] == k)]
edge("o2_wave.aus", "o2_out.a")
for k in ("namen", "vorgaben", "klassen"):
    o2[k].pop(52)
uebernimm(o2, {46: "Osc2 level", 47: "Osc2 wave", 48: "Osc2 octave", 49: "Osc2 semitone", 50: "Osc2 detune", 51: "Osc2 sync"})
A.summe_erweitern(g, "o2_mix", "mono.aus", o2["aus"])

# 31..38: MOD ENV with four destinations: pitch (both oscillators), pulse width, cutoff, pitch of osc 2 alone
me = uebernimm(A.mod_env(g, "me", 31, [("Pitch", 1200, "osc_hz.cent"), ("PWM", 0.4, "puls.pwm"), ("Cutoff", 48), ("Osc2", 2400, "o2_hz.cent")]),
               {31: "Mod env attack", 32: "Mod env decay", 33: "Mod env sustain", 34: "Mod env release", 35: "Mod env to pitch",
                36: "Mod env to PWM", 37: "Mod env to cutoff", 38: "Mod env to osc 2 pitch"})

# the cutoff semitone sum grows term by term (each add reads the previous sum): mod env, velocity, LFO 2
cut_p = A.summe_erweitern(g, "me_cut", "cut_st.aus", me["aus"]["Cutoff"])
cut_p = uebernimm(A.vel_zu_cutoff(g, "vc", 56, "note.vel", cut_p), {56: "Velocity to cutoff"})["aus"]

# 39..43: LFO 2 with five targets: cutoff, pitch, pulse width, resonance, amplitude. The amplitude is a factor (1 + 0.5 x LFO x amount) on
# the VCA level, so a tremolo never keeps a released voice sounding.
add("am_f", 1.0)
l2 = uebernimm(A.lfo2(g, "l2", 39, ziele=[(cut_p, 24, "aus"), ("osc_hz.cent", 200), ("puls.pwm", 0.4), ("k_reso.aus", 0.3, "aus"), ("am_f.b", 0.5)]),
               {39: "LFO2 rate", 40: "LFO2 shape", 41: "LFO2 sync", 42: "LFO2 target", 43: "LFO2 amount"})
amp_m = mul("amp_m", "amp.aus", "am_f.aus")
A.umhaengen(g, "amp.aus", amp_m, ausser=("amp_m.a",))

# the pulse of oscillator 2 follows the final pulse width of oscillator 1 (LFO, drift, MOD ENV, LFO 2 included)
pwm_ende = [e for e in E if e["nach"] == "puls.pwm"]
assert len(pwm_ende) == 1
[e for e in E if e["nach"] == "o2_puls.pwm"][0]["von"] = pwm_ende[0]["von"]

for nr, n in INFO["namen"].items():
    NAMEN[str(nr)] = n

graph = {"format": "baukasten/2", "name": "synth-poly", "stimmen": STIMMEN, "regler_namen": NAMEN, "knoten": K, "kanten": E}


def zeile(o):
    return json.dumps(o, ensure_ascii=False, separators=(", ", ": "))


def schreibe_graph(pfad):
    with open(pfad, "w") as f:
        f.write('{\n  "format": "baukasten/2",\n  "name": "synth-poly",\n  "stimmen": %d,\n' % STIMMEN)
        f.write('  "regler_namen": ' + zeile(NAMEN).replace('", "', '",\n    "').replace("{", "{\n    ", 1).replace("}", "\n  }") + ",\n")
        f.write('  "knoten": [\n' + ",\n".join("    " + zeile(k) for k in K) + "\n  ],\n")
        f.write('  "kanten": [\n' + ",\n".join("    " + zeile(k) for k in E) + "\n  ]\n}\n")



if __name__ == "__main__":
    schreibe_graph(HIER / "demos" / "synth-poly.json")
    print(f"synth-poly: {len(K)} nodes, {len(E)} edges, {len(NAMEN)} knobs")
