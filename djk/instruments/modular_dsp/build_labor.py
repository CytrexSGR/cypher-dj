#!/usr/bin/env python3
"""Builds the two Cypher Labor devices: `labor` (instrument) and `fx-labor` (effect), each as graph and panel.

Both wrap the one `labor` block. The knob tables below are the single source of the knob numbers; run this script
after changing them:  python3 build_labor.py   (writes demos/ and paneele/).
"""
import json
import pathlib

HIER = pathlib.Path(__file__).parent


def regler(nr, kid, **w):
    return {"id": kid, "art": "regler", "nr": nr, **w}


def knob(cid, label, k, fmt, **w):
    return {"id": cid, "type": "knob", "label": label, "bind": {"param": f"k{k}"}, "format": fmt, **w}


def schalter(cid, label, k, default, **w):
    return {"id": cid, "type": "switch", "label": label, "bind": {"param": f"k{k}"}, "default": default, **w}


def wahl(cid, label, k, optionen, default, **w):
    return {"id": cid, "type": "selector", "label": label, "bind": {"param": f"k{k}"}, "options": optionen, "default": default, **w}


def text(cid, t, span):
    return {"id": cid, "type": "label", "span": span, "text": t}


ZEIT = dict(min=46, max=1500, log=1)
CUT = dict(min=60, max=6000, log=1)
STUFE = dict(min=0.005, max=5, log=1)
TIEFE = dict(min=-1, max=1)


