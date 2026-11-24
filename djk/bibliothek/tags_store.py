"""Access to the tag store (tags.sqlite): open or create, chunked writes of measured rows, inheritance, orphan handling.

The schema (tags_schema.sql) and the inheritance (tags_erbe.sql) are read by the page server as well; this module is the
Python half. The store is not the catalogue and not a graph database.
"""
from __future__ import annotations

import contextlib
import os
import re
import sqlite3
import time
from pathlib import Path

_HIER = Path(__file__).resolve().parent
SCHEMA = _HIER / "tags_schema.sql"
ERBE = _HIER / "tags_erbe.sql"
CHUNK = 500  # write transactions of at most this many rows


class StoreUnbrauchbar(Exception):
    """The store file is damaged and could not be moved aside."""


def _jetzt() -> float:
    return time.time()


def _beiseite(pfad: Path) -> None:
    """Rename a damaged store (and its WAL files) to <name>.defekt-<epoch>."""
    ziel = pfad.with_name(f"{pfad.name}.defekt-{int(time.time())}")
    n = 0
    while ziel.exists():
        n += 1
        ziel = pfad.with_name(f"{pfad.name}.defekt-{int(time.time())}-{n}")
    try:
        os.replace(pfad, ziel)
    except OSError as e:
        raise StoreUnbrauchbar(f"cannot move the damaged store {pfad}: {e}") from e
    for suffix in ("-wal", "-shm"):
        with contextlib.suppress(OSError):
            os.remove(str(pfad) + suffix)


def _schema(con: sqlite3.Connection) -> None:
    """Create or upgrade the schema once: only when user_version is below the file's number, in one write transaction.

    A current store runs no statement of the schema file and takes no write lock, so opening never blocks a writer and a reader
    never sees the view missing.
    """
    text = SCHEMA.read_text(encoding="utf-8")
    soll = int(re.search(r"^-- schema-version:\s*(\d+)", text, re.M).group(1))
    if con.execute("PRAGMA user_version").fetchone()[0] >= soll:
        return
    con.execute("BEGIN IMMEDIATE")
    try:
        if con.execute("PRAGMA user_version").fetchone()[0] < soll:   # another opener may have been first
            for stmt in _anweisungen(text):
                con.execute(stmt)
            con.execute(f"PRAGMA user_version = {soll}")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    con.execute("COMMIT")


def _verbinde(pfad: Path, busy_ms: int) -> sqlite3.Connection:
    con = sqlite3.connect(pfad, timeout=busy_ms / 1000, isolation_level=None)
    try:
        con.row_factory = sqlite3.Row
        con.execute(f"PRAGMA busy_timeout={int(busy_ms)}")
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=NORMAL")
        _schema(con)
        return con
    except BaseException:
        con.close()
        raise


def oeffne(pfad: Path, *, busy_ms: int = 30000) -> sqlite3.Connection:
    """Open (creating the folder and the schema) the store at `pfad`; autocommit, WAL, row factory.

    A damaged file is renamed to `<name>.defekt-<epoch>` and an empty store takes its place. A locked file is a plain
    OperationalError after `busy_ms`, never a reason to rename.
    """
    pfad = Path(pfad)
    pfad.parent.mkdir(parents=True, exist_ok=True)
    try:
        return _verbinde(pfad, busy_ms)
    except sqlite3.DatabaseError as e:
        msg = str(e).lower()
        if "locked" in msg or "busy" in msg:
            raise
        if not pfad.exists():
            raise
    _beiseite(pfad)
    return _verbinde(pfad, busy_ms)


@contextlib.contextmanager
def schreiben(con: sqlite3.Connection):
    """One write transaction; joins an open one (then the outer caller commits)."""
    if con.in_transaction:
        yield con
        return
    con.execute("BEGIN IMMEDIATE")
    try:
        yield con
    except BaseException:
        con.execute("ROLLBACK")
        raise
    con.execute("COMMIT")


