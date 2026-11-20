#!/usr/bin/env python3
"""Builds the Baukasten instrument `drum-synth` (Drum Synth): a kit of eight pads, every pad a Baukasten drum recipe.

    python3 build_drumsynth.py          # writes demos/drum-synth.json and paneele/drum-synth.json

Run from the modular_dsp folder. The graph is generated from the recipe graphs in demos/recipes/ (drums-kick, drums-snare, ...):
for every pad the part of the recipe that makes the sound (everything from `note` up to the tap node, before the recipe's own
room, compressor and output stage) is copied with its ids prefixed by the pad name, its knobs renumbered and its `note` node
replaced by the shared one. Choosing another recipe for a pad means changing one line of PADS and running this script.

Signal path (8 voices, latency 0, mono):

  note.hz -> notenwahl (the note picks the pad: index 0..7, a note that no pad owns plays the pad below)
  every pad: recipe sound -> trim (fixed, sets the pad's own level) -> Level knob -> candidate of the `wahl`
  wahl (hard switch, norm 0): the voice outputs only the pad of its note; the exclusive branches of the pads nobody plays are skipped
  -> x note.vel -> x Master knob -> ausgang

Every pad keeps the knobs of its recipe that reach the sound (tune, decay and the colour knobs) and gets a Level knob. The note map is
the GM drum map of the other drum graphs: 36 kick, 37 rim, 38 snare, 39 clap, 41 low tom, 42 closed hat, 46 open hat, 49 cymbal.
"""
import json
import pathlib

HIER = pathlib.Path(__file__).resolve().parent
NAME = "drum-synth"
TITEL = "Drum Synth"
STIMMEN = 8

# pad id, panel title, MIDI note, recipe, tap node.port, trim (gain that brings the pad's loudest hit to about -12 dBFS), knob start overrides
# (recipe regler id -> knob position 0..1)
PADS = [
    ("kick", "KICK", 36, "drums-kick", "drive.aus", 0.32, {}),
    ("rim", "RIM", 37, "percussion-rim", "vca1.aus", 0.43, {}),
    ("snare", "SNARE", 38, "drums-snare", "drive.aus", 0.34, {}),
    ("clap", "CLAP", 39, "drums-clap", "eq_hp.hp", 0.29, {}),
    ("tom", "LOW TOM", 41, "percussion-tom", "vca1.aus", 0.29, {"k_tune": 0.15}),
    ("chat", "CLOSED HAT", 42, "drums-hihat", "highpass.hp", 0.31, {}),
    ("ohat", "OPEN HAT", 46, "drums-hihat", "highpass.hp", 0.29, {"k_decay": 0.88}),
    ("cym", "CYMBAL", 49, "drums-cymbal", "drive.aus", 0.24, {}),
]
# pads that use one recipe twice differ by these knob positions only (see the overrides above)
RECIPES = HIER / "demos" / "recipes"
PANELS = HIER / "paneele"
# panel files of the recipes by recipe name
PANEL_VON = {n: PANELS / (n + ".json") for n in {p[3] for p in PADS}}


def lade(pfad):
    return json.load(open(pfad))


def rueckwaerts(g, tap):
    """ids of all nodes that reach the tap node (the tap itself included)"""
    von = {}
    for e in g["kanten"]:
        von.setdefault(e["nach"].split(".")[0], []).append(e["von"].split(".")[0])
    seen, stack = set(), [tap]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(von.get(n, []))
    return seen


def panel_knoepfe(rezept):
    """recipe panel: param 'kN' -> control (without the envelope displays)"""
    p = lade(PANEL_VON[rezept])
    aus = {}
    for s in p["sections"]:
        for c in s["controls"]:
            if c.get("type") == "knob" and "bind" in c:
                aus[int(c["bind"]["param"][1:])] = c
    return aus


