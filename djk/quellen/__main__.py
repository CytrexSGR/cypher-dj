"""python3 -m quellen (cwd djk): the source list on the command line.

  zeige --json [--host H]
  dazu --name N --pfad P --art A [--wechselplatte ja|nein] [--regal] [--kein-katalog]
  weg --name N
  importiere [--mediathek F] [--regal F] [--bibliothek F] [--umgebung F] [--ausfuehren]
  schreibe-alt [--ziel-mediathek F] [--ziel-bibliothek F]
  vergleiche --mediathek F --regal F

Exit: 0 ok, 1 the old lists differ (vergleiche), 2 usage, 3 invalid file, 4 name taken or unknown, 6 home folder missing.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
from pathlib import Path

import ablage

from . import alt
from .file import ARTEN, Quellen, QuellenFehler, Wurzel, als_toml, ist_wechselplatte, lies, pfad_fuer, schreibe


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        print(f"quellen: {message}", file=sys.stderr)
        raise SystemExit(2)


def _parser() -> argparse.ArgumentParser:
    p = _Parser(prog="python3 -m quellen", description=(__doc__ or "").split("\n\n")[0])
    u = p.add_subparsers(dest="befehl", required=True, parser_class=_Parser)
    z = u.add_parser("zeige")
    z.add_argument("--json", action="store_true", required=True)
    z.add_argument("--host", default=socket.gethostname())
    d = u.add_parser("dazu")
    d.add_argument("--name", required=True)
    d.add_argument("--pfad", required=True)
    d.add_argument("--art", required=True, choices=ARTEN)
    d.add_argument("--wechselplatte", choices=("ja", "nein"))
    d.add_argument("--regal", action="store_true")
    d.add_argument("--kein-katalog", action="store_true")
    w = u.add_parser("weg")
    w.add_argument("--name", required=True)
    i = u.add_parser("importiere")
    for n in ("mediathek", "regal", "bibliothek", "umgebung"):
        i.add_argument(f"--{n}")
    i.add_argument("--ausfuehren", action="store_true")
    s = u.add_parser("schreibe-alt")
    s.add_argument("--ziel-mediathek")
    s.add_argument("--ziel-bibliothek")
    v = u.add_parser("vergleiche")
    v.add_argument("--mediathek", required=True)
    v.add_argument("--regal", required=True)
    return p


def _regal_datei() -> Path:
    return ablage.ordner("sampler") / "wurzeln.json"


def _zeige(q: Quellen, host: str) -> dict:
    wurzeln = []
    for w in q.wurzeln:
        p = pfad_fuer(w, host)
        e = {"name": w.name, "art": w.art, "pfad": p, "wechselplatte": ist_wechselplatte(w, host), "katalog": w.katalog,
             "regal": w.regal, "laufwerk": w.laufwerk}
        if p is None:
            e["grund"] = "kein_pfad_fuer_rechner"
        wurzeln.append(e)
    nach_name = {w.name: w for w in q.wurzeln}
    klang = []
    for k in q.klang:
        basis = pfad_fuer(nach_name[k.wurzel], host)
        klang.append({"name": k.name, "wurzel": k.wurzel, "rel": k.rel,
                      "pfad": None if basis is None else (f"{basis.rstrip('/')}/{k.rel}" if k.rel else basis)})
    return {"schema": q.schema, "host": host, "wurzeln": wurzeln, "klang": klang, "fern": len(q.fern)}


def main(argv=None) -> int:
    a = _parser().parse_args(argv)
    datei = ablage.fest("quellen")
    try:
        if a.befehl == "importiere":
            q = alt.importiere(a.mediathek, a.regal or _regal_datei(), a.bibliothek or ablage.fest("bibliothek_konfig"),
                               a.umgebung or ablage.fest("umgebung"),
                               Path(__file__).resolve().parents[1] / "sound" / "rollen.json")
            if not a.ausfuehren:
                sys.stdout.write(als_toml(q))
                return 0
            if lies(datei).wurzeln:
                print(f"quellen: {datei} already has roots; importing would overwrite them", file=sys.stderr)
                return 4
            schreibe(datei, q)
            print(f"{datei}: {len(q.wurzeln)} roots, {len(q.klang)} kit sources, {len(q.fern)} remote entries")
            return 0
        q = lies(datei)
        if a.befehl == "zeige":
            print(json.dumps(_zeige(q, a.host), ensure_ascii=False))
        elif a.befehl == "dazu":
            if any(w.name == a.name for w in q.wurzeln):
                print(f"quellen: the name {a.name!r} is taken", file=sys.stderr)
                return 4
            q.wurzeln.append(Wurzel(name=a.name, art=a.art, pfad=a.pfad, regal=a.regal, katalog=not a.kein_katalog,
                                    wechselplatte=None if a.wechselplatte is None else a.wechselplatte == "ja"))
            schreibe(datei, q)
        elif a.befehl == "weg":
            if not any(w.name == a.name for w in q.wurzeln):
                print(f"quellen: no root is named {a.name!r}", file=sys.stderr)
                return 4
            nutzer = [k.name for k in q.klang if k.wurzel == a.name]
            if nutzer:
                print(f"quellen: the root {a.name!r} is used by the kit source {nutzer[0]!r}", file=sys.stderr)
                return 4
            q.wurzeln = [w for w in q.wurzeln if w.name != a.name]
            schreibe(datei, q)
        elif a.befehl == "schreibe-alt":
            bib = a.ziel_bibliothek or (ablage.fest("bibliothek_konfig") if ablage.fest("bibliothek_konfig").is_file() else None)
            for p in alt.schreibe_alt(q, socket.gethostname(), a.ziel_mediathek, _regal_datei(), bib):
                print(p)
        elif a.befehl == "vergleiche":
            diff = alt.vergleiche(q, a.mediathek, a.regal)
            for z in diff:
                print(z)
            return 1 if diff else 0
        return 0
    except QuellenFehler as e:
        print(f"quellen: {e}", file=sys.stderr)
        return 6 if "heim_nicht_bereit" in str(e) else 3
    except ValueError as e:                                              # CYPHERDJ_HEIM is not an absolute path
        print(f"quellen: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
