"""Storage places of cypher-dj: one table (djk/config/ablage.json), read here and by djk/ui/pfade.ts.

Resolution (same as paths.ts): (1) the kind's env variable, non-empty; (2) core kinds and vorgabe "alt" give alt;
(3) vorgabe "neu": alt when it is a real directory, else neu; alt a link to a missing target (moved, disk absent) raises ValueError. A real alt next to a non-empty neu stays at alt
and prints one warning per kind and process.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

TABELLE_PFAD = Path(__file__).resolve().parents[1] / "config" / "ablage.json"
REPO = Path(__file__).resolve().parents[2]   # {REPO}: the repo root (package: /opt/cypher-dj), read-only in the package
_tabelle: dict | None = None
_gewarnt: set[str] = set()


def _lade() -> dict:
    global _tabelle
    if _tabelle is None:
        _tabelle = json.loads(TABELLE_PFAD.read_text(encoding="utf-8"))
    return _tabelle


def _env(env) -> dict:
    return os.environ if env is None else env


def _home(env) -> str:
    return _env(env).get("HOME") or os.path.expanduser("~")


def heim(env=None) -> Path:
    e = _env(env)
    roh = e.get("CYPHERDJ_HEIM")
    if roh is None or roh == "":
        return Path(_home(env)) / "cypherdj"
    t = roh.strip().rstrip("/")
    if t == "" or not t.startswith("/"):
        raise ValueError("CYPHERDJ_HEIM must be an absolute path")
    return Path(t)


def _fuelle(vorlage: str, env, repo=None) -> str:
    home = _home(env)
    out = vorlage.replace("{HOME}", home).replace("{KONFIG}", f"{home}/.config/cypherdj").replace("{REPO}", str(repo or REPO))
    if "{HEIM}" in out:
        out = out.replace("{HEIM}", str(heim(env)))
    return out


def arten(tabelle=None) -> list[str]:
    return list((tabelle or _lade())["arten"])


def orte(art: str, env=None, tabelle=None, repo=None) -> dict:
    z = (tabelle or _lade())["arten"].get(art)
    if z is None:
        raise KeyError(f"unknown storage kind: {art}")
    return {"alt": _fuelle(z["alt"], env, repo), "neu": _fuelle(z["neu"], env, repo), "env": z["env"], "kern": z["kern"]}


def _echter_ordner(p: str) -> bool:
    return os.path.isdir(p) and not os.path.islink(p)


def _nicht_leer(p: str) -> bool:
    try:
        return len(os.listdir(p)) > 0
    except OSError:
        return False


def ordner(art: str, env=None, tabelle=None, repo=None) -> Path:
    t = tabelle or _lade()
    o = orte(art, env, t, repo)
    e = _env(env).get(o["env"] or "", "") if o["env"] else ""
    if e != "":
        return Path(e)
    if o["kern"] or t.get("vorgabe") != "neu":
        return Path(o["alt"])
    if os.path.islink(o["alt"]) and not os.path.exists(o["alt"]):
        raise ValueError(f"{art}: {o['alt']} is a link to {os.readlink(o['alt'])}, which is missing: is the disk mounted? "
                         "Aborting instead of choosing another place")
    if not _echter_ordner(o["alt"]):
        return Path(o["neu"])
    if _nicht_leer(o["neu"]) and art not in _gewarnt:
        _gewarnt.add(art)
        print(f"ablage_beide: {art}: real {o['alt']} and non-empty {o['neu']}; staying at the old place", file=sys.stderr)
    return Path(o["alt"])


def fest_namen() -> list[str]:
    return list(_lade()["fest"])


def fest(name: str, env=None) -> Path:
    z = _lade()["fest"].get(name)
    if z is None:
        raise KeyError(f"unknown fixed name: {name}")
    e = _env(env).get(z["env"], "") if z["env"] else ""
    return Path(e) if e != "" else Path(_fuelle(z["pfad"], env))


def lesbarer_name(text: str, max: int = 40) -> str:  # noqa: A002 (name fixed by the interface)
    s = text.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max].rstrip("-")
