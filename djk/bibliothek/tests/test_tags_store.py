"""Tag store: schema, effective view, measured writes, inheritance, orphans, damaged and contended files."""
from __future__ import annotations

import sqlite3
import threading

import pytest

from bibliothek import tags_store as ts


@pytest.fixture
def con(tmp_path):
    c = ts.oeffne(tmp_path / "tags.sqlite")
    yield c
    c.close()


def tag(con, item, t, herkunft, *, an=1, zeit=1.0, quelle=None):
    if quelle is None:
        quelle = {"gemessen": "messen", "abgeleitet": "erbe"}.get(herkunft, "")
    con.execute("INSERT OR IGNORE INTO item(id, art) VALUES (?, 'loop')", (item,))
    con.execute("INSERT OR REPLACE INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?,?,?,?,?,?)",
                (item, t, herkunft, quelle, an, zeit))


def rel(con, von, art, nach):
    con.execute("INSERT OR IGNORE INTO relation(von, art, nach, herkunft, zeit) VALUES (?,?,?, 'melde', 1)", (von, art, nach))


def wirksam(con, item):
    return sorted((r["tag"], r["herkunft"]) for r in con.execute("SELECT tag, herkunft FROM wirksam WHERE item = ?", (item,)))


def test_schema_applies_twice(tmp_path):
    p = tmp_path / "t" / "tags.sqlite"
    ts.oeffne(p).close()
    c = ts.oeffne(p)
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master")}
    for n in ("item", "item_tag", "relation", "merkmal", "merkmal_fehl", "gespeichert", "stand", "wirksam", "it_tag", "rel_nach"):
        assert n in names
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_wirksam_measured_alone(con):
    tag(con, "a", "tempo:128", "gemessen")
    assert wirksam(con, "a") == [("tempo:128", "gemessen")]


def test_manual_single_valued_hides_measured(con):
    tag(con, "a", "tempo:128", "gemessen")
    tag(con, "a", "tempo:140", "nutzer", zeit=2)
    assert wirksam(con, "a") == [("tempo:140", "nutzer")]


def test_manual_removal_leaves_no_tempo(con):
    tag(con, "a", "tempo:128", "gemessen")
    tag(con, "a", "tempo:128", "nutzer", an=0, zeit=2)
    assert wirksam(con, "a") == []


def test_two_manual_single_valued_newer_wins(con):
    tag(con, "a", "tempo:140", "nutzer", zeit=2)
    tag(con, "a", "tempo:150", "agent", zeit=3)
    assert wirksam(con, "a") == [("tempo:150", "agent")]


def test_two_origins_show_once_as_gemessen(con):
    tag(con, "a", "genre:techno", "gemessen")
    tag(con, "a", "genre:techno", "abgeleitet")
    assert wirksam(con, "a") == [("genre:techno", "gemessen")]


def test_multi_valued_art_keeps_all(con):
    tag(con, "a", "charakter:dark", "gemessen")
    tag(con, "a", "charakter:warm", "abgeleitet")
    assert len(wirksam(con, "a")) == 2


def test_schreibe_gemessen_replaces_only_own_rows(con):
    tag(con, "a", "tempo:140", "nutzer", zeit=2)
    ts.schreibe_gemessen(con, "a", "loop", "A", "k1", [("typ:kick", None), ("tempo:128", 128.0)])
    ts.schreibe_gemessen(con, "a", "loop", "A", "k2", [("typ:snare", None)])
    rows = sorted(r[0] for r in con.execute("SELECT tag FROM item_tag WHERE item='a' AND herkunft='gemessen'"))
    assert rows == ["typ:snare"]
    assert con.execute("SELECT count(*) FROM item_tag WHERE item='a' AND herkunft='nutzer'").fetchone()[0] == 1
    assert con.execute("SELECT kopf FROM item WHERE id='a'").fetchone()[0] == "k2"


def test_erbe_loop_inherits_genre(con):
    tag(con, "datei:a", "genre:techno", "gemessen")
    rel(con, "datei:b", "made_from", "datei:a")
    ts.erbe(con)
    assert wirksam(con, "datei:b") == [("genre:techno", "abgeleitet")]


def test_erbe_own_genre_blocks(con):
    tag(con, "datei:a", "genre:techno", "gemessen")
    tag(con, "datei:b", "genre:house", "gemessen")
    rel(con, "datei:b", "made_from", "datei:a")
    ts.erbe(con)
    assert wirksam(con, "datei:b") == [("genre:house", "gemessen")]


def test_erbe_manual_removal_survives(con):
    tag(con, "datei:a", "genre:techno", "gemessen")
    rel(con, "datei:b", "made_from", "datei:a")
    tag(con, "datei:b", "genre:techno", "nutzer", an=0, zeit=5)
    ts.erbe(con)
    ts.erbe(con)
    assert wirksam(con, "datei:b") == []