def instrument():
    # (name, target input of the block or None, regler values); numbers are the list positions + 1
    k = [
        ("Cutoff 1", None, dict(CUT, mitte=261.6256)), ("Resonance 1", "reso1", dict(min=0, max=1, mitte=0.795)),
        ("High-pass 1", "hp1", dict(min=0, max=1, vorgabe=0)), ("Key track 1", None, dict(min=0, max=1, vorgabe=1)),
        ("Feedback 1", "fb1", dict(min=0, max=1, vorgabe=0)), ("Cross 1 to 2", "kreuz1", dict(min=0, max=1)),
        ("Delay 1", "delay1", dict(min=0, max=1, vorgabe=0)), ("Time 1", "zeit1", dict(ZEIT, mitte=250)),
        ("Mix 1", "mix1", dict(min=0, max=1, vorgabe=1)), ("Mod cutoff 1", "modcutoff1", dict(TIEFE, vorgabe=0.575)),
        ("Mod time 1", "modzeit1", dict(TIEFE)),
        ("Cutoff 2", None, dict(CUT, mitte=2000)), ("Resonance 2", "reso2", dict(min=0, max=1, mitte=0.3)),
        ("High-pass 2", "hp2", dict(min=0, max=1, vorgabe=0)), ("Key track 2", None, dict(min=0, max=1, vorgabe=0)),
        ("Feedback 2", "fb2", dict(min=0, max=1, vorgabe=0.3)), ("Cross 2 to 1", "kreuz2", dict(min=0, max=1, vorgabe=0)),
        ("Delay 2", "delay2", dict(min=0, max=1, vorgabe=1)), ("Time 2", "zeit2", dict(ZEIT, mitte=280)),
        ("Mix 2", "mix2", dict(min=0, max=1)), ("Mod cutoff 2", "modcutoff2", dict(TIEFE)),
        ("Mod time 2", "modzeit2", dict(TIEFE)),
        ("Cycle", "zyklus", dict(min=0, max=1, vorgabe=0)), ("Attack", "attack", dict(STUFE, vorgabe=0)),
        ("Decay", "decay", dict(STUFE, mitte=0.12)), ("Mod amount", "amount", dict(min=0, max=1, vorgabe=1)),
        ("Ping", None, dict(min=0, max=1, vorgabe=0.7)), ("Gate", None, dict(min=0, max=1, vorgabe=0)),
        ("Width", None, dict(min=0, max=1, vorgabe=0.4)), ("Volume", "pegel", dict(min=-40, max=6, mitte=-3)),
    ]
    nr = {name: i + 1 for i, (name, _, _) in enumerate(k)}
    kid = lambda name: f"k{nr[name]}"
    knoten = [{"id": "note", "art": "note"}] + [regler(i + 1, f"k{i + 1}", **w) for i, (_, _, w) in enumerate(k)]
    kanten = [{"von": f"k{i + 1}.aus", "nach": f"lab.{ziel}"} for i, (_, ziel, _) in enumerate(k) if ziel]
    # key tracking: cutoff = knob * (1 + track * (hz / C4 - 1)), so track 1 plays the knob's pitch transposed by the note
    knoten += [{"id": "verh", "art": "mul", "b": 1 / 261.6256}, {"id": "verh1", "art": "add", "b": -1}]
    kanten += [{"von": "note.hz", "nach": "verh.a"}, {"von": "verh.aus", "nach": "verh1.a"}]
    for c in (1, 2):
        knoten += [{"id": f"kt{c}", "art": "mul"}, {"id": f"ktb{c}", "art": "add", "b": 1}, {"id": f"cut{c}", "art": "mul"}]
        kanten += [{"von": "verh1.aus", "nach": f"kt{c}.a"}, {"von": f"{kid(f'Key track {c}')}.aus", "nach": f"kt{c}.b"},
                   {"von": f"kt{c}.aus", "nach": f"ktb{c}.a"}, {"von": f"{kid(f'Cutoff {c}')}.aus", "nach": f"cut{c}.a"},
                   {"von": f"ktb{c}.aus", "nach": f"cut{c}.b"}, {"von": f"cut{c}.aus", "nach": f"lab.cutoff{c}"}]
    # a note triggers the modulator and pings both channels, scaled by its velocity
    # ueber 2: the loop at twice the rate without latency (a project track takes an instrument graph only without latency)
    knoten += [{"id": "pingv", "art": "mul"}, {"id": "lab", "art": "labor", "ueber": 2}]
    kanten += [{"von": f"{kid('Ping')}.aus", "nach": "pingv.a"}, {"von": "note.vel", "nach": "pingv.b"},
               {"von": "pingv.aus", "nach": "lab.ping"}, {"von": "note.trig", "nach": "lab.trig"}]
    # gate: output gain = 1 + gate * (envelope - 1)
    knoten += [{"id": "env", "art": "adsr", "a": 0.002, "d": 0.05, "s": 1, "r": 0.06}, {"id": "env1", "art": "add", "b": -1},
               {"id": "tor", "art": "mul"}, {"id": "torg", "art": "add", "b": 1}]
    kanten += [{"von": "note.gate", "nach": "env.gate"}, {"von": "note.trig", "nach": "env.trig"}, {"von": "env.aus", "nach": "env1.a"},
               {"von": "env1.aus", "nach": "tor.a"}, {"von": f"{kid('Gate')}.aus", "nach": "tor.b"}, {"von": "tor.aus", "nach": "torg.a"}]
    # width: left = a * ch1 + b * ch2, right = a * ch2 + b * ch1 with a = 0.5 + w / 2, b = 0.5 - w / 2
    knoten += [{"id": "wa0", "art": "mul", "b": 0.5}, {"id": "wa", "art": "add", "b": 0.5}, {"id": "wb0", "art": "mul", "b": -0.5}, {"id": "wb", "art": "add", "b": 0.5},
               {"id": "ll", "art": "mul"}, {"id": "lr", "art": "mul"}, {"id": "rr", "art": "mul"}, {"id": "rl", "art": "mul"},
               {"id": "sl", "art": "add"}, {"id": "sr", "art": "add"}, {"id": "ol", "art": "mul"}, {"id": "or", "art": "mul"},
               {"id": "aus", "art": "ausgang"}]
    w = kid("Width")
    kanten += [{"von": f"{w}.aus", "nach": "wa0.a"}, {"von": "wa0.aus", "nach": "wa.a"}, {"von": f"{w}.aus", "nach": "wb0.a"}, {"von": "wb0.aus", "nach": "wb.a"},
               {"von": "lab.l", "nach": "ll.a"}, {"von": "wa.aus", "nach": "ll.b"}, {"von": "lab.r", "nach": "lr.a"}, {"von": "wb.aus", "nach": "lr.b"},
               {"von": "lab.r", "nach": "rr.a"}, {"von": "wa.aus", "nach": "rr.b"}, {"von": "lab.l", "nach": "rl.a"}, {"von": "wb.aus", "nach": "rl.b"},
               {"von": "ll.aus", "nach": "sl.a"}, {"von": "lr.aus", "nach": "sl.b"}, {"von": "rr.aus", "nach": "sr.a"}, {"von": "rl.aus", "nach": "sr.b"},
               {"von": "sl.aus", "nach": "ol.a"}, {"von": "torg.aus", "nach": "ol.b"}, {"von": "sr.aus", "nach": "or.a"}, {"von": "torg.aus", "nach": "or.b"},
               {"von": "ol.aus", "nach": "aus.l"}, {"von": "or.aus", "nach": "aus.r"}]
    graph = {"format": "baukasten/2", "name": "labor", "stimmen": 1, "regler_namen": {str(i + 1): n for i, (n, _, _) in enumerate(k)},
             "knoten": knoten, "kanten": kanten}

    def kanal(c):
        n = lambda s: nr[f"{s} {c}"]
        andere = 3 - c
        return {"id": f"ch{c}", "title": f"CHANNEL {c}", "cols": 4, "controls": [
            {"id": f"fk{c}", "type": "filterkurve", "span": 4, "of": {"cutoff": f"cut{c}", "reso": f"res{c}", "typ": f"typ{c}"},
             "typen": [{"art": "lp", "pole": 2}, {"art": "hp", "pole": 2}]},
            knob(f"cut{c}", "Cutoff", n("Cutoff"), "hz", default=0.5),
            knob(f"res{c}", "Reso", n("Resonance"), "percent", default=0.5),
            wahl(f"typ{c}", "Filter", n("High-pass"), ["LP", "HP"], 0),
            knob(f"kt{c}", "Key track", n("Key track"), "percent", default=1 if c == 1 else 0),
            schalter(f"dly{c}", "Delay", n("Delay"), 0 if c == 1 else 1),
            knob(f"time{c}", "Time", n("Time"), "ms", default=0.5),
            knob(f"fb{c}", "Feedback", n("Feedback"), "percent", default=0 if c == 1 else 0.3),
            knob(f"x{c}", f"Cross {andere}", nr[f"Cross {c} to {andere}"], "percent", default=0.5 if c == 1 else 0),
            knob(f"mix{c}", "Level", n("Mix"), "percent", default=1 if c == 1 else 0.5),
            knob(f"mc{c}", "Mod cut", n("Mod cutoff"), "percent", default=0.575 if c == 1 else 0.5),
            knob(f"mt{c}", "Mod time", n("Mod time"), "percent", default=0.5),
            {"id": f"sp{c}", "type": "spacer"},
        ]}

    panel = {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": "labor"}, "title": "Labor", "akzent": "orange",
             "layout": {"rows": [["ch1", "mod", "ch2"], ["hinweis"]]},
             "sections": [
                 kanal(1),
                 {"id": "mod", "title": "MODULATOR", "cols": 2, "controls": [
                     {"id": "hue", "type": "huelle", "span": 2, "label": "Envelope", "of": {"a": "att", "d": "dec", "s": 0, "r": 0}},
                     knob("att", "Attack", nr["Attack"], "raw", unit="s", default=0),
                     knob("dec", "Decay", nr["Decay"], "raw", unit="s", default=0.5),
                     schalter("cyc", "Cycle", nr["Cycle"], 0),
                     knob("amt", "Amount", nr["Mod amount"], "percent", default=1),
                     knob("ping", "Ping", nr["Ping"], "percent", default=0.7),
                     schalter("gate", "Note gate", nr["Gate"], 0),
                     knob("width", "Width", nr["Width"], "percent", default=0.4),
                     knob("vol", "Volume", nr["Volume"], "db", default=0.5),
                 ]},
                 kanal(2),
                 {"id": "hinweis", "title": "HOW IT PLAYS", "cols": 8, "controls": [
                     text("h1", "A note pings both filters at its pitch.", 4),
                     text("h2", "Resonance above 80 %: the filter sings.", 4),
                     text("h3", "Cross sends a channel into the other.", 4),
                     text("h4", "Long delay times get grainy on purpose.", 4),
                 ]},
             ]}
    return graph, panel


