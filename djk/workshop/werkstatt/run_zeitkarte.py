"""Write `zeitkarte.json` (schema zeitkarte/1) for one track. Read-only on the store and the analysis depot.
Input is `material.json` plus `korrekturen.jsonl` of the track folder: the Eins corrections (art `eins`) are laid over the
sealed material as `kette.korrigieren` does, because material.json never carries them. `eins_quelle` in the output says
which Eins was used ("material" or "korrekturen"); a hand line (von=andreas) settles an uncertain Eins, so the warning is
dropped; a line written by lauf_eins (von=werkstatt) applies the Eins but keeps the material's uncertainty flag.

Usage (from djk/workshop):
  .venv/bin/python -m werkstatt.run_zeitkarte <track folder or id> --aus <target folder>
`<track>` is a folder holding `material.json` (store or analysis depot layout) or a material id, looked up in the
store (the storage table, kind bestand; $CYPHERDJ_BESTAND wins) and then in the depot. The audio is `quelle.datei` of the
material (relative to the track folder, or absolute). The target folder may not lie inside the store or the depot."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from .inventory import korrekturen_lesen, standard_ablage, standard_bestand
from .input import lade_stereo48
from .chain import eins_und_hotcues
from .zeitkarte import zeitkarte_berechnen


def track_ordner(arg):
    p = Path(arg).expanduser()
    if (p / "material.json").is_file():
        return p
    for wurzel in (standard_bestand(), standard_ablage()):
        if (wurzel / arg / "material.json").is_file():
            return wurzel / arg
    raise FileNotFoundError(f"no material.json for {arg}")


def mit_eins_korrektur(material, zeilen):
    """(material copy with the corrected Eins, eins_quelle). Without an Eins line the material is returned unchanged."""
    if not any(z["art"] == "eins" and z["ab_quell_beat"] is not None for z in zeilen):
        return material, "material"
    eins, _ = eins_und_hotcues(material, zeilen)
    # same rule as kette.korrigieren (eins_hand): only a hand line (von=andreas) settles the uncertainty; a line from
    # lauf_eins (von=werkstatt) is a machine guess and keeps the material's flag
    hand = any(z["art"] == "eins" and z["ab_quell_beat"] is not None and z["von"] == "andreas" for z in zeilen)
    raster = dict(material["raster"], erste_eins_quell_beat=eins)
    if hand:
        raster["erste_eins_unsicher"] = False
    return dict(material, raster=raster), "korrekturen"


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
    material, eins_quelle = mit_eins_korrektur(material, korrekturen_lesen(ordner))
    z = zeitkarte_berechnen(material, x)
    z["eins_quelle"] = eins_quelle
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
