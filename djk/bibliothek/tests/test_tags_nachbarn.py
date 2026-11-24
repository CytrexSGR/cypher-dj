"""similar_to by nearest neighbours over the cached Pass B features."""
from __future__ import annotations

import json
import time

import numpy as np
import pytest

from bibliothek import tags_measure as tags_messen
from bibliothek import tags_nachbarn as tn
from bibliothek import tags_store as ts
from test_tags_measure import baue

SCHLUESSEL = ("zentroid_hz", "anteil_sub", "anteil_tief_mitten", "anteil_hoch", "anteil_luft", "crest", "korrelation")


@pytest.fixture
def con(tmp_path):
    c = ts.oeffne(tmp_path / "tags.sqlite")
    yield c
    c.close()


def sha(n):
    return f"{n:064x}"


def merkmale(zentroid, sub=0.2, mitten=0.2, hoch=0.1, luft=0.05, crest=3.0, korr=0.9):
    return dict(zentroid_hz=zentroid, anteil_sub=sub, anteil_tief_mitten=mitten, anteil_hoch=hoch, anteil_luft=luft, crest=crest,
                korrelation=korr)


def lege(con, n, art, m):
    con.execute("INSERT OR REPLACE INTO item(id, art) VALUES (?, ?)", (f"datei:{sha(n)}", art))
    con.execute("INSERT OR REPLACE INTO merkmal(sha, v, daten, zeit) VALUES (?, 1, ?, 1)", (sha(n), json.dumps(m)))


def paare(con):
    return [tuple(r) for r in con.execute(
        "SELECT von, nach, wert, herkunft FROM relation WHERE art = 'similar_to' ORDER BY von, wert, nach")]


def cluster(con, mittelpunkte, je=10, art="loop"):
    rng = np.random.default_rng(3)
    n = 0
    for c, (z, sub, crest) in enumerate(mittelpunkte):
        for _ in range(je):
            n += 1
            lege(con, 100 * (c + 1) + n, art, merkmale(z * (1 + 0.01 * rng.standard_normal()), sub + 0.01 * rng.standard_normal(),
                                                       crest=crest + 0.05 * rng.standard_normal()))
    return n


