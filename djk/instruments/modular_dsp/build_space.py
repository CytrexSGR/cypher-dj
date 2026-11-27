#!/usr/bin/env python3
"""Builds the Cypher Space devices (convolution reverb) as graphs and panels.

Four graphs that differ only in `name` and in the `datei` of the one convolution node `raum`:
  fx-space      Hall     space-halle.f32   (the device the browser shows)
  space-raum    Room     space-raum.f32
  space-platte  Plate    space-platte.f32
  space-kammer  Chamber  space-kammer.f32
A graph holds ONE convolution, because the translator never skips a `faltung` or `hall` node (they carry tails): a graph with
every room in it would compute all of them all the time. Swapping the stage's graph chooses the room; the knobs are the same
in all four, so their values carry over. A copy with the user's own impulse response is one of these graphs with
another `name` and `datei` (node `raum`, `laenge_max` 2000 fits up to 2 s).

The `hall` block takes its decay as a fixed value, not as an input (src/uebersetzen.rs ArtDef hall: ein = x, l, r, mix), so
there is ONE instance with a fixed decay of 4 s (a tail extension; two instances behind a selector cost about 1.8 s per 61 s render each).

Run: python3 build_space.py          (writes demos/ and paneele/)
     python3 build_space.py --pruefe (fails when a committed file differs from what this script writes)
"""
import json
import pathlib
import sys

HIER = pathlib.Path(__file__).parent

# (graph name, panel room label, impulse response file)
RAEUME = [
    ("fx-space", "Hall", "space-halle.f32"),
    ("space-raum", "Room", "space-raum.f32"),
    ("space-platte", "Plate", "space-platte.f32"),
    ("space-kammer", "Chamber", "space-kammer.f32"),
]

# knob number = position + 1 (the same in all four graphs)
KNOEPFE = ["Mix", "Pre-delay", "Low cut", "High cut", "Width", "Algo blend"]


def knoten():
    n = [
        {"id": "ein", "art": "eingang"},
        {"id": "k_mix", "art": "regler", "nr": 1, "min": 0, "max": 1, "mitte": 0.25},
        {"id": "k_pre", "art": "regler", "nr": 2, "min": 0, "max": 250, "mitte": 10},
        {"id": "k_lc", "art": "regler", "nr": 3, "min": 20, "max": 1000, "log": 1, "mitte": 120},
        {"id": "k_hc", "art": "regler", "nr": 4, "min": 1000, "max": 20000, "log": 1, "mitte": 9000},
        {"id": "k_w", "art": "regler", "nr": 5, "min": 0, "max": 2, "mitte": 1},
        {"id": "k_b", "art": "regler", "nr": 6, "min": 0, "max": 1},
        {"id": "pre_l", "art": "leitung", "max": 250},
        {"id": "pre_r", "art": "leitung", "max": 250},
        {"id": "raum", "art": "faltung", "datei": "@DATEI@", "laenge_max": 2000, "mix": 1, "pre": 0},
        {"id": "hall", "art": "hall", "decay": 4.0, "mix": 1, "pre": 0},
        {"id": "minus_b", "art": "mul", "b": -1},
        {"id": "ga", "art": "add", "a": 1},
        {"id": "minus_mix", "art": "mul", "b": -1},
        {"id": "trocken_g", "art": "add", "a": 1},
    ]
    for s in "lr":
        n += [
            {"id": f"cv_{s}", "art": "mul"}, {"id": f"hl_{s}", "art": "mul"}, {"id": f"nb_{s}", "art": "add"},
            {"id": f"lc_{s}", "art": "svf", "reso": 0}, {"id": f"hc_{s}", "art": "svf", "reso": 0},
        ]
    n += [
        {"id": "m_sum", "art": "add"}, {"id": "m_mid", "art": "mul", "b": 0.5}, {"id": "r_neg", "art": "mul", "b": -1},
        {"id": "s_dif", "art": "add"}, {"id": "s_halb", "art": "mul", "b": 0.5}, {"id": "s_w", "art": "mul"},
        {"id": "s_neg", "art": "mul", "b": -1}, {"id": "o_l", "art": "add"}, {"id": "o_r", "art": "add"},
    ]
    for s in "lr":
        n += [{"id": f"nass_{s}", "art": "mul"}, {"id": f"tr_{s}", "art": "mul"}, {"id": f"sum_{s}", "art": "add"}]
    n.append({"id": "aus", "art": "ausgang"})
    return n


