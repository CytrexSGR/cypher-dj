"""Pass A and the hook: catalogue columns to measured tags, incremental, manual rows survive, safe on a bad catalogue."""
from __future__ import annotations

import json
import os
import sqlite3
import threading

import pytest

from bibliothek import catalog_build as katalog_bau, tags_measure as tags_messen
from bibliothek import tags_store as ts

SHA = "a" * 64
SHA2 = "b" * 64


def baue(pfad, zeilen):
    db = sqlite3.connect(pfad)
    db.executescript(katalog_bau.DDL)
    db.execute("INSERT INTO stand VALUES ('erbauer', ?)", (katalog_bau.ERBAUER,))
    for z in zeilen:
        r = {"typ": "loop", "sha": SHA, "shas": "[]", "pfad": f"/lib/{z.get('name', 'x')}.wav", "name": "x"}
        r.update(z)
        db.execute(f"INSERT INTO katalog({','.join(r)}) VALUES ({','.join('?' * len(r))})", list(r.values()))
    db.commit()
    db.close()


@pytest.fixture
def pfade(tmp_path):
    return tmp_path / "katalog.sqlite", tmp_path / "tags.sqlite"


def lauf(pfade, *extra):
    return tags_messen.haupt(["--katalog", str(pfade[0]), "--tags", str(pfade[1]), *extra])


@pytest.fixture(autouse=True)
def kein_nice(monkeypatch):
    monkeypatch.setattr(os, "nice", lambda n: 0)


def eff(pfad, item):
    c = ts.oeffne(pfad)
    try:
        return sorted((r["tag"], r["herkunft"]) for r in c.execute("SELECT tag, herkunft FROM wirksam WHERE item=?", (item,)))
    finally:
        c.close()


def schnappschuss(pfad):
    c = ts.oeffne(pfad)
    try:
        return ([tuple(r) for r in c.execute("SELECT * FROM item ORDER BY id")],
                [tuple(r) for r in c.execute("SELECT * FROM item_tag ORDER BY item, tag, herkunft")])
    finally:
        c.close()


def test_loop_row_gives_exact_tags(pfade):
    baue(pfade[0], [dict(bpm=127.6, camelot="8A", energie=7, instrument="kick", genre="Deep House")])
    assert lauf(pfade) == 0
    assert eff(pfade[1], f"datei:{SHA}") == sorted([
        ("tempo:128", "gemessen"), ("tonart:8A", "gemessen"), ("energie:4", "gemessen"), ("typ:kick", "gemessen"),
        ("genre:deep_house", "gemessen")])


def test_out_of_range_and_unknown_give_nothing(pfade):
    baue(pfade[0], [dict(bpm=300, camelot="13Z", genre="Weird Stuff")])
    assert lauf(pfade) == 0
    assert eff(pfade[1], f"datei:{SHA}") == []


def test_same_sha_twice_is_one_item_and_moved_file_keeps_manual(pfade):
    baue(pfade[0], [dict(name="p1", bpm=128), dict(name="p2", bpm=128)])
    assert lauf(pfade) == 0
    c = ts.oeffne(pfade[1])
    assert c.execute("SELECT count(*) FROM item").fetchone()[0] == 1
    c.execute("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, 'frei:mine', 'nutzer', '', 1, 5)", (f"datei:{SHA}",))
    c.close()
    pfade[0].unlink()
    baue(pfade[0], [dict(name="moved", pfad="/elsewhere/moved.wav", bpm=128)])
    assert lauf(pfade) == 0
    assert ("frei:mine", "nutzer") in eff(pfade[1], f"datei:{SHA}")


def test_second_run_changes_nothing_and_one_change_is_local(pfade):
    baue(pfade[0], [dict(sha=SHA, bpm=128, name="a"), dict(sha=SHA2, bpm=130, name="b")])
    assert lauf(pfade) == 0
    vorher = schnappschuss(pfade[1])
    assert lauf(pfade) == 0
    assert schnappschuss(pfade[1]) == vorher
    db = sqlite3.connect(pfade[0])
    db.execute("UPDATE katalog SET bpm = 140 WHERE sha = ?", (SHA,))
    db.commit()
    db.close()
    assert lauf(pfade) == 0
    nachher = schnappschuss(pfade[1])
    assert eff(pfade[1], f"datei:{SHA}") == [("tempo:140", "gemessen")]
    zeilen_b = [r for r in nachher[1] if r[0] == f"datei:{SHA2}"]
    assert zeilen_b == [r for r in vorher[1] if r[0] == f"datei:{SHA2}"]


def test_manual_tempo_and_removal_survive_re_measurement(pfade):
    baue(pfade[0], [dict(bpm=124, instrument="kick")])
    assert lauf(pfade) == 0
    c = ts.oeffne(pfade[1])
    c.execute("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, 'tempo:140', 'nutzer', '', 1, 5)", (f"datei:{SHA}",))
    c.execute("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, 'typ:kick', 'nutzer', '', 0, 5)", (f"datei:{SHA}",))
    c.close()
    db = sqlite3.connect(pfade[0])
    db.execute("UPDATE katalog SET bpm = 128")
    db.commit()
    db.close()
    assert lauf(pfade) == 0
    assert eff(pfade[1], f"datei:{SHA}") == [("tempo:140", "nutzer")]


