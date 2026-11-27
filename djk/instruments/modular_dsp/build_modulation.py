#!/usr/bin/env python3
"""Builds the Cypher Modulation devices as graphs of existing blocks, each with a front panel:
`fx-tremolo` (tremolo and auto-pan), `fx-chorus`, `fx-flanger-sync`, `fx-phaser-sync`.

They share one rate section (`ratenteil`): knob 1 `Rate mode` (Free plus seven note values locked to the host beat) and knob 2 `Rate` (Hz,
acts in Free only). Run after changing the tables:  python3 build_modulation.py   (writes demos/ and paneele/, deterministic).
"""
import json
import pathlib

HIER = pathlib.Path(__file__).parent

# Rate mode positions: Free, then the note values; beats per period of the synced lfo (1/4 note = 1 beat at 4/4)
RATE_MODI = ["Free", "1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars"]
TAKT_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16]
RATE_MODUS_VORGABE = 3   # the panel pushes 1/4 on load (index 3); the graph keeps the 0.5 fill (index 4 = 1/2)


def regler(nr, kid, **w):
    return {"id": kid, "art": "regler", "nr": nr, **w}


def knob(cid, label, k, fmt, **w):
    return {"id": cid, "type": "knob", "label": label, "bind": {"param": f"k{k}"}, "format": fmt, **{"default": 0.5, **w}}


def wahl_steuerung(cid, label, k, optionen, **w):
    return {"id": cid, "type": "selector", "label": label, "bind": {"param": f"k{k}"}, "options": optionen, **w}


def ratenteil(praefix, viertel=False):
    """The rate section: eight lfos (Free plus seven synced) and a `wahl` that picks one by the `modus` knob. Returns (nodes, edges, out)
    with `out` = the id.port of the selected modulator (-1..1). Inputs it expects from the graph: `rate` (Hz knob) and `modus` (0..1 knob).
    viertel: the modulator runs a quarter period behind the plain one (synced lfos: `versatz` = takt / 4 beats; Free: the triangle form,
    which is the same phase as a sine a quarter period late; see the doc)."""
    p = praefix
    knoten = [{"id": f"{p}f", "art": "lfo", "form": 1 if viertel else 0}]
    kanten = [{"von": "rate.aus", "nach": f"{p}f.rate"}]
    for i, t in enumerate(TAKT_BEATS):
        n = {"id": f"{p}s{i}", "art": "lfo", "form": 0, "takt": t}
        if viertel:
            n["versatz"] = t / 4
        knoten.append(n)
    knoten.append({"id": f"{p}w", "art": "wahl", "n": 8, "blende": 50})
    kanten.append({"von": f"{p}f.aus", "nach": f"{p}w.e1"})
    kanten += [{"von": f"{p}s{i}.aus", "nach": f"{p}w.e{i + 2}"} for i in range(7)]
    kanten.append({"von": "modus.aus", "nach": f"{p}w.wahl"})
    return knoten, kanten, f"{p}w.aus"


def raten_regler():
    return [regler(1, "modus", min=0, max=1), regler(2, "rate", min=0.05, max=10, log=1, mitte=0.5)]


def raten_panel(extra_ids=()):
    return {"id": "ratesec", "title": "RATE", "cols": 2, "controls": [
        wahl_steuerung("rmode", "Rate mode", 1, RATE_MODI, default=RATE_MODUS_VORGABE, span=2),
        knob("rate", "Rate", 2, "hz", wirkt={"ist": ["rmode", [0]]}, wirkt_text="Rate mode is synced to the beat: pick Free", span=2),
    ]}


def schreibe(pfad, daten):
    pfad.write_text(json.dumps(daten, indent=1, ensure_ascii=False) + "\n")


def graph(name, namen, knoten, kanten):
    return {"format": "baukasten/2", "name": name, "stimmen": 1, "regler_namen": {str(k): v for k, v in namen.items()},
            "knoten": knoten, "kanten": kanten}


def panel(name, titel, layout, sektionen):
    return {"format": "cypherdj-panel/2", "geraet": {"art": "bk", "graph": name}, "title": titel, "akzent": "tuerkis",
            "layout": {"rows": layout}, "sections": sektionen}


