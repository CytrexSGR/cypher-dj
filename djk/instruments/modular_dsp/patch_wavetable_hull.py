#!/usr/bin/env python3
"""Adds the wave envelope (Waldorf Microwave style: the wavetable position as a per-note path) to the wavetable graphs
`wavetable-chor`, `wavetable-reese` and `wavetable-supersaw`. Idempotent.

    python3 patch_wavetable_hull.py       # patches beispiele/wavetable-*.json in place

New knobs (all three graphs): 7 Wave env amount (bipolar, -1..1, knob centre = 0 = off), 8 Wave env attack (5 ms .. 4 s),
9 Wave env decay (50 ms .. 6 s). A dedicated `adsr` (sustain 0, release 0.3 s) restarts with every note; its output times the
amount is added to the oscillator's `pos`. Amount 0 adds +0.0, so the old sound is bit for bit unchanged.

`wavetable-chor` already moves `pos` (vowel knob + slow motion): the envelope is a third input of that sum.
`wavetable-reese` and `wavetable-supersaw` used table 0 (one frame, `pos` would do nothing). They now use table 4 ("analog":
sine, triangle, saw, square) and rest on frame 2 = the saw, at pos 2/3, so the sound is the old saw exactly; a positive amount
morphs the saw toward the square, a negative one toward triangle and sine.
"""
import json
import pathlib

HIER = pathlib.Path(__file__).resolve().parent
NAMEN = {"7": "Wave env amount", "8": "Wave env attack", "9": "Wave env decay"}


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


def patch(name):
    pfad = HIER / "demos" / f"{name}.json"
    g = json.loads(pfad.read_text())
    K, E = g["knoten"], g["kanten"]
    if any(k["id"] == "wenv" for k in K):
        print(name, "already patched")
        return
    osz = next(k for k in K if k["id"] == "osz")
    K.append({"id": "k_wamt", "art": "regler", "nr": 7, "min": -1, "max": 1})
    K.append({"id": "k_watt", "art": "regler", "nr": 8, "min": 0.005, "max": 4, "log": 1})
    K.append({"id": "k_wdec", "art": "regler", "nr": 9, "min": 0.05, "max": 6, "log": 1})
    K.append({"id": "wenv", "art": "adsr", "a": 0.01, "d": 0.5, "s": 0, "r": 0.3})
    K.append({"id": "wmod", "art": "mul"})
    E += [{"von": "note.gate", "nach": "wenv.gate"}, {"von": "note.trig", "nach": "wenv.trig"},
          {"von": "k_watt.aus", "nach": "wenv.a"}, {"von": "k_wdec.aus", "nach": "wenv.d"},
          {"von": "wenv.aus", "nach": "wmod.a"}, {"von": "k_wamt.aus", "nach": "wmod.b"}]
    if any(e["nach"] == "osz.pos" for e in E):
        # chor: `pos` is an add of vowel and motion; the envelope is its third input
        pos = next(e["von"].split(".")[0] for e in E if e["nach"] == "osz.pos")
        assert next(k for k in K if k["id"] == pos)["art"] == "add"
        E.append({"von": "wmod.aus", "nach": f"{pos}.c"})
    else:
        assert osz["tabelle"] == 0
        osz["tabelle"] = 4
        K.append({"id": "pos", "art": "add", "a": 0.6666667})
        E += [{"von": "wmod.aus", "nach": "pos.b"}, {"von": "pos.aus", "nach": "osz.pos"}]
    g["regler_namen"].update(NAMEN)
    schreibe(pfad, g)
    print(name, len(K), "nodes", len(E), "edges")


for n in ("wavetable-chor", "wavetable-reese", "wavetable-supersaw"):
    patch(n)