def test_missing_or_foreign_catalogue_exits_3_and_writes_nothing(pfade, tmp_path):
    assert lauf(pfade) == 3
    assert not pfade[1].exists() and not list(tmp_path.glob("*.lauf"))
    db = sqlite3.connect(pfade[0])
    db.execute("CREATE TABLE katalog(id INTEGER PRIMARY KEY)")
    db.commit()
    db.close()
    assert lauf(pfade) == 3
    assert not pfade[1].exists()


def test_orphans_follow_rule_and_katalog_zero_items_are_safe(pfade):
    baue(pfade[0], [dict(sha=SHA, bpm=128)])
    c = ts.oeffne(pfade[1])
    c.execute("INSERT INTO item(id, art, katalog) VALUES ('datei:stem', 'oneshot', 0)")
    c.execute("INSERT INTO item(id, art, katalog) VALUES ('datei:clip', 'oneshot', 0)")
    c.execute("INSERT INTO relation(von, art, nach, herkunft, zeit) VALUES ('datei:stem', 'made_from', 'datei:x', 'melde', 1)")
    c.close()
    assert lauf(pfade) == 0
    db = sqlite3.connect(pfade[0])
    db.execute("DELETE FROM katalog")
    db.commit()
    db.close()
    assert lauf(pfade) == 0
    c = ts.oeffne(pfade[1])
    ids = {r["id"]: r["weg"] for r in c.execute("SELECT id, weg FROM item")}
    assert ids == {"datei:stem": 0, "datei:clip": 0}


def test_nice_first_and_given_paths(pfade, monkeypatch):
    baue(pfade[0], [dict(bpm=128)])
    events = []
    monkeypatch.setattr(os, "nice", lambda n: events.append(("nice", n)) or 0)
    orig = tags_messen.eigener_katalog
    monkeypatch.setattr(tags_messen, "eigener_katalog", lambda z: events.append(("katalog", None)) or orig(z))
    assert lauf(pfade) == 0
    assert events[0] == ("nice", 19) and ("katalog", None) in events
    assert pfade[1].exists()


def test_concurrent_run_is_refused(pfade, capsys):
    baue(pfade[0], [dict(bpm=128)])
    pfade[1].with_name("tags.sqlite.lauf").write_text(str(os.getpid()))
    assert lauf(pfade) == 0
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1]) == {"phase": "fertig", "bereits": True}
    assert not pfade[1].exists()


def test_stale_lock_is_taken_over(pfade):
    baue(pfade[0], [dict(bpm=128)])
    pfade[1].with_name("tags.sqlite.lauf").write_text("999999999")
    assert lauf(pfade) == 0
    assert not pfade[1].with_name("tags.sqlite.lauf").exists()


def test_progress_lines_and_stand(pfade, capsys):
    baue(pfade[0], [dict(sha=SHA, bpm=128, name="a"), dict(sha=SHA2, bpm=130, name="b")])
    assert lauf(pfade) == 0
    zeilen = [json.loads(z) for z in capsys.readouterr().out.strip().splitlines()]
    assert zeilen and all({"phase", "fertig", "gesamt"} <= set(z) for z in zeilen)
    assert zeilen[-1]["phase"] == "fertig"
    c = ts.oeffne(pfade[1])
    stand = dict(c.execute("SELECT schluessel, wert FROM stand").fetchall())
    assert stand["messen_phase"] == "fertig" and stand["messen_gesamt"] == "2"


def test_midi_item_art(pfade):
    baue(pfade[0], [dict(typ="midi", bpm=100)])
    assert lauf(pfade) == 0
    c = ts.oeffne(pfade[1])
    assert c.execute("SELECT art FROM item").fetchone()[0] == "midi"


def test_unreadable_catalogue_leaves_no_store_file(pfade, tmp_path):
    baue(pfade[0], [dict(bpm=128)])
    db = sqlite3.connect(pfade[0])
    db.execute("DROP TABLE katalog")
    db.commit()
    db.close()
    assert lauf(pfade) == 3
    assert not pfade[1].exists() and not list(tmp_path.glob("*.lauf"))


def test_reader_keeps_answering_while_the_hook_writes(pfade):
    baue(pfade[0], [dict(sha=f"{i:064x}", name=f"n{i}", bpm=100 + i % 60) for i in range(3000)])
    ts.oeffne(pfade[1]).close()
    fehler, antworten, fertig, rc = [], [0], threading.Event(), []

    def hook():
        try:
            rc.append(lauf(pfade))
        except BaseException as e:   # noqa: BLE001
            fehler.append(e)
        finally:
            fertig.set()

    t = threading.Thread(target=hook)
    leser = ts.oeffne(pfade[1], busy_ms=2000)
    t.start()
    while not fertig.is_set():
        try:
            leser.execute("SELECT count(*) FROM wirksam").fetchone()
            ts.oeffne(pfade[1], busy_ms=2000).close()
            antworten[0] += 1
        except sqlite3.Error as e:
            fehler.append(e)
            break
    t.join()
    assert not fehler, fehler
    assert rc == [0] and antworten[0] >= 1
    assert leser.execute("SELECT count(*) FROM item").fetchone()[0] == 3000
    leser.close()