# ---------------------------------------------------------------------------------------------------------------- fx-tremolo
def tremolo():
    namen = {1: "Rate mode", 2: "Rate", 3: "Depth", 4: "Shape", 5: "Mode", 6: "Mix"}
    kn = [{"id": "ein", "art": "eingang"}, *raten_regler(),
          regler(3, "depth", min=0, max=1), regler(4, "shape", min=0, max=24, mitte=6),
          regler(5, "mode", min=0, max=1), regler(6, "mix", min=0, max=1), {"id": "aus", "art": "ausgang"}]
    rn, rk, m = ratenteil("r")
    kn += rn
    kt = list(rk)
    # one modulator m (-1..1); the right side takes m (Tremolo) or -m (Pan) through a 2-way selector
    kn += [{"id": "minv", "art": "mul", "b": -1}, {"id": "wr", "art": "wahl", "n": 2, "blende": 20}]
    kt += [{"von": m, "nach": "minv.a"}, {"von": m, "nach": "wr.e1"}, {"von": "minv.aus", "nach": "wr.e2"}, {"von": "mode.aus", "nach": "wr.wahl"}]
    # h = Depth * Mix / 2;  gain = 1 - h + h * m'  (m' = the shaped modulator); equal to the dry/wet mix of in * (1 - mix) + in * gain0 * mix
    kn += [{"id": "dm", "art": "mul"}, {"id": "h", "art": "mul", "b": 0.5}, {"id": "nh", "art": "mul", "b": -1}, {"id": "eins", "art": "add", "b": 1}]
    kt += [{"von": "depth.aus", "nach": "dm.a"}, {"von": "mix.aus", "nach": "dm.b"}, {"von": "dm.aus", "nach": "h.a"},
           {"von": "h.aus", "nach": "nh.a"}, {"von": "nh.aus", "nach": "eins.a"}]
    quelle = {"l": m, "r": "wr.aus"}
    for s in ("l", "r"):
        kn += [{"id": f"v{s}", "art": "mul", "b": 1.3}, {"id": f"sa{s}", "art": "saett"}, {"id": f"hm{s}", "art": "mul"},
               {"id": f"g{s}", "art": "add"}, {"id": f"o{s}", "art": "mul"}]
        kt += [{"von": quelle[s], "nach": f"v{s}.a"}, {"von": f"v{s}.aus", "nach": f"sa{s}.x"}, {"von": "shape.aus", "nach": f"sa{s}.antrieb"},
               {"von": f"sa{s}.aus", "nach": f"hm{s}.a"}, {"von": "h.aus", "nach": f"hm{s}.b"},
               {"von": f"hm{s}.aus", "nach": f"g{s}.a"}, {"von": "eins.aus", "nach": f"g{s}.b"},
               {"von": f"ein.{s}", "nach": f"o{s}.a"}, {"von": f"g{s}.aus", "nach": f"o{s}.b"}, {"von": f"o{s}.aus", "nach": f"aus.{s}"}]
    p = panel("fx-tremolo", "Cypher Tremolo", [["ratesec", "shapesec", "outsec"]], [
        raten_panel(),
        {"id": "shapesec", "title": "SHAPE", "cols": 2, "controls": [
            knob("depth", "Depth", 3, "percent"),
            knob("form", "Shape", 4, "percent", wirkt={"alle": [{"ueber": ["depth", 0.01]}, {"ueber": ["mix", 0.01]}]},
                 wirkt_text="Needs Depth and Mix above zero"),
            wahl_steuerung("pan", "Mode", 5, ["Tremolo", "Pan"], default=0, span=2),
        ]},
        {"id": "outsec", "title": "OUT", "cols": 1, "controls": [knob("mix", "Mix", 6, "percent", default=1)]},
    ])
    return graph("fx-tremolo", namen, kn, kt), p


# ------------------------------------------------------------------------------------------------------------------------ fx-chorus
def mischung(kn, kt, nasse):
    """Dry/wet mix per side: out = in * (1 - Mix) + wet * Mix. `nasse` = {side: 'id.port'} of the wet signals."""
    kn += [{"id": "nmx", "art": "mul", "b": -1}, {"id": "imx", "art": "add", "b": 1}]
    kt += [{"von": "mix.aus", "nach": "nmx.a"}, {"von": "nmx.aus", "nach": "imx.a"}]
    for s in ("l", "r"):
        kn += [{"id": f"dr{s}", "art": "mul"}, {"id": f"nw{s}", "art": "mul"}, {"id": f"o{s}", "art": "add"}]
        kt += [{"von": f"ein.{s}", "nach": f"dr{s}.a"}, {"von": "imx.aus", "nach": f"dr{s}.b"},
               {"von": nasse[s], "nach": f"nw{s}.a"}, {"von": "mix.aus", "nach": f"nw{s}.b"},
               {"von": f"dr{s}.aus", "nach": f"o{s}.a"}, {"von": f"nw{s}.aus", "nach": f"o{s}.b"}, {"von": f"o{s}.aus", "nach": f"aus.{s}"}]