def test_erbe_kit_takes_union_of_typ(con):
    tag(con, "datei:s1", "typ:kick", "gemessen")
    tag(con, "datei:s2", "typ:snare", "gemessen")
    rel(con, "kit:k", "made_from", "datei:s1")
    rel(con, "kit:k", "made_from", "datei:s2")
    ts.erbe(con)
    assert wirksam(con, "kit:k") == [("typ:kick", "abgeleitet"), ("typ:snare", "abgeleitet")]


def test_erbe_cycle_terminates(con):
    tag(con, "a", "genre:techno", "gemessen")
    rel(con, "b", "made_from", "a")
    rel(con, "a", "made_from", "b")
    ts.erbe(con)
    assert wirksam(con, "b") == [("genre:techno", "abgeleitet")]
    assert wirksam(con, "a") == [("genre:techno", "gemessen")]


def test_erbe_chain_stops_at_three_hops(con):
    tag(con, "n0", "genre:techno", "gemessen")
    for i in range(1, 6):
        rel(con, f"n{i}", "made_from", f"n{i-1}")
    ts.erbe(con)
    have = [i for i in range(6) if wirksam(con, f"n{i}")]
    assert have == [0, 1, 2, 3]


def test_erbe_leaves_other_producers_alone(con):
    tag(con, "p", "charakter:dark", "abgeleitet", quelle="preset")
    ts.erbe(con)
    ts.schreibe_gemessen(con, "p", "preset", "P", "k", [("typ:bass", None)])
    assert ("charakter:dark", "abgeleitet") in wirksam(con, "p")


def test_erbe_removes_row_whose_source_vanished(con):
    tag(con, "datei:a", "genre:techno", "gemessen")
    rel(con, "datei:b", "made_from", "datei:a")
    ts.erbe(con)
    con.execute("DELETE FROM relation")
    ts.erbe(con)
    assert wirksam(con, "datei:b") == []


def test_raeume_verwaiste(con):
    for i in ("gone", "kept", "stem", "clip"):
        con.execute("INSERT INTO item(id, art, katalog) VALUES (?, 'loop', ?)", (i, 1 if i in ("gone", "kept") else 0))
    tag(con, "gone", "typ:kick", "gemessen")
    tag(con, "kept", "typ:kick", "nutzer")
    rel(con, "stem", "made_from", "gone2")
    rel(con, "clip", "used_in", "projekt:x")
    assert ts.raeume_verwaiste(con, set()) == 1
    ids = {r["id"]: r["weg"] for r in con.execute("SELECT id, weg FROM item")}
    assert "gone" not in ids
    assert ids["kept"] == 1 and ids["stem"] == 0 and ids["clip"] == 0
    assert con.execute("SELECT count(*) FROM item_tag WHERE item='gone'").fetchone()[0] == 0
    ts.raeume_verwaiste(con, {"kept"})
    assert con.execute("SELECT weg FROM item WHERE id='kept'").fetchone()[0] == 0


def test_damaged_file_is_renamed_and_replaced(tmp_path):
    p = tmp_path / "tags.sqlite"
    p.write_bytes(bytes(range(100)))
    c = ts.oeffne(p)
    assert c.execute("SELECT count(*) FROM item").fetchone()[0] == 0
    assert len(list(tmp_path.glob("tags.sqlite.defekt-*"))) == 1
    c.close()


def test_two_connections_write_in_chunks_without_lock_error(tmp_path):
    p = tmp_path / "tags.sqlite"
    a, b = ts.oeffne(p, busy_ms=5000), ts.oeffne(p, busy_ms=5000)
    for rnd in range(4):
        for c, pre in ((a, "a"), (b, "b")):
            with ts.schreiben(c):
                c.executemany("INSERT INTO item(id, art) VALUES (?, 'loop')", [(f"{pre}{rnd}-{i}", ) for i in range(100)])
    assert a.execute("SELECT count(*) FROM item").fetchone()[0] == 800
    a.close(); b.close()


def test_locked_file_is_not_renamed(tmp_path):
    p = tmp_path / "tags.sqlite"
    a = ts.oeffne(p)
    a.execute("PRAGMA user_version = 0")          # a store that still needs its schema must wait for the lock
    a.execute("BEGIN EXCLUSIVE")
    with pytest.raises(sqlite3.OperationalError):
        ts.oeffne(p, busy_ms=100).close()
    a.execute("ROLLBACK")
    assert not list(tmp_path.glob("*.defekt-*"))
    a.close()


def test_open_of_current_store_takes_no_write_lock_and_keeps_the_view(tmp_path):
    p = tmp_path / "tags.sqlite"
    a = ts.oeffne(p)
    assert a.execute("PRAGMA user_version").fetchone()[0] >= 1
    tag(a, "x", "typ:kick", "gemessen")
    a.execute("BEGIN IMMEDIATE")                   # a writer is in the middle of its transaction
    statements = []
    b = ts.oeffne(p, busy_ms=100)                  # must neither wait nor raise nor touch the view
    b.set_trace_callback(statements.append)
    assert [r[0] for r in b.execute("SELECT tag FROM wirksam WHERE item = 'x'")] == ["typ:kick"]
    a.execute("ROLLBACK")
    assert not [t for t in statements if "DROP" in t.upper() or "CREATE" in t.upper()]
    a.close(); b.close()