def schreibe_gemessen(con: sqlite3.Connection, item_id: str, art: str, name: str, kopf: str,
                      tags: list[tuple[str, float | None]], *, katalog: bool = False) -> None:
    """Replace the measured rows (herkunft gemessen, quelle messen) of one item; manual and derived rows stay.

    `katalog=True` marks the item as taken from the catalogue (never reset to 0 here).
    """
    jetzt = _jetzt()
    with schreiben(con):
        con.execute(
            "INSERT INTO item(id, art, name, kopf, katalog, weg, geaendert) VALUES (?, ?, ?, ?, ?, 0, ?) "
            "ON CONFLICT(id) DO UPDATE SET art = excluded.art, name = excluded.name, kopf = excluded.kopf, "
            "katalog = MAX(katalog, excluded.katalog), weg = 0, geaendert = excluded.geaendert",
            (item_id, art, name, kopf, 1 if katalog else 0, jetzt))
        con.execute("DELETE FROM item_tag WHERE item = ? AND herkunft = 'gemessen' AND quelle = 'messen'", (item_id,))
        con.executemany(
            "INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) VALUES (?, ?, 'gemessen', 'messen', 1, ?, ?)",
            [(item_id, t, w, jetzt) for t, w in tags])


def erbe(con: sqlite3.Connection, items=None, *, chunk: int = CHUNK) -> int:
    """Recompute the derived rows (tags_erbe.sql); returns the number of rows written.

    `items` = the ids whose sources changed (their descendants follow, 3 hops); None = the whole store. The computation reads
    only; the changes are written in transactions of at most `chunk` rows, deletions first, and only where the result differs
    from what is stored, so a second run writes nothing.
    """
    sql = ERBE.read_text(encoding="utf-8")
    con.execute("CREATE TEMP TABLE IF NOT EXISTS erbe_ziel(item TEXT PRIMARY KEY)")
    con.execute("DELETE FROM erbe_ziel")
    if items is None:
        con.execute("INSERT OR IGNORE INTO erbe_ziel SELECT von FROM relation WHERE art = 'made_from' "
                    "UNION SELECT item FROM item_tag WHERE herkunft = 'abgeleitet' AND quelle = 'erbe'")
    else:
        con.executemany("INSERT OR IGNORE INTO erbe_ziel(item) VALUES (?)", [(i,) for i in items])
    for stmt in _anweisungen(sql):
        con.execute(stmt)
    geschrieben = 0
    jetzt = _jetzt()
    for tabelle, schreibe in (
            ("erbe_weg", "DELETE FROM item_tag WHERE item = ? AND tag = ? AND herkunft = 'abgeleitet' AND quelle = 'erbe'"),
            ("erbe_dazu", "INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) "
                          f"VALUES (?, ?, 'abgeleitet', 'erbe', 1, ?, {jetzt!r})")):
        while True:
            zeilen = con.execute(f"SELECT rowid, * FROM temp.{tabelle} ORDER BY rowid LIMIT ?", (chunk,)).fetchall()
            if not zeilen:
                break
            with schreiben(con):
                con.executemany(schreibe, [tuple(z)[1:] for z in zeilen])
            con.execute(f"DELETE FROM temp.{tabelle} WHERE rowid <= ?", (zeilen[-1][0],))
            geschrieben += len(zeilen)
    con.execute("DROP TABLE IF EXISTS temp.erbe_ziel")
    return geschrieben


def _anweisungen(sql: str) -> list[str]:
    """Split a script into statements (our two SQL files hold no semicolon inside a string or comment text)."""
    ohne = "\n".join(z for z in sql.splitlines() if not z.strip().startswith("--"))
    return [t.strip() for t in ohne.split(";") if t.strip()]


def raeume_verwaiste(con: sqlite3.Connection, vorhandene: set[str]) -> int:
    """Handle catalogue items (katalog = 1) that left the catalogue. Returns the number deleted.

    Those without a manual tag row and without a relation are deleted with their rows; the others get weg = 1 (and weg = 0
    again when they reappear). Items with katalog = 0 are never touched.
    """
    geloescht = 0
    with schreiben(con):
        zeilen = con.execute("SELECT id, weg FROM item WHERE katalog = 1").fetchall()
        for z in zeilen:
            i = z["id"]
            if i in vorhandene:
                if z["weg"]:
                    con.execute("UPDATE item SET weg = 0 WHERE id = ?", (i,))
                continue
            haelt = con.execute(
                "SELECT 1 FROM item_tag WHERE item = ? AND herkunft IN ('nutzer', 'agent') LIMIT 1", (i,)).fetchone() \
                or con.execute("SELECT 1 FROM relation WHERE von = ? OR nach = ? LIMIT 1", (i, i)).fetchone()
            if haelt:
                if not z["weg"]:
                    con.execute("UPDATE item SET weg = 1 WHERE id = ?", (i,))
            else:
                con.execute("DELETE FROM item_tag WHERE item = ?", (i,))
                con.execute("DELETE FROM item WHERE id = ?", (i,))
                geloescht += 1
    return geloescht
