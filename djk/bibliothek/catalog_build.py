"""Build katalog.sqlite (schema 1, read by djk/ui/catalog.ts) from the library roots.

The target is always written as a whole new file and swapped in. A catalog this builder did not build is never replaced:
on Andreas' machine the resolved path is the private catalog of cypher-mediathek (plan decision D4, the costliest error).
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import hashlib
import socket
import sqlite3
import stat as stat_mod
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .config import Konfig
from .features import MerkmalCache, felder, merkmale
from .scan import Auslassung, Datei, MidiDatei, scanne
from .typ_regel import bestimme

ERBAUER = "djk-bibliothek"

# The schema of djk/ui/tests/support/catalog.mjs:9-19, then the indices of the private builder. One column is added at the end:
# bpm_geschaetzt (the analysis' tempo guess, not a fact). The page reads `SELECT k.*`, so an old catalogue without it works as before.
DDL = """
CREATE TABLE stand(schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);
CREATE TABLE katalog(id INTEGER PRIMARY KEY, typ TEXT NOT NULL, werk_id INTEGER, sha TEXT NOT NULL, shas TEXT NOT NULL,
  titel TEXT, kuenstler TEXT, mix TEXT, bpm REAL, camelot TEXT, energie REAL, genre TEXT, pack TEXT, instrument TEXT,
  kategorie TEXT, takte REAL, schutz TEXT, label TEXT, jahr TEXT, release TEXT, katalognummer TEXT, isrc TEXT, remixer TEXT,
  dauer_s REAL, pfad TEXT, ordner TEXT, name TEXT, alle TEXT, bpm_geschaetzt REAL);