def effekt():
    # An effect graph is also an insert stage, and a stage starts every knob at 0.5: no `vorgabe` here, the start values are
    # the `mitte` of each knob. A switch that starts on has mitte 0.99 (knob 0.5 reads on, the switch then sends 0 or 1; mitte must lie inside the range).
    je = lambda c, zeit, kreuz, modcut: [
        (f"Gain {c}", f"gain{c}", dict(min=-38, max=40, mitte=0)), (f"Mix {c}", f"mix{c}", dict(min=0, max=1)),
        (f"Delay {c}", f"delay{c}", dict(min=0, max=1, mitte=0.99)), (f"Time {c}", f"zeit{c}", dict(ZEIT, mitte=zeit)),
        (f"Cutoff {c}", f"cutoff{c}", dict(CUT, mitte=2500)), (f"Resonance {c}", f"reso{c}", dict(min=0, max=1, mitte=0.3)),
        (f"High-pass {c}", f"hp{c}", dict(min=0, max=1)), (f"Feedback {c}", f"fb{c}", dict(min=0, max=1, mitte=0.4)),
        (f"Cross {c} to {3 - c}", f"kreuz{c}", dict(min=0, max=1, mitte=kreuz)), (f"Mod gain {c}", f"modgain{c}", dict(TIEFE)),
        (f"Mod time {c}", f"modzeit{c}", dict(TIEFE)), (f"Mod cutoff {c}", f"modcutoff{c}", dict(TIEFE, mitte=modcut)),
    ]
    k = je(1, 250, 0.2, 0.4) + je(2, 375, 0.2, -0.4) + [
        ("Cycle", "zyklus", dict(min=0, max=1, mitte=0.99)), ("Attack", "attack", dict(STUFE, mitte=0.5)), ("Decay", "decay", dict(STUFE, mitte=0.5)),
        ("Mod amount", "amount", dict(min=0, max=1)), ("Volume", "pegel", dict(min=-40, max=6, mitte=0)),
    ]
    nr = {name: i + 1 for i, (name, _, _) in enumerate(k)}
    knoten = [{"id": "ein", "art": "eingang"}] + [regler(i + 1, f"k{i + 1}", **w) for i, (_, _, w) in enumerate(k)] + [{"id": "lab", "art": "labor"}, {"id": "aus", "art": "ausgang"}]
    kanten = [{"von": "ein.l", "nach": "lab.l"}, {"von": "ein.r", "nach": "lab.r"}] + [{"von": f"k{i + 1}.aus", "nach": f"lab.{ziel}"} for i, (_, ziel, _) in enumerate(k)]
    kanten += [{"von": "lab.l", "nach": "aus.l"}, {"von": "lab.r", "nach": "aus.r"}]
    graph = {"format": "baukasten/2", "name": "fx-labor", "stimmen": 1, "regler_namen": {str(i + 1): n for i, (n, _, _) in enumerate(k)},
             "knoten": knoten, "kanten": kanten}

    def kanal(c):
        n = lambda s: nr[f"{s} {c}"]
        andere = 3 - c
        return {"id": f"ch{c}", "title": f"CHANNEL {c}", "cols": 4, "controls": [
            {"id": f"fk{c}", "type": "filterkurve", "span": 4, "of": {"cutoff": f"cut{c}", "reso": f"res{c}", "typ": f"typ{c}"},
             "typen": [{"art": "lp", "pole": 2}, {"art": "hp", "pole": 2}]},
            knob(f"gain{c}", "Gain", n("Gain"), "db", default=0.5),
            knob(f"cut{c}", "Cutoff", n("Cutoff"), "hz", default=0.5),
            knob(f"res{c}", "Reso", n("Resonance"), "percent", default=0.5),
            wahl(f"typ{c}", "Filter", n("High-pass"), ["LP", "HP"], 0),
            schalter(f"dly{c}", "Delay", n("Delay"), 1),
            knob(f"time{c}", "Time", n("Time"), "ms", default=0.5),
            knob(f"fb{c}", "Feedback", n("Feedback"), "percent", default=0.5),
            knob(f"x{c}", f"Cross {andere}", nr[f"Cross {c} to {andere}"], "percent", default=0.5),
            knob(f"mg{c}", "Mod gain", n("Mod gain"), "percent", default=0.5),
            knob(f"mt{c}", "Mod time", n("Mod time"), "percent", default=0.5),
            knob(f"mc{c}", "Mod cut", n("Mod cutoff"), "percent", default=0.5),
            knob(f"mix{c}", "Dry / wet", n("Mix"), "percent", default=0.5),
        ]}

    panel = {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": "fx-labor"}, "title": "Labor FX", "akzent": "tuerkis",
             "layout": {"rows": [["ch1", "mod", "ch2"], ["hinweis"]]},
             "sections": [
                 kanal(1),
                 {"id": "mod", "title": "MODULATOR", "cols": 2, "controls": [
                     {"id": "hue", "type": "huelle", "span": 2, "label": "Cycle", "of": {"a": "att", "d": "dec", "s": 0, "r": 0}},
                     knob("att", "Attack", nr["Attack"], "raw", unit="s", default=0.5),
                     knob("dec", "Decay", nr["Decay"], "raw", unit="s", default=0.5),
                     schalter("cyc", "Cycle", nr["Cycle"], 1),
                     knob("amt", "Amount", nr["Mod amount"], "percent", default=0.5),
                     knob("vol", "Volume", nr["Volume"], "db", span=2, default=0.5),
                 ]},
                 kanal(2),
                 {"id": "hinweis", "title": "HOW IT WORKS", "cols": 8, "controls": [
                     text("h1", "Left is channel 1, right is channel 2.", 4),
                     text("h2", "Feedback above half amplifies and howls.", 4),
                     text("h3", "Delay off: feedback makes an oscillator.", 4),
                     text("h4", "Long delay times get grainy on purpose.", 4),
                 ]},
             ]}
    return graph, panel


