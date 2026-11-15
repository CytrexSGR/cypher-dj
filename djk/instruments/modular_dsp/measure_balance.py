#!/usr/bin/env python3
"""Pattern loudness of the drum groups of a `trommeln` graph, relative to the kick.

    python3 measure_balance.py <graph.json> [--knoepfe N=V ...] --aus out.json

Each group is played alone through the graph (all other knobs at their start values, `--knoepfe` sets knobs on top) in a two bar 4/4
pattern at 130 BPM, velocity 0.9, and measured with the BS.1770 integrated loudness of `djk/sound/loudness.py`. The result is
`{group: LU relative to the kick}`: seven groups for the 808, six for the 909 (`perc` is null there: note 56 is a crash on the 909
and note 75 is silent, so no cowbell or clave exists to measure). The kick is 0.0 by definition.

Patterns (16 steps per bar): kick 0 4 8 12; snare and clap 4 12; closed hat 2 6 10 14; toms 3 7 11 (low, mid, high); cymbals a crash at
step 0, then a ride on every 4th step; perc (808 only) cowbell 3 7 11, clave 5 13. `render_kit` renders the float WAV, so the
numbers are deterministic. Set CARGO_TARGET_DIR to the folder that holds `release/examples/render_kit` (see measure_null.py).
"""
import json
import pathlib
import subprocess
import sys
import tempfile

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
sys.path.insert(0, str(HIER.parents[1]))

import measure_null as messe_null  # noqa: E402  (render_kit location, WAV reader)
from sound.loudness import integriert  # noqa: E402

SR = 48_000
BPM = 130
SCHRITT = 60.0 / BPM / 4
VEL = 0.9
GRUPPEN = ("kick", "snare", "clap", "tom", "hat", "cym", "perc")


def _muster(gruppe):
    """[(step, note)] over two bars."""
    ereignisse = []
    for takt in (0, 16):
        if gruppe == "kick":
            ereignisse += [(takt + s, 36) for s in (0, 4, 8, 12)]
        elif gruppe == "snare":
            ereignisse += [(takt + s, 38) for s in (4, 12)]
        elif gruppe == "clap":
            ereignisse += [(takt + s, 39) for s in (4, 12)]
        elif gruppe == "hat":
            ereignisse += [(takt + s, 42) for s in (2, 6, 10, 14)]
        elif gruppe == "tom":
            ereignisse += [(takt + s, n) for s, n in ((3, 41), (7, 45), (11, 48))]
        elif gruppe == "cym":
            ereignisse += [(takt + s, 51) for s in (4, 8, 12)]
        elif gruppe == "perc":
            ereignisse += [(takt + s, 56) for s in (3, 7, 11)] + [(takt + s, 75) for s in (5, 13)]
    if gruppe == "cym":
        ereignisse.insert(0, (0, 49))
    return ereignisse


def ist_808(graph):
    return any(k.get("art") == "trommeln" and k.get("modell") == 1 for k in json.loads(pathlib.Path(graph).read_text())["knoten"])


def lufs_gruppe(graph, gruppe, knoepfe=None):
    hits = ",".join(f"{n}@{s * SCHRITT:.5f}:{VEL}" for s, n in _muster(gruppe))
    dauer = 32 * SCHRITT + 2.5
    with tempfile.TemporaryDirectory() as d:
        wav = pathlib.Path(d) / "g.wav"
        arg = [str(messe_null.werkzeug_bauen()), str(graph), str(wav), "--hits", hits, "--dauer", f"{dauer:.3f}"]
        arg += [f"{n}={v!r}" for n, v in sorted((knoepfe or {}).items())]
        p = subprocess.run(arg, capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip() or p.stdout.strip())
        return integriert(messe_null.lies(wav), SR)


def balance(graph, knoepfe=None):
    """{group: LU relative to the kick}; `perc` is None on a 909 graph."""
    absolut = {g: lufs_gruppe(graph, g, knoepfe) for g in GRUPPEN if g != "perc" or ist_808(graph)}
    kick = absolut["kick"]
    return {g: (round(absolut[g] - kick, 2) if g in absolut else None) for g in GRUPPEN}


def main(argv):
    if len(argv) < 2 or "--aus" not in argv:
        print(__doc__)
        return 2
    graph = argv[1]
    knoepfe = {}
    if "--knoepfe" in argv:
        for a in argv[argv.index("--knoepfe") + 1:]:
            if a.startswith("--"):
                break
            n, v = a.split("=")
            knoepfe[int(n)] = float(v)
    erg = balance(graph, knoepfe)
    pathlib.Path(argv[argv.index("--aus") + 1]).write_text(json.dumps(erg, indent=1) + "\n")
    for g, v in erg.items():
        print(f"{g:6s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
