"""python3 -m quellen, run as a process with HOME and CYPHERDJ_HEIM below tmp_path."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

DJK = Path(__file__).resolve().parents[2]
DATEN = Path(__file__).resolve().parent / "data"


@pytest.fixture
def cli(tmp_path):
    heim = tmp_path / "heim"
    heim.mkdir()

    def lauf(*args):
        return subprocess.run([sys.executable, "-m", "quellen", *args], cwd=DJK, capture_output=True, text=True, check=False,
                              env={"HOME": str(tmp_path / "home"), "CYPHERDJ_HEIM": str(heim), "PATH": "/usr/bin:/bin"})
    lauf.heim, lauf.tmp = heim, tmp_path
    return lauf


def zeige(cli):
    r = cli("zeige", "--json", "--host", "desktop-x")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_dazu_weg_zeige(cli):
    assert zeige(cli)["wurzeln"] == []
    assert cli("dazu", "--name", "Meine Loops", "--pfad", "/media/tester/Stick/loops", "--art", "loop", "--regal").returncode == 0
    assert cli("dazu", "--name", "Archiv", "--pfad", "/data/archiv", "--art", "track", "--wechselplatte", "ja", "--kein-katalog").returncode == 0
    w = {e["name"]: e for e in zeige(cli)["wurzeln"]}
    assert (w["Meine Loops"]["regal"], w["Meine Loops"]["katalog"], w["Meine Loops"]["wechselplatte"]) == (True, True, True)
    assert (w["Archiv"]["regal"], w["Archiv"]["katalog"], w["Archiv"]["wechselplatte"]) == (False, False, True)
    assert cli("weg", "--name", "Archiv").returncode == 0
    assert [e["name"] for e in zeige(cli)["wurzeln"]] == ["Meine Loops"]
    r = cli("weg", "--name", "Archiv")
    assert r.returncode == 4 and "no root is named" in r.stderr


def test_dazu_name_vergeben(cli):
    assert cli("dazu", "--name", "A", "--pfad", "/a", "--art", "track").returncode == 0
    vorher = (cli.heim / "quellen.toml").read_text()
    r = cli("dazu", "--name", "A", "--pfad", "/b", "--art", "loop")
    assert r.returncode == 4 and "is taken" in r.stderr
    assert (cli.heim / "quellen.toml").read_text() == vorher


def test_aufruf_und_kaputte_datei(cli):
    assert cli("dazu", "--name", "A", "--pfad", "/a", "--art", "lied").returncode == 2
    assert cli("dazu", "--name", "A", "--pfad", "rel", "--art", "track").returncode == 3
    assert cli("unsinn").returncode == 2
    (cli.heim / "quellen.toml").write_text("schema = 7\n")
    r = cli("zeige", "--json")
    assert r.returncode == 3 and "schema must be 1" in r.stderr


def test_heim_fehlt(cli):
    cli.heim.rmdir()
    r = cli("dazu", "--name", "A", "--pfad", "/a", "--art", "track")
    assert r.returncode == 6 and not cli.heim.exists()


def test_importiere_trockenlauf(cli):
    args = ("importiere", "--mediathek", str(DATEN / "wurzeln.toml"), "--regal", str(DATEN / "regal.json"),
            "--umgebung", str(DATEN / "umgebung.env"))
    r = cli(*args)
    assert r.returncode == 0 and 'name = "Live Core Library"' in r.stdout and "[[klang]]" in r.stdout
    assert not (cli.heim / "quellen.toml").exists()
    assert cli(*args, "--ausfuehren").returncode == 0
    assert len(zeige(cli)["wurzeln"]) == 12 and zeige(cli)["fern"] == 1
    klang = {k["name"]: k["pfad"] for k in zeige(cli)["klang"]}
    assert klang["battery"] == "/data/audio/Battery4-Samples/Drums"
    r = cli(*args, "--ausfuehren")
    assert r.returncode == 4 and "already has roots" in r.stderr
    r = cli("vergleiche", "--mediathek", str(DATEN / "wurzeln.toml"), "--regal", str(DATEN / "regal.json"))
    assert r.returncode == 0 and r.stdout == ""
    assert cli("weg", "--name", "VCSL").returncode == 0
    r = cli("vergleiche", "--mediathek", str(DATEN / "wurzeln.toml"), "--regal", str(DATEN / "regal.json"))
    assert r.returncode == 1 and "shelf: only in the old list: VCSL" in r.stdout
    r = cli("weg", "--name", "Battery 4")
    assert r.returncode == 4 and "used by the kit source 'battery'" in r.stderr


def test_schreibe_alt_ziele(cli):
    cli("importiere", "--mediathek", str(DATEN / "wurzeln.toml"), "--regal", str(DATEN / "regal.json"), "--ausfuehren")
    r = cli("schreibe-alt", "--ziel-mediathek", str(cli.tmp / "aus.toml"))
    assert r.returncode == 0, r.stderr
    regal = cli.heim / "werke" / "sampler" / "wurzeln.json"   # vorgabe neu: the sampler folder lives in the heim
    assert sorted(r.stdout.split()) == sorted([str(cli.tmp / "aus.toml"), str(regal)])
    assert [e["name"] for e in json.loads(regal.read_text())] == ["Live Core Library", "Battery 4", "VCSL", "NI"]
    assert not (cli.tmp / "home" / ".config" / "cypherdj" / "bibliothek.json").exists()   # only written where it exists
    assert cli("schreibe-alt", "--ziel-mediathek", str(cli.tmp / "aus.toml")).stdout == ""