def schreibe(pfad, daten):
    pfad.write_text(json.dumps(daten, indent=1, ensure_ascii=False) + "\n")


def tabelle(graph):
    """Markdown knob map of a graph: number, name, range, default."""
    zeilen = ["| Knob | Name | Range | Default |", "|---|---|---|---|"]
    for k in graph["knoten"]:
        if k["art"] != "regler":
            continue
        if "mitte" in k:
            vorgabe = f"{k['mitte']:g}"
        else:
            v = k.get("vorgabe", 0.5)
            vorgabe = f"{k['min'] * (k['max'] / k['min']) ** v:.3g}" if k.get("log") else f"{k['min'] + (k['max'] - k['min']) * v:g}"
        zeilen.append(f"| k{k['nr']} | {graph['regler_namen'][str(k['nr'])]} | {k['min']:g} .. {k['max']:g}{' log' if k.get('log') else ''} | {vorgabe} |")
    return "\n".join(zeilen)


if __name__ == "__main__":
    import sys
    if "--tabelle" in sys.argv:
        for graph, _ in (instrument(), effekt()):
            print(f"### `{graph['name']}`\n\n{tabelle(graph)}\n")
        sys.exit(0)
    for graph, panel in (instrument(), effekt()):
        schreibe(HIER / "demos" / f"{graph['name']}.json", graph)
        schreibe(HIER / "paneele" / f"{graph['name']}.json", panel)
        print(graph["name"], len(graph["regler_namen"]), "knobs,", len(graph["knoten"]), "nodes")
