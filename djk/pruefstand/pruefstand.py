#!/usr/bin/env python3
"""Chaos-Prüfstand v1 (Scheibe 16), ein Befehl je Prüflauf.

  pruefstand.py lauf <profil.toml> [--ordner DIR] [--schloss-s 3600] [--kurz S]
                                                                        Lauf, Auswertung, Bericht; --kurz: Probelauf
                                                                        mit S Sekunden, Name <name>-kurz
  pruefstand.py reihe <profil.toml>[:n] ... [--laeufe DIR] [--schloss-s 10800]
                                                                        mehrere Läufe unter einem Schloss, je Profil
                                                                        n-mal (Vorgabe 1), Ordner <laeufe>/<zeit>-<name>
  pruefstand.py auswerten <ordner>                                      Auswertung und Bericht neu
  pruefstand.py p1-vergleich <ordner_a> <ordner_b>                      Reproduzierbarkeit von P1

Rückgabewert: 0 erfüllt, 1 verfehlt, 2 unbrauchbar (Instrument oder Lauf gestört: wiederholen), 3 Lauf nicht möglich.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import auswertung
import bericht
import lauf
import profil

HIER = Path(__file__).resolve().parent
CODE = {"erfuellt": 0, "verfehlt": 1, "unbrauchbar": 2}


def auswerten(ordner):
    A = auswertung.werte_aus(ordner)
    b = bericht.schreibe(ordner) if (Path(ordner) / "auswertung.json").exists() else None
    verfehlt = [u["schluessel"] for u in A.get("urteile", []) if not u["ok"]]
    print(f"{A['name']}: {A['ergebnis']} ({len(A.get('urteile', []))} Urteile, verfehlt: {verfehlt or 'keins'}) "
          f"Bericht {b}")
    if A.get("grund"):
        print(f"  unbrauchbar: {A['grund']}")
    for u in A.get("urteile", []):
        print(f"  {'ok' if u['ok'] else 'VERFEHLT'} {u['schluessel']}: {u['wert']} (Grenze {u['grenze']})")
    return CODE[A["ergebnis"]]


def reihe(angaben, laeufe, schloss_s):
    """Alle Profile zuerst laden (ein Tippfehler bricht vor dem Schloss ab), dann unter einem Schloss nacheinander.
    Rückgabewert: der schlechteste Einzelwert (3 vor 2 vor 1 vor 0)."""
    plan = []
    for angabe in angaben:
        pfad, _, n = angabe.partition(":")
        try:
            plan += [profil.lade(pfad)] * (int(n) if n else 1)
        except (profil.ProfilFehler, ValueError, OSError) as e:
            print(f"Profil {angabe}: {e}", file=sys.stderr)
            return 3
    schlecht = 0
    with lauf.Schloss(schloss_s):
        for p in plan:
            ordner = laeufe / f"{time.strftime('%Y%m%d-%H%M%S')}-{p['name']}"
            print(f"== {p['name']} {time.strftime('%H:%M:%S')} Last {open('/proc/loadavg').read().split()[0]}",
                  flush=True)
            try:
                L = lauf.lauf(p, ordner, schloss=lauf.OhneSchloss())
            except lauf.LaufFehler as e:
                print(f"Lauf {p['name']} nicht möglich: {e}", file=sys.stderr)
                schlecht = 3
                continue
            if L.get("fehler"):
                print(f"Lauf {p['name']} gestört: {L['fehler']}", file=sys.stderr)
            rc = auswerten(ordner)
            schlecht = max(schlecht, rc)
            time.sleep(1.0)                                  # Ordnernamen je Sekunde eindeutig
    return schlecht


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="befehl", required=True)
    a1 = sub.add_parser("lauf")
    a1.add_argument("profil")
    a1.add_argument("--ordner")
    a1.add_argument("--schloss-s", type=float, default=3600.0)
    a1.add_argument("--kurz", type=float)
    a4 = sub.add_parser("reihe")
    a4.add_argument("profile", nargs="+")
    a4.add_argument("--laeufe", default=str(HIER / "laeufe"))
    a4.add_argument("--schloss-s", type=float, default=10800.0)
    a2 = sub.add_parser("auswerten")
    a2.add_argument("ordner")
    a3 = sub.add_parser("p1-vergleich")
    a3.add_argument("a")
    a3.add_argument("b")
    a = ap.parse_args(argv)
    if a.befehl == "lauf":
        try:
            p = profil.lade(a.profil, a.kurz)
        except (profil.ProfilFehler, OSError) as e:
            print(f"Profil {a.profil}: {e}", file=sys.stderr)
            return 3
        ordner = Path(a.ordner) if a.ordner else HIER / "laeufe" / f"{time.strftime('%Y%m%d-%H%M%S')}-{p['name']}"
        try:
            L = lauf.lauf(p, ordner, a.schloss_s)
        except lauf.LaufFehler as e:
            print(f"Lauf {p['name']} nicht möglich: {e}", file=sys.stderr)
            return 3
        if L.get("fehler"):
            print(f"Lauf {p['name']} gestört: {L['fehler']}", file=sys.stderr)
        return auswerten(ordner)
    if a.befehl == "reihe":
        return reihe(a.profile, Path(a.laeufe), a.schloss_s)
    if a.befehl == "auswerten":
        return auswerten(a.ordner)
    from last.p1 import vergleiche
    la = json.loads((Path(a.a) / "auswertung.json").read_text())["last"]
    lb = json.loads((Path(a.b) / "auswertung.json").read_text())["last"]
    v = vergleiche(la, lb)
    print(json.dumps({"a": la, "b": lb, "relative_abweichung": v}, ensure_ascii=False, indent=1))
    return 0 if all(x is not None and x <= 0.15 for x in v.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
