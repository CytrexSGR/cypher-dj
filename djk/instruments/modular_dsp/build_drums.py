#!/usr/bin/env python3
"""Generates demos/drums-909.json, demos/drums-808.json and their front plates paneele/*.json.

The two graphs are one `trommeln` node (the kit) fed by a `note` node, with `regler` nodes on the parameters that have a knob;
every other parameter is a fixed value on the node. Run from the baukasten_dsp folder: python3 build_drums.py
"""
import json


def L(lo, hi): return (lo, hi, 1)
def N(lo, hi): return (lo, hi, 0)


# knob nr: (label, input, (min, max, log), panel format, unit)
KNOBS_909 = {
    1: ("Kick Tune", "kick_tune", L(36, 81), "hz", ""),
    2: ("Kick Decay", "kick_decay", L(60, 2400), "ms", ""),
    3: ("Kick Punch", "kick_punch", N(0, 48), "raw", "st"),
    4: ("Snare Snappy", "snare_snappy", N(0, 1), "percent", ""),
    5: ("Snare Tune", "snare_tune", L(120, 300), "hz", ""),
    6: ("Hat Decay", "oh_decay", L(80, 1800), "ms", ""),
    7: ("Drive", "drive", N(0, 1), "percent", ""),
    8: ("Filter", "filter", N(0, 1), "percent", ""),
    9: ("Kick Pitch Time", "kick_pdecay", L(2, 100), "ms", ""),
    10: ("Kick Click", "kick_click", N(0, 1), "percent", ""),
    11: ("Snare Decay", "snare_decay", L(60, 800), "ms", ""),
    12: ("Snare Tone", "snare_tone", N(0, 1), "percent", ""),
    13: ("Clap Decay", "clap_decay", L(80, 1000), "ms", ""),
    14: ("Clap Tone", "clap_tone", N(0, 1), "percent", ""),
    15: ("Tom Low Tune", "tomlo_tune", L(60, 120), "hz", ""),
    16: ("Tom Mid Tune", "tommid_tune", L(90, 180), "hz", ""),
    17: ("Tom High Tune", "tomhi_tune", L(135, 270), "hz", ""),
    18: ("Tom Decay", "tom_decay", L(120, 1500), "ms", ""),
    19: ("Tom Punch", "tom_punch", N(0, 28), "raw", "st"),
    20: ("Hat Tone", "hat_tone", N(0, 1), "percent", ""),
    21: ("Hat Tune", "hat_tune", L(0.7, 1.43), "raw", "x"),
    22: ("Closed Hat Decay", "ch_decay", L(15, 200), "ms", ""),
    23: ("Crash Decay", "crash_decay", L(600, 5400), "ms", ""),
    24: ("Ride Decay", "ride_decay", L(400, 4200), "ms", ""),
    25: ("Rim Tune", "rim_tune", L(330, 700), "hz", ""),
    26: ("Clap Spread", "clap_spread", N(0, 1), "percent", ""),
    27: ("Filter Resonance", "reso", N(0, 1), "percent", ""),
    28: ("Crash Tune", "crash_tune", L(0.7, 1.43), "raw", "x"),
    29: ("Ride Tune", "ride_tune", L(0.7, 1.43), "raw", "x"),
    30: ("Hat Noise", "hat_noise", N(0, 1), "percent", ""),
    31: ("Level", "pegel", N(0, 2), "percent", ""),
    32: ("Kick Drive", "kick_drive", N(0, 1), "percent", ""),
}
KNOBS_808 = {
    1: ("Kick Tune", "kick_tune", L(34, 74), "hz", ""),
    2: ("Kick Decay", "kick_decay", L(100, 3000), "ms", ""),
    3: ("Kick Punch", "kick_punch", N(0, 24), "raw", "st"),
    4: ("Snare Snappy", "snare_snappy", N(0, 1), "percent", ""),
    5: ("Snare Tune", "snare_tune", L(126, 257), "hz", ""),
    6: ("Hat Decay", "oh_decay", L(80, 1800), "ms", ""),
    7: ("Drive", "drive", N(0, 1), "percent", ""),
    8: ("Filter", "filter", N(0, 1), "percent", ""),
    9: ("Kick Pitch Time", "kick_pdecay", L(6, 130), "ms", ""),
    10: ("Kick Click", "kick_click", N(0, 1), "percent", ""),
    11: ("Snare Decay", "snare_decay", L(70, 820), "ms", ""),
    12: ("Snare Tone", "snare_tone", N(0, 1), "percent", ""),
    13: ("Clap Decay", "clap_decay", L(60, 960), "ms", ""),
    14: ("Clap Tone", "clap_tone", N(0, 1), "percent", ""),
    15: ("Tom Low Tune", "tomlo_tune", L(56, 114), "hz", ""),
    16: ("Tom Mid Tune", "tommid_tune", L(84, 171), "hz", ""),
    17: ("Tom High Tune", "tomhi_tune", L(116, 235), "hz", ""),
    18: ("Tom Decay", "tom_decay", L(140, 1800), "ms", ""),
    19: ("Tom Punch", "tom_punch", N(0, 16), "raw", "st"),
    20: ("Hat Tone", "hat_tone", N(0, 1), "percent", ""),
    21: ("Closed Hat Decay", "ch_decay", L(12, 170), "ms", ""),
    22: ("Cymbal Decay", "crash_decay", L(800, 6000), "ms", ""),
    23: ("Cowbell Tune", "cow_tune", L(0.5, 2), "raw", "x"),
    24: ("Cowbell Decay", "cow_decay", L(80, 1300), "ms", ""),
    25: ("Boom Decay", "boom_decay", L(800, 6000), "ms", ""),
    26: ("Boom Tune", "boom_tune", L(30, 56), "hz", ""),
    27: ("Clave Tune", "clave_tune", L(1800, 3500), "hz", ""),
    28: ("Rim Tune", "rim_tune", L(320, 650), "hz", ""),
    29: ("Filter Resonance", "reso", N(0, 1), "percent", ""),
    30: ("Level", "pegel", N(0, 2), "percent", ""),
    31: ("Hat Tune", "hat_tune", L(0.7, 1.43), "raw", "x"),
    32: ("Clap Spread", "clap_spread", N(0, 1), "percent", ""),
}
# fixed values of the parameters that have no knob (the model's own character)
FIX_909 = {"ride_tune": 1.0, "crash_tune": 1.0, "cow_tune": 1.0, "cow_decay": 320, "boom_tune": 41, "boom_decay": 2200, "clave_tune": 2500}
FIX_808 = {"kick_drive": 0.35, "crash_tune": 1.0, "ride_tune": 1.0, "ride_decay": 1300}
# the Level knob runs 0..2 * PEGEL, so knob 0.5 gives PEGEL
PEGEL = {"drums-909": 1.0, "drums-808": 1.0}


