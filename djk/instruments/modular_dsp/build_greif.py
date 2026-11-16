#!/usr/bin/env python3
"""Builds the Baukasten instrument `synth-greif` ("Greif"): graph (demos/) and front panel (paneele/).

    python3 build_greif.py            # writes demos/synth-greif.json and paneele/synth-greif.json
    python3 build_greif.py --tabelle  # prints the knob map as a Markdown table (for the device document)

The knob table K below is the single source of the knob numbers, ranges and defaults (63 knobs; 64 is free).

Signal path (8 voices, stereo from the oscillators on, latency 0):

  note -> glide (a `wahl` morph over the raw pitch and four `glatt` smoothers; knob 0 = raw pitch)
  OSC C (1 copy)  -- pm --> OSC B (3 copies) -- pm --> OSC A (5 copies);  C -- pm --> A
        each a `wavetable` with its own table of spectra computed below (A analog to digital, B vocal, C bell and organ)
        Position, Warp (off/bend/asym/sync) with Depth, Pitch, Fine, Level; Unison (Detune, Width, Stack) acts on A and B together
  + noise (white through a fixed one-pole tilt)
  -> FILTER 1 (`svf`, 12 dB, low-pass / band-pass / high-pass morph) -> DRIVE (`saett`) -> FILTER 2 (`ladder`, 24 dB) with a
     serial..parallel routing knob -> amp envelope x velocity -> DC block
  -> CHORUS (sum point, on the mid signal, the dry stereo stays) -> SHIFT (a `schieber` on the mid signal after the chorus, its `auf`
     output added to both sides) -> DELAY (sum point, ping-pong)
  SUB: sine..square, one or two octaves below, its own level, times the amp envelope; it passes no filter, no drive and no effect and
     joins the master sum in front of Volume.
  Modulation: ENV 3 and LFO 1 (triangle) and a Lorenz CHAOS source move the three oscillator positions; LFO 1 and CHAOS also the
  filter cutoff; LFO 2 (sine) moves the pitch and the warp depth.
"""
import json
import math
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent

# ---- knob table: (nr, id, name, min, max, log, default (in knob units), panel format, unit) ---------------------------------
# selectors have min 0 and max n-1 (the default is the option index): the panel sends index / (n - 1)
WARP = ["Off", "Bend", "Asym", "Sync"]
K = [
    (1, "k_pos_a", "A Position", 0, 1, 0, 0.29, "percent", None),
    (2, "k_warp_a", "A Warp", 0, 3, 0, 1, "raw", "mode"),
    (3, "k_tiefe_a", "A Depth", -1, 1, 0, 0.15, "percent", None),
    (4, "k_pitch_a", "A Pitch", -24, 24, 0, 0, "raw", "st"),
    (5, "k_fine_a", "A Fine", -50, 50, 0, 0, "raw", "ct"),
    (6, "k_lv_a", "A Level", 0, 1, 0, 0.70, "percent", None),
    (7, "k_pos_b", "B Position", 0, 1, 0, 0.60, "percent", None),
    (8, "k_warp_b", "B Warp", 0, 3, 0, 2, "raw", "mode"),
    (9, "k_tiefe_b", "B Depth", -1, 1, 0, 0.12, "percent", None),
    (10, "k_pitch_b", "B Pitch", -24, 24, 0, 0, "raw", "st"),
    (11, "k_fine_b", "B Fine", -50, 50, 0, 6, "raw", "ct"),
    (12, "k_lv_b", "B Level", 0, 1, 0, 0.35, "percent", None),
    (13, "k_pos_c", "C Position", 0, 1, 0, 0.10, "percent", None),
    (14, "k_warp_c", "C Warp", 0, 3, 0, 1, "raw", "mode"),
    (15, "k_tiefe_c", "C Depth", -1, 1, 0, 0.10, "percent", None),
    (16, "k_pitch_c", "C Pitch", -24, 24, 0, 12, "raw", "st"),
    (17, "k_lv_c", "C Level", 0, 1, 0, 0.15, "percent", None),
    (18, "k_pm_ba", "PM B>A", 0, 1, 0, 0.05, "percent", None),
    (19, "k_pm_cb", "PM C>B", 0, 1, 0, 0.04, "percent", None),
    (20, "k_pm_ca", "PM C>A", 0, 1, 0, 0.04, "percent", None),
    (21, "k_det", "Detune", 0, 50, 0, 14, "raw", "ct"),
    (22, "k_breite", "Width", 0, 1, 0, 0.6, "percent", None),
    (23, "k_stapel", "Stack", 0, 2, 0, 0, "raw", "mode"),
    (24, "k_sub_form", "Sub Shape", 0, 1, 0, 0.15, "percent", None),
    (25, "k_sub_okt", "Sub Octave", 0, 1, 0, 0, "raw", "oct"),
    (26, "k_sub_lv", "Sub Level", 0, 1, 0, 0.25, "percent", None),
    (27, "k_noise", "Noise Level", 0, 1, 0, 0.05, "percent", None),
    (28, "k_ftyp", "F1 Type", 0, 1, 0, 0.0, "percent", None),
    (29, "k_cut1", "F1 Cutoff", 60, 16000, 1, 5200, "hz", None),
    (30, "k_reso1", "F1 Resonance", 0, 0.9, 0, 0.2, "percent", None),
    (31, "k_fenv_amt", "F1 Env", -60, 60, 0, 18, "raw", "st"),
    (32, "k_key", "F1 Key", 0, 3, 0, 0.8, "raw", "x"),
    (33, "k_drive", "Drive", 0, 1, 0, 0.15, "percent", None),
    (34, "k_cut2", "F2 Cutoff", 60, 16000, 1, 9000, "hz", None),
    (35, "k_reso2", "F2 Resonance", 0, 0.85, 0, 0.1, "percent", None),
    (36, "k_route", "F2 Routing", 0, 1, 0, 0.2, "percent", None),
    (37, "k_fa", "Filter Attack", 0.001, 5, 1, 0.005, "raw", "s"),
    (38, "k_fd", "Filter Decay", 0.02, 8, 1, 0.45, "raw", "s"),
    (39, "k_fs", "Filter Sustain", 0, 1, 0, 0.3, "percent", None),
    (40, "k_fr", "Filter Release", 0.02, 8, 1, 0.35, "raw", "s"),
    (41, "k_aa", "Amp Attack", 0.001, 5, 1, 0.004, "raw", "s"),
    (42, "k_ad", "Amp Decay", 0.02, 8, 1, 1.0, "raw", "s"),
    (43, "k_as", "Amp Sustain", 0, 1, 0, 0.8, "percent", None),
    (44, "k_ar", "Amp Release", 0.02, 8, 1, 0.3, "raw", "s"),
    (45, "k_e3a", "Env3 Attack", 0.001, 5, 1, 0.01, "raw", "s"),
    (46, "k_e3d", "Env3 Decay", 0.02, 8, 1, 0.6, "raw", "s"),
    (47, "k_e3pos", "Env3 >Position", -1, 1, 0, 0.12, "percent", None),
    (48, "k_l1rate", "LFO1 Rate", 0.05, 30, 1, 0.7, "hz", None),
    (49, "k_l1pos", "LFO1 >Position", 0, 0.5, 0, 0.05, "percent", None),
    (50, "k_l1cut", "LFO1 >Cutoff", 0, 36, 0, 3, "raw", "st"),
    (51, "k_l2rate", "LFO2 Rate", 0.1, 30, 1, 5.5, "hz", None),
    (52, "k_l2pitch", "LFO2 >Pitch", 0, 100, 0, 6, "raw", "ct"),
    (53, "k_l2tiefe", "LFO2 >Depth", 0, 0.5, 0, 0.05, "percent", None),
    (54, "k_chrate", "Chaos Rate", 0.01, 50, 1, 0.6, "hz", None),
    (55, "k_chcut", "Chaos >Cutoff", 0, 36, 0, 3, "raw", "st"),
    (56, "k_chpos", "Chaos >Position", 0, 0.5, 0, 0.05, "percent", None),
    (57, "k_shhz", "Shift Hz", -400, 400, 0, 2.5, "hz", None),
    (58, "k_shmix", "Shift Mix", 0, 1, 0, 0.15, "percent", None),
    (59, "k_chorus", "Chorus Mix", 0, 1, 0, 0.3, "percent", None),
    (60, "k_dzeit", "Delay Time", 20, 900, 1, 340, "ms", None),
    (61, "k_dmix", "Delay Mix", 0, 0.8, 0, 0.12, "percent", None),
    (62, "k_glide", "Glide", 0, 1, 0, 0, "percent", None),
    (63, "k_vol", "Volume", -30, 6, 0, -6, "db", None),
]
KK = {k[0]: k for k in K}
OPTIONEN = {2: WARP, 8: WARP, 14: WARP, 23: ["Off", "Oct", "Cycle"], 25: ["-1", "-2"]}