def chorus():
    namen = {1: "Rate mode", 2: "Rate", 3: "Depth", 4: "Delay", 5: "Width", 6: "Mix"}
    kn = [{"id": "ein", "art": "eingang"}, *raten_regler(),
          regler(3, "depth", min=0, max=8, mitte=2), regler(4, "delay", min=5, max=30, mitte=12),
          regler(5, "width", min=0, max=1), regler(6, "mix", min=0, max=1), {"id": "aus", "art": "ausgang"}]
    kt = []
    mod = {}
    for s, viertel in (("l", False), ("r", True)):
        rn, rk, mod[s] = ratenteil("r" if s == "l" else "q", viertel)
        kn += rn
        kt += rk
    # two taps per side, delay = Delay +- Depth * m (the right side runs a quarter period behind), no feedback
    nass = {}
    for s in ("l", "r"):
        kn += [{"id": f"dm{s}", "art": "mul"}, {"id": f"nd{s}", "art": "mul", "b": -1},
               {"id": f"za{s}", "art": "add"}, {"id": f"zb{s}", "art": "add"},
               {"id": f"ta{s}", "art": "leitung", "max": 40}, {"id": f"tb{s}", "art": "leitung", "max": 40},
               {"id": f"su{s}", "art": "add"}, {"id": f"we{s}", "art": "mul", "b": 0.5}]
        kt += [{"von": mod[s], "nach": f"dm{s}.a"}, {"von": "depth.aus", "nach": f"dm{s}.b"}, {"von": f"dm{s}.aus", "nach": f"nd{s}.a"},
               {"von": "delay.aus", "nach": f"za{s}.a"}, {"von": f"dm{s}.aus", "nach": f"za{s}.b"},
               {"von": "delay.aus", "nach": f"zb{s}.a"}, {"von": f"nd{s}.aus", "nach": f"zb{s}.b"},
               {"von": f"ein.{s}", "nach": f"ta{s}.x"}, {"von": f"za{s}.aus", "nach": f"ta{s}.zeit"},
               {"von": f"ein.{s}", "nach": f"tb{s}.x"}, {"von": f"zb{s}.aus", "nach": f"tb{s}.zeit"},
               {"von": f"ta{s}.aus", "nach": f"su{s}.a"}, {"von": f"tb{s}.aus", "nach": f"su{s}.b"}, {"von": f"su{s}.aus", "nach": f"we{s}.a"}]
    # Width: both wet sides pulled towards their mono sum; 0 = mono, 1 = as is
    kn += [{"id": "mo", "art": "add"}, {"id": "mo5", "art": "mul", "b": 0.5}, {"id": "nbr", "art": "mul", "b": -1}, {"id": "ibr", "art": "add", "b": 1},
           {"id": "mob", "art": "mul"}]
    kt += [{"von": "wel.aus", "nach": "mo.a"}, {"von": "wer.aus", "nach": "mo.b"}, {"von": "mo.aus", "nach": "mo5.a"},
           {"von": "width.aus", "nach": "nbr.a"}, {"von": "nbr.aus", "nach": "ibr.a"}, {"von": "mo5.aus", "nach": "mob.a"}, {"von": "ibr.aus", "nach": "mob.b"}]
    for s in ("l", "r"):
        kn += [{"id": f"wb{s}", "art": "mul"}, {"id": f"wc{s}", "art": "add"}]
        kt += [{"von": f"we{s}.aus", "nach": f"wb{s}.a"}, {"von": "width.aus", "nach": f"wb{s}.b"},
               {"von": "mob.aus", "nach": f"wc{s}.a"}, {"von": f"wb{s}.aus", "nach": f"wc{s}.b"}]
        nass[s] = f"wc{s}.aus"
    mischung(kn, kt, nass)
    p = panel("fx-chorus", "Cypher Chorus", [["ratesec", "voice", "outsec"]], [
        raten_panel(),
        {"id": "voice", "title": "VOICE", "cols": 2, "controls": [
            knob("depth", "Depth", 3, "ms"), knob("delay", "Delay", 4, "ms"),
            knob("width", "Width", 5, "percent", default=1, span=2),
        ]},
        {"id": "outsec", "title": "OUT", "cols": 1, "controls": [knob("mix", "Mix", 6, "percent")]},
    ])
    return graph("fx-chorus", namen, kn, kt), p


