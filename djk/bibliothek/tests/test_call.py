"""djk-bibliothek command (plan task 9): argument handling, return codes, messages. Nothing here touches a real user path:
HOME and XDG are redirected by the autouse fixture of conftest.py and the catalog target is always set into tmp_path."""
from __future__ import annotations

import errno
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from bibliothek import __main__ as befehl
from bibliothek import catalog_build as katalog_bau, config as konfig
from bibliothek.catalog_build import DDL
from bibliothek.tests.test_catalog_build import wav_bytes

DJK = Path(__file__).resolve().parents[2]


@pytest.fixture
def ziel(tmp_path, monkeypatch) -> Path:
    z = tmp_path / "kat" / "katalog.sqlite"
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(z))
    return z


@pytest.fixture
def musik(tmp_path) -> Path:
    w = tmp_path / "musik"
    (w / "Loops").mkdir(parents=True)
    (w / "Drums").mkdir()
    (w / "Loops" / "DT_126_Groove.wav").write_bytes(wav_bytes(1, 8000))
    (w / "Drums" / "Kick 01.wav").write_bytes(wav_bytes(2))
    (w / "Drums" / "Snare 01.wav").write_bytes(wav_bytes(3))
    return w


def lauf(capsys, *args: str) -> tuple[int, str, str]:
    rc = befehl.main(list(args))
    o = capsys.readouterr()
    return rc, o.out, o.err


def fremder_katalog(pfad: Path) -> Path:
    pfad.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(pfad))
    db.executescript(DDL)
    db.execute("INSERT INTO stand VALUES ('erbauer', 'cypher-mediathek')")
    for i, t in enumerate(["track", "track", "loop"]):
        db.execute("INSERT INTO katalog(typ, sha, shas, name) VALUES (?, ?, ?, ?)", (t, f"s{i}", f"s{i}", f"n{i}"))
    db.commit()
    db.close()
    return pfad


def sha_datei(p: Path) -> bytes:
    return p.read_bytes()


# ---- dazu / weg ----------------------------------------------------------------------------------------------------

def test_dazu_relative_path_is_stored_absolute(tmp_path, monkeypatch, capsys, ziel):
    (tmp_path / "musik").mkdir()
    monkeypatch.chdir(tmp_path)
    rc, out, _ = lauf(capsys, "dazu", "./musik")
    assert rc == 0
    k = konfig.lies_konfig()
    assert [str(w.pfad) for w in k.wurzeln] == [str(tmp_path / "musik")]
    assert os.path.isabs(str(k.wurzeln[0].pfad))
    assert str(tmp_path / "musik") in out


def test_dazu_tilde_is_expanded(capsys, ziel):
    x = Path(os.path.expanduser("~")) / "x"
    x.mkdir()
    rc, _, _ = lauf(capsys, "dazu", "~/x")
    assert rc == 0
    assert [str(w.pfad) for w in konfig.lies_konfig().wurzeln] == [str(x)]


def test_dazu_typ_is_stored(tmp_path, capsys, ziel):
    (tmp_path / "l").mkdir()
    assert lauf(capsys, "dazu", str(tmp_path / "l"), "--typ", "loop")[0] == 0
    assert konfig.lies_konfig().wurzeln[0].typ == "loop"


def test_dazu_missing_directory_is_usage_error(tmp_path, capsys, ziel):
    rc, _, err = lauf(capsys, "dazu", str(tmp_path / "gibtsnicht"))
    assert rc == 2 and "not an existing directory" in err
    assert konfig.lies_konfig().wurzeln == []


def test_dazu_file_is_usage_error(tmp_path, capsys, ziel):
    f = tmp_path / "datei.wav"
    f.write_bytes(b"x")
    assert lauf(capsys, "dazu", str(f))[0] == 2


@pytest.mark.parametrize("neu", ["aussen/innen", "aussen", "."])
def test_dazu_nested_equal_or_containing_root_is_2_and_names_the_root(tmp_path, capsys, ziel, neu):
    (tmp_path / "aussen" / "innen").mkdir(parents=True)
    wurzel = tmp_path / ("aussen/innen" if neu == "aussen" else "aussen")
    if neu == "aussen/innen":
        wurzel = tmp_path / "aussen"
    assert lauf(capsys, "dazu", str(wurzel))[0] == 0
    arg = tmp_path / neu if neu != "." else wurzel
    rc, _, err = lauf(capsys, "dazu", str(arg))
    assert rc == 2
    assert str(wurzel) in err
    assert len(konfig.lies_konfig().wurzeln) == 1


