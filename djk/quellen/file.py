"""Read, validate and write quellen.toml."""
from __future__ import annotations

import fcntl
import json
import os
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ARTEN = ("track", "loop", "oneshot", "sample", "mix", "mitschnitt", "midi", "spiegel", "erzeugt", "stimme")
_NACKT = re.compile(r"^[A-Za-z0-9_-]+$")


class QuellenFehler(Exception):
    """The file is unreadable or has bad content; the text names the entry and the field."""


@dataclass
class Wurzel:
    name: str
    art: str
    pfad: str | None = None                        # on every machine without an entry in pfade
    pfade: dict[str, str] = field(default_factory=dict)   # machine name -> path
    wechselplatte: bool | None = None              # None: decided by the mount point of the path
    katalog: bool = True
    regal: bool = False
    laufwerk: str | None = None
    mediathek: dict = field(default_factory=dict)  # passed through to the media library unchanged


@dataclass
class Klang:
    name: str
    wurzel: str
    rel: str = ""


@dataclass
class Quellen:
    schema: int = 1
    wurzeln: list[Wurzel] = field(default_factory=list)
    klang: list[Klang] = field(default_factory=list)
    fern: list[dict] = field(default_factory=list)


def pfad_fuer(w: Wurzel, host: str) -> str | None:
    return w.pfade.get(host) or w.pfad


def ist_wechselplatte(w: Wurzel, host: str) -> bool:
    if w.wechselplatte is not None:
        return w.wechselplatte
    p = pfad_fuer(w, host) or ""
    return p.startswith("/media/") or p.startswith("/run/media/")


def pruefe(q: Quellen) -> None:
    if q.schema != 1:
        raise QuellenFehler("schema must be 1")
    namen: set[str] = set()
    for w in q.wurzeln:
        wo = f'wurzel "{w.name}"'
        if not isinstance(w.name, str) or not 1 <= len(w.name) <= 40 or "/" in w.name:
            raise QuellenFehler(f"{wo}: name must have 1 to 40 characters and no '/'")
        if w.name in namen:
            raise QuellenFehler(f"{wo}: name is used twice")
        namen.add(w.name)
        if w.art not in ARTEN:
            raise QuellenFehler(f"{wo}: art must be one of {', '.join(ARTEN)}")
        if w.pfad is None and not w.pfade:
            raise QuellenFehler(f"{wo}: pfad or [wurzel.pfade] is needed")
        if w.pfad is not None and not (isinstance(w.pfad, str) and w.pfad.startswith("/")):
            raise QuellenFehler(f"{wo}: pfad must be an absolute path")
        for host, p in w.pfade.items():
            if not (isinstance(p, str) and p.startswith("/")):
                raise QuellenFehler(f"{wo}: pfade.{host} must be an absolute path")
        for feld in ("katalog", "regal"):
            if not isinstance(getattr(w, feld), bool):
                raise QuellenFehler(f"{wo}: {feld} must be true or false")
        if w.wechselplatte is not None and not isinstance(w.wechselplatte, bool):
            raise QuellenFehler(f"{wo}: wechselplatte must be true or false")
    klangnamen: set[str] = set()
    for k in q.klang:
        wo = f'klang "{k.name}"'
        if not k.name or k.name in klangnamen:
            raise QuellenFehler(f"{wo}: name is empty or used twice")
        klangnamen.add(k.name)
        if k.wurzel not in namen:
            raise QuellenFehler(f"{wo}: wurzel names no root")
        if k.rel.startswith("/") or ".." in k.rel.split("/"):
            raise QuellenFehler(f"{wo}: rel must be a relative path inside the root")


