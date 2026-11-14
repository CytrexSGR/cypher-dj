#!/usr/bin/env python3
"""Builds the Cypher Remix device `fx-remix` (effect), as graph and panel.

The graph wraps the one `remix` block. The knob table below is the single source of the knob numbers; run this script
after changing it:  python3 build_remix.py   (writes demos/ and paneele/).

An effect graph is also an insert stage, and a stage starts every knob at 0.5, so the graph carries no `vorgabe`: every
knob is laid out so that its middle is the right start (the bipolar controls rest there, the selectors have the
default in the middle, a switch that starts on has `mitte` 0.99, a switch that starts off reads the middle as off, a
level has its start value as `mitte`).
"""
import json
import pathlib

HIER = pathlib.Path(__file__).parent

BAU = ["BPF ECHO", "ECHO", "NOISE", "SPIRAL UP", "REVERB UP"]          # values 1..5
AB = ["HPF ECHO", "CRUSH", "LPF ECHO", "SPIRAL DN", "REVERB DN"]      # values 6..10
ISO = ["CUT/ADD", "TRANS/ROLL", "ISOLATOR", "GATE"]                   # values 1..4
REL = ["BRAKE", "ECHO", "BACK SPIN"]                                  # values 0..2
ZONEN = ["1/8", "1/4", "1/2", "1/1", "2/1"]

# A switch that starts off: knob 0.5 reads off in the block (on is above 0.5), the switch then sends 0 or 1. Its panel control carries
# `mitte_aus`, so the page draws the 0.5 fill as off too. No `vorgabe`: an insert stage would ignore it (graph_vorgaben.test.mjs).
AN = dict(min=0, max=1)
AN_EIN = dict(min=0, max=1, mitte=0.99)  # a switch that starts on
BIPOLAR = dict(min=-1, max=1)

# (name, input of the block, regler values); knob numbers are the list positions + 1
K = [
    ("Scene", "szene", BIPOLAR),
    ("Build-up type", "bau_typ", dict(min=1, max=5)),
    ("Break-down type", "ab_typ", dict(min=6, max=10)),
    ("Sub 1", "sub1", dict(min=0, max=1)),
    ("Sub 2", "sub2", dict(min=0, max=1)),
    # four options: the selector positions are knob 0, 1/3, 2/3, 1; with this centre they read 1, 2.07, 3.07, 4 and knob 0.5 reads 2.6 = isolator
    ("Isolate type", "iso_typ", dict(min=1, max=4, mitte=2.6)),
    ("Low", "low", BIPOLAR),
    ("Mid", "mid", BIPOLAR),
    ("High", "hi", BIPOLAR),
    ("Pad position", "pad", dict(min=0, max=1)),
    ("Pad touch", "touch", AN),
    ("Pad hold", "halten", AN),
    ("Roll", "roll", AN),
    ("Kick", "kick", AN),
    ("Snare", "snare", AN),
    ("Clap", "clap", AN),
    ("Hi-hat", "hat", AN),
    ("Overdub", "overdub", AN),
    ("Pitch", "pitch", dict(min=-12, max=12)),
    ("Pad level", "padpegel", dict(min=0, max=1, mitte=0.7)),
    ("Release type", "rel_typ", dict(min=0, max=2)),
    # the lever rests in the middle of the knob and is pulled over the upper half; the lower half is rest as well
    ("Release lever", "hebel", BIPOLAR),
    ("Release hold", "rel_halten", AN),
    ("Input to FX", "ein_fx", AN_EIN),
    ("Pad to FX", "pad_fx", AN_EIN),
    ("Pump", "pumpen", dict(min=0, max=1)),
    ("Volume", "pegel", dict(min=-40, max=6, mitte=0)),
]
NR = {name: i + 1 for i, (name, _, _) in enumerate(K)}


def knob(cid, label, name, fmt, **w):
    return {"id": cid, "type": "knob", "label": label, "bind": {"param": f"k{NR[name]}"}, "format": fmt, "default": 0.5, **w}


def schalter(cid, label, name, default, **w):
    aus = {} if default else {"mitte_aus": True}
    return {"id": cid, "type": "switch", "label": label, "bind": {"param": f"k{NR[name]}"}, "default": default, **aus, **w}


def wahl(cid, label, name, optionen, default, **w):
    return {"id": cid, "type": "selector", "label": label, "bind": {"param": f"k{NR[name]}"}, "options": optionen, "default": default, **w}


def text(cid, t, span):
    return {"id": cid, "type": "label", "span": span, "text": t}


