"""djk-starter: gives a fresh HOME something to play. Return 0 all done, 2 usage, 4 done with skipped steps."""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

from . import storage as ablage, demo, graphs as graphen, kits, loops
from .tools import WerkzeugFehlt

DJK = Path(__file__).resolve().parents[1]
STUFEN = ("graphen", "kits", "loops", "demo", "bibliothek")


def stufe_graphen() -> int:
    ordner = graphen.graphen_ordner()
    r = graphen.installiere_graphen(graphen.quellen_der_beispiele(DJK), ordner)
    for name in r["neu"]:
        print(f"installed {name}")
    for name in r["behalten"]:
        print(f"kept {name}")
    for name in r["uebersprungen"]:
        print(f"skipped {name}: not a valid graph name", file=sys.stderr)
    try:
        for n in graphen.installiere_proben(ordner):
            print(f"installed samples/{n}")
    except WerkzeugFehlt as e:
        print(e.hinweis, file=sys.stderr)
        return 4
    return 0


def stufe_kits() -> int:
    wurzel = ablage.kit_ordner()
    try:
        r = kits.baue_kits(wurzel)
    except WerkzeugFehlt as e:
        print(e.hinweis, file=sys.stderr)
        return 4
    for name, was in r.items():
        if was != "beschaedigt":  # the reason was printed on stderr by baue_kits
            print(f"{'installed' if was == 'neu' else 'kept'} kit {name}")
    return 4 if "beschaedigt" in r.values() else 0


def stufe_loops(instanz: str = "") -> int:
    try:
        r = loops.baue_loops(loops.loop_ordner(instanz))
    except WerkzeugFehlt as e:
        print(e.hinweis, file=sys.stderr)
        return 4
    for name, was in r.items():
        if was != "beschaedigt":  # the reason was printed on stderr by baue_loops
            print(f"{'installed' if was == 'neu' else 'kept'} loop {name}")
    return 4 if "beschaedigt" in r.values() else 0


def stufe_demo(instanz: str = "") -> int:
    was = demo.kopiere_demo(demo.projekt_wurzel(instanz))
    print(f"{'installed' if was == 'neu' else 'kept'} project demo")
    return 0


def stufe_bibliothek() -> int:
    """The generated sounds become a library root and the catalog is built. A catalog of another program at the target
    (on the maker's machine: the private one) is left alone, config included, and the step still counts as done."""
    from bibliothek import catalog_build as katalog_bau
    from bibliothek.config import Konfig, KonfigFehler, Wurzel, katalog_ziel, lies_konfig, schreibe_konfig
    from bibliothek.features import MerkmalCache

    klaenge = loops._wav_ordner().parent
    ziel = katalog_ziel(os.environ)
    kept = "kept the existing catalog (built by another program)"
    if katalog_bau.eigener_katalog(ziel)[0] is False:
        print(kept)
        return 0
    if not klaenge.is_dir():
        print(f"no starter sounds in {klaenge} yet: run djk-starter --nur kits --nur loops first", file=sys.stderr)
        return 4
    try:
        k = lies_konfig()
        echt = os.path.realpath(klaenge)
        if not any(os.path.realpath(w.pfad) == echt or os.path.realpath(w.pfad) in Path(echt).parents
                   for w in k.wurzeln):
            schreibe_konfig(Konfig(1, [*k.wurzeln, Wurzel(klaenge, "auto")]))
            print(f"added library folder {klaenge}")
            k = lies_konfig()
    except KonfigFehler as e:
        print(f"{e}; library step skipped", file=sys.stderr)
        return 4
    cache = MerkmalCache()
    try:
        r = katalog_bau.baue(ziel, k, cache, False, lambda n: print(f"scanned {n} files", file=sys.stderr, flush=True))
    except katalog_bau.FremderKatalog:
        print(kept)
        return 0
    except katalog_bau.WurzelFehlt as e:
        print(f"library folder missing: {e.pfad}; run djk-bibliothek bauen --ohne-fehlende or djk-bibliothek weg <folder>",
              file=sys.stderr)
        return 4
    except WerkzeugFehlt as e:
        print(e.hinweis, file=sys.stderr)
        return 4
    except katalog_bau.LeererBau as e:
        print(f"{e}; the existing catalog is kept (drive unplugged? run djk-bibliothek bauen --leer-erlaubt to empty it)",
              file=sys.stderr)
        return 4
    except katalog_bau.ZielNichtSchreibbar as e:
        print(f"{e}; set CYPHERDJ_KATALOG to a file on another file system", file=sys.stderr)
        return 4
    except (OSError, sqlite3.Error) as e:  # target folder not writable, disk full, ...: nothing was put at the target
        print(f"cannot build the catalog at {ziel}: {e}; library step skipped", file=sys.stderr)
        return 4
    finally:
        cache.schliessen()
    z = r.zeilen
    print(f"built {r.ziel}: {z['track']} track, {z['loop']} loop, {z['oneshot']} oneshot")
    return 0


UMGESETZT = {"graphen": stufe_graphen, "kits": stufe_kits, "loops": stufe_loops, "demo": stufe_demo, "bibliothek": stufe_bibliothek}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="djk-starter", description="Install the starter pack into the user's folders.")
    p.add_argument("--nur", action="append", choices=STUFEN, metavar="|".join(STUFEN),
                   help="only this step (repeatable); default: all")
    p.add_argument("--instanz", default="", choices=[""] + list("abcdefghi"), metavar="a..i",
                   help="instance letter (accepted for symmetry with djk-start; the starter folders are shared; loops follow the instance)")
    a = p.parse_args(argv)
    stufen = a.nur or list(STUFEN)
    rc = 0
    for s in stufen:
        schritt = UMGESETZT.get(s)
        if schritt is None:
            print(f"step {s}: not available in this version", file=sys.stderr)
            continue
        rc = max(rc, schritt(a.instanz) if s in ("loops", "demo") else schritt())
    return rc


if __name__ == "__main__":
    sys.exit(main())
