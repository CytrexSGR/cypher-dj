"""Browser plan 1, task 4: progress ticks, tree mark, MIDI list and cache write-back of the builder. Temp trees only."""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from bibliothek import __main__ as befehl
from bibliothek import catalog_build as katalog_bau
from bibliothek.catalog_build import LeererBau, baue, baum_marke
from bibliothek.config import Konfig, Wurzel
from bibliothek.features import Merkmale, MerkmalCache
from bibliothek.scan import Datei
from bibliothek.tests.test_catalog_build import mache_katalog, wav_bytes

DJK = Path(__file__).resolve().parents[2]


@pytest.fixture
def ziel(tmp_path, monkeypatch) -> Path:
    z = tmp_path / "kat" / "katalog.sqlite"
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(z))
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_CACHE", str(tmp_path / "cache.sqlite"))
    return z


@pytest.fixture
def musik(tmp_path) -> Path:
    w = tmp_path / "musik"
    (w / "Drums").mkdir(parents=True)
    (w / "Drums" / "Kick 01.wav").write_bytes(wav_bytes(2))
    (w / "Drums" / "Snare 01.wav").write_bytes(wav_bytes(3))
    return w


@pytest.fixture
def cache(tmp_path) -> MerkmalCache:
    return MerkmalCache(tmp_path / "c.sqlite")


def bau(ziel, wurzeln, cache, **kw):
    return baue(ziel, Konfig(1, [Wurzel(w, "auto") for w in wurzeln]), cache, False, lambda n: None, **kw)


def test_ticks_arrive_in_phase_order_and_merkmale_carries_the_scanned_count(tmp_path, musik, cache):
    ticks = []
    bau(tmp_path / "k" / "katalog.sqlite", [musik], cache, tick=lambda p, f, g: ticks.append((p, f, g)))
    phasen = [p for p, _, _ in ticks]
    assert phasen == sorted(phasen, key=["scan", "merkmale", "schreiben"].index)
    assert set(phasen) == {"scan", "merkmale", "schreiben"} and phasen.count("schreiben") == 1
    assert all(g is None for p, _, g in ticks if p == "scan")
    assert [t for t in ticks if t[0] == "merkmale"][-1] == ("merkmale", 2, 2)


def test_ticks_are_throttled(tmp_path, cache):
    w = tmp_path / "gross"
    w.mkdir()
    for i in range(300):
        (w / f"s{i:03d}.wav").write_bytes(wav_bytes(i))
    ticks = []
    bau(tmp_path / "k" / "katalog.sqlite", [w], cache, tick=lambda p, f, g: ticks.append(p))
    assert len(ticks) <= 60


def test_marke_is_stable_changes_with_a_new_file_and_equals_the_stored_one_after_a_build(tmp_path, musik, ziel, capsys):
    befehl.main(["dazu", str(musik)])
    capsys.readouterr()

    def marke():
        assert befehl.main(["zeige", "--json", "--marke"]) == 0
        return json.loads(capsys.readouterr().out)

    a, b = marke(), marke()
    assert a["baum_marke_jetzt"] == b["baum_marke_jetzt"] and a["baum_marke_gespeichert"] is None
    assert befehl.main(["bauen"]) == 0
    capsys.readouterr()
    c = marke()
    assert c["baum_marke_gespeichert"] == c["baum_marke_jetzt"] == a["baum_marke_jetzt"]
    (musik / "Drums" / "Neu.wav").write_bytes(wav_bytes(9))
    os.utime(musik / "Drums", ns=(1, 2_000_000_000))  # a directory mtime that differs for sure, however fast the test runs
    assert marke()["baum_marke_jetzt"] != c["baum_marke_gespeichert"]


def test_a_file_edited_in_place_does_not_change_the_marke_documented_limit(tmp_path, musik):
    k = Konfig(1, [Wurzel(musik, "auto")])
    vorher = baum_marke(k)
    (musik / "Drums" / "Kick 01.wav").write_bytes(wav_bytes(77))
    assert baum_marke(k) == vorher


def test_fortschritt_json_every_json_stderr_line_has_a_phase_and_stdout_ends_with_the_summary(tmp_path, musik, ziel):
    env = {**os.environ, "CYPHERDJ_KATALOG": str(ziel), "PYTHONPATH": str(DJK)}
    r = subprocess.run([sys.executable, "-m", "bibliothek", "dazu", str(musik)], capture_output=True, text=True, env=env, cwd=DJK)
    assert r.returncode == 0, r.stderr
    r = subprocess.run([sys.executable, "-m", "bibliothek", "bauen", "--fortschritt-json"], capture_output=True, text=True, env=env, cwd=DJK)
    assert r.returncode == 0, r.stderr
    zeilen = [json.loads(z) for z in r.stderr.splitlines() if z.startswith("{")]
    assert zeilen and all("phase" in z and "fertig" in z for z in zeilen)
    letzte = json.loads(r.stdout.strip().splitlines()[-1])
    assert letzte["ok"] is True and letzte["dateien"] == 2 and letzte["zeilen"]["oneshot"] + letzte["zeilen"]["loop"] + letzte["zeilen"]["track"] == 2