def kanten():
    k = []

    def e(von, nach):
        k.append({"von": von, "nach": nach})

    for s in "lr":
        e(f"ein.{s}", f"pre_{s}.x")
        e("k_pre.aus", f"pre_{s}.zeit")
        for ziel in ("raum", "hall"):
            e(f"pre_{s}.aus", f"{ziel}.{s}")
    e("k_b.aus", "minus_b.a")
    e("minus_b.aus", "ga.b")
    for s in "lr":
        e(f"raum.{s}", f"cv_{s}.a")
        e("ga.aus", f"cv_{s}.b")
        e(f"hall.{s}", f"hl_{s}.a")
        e("k_b.aus", f"hl_{s}.b")
        e(f"cv_{s}.aus", f"nb_{s}.a")
        e(f"hl_{s}.aus", f"nb_{s}.b")
        e(f"nb_{s}.aus", f"lc_{s}.x")
        e("k_lc.aus", f"lc_{s}.cutoff")
        e(f"lc_{s}.hp", f"hc_{s}.x")
        e("k_hc.aus", f"hc_{s}.cutoff")
    e("hc_l.tp", "m_sum.a")
    e("hc_r.tp", "m_sum.b")
    e("m_sum.aus", "m_mid.a")
    e("hc_r.tp", "r_neg.a")
    e("hc_l.tp", "s_dif.a")
    e("r_neg.aus", "s_dif.b")
    e("s_dif.aus", "s_halb.a")
    e("s_halb.aus", "s_w.a")
    e("k_w.aus", "s_w.b")
    e("s_w.aus", "s_neg.a")
    e("m_mid.aus", "o_l.a")
    e("s_w.aus", "o_l.b")
    e("m_mid.aus", "o_r.a")
    e("s_neg.aus", "o_r.b")
    e("k_mix.aus", "minus_mix.a")
    e("minus_mix.aus", "trocken_g.b")
    for s in "lr":
        e(f"o_{s}.aus", f"nass_{s}.a")
        e("k_mix.aus", f"nass_{s}.b")
        e(f"ein.{s}", f"tr_{s}.a")
        e("trocken_g.aus", f"tr_{s}.b")
        e(f"nass_{s}.aus", f"sum_{s}.a")
        e(f"tr_{s}.aus", f"sum_{s}.b")
        e(f"sum_{s}.aus", f"aus.{s}")
    return k


def graph(name, datei):
    n = json.loads(json.dumps(knoten()).replace("@DATEI@", datei))
    return {"format": "baukasten/2", "name": name, "stimmen": 1,
            "regler_namen": {str(i + 1): t for i, t in enumerate(KNOEPFE)}, "knoten": n, "kanten": kanten()}


def text_graph(g):
    z = lambda o: json.dumps(o, ensure_ascii=False, separators=(", ", ": "))
    rn = "{" + ", ".join(f"{z(k)}: {z(v)}" for k, v in g["regler_namen"].items()) + "}"
    return ("{\n"
            f'  "format": {z(g["format"])},\n  "name": {z(g["name"])},\n  "stimmen": {g["stimmen"]},\n'
            f'  "regler_namen": {rn},\n'
            '  "knoten": [\n' + ",\n".join("    " + z(x) for x in g["knoten"]) + "\n  ],\n"
            '  "kanten": [\n' + ",\n".join("    " + z(x) for x in g["kanten"]) + "\n  ]\n}\n")


def panel(name, raum):
    wirkt = '"wirkt": {"ueber": ["mix", 0.02]}, "wirkt_text": "Dry only: turn up Mix"'
    return f'''{{
  "format": "cypherdj-panel/2",
  "geraet": {{"art": "bk", "graph": "{name}"}},
  "title": "Cypher Space",
  "akzent": "tuerkis",
  "sections": [
    {{ "id": "space", "title": "SPACE", "cols": 2, "controls": [
      {{"id": "l1", "type": "label", "span": 2, "text": "Room: {raum}. Other rooms: ROOM in the header, presets, or LOAD IR"}},
      {{"id": "mix", "type": "knob", "label": "Mix", "bind": {{"param": "k1"}}, "format": "percent", "default": 0.5}},
      {{"id": "pre", "type": "knob", "label": "Pre-delay", "bind": {{"param": "k2"}}, "format": "ms", "default": 0.5, {wirkt}}}
    ]}},
    {{ "id": "ton", "title": "TONE", "cols": 3, "controls": [
      {{"id": "lc", "type": "knob", "label": "Low cut", "bind": {{"param": "k3"}}, "format": "hz", "default": 0.5, {wirkt}}},
      {{"id": "hc", "type": "knob", "label": "High cut", "bind": {{"param": "k4"}}, "format": "hz", "default": 0.5, {wirkt}}},
      {{"id": "breite", "type": "knob", "label": "Width", "bind": {{"param": "k5"}}, "format": "percent", "default": 0.5, {wirkt}}}
    ]}},
    {{ "id": "blend", "title": "BLEND", "cols": 1, "controls": [
      {{"id": "algo", "type": "knob", "label": "Algo blend", "bind": {{"param": "k6"}}, "format": "percent", "default": 0, {wirkt}}}
    ]}}
  ]
}}
'''


def dateien():
    d = {}
    for name, raum, datei in RAEUME:
        d[HIER / "demos" / f"{name}.json"] = text_graph(graph(name, datei))
        d[HIER / "paneele" / f"{name}.json"] = panel(name, raum)
    return d


if __name__ == "__main__":
    d = dateien()
    if "--pruefe" in sys.argv:
        schlecht = [str(p) for p, t in d.items() if not p.exists() or p.read_text() != t]
        if schlecht:
            print("differs:", *schlecht, sep="\n  ")
            sys.exit(1)
        print("ok", len(d), "files")
    else:
        for p, t in d.items():
            p.write_text(t)
            json.loads(t)
        print("wrote", len(d), "files")