def graph(modell, knobs, fix, name):
    kn = [{"id": "note", "art": "note"}]
    kit = {"id": "kit", "art": "trommeln", "modell": modell, "schnitt": 8}
    kit.update(fix)
    kn.append(kit)
    ka = [{"von": "note.trig", "nach": "kit.trig"}, {"von": "note.vel", "nach": "kit.vel"}, {"von": "note.hz", "nach": "kit.hz"}]
    names = {}
    for nr, (label, inp, (lo, hi, log), fmt, unit) in knobs.items():
        if inp == "pegel":
            hi = hi * PEGEL[name]
        r = {"id": "k_" + inp, "art": "regler", "nr": nr, "min": lo, "max": round(hi, 6)}
        if log:
            r["log"] = 1
        kn.append(r)
        ka.append({"von": "k_%s.aus" % inp, "nach": "kit." + inp})
        names[str(nr)] = label
    kn.append({"id": "aus", "art": "ausgang"})
    ka.append({"von": "kit.aus", "nach": "aus.x"})
    return {"format": "baukasten/2", "name": name, "stimmen": 16, "regler_namen": names, "knoten": kn, "kanten": ka}


def fmt_json(g):
    out = ['{', '  "format": "%s",' % g["format"], '  "name": "%s",' % g["name"], '  "stimmen": %d,' % g["stimmen"],
           '  "regler_namen": ' + json.dumps(g["regler_namen"]) + ',', '  "knoten": [']
    out += ['    ' + json.dumps(k) + (',' if i < len(g["knoten"]) - 1 else '') for i, k in enumerate(g["knoten"])]
    out += ['  ],', '  "kanten": [']
    out += ['    ' + json.dumps(k) + (',' if i < len(g["kanten"]) - 1 else '') for i, k in enumerate(g["kanten"])]
    out += ['  ]', '}']
    return "\n".join(out) + "\n"