def test_neighbours_stay_inside_their_cluster_and_k_caps_the_count(con):
    cluster(con, [(80, 0.9, 1.5), (1500, 0.1, 4.0), (9000, 0.01, 12.0)])
    gruppe = lambda s: (int(s.split(":")[1], 16) // 100)   # noqa: E731
    n = tn.baue_aehnliche(con, k=5)
    zeilen = paare(con)
    assert n == len(zeilen) == 30 * 5
    assert all(gruppe(von) == gruppe(nach) for von, nach, _, _ in zeilen)
    assert all(h == "gemessen" for *_, h in zeilen)
    von_zaehler = {}
    for von, *_ in zeilen:
        von_zaehler[von] = von_zaehler.get(von, 0) + 1
    assert set(von_zaehler.values()) == {5}
    # nearest first in wert, no item is its own neighbour
    assert all(von != nach for von, nach, _, _ in zeilen)
    for von in von_zaehler:
        werte = [w for v, _, w, _ in zeilen if v == von]
        assert werte == sorted(werte)


def test_a_group_of_three_gets_two_neighbours_each(con):
    for i in range(3):
        lege(con, i + 1, "loop", merkmale(100 + 50 * i))
    assert tn.baue_aehnliche(con, k=5) == 6


def test_a_loop_and_a_track_with_equal_features_are_not_linked(con):
    lege(con, 1, "loop", merkmale(500))
    lege(con, 2, "track", merkmale(500))
    assert tn.baue_aehnliche(con) == 0 and paare(con) == []


def test_single_item_and_empty_table(con):
    assert tn.baue_aehnliche(con) == 0
    lege(con, 1, "loop", merkmale(500))
    assert tn.baue_aehnliche(con) == 0


def test_identical_features_are_neighbours_at_distance_zero(con):
    lege(con, 1, "loop", merkmale(500))
    lege(con, 2, "loop", merkmale(500))
    lege(con, 3, "loop", merkmale(5000, crest=15))
    tn.baue_aehnliche(con, k=1)
    zeilen = {(v, n): w for v, n, w, _ in paare(con)}
    assert zeilen[(f"datei:{sha(1)}", f"datei:{sha(2)}")] == 0 and zeilen[(f"datei:{sha(2)}", f"datei:{sha(1)}")] == 0


def test_items_without_features_are_skipped(con):
    lege(con, 1, "loop", merkmale(500))
    lege(con, 2, "loop", merkmale(520))
    con.execute("INSERT INTO item(id, art) VALUES (?, 'loop')", (f"datei:{sha(3)}",))   # no merkmal row
    tn.baue_aehnliche(con)
    assert {v for v, *_ in paare(con)} == {f"datei:{sha(1)}", f"datei:{sha(2)}"}


def test_rebuild_is_deterministic_and_leaves_other_producers_alone(con):
    cluster(con, [(80, 0.9, 1.5), (1500, 0.1, 4.0)])
    con.execute("INSERT INTO relation(von, art, nach, herkunft, wert, zeit) VALUES ('a', 'similar_to', 'b', 'melde', 0.5, 1)")
    tn.baue_aehnliche(con)
    erste = paare(con)
    tn.baue_aehnliche(con)
    assert paare(con) == erste
    assert con.execute("SELECT count(*) FROM relation WHERE herkunft = 'melde' AND art = 'similar_to'").fetchone()[0] == 1


def test_rows_of_a_removed_item_do_not_stay(con):
    for i in range(4):
        lege(con, i + 1, "loop", merkmale(100 + 50 * i))
    tn.baue_aehnliche(con, k=2)
    con.execute("DELETE FROM merkmal WHERE sha = ?", (sha(1),))
    tn.baue_aehnliche(con, k=2)
    assert all(f"datei:{sha(1)}" not in (v, n) for v, n, *_ in paare(con))


def test_speed_pin_20000_random_rows(con):
    rng = np.random.default_rng(5)
    con.execute("BEGIN")
    for i in range(20000):
        con.execute("INSERT INTO item(id, art) VALUES (?, 'loop')", (f"datei:{sha(i + 1)}",))
        con.execute("INSERT INTO merkmal(sha, v, daten, zeit) VALUES (?, 1, ?, 1)",
                    (sha(i + 1), json.dumps(merkmale(float(rng.uniform(60, 12000)), float(rng.uniform()), float(rng.uniform()),
                                                     float(rng.uniform()), float(rng.uniform()), float(rng.uniform(1, 12)),
                                                     float(rng.uniform(0.5, 1))))))
    con.execute("COMMIT")
    t = time.perf_counter()
    n = tn.baue_aehnliche(con, k=5)
    dt = time.perf_counter() - t
    print(f"# 20,000 rows: {n} similar_to rows in {dt:.1f} s")
    assert n == 100000 and dt < 30


def test_hook_runs_a_b_and_neighbours_in_order(tmp_path, monkeypatch):
    import os

    import soundfile as sf
    monkeypatch.setattr(os, "nice", lambda n: 0)
    zeilen = []
    for i in range(6):
        p = tmp_path / f"f{i}.wav"
        sf.write(str(p), (0.5 * np.sin(2 * np.pi * (100 + 300 * i) * np.arange(13230) / 44100)).astype("float32"), 44100)
        zeilen.append(dict(sha=sha(i + 1), typ="loop", pfad=str(p), name=f"f{i}"))
    kat, tags = tmp_path / "katalog.sqlite", tmp_path / "tags.sqlite"
    baue(kat, zeilen)
    assert tags_messen.haupt(["--katalog", str(kat), "--tags", str(tags)]) == 0
    c = ts.oeffne(tags)
    assert c.execute("SELECT wert FROM stand WHERE schluessel = 'messen_phase'").fetchone()[0] == "fertig"
    assert c.execute("SELECT count(*) FROM relation WHERE art = 'similar_to'").fetchone()[0] == 30
    c.close()
