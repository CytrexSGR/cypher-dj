"""Library config (~/.config/cypherdj/bibliothek.json) and the catalog target path."""
from __future__ import annotations

import json
import os
import socket
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

import storage as ablage  # the storage table package djk/ablage (PYTHONPATH or pytest pythonpath puts djk first)
from quellen import alt as _quellen_alt
from quellen import file as _quellen

TYPEN = ("auto", "track", "loop", "oneshot")


class KonfigFehler(Exception):
    """The config file is unreadable, has another schema, or has bad content."""


@dataclass(frozen=True)
class Wurzel:
    pfad: Path
    typ: str = "auto"


@dataclass(frozen=True)
class Konfig:
    schema: int = 1
    wurzeln: list[Wurzel] = field(default_factory=list)


def konfig_pfad() -> Path:
    return ablage.fest("bibliothek_konfig")


_ART_AUS_TYP = {"auto": "sample", "track": "track", "loop": "loop", "oneshot": "oneshot"}
_KATALOG_ARTEN = ("track", "loop", "oneshot", "sample")


def _quellen_pfad() -> Path:
    return ablage.fest("quellen")


def _quellen_lesen() -> tuple[_quellen.Quellen | None, str]:
    """The source list when quellen.toml exists (else None) and this machine's name."""
    p = _quellen_pfad()
    if not p.is_file():
        return None, ""
    try:
        return _quellen.lies(p), socket.gethostname()
    except _quellen.QuellenFehler as e:
        raise KonfigFehler(str(e)) from e


def _aus_quellen(q: _quellen.Quellen, host: str) -> Konfig:
    """The catalog roots of this machine, mapped as the generated bibliothek.json would have them."""
    return Konfig(1, [Wurzel(Path(e["pfad"]), e["typ"]) for e in _quellen_alt._bibliothek(q, host)["wurzeln"]])


def _in_quellen(k: Konfig, q: _quellen.Quellen, host: str) -> None:
    """Brings the catalog roots of this machine in quellen.toml to the roots of k; every other entry stays as it is."""
    soll = {os.path.realpath(w.pfad): w for w in k.wurzeln}
    gesehen: set[str] = set()
    benutzt = {kl.wurzel for kl in q.klang}
    namen = {w.name for w in q.wurzeln}
    for w in list(q.wurzeln):
        p = _quellen.pfad_fuer(w, host)
        if not (w.katalog and w.art in _KATALOG_ARTEN and p):
            continue
        echt = os.path.realpath(p)
        if echt in soll and echt not in gesehen:
            gesehen.add(echt)
            if _ART_AUS_TYP[soll[echt].typ] != w.art and not (w.art == "sample" and soll[echt].typ == "auto"):
                w.art = _ART_AUS_TYP[soll[echt].typ]
        elif w.name in benutzt:
            w.katalog = False                      # a kit source still names this root: keep it, hide it from the catalog
        else:
            q.wurzeln.remove(w)
            namen.discard(w.name)
    for echt, w in soll.items():
        if echt in gesehen:
            continue
        name = _quellen_alt._frei(os.path.basename(str(w.pfad).rstrip("/")), namen)
        namen.add(name)
        q.wurzeln.append(_quellen.Wurzel(name=name, art=_ART_AUS_TYP[w.typ], pfad=str(w.pfad)))


def lies_konfig() -> Konfig:
    q, host = _quellen_lesen()
    if q is not None:
        return _aus_quellen(q, host)
    p = konfig_pfad()
    try:
        text = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return Konfig(1, [])
    except (OSError, UnicodeDecodeError) as e:
        raise KonfigFehler(f"cannot read {p}: {e}") from e
    try:
        d = json.loads(text)
    except json.JSONDecodeError as e:
        raise KonfigFehler(f"{p} is not valid JSON: {e}") from e
    if not isinstance(d, dict) or d.get("schema") != 1:
        raise KonfigFehler(f"{p}: schema must be 1")
    roh = d.get("wurzeln")
    if not isinstance(roh, list):
        raise KonfigFehler(f"{p}: 'wurzeln' must be a list")
    wurzeln: list[Wurzel] = []
    for e in roh:
        if not isinstance(e, dict) or not isinstance(e.get("pfad"), str) or not os.path.isabs(e["pfad"]):
            raise KonfigFehler(f"{p}: every root needs an absolute 'pfad'")
        typ = e.get("typ", "auto")
        if typ not in TYPEN:
            raise KonfigFehler(f"{p}: 'typ' must be one of {', '.join(TYPEN)} (got {typ!r})")
        wurzeln.append(Wurzel(Path(e["pfad"]), typ))
    return Konfig(1, wurzeln)


def schreibe_konfig(k: Konfig) -> None:
    q, host = _quellen_lesen()
    if q is not None:                              # quellen.toml owns the list; bibliothek.json is left alone
        _in_quellen(k, q, host)
        try:
            _quellen.schreibe(_quellen_pfad(), q)
        except _quellen.QuellenFehler as e:
            raise KonfigFehler(str(e)) from e
        return
    p = konfig_pfad()
    p.parent.mkdir(parents=True, exist_ok=True)
    inhalt = json.dumps(
        {"schema": k.schema, "wurzeln": [{"pfad": str(w.pfad), "typ": w.typ} for w in k.wurzeln]},
        indent=2, ensure_ascii=False,
    ) + "\n"
    fd, tmp = tempfile.mkstemp(prefix=p.name + ".", suffix=".tmp", dir=p.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(inhalt)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def katalog_ziel(env: Mapping[str, str]) -> Path:
    """Where the page reads the catalog (catalog.ts:55-57, media_library.ts:21)."""
    if env.get("CYPHERDJ_KATALOG"):
        return Path(env["CYPHERDJ_KATALOG"])
    return ablage.fest("mediathek", env).parent / "katalog.sqlite"
