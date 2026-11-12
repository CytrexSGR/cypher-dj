"""Walk a library root and yield audio files, or the reason a candidate was skipped."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .config import Wurzel

ENDUNGEN = (".wav", ".aif", ".aiff", ".aifc", ".flac", ".mp3", ".ogg", ".opus", ".m4a")


@dataclass(frozen=True)
class Datei:
    pfad: Path
    rel: str
    wurzel: Wurzel
    groesse: int
    mtime_ns: int


@dataclass(frozen=True)
class Auslassung:
    pfad: str  # repr() of the path when it is not valid UTF-8
    grund: str  # 'leer' | 'unlesbar' | 'pfad_kodierung'


def _utf8(s: str) -> bool:
    try:
        s.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def scanne(w: Wurzel) -> Iterator[Datei | Auslassung]:
    """Raises FileNotFoundError when the root itself is missing; everything below it is skipped and reported."""
    wurzel = str(w.pfad)
    if not os.path.isdir(wurzel):
        raise FileNotFoundError(wurzel)
    fehler: list[OSError] = []
    for ordner, dirs, dateien in os.walk(wurzel, followlinks=False, onerror=fehler.append):
        yield from _auslassungen(fehler)
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(dateien):
            if name.startswith(".") or not name.lower().endswith(ENDUNGEN):
                continue
            voll = os.path.join(ordner, name)
            if not _utf8(voll):
                yield Auslassung(repr(voll), "pfad_kodierung")
                continue
            try:
                st = os.stat(voll)  # follows file symlinks; a broken or looping link raises
            except OSError:
                yield Auslassung(voll, "unlesbar")
                continue
            if not os.path.isfile(voll):
                continue
            if st.st_size == 0:
                yield Auslassung(voll, "leer")
                continue
            if not os.access(voll, os.R_OK):
                yield Auslassung(voll, "unlesbar")
                continue
            rel = os.path.relpath(voll, wurzel).replace(os.sep, "/")
            yield Datei(Path(voll), rel, w, st.st_size, st.st_mtime_ns)
    yield from _auslassungen(fehler)


def _auslassungen(fehler: list[OSError]) -> Iterator[Auslassung]:
    """Folders (or the root) that could not be listed: one 'unlesbar' each; nothing below them is seen."""
    while fehler:
        e = fehler.pop(0)
        pfad = str(e.filename) if e.filename is not None else "?"
        yield Auslassung(pfad if _utf8(pfad) else repr(pfad), "unlesbar")