# ------------------------------------------------------------------------------------------------------------------- fx-flanger-sync
def flanger_sync():
    namen = {1: "Rate mode", 2: "Rate", 3: "Depth", 4: "Manual", 5: "Feedback", 6: "Mix"}
    kn = [{"id": "ein", "art": "eingang"}, *raten_regler(),
          regler(3, "depth", min=0, max=4, mitte=1.5), regler(4, "manual", min=0.2, max=6, mitte=1),
          regler(5, "feedback", min=-0.9, max=0.9, mitte=0.5), regler(6, "mix", min=0, max=1), {"id": "aus", "art": "ausgang"}]
    kt = []
    mod = {}
    for s, viertel in (("l", False), ("r", True)):
        rn, rk, mod[s] = ratenteil("r" if s == "l" else "q", viertel)
        kn += rn
        kt += rk
    # the wet level follows 1 - feedback^2, so the resonant peaks of the comb stay below 1.9 and Mix 0.5 stays inside the headroom
    kn += [{"id": "hd", "art": "mul", "b": 0.5}, {"id": "fq", "art": "mul"}, {"id": "nfq", "art": "mul", "b": -1}, {"id": "pg", "art": "add", "b": 1}]
    kt += [{"von": "depth.aus", "nach": "hd.a"}, {"von": "feedback.aus", "nach": "fq.a"}, {"von": "feedback.aus", "nach": "fq.b"},
           {"von": "fq.aus", "nach": "nfq.a"}, {"von": "nfq.aus", "nach": "pg.a"}]
    nass = {}
    for s in ("l", "r"):
        kn += [{"id": f"dm{s}", "art": "mul"}, {"id": f"z{s}", "art": "add"}, {"id": f"in{s}", "art": "add"},
               {"id": f"le{s}", "art": "leitung", "max": 12}, {"id": f"fb{s}", "art": "mul"}, {"id": f"wt{s}", "art": "mul"}]
        # delay = Manual + Depth * (m + 1) / 2 = Manual + Depth/2 + Depth/2 * m
        kt += [{"von": mod[s], "nach": f"dm{s}.a"}, {"von": "hd.aus", "nach": f"dm{s}.b"},
               {"von": "manual.aus", "nach": f"z{s}.a"}, {"von": "hd.aus", "nach": f"z{s}.b"}, {"von": f"dm{s}.aus", "nach": f"z{s}.c"},
               {"von": f"ein.{s}", "nach": f"in{s}.a"}, {"von": f"fb{s}.aus", "nach": f"in{s}.b"},
               {"von": f"in{s}.aus", "nach": f"le{s}.x"}, {"von": f"z{s}.aus", "nach": f"le{s}.zeit"},
               {"von": f"le{s}.aus", "nach": f"fb{s}.a"}, {"von": "feedback.aus", "nach": f"fb{s}.b"},
               {"von": f"le{s}.aus", "nach": f"wt{s}.a"}, {"von": "pg.aus", "nach": f"wt{s}.b"}]
        nass[s] = f"wt{s}.aus"
    mischung(kn, kt, nass)
    p = panel("fx-flanger-sync", "Cypher Flanger", [["ratesec", "sweep", "tone", "outsec"]], [
        raten_panel(),
        {"id": "sweep", "title": "SWEEP", "cols": 2, "controls": [knob("depth", "Depth", 3, "ms"), knob("manual", "Manual", 4, "ms")]},
        {"id": "tone", "title": "TONE", "cols": 1, "controls": [knob("feedback", "Feedback", 5, "percent")]},
        {"id": "outsec", "title": "OUT", "cols": 1, "controls": [knob("mix", "Mix", 6, "percent")]},
    ])
    return graph("fx-flanger-sync", namen, kn, kt), p