def geraet():
    knoten = [{"id": "ein", "art": "eingang"}] + [{"id": f"k{i + 1}", "art": "regler", "nr": i + 1, **w} for i, (_, _, w) in enumerate(K)]
    knoten += [{"id": "rmx", "art": "remix"}, {"id": "aus", "art": "ausgang"}]
    kanten = [{"von": "ein.l", "nach": "rmx.l"}, {"von": "ein.r", "nach": "rmx.r"}]
    kanten += [{"von": f"k{i + 1}.aus", "nach": f"rmx.{ziel}"} for i, (_, ziel, _) in enumerate(K)]
    kanten += [{"von": "rmx.l", "nach": "aus.l"}, {"von": "rmx.r", "nach": "aus.r"}]
    graph = {"format": "baukasten/2", "name": "fx-remix", "stimmen": 1, "regler_namen": {str(i + 1): n for i, (n, _, _) in enumerate(K)},
             "knoten": knoten, "kanten": kanten}

    panel = {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": "fx-remix"}, "title": "Remix", "akzent": "tuerkis",
             "layout": {"rows": [["scene", "iso", "rel"], ["pad", "out"]]},
             "sections": [
                 {"id": "scene", "title": "SCENE", "cols": 5, "controls": [
                     wahl("ab", "Break down (left)", "Break-down type", AB, 2, span=5),
                     knob("szene", "Scene", "Scene", "percent", span=2),
                     knob("sub1", "Sub 1", "Sub 1", "percent"),
                     knob("sub2", "Sub 2", "Sub 2", "percent"),
                     knob("pump", "Pump", "Pump", "percent"),
                     wahl("bau", "Build up (right)", "Build-up type", BAU, 2, span=5),
                 ]},
                 {"id": "iso", "title": "ISOLATE", "cols": 3, "controls": [
                     wahl("isotyp", "Effect", "Isolate type", ISO, 2, span=3),
                     knob("low", "Low", "Low", "percent"),
                     knob("mid", "Mid", "Mid", "percent"),
                     knob("hi", "High", "High", "percent"),
                     text("isohin", "Centre neutral. Left cuts, right adds.", 3),
                 ]},
                 {"id": "pad", "title": "PAD", "cols": 5, "controls": [
                     {"id": "xpad", "type": "touchpad", "label": "Touch", "span": 5, "zones": ZONEN,
                      "bind": {"x": {"param": f"k{NR['Pad position']}"}, "touch": {"param": f"k{NR['Pad touch']}"}}},
                     schalter("roll", "Roll", "Roll", 0),
                     schalter("kick", "Kick", "Kick", 0),
                     schalter("snare", "Snare", "Snare", 0),
                     schalter("clap", "Clap", "Clap", 0),
                     schalter("hat", "Hi-hat", "Hi-hat", 0),
                     schalter("hold", "Hold", "Pad hold", 0),
                     schalter("overdub", "Overdub", "Overdub", 0),
                     knob("pitch", "Pitch", "Pitch", "raw", unit="st"),
                     knob("padlevel", "Level", "Pad level", "percent"),
                     {"id": "padsp", "type": "spacer"},
                 ]},
                 {"id": "rel", "title": "RELEASE", "cols": 2, "controls": [
                     wahl("reltyp", "Effect", "Release type", REL, 1, span=2),
                     {"id": "hebel", "type": "lever", "label": "Lever", "span": 2, "zones": ["long", "mid", "short"],
                      "bind": {"param": f"k{NR['Release lever']}"}},
                     schalter("relhold", "FX hold", "Release hold", 0, span=2),
                 ]},
                 {"id": "out", "title": "SOURCE / OUT", "cols": 1, "controls": [
                     schalter("einfx", "Input > FX", "Input to FX", 1),
                     schalter("padfx", "Pad > FX", "Pad to FX", 1),
                     knob("vol", "Volume", "Volume", "db"),
                 ]},
             ]}
    return graph, panel


def schreibe(pfad, daten):
    pfad.write_text(json.dumps(daten, indent=1, ensure_ascii=False) + "\n")


def tabelle(graph):
    """Markdown knob map of a graph: number, name, range, value at the start (knob 0.5)."""
    zeilen = ["| Knob | Name | Range | Start |", "|---|---|---|---|"]
    for k in graph["knoten"]:
        if k["art"] != "regler":
            continue
        start = k["mitte"] if "mitte" in k else (k["min"] + k["max"]) / 2
        zeilen.append(f"| k{k['nr']} | {graph['regler_namen'][str(k['nr'])]} | {k['min']:g} .. {k['max']:g} | {start:g} |")
    return "\n".join(zeilen)


if __name__ == "__main__":
    import sys
    graph, panel = geraet()
    if "--tabelle" in sys.argv:
        print(f"### `{graph['name']}`\n\n{tabelle(graph)}\n")
        sys.exit(0)
    schreibe(HIER / "demos" / f"{graph['name']}.json", graph)
    schreibe(HIER / "paneele" / f"{graph['name']}.json", panel)
    print(graph["name"], len(graph["regler_namen"]), "knobs,", len(graph["knoten"]), "nodes")
