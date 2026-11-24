#!/usr/bin/env python3
"""Helper of alles.sh: split the serial page test files over test instances (shards).

    alles_verteilen.py [--serial FILE] [--zeiten FILE] [--fest FILE] [--shards a,b,c,...] SHARD   print the files of one shard, one per line
    alles_verteilen.py ... --alle                                                    print "<shard> <file>" for every file

serial.txt lists the page test files that start servers on the test instance (djk/ui/tests/support/instance.mjs: a letter is a namespace of
ports, folders and a lock file), so two of them must not run on the same letter at once. Different letters do not collide, so each shard runs on
its own letter, one file at a time inside the shard. A file runs in exactly one shard. The split is greedy longest first over the measured seconds
(serial_zeiten.txt, 5 s for a file without a value): the next file goes to the shard with the least time so far.
serial_instanz.txt pins a file to a letter (`<letter> <file>  # reason`): for a test that touches the folders of one fixed letter, which must not run
beside the server tests of that letter.
"""
import argparse
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
TESTS = HIER.parent / "ui" / "tests"
UNBEKANNT_S = 5.0


def lies_serial(pfad):
    return [z.strip() for z in Path(pfad).read_text().splitlines() if z.strip() and not z.startswith("#")]


def lies_ruhig(pfad):
    """The files of the quiet stage (ruhig.txt, `<file>  # reason`): they run alone at the end, not in a shard."""
    p = Path(pfad)
    return {z.split("#")[0].strip() for z in p.read_text().splitlines() if z.split("#")[0].strip()} if p.exists() else set()


def ohne_ruhig(dateien, pfad):
    ruhig = lies_ruhig(pfad)
    return [f for f in dateien if f not in ruhig]


def lies_zeiten(pfad):
    zeiten = {}
    p = Path(pfad)
    if p.exists():
        for z in p.read_text().splitlines():
            teile = z.split(None, 1)
            if len(teile) == 2 and not z.startswith("#"):
                try:
                    zeiten[teile[1].strip()] = float(teile[0])
                except ValueError:
                    pass
    return zeiten


def lies_fest(pfad):
    fest = {}
    p = Path(pfad)
    if p.exists():
        for z in p.read_text().splitlines():
            teile = z.split("#")[0].split()
            if len(teile) == 2:
                fest[teile[1]] = teile[0]
    return fest


def verteile(dateien, zeiten, shards, fest=None):
    """-> {shard: [files]}. Pinned files first, then longest file first onto the shard with the least time; ties by shard order, files by name (deterministic)."""
    fest = fest or {}
    dateien = sorted(set(dateien))
    reihe = sorted((f for f in dateien if f not in fest), key=lambda f: (-zeiten.get(f, UNBEKANNT_S), f))
    last = {s: 0.0 for s in shards}
    out = {s: [] for s in shards}
    for f, s in sorted(fest.items()):
        if f in dateien and s in out:
            out[s].append(f)
            last[s] += zeiten.get(f, UNBEKANNT_S)
    for f in reihe:
        s = min(shards, key=lambda x: (last[x], shards.index(x)))
        out[s].append(f)
        last[s] += zeiten.get(f, UNBEKANNT_S)
    return {s: sorted(v) for s, v in out.items()}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", default=str(TESTS / "serial.txt"))
    ap.add_argument("--zeiten", default=str(TESTS / "serial_zeiten.txt"))
    ap.add_argument("--fest", default=str(TESTS / "serial_instanz.txt"))
    ap.add_argument("--ruhig", default=str(TESTS / "ruhig.txt"))
    ap.add_argument("--shards", default="a,b,c,d,e,f,g,h")
    ap.add_argument("--alle", action="store_true")
    ap.add_argument("shard", nargs="?")
    a = ap.parse_args(argv)
    shards = a.shards.split(",")
    verteilung = verteile(ohne_ruhig(lies_serial(a.serial), a.ruhig), lies_zeiten(a.zeiten), shards, lies_fest(a.fest))
    if a.alle:
        for s in shards:
            for f in verteilung[s]:
                print(s, f)
        return 0
    if a.shard not in verteilung:
        print(f"alles_verteilen: unknown shard {a.shard!r} (have {','.join(shards)})", file=sys.stderr)
        return 2
    print("\n".join(verteilung[a.shard]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
