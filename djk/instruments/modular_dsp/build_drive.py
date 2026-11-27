#!/usr/bin/env python3
"""Builds the graph of the Cypher Drive device (`demos/fx-drive.json`).

The curve section (six saturation curves behind one `wahl`) is written once as `kurven()` and instantiated per channel and,
in three-band mode, once more per band. Deterministic output (sorted keys inside nodes, fixed node order).
Run:  python3 build_drive.py            (full graph with the band mode)
      python3 build_drive.py --voll     (full band only, knobs 1..8)
"""
import json
import pathlib
import sys

HIER = pathlib.Path(__file__).parent
DB_ZU_ST = 1.9931535      # semitones per dB: 12 * log2(10) / 20, so `transponiere` (hz 1) is a gain of 10^(dB/20)
LATENZ_MS = 1.4375        # 69 samples at 48 kHz = the latency of `falter` with `ueber` 1
BAENDER = "--voll" not in sys.argv

knoten, kanten = [], []


def n(kid, art, **w):
    knoten.append({"id": kid, "art": art, **w})
    return kid


def e(von, nach):
    kanten.append({"von": von, "nach": nach})


def regler(kid, nr, **w):
    return n(kid, "regler", nr=nr, **w)


def kurven(p, x, d_db, g_lin, k):
    """One curve section: input `x` (a `node.port`), drive in dB `d_db`, drive as a linear gain `g_lin`. Returns the
    output port of the curve selector. Every branch except Fold carries a `leitung` of 69 samples (equal latency)."""
    # --- Tape: emphasis (high-pass share) -> tanh -> 12 kHz de-emphasis
    hp = n(f"{p}_ta_hp", "svf", cutoff=3000, reso=0)
    e(x, f"{hp}.x")
    em = n(f"{p}_ta_em", "mul")
    e(f"{hp}.hp", f"{em}.a"); e(k["emph"], f"{em}.b")
    vor = n(f"{p}_ta_vor", "add")
    e(x, f"{vor}.a"); e(f"{em}.aus", f"{vor}.b")
    sat = n(f"{p}_ta_sat", "saett")
    e(f"{vor}.aus", f"{sat}.x"); e(d_db, f"{sat}.antrieb")
    de = n(f"{p}_ta_de", "svf", cutoff=12000, reso=0)
    e(f"{sat}.aus", f"{de}.x")
    tape = n(f"{p}_ta_z", "leitung", zeit=LATENZ_MS, max=2)
    e(f"{de}.tp", f"{tape}.x")
    # --- Tube: triode stage, Character moves the grid bias -3..0 V
    ro = n(f"{p}_tu", "roehre", stufen=1)
    e(x, f"{ro}.x"); e(d_db, f"{ro}.antrieb"); e(k["bias"], f"{ro}.bias")
    tu_s = n(f"{p}_tu_s", "saett")   # safety knee: the triode's plate swing reaches several times full scale at high drive
    e(f"{ro}.aus", f"{tu_s}.x")
    tube = n(f"{p}_tu_z", "leitung", zeit=LATENZ_MS, max=2)
    e(f"{tu_s}.aus", f"{tube}.x")
    # --- shared by Soft, Hard and Crush: the driven signal
    xg = n(f"{p}_xg", "mul")
    e(x, f"{xg}.a"); e(g_lin, f"{xg}.b")
    # --- Soft: DC offset (asymmetry) -> tanh -> 10 Hz high-pass
    so_dc = n(f"{p}_so_dc", "add")
    e(f"{xg}.aus", f"{so_dc}.a"); e(k["dc"], f"{so_dc}.b")
    so_s = n(f"{p}_so_s", "saett")
    e(f"{so_dc}.aus", f"{so_s}.x")
    so_h = n(f"{p}_so_h", "svf", cutoff=10, reso=0)
    e(f"{so_s}.aus", f"{so_h}.x")
    soft = n(f"{p}_so_z", "leitung", zeit=LATENZ_MS, max=2)
    e(f"{so_h}.hp", f"{soft}.x")
    # --- Hard: comparator from `wahl`: index = x*g/(2c) + 1 rounds to 0 (below -c), 1 (inside) or 2 (above c); /c after it
    ha_a = n(f"{p}_ha_a", "mul")
    e(f"{xg}.aus", f"{ha_a}.a"); e(k["halb_c"], f"{ha_a}.b")
    ha_i = n(f"{p}_ha_i", "add", b=1)
    e(f"{ha_a}.aus", f"{ha_i}.a")
    ha_w = n(f"{p}_ha_w", "wahl", n=3, norm=0, blende=0)
    e(k["minus_c"], f"{ha_w}.e1"); e(f"{xg}.aus", f"{ha_w}.e2"); e(k["c"], f"{ha_w}.e3"); e(f"{ha_i}.aus", f"{ha_w}.wahl")
    ha_n = n(f"{p}_ha_n", "mul")
    e(f"{ha_w}.aus", f"{ha_n}.a"); e(k["inv_c"], f"{ha_n}.b")
    hard = n(f"{p}_ha_z", "leitung", zeit=LATENZ_MS, max=2)
    e(f"{ha_n}.aus", f"{hard}.x")
    # --- Fold: wavefolder, 69 samples of its own (oversampled ADAA)
    fa = n(f"{p}_fo", "falter", form=0, ueber=1)
    e(x, f"{fa}.x"); e(d_db, f"{fa}.antrieb"); e(k["sym"], f"{fa}.symmetrie")
    # --- Crush: bit depth and sample rate, then a tanh knee
    kr = n(f"{p}_cr", "krume")
    e(f"{xg}.aus", f"{kr}.x"); e(k["bits"], f"{kr}.bits"); e(k["rate"], f"{kr}.rate")
    cr_s = n(f"{p}_cr_s", "saett")
    e(f"{kr}.aus", f"{cr_s}.x")
    crush = n(f"{p}_cr_z", "leitung", zeit=LATENZ_MS, max=2)
    e(f"{cr_s}.aus", f"{crush}.x")
    # --- the curve selector: Tape, Tube, Soft, Hard, Fold, Crush
    w = n(f"{p}_wahl", "wahl", n=6, blende=5)
    for i, q in enumerate([tape, tube, soft, hard, f"{fa}.aus", crush]):
        e(q if "." in q else f"{q}.aus", f"{w}.e{i + 1}")
    e(k["curve"], f"{w}.wahl")
    return f"{w}.aus"