def _aus_dict(d: dict, wo: str) -> Quellen:
    fremd = set(d) - {"schema", "wurzel", "klang", "fern"}
    if fremd:
        raise QuellenFehler(f"{wo}: unknown key {sorted(fremd)[0]}")
    q = Quellen(schema=d.get("schema", 0), fern=list(d.get("fern", [])))
    for e in d.get("wurzel", []):
        fremd = set(e) - {"name", "art", "pfad", "pfade", "wechselplatte", "katalog", "regal", "laufwerk", "mediathek"}
        if fremd:
            raise QuellenFehler(f'wurzel "{e.get("name")}": unknown key {sorted(fremd)[0]}')
        q.wurzeln.append(Wurzel(name=e.get("name", ""), art=e.get("art", ""), pfad=e.get("pfad"),
                                pfade=dict(e.get("pfade", {})), wechselplatte=e.get("wechselplatte"),
                                katalog=e.get("katalog", True), regal=e.get("regal", False),
                                laufwerk=e.get("laufwerk"), mediathek=dict(e.get("mediathek", {}))))
    for e in d.get("klang", []):
        q.klang.append(Klang(name=e.get("name", ""), wurzel=e.get("wurzel", ""), rel=e.get("rel", "")))
    pruefe(q)
    return q


def lies(pfad) -> Quellen:
    """A missing file is an empty list; a bad one raises QuellenFehler."""
    p = Path(pfad)
    try:
        roh = p.read_bytes()
    except FileNotFoundError:
        return Quellen()
    except OSError as e:
        raise QuellenFehler(f"{p}: {e}") from e
    try:
        d = tomllib.loads(roh.decode("utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as e:
        raise QuellenFehler(f"{p}: {e}") from e
    try:
        return _aus_dict(d, str(p))
    except QuellenFehler as e:
        raise QuellenFehler(f"{p}: {e}") from e


def _schluessel(k: str) -> str:
    return k if _NACKT.match(k) else json.dumps(k, ensure_ascii=False)


def toml_wert(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False).replace("\x7f", "\\u007f")
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(toml_wert(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{_schluessel(k)} = {toml_wert(x)}" for k, x in v.items()) + "}"
    raise QuellenFehler(f"value cannot be written as TOML: {v!r}")


def als_toml(q: Quellen) -> str:
    z = ["# Source folders of cypher-dj. Edit here; the old lists are generated from this file (python3 -m quellen).", "",
         f"schema = {q.schema}"]
    for w in q.wurzeln:
        z += ["", "[[wurzel]]", f"name = {toml_wert(w.name)}", f"art = {toml_wert(w.art)}"]
        if w.pfad is not None:
            z.append(f"pfad = {toml_wert(w.pfad)}")
        if w.wechselplatte is not None:
            z.append(f"wechselplatte = {toml_wert(w.wechselplatte)}")
        if not w.katalog:
            z.append("katalog = false")
        if w.regal:
            z.append("regal = true")
        if w.laufwerk is not None:
            z.append(f"laufwerk = {toml_wert(w.laufwerk)}")
        if w.pfade:
            z.append("[wurzel.pfade]")
            z += [f"{_schluessel(h)} = {toml_wert(p)}" for h, p in w.pfade.items()]
        if w.mediathek:
            z.append("[wurzel.mediathek]")
            z += [f"{_schluessel(k)} = {toml_wert(v)}" for k, v in w.mediathek.items()]
    for k in q.klang:
        z += ["", "[[klang]]", f"name = {toml_wert(k.name)}", f"wurzel = {toml_wert(k.wurzel)}", f"rel = {toml_wert(k.rel)}"]
    for f in q.fern:
        z += ["", "[[fern]]"] + [f"{_schluessel(k)} = {toml_wert(v)}" for k, v in f.items()]
    return "\n".join(z) + "\n"


def schreibe_text(pfad, text: str) -> bool:
    """Atomic write (temp file, os.replace); False when the file already has this content. Never creates the folder."""
    p = Path(pfad)
    try:
        if p.read_text(encoding="utf-8") == text:
            return False
    except (OSError, UnicodeDecodeError):
        pass
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, p)
    return True


def schreibe(pfad, q: Quellen) -> bool:
    """Writes quellen.toml under a lock; False when unchanged. The folder must exist (the home is never created here)."""
    pruefe(q)
    p = Path(pfad)
    if not p.parent.is_dir():
        raise QuellenFehler(f"heim_nicht_bereit: the folder {p.parent} does not exist (run djk-umzug einrichten)")
    with open(p.with_name(p.name + ".lock"), "w", encoding="utf-8") as sperre:
        fcntl.flock(sperre, fcntl.LOCK_EX)
        return schreibe_text(p, als_toml(q))
