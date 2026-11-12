#!/usr/bin/env python3
"""Relative cost of several builds of the Baukasten engine, measured alternately under the same load.

    python3 measure_binaer.py --graph GRAPH.json [--graph ...] --variante NAME=BINARY[,ENV=VAL...] [--variante ...]
                            [--runden 7] [--stimmen N] [--aus OUT.json]

`BINARY` is a `kosten_graph` test binary (`cargo test --release --no-run -p baukasten_dsp --test kosten_graph`; copy it away
before the next build, cargo overwrites it). `ENV=VAL` pairs are set for that variant only, e.g. `BK_KOSTEN_ZWEIGE=0`.
`measure_cost.py` compares graphs with one binary; this compares binaries on one graph, for the case that the machine is not
quiet: every round runs every variant once (the order alternates each round, ABBA), so slow drift of the load hits all of them
alike. Each run is one `kosten_graph` measurement under the real-time lock. The summary gives, per graph and variant, the median
over the rounds of p50 and of p99 (the exact quantiles of the 4000 block times of one run) and the ratio to the first variant;
and the load average before and after each run, so a reader can judge the noise.
"""
import argparse
import json
import os
import statistics
import sys

from measure_cost import fuehre_aus, lade_last


def messe_variante(binary, graph, stimmen, env):
    alt = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        vor = lade_last()
        r = fuehre_aus(binary, graph, stimmen)
        r["load1_vor"], r["load1_nach"] = vor, lade_last()
        return r
    finally:
        for k, v in alt.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--graph", action="append", required=True)
    ap.add_argument("--variante", action="append", required=True, help="NAME=BINARY[,ENV=VAL...]")
    ap.add_argument("--runden", type=int, default=7)
    ap.add_argument("--stimmen", type=int)
    ap.add_argument("--aus")
    a = ap.parse_args(argv)
    varianten = []
    for v in a.variante:
        name, rest = v.split("=", 1)
        teile = rest.split(",")
        varianten.append((name, teile[0], dict(t.split("=", 1) for t in teile[1:])))
    erg = {}
    for graph in a.graph:
        g = os.path.abspath(graph)
        laeufe = {n: [] for n, _, _ in varianten}
        for runde in range(a.runden):
            reihe = varianten if runde % 2 == 0 else list(reversed(varianten))
            for name, binary, env in reihe:
                r = messe_variante(binary, g, a.stimmen, env)
                laeufe[name].append(r)
                print(json.dumps({"graph": os.path.basename(g), "variante": name, "runde": runde, **r}), flush=True)
        basis = None
        zusammen = {}
        for name, _, _ in varianten:
            p50 = statistics.median(r["p50_us"] for r in laeufe[name])
            p99 = statistics.median(r["p99_us"] for r in laeufe[name])
            last = statistics.median([r["load1_vor"] for r in laeufe[name]] + [r["load1_nach"] for r in laeufe[name]])
            zusammen[name] = {"p50_us": p50, "p99_us": p99, "p99_us_max": max(r["p99_us"] for r in laeufe[name]), "load1_median": last}
            basis = basis or zusammen[name]
            zusammen[name]["p50_verhaeltnis"] = p50 / basis["p50_us"]
            zusammen[name]["p99_verhaeltnis"] = p99 / basis["p99_us"]
        erg[os.path.basename(g)] = {"zusammen": zusammen, "laeufe": laeufe}
        print(json.dumps({"summary": os.path.basename(g), **zusammen}), flush=True)
    if a.aus:
        with open(a.aus, "w") as f:
            json.dump(erg, f, indent=1)
    return erg


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