def test_dazu_parent_of_existing_root_is_2(tmp_path, capsys, ziel):
    (tmp_path / "p" / "k").mkdir(parents=True)
    assert lauf(capsys, "dazu", str(tmp_path / "p" / "k"))[0] == 0
    rc, _, err = lauf(capsys, "dazu", str(tmp_path / "p"))
    assert rc == 2 and str(tmp_path / "p" / "k") in err


def test_dazu_sibling_with_common_prefix_is_fine(tmp_path, capsys, ziel):
    (tmp_path / "musik").mkdir()
    (tmp_path / "musik2").mkdir()
    assert lauf(capsys, "dazu", str(tmp_path / "musik"))[0] == 0
    assert lauf(capsys, "dazu", str(tmp_path / "musik2"))[0] == 0


def test_weg_removes_a_root_and_rejects_an_unknown_one(tmp_path, capsys, ziel):
    (tmp_path / "a").mkdir()
    lauf(capsys, "dazu", str(tmp_path / "a"))
    rc, _, err = lauf(capsys, "weg", str(tmp_path / "b"))
    assert rc == 2 and "not a library folder" in err
    assert lauf(capsys, "weg", str(tmp_path / "a"))[0] == 0
    assert konfig.lies_konfig().wurzeln == []


def test_weg_works_when_the_folder_is_gone(tmp_path, capsys, ziel):
    (tmp_path / "a").mkdir()
    lauf(capsys, "dazu", str(tmp_path / "a"))
    (tmp_path / "a").rmdir()
    assert lauf(capsys, "weg", str(tmp_path / "a"))[0] == 0


def test_broken_config_is_2_not_a_traceback(capsys, ziel):
    p = konfig.konfig_pfad()
    p.parent.mkdir(parents=True)
    p.write_text("{nope")
    for args in (["zeige"], ["bauen"], ["dazu", "."], ["weg", "."]):
        rc, _, err = lauf(capsys, *args)
        assert rc == 2 and "not valid JSON" in err


# ---- zeige ---------------------------------------------------------------------------------------------------------

def test_zeige_json_absent_then_own_with_counts(musik, capsys, ziel):
    lauf(capsys, "dazu", str(musik))
    rc, out, _ = lauf(capsys, "zeige", "--json")
    d = json.loads(out)
    assert rc == 0 and d["zustand"] == "absent" and d["ziel"] == str(ziel)
    assert d["wurzeln"] == [{"pfad": str(musik), "typ": "auto"}]
    assert lauf(capsys, "bauen")[0] == 0
    rc, out, _ = lauf(capsys, "zeige", "--json")
    d = json.loads(out)
    assert rc == 0 and d["zustand"] == "own"
    assert d["zaehlung"]["zeilen"] == {"track": 0, "loop": 1, "oneshot": 2}


def test_zeige_text_is_readable(musik, capsys, ziel):
    lauf(capsys, "dazu", str(musik))
    lauf(capsys, "bauen")
    rc, out, _ = lauf(capsys, "zeige")
    assert rc == 0
    assert str(musik) in out and str(ziel) in out and "own" in out and "oneshot" in out


def test_zeige_foreign_counts_and_note_and_nothing_is_touched(tmp_path, capsys, ziel):
    fremder_katalog(ziel)
    vorher = sha_datei(ziel)
    rc, out, _ = lauf(capsys, "zeige", "--json")
    d = json.loads(out)
    assert rc == 0 and d["zustand"] == "foreign"
    assert d["zaehlung"] == {"track": 2, "loop": 1}
    assert d["hinweis"] == "built by another program, read only"
    rc, out, _ = lauf(capsys, "zeige")
    assert "built by another program, read only" in out
    assert sha_datei(ziel) == vorher
    assert sorted(p.name for p in ziel.parent.iterdir()) == ["katalog.sqlite"]