def bauen():
    knoten = [{"id": "note", "art": "note"}]
    kanten = []
    namen = {}
    panel_pads = []
    nr = 0
    kn_wahl = {}
    noten = {}

    def neuer_regler(rid, label, lo, hi, extra, ctrl_von=None, pad=None):
        nonlocal nr
        nr += 1
        namen[str(nr)] = label
        r = {"id": rid, "art": "regler", "nr": nr, "min": lo, "max": hi}
        r.update(extra)
        knoten.append(r)
        return nr

    for k, (pid, titel, note, rezept, tap, trim, vor) in enumerate(PADS):
        g = lade(RECIPES / (rezept + ".json"))
        tap_id, tap_port = tap.split(".")
        keep = rueckwaerts(g, tap_id)
        steuer = panel_knoepfe(rezept)
        nrs = {}  # recipe knob number -> new number
        controls = []
        for kn in g["knoten"]:
            if kn["id"] not in keep or kn["id"] == "note":
                continue
            n2 = dict(kn)
            n2["id"] = pid + "_" + kn["id"]
            if kn["art"] == "regler":
                alt = kn["nr"]
                if alt not in nrs:
                    nr += 1
                    nrs[alt] = nr
                    namen[str(nr)] = "%s %s" % (titel.title(), g["regler_namen"][str(alt)])
                    c = dict(steuer[alt])
                    c = {a: b for a, b in c.items() if a not in ("wirkt", "wirkt_text", "span")}
                    c["id"] = "%s-%s" % (pid, c["id"])
                    c["bind"] = {"param": "k%d" % nr}
                    controls.append((nr, c))
                n2["nr"] = nrs[alt]
                if kn["id"] in vor:
                    n2["vorgabe"] = vor[kn["id"]]
                    for (m, c) in controls:
                        if m == nrs[alt]:
                            c["default"] = vor[kn["id"]]
            knoten.append(n2)
        for e in g["kanten"]:
            a, b = e["von"].split(".")[0], e["nach"].split(".")[0]
            if b not in keep or (a not in keep and a != "note"):
                continue
            if b == tap_id and False:
                continue
            kanten.append({"von": ("note." + e["von"].split(".")[1]) if a == "note" else pid + "_" + e["von"],
                           "nach": pid + "_" + e["nach"]})
        # level: fixed trim, then the Level knob (0..2, start 1)
        knoten.append({"id": pid + "_trim", "art": "mul", "b": trim})
        kanten.append({"von": "%s_%s.%s" % (pid, tap_id, tap_port), "nach": pid + "_trim.a"})
        lv = nr + 1
        neuer_regler(pid + "_k_level", "%s Level" % titel.title(), 0, 2, {"vorgabe": 0.5})
        knoten.append({"id": pid + "_lv", "art": "mul"})
        kanten.append({"von": pid + "_trim.aus", "nach": pid + "_lv.a"})
        kanten.append({"von": pid + "_k_level.aus", "nach": pid + "_lv.b"})
        kn_wahl["e%d" % (k + 1)] = pid + "_lv.aus"
        noten["n%d" % (k + 1)] = note
        lc = {"id": pid + "-level", "type": "knob", "label": "Level", "bind": {"param": "k%d" % lv}, "format": "percent", "default": 0.5}
        controls.append((lv, lc))
        panel_pads.append((pid, titel, note, [c for _, c in controls]))

    knoten.append(dict({"id": "pad", "art": "notenwahl"}, **noten))
    kanten.append({"von": "note.hz", "nach": "pad.hz"})
    knoten.append({"id": "wahl", "art": "wahl", "n": len(PADS), "norm": 0, "blende": 0})
    kanten.append({"von": "pad.aus", "nach": "wahl.wahl"})
    for e, q in kn_wahl.items():
        kanten.append({"von": q, "nach": "wahl." + e})
    knoten.append({"id": "vel", "art": "mul"})
    kanten += [{"von": "wahl.aus", "nach": "vel.a"}, {"von": "note.vel", "nach": "vel.b"}]
    master = nr + 1
    neuer_regler("k_master", "Master", 0, 2, {"vorgabe": 0.5})
    knoten.append({"id": "master", "art": "mul"})
    kanten += [{"von": "vel.aus", "nach": "master.a"}, {"von": "k_master.aus", "nach": "master.b"}]
    knoten.append({"id": "aus", "art": "ausgang"})
    kanten.append({"von": "master.aus", "nach": "aus.x"})
    assert nr <= 64, nr
    graph = {"format": "baukasten/2", "name": NAME, "stimmen": STIMMEN, "regler_namen": namen, "knoten": knoten, "kanten": kanten}
    return graph, panel_pads, master


def panel(pads, master):
    sektionen = []
    for pid, titel, note, controls in pads:
        c = list(controls)
        c.append({"id": pid + "-n", "type": "label", "span": 2, "text": "MIDI %d" % note})
        sektionen.append({"id": pid, "title": titel, "cols": 2, "controls": c})
    sektionen.append({"id": "master", "title": "MASTER", "cols": 1, "controls": [
        {"id": "master", "type": "knob", "label": "Master", "bind": {"param": "k%d" % master}, "format": "percent", "default": 0.5}]})
    return {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": NAME}, "title": TITEL, "akzent": "rot",
            "front": ["k%d" % master],
            "layout": {"rows": [["kick", "rim", "snare", "clap"], ["tom", "chat", "ohat", "cym", "master"]]},
            "sections": sektionen}


def schreibe_graph(g, pfad):
    out = ['{', '  "format": "%s",' % g["format"], '  "name": "%s",' % g["name"], '  "stimmen": %d,' % g["stimmen"],
           '  "regler_namen": ' + json.dumps(g["regler_namen"]) + ',', '  "knoten": [']
    out += ['    ' + json.dumps(k) + (',' if i < len(g["knoten"]) - 1 else '') for i, k in enumerate(g["knoten"])]
    out += ['  ],', '  "kanten": [']
    out += ['    ' + json.dumps(k) + (',' if i < len(g["kanten"]) - 1 else '') for i, k in enumerate(g["kanten"])]
    out += ['  ]', '}']
    open(pfad, "w").write("\n".join(out) + "\n")


def schreibe_panel(p, pfad):
    out = ['{']
    for key in ("format", "geraet", "title", "akzent", "front", "layout"):
        out.append('  "%s": %s,' % (key, json.dumps(p[key])))
    out.append('  "sections": [')
    for i, s in enumerate(p["sections"]):
        out.append('    { "id": "%s", "title": "%s", "cols": %d, "controls": [' % (s["id"], s["title"], s["cols"]))
        out += ['      ' + json.dumps(c) + (',' if j < len(s["controls"]) - 1 else '') for j, c in enumerate(s["controls"])]
        out.append('    ]}' + (',' if i < len(p["sections"]) - 1 else ''))
    out += ['  ]', '}']
    open(pfad, "w").write("\n".join(out) + "\n")


if __name__ == "__main__":
    g, pads, master = bauen()
    schreibe_graph(g, HIER / "demos" / (NAME + ".json"))
    schreibe_panel(panel(pads, master), HIER / "paneele" / (NAME + ".json"))
    print("wrote", NAME, "knobs", len(g["regler_namen"]), "nodes", len(g["knoten"]))