def test_foreign_catalogue_still_exits_3_and_writes_no_midi_list(tmp_path, musik, ziel):
    mache_katalog(ziel, erbauer="someone else")
    (musik / "a.mid").write_bytes(b"MThd")
    befehl.main(["dazu", str(musik)])
    assert befehl.main(["bauen", "--midi-liste"]) == 3
    assert not (ziel.parent / "katalog.sqlite.midi.json").exists()


def test_only_midi_and_no_catalogue_yet_builds_rc_0_with_zero_rows_and_keeps_the_list(tmp_path, ziel):
    w = tmp_path / "nurmidi"
    w.mkdir()
    (w / "beat.mid").write_bytes(b"MThd")
    befehl.main(["dazu", str(w)])
    assert befehl.main(["bauen", "--midi-liste"]) == 0
    assert sqlite3.connect(ziel).execute("select count(*) from katalog").fetchone()[0] == 0
    liste = json.loads((ziel.parent / "katalog.sqlite.midi.json").read_text())
    assert [d["name"] for d in liste["dateien"]] == ["beat.mid"]


def test_own_catalogue_with_rows_and_sources_now_only_midi_exits_6_and_the_list_is_still_written(tmp_path, musik, ziel, capsys):
    befehl.main(["dazu", str(musik)])
    assert befehl.main(["bauen"]) == 0
    for f in (musik / "Drums").iterdir():
        f.unlink()
    (musik / "x.midi").write_bytes(b"MThd")
    capsys.readouterr()
    assert befehl.main(["bauen", "--midi-liste"]) == 6
    assert "the scan found no audio files" in capsys.readouterr().err
    assert [d["name"] for d in json.loads((ziel.parent / "katalog.sqlite.midi.json").read_text())["dateien"]] == ["x.midi"]


def test_midi_list_holds_mid_and_midi_of_all_roots_and_no_audio(tmp_path, musik, ziel):
    zweite = tmp_path / "zwei"
    (zweite / "sub").mkdir(parents=True)
    (musik / "a.mid").write_bytes(b"MThd")
    (zweite / "sub" / "B.MIDI").write_bytes(b"MThd")
    befehl.main(["dazu", str(musik)])
    befehl.main(["dazu", str(zweite)])
    assert befehl.main(["bauen", "--midi-liste"]) == 0
    namen = sorted(d["name"] for d in json.loads((ziel.parent / "katalog.sqlite.midi.json").read_text())["dateien"])
    assert namen == ["B.MIDI", "a.mid"]


def datei(pfad: Path, root: Path) -> Datei:
    st = pfad.stat()
    return Datei(pfad, pfad.name, Wurzel(root, "auto"), st.st_size, st.st_mtime_ns)


def test_ergaenze_merges_tags_and_the_next_build_reads_bpm_without_rehashing(tmp_path, musik, cache):
    loop = musik / "Drums" / "Kick 01.wav"
    r1 = bau(tmp_path / "k" / "katalog.sqlite", [musik], cache)
    assert r1.gehasht == 2
    st = loop.stat()
    assert cache.ergaenze(str(loop), st.st_size, st.st_mtime_ns, {"bpm": "128", "camelot": "8A"}) is True
    from bibliothek.features import felder
    treffer = cache.hole(datei(loop, musik))
    assert felder(datei(loop, musik), "loop", treffer[0])["bpm"] == 128.0
    vorher = cache.gehasht
    bau(tmp_path / "k" / "katalog.sqlite", [musik], cache)
    assert cache.gehasht == vorher
    db = sqlite3.connect(tmp_path / "k" / "katalog.sqlite")
    assert db.execute("select bpm, camelot from katalog where name='Kick 01'").fetchone() == (128.0, "8A")


def test_ergaenze_on_a_changed_mtime_returns_false(tmp_path, musik, cache):
    bau(tmp_path / "k" / "katalog.sqlite", [musik], cache)
    f = musik / "Drums" / "Kick 01.wav"
    st = f.stat()
    assert cache.ergaenze(str(f), st.st_size, st.st_mtime_ns + 1, {"bpm": "99"}) is False
    assert cache.ergaenze(str(musik / "nope.wav"), 1, 1, {"bpm": "99"}) is False