def test_open_creates_schema_once_and_sets_version(tmp_path):
    p = tmp_path / "tags.sqlite"
    ts.oeffne(p).close()
    c = ts.oeffne(p)
    c.execute("DROP VIEW wirksam")                 # a current store is not repaired by an open: the version says it is done
    c.close()
    c = ts.oeffne(p)
    assert not c.execute("SELECT 1 FROM sqlite_master WHERE name = 'wirksam'").fetchall()
    c.execute("PRAGMA user_version = 0")
    c.close()
    c = ts.oeffne(p)
    assert c.execute("SELECT 1 FROM sqlite_master WHERE name = 'wirksam'").fetchall()
    c.close()


def test_reader_in_another_connection_keeps_answering_while_erbe_writes(tmp_path):
    p = tmp_path / "tags.sqlite"
    w = ts.oeffne(p)
    with ts.schreiben(w):
        for i in range(1200):
            tag(w, f"src{i}", "genre:techno", "gemessen")
            rel(w, f"dst{i}", "made_from", f"src{i}")
    fehler, antworten, fertig = [], [0], threading.Event()

    w.close()

    def schreiber():
        try:
            ts.erbe(ts.oeffne(p), chunk=100)
        except BaseException as e:   # noqa: BLE001
            fehler.append(e)
        finally:
            fertig.set()

    t = threading.Thread(target=schreiber)
    r = ts.oeffne(p, busy_ms=2000)
    t.start()
    while not fertig.is_set():
        try:
            r.execute("SELECT count(*) FROM wirksam WHERE tag LIKE 'genre:%'").fetchone()
            ts.oeffne(p, busy_ms=2000).close()
            antworten[0] += 1
        except sqlite3.Error as e:
            fehler.append(e)
            break
    t.join()
    assert not fehler, fehler
    assert antworten[0] >= 1
    assert r.execute("SELECT count(*) FROM item_tag WHERE quelle = 'erbe'").fetchone()[0] == 1200
    r.close()


def test_erbe_second_run_writes_nothing_and_batches_are_small(con):
    for i in range(1100):
        tag(con, f"s{i}", "genre:techno", "gemessen")
        rel(con, f"d{i}", "made_from", f"s{i}")
    commits = []
    con.set_trace_callback(lambda t: commits.append(t) if t.upper().startswith("COMMIT") else None)
    assert ts.erbe(con) == 1100
    assert len(commits) == 3                         # 500 + 500 + 100
    rows = con.execute("SELECT item, tag, wert, zeit FROM item_tag WHERE quelle = 'erbe' ORDER BY item").fetchall()
    assert len(rows) == 1100 and rows[0]["wert"] == 1
    assert ts.erbe(con) == 0
    assert [tuple(r) for r in con.execute("SELECT item, tag, wert, zeit FROM item_tag WHERE quelle = 'erbe' ORDER BY item")] \
        == [tuple(r) for r in rows]


def test_erbe_only_for_given_items_and_their_descendants(con):
    tag(con, "a", "genre:techno", "gemessen")
    tag(con, "z", "genre:house", "gemessen")
    rel(con, "a1", "made_from", "a")
    rel(con, "a2", "made_from", "a1")
    rel(con, "z1", "made_from", "z")
    assert ts.erbe(con) == 3
    con.execute("UPDATE item_tag SET tag = 'genre:ambient' WHERE item = 'a'")
    con.execute("UPDATE item_tag SET tag = 'genre:dub' WHERE item = 'z'")
    assert ts.erbe(con, ["a"]) == 4                  # a1 and a2: one row out, one in each; z1 untouched
    assert wirksam(con, "a1") == [("genre:ambient", "abgeleitet")]
    assert wirksam(con, "a2") == [("genre:ambient", "abgeleitet")]
    assert wirksam(con, "z1") == [("genre:house", "abgeleitet")]
    assert ts.erbe(con, ["a"]) == 0
    assert ts.erbe(con) == 2                         # the full run catches z1 up
    assert wirksam(con, "z1") == [("genre:dub", "abgeleitet")]


def test_erbe_incremental_matches_full_run_on_a_long_chain(con):
    tag(con, "n0", "genre:techno", "gemessen")
    for i in range(1, 6):
        rel(con, f"n{i}", "made_from", f"n{i-1}")
    ts.erbe(con)
    ts.erbe(con, ["n3"])                              # a recompute in the middle must not extend the chain
    assert [i for i in range(6) if wirksam(con, f"n{i}")] == [0, 1, 2, 3]
    assert ts.erbe(con) == 0
