"""v1 (Parameter vor Ansicht von frisch festgelegt) auf test + frisch gepoolt: 240 Tracks, ein Bootstrap.
Schreibt berichte/messung_gepoolt.json."""
import json
import os
import sys

from . import nml, messung, detektor
from .lauf_messung import kurz, HIER
from .lauf_v2 import V1


def main(cache):
    samm = nml.lies_sammlung(messung.NML)
    mit = [e for e in samm if e["marken"]]
    menge = messung.stichproben(samm)["test"] + [e for i, e in enumerate(mit) if i % 7 == 5][:120]
    tracks = [messung.Track(e, cache) for e in menge]
    e = messung.bewerte(tracks, detektor.Parameter(**V1), n_saaten=100)
    aus = {"n_tracks": len(tracks), "v1": kurz(e),
           "bootstrap": {k: messung.bootstrap(e["detektor"]["zeilen"], e[k]["zeilen"]) for k in ("a16", "b16", "b8", "b1")}}
    with open(os.path.join(HIER, "berichte", "messung_gepoolt.json"), "w", encoding="utf-8") as f:
        json.dump(aus, f, ensure_ascii=False, indent=1, default=float)
    return aus


if __name__ == "__main__":
    main(sys.argv[1])
