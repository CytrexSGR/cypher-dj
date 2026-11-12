"""Step `bibliothek` (plan task 13): the generated sounds become a library root and the catalog is built, unless the
target is a catalog of another program. The sound files are faked with the real names and lengths (no cargo); every
path is inside tmp_path (autouse fixture of conftest.py)."""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

import pytest

from bibliothek.catalog_build import DDL
from bibliothek.config import konfig_pfad, lies_konfig
from bibliothek.tests.test_catalog_build import wav_bytes
from starter import __main__ as starter_main
from starter import kits, loops

RATE = 8000


def stille(n: int, sekunden: float) -> bytes:
    """A valid 16 bit mono WAV of `sekunden` whose content depends on n."""
    return wav_bytes(n, int(RATE * sekunden))


@pytest.fixture
def klaenge(tmp_path) -> Path:
    """Fake starter sounds with the names and lengths the starter writes (loops 8/16/16 beats at 128 BPM)."""
    basis = loops._wav_ordner().parent
    n = 0
    for fam, graph in (("909", "drums-909"), ("808", "drums-808")):
        for k in next(x for x in json.loads((Path(kits.__file__).parent / "kits.json").read_text()) if x["graph"] == graph)["klaenge"]:
            n += 1
            p = basis / "oneshots" / fam / (k["name"].replace(":", "-") + ".wav")
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(stille(n, 0.5))
    for l in loops.beschreibung():
        n += 1
        p = basis / "loops" / f"{l['name']}_128bpm.wav"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(stille(n, l["beats"] * 60 / 128))
    return basis


@pytest.fixture
def ziel(tmp_path, monkeypatch) -> Path:
    z = tmp_path / "kat" / "katalog.sqlite"
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(z))
    return z


def zeilen(ziel: Path, sql: str):
    db = sqlite3.connect(Path(ziel).as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        return db.execute(sql).fetchall()
    finally:
        db.close()


def test_absent_target_is_built_with_loops_and_one_shots(klaenge, ziel, capsys):
    assert starter_main.main(["--nur", "bibliothek"]) == 0
    assert "built" in capsys.readouterr().out
    assert [w.pfad for w in lies_konfig().wurzeln] == [klaenge]
    typen = dict(zeilen(ziel, "select typ, count(*) from katalog group by typ"))
    assert typen == {"loop": 3, "oneshot": len(list(klaenge.glob("oneshots/*/*.wav")))}
    for name, bpm, takte in zeilen(ziel, "select name, bpm, takte from katalog where typ='loop' order by name"):
        assert bpm == 128 and takte in (2, 4), name
    inst = dict(zeilen(ziel, "select name, instrument from katalog where typ='oneshot'"))
    assert inst["hh-0"] == "hihat" and inst["perc-0"] == "perc"


def test_foreign_target_stays_byte_identical_and_the_step_counts_as_done(klaenge, ziel, capsys):
    ziel.parent.mkdir(parents=True)
    db = sqlite3.connect(str(ziel))
    db.executescript(DDL)
    db.execute("INSERT INTO stand VALUES ('erbauer', 'cypher-mediathek')")
    db.execute("INSERT INTO katalog(typ, sha, shas, name) VALUES ('track', 's', 's', 'n')")
    db.commit()
    db.close()
    vorher = ziel.read_bytes()
    nachbar = sorted(os.listdir(ziel.parent))
    assert starter_main.main(["--nur", "bibliothek"]) == 0
    assert "kept the existing catalog (built by another program)" in capsys.readouterr().out
    assert ziel.read_bytes() == vorher
    assert sorted(os.listdir(ziel.parent)) == nachbar
    assert not konfig_pfad().exists()  # nothing of ours is written on a machine with a foreign catalog


def test_second_run_adds_no_second_root_and_rebuilds_from_the_cache(klaenge, ziel):
    assert starter_main.main(["--nur", "bibliothek"]) == 0
    assert starter_main.main(["--nur", "bibliothek"]) == 0
    assert [w.pfad for w in lies_konfig().wurzeln] == [klaenge]
    assert zeilen(ziel, "select count(*) from katalog")[0][0] > 3


def test_existing_other_root_is_kept(klaenge, ziel, tmp_path):
    eigen = tmp_path / "meine-musik"
    eigen.mkdir()
    konfig_pfad().parent.mkdir(parents=True)
    konfig_pfad().write_text(json.dumps({"schema": 1, "wurzeln": [{"pfad": str(eigen), "typ": "track"}]}))
    assert starter_main.main(["--nur", "bibliothek"]) == 0
    assert [(str(w.pfad), w.typ) for w in lies_konfig().wurzeln] == [(str(eigen), "track"), (str(klaenge), "auto")]


def test_no_sound_folder_yet_is_skipped_with_a_hint(ziel, capsys):
    assert starter_main.main(["--nur", "bibliothek"]) == 4
    assert "kits" in capsys.readouterr().err
    assert not ziel.exists() and not konfig_pfad().exists()


def test_broken_config_is_reported_not_a_traceback(klaenge, ziel, capsys):
    konfig_pfad().parent.mkdir(parents=True)
    konfig_pfad().write_text("{kaputt")
    assert starter_main.main(["--nur", "bibliothek"]) == 4
    assert "not valid JSON" in capsys.readouterr().err
    assert not ziel.exists()


def test_empty_scan_keeps_the_own_catalog_without_a_traceback(klaenge, ziel, capsys):
    assert starter_main.main(["--nur", "bibliothek"]) == 0
    capsys.readouterr()
    vorher = ziel.read_bytes()
    for w in klaenge.rglob("*.wav"):
        w.unlink()
    assert starter_main.main(["--nur", "bibliothek"]) == 4
    err = capsys.readouterr().err
    assert "not emptied" in err and "rows" in err and "Traceback" not in err
    assert ziel.read_bytes() == vorher
    assert sorted(os.listdir(ziel.parent)) == ["katalog.sqlite"]


def test_unwritable_target_folder_is_reported(klaenge, ziel, capsys):
    ziel.parent.mkdir(parents=True)
    ziel.parent.chmod(0o500)
    try:
        if os.access(ziel.parent, os.W_OK):
            pytest.skip("running as a user that ignores directory permissions")
        assert starter_main.main(["--nur", "bibliothek"]) == 4
        assert "Traceback" not in capsys.readouterr().err
    finally:
        ziel.parent.chmod(0o700)