def gain(kid, db_quelle):
    """Linear gain of a dB value: `transponiere` (hz 1) with st = dB * 1.9931535."""
    st = n(f"{kid}_st", "mul", b=DB_ZU_ST)
    e(db_quelle, f"{st}.a")
    g = n(kid, "transponiere", hz=1)
    e(f"{st}.aus", f"{g}.st")
    return f"{g}.aus"


# ---- knobs
regler("k_curve", 1, min=0, max=1)
k_drive = regler("k_drive", 2, min=0, max=36, mitte=12)
K = {
    "curve": "k_curve.aus",
    # Character: one regler node per curve role, all on knob 3
    "emph": regler("k_c_emph", 3, min=0, max=0.5) + ".aus",
    "bias": regler("k_c_bias", 3, min=-3, max=0) + ".aus",
    "dc": regler("k_c_dc", 3, min=0, max=0.2) + ".aus",
    "c": regler("k_c_c", 3, min=1, max=0.25, log=1) + ".aus",          # ceiling 1.0 .. 0.25
    "halb_c": regler("k_c_halb", 3, min=0.5, max=2, log=1) + ".aus",    # 1 / (2c), moves with c because both are log
    "inv_c": regler("k_c_inv", 3, min=1, max=4, log=1) + ".aus",        # 1 / c
    "sym": regler("k_c_sym", 3, min=-1, max=1) + ".aus",
    "bits": regler("k_c_bits", 3, min=16, max=3) + ".aus",
    "rate": regler("k_rate", 7, min=48000, max=4000, log=1, mitte=26040) + ".aus",
}
minus_c = n("k_c_minus", "mul", b=-1)
e(K["c"], f"{minus_c}.a")
K["minus_c"] = f"{minus_c}.aus"

tone_lp = regler("k_tone_lp", 4, min=2000, max=20000, log=1, mitte=19900)   # flat from 0.5 up, closes below
tone_hp = regler("k_tone_hp", 4, min=9.9, max=400, log=1, mitte=10)         # flat from 0.5 down, opens above
k_out = regler("k_out", 5, min=0.063, max=3.98, log=1)                       # -24 .. +12 dB, 0.5 = -6 dB
k_mix = regler("k_mix", 6, min=0, max=1, mitte=0.999)                        # 0.5 = wet (the translator needs mitte < max)
k_in = regler("k_in", 8, min=-12, max=12)
if BAENDER:
    k_bands = regler("k_bands", 9, min=0, max=1, mitte=0.2)   # the 0.5 fill reads zone 0 = Full (a Hard clip per band sums to 3x full scale)
    k_fc1 = regler("k_fc1", 10, min=60, max=600, log=1, mitte=200)
    k_fc2 = regler("k_fc2", 11, min=1000, max=8000, log=1, mitte=2500)
    k_lo = regler("k_lo", 12, min=-24, max=12, mitte=0)
    k_hi = regler("k_hi", 13, min=-24, max=12, mitte=0)

