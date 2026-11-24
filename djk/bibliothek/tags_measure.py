"""The measuring hook: `python -m bibliothek.tags_measure --katalog PATH --tags PATH`.

Pass A turns the catalogue columns (tempo, key, energy, instrument class, genre) into measured tags in the tag store. It is
incremental (an unchanged `kopf` skips the item), idempotent and never touches manual or derived rows. Exit codes: 0 done (or
a run already holds the lock), 3 catalogue missing or not ours (nothing written), 4 store unusable.

The module imports no scipy; later passes import their numeric code lazily.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Callable

from . import tags_store as speicher
from .catalog_build import eigener_katalog, kanonisch
from .config import katalog_ziel
from .features import INSTRUMENTE

SEITE = 2000      # catalogue rows per read
CHUNK = 500       # items per write transaction
CAMELOT = re.compile(r"^(1[0-2]|[1-9])[AB]$")
KLASSEN = frozenset(INSTRUMENTE.values())
_VOKABULAR = Path(__file__).resolve().parent.parent / "ui" / "presets" / "vokabular.json"
# columns read by the rules; the fingerprint `kopf` covers exactly these
_LIES = ("typ", "titel", "name", "bpm", "camelot", "energie", "instrument", "genre")


def genre_woerter() -> frozenset[str]:
    """The preset genre list (read only; the file is checksum-guarded and never edited here)."""
    try:
        return frozenset(json.loads(_VOKABULAR.read_text(encoding="utf-8"))["inhalt"]["genre"])
    except (OSError, KeyError, ValueError):
        return frozenset()


def _zahl(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def tags_aus_zeile(z: sqlite3.Row | dict, genres: frozenset[str]) -> list[tuple[str, float | None]]:
    """The measured tags of Pass A for one catalogue row, one rule each."""
    tags: list[tuple[str, float | None]] = []
    bpm = _zahl(z["bpm"])
    if bpm is not None and 40 <= bpm <= 220:
        tags.append((f"tempo:{round(bpm)}", bpm))
    cam = z["camelot"]
    if isinstance(cam, str) and CAMELOT.match(cam):
        tags.append((f"tonart:{cam}", None))
    en = _zahl(z["energie"])
    if en is not None:
        tags.append((f"energie:{min(5, max(1, math.ceil(en / 2)))}", en))
    inst = z["instrument"]
    if isinstance(inst, str) and inst in KLASSEN:
        tags.append((f"typ:{inst}", None))
    g = z["genre"]
    if isinstance(g, str):
        w = g.strip().lower().replace(" ", "_")
        if w in genres:
            tags.append((f"genre:{w}", None))
    return tags


def kopf_von(z) -> str:
    teile = [f"{k}={z[k]!r}" for k in sorted(_LIES)]
    return hashlib.sha1("\x1f".join(teile).encode("utf-8")).hexdigest()


def messe_a(kat: sqlite3.Connection, store: sqlite3.Connection, fortschritt: Callable[[int, int], None]) -> set[str]:
    """Pass A. Returns the item ids present in the catalogue (the same sha in several rows is one item)."""
    kat.row_factory = sqlite3.Row
    gesamt = kat.execute("SELECT count(*) FROM katalog").fetchone()[0]
    genres = genre_woerter()
    vorhanden: set[str] = set()
    bekannt = {r["id"]: r["kopf"] for r in store.execute("SELECT id, kopf FROM item")}
    letzte_id, gelesen, offen = 0, 0, 0
    spalten = ", ".join(("id", "sha") + _LIES)
    while True:
        seite = kat.execute(f"SELECT {spalten} FROM katalog WHERE id > ? ORDER BY id LIMIT {SEITE}", (letzte_id,)).fetchall()
        if not seite:
            break
        letzte_id = seite[-1]["id"]
        for z in seite:
            gelesen += 1
            iid = f"datei:{z['sha']}"
            if iid in vorhanden:
                continue
            vorhanden.add(iid)
            kopf = kopf_von(z)
            if bekannt.get(iid) == kopf:
                continue
            if not offen:
                store.execute("BEGIN IMMEDIATE")
            speicher.schreibe_gemessen(store, iid, z["typ"], z["titel"] or z["name"] or "", kopf,
                                       tags_aus_zeile(z, genres), katalog=True)
            bekannt[iid] = kopf
            offen += 1
            if offen >= CHUNK:
                store.execute("COMMIT")
                offen = 0
        fortschritt(gelesen, gesamt)
    if offen:
        store.execute("COMMIT")
    fortschritt(gelesen, gesamt)
    return vorhanden


# ---------------------------------------------------------------- pass B

def messe_b(kat: sqlite3.Connection, store: sqlite3.Connection, max_dateien: int, max_minuten: float,
            fortschritt: Callable[[int, int], None]) -> int:
    """Pass B: spectral features, character words and a fallback class for loops, one-shots and tracks (never midi).

    Loops and one-shots come before tracks, in path order. At most `max_dateien` files are read and at most `max_minuten` minutes
    are spent; what is left over is counted in the returned number (stand `messen_offen`) and taken by the next run. Features are
    cached by sha (`merkmal`, version `MERKMAL_VERSION`); a file that cannot be read goes to `merkmal_fehl` keyed by path, size
    and mtime. The words are rows of herkunft gemessen with their own quelle `spektrum`, so Pass A never replaces them.
    """
    import json as _json

    from . import tags_features as tm   # numpy only when Pass B runs

    kat.row_factory = sqlite3.Row
    version = tm.MERKMAL_VERSION
    aktuell = {r[0] for r in store.execute("SELECT sha FROM merkmal WHERE v = ?", (version,))}
    frist = time.monotonic() + max_minuten * 60
    gesamt = kat.execute("SELECT count(*) FROM katalog WHERE typ IN ('loop', 'oneshot', 'track')").fetchone()[0]
    zeilen = kat.execute("SELECT sha, pfad, typ, instrument FROM katalog WHERE typ IN ('loop', 'oneshot', 'track') AND pfad != '' "
                         "ORDER BY CASE typ WHEN 'track' THEN 1 ELSE 0 END, pfad, id")
    gesehen: set[str] = set()
    gelesen = fertig = offen = 0
    for z in zeilen:
        sha = z["sha"]
        if sha in gesehen:
            continue
        gesehen.add(sha)
        fertig += 1
        if sha in aktuell:
            continue
        if gelesen >= max_dateien or time.monotonic() >= frist:
            offen += 1
            continue
        try:
            st = os.stat(z["pfad"])
        except OSError:
            continue                                        # vanished since the catalogue was built: nothing to measure
        if store.execute("SELECT 1 FROM merkmal_fehl WHERE pfad = ? AND groesse = ? AND mtime_ns = ?",
                         (z["pfad"], st.st_size, st.st_mtime_ns)).fetchone():
            continue
        gelesen += 1
        m = tm.merkmale_von(Path(z["pfad"]))
        jetzt = time.time()
        iid = f"datei:{sha}"
        with speicher.schreiben(store):
            store.execute("DELETE FROM merkmal_fehl WHERE pfad = ?", (z["pfad"],))
            if m is None:
                store.execute("INSERT OR REPLACE INTO merkmal_fehl(pfad, groesse, mtime_ns, zeit) VALUES (?, ?, ?, ?)",
                              (z["pfad"], st.st_size, st.st_mtime_ns, jetzt))
            else:
                store.execute("INSERT OR REPLACE INTO merkmal(sha, v, daten, zeit) VALUES (?, ?, ?, ?)",
                              (sha, version, _json.dumps(m), jetzt))
                store.execute("DELETE FROM item_tag WHERE item = ? AND herkunft = 'gemessen' AND quelle = 'spektrum'", (iid,))
                worte = [f"charakter:{w}" for w in tm.charakter_aus(m)]
                if z["instrument"] not in KLASSEN:
                    klasse = tm.klasse_aus(m, z["typ"])
                    if klasse:
                        worte.append(f"typ:{klasse}")
                store.executemany("INSERT INTO item_tag(item, tag, herkunft, quelle, an, wert, zeit) "
                                  "VALUES (?, ?, 'gemessen', 'spektrum', 1, NULL, ?)", [(iid, w, jetzt) for w in worte])
        fortschritt(fertig, gesamt)
    # a class from the spectrum gives way to one the catalogue has since learnt
    with speicher.schreiben(store):
        store.execute("DELETE FROM item_tag WHERE quelle = 'spektrum' AND tag LIKE 'typ:%' AND item IN "
                      "(SELECT item FROM item_tag WHERE quelle = 'messen' AND tag LIKE 'typ:%')")
        store.execute("INSERT OR REPLACE INTO stand(schluessel, wert) VALUES ('messen_offen', ?)", (str(offen),))
    fortschritt(fertig, gesamt)
    return offen


# ---------------------------------------------------------------- hook

def _lebt(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _sperre_nehmen(pfad: Path) -> bool:
    """Create the lock file (pid inside). False when a live process holds it; a stale one is taken over."""
    for _ in range(3):
        try:
            fd = os.open(pfad, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                pid = int(pfad.read_text().strip() or 0)
            except (OSError, ValueError):
                pid = 0
            if pid and _lebt(pid):
                return False
            try:
                pfad.unlink()
            except FileNotFoundError:
                pass
            continue
        with os.fdopen(fd, "w") as f:
            f.write(str(os.getpid()))
        return True
    return False


def _melde(store: sqlite3.Connection | None, phase: str, fertig: int, gesamt: int, **extra) -> None:
    print(json.dumps({"phase": phase, "fertig": fertig, "gesamt": gesamt, **extra}), flush=True)
    if store is not None:
        with speicher.schreiben(store):
            store.executemany("INSERT OR REPLACE INTO stand(schluessel, wert) VALUES (?, ?)", [
                ("messen_phase", phase), ("messen_fertig", str(fertig)), ("messen_gesamt", str(gesamt)),
                ("messen_zeit", str(time.time()))])


def haupt(argv: list[str] | None = None) -> int:
    os.nice(19)
    ap = argparse.ArgumentParser(prog="bibliothek.tags_measure")
    ap.add_argument("--katalog", type=Path, default=None)
    ap.add_argument("--tags", type=Path, default=None)
    ap.add_argument("--ohne-spektrum", action="store_true", help="skip Pass B")
    ap.add_argument("--max-dateien", type=int, default=5000, help="Pass B: files read per run")
    ap.add_argument("--max-minuten", type=float, default=20.0, help="Pass B: minutes per run")
    a = ap.parse_args(argv)
    katalog = kanonisch(a.katalog if a.katalog else katalog_ziel(os.environ))
    tags = a.tags if a.tags else katalog.parent / "tags.sqlite"

    eigener, _ = eigener_katalog(katalog)
    if eigener is not True:
        print(json.dumps({"phase": "fertig", "fehler": "katalog"}), flush=True)
        return 3
    try:
        kat = sqlite3.connect(katalog.as_uri() + "?mode=ro", uri=True, timeout=30)
        kat.execute("SELECT count(*) FROM katalog").fetchone()   # fail here, before a store file exists
    except sqlite3.Error:
        print(json.dumps({"phase": "fertig", "fehler": "katalog"}), flush=True)
        return 3
    tags.parent.mkdir(parents=True, exist_ok=True)
    sperre = tags.with_name(tags.name + ".lauf")
    if not _sperre_nehmen(sperre):
        kat.close()
        print(json.dumps({"phase": "fertig", "bereits": True}), flush=True)
        return 0
    store = None
    try:
        try:
            store = speicher.oeffne(tags)
        except (speicher.StoreUnbrauchbar, sqlite3.DatabaseError) as e:
            kat.close()
            print(json.dumps({"phase": "fertig", "fehler": "store", "text": str(e)}), flush=True)
            return 4
        try:
            last = [0.0]

            def melder(phase: str) -> Callable[[int, int], None]:
                def fortschritt(fertig: int, gesamt: int) -> None:
                    if time.monotonic() - last[0] > 1.0 or fertig >= gesamt:
                        last[0] = time.monotonic()
                        _melde(store, phase, fertig, gesamt)
                return fortschritt

            vorhanden = messe_a(kat, store, melder("a"))
            speicher.raeume_verwaiste(store, vorhanden)
            if not a.ohne_spektrum:
                messe_b(kat, store, a.max_dateien, a.max_minuten, melder("b"))
                from . import tags_nachbarn   # scipy only when the neighbours are built
                _melde(store, "nachbarn", 0, 0)
                tags_nachbarn.baue_aehnliche(store)
        except sqlite3.DatabaseError as e:
            print(json.dumps({"phase": "fertig", "fehler": "katalog", "text": str(e)}), flush=True)
            return 3
        finally:
            kat.close()
        speicher.erbe(store)
        n = len(vorhanden)
        _melde(store, "fertig", n, n)
        return 0
    finally:
        if store is not None:
            store.close()
        try:
            sperre.unlink()
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    sys.exit(haupt())