def test_zeige_foreign_unreadable_still_says_foreign(capsys, ziel):
    ziel.parent.mkdir(parents=True)
    ziel.write_text("not a database")
    rc, out, _ = lauf(capsys, "zeige", "--json")
    d = json.loads(out)
    assert rc == 0 and d["zustand"] == "foreign" and d["zaehlung"] is None


def test_zeige_without_roots_says_so(capsys, ziel):
    rc, out, _ = lauf(capsys, "zeige")
    assert rc == 0 and "no folders yet" in out


# ---- bauen ---------------------------------------------------------------------------------------------------------

def test_bauen_without_roots_is_2_with_the_hint(capsys, ziel):
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 2
    assert "djk-bibliothek: no folders yet: run djk-bibliothek dazu <folder>" in err
    assert not ziel.exists()


def test_bauen_builds_and_prints_counts(musik, capsys, ziel):
    lauf(capsys, "dazu", str(musik))
    rc, out, _ = lauf(capsys, "bauen")
    assert rc == 0 and ziel.is_file()
    assert "1 loop" in out and "2 oneshot" in out and "0 track" in out


def test_bauen_foreign_is_3_with_the_message_and_byte_identical(capsys, ziel, musik):
    fremder_katalog(ziel)
    vorher = sha_datei(ziel)
    lauf(capsys, "dazu", str(musik))
    rc, out, err = lauf(capsys, "bauen")
    assert rc == 3
    assert (f"djk-bibliothek: {ziel} was not built by djk-bibliothek and is left untouched. "
            "Set CYPHERDJ_KATALOG to another file to build your own catalog.") in err
    assert sha_datei(ziel) == vorher
    assert sorted(p.name for p in ziel.parent.iterdir()) == ["katalog.sqlite"]


def test_bauen_missing_root_is_4_and_ohne_fehlende_builds(tmp_path, musik, capsys, ziel):
    weg = tmp_path / "weg"
    weg.mkdir()
    lauf(capsys, "dazu", str(musik))
    lauf(capsys, "dazu", str(weg))
    weg.rmdir()
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 4 and str(weg) in err and not ziel.exists()
    rc, out, err = lauf(capsys, "bauen", "--ohne-fehlende")
    assert rc == 0 and ziel.is_file() and str(weg) in err


def test_bauen_without_any_read_tool_is_2(musik, capsys, ziel, monkeypatch):
    from bibliothek import features as merkmale
    monkeypatch.setattr(merkmale, "_importierbar", lambda n: False)
    monkeypatch.setattr(merkmale.shutil, "which", lambda n: None)
    lauf(capsys, "dazu", str(musik))
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 2 and "no tool to read audio files" in err
    assert not ziel.exists()


def test_bauen_on_a_file_system_without_hard_links_is_a_clear_message(musik, capsys, ziel, monkeypatch):
    def kein_link(a, b):
        raise OSError(errno.EPERM, "Operation not permitted")
    monkeypatch.setattr(katalog_bau.os, "link", kein_link)
    lauf(capsys, "dazu", str(musik))
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 5
    assert "hard link" in err and str(ziel) in err and "CYPHERDJ_KATALOG" in err
    assert "Traceback" not in err
    assert sorted(p.name for p in ziel.parent.iterdir()) == []  # part file removed


def test_bauen_progress_every_1000_files_names_the_counts(tmp_path, capsys, ziel, monkeypatch):
    monkeypatch.setattr(katalog_bau, "FORTSCHRITT_ALLE", 3)
    w = tmp_path / "viele"
    w.mkdir()
    for i in range(7):
        (w / f"Kick {i}.wav").write_bytes(wav_bytes(i + 10))
    (w / "leer.wav").write_bytes(b"")
    lauf(capsys, "dazu", str(w))
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 0
    zeilen = [z for z in err.splitlines() if z.startswith("scanned ")]
    assert zeilen and zeilen[0].startswith("scanned 3 files (")
    import re
    for z in zeilen:  # the counts add up to the number of files scanned so far
        m = re.fullmatch(r"scanned (\d+) files \((\d+) track, (\d+) loop, (\d+) oneshot, (\d+) skipped\)", z)
        assert m and sum(int(x) for x in m.groups()[1:]) == int(m.group(1)), z
    assert " track, " in zeilen[0] and " loop, " in zeilen[0] and " oneshot, " in zeilen[0] and " skipped)" in zeilen[0]