CREATE VIRTUAL TABLE katalog_fts USING fts5(titel, kuenstler, mix, genre, label, pack, instrument, kategorie, jahr, ordner,
  name, release, katalognummer, isrc, remixer, alle, content='katalog', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE INDEX k_sha ON katalog(sha);
CREATE INDEX k_titel ON katalog(typ, titel COLLATE NOCASE, id);
CREATE INDEX k_kuenstler ON katalog(typ, kuenstler COLLATE NOCASE, id);
CREATE INDEX k_name ON katalog(typ, name COLLATE NOCASE, id);
CREATE INDEX k_pack ON katalog(typ, pack COLLATE NOCASE, id);
CREATE INDEX k_genre ON katalog(typ, genre COLLATE NOCASE, id);
CREATE INDEX k_instrument ON katalog(typ, instrument, id);
CREATE INDEX k_bpm ON katalog(typ, bpm, id);
CREATE INDEX k_camelot ON katalog(typ, camelot, id);
CREATE INDEX k_energie ON katalog(typ, energie, id);
CREATE INDEX k_takte ON katalog(typ, takte, id);
CREATE INDEX k_dauer ON katalog(typ, dauer_s, id);
CREATE INDEX k_ordner ON katalog(typ, ordner, id);
"""

SPALTEN = ("typ", "werk_id", "sha", "shas", "titel", "kuenstler", "mix", "bpm", "camelot", "energie", "genre", "pack",
           "instrument", "kategorie", "takte", "schutz", "label", "jahr", "release", "katalognummer", "isrc", "remixer",
           "dauer_s", "pfad", "ordner", "name", "alle", "bpm_geschaetzt")
TYPEN = ("track", "loop", "oneshot")
FORTSCHRITT_ALLE = 1000


class FremderKatalog(Exception):
    """The target exists (or appeared) and is not a catalog built by this program."""

    def __init__(self, ziel: Path):
        super().__init__(f"{ziel} is not a catalog built by djk-bibliothek")
        self.ziel = ziel


class WurzelFehlt(Exception):
    """A configured root does not exist (unplugged drive?)."""

    def __init__(self, pfad: str):
        super().__init__(f"library root is missing: {pfad}")
        self.pfad = pfad


class LeererBau(Exception):
    """The scan found nothing, but the own catalog at the target has rows (unplugged drive, empty mount point?)."""

    def __init__(self, ziel: Path, zeilen: int):
        super().__init__(f"the scan found no audio files but {ziel} has {zeilen} rows; not emptied")
        self.ziel = ziel
        self.zeilen = zeilen


class LueckenBau(LeererBau):
    """Some folder could not be listed and the scan found fewer rows than the own catalog has: replacing the catalog would
    lose the rows below that folder (permissions, a share that dropped). Same return code as LeererBau."""

    def __init__(self, ziel: Path, zeilen: int, neu: int):
        Exception.__init__(self, f"a folder could not be read and the scan found {neu} rows but {ziel} has {zeilen}; not replaced")
        self.ziel = ziel
        self.zeilen = zeilen
        self.neu = neu


class ZielNichtSchreibbar(Exception):
    """The finished catalog could not be put at the target (no hard links on this file system, no permission, ...)."""

    def __init__(self, ziel: Path, ursache: OSError):
        super().__init__(f"cannot put the catalog at {ziel}: {ursache}")
        self.ziel = ziel
        self.ursache = ursache


@dataclass
class Ergebnis:
    ziel: Path
    zeilen: dict[str, int]
    ausgelassen: dict[str, int]
    gehasht: int
    fehlende_wurzeln: list[str] = field(default_factory=list)
    marke: str = ""


def kanonisch(ziel: Path) -> Path:
    """The target as the kernel sees it: real path of the folder plus the base name; the target itself is not followed.

    `..` after a symlink is resolved by the file system, not textually (os.path.abspath would get it wrong). Everything
    that looks at or writes the target (lstat, the read-only URI, os.link, os.replace) uses this one path.
    """
    z = os.fspath(ziel)
    ordner, name = os.path.split(z)
    if name in ("", ".", ".."):
        return Path(os.path.realpath(z))
    return Path(os.path.realpath(ordner or ".")) / name


def eigener_katalog(ziel: Path) -> tuple[bool | None, os.stat_result | None]:
    """(None, None) when the target is absent; (True, lstat) when it is a catalog of this builder; (False, ...) otherwise.

    Only FileNotFoundError means absent. Anything else that is not a readable SQLite file with `stand.erbauer` equal to
    ERBAUER (a symlink, a directory, a permission error, a damaged or foreign file) is False. The file is opened read
    only and immutable, so the check never creates a -wal/-shm/-journal file next to a foreign catalog.
    """
    ziel = kanonisch(ziel)
    try:
        st = os.lstat(ziel)
    except FileNotFoundError:
        return None, None
    except OSError:
        return False, None
    if not stat_mod.S_ISREG(st.st_mode):
        return False, st
    try:
        uri = ziel.as_uri() + "?mode=ro&immutable=1"  # as_uri escapes ?, # and %
        db = sqlite3.connect(uri, uri=True)
        try:
            stand = dict(db.execute("SELECT schluessel, wert FROM stand").fetchall())
        finally:
            db.close()
    except Exception:
        return False, st
    return stand.get("erbauer") == ERBAUER, st


@contextlib.contextmanager
def bau_sperre(ziel: Path):
    """One build at a time per catalogue, across processes (CLI, page servers): an exclusive flock on `.<name>.lock` next to the target.

    A second build waits here until the first one is over and then runs on the finished catalogue, so a lost race never shows up as
    a foreign catalogue. The kernel drops the lock when its process dies (SIGKILL included). If the lock file cannot be opened
    (folder not writable) the build goes on without it: it then fails on its own with the file system error.
    """
    ziel = kanonisch(Path(ziel))
    fd = None
    try:
        if eigener_katalog(ziel)[0] is False:
            raise OSError("foreign catalogue: nothing is written next to it, not even a lock file; baue() refuses it")
        ziel.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(ziel.parent / f".{ziel.name}.lock", os.O_CREAT | os.O_RDWR, 0o644)
        fcntl.flock(fd, fcntl.LOCK_EX)
    except OSError:
        if fd is not None:
            os.close(fd)
        fd = None
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)  # closing releases the flock


def _zeilenzahl(ziel: Path) -> int:
    try:
        db = sqlite3.connect(ziel.as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            return int(db.execute("SELECT count(*) FROM katalog").fetchone()[0])
        finally:
            db.close()
    except Exception:
        return 0


def _lebt(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return True
    return True


def _alte_teile_raeumen(ordner: Path) -> None:
    """Remove part files `.katalog.sqlite.<pid>.teil` (and their journal) of processes that no longer run."""
    try:
        namen = os.listdir(ordner)
    except OSError:
        return
    for n in namen:
        if not (n.startswith(".katalog.sqlite.") and n.endswith(".teil")):
            continue
        pid = n[len(".katalog.sqlite."):-len(".teil")]
        if not pid.isascii() or not pid.isdigit() or len(pid) > 10:
            continue  # not a name this builder wrote (a pid has at most 7 digits on Linux): leave it alone
        try:
            if _lebt(int(pid)):
                continue
        except (OverflowError, ValueError):
            continue
        for x in (n, n + "-journal"):
            try:
                os.unlink(ordner / x)
            except OSError:
                pass


def _entferne(p: Path) -> None:
    for x in (p, Path(str(p) + "-journal")):
        try:
            os.unlink(x)
        except FileNotFoundError:
            pass
        except OSError:
            pass


TICK_MIN_S = 0.25  # at most 4 progress calls per second, plus the last call of each phase


class _Tick:
    """Time-throttled wrapper of the optional `tick(phase, fertig, gesamt)` callback."""

    def __init__(self, fn: Callable[[str, int, int | None], None] | None):
        self.fn = fn
        self.zuletzt = 0.0

    def __call__(self, phase: str, fertig: int, gesamt: int | None, letzter: bool = False) -> None:
        if self.fn is None:
            return
        jetzt = time.monotonic()
        if letzter or jetzt - self.zuletzt >= TICK_MIN_S:
            self.zuletzt = jetzt
            self.fn(phase, fertig, gesamt)


def baum_marke(konfig: Konfig) -> str:
    """sha256 over the sorted (directory path, mtime_ns) of every directory below every root: a stat walk of directories
    only, never of files. A new or removed entry changes the mtime of its directory; a file edited in place does not
    (documented limit). Hidden folders are skipped like the scan does; a missing root contributes nothing."""
    paare: list[tuple[str, int]] = []
    for w in konfig.wurzeln:
        wurzel = str(w.pfad)
        for ordner, dirs, _dateien in os.walk(wurzel, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith("."))
            try:
                paare.append((ordner, os.stat(ordner).st_mtime_ns))
            except OSError:
                continue
    h = hashlib.sha256()
    for p, m in sorted(paare):
        h.update(f"{p}\0{m}\n".encode("utf-8", "surrogateescape"))
    return h.hexdigest()


def schreibe_midi_liste(ziel: Path, midi: list[MidiDatei]) -> None:
    """{ schema: 1, dateien: [{pfad, name, groesse}] } written atomically (temp file and rename)."""
    ziel.parent.mkdir(parents=True, exist_ok=True)
    daten = {"schema": 1, "dateien": [{"pfad": str(m.pfad), "name": m.pfad.name, "groesse": m.groesse}
                                       for m in sorted(midi, key=lambda m: str(m.pfad))]}
    tmp = ziel.with_name(f".{ziel.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(daten, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, ziel)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _sammle(konfig: Konfig, cache: MerkmalCache, ohne_fehlende: bool, fortschritt: Callable[[int], None],
            zaehler: dict[str, int] | None = None, tick: _Tick | None = None, midi: list[MidiDatei] | None = None):
    zeilen: dict[str, dict[str, object]] = {}  # sha -> row of the first path in sorted order
    ausgelassen: dict[str, int] = {}
    fehlende: list[str] = []
    luecken: list[str] = []  # folders that could not be listed: nothing below them was seen
    tick = tick or _Tick(None)
    midi = midi if midi is not None else []

    def aus(grund: str) -> None:
        ausgelassen[grund] = ausgelassen.get(grund, 0) + 1
        if zaehler is not None:
            zaehler["skipped"] = zaehler.get("skipped", 0) + 1

    def verarbeite(item: Datei | Auslassung, w) -> None:
        if isinstance(item, Auslassung):
            aus(item.grund)
            if item.grund == "unlesbar" and os.path.isdir(item.pfad):
                luecken.append(item.pfad)
            return
        m = merkmale(item, cache)
        if isinstance(m, Auslassung):
            aus(m.grund)
            return
        bpm = felder(item, "oneshot", m)["bpm"]  # BPM for the type rule: tag first, then the names
        typ = bestimme(item.rel, m.dauer_s, bpm, w.typ)  # type: ignore[arg-type]
        z = felder(item, typ, m)
        if zaehler is not None:
            zaehler[typ] = zaehler.get(typ, 0) + 1
        alt = zeilen.get(m.sha)
        if alt is None or str(z["pfad"]) < str(alt["pfad"]):
            zeilen[m.sha] = z

    # pass 1: list (also yields the MIDI files as a side output, no second walk)
    gefunden: list[tuple[Datei | Auslassung, object]] = []
    for w in konfig.wurzeln:
        try:
            for item in scanne(w, auch_midi=True):
                if isinstance(item, MidiDatei):
                    midi.append(item)
                    continue
                gefunden.append((item, w))
                tick("scan", len(gefunden), None)
        except FileNotFoundError:
            if not Path(w.pfad).is_dir():
                if ohne_fehlende:
                    fehlende.append(str(w.pfad))
                    continue
                raise WurzelFehlt(str(w.pfad)) from None
            raise
    gesamt = len(gefunden)
    tick("scan", gesamt, None, letzter=True)
    # pass 2: features
    n = 0
    for item, w in gefunden:
        verarbeite(item, w)
        n += 1  # counted and reported after the file is processed, so the counts add up to n
        if n % FORTSCHRITT_ALLE == 0:
            fortschritt(n)
        tick("merkmale", n, gesamt)
    tick("merkmale", n, gesamt, letzter=True)
    return zeilen, ausgelassen, fehlende, luecken


def _schreibe(teil: Path, konfig: Konfig, zeilen: dict[str, dict[str, object]], ergebnis: Ergebnis) -> None:
    db = sqlite3.connect(str(teil))
    try:
        db.execute("PRAGMA journal_mode=DELETE")
        db.executescript(DDL)
        ins = f"INSERT INTO katalog({','.join(SPALTEN)}) VALUES ({','.join('?' * len(SPALTEN))})"
        for z in sorted(zeilen.values(), key=lambda r: str(r["pfad"])):
            db.execute(ins, [z.get(s) for s in SPALTEN])
        db.execute("INSERT INTO katalog_fts(katalog_fts) VALUES('rebuild')")
        stand = {
            "schema": "1",
            "host": socket.gethostname(),
            "gebaut_am": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "quelle_mtime": "0",
            "erbauer": ERBAUER,
            "baum_marke": ergebnis.marke,
            "wurzeln": json.dumps([{"pfad": str(w.pfad), "typ": w.typ} for w in konfig.wurzeln], ensure_ascii=False),
            "zaehlung": json.dumps({"zeilen": ergebnis.zeilen, "ausgelassen": ergebnis.ausgelassen}),
        }
        db.executemany("INSERT INTO stand VALUES (?, ?)", list(stand.items()))
        db.commit()
    finally:
        db.close()
    fd = os.open(teil, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def baue(ziel: Path, konfig: Konfig, cache: MerkmalCache, ohne_fehlende: bool,
         fortschritt: Callable[[int], None],
         _zwischen_pruefungen: Callable[[], None] = lambda: None,
         zaehler: dict[str, int] | None = None, leer_erlaubt: bool = False,
         tick: Callable[[str, int, int | None], None] | None = None, midi_ziel: Path | None = None) -> Ergebnis:
    """Build the catalog as a new file and swap it in. Raises FremderKatalog or WurzelFehlt; the target stays as it was.

    `_zwischen_pruefungen` is a test seam: called after the build and right before the second check.
    `zaehler`, when given, is filled while scanning (keys track, loop, oneshot, skipped) so a progress callback can read it.
    Raises LeererBau when the scan finds nothing and the own catalog at the target has rows, unless `leer_erlaubt`;
    LueckenBau (a LeererBau) when a folder could not be listed and the scan found fewer rows than the own catalog has.
    Raises ZielNichtSchreibbar when the file system cannot take the finished catalog (e.g. no hard links on exFAT).
    `tick(phase, fertig, gesamt)`: phases scan (gesamt None), merkmale, schreiben (once); throttled to 4 calls a second.
    `midi_ziel`: the MIDI list is written there after the swap, also when the build raises LeererBau/LueckenBau, never for
    a foreign catalog.
    """
    ziel = kanonisch(Path(ziel))  # once; every later look at or write to the target uses this very path
    eigen0, st0 = eigener_katalog(ziel)
    if eigen0 is False:
        raise FremderKatalog(ziel)  # before any work: nothing is written next to a foreign catalog
    ordner = ziel.parent
    ordner.mkdir(parents=True, exist_ok=True)
    _alte_teile_raeumen(ordner)
    teil = ordner / f".katalog.sqlite.{os.getpid()}.teil"
    _entferne(teil)
    gehasht0 = cache.gehasht
    t = _Tick(tick)
    marke = baum_marke(konfig)  # before the scan: a change during the build is caught by the next start check
    midi: list[MidiDatei] = []
    try:
        zeilen, ausgelassen, fehlende, luecken = _sammle(konfig, cache, ohne_fehlende, fortschritt, zaehler, t, midi)
        if not zeilen and eigen0 is True and not leer_erlaubt:
            alt = _zeilenzahl(ziel)
            if alt > 0:
                if midi_ziel is not None:
                    schreibe_midi_liste(midi_ziel, midi)
                raise LeererBau(ziel, alt)
        if luecken and eigen0 is True and not leer_erlaubt:
            alt = _zeilenzahl(ziel)
            if len(zeilen) < alt:
                if midi_ziel is not None:
                    schreibe_midi_liste(midi_ziel, midi)
                raise LueckenBau(ziel, alt, len(zeilen))
        zaehlung = {t: 0 for t in TYPEN}
        for z in zeilen.values():
            zaehlung[str(z["typ"])] += 1
        ergebnis = Ergebnis(ziel, zaehlung, ausgelassen, cache.gehasht - gehasht0, fehlende, marke)
        t("schreiben", 0, 1, letzter=True)
        _schreibe(teil, konfig, zeilen, ergebnis)
        _zwischen_pruefungen()
        if eigen0 is None:
            # absent: hard link fails with FileExistsError when anything (file, directory, link) appeared meanwhile
            try:
                os.link(teil, ziel)
            except FileExistsError:
                raise FremderKatalog(ziel) from None
            except OSError as e:
                raise ZielNichtSchreibbar(ziel, e) from e
            os.unlink(teil)
        else:
            eigen1, st1 = eigener_katalog(ziel)
            if (eigen1 is not True or st0 is None or st1 is None
                    or st1.st_ino != st0.st_ino or st1.st_mtime_ns != st0.st_mtime_ns):
                raise FremderKatalog(ziel)
            os.replace(teil, ziel)
    except BaseException:
        _entferne(teil)
        raise
    if midi_ziel is not None:
        schreibe_midi_liste(midi_ziel, midi)
    return ergebnis
