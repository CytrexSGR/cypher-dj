#!/usr/bin/env python3
"""Builds the test kits of package 1.9 (kit.json in the ADR 024 format read by cdj::lade_kit, plus .f32 beside it).

kit_impuls  one 96-frame impulse (1.0 at frame 0, both channels) on note 0
kit_zwei    the impulse on note 0, a 1 kHz 10 ms Hann burst on note 1
kit_rack    the impulse on note 59, the burst on note 60

Deterministic: no random numbers, fixed float32 little-endian output. Nothing is read from or written to ~/.config/cypherdj/kits.

  bauen.py            writes the three kit folders next to this script
  bauen.py --pruefe   rebuilds into a temp folder and compares byte for byte with the committed files (exit 0 equal, 1 different)
"""
import filecmp
import json
import os
import sys
import tempfile

import numpy as np

SR = 48000
KITS = {
    "kit_impuls": [(0, "imp:0", "imp_0.f32", "impuls")],
    "kit_zwei": [(0, "imp:0", "imp_0.f32", "impuls"), (1, "ton:0", "ton_1.f32", "burst")],
    "kit_rack": [(59, "imp:0", "imp_59.f32", "impuls"), (60, "ton:0", "ton_60.f32", "burst")],
}


def impuls():
    x = np.zeros((96, 2), dtype="<f4")
    x[0, :] = 1.0
    return x


def burst():
    n = SR // 100  # 10 ms
    t = np.arange(n, dtype=np.float64) / SR
    fenster = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / (n - 1))
    m = (0.5 * np.sin(2.0 * np.pi * 1000.0 * t) * fenster).astype("<f4")
    return np.stack([m, m], axis=1)


QUELLEN = {"impuls": impuls, "burst": burst}


def baue(ziel):
    for name, klaenge in KITS.items():
        ordner = os.path.join(ziel, name)
        os.makedirs(ordner, exist_ok=True)
        eintraege = []
        for note, klang, datei, art in klaenge:
            d = QUELLEN[art]()
            d.tofile(os.path.join(ordner, datei))
            eintraege.append({"note": note, "name": klang, "datei": datei, "frames": int(d.shape[0])})
        with open(os.path.join(ordner, "kit.json"), "w") as f:
            f.write(json.dumps({"schema": 1, "name": name, "klaenge": eintraege}, separators=(", ", ": ")) + "\n")


def vergleiche(a, b):
    """True when folder tree a equals folder tree b byte for byte (same file set)."""
    for name in KITS:
        da, db = os.path.join(a, name), os.path.join(b, name)
        if sorted(os.listdir(da)) != sorted(os.listdir(db)):
            return False
        for f in os.listdir(da):
            if not filecmp.cmp(os.path.join(da, f), os.path.join(db, f), shallow=False):
                return False
    return True


def main(argv):
    hier = os.path.dirname(os.path.abspath(__file__))
    if "--pruefe" in argv:
        with tempfile.TemporaryDirectory() as tmp:
            baue(tmp)
            ok = all(os.path.isdir(os.path.join(hier, n)) for n in KITS) and vergleiche(tmp, hier)
        print("kits equal to the committed files" if ok else "kits DIFFER from the committed files")
        return 0 if ok else 1
    baue(hier)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