def ctrl(nr, knobs):
    lab, inp, rng, fmt, unit = knobs[nr]
    c = {"id": inp.replace("_", "-"), "type": "knob", "label": lab, "bind": {"param": "k%d" % nr}, "format": fmt, "default": 0.5}
    if fmt == "raw" and unit:
        c["unit"] = unit
    return c


def fmt_panel(name, title, knobs, sections):
    out = ['{', '  "format": "cypherdj-panel/2",', '  "geraet": {"art": "bk", "graph": "%s"},' % name, '  "title": "%s",' % title, '  "akzent": "rot",', '  "sections": [']
    for i, (sid, st, cols, nrs) in enumerate(sections):
        out.append('    { "id": "%s", "title": "%s", "cols": %d, "controls": [' % (sid, st, cols))
        out += ['      ' + json.dumps(ctrl(n, knobs)) + (',' if j < len(nrs) - 1 else '') for j, n in enumerate(nrs)]
        out.append('    ]}' + (',' if i < len(sections) - 1 else ''))
    out += ['  ]', '}']
    return "\n".join(out) + "\n"


SEC_909 = [
    ("kick", "KICK", 3, [1, 2, 3, 9, 10, 32]),
    ("snare", "SNARE", 4, [5, 4, 11, 12]),
    ("clap", "CLAP / RIM", 4, [13, 14, 26, 25]),
    ("toms", "TOMS", 5, [15, 16, 17, 18, 19]),
    ("hats", "HATS", 5, [6, 22, 20, 21, 30]),
    ("cym", "CYMBALS", 4, [23, 28, 24, 29]),
    ("out", "OUT", 4, [7, 8, 27, 31]),
]
SEC_808 = [
    ("kick", "KICK / BOOM", 4, [1, 2, 3, 9, 10, 25, 26]),
    ("snare", "SNARE", 4, [5, 4, 11, 12]),
    ("clap", "CLAP / RIM", 4, [13, 14, 32, 28]),
    ("toms", "TOMS", 5, [15, 16, 17, 18, 19]),
    ("hats", "HATS", 4, [6, 21, 20, 31]),
    ("perc", "CYMBAL / PERC", 4, [22, 23, 24, 27]),
    ("out", "OUT", 4, [7, 8, 29, 30]),
]

if __name__ == "__main__":
    for modell, knobs, fix, name, sec, title in [(0, KNOBS_909, FIX_909, "drums-909", SEC_909, "Drums 909"),
                                                  (1, KNOBS_808, FIX_808, "drums-808", SEC_808, "Drums 808")]:
        used = sorted(n for s in sec for n in s[3])
        assert used == sorted(knobs), (name, set(knobs) ^ set(used))
        open("beispiele/%s.json" % name, "w").write(fmt_json(graph(modell, knobs, fix, name)))
        open("paneele/%s.json" % name, "w").write(fmt_panel(name, title, knobs, sec))
        print("wrote", name)