def test_c1_zeige_and_bauen_follow_a_dotdot_like_the_kernel(tmp_path, capsys, musik, monkeypatch):
    d = tmp_path / "d"
    (d / "real" / "sub").mkdir(parents=True)
    (d / "link").symlink_to(d / "real" / "sub")
    eigen = d / "katalog.sqlite"
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(eigen))
    lauf(capsys, "dazu", str(musik))
    assert lauf(capsys, "bauen")[0] == 0  # an own catalog at <d>/katalog.sqlite
    fremd = fremder_katalog(d / "real" / "katalog.sqlite")
    vor = fremd.read_bytes()
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(d / "link") + "/../katalog.sqlite")
    rc, out, _ = lauf(capsys, "zeige", "--json")
    assert rc == 0 and json.loads(out)["zustand"] == "foreign"
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 3
    assert fremd.read_bytes() == vor


def test_i1_bauen_with_an_empty_folder_over_a_filled_catalog_is_6_and_leer_erlaubt_builds(tmp_path, capsys, ziel, musik):
    lauf(capsys, "dazu", str(musik))
    assert lauf(capsys, "bauen")[0] == 0
    vor = ziel.read_bytes()
    lauf(capsys, "weg", str(musik))
    leer = tmp_path / "empty"
    leer.mkdir()
    lauf(capsys, "dazu", str(leer))
    rc, _, err = lauf(capsys, "bauen")
    assert rc == 6 and "--leer-erlaubt" in err and "3" in err and "Traceback" not in err
    assert ziel.read_bytes() == vor
    rc, out, _ = lauf(capsys, "bauen", "--leer-erlaubt")
    assert rc == 0 and "0 track, 0 loop, 0 oneshot" in out


# ---- wrapper -------------------------------------------------------------------------------------------------------

def test_wrapper_runs_in_a_clean_environment_and_ignores_the_real_umgebung_env(tmp_path):
    home = tmp_path / "wh"
    (home / ".config" / "cypherdj").mkdir(parents=True)
    ziel = tmp_path / "wk" / "katalog.sqlite"
    musik = tmp_path / "wm"
    musik.mkdir()
    env = {"PATH": os.environ["PATH"], "HOME": str(home), "CYPHERDJ_PYTHON": sys.executable,
           "CYPHERDJ_KATALOG": str(ziel)}
    # a umgebung.env of the (test) home that tries to move the target: variables the caller set must win
    (home / ".config" / "cypherdj" / "umgebung.env").write_text(f"CYPHERDJ_KATALOG={tmp_path}/anders.sqlite\n")
    wrapper = str(DJK / "start" / "djk-bibliothek")
    r = subprocess.run([wrapper, "dazu", str(musik)], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    r = subprocess.run([wrapper, "bauen"], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert ziel.is_file() and not (tmp_path / "anders.sqlite").exists()
    r = subprocess.run([wrapper, "zeige", "--json"], env=env, capture_output=True, text=True)
    assert json.loads(r.stdout)["zustand"] == "own"


def test_wrapper_usage_error_is_2(tmp_path):
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path), "CYPHERDJ_PYTHON": sys.executable,
           "CYPHERDJ_KATALOG": str(tmp_path / "k.sqlite")}
    r = subprocess.run([str(DJK / "start" / "djk-bibliothek"), "gibtsnicht"], env=env, capture_output=True, text=True)
    assert r.returncode == 2


def test_wrapper_resolves_relative_paths_against_the_callers_directory(tmp_path):
    home = tmp_path / "wh"
    home.mkdir()
    (tmp_path / "meine musik").mkdir()
    env = {"PATH": os.environ["PATH"], "HOME": str(home), "CYPHERDJ_PYTHON": sys.executable,
           "CYPHERDJ_KATALOG": str(tmp_path / "k.sqlite")}
    wrapper = str(DJK / "start" / "djk-bibliothek")
    r = subprocess.run([wrapper, "dazu", "./meine musik"], env=env, capture_output=True, text=True, cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    cfg = json.loads((home / ".config" / "cypherdj" / "bibliothek.json").read_text())
    assert cfg["wurzeln"][0]["pfad"] == str(tmp_path / "meine musik")
