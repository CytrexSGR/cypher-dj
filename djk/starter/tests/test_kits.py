import json
import os
from pathlib import Path

import numpy as np
import pytest

from starter import storage as ablage, kits
from testumgebung import saubere_umgebung
from starter.tools import WerkzeugFehlt


def _lies(kit: Path):
    j = json.loads((kit / "kit.json").read_text())
    return j, {k["note"]: np.frombuffer((kit / k["datei"]).read_bytes(), dtype="<f4").reshape(-1, 2) for k in j["klaenge"]}


@pytest.fixture(scope="module")
def gebaut(tmp_path_factory):
    """One real render of both kits (needs cargo), shared by the tests that only read. The environment comes from
    testumgebung (the autouse isolation is function scoped and does not reach this fixture): a throw-away HOME,
    CARGO_HOME and RUSTUP_HOME of the real HOME so that cargo is found."""
    t = tmp_path_factory.mktemp("kits")
    env = saubere_umgebung(t, Path(os.environ.get("HOME", str(Path.home()))))
    Path(env["HOME"]).mkdir()
    gesichert = dict(os.environ)
    for k in [k for k in os.environ if k.startswith("CYPHERDJ_")]:
        del os.environ[k]
    os.environ.update(env)
    try:
        wurzel = t / "kits"
        r = kits.baue_kits(wurzel)
        yield wurzel, r, Path(env["HOME"])
    finally:
        os.environ.clear()
        os.environ.update(gesichert)


def test_sound_counts(gebaut):
    wurzel, r, _ = gebaut
    assert r["starter"] == "neu" and r["starter-808"] == "neu"
    assert len(_lies(wurzel / "starter")[1]) == 20
    assert len(_lies(wurzel / "starter-808")[1]) == 23


@pytest.mark.parametrize("kit", ["starter", "starter-808"])
def test_every_sound_is_finite_quiet_enough_and_not_silent(gebaut, kit):
    wurzel, _, _ = gebaut
    j, klaenge = _lies(wurzel / kit)
    assert ablage.pruefe_kit(wurzel / kit) is None
    for note, x in klaenge.items():
        assert np.all(np.isfinite(x)), note
        assert 20 * np.log10(np.abs(x).max()) <= -1.0 + 1e-3, note
        kopf = x[:4800]
        assert 20 * np.log10(np.sqrt(np.mean(kopf ** 2)) + 1e-12) > -60, note


def test_gm_is_copy_of_starter_when_neither_gm_nor_techno(gebaut):
    wurzel, r, _ = gebaut
    assert r["gm"] == "neu"
    jg, g = _lies(wurzel / "gm")
    js, s = _lies(wurzel / "starter")
    assert jg["name"] == "gm" and {**jg, "name": "starter"} == js
    assert all(np.array_equal(g[n], s[n]) for n in s)


def test_oneshots_stay_as_wav(gebaut):
    _, _, home = gebaut
    d = home / ".local" / "share" / "cypherdj" / "starter" / "klaenge" / "oneshots"
    assert (d / "909" / "bd-0.wav").is_file() and (d / "808" / "perc-1.wav").is_file()
    assert len(list((d / "909").glob("*.wav"))) == 20 and len(list((d / "808").glob("*.wav"))) == 23


def test_second_run_changes_nothing_and_needs_no_tool(gebaut, monkeypatch):
    wurzel, _, _ = gebaut
    vorher = {p: p.read_bytes() for p in wurzel.rglob("*") if p.is_file()}
    monkeypatch.setattr(kits.werkzeuge, "cargo_beispiel", lambda n: (_ for _ in ()).throw(AssertionError("cargo called")))
    assert kits.baue_kits(wurzel) == {"starter": "behalten", "starter-808": "behalten", "gm": "behalten"}
    assert {p: p.read_bytes() for p in wurzel.rglob("*") if p.is_file()} == vorher


def test_damaged_kit_is_kept_and_reported(gebaut, tmp_path, capsys):
    wurzel = tmp_path / "kits"
    (wurzel / "starter").mkdir(parents=True)
    (wurzel / "starter" / "kit.json").write_text("{kaputt")
    r = kits.baue_kits(wurzel, nur=("starter",))
    assert r == {"starter": "beschaedigt"}
    assert (wurzel / "starter" / "kit.json").read_text() == "{kaputt"
    assert "damaged" in capsys.readouterr().err


def test_damaged_kit_makes_the_step_return_4(tmp_path, capsys):
    from starter import __main__ as haupt
    ablage.schreibe_kit(ablage.kit_ordner(), "starter-808", [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])
    ablage.schreibe_kit(ablage.kit_ordner(), "starter", [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])
    (ablage.kit_ordner() / "starter" / "kit.json").write_text("{kaputt")
    assert haupt.stufe_kits() == 4
    out = capsys.readouterr()
    assert "installed kit starter" not in out.out and "damaged" in out.err


def test_intact_existing_kits_return_0(tmp_path):
    from starter import __main__ as haupt
    for n in ("starter", "starter-808"):
        ablage.schreibe_kit(ablage.kit_ordner(), n, [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])
    assert haupt.stufe_kits() == 0


def test_gm_not_written_with_techno_and_kept_when_own(tmp_path):
    wurzel = tmp_path / "kits"
    ablage.schreibe_kit(wurzel, "techno", [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])
    ablage.schreibe_kit(wurzel, "starter", [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])  # a valid starter is there, so only the guard decides
    kits.baue_kits(wurzel, nur=("starter", "gm"))
    assert not (wurzel / "gm").exists()
    ablage.schreibe_kit(wurzel.parent / "ohne", "starter", [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])
    assert kits.baue_kits(wurzel.parent / "ohne", nur=("starter", "gm")) == {"starter": "behalten", "gm": "neu"}
    w2 = tmp_path / "kits2"
    ablage.schreibe_kit(w2, "gm", [(36, "bd:0", np.full((10, 2), 0.2, "float32"))])
    ablage.schreibe_kit(w2, "starter", [(36, "bd:0", np.full((10, 2), 0.1, "float32"))])
    vorher = (w2 / "gm" / "36.f32").read_bytes()
    assert kits.baue_kits(w2, nur=("starter", "gm"))["gm"] == "behalten"
    assert (w2 / "gm" / "36.f32").read_bytes() == vorher and not (w2 / "techno").exists()


def test_missing_cargo_is_tool_missing_not_traceback(tmp_path, monkeypatch):
    def fehlt(n):
        raise WerkzeugFehlt("cargo", "cargo not usable")
    monkeypatch.setattr(kits.werkzeuge, "cargo_beispiel", fehlt)
    with pytest.raises(WerkzeugFehlt):
        kits.baue_kits(tmp_path / "kits")
    assert not (tmp_path / "kits" / "starter").exists()