# ---- fixed design values ---------------------------------------------------------------------------------------------------
COPIES = {"a": 5, "b": 3, "c": 1}
FRAMES = {"a": 24, "b": 24, "c": 20}
HARMONISCHE = {"a": 96, "b": 96, "c": 64}
TRIM = 0.30              # level of the oscillator sum in front of the filters
NOISE_TRIM = 0.5         # the noise is much louder than a wavetable of the same knob position
NOISE_TILT_HZ = 3500     # fixed one-pole tilt of the noise (low-pass, `svf` 12 dB)
DRIVE_DB = 18.0          # drive knob at 1
DRIVE_PRE = 2.0          # fixed gain in front of the drive stage, taken out again behind it
DRIVE_COMP = 0.35        # share of the level the drive knob takes back at 1
KEY_HZ = 1.0             # key follow adds knob x note Hz to the cutoff
SUB_TRIM = 0.30
SUB_SQUARE = 0.35        # level of the square relative to the sine at Shape 1
ST_PER_DB = 12 / (20 * math.log10(2))   # transponiere: gain = 2^(st/12), so dB x 1.9932 semitones
GLIDE_ZEITEN = (0.015, 0.04, 0.1, 0.25)
CHORUS_MODUS = 2
DELAY_FB = 0.4
DELAY_DAEMPF = 4000
STIMMEN = 8


