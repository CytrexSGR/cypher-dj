"""R8: `djk-umzug einrichten --still` on a home in the 0.3.0 layout changes none of the user's files, and a second run changes nothing at all.

The layout of 0.3.0: real folders at the old places (~/.config/cypherdj/..., ~/cypherdj-projekte), filled with small files. The run may add empty
folders, links and the home marker; it must not remove, rewrite or move any file. A run that has nothing to do adds no entry to bericht.jsonl.
"""
import os
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parent))
sys.path.insert(0, str(HIER.parent.parent))
sys.path.insert(0, str(HIER.parent.parent.parent / "docs" / "veroeffentlichung" / "paket" / "tests"))
import ablage  # noqa: E402
import umzug  # noqa: E402
import upgrade_vergleich as uv  # noqa: E402


@pytest.fixture
def home030(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for name in list(os.environ):
        if name.startswith("CYPHERDJ_"):
            monkeypatch.delenv(name)
    n = 0
    for art in ablage.arten():
        alt = Path(ablage.orte(art)["alt"])
        if not str(alt).startswith(str(home)):
            continue   # old places inside the repo root are read-only in the package and not part of the user's home
        for rel in ("a.dat", "sub/b.dat"):
            (alt / rel).parent.mkdir(parents=True, exist_ok=True)
            (alt / rel).write_text(f"{art}:{rel}")
            n += 1
    (home / "cypherdj" / "werke").mkdir(parents=True)
    (home / "cypherdj" / "werke" / "eigen.txt").write_text("mine")
    assert n > 10
    return home


def roots(home):
    return [str(home)]


def eintraege(home):
    p = home / "cypherdj" / ".umzug" / "bericht.jsonl"
    return p.read_text().splitlines() if p.exists() else []


def test_einrichten_twice_keeps_every_user_file(home030):
    vorher = uv.snapshot(roots(home030), uv.AUSSCHLUSS)
    assert umzug.main(["einrichten", "--still"]) == 0
    nach1 = uv.snapshot(roots(home030), uv.AUSSCHLUSS)
    r1 = uv.vergleiche(vorher, nach1)
    assert r1["fehlt"] == [] and r1["geaendert"] == [] and r1["verschoben"] == []
    assert umzug.main(["einrichten", "--still"]) == 0
    nach2 = uv.snapshot(roots(home030), uv.AUSSCHLUSS)
    assert nach2 == nach1                                     # run 2 changes nothing at all
    r2 = uv.vergleiche(vorher, nach2)
    assert r2["fehlt"] == [] and r2["geaendert"] == [] and r2["verschoben"] == []


def test_noop_run_adds_no_report_entry(home030):
    assert umzug.main(["einrichten", "--still"]) == 0
    n1 = len(eintraege(home030))
    assert umzug.main(["einrichten", "--still"]) == 0
    assert len(eintraege(home030)) == n1
