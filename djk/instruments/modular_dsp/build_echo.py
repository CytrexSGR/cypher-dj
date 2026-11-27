#!/usr/bin/env python3
"""Builds the graph of the Cypher Echo device `fx-echo` (character delay) from existing blocks.

Run after changing the table:  python3 build_echo.py   (writes demos/fx-echo.json). The panel is paneele/fx-echo.json (by hand).

Signal path, per side s (L, R):
  input -> [ping-pong wahl: own input | mono sum on L, silence on R] -> leitung (tape wow, 3 ms + wow) -> sum_s
  sum_s -> 8 delays (7 beat divisions + Free) -> wahl (Time)            each delay returns its input plus the echo (mix 1), the
  wahl output minus sum_s is the echo alone                             sum is subtracted again after the wahl
  echo -> svf high-pass -> svf low-pass -> saett (Drive) -> mul Feedback -> [ping-pong wahl: own side | other side]
       -> sum_s of the next round (edge with verzoegerung 1, graph rule G-d)
  echo * (1 - Duck * saett(folger(mono input))) * Mix + input * (1 - Mix) -> output
"""
import json
import pathlib

HIER = pathlib.Path(__file__).parent

# (division, beats)
ZEITEN = [("1/16", 0.25), ("1/8", 0.5), ("1/8 dotted", 0.75), ("1/4", 1), ("1/4 dotted", 1.5), ("1/2", 2), ("1 bar", 4)]

# knob table: (nr, name, regler fields); the position in the list is the knob number
K = [
    (1, "Time", dict(min=0, max=1)),
    (2, "Free time", dict(min=10, max=2000, log=1, mitte=375)),
    (3, "Feedback", dict(min=0, max=0.95, mitte=0.45)),
    (4, "Low cut", dict(min=20, max=1000, log=1, mitte=100)),
    (5, "High cut", dict(min=1000, max=16000, log=1, mitte=5000)),
    (6, "Drive", dict(min=0, max=18, mitte=3)),
    (7, "Ping-pong", dict(min=0, max=1)),
    (8, "Wow", dict(min=0, max=1, mitte=0.2)),
    (9, "Duck", dict(min=0, max=1, mitte=0.02)),
    (10, "Duck release", dict(min=50, max=1000, log=1, mitte=250)),
    (11, "Mix", dict(min=0, max=1, mitte=0.35)),
]
KN = {name: nr for nr, name, _ in K}

knoten = []
kanten = []


def n(id, art, **w):
    knoten.append({"id": id, "art": art, **w})


def e(von, nach, verz=False):
    k = {"von": von, "nach": nach}
    if verz:
        k["verzoegerung"] = 1
    kanten.append(k)


n("ein", "eingang")
for nr, name, f in K:
    n("k_%d" % nr, "regler", nr=nr, **f)
n("aus", "ausgang")


def knopf(name):
    return "k_%d.aus" % KN[name]


# ---- ping-pong selector (Off / On) on the input side and on the feedback side
n("mono", "mul", b=0.5)
n("mono_s", "add")
e("ein.l", "mono_s.a")
e("ein.r", "mono_s.b")
e("mono_s.aus", "mono.a")
n("null", "konst", wert=0)
n("in_l", "wahl", n=2, blende=30)
n("in_r", "wahl", n=2, blende=30)
e("ein.l", "in_l.e1")
e("mono.aus", "in_l.e2")
e("ein.r", "in_r.e1")
e("null.aus", "in_r.e2")
for s in "lr":
    e(knopf("Ping-pong"), "in_%s.wahl" % s)

# ---- tape wow on the input of the loop: 3 ms + Wow * 2 ms * (slow wobble + 0.25 flutter)
n("rate_w", "konst", wert=0.7)
n("rate_f", "konst", wert=6)
n("lfo_w", "lfo", form=0, takt=0)
n("lfo_f", "lfo", form=0, takt=0)
n("flatter", "mul", b=0.25)
n("wow_m", "add")
n("wow_t", "mul")
n("wow_ms", "mul", b=2)
n("wow_z", "add", b=3)
e("rate_w.aus", "lfo_w.rate")
e("rate_f.aus", "lfo_f.rate")
e("lfo_f.aus", "flatter.a")
e("lfo_w.aus", "wow_m.a")
e("flatter.aus", "wow_m.b")
e("wow_m.aus", "wow_t.a")
e(knopf("Wow"), "wow_t.b")
e("wow_t.aus", "wow_ms.a")
e("wow_ms.aus", "wow_z.a")
for s in "lr":
    n("wow_%s" % s, "leitung", zeit=3, max=10)
    e("in_%s.aus" % s, "wow_%s.x" % s)
    e("wow_z.aus", "wow_%s.zeit" % s)

# ---- loop sum, delays, time selector
for s in "lr":
    n("sum_%s" % s, "add")
    e("wow_%s.aus" % s, "sum_%s.a" % s)
