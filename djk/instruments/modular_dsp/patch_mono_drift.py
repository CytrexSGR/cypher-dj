#!/usr/bin/env python3
"""Adds the per-voice analog Drift knob (knob 32) to beispiele/synth-mono.json. Idempotent.

    python3 patch_mono_drift.py            # patches demos/synth-mono.json in place

synth-mono.json has no committed generator, so this script rewires the committed graph instead. Drift 0 is exactly the old
sound: every deviation is added to (or multiplied onto) a signal as +0.0 (x1.0).
At Drift 1: oscillator pitch +-6 cent (osc 1 and osc 2 independent), cutoff +-8 %, envelope times +-10 %, pulse width +-0.08.
"""
import json
import math
import pathlib

HIER = pathlib.Path(__file__).resolve().parent
PFAD = HIER / "demos" / "synth-mono.json"
DRIFT_CENT, DRIFT_CUT, DRIFT_ENV, DRIFT_PW = 6.0, 12 * math.log2(1.08), 0.10, 0.08

g = json.loads(PFAD.read_text())
if any(k["id"] == "k_drift" for k in g["knoten"]):
    raise SystemExit("already patched")
K, E = g["knoten"], g["kanten"]


def node(id, art, **w):
    K.append({"id": id, "art": art, **w})


def edge(a, b):
    E.append({"von": a, "nach": b})


def retarget(nach, neu):
    """Replace the single edge into `nach` by one from `neu`."""
    i = [i for i, e in enumerate(E) if e["nach"] == nach]
    assert len(i) == 1, (nach, i)
    E[i[0]]["von"] = neu


def mul_edge(id, a, b):
    node(id, "mul")
    edge(a, f"{id}.a")
    edge(b, f"{id}.b")
    return f"{id}.aus"


def mul_fix(id, a, b):
    node(id, "mul", b=b)
    edge(a, f"{id}.a")
    return f"{id}.aus"


node("k_drift", "regler", nr=32, min=0, max=1)
for nm, saat, fest in (("d_pitch1", 31, 0.4), ("d_pitch2", 32, 0.4), ("d_cut", 33, 0.4), ("d_env", 34, 0.7), ("d_pw", 35, 0.4)):
    node(nm, "drift", rate=0.3, fest=fest, saat=saat)


def amt(nm, scale):
    return mul_fix(f"dr_{nm}", mul_edge(f"dr_{nm}_a", f"d_{nm}.aus", "k_drift.aus"), scale)


# pitch: osc 1 chain (hz_m also feeds the sub and osc 2) gets its own drift on `cent`; osc 2 adds a second one to its detune
edge(amt("pitch1", DRIFT_CENT), "hz_m.cent")
node("det2", "add")
edge("k_detune.aus", "det2.a")
edge(amt("pitch2", DRIFT_CENT), "det2.b")
retarget("hz2.cent", "det2.aus")
# cutoff: third input of the modulation sum (also feeds the band-pass centre)
edge(amt("cut", DRIFT_CUT), "mod_st.c")
# pulse width
edge(amt("pw", DRIFT_PW), "pw.c")
# envelope times: one factor per voice on every time of both envelopes
node("env_f", "add", a=1.0)
edge(mul_fix("dr_env", mul_edge("dr_env_a", "d_env.aus", "k_drift.aus"), DRIFT_ENV), "env_f.b")
for env, fixed_a in (("fenv", 0.001), ("aenv", 0.002)):
    edge(mul_fix(f"{env}_a_f", "env_f.aus", fixed_a), f"{env}.a")
for port, quelle in (("fenv.d", "k_fdecay.aus"), ("fenv.r", "k_arel.aus"), ("aenv.d", "k_adecay.aus"), ("aenv.r", "k_arel.aus")):
    retarget(port, mul_edge(f"{port.replace('.', '_')}_f", quelle, "env_f.aus"))
g["regler_namen"]["32"] = "Drift"

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
