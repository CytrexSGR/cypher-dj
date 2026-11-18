#!/usr/bin/env python3
"""Synth upgrade wave 1 for synth-mono (plan 2026-11-18, Task A): chaos LFO and a clean sub as new knobs. Refuses a second run.

    python3 patch_mono_neu.py            # patches demos/synth-mono.json in place

New knobs (class in brackets, see ausbau.py):
  58 Chaos rate [F, 0.05 .. 20 Hz log, default 0.5 Hz]   the `chaos` node (Lorenz, `form` 0, seeded per voice); reaches the sound only through 61 and 62
  61 Chaos to cutoff [G bipolar, +-36 st]                `aus` x amount joins the cutoff semitone sum where MOD ENV, LFO 2 and velocity add (term last)
  62 Chaos to osc 2 pitch [G bipolar, +-50 ct]           `aus2` x amount joins the cent input of the osc 2 transposer (term last)
  63 Clean sub [G, level 0 .. 1]                         a sine one octave below the (drifted, glided, tuned) note, times the amp envelope and the
                                                         accent gain, joined to the voice after the filter, both saturators, DC block and
                                                         amp stage, in front of the chorus / delay / reverb section. Knob 64 stays free.

Every new term is `signal x amount` with an amount of exactly 0.0 at the default and joins an existing signal through an `add` whose new
term is last, so old + 0.0 is the old value bit for bit. `measure_null.py run synth-mono-neu` proves it against the graph before this patch.
"""
import json
import pathlib

import ausbau as A

HIER = pathlib.Path(__file__).resolve().parent
PFAD = HIER / "demos" / "synth-mono.json"

g = json.loads(PFAD.read_text())
if any(k["id"] == "chaos_node" for k in g["knoten"]):
    raise SystemExit("already patched")
K, E = g["knoten"], g["kanten"]
info = A._Info()

# ---- 58, 61, 62: chaos ---------------------------------------------------------------------------------------------------------------
rate = A._f(g, info, "chaos_k_rate", 58, "Chaos rate", 0.05, 20, 0.5, log=True)
A.knoten(g, "chaos_node", "chaos", form=0)
A.kante(g, rate, "chaos_node.rate")
cut = A._g_bi(g, info, "chaos_k_cut", 61, "Chaos to cutoff", 36)
A.summe_erweitern(g, "chaos_cut", "vcut_cut.aus", A.mul(g, "chaos_cut_t", "chaos_node.aus", cut))
pit = A._g_bi(g, info, "chaos_k_pit2", 62, "Chaos to osc2 pitch", 50)
A.einspeisen(g, "chaos_pit2", "hz2.cent", A.mul(g, "chaos_pit2_t", "chaos_node.aus2", pit))

# ---- 63: clean sub (shares the sine of the sub oscillator, one octave down, so both stay phase-locked when both are heard) ----------------
lv = A._g_uni(g, info, "csub_k", 63, "Clean sub", 1.0)
s = A.mul(g, "csub_env", "sub_sin.aus", "aenv.aus")
s = A.mul(g, "csub_acc", s, "amp_g.aus")
s = A.mul(g, "csub_lv", s, lv)
s = A.mul(g, "csub_gain", s, 0.3)
A.summe_erweitern(g, "csub_sum", "pegel.aus", s)

g["regler_namen"].update({str(nr): n for nr, n in info.namen.items()})

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