for i, (name, takt) in enumerate(ZEITEN):
    n("d%d" % i, "delay", takt=takt, fb=0, mix=1, max=4000, daempf=0, pingpong=0)
n("d7", "delay", takt=0, zeit=375, fb=0, mix=1, max=2000, daempf=0, pingpong=0)
e(knopf("Free time"), "d7.zeit")
for s in "lr":
    n("zeit_%s" % s, "wahl", n=8, blende=30)
    e(knopf("Time"), "zeit_%s.wahl" % s)
for i in range(8):
    for s in "lr":
        e("sum_%s.aus" % s, "d%d.%s" % (i, s))
        e("d%d.%s" % (i, s), "zeit_%s.e%d" % (s, i + 1))

# ---- echo alone, feedback path
for s in "lr":
    n("minus_%s" % s, "mul", b=-1)
    n("echo_%s" % s, "add")
    e("sum_%s.aus" % s, "minus_%s.a" % s)
    e("zeit_%s.aus" % s, "echo_%s.a" % s)
    e("minus_%s.aus" % s, "echo_%s.b" % s)
    n("hp_%s" % s, "svf", reso=0)
    n("lp_%s" % s, "svf", reso=0)
    n("sat_%s" % s, "saett")
    n("fb_%s" % s, "mul")
    e("echo_%s.aus" % s, "hp_%s.x" % s)
    e(knopf("Low cut"), "hp_%s.cutoff" % s)
    e("hp_%s.hp" % s, "lp_%s.x" % s)
    e(knopf("High cut"), "lp_%s.cutoff" % s)
    e("lp_%s.tp" % s, "sat_%s.x" % s)
    e(knopf("Drive"), "sat_%s.antrieb" % s)
    e("sat_%s.aus" % s, "fb_%s.a" % s)
    e(knopf("Feedback"), "fb_%s.b" % s)
for s, o in (("l", "r"), ("r", "l")):
    n("quelle_%s" % s, "wahl", n=2, blende=30)
    e("fb_%s.aus" % s, "quelle_%s.e1" % s)
    e("fb_%s.aus" % o, "quelle_%s.e2" % s)
    e(knopf("Ping-pong"), "quelle_%s.wahl" % s)
    e("quelle_%s.aus" % s, "sum_%s.b" % s, verz=True)

# ---- ducking by the input
n("duck_fol", "folger", an=5)
n("duck_sat", "saett")
n("duck_an", "konst", wert=9)
n("duck_t", "mul")
n("duck_neg", "mul", b=-1)
n("duck_g", "add", b=1)
e("mono.aus", "duck_fol.x")
e(knopf("Duck release"), "duck_fol.ab")
e("duck_fol.aus", "duck_sat.x")
e("duck_an.aus", "duck_sat.antrieb")
e("duck_sat.aus", "duck_t.a")
e(knopf("Duck"), "duck_t.b")
e("duck_t.aus", "duck_neg.a")
e("duck_neg.aus", "duck_g.a")

# ---- mix
n("mix_neg", "mul", b=-1)
n("mix_g", "add", b=1)
e(knopf("Mix"), "mix_neg.a")
e("mix_neg.aus", "mix_g.a")
for s in "lr":
    n("duck_%s" % s, "mul")
    n("nass_%s" % s, "mul")
    n("tr_%s" % s, "mul")
    n("sum_o_%s" % s, "add")
    e("echo_%s.aus" % s, "duck_%s.a" % s)
    e("duck_g.aus", "duck_%s.b" % s)
    e("duck_%s.aus" % s, "nass_%s.a" % s)
    e(knopf("Mix"), "nass_%s.b" % s)
    e("ein.%s" % s, "tr_%s.a" % s)
    e("mix_g.aus", "tr_%s.b" % s)
    e("nass_%s.aus" % s, "sum_o_%s.a" % s)
    e("tr_%s.aus" % s, "sum_o_%s.b" % s)
    e("sum_o_%s.aus" % s, "aus.%s" % s)

graph = {"format": "baukasten/2", "name": "fx-echo", "stimmen": 1,
         "regler_namen": {str(nr): name for nr, name, _ in K}, "knoten": knoten, "kanten": kanten}


def zeile(o):
    return "    " + json.dumps(o, ensure_ascii=False)


text = ('{\n  "format": "baukasten/2",\n  "name": "fx-echo",\n  "stimmen": 1,\n  "regler_namen": %s,\n  "knoten": [\n%s\n  ],\n  "kanten": [\n%s\n  ]\n}\n'
        % (json.dumps(graph["regler_namen"], ensure_ascii=False), ",\n".join(map(zeile, knoten)), ",\n".join(map(zeile, kanten))))
(HIER / "demos" / "fx-echo.json").write_text(text)
print("fx-echo: %d nodes, %d edges" % (len(knoten), len(kanten)))