# ---- tables: spectra computed from formulas (harmonic amplitudes, sine phase, sign = polarity) ------------------------------
def lerp(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def morph(anker, frames):
    """`frames` spectra along the piecewise linear morph through the anchor spectra (equal parts)."""
    aus = []
    for i in range(frames):
        t = i / (frames - 1) * (len(anker) - 1)
        j = min(int(t), len(anker) - 2)
        aus.append(lerp(anker[j], anker[j + 1], t - j))
    return aus


def runde(frames):
    return [[round(a, 5) for a in f] for f in frames]


def tabelle_a(n=HARMONISCHE["a"], frames=FRAMES["a"]):
    """"analog to digital": sine, triangle, saw, square, a narrowing pulse, a hollow spectrum (only every third harmonic), then a
    quantised, steppy spectrum (amplitudes snapped to a few levels: the digital end)."""
    h = range(1, n + 1)
    sinus = [1.0] + [0.0] * (n - 1)
    dreieck = [(1.0 / k ** 2) * (1 if (k // 2) % 2 == 0 else -1) if k % 2 else 0.0 for k in h]
    saege = [1.0 / k for k in h]
    rechteck = [1.0 / k if k % 2 else 0.0 for k in h]

    def puls(d):
        return [2.0 * math.sin(math.pi * k * d) / (math.pi * k) * 1.4 for k in h]
    hohl = [(1.0 / k) if k % 3 != 1 or k == 1 else 0.0 for k in h]
    hohl = [a if k > 1 else 0.0 for k, a in zip(h, hohl)]       # no fundamental: hollow
    digital = [round(1.2 / k * 4) / 4 if k < 40 else 0.0 for k in h]
    anker = [sinus, dreieck, saege, rechteck, puls(0.25), puls(0.12), hohl, digital]
    return runde(morph(anker, frames)), {"sinus": 0.0, "dreieck": 1 / 7, "saege": 2 / 7, "rechteck": 3 / 7, "puls": 4 / 7, "hohl": 6 / 7, "digital": 1.0}


def tabelle_b(n=HARMONISCHE["b"], frames=FRAMES["b"]):
    """"vocal": formant sweeps over a saw. The table is designed for a fundamental of 130 Hz; the formants of u, o, a, e, i
    (F1, F2, F3 in Hz) glide into each other, so the vowel moves along the position."""
    f0 = 130.0
    vokale = [(300, 870, 2240), (570, 840, 2410), (730, 1090, 2440), (530, 1840, 2480), (270, 2290, 3010)]   # u o a e i: dark to bright
    pegel = (1.0, 0.7, 0.3)
    bw = (90.0, 110.0, 160.0)
    aus = []
    for i in range(frames):
        t = i / (frames - 1) * (len(vokale) - 1)
        j = min(int(t), len(vokale) - 2)
        f = [x + (y - x) * (t - j) for x, y in zip(vokale[j], vokale[j + 1])]
        frame = []
        for k in range(1, n + 1):
            fk = k * f0
            g = sum(p * math.exp(-0.5 * ((fk - ff) / b) ** 2) for p, ff, b in zip(pegel, f, bw))
            frame.append((0.12 + 1.6 * g) / k)
        aus.append(frame)
    return runde(aus)


def tabelle_c(n=HARMONISCHE["c"], frames=FRAMES["c"]):
    """"bell and organ": drawbar spectra (harmonics 1, 2, 3, 4, 5, 6, 8 of the 8' stop), then sparse spectra that read as a bell
    (the strong partials sit on irregular harmonics, the ones between are empty)."""
    stangen = (1, 2, 3, 4, 5, 6, 8)

    def orgel(w):
        a = [0.0] * n
        for s, g in zip(stangen, w):
            a[s - 1] = g
        return a

    def glocke(teile):
        a = [0.0] * n
        for k, g in teile:
            a[k - 1] = g
        return a
    anker = [
        orgel((1.0, 0.8, 0.6, 0.0, 0.0, 0.0, 0.0)),            # flute-like
        orgel((1.0, 1.0, 0.8, 0.8, 0.5, 0.4, 0.3)),            # full
        orgel((0.4, 0.0, 0.2, 0.0, 0.7, 0.9, 1.0)),            # reedy top
        glocke([(1, 0.35), (2, 0.9), (3, 0.2), (5, 0.7), (7, 0.55), (9, 0.3)]),
        glocke([(1, 0.1), (2, 0.5), (4, 0.8), (6, 0.2), (7, 0.6), (11, 0.5), (13, 0.35)]),
        glocke([(3, 0.6), (5, 0.9), (8, 0.4), (11, 0.7), (14, 0.5), (19, 0.4), (23, 0.3)]),
    ]
    return runde(morph(anker, frames))


# ---- graph -----------------------------------------------------------------------------------------------------------------
def vorgabe(k):
    _, _, _, lo, hi, log, d, *_ = k
    return (math.log(d / lo) / math.log(hi / lo)) if log else (d - lo) / (hi - lo)


def graph():
    TAB_A, POS_A = tabelle_a()
    TAB_B = tabelle_b()
    TAB_C = tabelle_c()
    knoten, kanten = [], []

    def n(id, art, **w):
        knoten.append({"id": id, "art": art, **w})
        return id

    def e(a, b):
        kanten.append({"von": a, "nach": b})

    def mul(id, a, b=None, **w):
        """Product: a and b are ports (strings) or numbers (fixed values)."""
        extra = {}
        for pin, q in (("a", a), ("b", b)):
            if isinstance(q, (int, float)):
                extra[pin] = q
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

    n("note", "note")
    for nr, kid, name, lo, hi, log, d, _, _ in K:
        w = dict(id=kid, art="regler", nr=nr, min=lo, max=hi)
        if log:
            w["log"] = 1
        v = round(vorgabe(KK[nr]), 6)
        if v != 0.5:
            w["vorgabe"] = v
        knoten.append(w)
    k = lambda nr: f"{KK[nr][1]}.aus"

    # --- pitch with glide: morph over raw pitch and four smoothers
    n("gl_sel", "wahl", n=5, modus=1, norm=1)
    e("note.hz", "gl_sel.e1")
    for i, z in enumerate(GLIDE_ZEITEN, start=1):
        n(f"gl{i}", "glatt", zeit=z)
        e("note.hz", f"gl{i}.x")
        e("note.erste", f"gl{i}.setzen")
        e(f"gl{i}.aus", f"gl_sel.e{i + 1}")
    e(k(62), "gl_sel.wahl")
    TON = "gl_sel.aus"

    # --- modulators
    n("lfo1", "lfo", form=1); e(k(48), "lfo1.rate")
    n("lfo2", "lfo", form=0); e(k(51), "lfo2.rate")
    n("chaos", "chaos", form=0, saat=3); e(k(54), "chaos.rate")
    n("env3", "adsr", s=0, a=0.01, d=0.5, r=0.3)
    n("fenv", "adsr", a=0.005, d=0.4, s=0.3, r=0.3)
    n("aenv", "adsr", a=0.004, d=0.5, s=0.8, r=0.3)
    for nm, (ra, rd, rs, rr) in (("env3", (45, 46, None, None)), ("fenv", (37, 38, 39, 40)), ("aenv", (41, 42, 43, 44))):
        e("note.gate", f"{nm}.gate"); e("note.trig", f"{nm}.trig")
        e(k(ra), f"{nm}.a"); e(k(rd), f"{nm}.d")
        if rs:
            e(k(rs), f"{nm}.s"); e(k(rr), f"{nm}.r")

    # positions: knob + ENV 3 + LFO 1 (shared) + chaos (A: x, B: y, C: -x)
    pos_gem = add("pos_gem", mul("e3_pos", "env3.aus", k(47)), mul("l1_pos", "lfo1.aus", k(49)))
    cha_a = mul("cha_a", "chaos.aus", k(56))
    cha_b = mul("cha_b", "chaos.aus2", k(56))
    cha_c = mul("cha_c", cha_a, -1)
    pos = {"a": add("pos_a", k(1), pos_gem, cha_a), "b": add("pos_b", k(7), pos_gem, cha_b), "c": add("pos_c", k(13), pos_gem, cha_c)}
    # warp depth: knob + LFO 2
    tiefe_l = mul("l2_tiefe", "lfo2.aus", k(53))
    tiefe = {"a": add("tiefe_a", k(3), tiefe_l), "b": add("tiefe_b", k(9), tiefe_l), "c": add("tiefe_c", k(15), tiefe_l)}
    # pitch: Pitch knob in semitones, Fine knob and the LFO 2 vibrato in cents
    vib = mul("vib", "lfo2.aus", k(52))
    cent = {"a": add("cent_a", k(5), vib), "b": add("cent_b", k(11), vib), "c": vib}
    hz = {}
    for o, pitch in (("a", 4), ("b", 10), ("c", 16)):
        n(f"hz_{o}", "transponiere")
        e(TON, f"hz_{o}.hz"); e(k(pitch), f"hz_{o}.st"); e(cent[o], f"hz_{o}.cent")
        hz[o] = f"hz_{o}.aus"

    # --- oscillators: C feeds B and A, B feeds A (index in cycles from the mono output of the modulator)
    n("wt_c", "wavetable", kopien=COPIES["c"], saat=13, spektren=TAB_C)
    n("wt_b", "wavetable", kopien=COPIES["b"], saat=12, spektren=TAB_B)
    n("wt_a", "wavetable", kopien=COPIES["a"], saat=11, spektren=TAB_A)
    pm_b = mul("pm_cb", "wt_c.aus", k(19))
    pm_a = add("pm_a", mul("pm_ba", "wt_b.aus", k(18)), mul("pm_ca", "wt_c.aus", k(20)))
    pm = {"a": pm_a, "b": pm_b, "c": None}
    warp = {"a": k(2), "b": k(8), "c": k(14)}
    for o in "abc":
        w = f"wt_{o}"
        e(hz[o], f"{w}.hz"); e("note.trig", f"{w}.trig"); e(pos[o], f"{w}.pos")
        e(warp[o], f"{w}.warp"); e(tiefe[o], f"{w}.tiefe")
        if pm[o]:
            e(pm[o], f"{w}.pm")
    for o in "ab":
        e(k(21), f"wt_{o}.verstimmung"); e(k(22), f"wt_{o}.breite"); e(k(23), f"wt_{o}.stapel")

    # --- noise through a fixed tilt
    n("rauschen", "rauschen")
    n("noise_tp", "svf", pole=2, cutoff=NOISE_TILT_HZ, reso=0); e("rauschen.aus", "noise_tp.x")
    mono_q = add("mono", mul("lv_c", "wt_c.aus", k(17)), mul("noise_g", mul("noise_t", "noise_tp.tp", NOISE_TRIM), k(27)))

    # --- cutoffs: knob + key follow (Hz), transposed by envelope, LFO 1 and chaos (semitones)
    cut_st = add("cut_st", mul("fenv_st", "fenv.aus", k(31)), mul("l1_cut", "lfo1.aus", k(50)), mul("ch_cut", "chaos.aus", k(55)))
    base1 = add("cut1_base", k(29), mul("key_hz", "note.hz", mul("key_k", k(32), KEY_HZ)))
    n("cut1", "transponiere"); e(base1, "cut1.hz"); e(cut_st, "cut1.st")
    n("cut2", "transponiere"); e(k(34), "cut2.hz"); e(mul("cut2_st", cut_st, 0.5), "cut2.st")
    # drive
    drv_db = mul("drv_db", k(33), DRIVE_DB)
    drv_g = add("drv_g", 1.0 / DRIVE_PRE, mul("drv_c", k(33), -DRIVE_COMP / DRIVE_PRE))
    # routing: in2 = dry*(1-r) + src*r (serial .. parallel); out = f2*(1 - r/2) + drive*(r/2)
    om = add("route_om", 1.0, mul("route_neg", k(36), -1))
    omh = add("route_omh", 1.0, mul("route_negh", k(36), -0.5))
    rh = mul("route_h", k(36), 0.5)
    vel = add("vel_g", 0.4, mul("vel_k", "note.vel", 0.6))
    amp = mul("amp", "aenv.aus", vel)

    seite = {}
    for c in "lr":
        src = mul(f"src_{c}", add(f"osc_{c}", mul(f"lv_a_{c}", f"wt_a.{c}", k(6)), mul(f"lv_b_{c}", f"wt_b.{c}", k(12)), mono_q), TRIM)
        n(f"f1_{c}", "svf", pole=2); e(src, f"f1_{c}.x"); e("cut1.aus", f"f1_{c}.cutoff"); e(k(30), f"f1_{c}.reso")
        n(f"typ_{c}", "wahl", n=3, modus=1, norm=1)
        for i, o in enumerate(("tp", "bp", "hp"), start=1):
            e(f"f1_{c}.{o}", f"typ_{c}.e{i}")
        e(k(28), f"typ_{c}.wahl")
        n(f"drv_{c}", "saett"); e(mul(f"drv_in_{c}", f"typ_{c}.aus", DRIVE_PRE), f"drv_{c}.x"); e(drv_db, f"drv_{c}.antrieb")
        dry = mul(f"drv_out_{c}", f"drv_{c}.aus", drv_g)
        in2 = add(f"in2_{c}", mul(f"in2a_{c}", dry, om), mul(f"in2b_{c}", src, k(36)))
        n(f"f2_{c}", "ladder"); e(in2, f"f2_{c}.x"); e("cut2.aus", f"f2_{c}.cutoff"); e(k(35), f"f2_{c}.reso")
        out2 = add(f"out2_{c}", mul(f"out2a_{c}", f"f2_{c}.aus", omh), mul(f"out2b_{c}", dry, rh))
        v = mul(f"vca_{c}", out2, amp)
        # the drive and the ladder turn an asymmetric wave into a DC offset: block it at 10 Hz
        n(f"dc_{c}", "svf", cutoff=10, reso=0); e(v, f"dc_{c}.x")
        seite[c] = f"dc_{c}.hp"

    # --- chorus on the mid signal of the voice sum (a sum point), the dry stereo stays: out = side + (chorus - mid)
    summe = add("lr", seite["l"], seite["r"])
    mid = mul("mid", summe, 0.5)
    mneg = mul("mid_neg", summe, -0.5)
    n("chorus", "chorus", modus=CHORUS_MODUS); e(mid, "chorus.x"); e(k(59), "chorus.mix")
    o1 = {c: add(f"ch_{c}", seite[c], f"chorus.{c}", mneg) for c in "lr"}
    # --- shift: a mono effect. A frequency shifter is linear, so one per voice on the mid signal of the (chorus) output sums to one on
    # the sum. Its `auf` output goes to both sides with the same weight
    m2 = mul("sh_mid", add("sh_sum", o1["l"], o1["r"]), 0.5)
    n("shift", "schieber"); e(m2, "shift.x"); e(k(57), "shift.hz")
    shw = mul("shift_w", "shift.auf", k(58))
    o2 = {c: add(f"sh_{c}", o1[c], shw) for c in "lr"}
    # --- delay (sum point, ping-pong); mix and time come straight from their regler nodes
    n("delay", "delay", fb=DELAY_FB, daempf=DELAY_DAEMPF, pingpong=1, max=1000)
    e(o2["l"], "delay.l"); e(o2["r"], "delay.r"); e(k(60), "delay.zeit"); e(k(61), "delay.mix")

    # --- sub: sine .. square, one or two octaves below the (glided) pitch, times the amp envelope; no filter, drive or effect
    n("sub_oktave", "wahl", n=2, modus=0, norm=1, e1=-12, e2=-24); e(k(25), "sub_oktave.wahl")
    n("sub_hz", "transponiere"); e(TON, "sub_hz.hz"); e("sub_oktave.aus", "sub_hz.st")
    n("sub_sin", "sinus"); e("sub_hz.aus", "sub_sin.hz")
    n("sub_sq", "puls"); e("sub_hz.aus", "sub_sq.hz")
    om_s = add("sub_om", 1.0, mul("sub_neg", k(24), -1))
    sub_m = add("sub_mix", mul("sub_a", "sub_sin.aus", om_s), mul("sub_b", "sub_sq.aus", mul("sub_f", k(24), SUB_SQUARE)))
    sub = mul("sub_out", mul("sub_lv", mul("sub_t", sub_m, SUB_TRIM), k(26)), amp)

    # --- master: delay output + sub, times Volume (dB through transponiere)
    vol = "vol_g.aus"
    n("vol_st", "mul", b=ST_PER_DB); e(k(63), "vol_st.a")
    n("vol_g", "transponiere", hz=1.0); e("vol_st.aus", "vol_g.st")
    n("aus", "ausgang")
    for c in "lr":
        mul(f"master_{c}", add(f"mix_{c}", f"delay.{c}", sub), vol)
        e(f"master_{c}.aus", f"aus.{c}")
    return {"format": "baukasten/2", "name": "synth-greif", "stimmen": STIMMEN,
            "regler_namen": {str(x[0]): x[2] for x in K}, "knoten": knoten, "kanten": kanten}


# ---- panel -----------------------------------------------------------------------------------------------------------------
def knob(cid, kk, **w):
    nr, _, name, lo, hi, log, d, fmt, unit = kk
    c = {"id": cid, "type": "knob", "label": name, "bind": {"param": f"k{nr}"}, "format": fmt, "default": round(vorgabe(kk), 6)}
    if unit:
        c["unit"] = unit
    c.update(w)
    return c


def selector(cid, kk, **w):
    nr, _, name, lo, hi, log, d, fmt, unit = kk
    c = {"id": cid, "type": "selector", "label": name, "bind": {"param": f"k{nr}"}, "options": OPTIONEN[nr], "default": int(d)}
    c.update(w)
    return c


def panel():
    def c(nr, **w):
        return selector(f"c{nr}", KK[nr], **w) if nr in OPTIONEN else knob(f"c{nr}", KK[nr], **w)
    text = lambda cid, t, span: {"id": cid, "type": "label", "span": span, "text": t}

    def osc(titel, sid, nrs, hinweis):
        # the warp selector has four options: it gets a row of its own below the knobs
        knoepfe = [c(nr) for nr in nrs if nr not in OPTIONEN]
        wahl = [c(nr, span=3) for nr in nrs if nr in OPTIONEN]
        return {"id": sid, "title": titel, "cols": 3, "page": "main", "controls": knoepfe + wahl + [text(f"t_{sid}", hinweis, 3)]}
    sektionen = [
        osc("OSC A", "osc_a", range(1, 7), "Analog to digital, 5 copies."),
        osc("OSC B", "osc_b", range(7, 13), "Vocal, 3 copies."),
        osc("OSC C", "osc_c", range(13, 18), "Bell and organ, 1 copy."),
        {"id": "pm", "title": "PHASE MOD", "cols": 3, "page": "main", "controls": [c(18), c(19), c(20), text("t_pm", "In cycles: C into B, B and C into A.", 3)]},
        {"id": "unison", "title": "UNISON", "cols": 3, "page": "main", "controls": [c(21), c(22), c(23), text("t_un", "Acts on A and B.", 3)]},
        {"id": "sub", "title": "SUB / NOISE", "cols": 4, "page": "main", "controls": [c(24), c(25), c(26), c(27), text("t_sub", "The sub passes no filter and no effect.", 4)]},
        {"id": "f1", "title": "FILTER 1", "cols": 5, "page": "main", "controls": [
            {"id": "fk", "type": "filterkurve", "span": 5, "of": {"cutoff": "c29", "reso": "c30"}, "typen": [{"art": "lp", "pole": 2}]},
            c(28), c(29), c(30), c(31), c(32)]},
        {"id": "f2", "title": "DRIVE / FILTER 2", "cols": 4, "page": "main", "controls": [c(33), c(34), c(35), c(36)]},
        {"id": "aenv", "title": "AMP ENV", "cols": 4, "page": "main", "controls": [
            {"id": "ahue", "type": "huelle", "span": 4, "label": "Amp envelope", "of": {"a": "c41", "d": "c42", "s": "c43", "r": "c44"}},
            c(41), c(42), c(43), c(44)]},
        {"id": "master", "title": "MASTER", "cols": 2, "page": "main", "controls": [c(62), c(63)]},
        {"id": "fenv", "title": "FILTER ENV", "cols": 4, "page": "mod", "controls": [
            {"id": "fhue", "type": "huelle", "span": 4, "label": "Filter envelope", "of": {"a": "c37", "d": "c38", "s": "c39", "r": "c40"}},
            c(37), c(38), c(39), c(40)]},
        {"id": "env3", "title": "ENV 3", "cols": 3, "page": "mod", "controls": [c(45), c(46), c(47)]},
        {"id": "lfo1", "title": "LFO 1", "cols": 3, "page": "mod", "controls": [c(48), c(49), c(50), text("t_l1", "Triangle.", 3)]},
        {"id": "lfo2", "title": "LFO 2", "cols": 3, "page": "mod", "controls": [c(51), c(52), c(53), text("t_l2", "Sine: vibrato and warp depth.", 3)]},
        {"id": "chaos", "title": "CHAOS", "cols": 3, "page": "mod", "controls": [c(54), c(55), c(56), text("t_ch", "Lorenz: never repeats.", 3)]},
        {"id": "fx", "title": "FX", "cols": 5, "page": "mod", "controls": [c(57), c(58), c(59), c(60), c(61), text("t_fx", "Chorus, then shift, then delay.", 5)]},
    ]
    return {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": "synth-greif"}, "title": "Greif", "akzent": "violett",
            "pages": [{"id": "main", "title": "Main"}, {"id": "mod", "title": "Mod"}],
            "layout": {"rows": [["osc_a", "osc_b", "osc_c"], ["pm", "unison", "sub"], ["f1", "f2", "aenv"], ["master"],
                                ["fenv", "env3", "lfo1"], ["lfo2", "chaos", "fx"]]},
            "sections": sektionen}


def zeile(o):
    return json.dumps(o, ensure_ascii=False, separators=(", ", ": "))


def schreibe_graph(pfad, g):
    with open(pfad, "w") as f:
        f.write('{\n  "format": "baukasten/2",\n  "name": "synth-greif",\n  "stimmen": %d,\n' % g["stimmen"])
        f.write('  "regler_namen": ' + zeile(g["regler_namen"]).replace('", "', '",\n    "').replace("{", "{\n    ", 1).replace("}", "\n  }") + ",\n")
        f.write('  "knoten": [\n' + ",\n".join("    " + zeile(x) for x in g["knoten"]) + "\n  ],\n")
        f.write('  "kanten": [\n' + ",\n".join("    " + zeile(x) for x in g["kanten"]) + "\n  ]\n}\n")


def tabelle():
    z = ["| Knob | Name | Range | Default |", "|---|---|---|---|"]
    for nr, _, name, lo, hi, log, d, fmt, unit in K:
        if nr in OPTIONEN:
            bereich = " / ".join(OPTIONEN[nr])
            vor = OPTIONEN[nr][int(d)]
        else:
            bereich = f"{lo:g} .. {hi:g}{' log' if log else ''}{(' ' + unit) if unit and fmt == 'raw' else ''}"
            vor = f"{d:g}"
        z.append(f"| k{nr} | {name} | {bereich} | {vor} |")
    return "\n".join(z)


if __name__ == "__main__":
    if "--tabelle" in sys.argv:
        print(tabelle())
        sys.exit(0)
    g = graph()
    schreibe_graph(HIER / "demos" / "synth-greif.json", g)
    (HIER / "paneele" / "synth-greif.json").write_text(json.dumps(panel(), indent=1, ensure_ascii=False) + "\n")
    print(g["name"], len(g["regler_namen"]), "knobs,", len(g["knoten"]), "nodes,", len(g["kanten"]), "edges")