# -------------------------------------------------------------------------------------------------------------------- fx-phaser-sync
def phaser_sync():
    namen = {1: "Rate mode", 2: "Rate", 3: "Low", 4: "Range", 5: "Feedback", 6: "Mix", 7: "Stereo"}
    kn = [{"id": "ein", "art": "eingang"}, *raten_regler(),
          regler(3, "low", min=100, max=2000, log=1, mitte=300), regler(4, "range", min=0, max=48, mitte=36),
          regler(5, "feedback", min=0, max=0.85, mitte=0.3), regler(6, "mix", min=0, max=1), regler(7, "stereo", min=0, max=1),
          {"id": "aus", "art": "ausgang"}]
    kt = []
    mod = {}
    for s, viertel in (("l", False), ("r", True)):
        rn, rk, mod[s] = ratenteil("r" if s == "l" else "q", viertel)
        kn += rn
        kt += rk
    # Stereo: the right sweep is the left modulator (index 0) or the quarter-period one (index 1)
    kn += [{"id": "wsr", "art": "wahl", "n": 2, "blende": 20}, {"id": "hr", "art": "mul", "b": 0.5}]
    kt += [{"von": mod["l"], "nach": "wsr.e1"}, {"von": mod["r"], "nach": "wsr.e2"}, {"von": "stereo.aus", "nach": "wsr.wahl"},
           {"von": "range.aus", "nach": "hr.a"}]
    # the wet level follows 1 - feedback^2 (as in the flanger): the resonant peaks of the loop stay below 1.85 instead of 6.7
    kn += [{"id": "fq", "art": "mul"}, {"id": "nfq", "art": "mul", "b": -1}, {"id": "pg", "art": "add", "b": 1}]
    kt += [{"von": "feedback.aus", "nach": "fq.a"}, {"von": "feedback.aus", "nach": "fq.b"}, {"von": "fq.aus", "nach": "nfq.a"}, {"von": "nfq.aus", "nach": "pg.a"}]
    quelle = {"l": mod["l"], "r": "wsr.aus"}
    nass = {}
    for s in ("l", "r"):
        # sweep frequency f = Low * 2^(Range * (m + 1) / 2 / 12)
        kn += [{"id": f"sm{s}", "art": "mul"}, {"id": f"st{s}", "art": "add"}, {"id": f"f{s}", "art": "transponiere"},
               {"id": f"in{s}", "art": "add"}, {"id": f"fb{s}", "art": "mul"}]
        kt += [{"von": quelle[s], "nach": f"sm{s}.a"}, {"von": "hr.aus", "nach": f"sm{s}.b"},
               {"von": f"sm{s}.aus", "nach": f"st{s}.a"}, {"von": "hr.aus", "nach": f"st{s}.b"},
               {"von": "low.aus", "nach": f"f{s}.hz"}, {"von": f"st{s}.aus", "nach": f"f{s}.st"},
               {"von": f"ein.{s}", "nach": f"in{s}.a"}]
        # four second-order all-passes in series = eight poles, all at f
        vor = f"in{s}.aus"
        for i in range(4):
            kn.append({"id": f"ap{i}{s}", "art": "allpass", "ordnung": 2})
            kt += [{"von": vor, "nach": f"ap{i}{s}.x"}, {"von": f"f{s}.aus", "nach": f"ap{i}{s}.fc"}, {"von": f"f{s}.aus", "nach": f"ap{i}{s}.fc2"}]
            vor = f"ap{i}{s}.aus"
        kt += [{"von": vor, "nach": f"fb{s}.a"}, {"von": "feedback.aus", "nach": f"fb{s}.b"}]
        # the feedback edge closes the loop (G-d): one sample late
        kt.append({"von": f"fb{s}.aus", "nach": f"in{s}.b", "verzoegerung": 1})
        kn.append({"id": f"wt{s}", "art": "mul"})
        kt += [{"von": vor, "nach": f"wt{s}.a"}, {"von": "pg.aus", "nach": f"wt{s}.b"}]
        nass[s] = f"wt{s}.aus"
    mischung(kn, kt, nass)
    p = panel("fx-phaser-sync", "Cypher Phaser", [["ratesec", "sweep", "tone", "outsec"]], [
        raten_panel(),
        {"id": "sweep", "title": "SWEEP", "cols": 2, "controls": [
            knob("low", "Low", 3, "hz"), knob("range", "Range", 4, "raw", unit="st"),
            wahl_steuerung("stereo", "Stereo", 7, ["Same", "Quarter"], span=2),
        ]},
        {"id": "tone", "title": "TONE", "cols": 1, "controls": [knob("feedback", "Feedback", 5, "percent")]},
        {"id": "outsec", "title": "OUT", "cols": 1, "controls": [knob("mix", "Mix", 6, "percent")]},
    ])
    return graph("fx-phaser-sync", namen, kn, kt), p


GERAETE = {"fx-tremolo": tremolo, "fx-chorus": chorus, "fx-flanger-sync": flanger_sync, "fx-phaser-sync": phaser_sync}


def main():
    for name, fn in GERAETE.items():
        g, p = fn()
        schreibe(HIER / "demos" / f"{name}.json", g)
        schreibe(HIER / "paneele" / f"{name}.json", p)
        print(f"wrote {name}: {len(g['knoten'])} nodes, {len(g['kanten'])} edges")


if __name__ == "__main__":
    main()
