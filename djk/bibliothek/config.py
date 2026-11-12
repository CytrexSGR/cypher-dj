"""Library config (~/.config/cypherdj/bibliothek.json) and the catalog target path."""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

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
    vorgabe = os.environ.get("CYPHERDJ_BIBLIOTHEK_KONFIG")
    if vorgabe:
        return Path(vorgabe)
    return Path(os.path.expanduser("~")) / ".config" / "cypherdj" / "bibliothek.json"


def lies_konfig() -> Konfig:
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
    med = env.get("CYPHERDJ_MEDIATHEK")
    if med:
        return Path(med).parent / "katalog.sqlite"
    return Path(os.path.expanduser("~")) / ".local" / "share" / "cypherdj" / "mediathek" / "katalog.sqlite"