g_in = gain("g_in", f"{k_in}.aus")
g_main = gain("g_main", f"{k_drive}.aus")
if BAENDER:
    d_lo = n("d_lo", "add"); e(f"{k_drive}.aus", f"{d_lo}.a"); e(f"{k_lo}.aus", f"{d_lo}.b")
    d_hi = n("d_hi", "add"); e(f"{k_drive}.aus", f"{d_hi}.a"); e(f"{k_hi}.aus", f"{d_hi}.b")
    g_lo = gain("g_lo", f"{d_lo}.aus")
    g_hi = gain("g_hi", f"{d_hi}.aus")

ein = n("ein", "eingang")
minus_mix = n("minus_mix", "mul", b=-1)
e(f"{k_mix}.aus", f"{minus_mix}.a")
trocken_g = n("trocken_g", "add", a=1)
e(f"{minus_mix}.aus", f"{trocken_g}.b")
aus = n("aus", "ausgang")

for ch in ("l", "r"):
    xt = n(f"xt_{ch}", "mul")
    e(f"ein.{ch}", f"{xt}.a"); e(g_in, f"{xt}.b")
    voll = kurven(f"f{ch}", f"{xt}.aus", f"{k_drive}.aus", g_main, K)
    if BAENDER:
        kz = n(f"kz_{ch}", "kreuz", baender=3)
        e(f"{xt}.aus", f"{kz}.x"); e(f"{k_fc1}.aus", f"{kz}.fc1"); e(f"{k_fc2}.aus", f"{kz}.fc2")
        lo = kurven(f"b{ch}1", f"{kz}.lo", f"{d_lo}.aus", g_lo, K)
        mid = kurven(f"b{ch}2", f"{kz}.mid", f"{k_drive}.aus", g_main, K)
        hi = kurven(f"b{ch}3", f"{kz}.hi", f"{d_hi}.aus", g_hi, K)
        summe = n(f"bsum_{ch}", "add")
        e(lo, f"{summe}.a"); e(mid, f"{summe}.b"); e(hi, f"{summe}.c")
        sel = n(f"sel_{ch}", "wahl", n=2, blende=5)
        e(voll, f"{sel}.e1"); e(f"{summe}.aus", f"{sel}.e2"); e(f"{k_bands}.aus", f"{sel}.wahl")
        quelle = f"{sel}.aus"
    else:
        quelle = voll
    lp = n(f"lp_{ch}", "svf", reso=0)
    e(quelle, f"{lp}.x"); e(f"{tone_lp}.aus", f"{lp}.cutoff")
    hp = n(f"hp_{ch}", "svf", reso=0)
    e(f"{lp}.tp", f"{hp}.x"); e(f"{tone_hp}.aus", f"{hp}.cutoff")
    ga = n(f"out_{ch}", "mul")
    e(f"{hp}.hp", f"{ga}.a"); e(f"{k_out}.aus", f"{ga}.b")
    nass = n(f"nass_{ch}", "mul")
    e(f"{ga}.aus", f"{nass}.a"); e(f"{k_mix}.aus", f"{nass}.b")
    dly = n(f"dly_{ch}", "leitung", zeit=LATENZ_MS, max=2)
    e(f"ein.{ch}", f"{dly}.x")
    tr = n(f"tr_{ch}", "mul")
    e(f"{dly}.aus", f"{tr}.a"); e(f"{trocken_g}.aus", f"{tr}.b")
    sm = n(f"sum_{ch}", "add")
    e(f"{nass}.aus", f"{sm}.a"); e(f"{tr}.aus", f"{sm}.b")
    e(f"{sm}.aus", f"aus.{ch}")

namen = {"1": "Curve", "2": "Drive", "3": "Character", "4": "Tone", "5": "Output", "6": "Mix", "7": "Crush rate", "8": "Input"}
if BAENDER:
    namen.update({"9": "Bands", "10": "Low/Mid", "11": "Mid/High", "12": "Low drive", "13": "High drive"})
graph = {"format": "baukasten/2", "name": "fx-drive", "stimmen": 1, "regler_namen": namen, "knoten": knoten, "kanten": kanten}


def zeile(o):
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def ausgeben(g):
    z = ["{"]
    for k in ("format", "name", "stimmen"):
        z.append(f'  {json.dumps(k)}: {json.dumps(g[k])},')
    z.append('  "regler_namen": ' + json.dumps(g["regler_namen"], ensure_ascii=False) + ",")
    z.append('  "knoten": [')
    z.append(",\n".join("    " + zeile(x) for x in g["knoten"]))
    z.append("  ],")
    z.append('  "kanten": [')
    z.append(",\n".join("    " + zeile(x) for x in g["kanten"]))
    z.append("  ]")
    z.append("}")
    return "\n".join(z) + "\n"


(HIER / "demos" / "fx-drive.json").write_text(ausgeben(graph), encoding="utf-8")
print(f"fx-drive: {len(knoten)} nodes, {len(kanten)} edges, {'bands' if BAENDER else 'full band only'}")
