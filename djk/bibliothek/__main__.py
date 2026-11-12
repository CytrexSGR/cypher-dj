"""djk-bibliothek: turn the user's own folders into the browser catalog (katalog.sqlite, schema 1).

  djk-bibliothek dazu DIR [--typ auto|track|loop|oneshot]   add a folder
  djk-bibliothek weg DIR                                    remove a folder
  djk-bibliothek zeige [--json]                             config, target, state, counts (read only)
  djk-bibliothek bauen [--ohne-fehlende] [--leer-erlaubt]   scan and build the catalog

Return: 0 ok, 2 usage / config / no read tool, 3 foreign catalog at the target (left untouched), 4 a root is missing,
5 the file system cannot take the finished catalog (no hard links, no permission),
6 the scan found nothing but the existing catalog has rows (not emptied; --leer-erlaubt allows it).
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

from . import catalog_build as katalog_bau
from .catalog_build import FremderKatalog, LeererBau, WurzelFehlt, ZielNichtSchreibbar, eigener_katalog, kanonisch
from .config import TYPEN, Konfig, KonfigFehler, Wurzel, katalog_ziel, konfig_pfad, lies_konfig, schreibe_konfig
from .features import MerkmalCache
from starter.tools import WerkzeugFehlt

NAME = "djk-bibliothek"
FREMD_HINWEIS = "built by another program, read only"
KEINE_ORDNER = f"{NAME}: no folders yet: run {NAME} dazu <folder>"


def fehler(text: str) -> None:
    print(f"{NAME}: {text}", file=sys.stderr)


def absolut(arg: str) -> Path:
    return Path(os.path.abspath(os.path.expanduser(arg)))


def _echt(p: Path) -> Path:
    return Path(os.path.realpath(p))


def _enthalten(innen: Path, aussen: Path) -> bool:
    return innen == aussen or aussen in innen.parents


def cmd_dazu(a: argparse.Namespace) -> int:
    k = lies_konfig()
    pfad = absolut(a.dir)
    if not pfad.is_dir():
        fehler(f"{pfad} is not an existing directory")
        return 2
    neu = _echt(pfad)
    for w in k.wurzeln:
        alt = _echt(w.pfad)
        if _enthalten(neu, alt) or _enthalten(alt, neu):
            fehler(f"{pfad} overlaps the existing folder {w.pfad} (equal, inside or containing); nothing changed")
            return 2
    schreibe_konfig(Konfig(1, [*k.wurzeln, Wurzel(pfad, a.typ)]))
    print(f"added {pfad} (typ {a.typ}); config {konfig_pfad()}")
    return 0


def cmd_weg(a: argparse.Namespace) -> int:
    k = lies_konfig()
    pfad = absolut(a.dir)
    rest = [w for w in k.wurzeln if w.pfad != pfad and _echt(w.pfad) != _echt(pfad)]
    if len(rest) == len(k.wurzeln):
        fehler(f"{pfad} is not a library folder (see: {NAME} zeige)")
        return 2
    schreibe_konfig(Konfig(1, rest))
    print(f"removed {pfad}")
    return 0


def _lies_stand(ziel: Path) -> dict[str, str] | None:
    try:
        db = sqlite3.connect(kanonisch(ziel).as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            return dict(db.execute("SELECT schluessel, wert FROM stand").fetchall())
        finally:
            db.close()
    except Exception:
        return None


def _zaehle_fremd(ziel: Path) -> dict[str, int] | None:
    try:
        db = sqlite3.connect(kanonisch(ziel).as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            return {t: n for t, n in db.execute("select typ, count(*) from katalog group by typ order by typ")}
        finally:
            db.close()
    except Exception:
        return None


def cmd_zeige(a: argparse.Namespace) -> int:
    k = lies_konfig()
    ziel = katalog_ziel(os.environ)
    eigen, _ = eigener_katalog(ziel)
    zustand = "absent" if eigen is None else "own" if eigen else "foreign"
    zaehlung = None
    hinweis = None
    if zustand == "own":
        stand = _lies_stand(ziel) or {}
        try:
            zaehlung = json.loads(stand.get("zaehlung", "null"))
        except ValueError:
            zaehlung = None
    elif zustand == "foreign":
        zaehlung = _zaehle_fremd(ziel)
        hinweis = FREMD_HINWEIS
    d = {"konfig": str(konfig_pfad()), "wurzeln": [{"pfad": str(w.pfad), "typ": w.typ} for w in k.wurzeln],
         "ziel": str(ziel), "zustand": zustand, "zaehlung": zaehlung, "hinweis": hinweis}
    if a.json:
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return 0
    print(f"config: {d['konfig']}")
    if k.wurzeln:
        print("folders:")
        for w in k.wurzeln:
            print(f"  {w.pfad} (typ {w.typ})")
    else:
        print(f"folders: none ({KEINE_ORDNER})")
    print(f"target: {ziel}")
    print(f"state: {zustand}")
    if zaehlung:
        zeilen = zaehlung.get("zeilen", zaehlung) if zustand == "own" else zaehlung
        for t, n in zeilen.items():
            print(f"  {t}: {n}")
        if zustand == "own" and zaehlung.get("ausgelassen"):
            print("  skipped: " + ", ".join(f"{g} {n}" for g, n in zaehlung["ausgelassen"].items()))
    if hinweis:
        print(hinweis)
    return 0


def cmd_bauen(a: argparse.Namespace) -> int:
    k = lies_konfig()
    if not k.wurzeln:
        print(KEINE_ORDNER, file=sys.stderr)
        return 2
    ziel = katalog_ziel(os.environ)
    zaehler: dict[str, int] = {}

    def fortschritt(n: int) -> None:
        print(f"scanned {n} files ({zaehler.get('track', 0)} track, {zaehler.get('loop', 0)} loop, "
              f"{zaehler.get('oneshot', 0)} oneshot, {zaehler.get('skipped', 0)} skipped)", file=sys.stderr, flush=True)

    cache = MerkmalCache()
    try:
        r = katalog_bau.baue(ziel, k, cache, a.ohne_fehlende, fortschritt, zaehler=zaehler, leer_erlaubt=a.leer_erlaubt)
    except FremderKatalog as e:
        fehler(f"{e.ziel} was not built by {NAME} and is left untouched. "
               "Set CYPHERDJ_KATALOG to another file to build your own catalog.")
        return 3
    except WurzelFehlt as e:
        fehler(f"library root is missing: {e.pfad} (drive unplugged? nothing was changed; "
               f"{NAME} weg <folder> removes it, bauen --ohne-fehlende builds without it)")
        return 4
    except LeererBau as e:
        fehler(f"the scan found no audio files but {e.ziel} has {e.zeilen} rows (drive unplugged? empty mount point?). "
               f"Nothing was changed. {NAME} bauen --leer-erlaubt empties the catalog on purpose.")
        return 6
    except WerkzeugFehlt as e:
        fehler(e.hinweis)
        return 2
    except ZielNichtSchreibbar as e:
        fehler(f"cannot put the catalog at {e.ziel}: {e.ursache}. The build needs hard links on the target file system "
               "(not available on exFAT/FAT). Set CYPHERDJ_KATALOG to a file on another file system.")
        return 5
    finally:
        cache.schliessen()
    for f in r.fehlende_wurzeln:
        fehler(f"skipped missing folder {f}")
    z = r.zeilen
    print(f"built {r.ziel}: {z['track']} track, {z['loop']} loop, {z['oneshot']} oneshot")
    if r.ausgelassen:
        print("skipped: " + ", ".join(f"{g} {n}" for g, n in sorted(r.ausgelassen.items())))
    print(f"hashed {r.gehasht} files")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog=NAME, description="Turn your own folders into the browser catalog.")
    sub = p.add_subparsers(dest="befehl", required=True)
    d = sub.add_parser("dazu", help="add a folder")
    d.add_argument("dir")
    d.add_argument("--typ", choices=TYPEN, default="auto")
    d.set_defaults(fn=cmd_dazu)
    w = sub.add_parser("weg", help="remove a folder")
    w.add_argument("dir")
    w.set_defaults(fn=cmd_weg)
    z = sub.add_parser("zeige", help="show config, target, state and counts (read only)")
    z.add_argument("--json", action="store_true")
    z.set_defaults(fn=cmd_zeige)
    b = sub.add_parser("bauen", help="scan the folders and build the catalog")
    b.add_argument("--ohne-fehlende", action="store_true", help="build although a folder is missing (unplugged drive)")
    b.add_argument("--leer-erlaubt", action="store_true",
                   help="build although the scan finds nothing and the existing catalog has rows")
    b.set_defaults(fn=cmd_bauen)
    try:
        a = p.parse_args(argv)
    except SystemExit as e:
        return 0 if e.code in (0, None) else 2
    try:
        return a.fn(a)
    except KonfigFehler as e:
        fehler(str(e))
        return 2


if __name__ == "__main__":
    sys.exit(main())
