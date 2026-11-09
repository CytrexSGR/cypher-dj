#!/usr/bin/env python3
"""Pixel diff of the closed state: two output folders of probe_lanes.mjs (the tree before the lane slice, and the current one).
usage: probe_lanes_diff.py <folder-before> <folder-after> [limit-percent]   (default limit 0.1)
Prints, per canvas, the size, the number of differing pixels and the share in percent. Exit 1 when a share is above the limit or the sizes differ."""
import json
import sys


def lade(ordner, name):
    meta = json.load(open(f"{ordner}/geschlossen-{name}.json"))
    return meta["w"], meta["h"], open(f"{ordner}/geschlossen-{name}.rgba", "rb").read()


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    vor, nach = sys.argv[1], sys.argv[2]
    grenze = float(sys.argv[3]) if len(sys.argv) > 3 else 0.1
    schlecht = 0
    for name in ("spuren", "lineal"):
        w0, h0, a = lade(vor, name)
        w1, h1, b = lade(nach, name)
        if (w0, h0) != (w1, h1) or len(a) != len(b):
            print(f"{name}: sizes differ {w0}x{h0} vs {w1}x{h1}")
            schlecht += 1
            continue
        n = sum(1 for i in range(0, len(a), 4) if a[i:i + 4] != b[i:i + 4])
        anteil = 100.0 * n / (w0 * h0)
        ok = anteil <= grenze
        print(f"{name}: {w0}x{h0} px, {n} pixels differ = {anteil:.4f} % (limit {grenze} %) {'OK' if ok else 'FAIL'}")
        schlecht += 0 if ok else 1
    return 1 if schlecht else 0


sys.exit(main())
