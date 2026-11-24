#!/usr/bin/env python3
"""Journey tour CLI: tour_cli.py <j0..j5|alle|lesen> --instanz <b..f> [--ausgabe DIR] [--kurz]

Loads `tour.j<N>` (a module with `schritte(t)` and optionally STUFEN / OPTIONEN for the instance), checks the live studio first
(exit 77 when it plays), takes the real-time lock around the whole tour, starts and stops the test instance itself and always
writes bericht.json and bericht.md. `lesen` is a built-in smoke tour that only reads /lage and /pegel.
Exit codes: 0 all green, 1 a step red, 2 call error, 77 skipped (live studio playing or a required dependency missing).
"""
import argparse
import fcntl
import importlib
import os
import sys
import time
from pathlib import Path

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
import dauerlauf  # noqa: E402
from tour import runner as laeufer  # noqa: E402

JOURNEYS = ["j0", "j1", "j2", "j3", "j4", "j5"]
LIVE_URL = laeufer.LIVE_URL
LOCK_WARTEN_S = 900


def schritte_lesen(t):
    """Smoke tour: the page answers /lage and /pegel."""
    with t.schritt("lesen.lage", "GET /lage answers 200", pflicht=True):
        a = t.ruf("GET", "/lage")
        assert a.code == 200, f"/lage answered {a.code}"
    with t.schritt("lesen.pegel", "GET /pegel names a master level"):
        p = t.pegel_phase(2)
        t.werte(max_db=p.max_db, still=p.still)
        assert p.lesefehler == 0, "no master level in /pegel"


def live_spielt():
    """True when the live studio's master is above -60 dB (read only, one call); the check itself lives in laeufer.live_laut so journeys can call it too."""
    return laeufer.live_laut(LIVE_URL)


def lauf_eine(name, buchstabe, ausgabe, kurz):
    if name == "lesen":
        schritte, stufen, optionen = schritte_lesen, [], []
    else:
        try:
            mod = importlib.import_module(f"tour.{name}")
        except ModuleNotFoundError:
            print(f"tour_cli: journey {name} has no tour yet", file=sys.stderr)
            return 2
        schritte, stufen, optionen = mod.schritte, getattr(mod, "STUFEN", None), getattr(mod, "OPTIONEN", None)
    inst = laeufer.Instanz(buchstabe, optionen=optionen, stufen=stufen)
    t = laeufer.Tour(name, inst, ausgabe, kurz)

    def alles(t):
        with t.schritt("instanz.start", f"start test instance {buchstabe}", pflicht=True):
            inst.start()
        schritte(t)

    try:
        rc = t.fuehre(alles)
    finally:
        inst.stopp()
    print(t.bericht().markdown())
    return rc


def main(argv=None):
    ap = argparse.ArgumentParser(prog="tour_cli.py")
    ap.add_argument("reise", help="j0..j5, alle, or lesen (smoke tour)")
    ap.add_argument("--instanz", required=True)
    ap.add_argument("--ausgabe")
    ap.add_argument("--kurz", action="store_true")
    a = ap.parse_args(argv)
    if a.instanz not in laeufer.ERLAUBT or len(a.instanz) != 1:
        print(f"tour_cli: instance must be one of b to f, got {a.instanz!r}", file=sys.stderr)
        return 2
    if a.reise not in JOURNEYS + ["alle", "lesen"]:
        print(f"tour_cli: unknown journey {a.reise!r}", file=sys.stderr)
        return 2
    namen = JOURNEYS if a.reise == "alle" else [a.reise]
    basis = Path(os.path.expanduser(a.ausgabe or f"~/messungen/{time.strftime('%Y-%m-%d')}-tour"))
    if a.ausgabe is None:
        basis = basis / a.reise
    if live_spielt():
        t = laeufer.Tour(a.reise, laeufer.Instanz(a.instanz), basis, a.kurz)
        with t.schritt("live", "the live studio is quiet"):
            t.skip("live studio is playing", ursache="live")
        t.fuehre(lambda _: None)
        print(t.bericht().markdown())
        return 77
    sperre = open(dauerlauf.schlosspfad(), "a")
    ende = time.monotonic() + LOCK_WARTEN_S
    while True:
        try:
            fcntl.flock(sperre, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            if time.monotonic() > ende:
                print("tour_cli: real-time lock not obtained", file=sys.stderr)
                return 2
            time.sleep(5)
    try:
        codes = [lauf_eine(n, a.instanz, basis / n if a.reise == "alle" else basis, a.kurz) for n in namen]
    finally:
        fcntl.flock(sperre, fcntl.LOCK_UN)
        sperre.close()
    return 1 if 1 in codes else 2 if 2 in codes else 77 if 77 in codes else 0


if __name__ == "__main__":
    sys.exit(main())
