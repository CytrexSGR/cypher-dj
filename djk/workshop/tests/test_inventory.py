import os
import pytest
from werkstatt.inventory import (aufraeumen, fassung_name, fassung_teile, korrektur_anhaengen, korrekturen_lesen,
                               rename_ohne_ueberschreiben, versiegeln)


def test_fassung_name_hin_und_zurueck():
    assert fassung_name(128.0, 1) == "128000_r1"
    assert fassung_name(124.5, 12) == "124500_r12"
    assert fassung_teile("128000_r2") == (128.0, 2)
    with pytest.raises(ValueError):
        fassung_teile("128000_r0")


def test_rename_ueberschreibt_leeren_ordner_nicht(tmp_path):
    """FEHLERFALL VORHER: os.rename ersetzt einen leeren Zielordner still. NACHHER: renameat2 verweigert."""
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir(); (a / "x").write_text("neu")
    b.mkdir()
    with pytest.raises(FileExistsError):
        rename_ohne_ueberschreiben(a, b)
    assert (a / "x").read_text() == "neu" and list(b.iterdir()) == []
    c, d = tmp_path / "c", tmp_path / "d"
    c.mkdir(); (c / "x").write_text("neu")
    d.mkdir()
    os.rename(c, d)                                   # das, was wir nicht wollen
    assert (d / "x").read_text() == "neu"


def test_rename_in_freies_ziel(tmp_path):
    """NEGATIV-KONTROLLE: freies Ziel geht."""
    a = tmp_path / "a"; a.mkdir(); (a / "x").write_text("1")
    rename_ohne_ueberschreiben(a, tmp_path / "neu")
    assert (tmp_path / "neu" / "x").read_text() == "1" and not a.exists()


def test_versiegelt_heisst_nicht_schreibbar(tmp_path):
    f = tmp_path / "128000_r1"; f.mkdir(); (f / "basis.f32").write_bytes(b"\0" * 8)
    versiegeln(f)
    with pytest.raises(PermissionError):
        open(f / "basis.f32", "r+b")
    with pytest.raises(PermissionError):
        (f / "neu.txt").write_text("x")
    aufraeumen(f)
    assert not f.exists()


def test_korrekturen_nur_anhaengen(tmp_path):
    z = {"zeit": "2026-09-24T21:14:03", "von": "andreas", "art": "raster", "fassung": "128000_r1",
         "ab_quell_beat": 64.0, "bis_quell_beat": 128.0, "versatz_ms": -10.4, "nr": None, "text": ""}
    assert korrektur_anhaengen(tmp_path, z) == 1
    assert korrektur_anhaengen(tmp_path, dict(z, art="urteil", versatz_ms=None, text="gut")) == 2
    zeilen = korrekturen_lesen(tmp_path)
    assert zeilen[0] == z and zeilen[1]["text"] == "gut"


def test_ungueltige_korrektur_wird_nicht_angehaengt(tmp_path):
    """FEHLERFALL: Zeile mit Fassung r0 (Schema verlangt r >= 1) -> ValueError, Datei bleibt leer."""
    (tmp_path / "korrekturen.jsonl").touch()
    with pytest.raises(ValueError):
        korrektur_anhaengen(tmp_path, {"zeit": "2026-09-24T21:14:03", "von": "andreas", "art": "raster",
                                       "fassung": "128000_r0", "ab_quell_beat": 8.0, "bis_quell_beat": 16.0,
                                       "versatz_ms": 5.0, "nr": None, "text": ""})
    assert korrekturen_lesen(tmp_path) == [] and os.path.getsize(tmp_path / "korrekturen.jsonl") == 0


def test_vorgaben_aus_tabelle(tmp_path, monkeypatch):
    """The analysis store default comes from the storage table; an empty CYPHERDJ_* value counts as unset."""
    from pathlib import Path
    from werkstatt.inventory import standard_ablage, standard_bestand
    monkeypatch.setenv("HOME", str(tmp_path))
    for n in ("CYPHERDJ_BESTAND", "CYPHERDJ_ANALYSE", "CYPHERDJ_HEIM"):
        monkeypatch.delenv(n, raising=False)
    assert standard_bestand() == tmp_path / "cypher-dj" / "bestand"
    assert standard_ablage() == tmp_path / "werkstatt" / "cypher-dj-analyse"
    monkeypatch.setenv("CYPHERDJ_BESTAND", "")
    monkeypatch.setenv("CYPHERDJ_ANALYSE", "")
    assert standard_bestand() == tmp_path / "cypher-dj" / "bestand"
    assert standard_ablage() == tmp_path / "werkstatt" / "cypher-dj-analyse"
    monkeypatch.setenv("CYPHERDJ_BESTAND", str(tmp_path / "b"))
    monkeypatch.setenv("CYPHERDJ_ANALYSE", str(tmp_path / "a"))
    assert standard_bestand() == Path(tmp_path / "b") and standard_ablage() == Path(tmp_path / "a")


def test_raster_ordner_aus_tabelle_ab_cwd_workshop(tmp_path):
    """Start path of the page server: `python -m werkstatt.<modul>` with cwd = djk/workshop. `ablage` must be the package djk/ablage."""
    import subprocess
    import sys
    from pathlib import Path
    workshop = Path(__file__).resolve().parents[1]
    import site
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path), "PYTHONUSERBASE": site.getuserbase()}   # user site stays visible with a foreign HOME
    code = ("import sys, os, werkstatt.bestand as b; from werkstatt import lauf_eins as l; "
            "print(os.path.realpath(sys.modules['ablage'].__file__)); print(l.RASTER_ORDNER); print(b.standard_ablage())")
    r = subprocess.run([sys.executable, "-c", code], cwd=workshop, env=env, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    pfad, raster, analyse = r.stdout.splitlines()[-3:]
    assert pfad == str(workshop.parent / "ablage" / "__init__.py")
    assert raster == f"{tmp_path}/.config/cypherdj/raster" and analyse == f"{tmp_path}/werkstatt/cypher-dj-analyse"
