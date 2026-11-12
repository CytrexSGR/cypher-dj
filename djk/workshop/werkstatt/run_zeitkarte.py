"""Write `zeitkarte.json` (schema zeitkarte/1) for one track. Read-only on the store and the analysis depot.

Usage (from djk/workshop):
  .venv/bin/python -m werkstatt.run_zeitkarte <track folder or id> --aus <target folder>
`<track>` is a folder holding `material.json` (store or analysis depot layout) or a material id, looked up in the
store ($CYPHERDJ_BESTAND, default ~/cypher-dj/bestand) and then in the depot. The audio is `quelle.datei` of the
material (relative to the track folder, or absolute). The target folder may not lie inside the store or the depot."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from .inventory import standard_ablage, standard_bestand
from .input import lade_stereo48
from .zeitkarte import zeitkarte_berechnen


def track_ordner(arg):
    p = Path(arg).expanduser()
    if (p / "material.json").is_file():
        return p
    for wurzel in (standard_bestand(), standard_ablage()):
        if (wurzel / arg / "material.json").is_file():
            return wurzel / arg
    raise FileNotFoundError(f"no material.json for {arg}")


def _innen(ziel, wurzel):
    ziel, wurzel = Path(ziel).resolve(), Path(wurzel).resolve()
    return ziel == wurzel or wurzel in ziel.parents


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("track")
    ap.add_argument("--aus", required=True, help="target folder, zeitkarte.json is written there")
    a = ap.parse_args(argv)
    for w in (standard_bestand(), standard_ablage()):
        if _innen(a.aus, w):
            print(f"refusing to write inside {w}", file=sys.stderr)
            return 2
    ordner = track_ordner(a.track)
    material = json.loads((ordner / "material.json").read_text())
    audio = Path(material["quelle"]["datei"])
    audio = audio if audio.is_absolute() else ordner / audio
    if not audio.is_file():
        print(f"audio not found: {audio}", file=sys.stderr)
        return 2
    t0 = time.perf_counter()
    x = lade_stereo48(audio)
    z = zeitkarte_berechnen(material, x)
    z["rechenzeit_s"] = round(time.perf_counter() - t0, 1)
    ziel = Path(a.aus).expanduser()
    ziel.mkdir(parents=True, exist_ok=True)
    tmp = ziel / "zeitkarte.json.tmp"
    tmp.write_text(json.dumps(z, ensure_ascii=False, allow_nan=False))
    os.replace(tmp, ziel / "zeitkarte.json")
    print(f"{ziel / 'zeitkarte.json'}: {len(z['takte'])} bars, {z['breaks_anzahl']} breaks, "
          f"{len(z['warnungen'])} warnings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
