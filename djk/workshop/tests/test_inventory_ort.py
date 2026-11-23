"""The four kinds that used to live inside the checkout, Python side. Same fixture as djk/ui/tests/ablage_bestand.test.mjs."""
import json
from pathlib import Path

import pytest

from werkstatt.table import ablage

REPO = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((REPO / "djk" / "ablage" / "tests" / "neue_arten.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("art", list(FIXTURE))
def test_drei_faelle(art, tmp_path):
    f = FIXTURE[art]
    repo, heim = tmp_path / "repo", tmp_path / "heim"
    repo.mkdir()
    env = {"HOME": str(tmp_path), "CYPHERDJ_HEIM": str(heim)}
    o = ablage.orte(art, env, repo=repo)
    assert (o["alt"], o["neu"], o["env"]) == (str(repo / f["alt"]), str(heim / f["neu"]), f["env"])
    assert ablage.ordner(art, env, repo=repo) == heim / f["neu"]            # nothing there
    (repo / f["alt"]).mkdir(parents=True)
    (repo / f["alt"] / "x").write_text("1")
    assert ablage.ordner(art, env, repo=repo) == repo / f["alt"]            # old place not empty
    assert ablage.ordner(art, {**env, f["env"]: "/tmp/eigen"}, repo=repo) == Path("/tmp/eigen")
    assert ablage.ordner(art, {**env, f["env"]: ""}, repo=repo) == repo / f["alt"]


def test_standard_bestand_nimmt_die_tabelle(monkeypatch, tmp_path):
    from werkstatt.inventory import standard_bestand
    monkeypatch.setenv("CYPHERDJ_BESTAND", str(tmp_path / "b"))
    assert standard_bestand() == tmp_path / "b"
    monkeypatch.setenv("CYPHERDJ_BESTAND", "")
    assert standard_bestand() == ablage.ordner("bestand")
