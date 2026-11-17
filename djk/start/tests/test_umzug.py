"""umzug.py (djk-umzug): every test runs with HOME and CYPHERDJ_HEIM below tmp_path; the real home is never touched.

An abort is simulated by an injected function that raises `Abbruch` at its n-th call (before or after doing the real
work); the second run uses the real functions and must end like an uninterrupted move.
"""
import glob
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parent))
sys.path.insert(0, str(HIER.parent.parent))
import storage as ablage  # noqa: E402
import umzug  # noqa: E402


class Abbruch(Exception):
    pass


def frei(_ordner):
    return []


def bricht(n, fn, danach=False):
    """Raises Abbruch at the n-th call; with danach the real function runs first (the step happened, then the crash)."""
    z = {"n": 0}

    def f(*a, **k):
        z["n"] += 1
        if z["n"] == n:
            if danach:
                fn(*a, **k)
            raise Abbruch()
        return fn(*a, **k)
    return f


@pytest.fixture
def welt(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for name in list(os.environ):
        if name.startswith("CYPHERDJ_"):
            monkeypatch.delenv(name)
    w = SimpleNamespace(tmp=tmp_path, home=home, heim=home / "cypherdj")
    w.alt = lambda art: Path(ablage.orte(art)["alt"])
    w.neu = lambda art: Path(ablage.orte(art)["neu"])

    def platten():
        """A device function that puts the home on a second disk; the home folder must exist to be on it."""
        ablage.heim().mkdir(parents=True, exist_ok=True)
        return lambda p: 2 if str(p).startswith(str(ablage.heim())) else 1
    w.platten = platten
    return w


def fuelle(ordner: Path) -> Path:
    (ordner / "sub").mkdir(parents=True)
    (ordner / "a.txt").write_text("eins")
    (ordner / "sub" / "b.bin").write_bytes(bytes(range(256)) * 40)
    os.symlink("a.txt", ordner / "verweis")
    return ordner


def baum(wurzel) -> dict:
    """Every entry below wurzel with kind, size or link target, sha256 and mtime."""
    out = {}
    for rel, e in umzug._eintraege(str(wurzel)).items():
        p = os.path.join(wurzel, rel)
        sha = umzug._sha(p) if e[0] == "datei" else None
        out[rel] = (*e, sha, os.lstat(p).st_mtime_ns)
    return out


def journal(art) -> dict:
    return json.loads((ablage.heim() / ".umzug" / f"{art}.json").read_text())


def setze_journal(art, **felder):
    p = ablage.heim() / ".umzug" / f"{art}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    j = json.loads(p.read_text()) if p.exists() else {"art": art}
    j.update(felder)
    p.write_text(json.dumps(j))


def reste(w, art) -> list[str]:
    alt, neu = str(w.alt(art)), str(w.neu(art))
    return [p for p in (alt + umzug.LINK, neu + umzug.TEIL, alt + umzug.ZURUECK, alt + umzug.ZURUECK_TEIL) if os.path.lexists(p)]


def pruefe_umgezogen(w, art, vorher):
    alt, neu = w.alt(art), w.neu(art)
    assert alt.is_symlink() and os.path.realpath(alt) == str(neu)
    assert baum(neu) == vorher
    assert (alt / "a.txt").read_text() == "eins"
    assert umzug.zustand(art) == "umgezogen" and journal(art)["schritt"] == "fertig"
    assert reste(w, art) == []


# ---- dry run and the plain move ------------------------------------------------------------------------------------------

def test_trockenlauf_aendert_nichts(welt, capsys):
    fuelle(welt.alt("presets"))
    fuelle(welt.alt("raster"))
    vorher = baum(welt.tmp)
    assert umzug.main([], belegt=frei) == 0
    assert umzug.main(["presets"], belegt=frei) == 0
    assert umzug.main(["zurueck", "presets"], belegt=frei) == 0
    assert umzug.main(["aufraeumen", "presets"]) == 0
    assert baum(welt.tmp) == vorher
    assert "would move by rename" in capsys.readouterr().out


def test_umzug_gleiche_platte_hinterlaesst_link(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    b = umzug.ziehe_um("presets", True, belegt=frei)
    assert (b["ergebnis"], b["modus"], b["code"], b["dateien"]) == ("ok", "rename", 0, 3)
    pruefe_umgezogen(welt, "presets", vorher)


def test_umzug_verschachteltes_ziel(welt):
    vorher = baum(fuelle(welt.alt("raster")))
    eltern = welt.neu("raster").parent
    assert not eltern.exists()
    gesehen = []

    def verlinke(ziel, name):
        gesehen.append(eltern.is_dir())
        os.symlink(ziel, name)
    b = umzug.ziehe_um("raster", True, verlinke=verlinke, belegt=frei)
    assert b["ergebnis"] == "ok" and gesehen == [True]
    pruefe_umgezogen(welt, "raster", vorher)


def test_zweiter_lauf_ist_nichts_zu_tun(welt, capsys):
    fuelle(welt.alt("presets"))
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 0
    capsys.readouterr()
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 0
    assert json.loads(capsys.readouterr().out)["ergebnis"] == "nichts"


def test_ziel_belegt_abgelehnt(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    fuelle(welt.neu("presets"))
    assert umzug.zustand("presets") == "beide"
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 4
    assert baum(welt.alt("presets")) == vorher and not welt.alt("presets").is_symlink()


def test_leeres_ziel_wird_genutzt(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    welt.neu("presets").mkdir(parents=True)
    assert umzug.ziehe_um("presets", True, belegt=frei)["ergebnis"] == "ok"
    pruefe_umgezogen(welt, "presets", vorher)


def test_fremder_link_abgelehnt(welt):
    fremd = fuelle(welt.tmp / "woanders")
    welt.alt("presets").parent.mkdir(parents=True)
    os.symlink(fremd, welt.alt("presets"))
    assert umzug.zustand("presets") == "fremder_link"
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 4
    assert os.readlink(welt.alt("presets")) == str(fremd) and not welt.neu("presets").exists()


def test_pfad_mit_leerzeichen(welt, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_HEIM", str(welt.tmp / "mein heim"))
    vorher = baum(fuelle(welt.alt("presets")))
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 0
    assert str(welt.neu("presets")).startswith(str(welt.tmp / "mein heim"))
    pruefe_umgezogen(welt, "presets", vorher)


def test_bericht_wird_angehaengt(welt):
    fuelle(welt.alt("presets"))
    umzug.ziehe_um("presets", False, belegt=frei)
    assert not (welt.heim / ".umzug").exists()
    umzug.ziehe_um("presets", True, belegt=frei)
    zeilen = (welt.heim / ".umzug" / "bericht.jsonl").read_text().splitlines()
    assert len(zeilen) == 1
    z = json.loads(zeilen[0])
    assert (z["art"], z["ergebnis"], z["aktion"]) == ("presets", "ok", "umzug") and "zeit" in z


def test_starter_trockenlauf(welt):
    fuelle(welt.alt("presets"))
    r = subprocess.run([str(HIER.parent / "djk-umzug")], capture_output=True, text=True, timeout=60,
                       env={"HOME": str(welt.home), "PATH": os.environ["PATH"]}, check=False)
    assert r.returncode == 0, r.stderr
    assert "presets" in r.stdout and "would move by rename" in r.stdout
    assert not welt.heim.exists()


# ---- across two disks ----------------------------------------------------------------------------------------------------

def test_ueber_platten_kopiert_und_prueft(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    b = umzug.ziehe_um("presets", True, geraet=welt.platten(), belegt=frei)
    assert (b["ergebnis"], b["modus"]) == ("ok", "kopie")
    kopien = glob.glob(str(welt.alt("presets")) + umzug.ALTKOPIE + "*")
    assert len(kopien) == 1
    jetzt, alte = baum(welt.neu("presets")), baum(kopien[0])
    assert {r: e[:3] for r, e in jetzt.items()} == {r: e[:3] for r, e in vorher.items()}
    assert alte == vorher
    assert welt.alt("presets").is_symlink() and umzug.zustand("presets") == "umgezogen" and reste(welt, "presets") == []


def test_ueber_platten_abweichung_bricht_ab(welt):
    import shutil
    vorher = baum(fuelle(welt.alt("presets")))

    def kippt(quelle, ziel, **k):
        shutil.copytree(quelle, ziel, **k)
        p = Path(ziel) / "sub" / "b.bin"
        roh = bytearray(p.read_bytes())
        roh[7] ^= 0xFF
        p.write_bytes(bytes(roh))
    assert umzug.main(["presets", "--ausfuehren"], kopiere=kippt, geraet=welt.platten(), belegt=frei) == 5
    assert baum(welt.alt("presets")) == vorher and not welt.alt("presets").is_symlink()
    assert reste(welt, "presets") == [] and not welt.neu("presets").exists()
    assert umzug.zustand("presets") == "alt"


def test_aufraeumen_nur_nach_fertigem_umzug(welt):
    fuelle(welt.alt("presets"))
    umzug.ziehe_um("presets", True, geraet=welt.platten(), belegt=frei)
    muster = str(welt.alt("presets")) + umzug.ALTKOPIE + "*"
    assert umzug.aufraeumen("presets", False)["ergebnis"] == "ok" and len(glob.glob(muster)) == 1
    setze_journal("presets", schritt="verschoben")
    assert umzug.main(["aufraeumen", "presets", "--ausfuehren"]) == 4 and len(glob.glob(muster)) == 1
    setze_journal("presets", schritt="fertig")
    assert umzug.main(["aufraeumen", "presets", "--ausfuehren"]) == 0
    assert glob.glob(muster) == [] and (welt.alt("presets") / "a.txt").read_text() == "eins"


# ---- continuation after an abort (one test per rule) ---------------------------------------------------------------------

def zweiter_lauf(art, regel, **inj):
    assert umzug.zustand(art) == "unterbrochen"
    trocken = umzug.ziehe_um(art, False, belegt=frei, **inj)
    assert (trocken["regel"], trocken["aktion"]) == (regel, "fortsetzung")
    b = umzug.ziehe_um(art, True, belegt=frei, **inj)
    assert (b["regel"], b["ergebnis"], b["code"]) == (regel, "ok", 0), b
    return b


@pytest.mark.parametrize("schritt", ["verlinke", "umbenennen"])
def test_fortsetzung_u1(welt, schritt):
    vorher = baum(fuelle(welt.alt("presets")))
    inj = {schritt: bricht(1, getattr(os, "symlink" if schritt == "verlinke" else "rename"))}
    with pytest.raises(Abbruch):
        umzug.ziehe_um("presets", True, belegt=frei, **inj)
    assert os.path.lexists(str(welt.alt("presets")) + umzug.LINK) == (schritt == "umbenennen")
    assert journal("presets")["schritt"] == "begonnen" and not welt.neu("presets").exists()
    zweiter_lauf("presets", "U1")
    pruefe_umgezogen(welt, "presets", vorher)


def test_fortsetzung_u2(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    with pytest.raises(Abbruch):
        umzug.ziehe_um("presets", True, umbenennen=bricht(1, os.rename, danach=True), belegt=frei)
    assert not os.path.lexists(welt.alt("presets")) and welt.neu("presets").is_dir()
    zweiter_lauf("presets", "U2")
    pruefe_umgezogen(welt, "presets", vorher)


def test_fortsetzung_u3(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    umzug.ziehe_um("presets", True, belegt=frei)
    setze_journal("presets", schritt="verschoben")
    zweiter_lauf("presets", "U3")
    pruefe_umgezogen(welt, "presets", vorher)


def test_fortsetzung_u4(welt):
    import shutil
    vorher = baum(fuelle(welt.alt("presets")))
    with pytest.raises(Abbruch):
        umzug.ziehe_um("presets", True, kopiere=bricht(1, shutil.copytree, danach=True), geraet=welt.platten(), belegt=frei)
    assert os.path.isdir(str(welt.neu("presets")) + umzug.TEIL) and not welt.neu("presets").exists()
    zweiter_lauf("presets", "U4", geraet=welt.platten())
    assert {r: e[:3] for r, e in baum(welt.neu("presets")).items()} == {r: e[:3] for r, e in vorher.items()}
    assert welt.alt("presets").is_symlink() and reste(welt, "presets") == []


def u5_zustand(welt):
    fuelle(welt.alt("presets"))
    with pytest.raises(Abbruch):                                          # call 1 is s3c (part -> neu), call 2 is s4c
        umzug.ziehe_um("presets", True, umbenennen=bricht(2, os.rename), geraet=welt.platten(), belegt=frei)
    assert journal("presets")["schritt"] == "kopiert" and welt.neu("presets").is_dir() and welt.alt("presets").is_dir()


def test_fortsetzung_u5(welt):
    u5_zustand(welt)
    zweiter_lauf("presets", "U5", geraet=welt.platten())
    assert welt.alt("presets").is_symlink() and umzug.zustand("presets") == "umgezogen"
    assert len(glob.glob(str(welt.alt("presets")) + umzug.ALTKOPIE + "*")) == 1


def test_fortsetzung_u5_geaenderte_datei(welt):
    u5_zustand(welt)
    (welt.alt("presets") / "a.txt").write_text("zwei")                    # the old place went on: the first copy is stale
    b = umzug.ziehe_um("presets", True, geraet=welt.platten(), belegt=frei)
    assert (b["regel"], b["ergebnis"]) == ("U5", "ok") and b["verworfen"] == ["content differs: a.txt"]
    assert welt.alt("presets").is_symlink() and (welt.neu("presets") / "a.txt").read_text() == "zwei"
    kopie = glob.glob(str(welt.alt("presets")) + umzug.ALTKOPIE + "*")
    assert len(kopie) == 1 and (Path(kopie[0]) / "a.txt").read_text() == "zwei" and reste(welt, "presets") == []
    assert umzug.aufraeumen("presets", True)["ergebnis"] == "ok"          # the manifest is the one of the second copy


def test_fortsetzung_u6(welt):
    fuelle(welt.alt("presets"))
    with pytest.raises(Abbruch):
        umzug.ziehe_um("presets", True, verlinke=bricht(1, os.symlink), geraet=welt.platten(), belegt=frei)
    assert journal("presets")["schritt"] == "verschoben" and not os.path.lexists(welt.alt("presets"))
    zweiter_lauf("presets", "U6", geraet=welt.platten())
    assert welt.alt("presets").is_symlink() and (welt.alt("presets") / "a.txt").read_text() == "eins"
    assert umzug.zustand("presets") == "umgezogen" and reste(welt, "presets") == []


def test_fortsetzung_u7(welt, capsys):
    welt.heim.mkdir()
    setze_journal("presets", richtung="hin", schritt="begonnen")          # journal says "moving", but nothing is there
    fuelle(welt.tmp / "zeuge")
    vorher = baum(welt.tmp)
    assert umzug.main(["presets"], belegt=frei) == 4
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 4
    b = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert (b["regel"], b["grund"]) == ("U7", "unterbrochen_unklar") and b["eintraege"]["alt"] == "fehlt"
    ohne_umzug = lambda b: {r: e for r, e in b.items() if ".umzug" not in r.split(os.sep)}  # noqa: E731
    assert ohne_umzug(baum(welt.tmp)) == ohne_umzug(vorher)
    assert journal("presets")["schritt"] == "begonnen"


def umgezogen(welt, art="presets", **inj):
    vorher = baum(fuelle(welt.alt(art)))
    assert umzug.ziehe_um(art, True, belegt=frei, **inj)["ergebnis"] == "ok"
    return vorher


def pruefe_zurueck(welt, art, vorher, mtime=True):
    alt = welt.alt(art)
    assert alt.is_dir() and not alt.is_symlink() and not welt.neu(art).exists()
    schnitt = (lambda e: e) if mtime else (lambda e: e[:3])
    assert {r: schnitt(e) for r, e in baum(alt).items()} == {r: schnitt(e) for r, e in vorher.items()}
    assert umzug.zustand(art) == "alt" and reste(welt, art) == []


@pytest.mark.parametrize("journal_schritt", ["begonnen", "verschoben"])
def test_fortsetzung_z1(welt, journal_schritt):
    vorher = umgezogen(welt)
    with pytest.raises(Abbruch):
        umzug.zurueck("presets", True, umbenennen=bricht(1, os.rename, danach=True), belegt=frei)
    setze_journal("presets", schritt=journal_schritt)
    assert welt.alt("presets").is_symlink() and not welt.neu("presets").exists()
    b = umzug.zurueck("presets", True, belegt=frei)
    assert (b["regel"], b["ergebnis"]) == ("Z1", "ok")
    pruefe_zurueck(welt, "presets", vorher)


def test_fortsetzung_z2(welt):
    vorher = umgezogen(welt)
    with pytest.raises(Abbruch):                                          # call 1 is r1, call 2 is r3 (after the unlink)
        umzug.zurueck("presets", True, umbenennen=bricht(2, os.rename), belegt=frei)
    assert not os.path.lexists(welt.alt("presets")) and journal("presets")["schritt"] == "verschoben"
    b = umzug.zurueck("presets", True, belegt=frei)
    assert (b["regel"], b["ergebnis"]) == ("Z2", "ok")
    pruefe_zurueck(welt, "presets", vorher)


def test_fortsetzung_z3(welt):
    import shutil
    vorher = umgezogen(welt)
    with pytest.raises(Abbruch):
        umzug.zurueck("presets", True, kopiere=bricht(1, shutil.copytree, danach=True), geraet=welt.platten(), belegt=frei)
    assert os.path.isdir(str(welt.alt("presets")) + umzug.ZURUECK_TEIL) and welt.neu("presets").is_dir()
    b = umzug.zurueck("presets", True, geraet=welt.platten(), belegt=frei)
    assert (b["regel"], b["ergebnis"], b["modus"]) == ("Z3", "ok", "kopie")
    assert os.path.isdir(b["rest"])                                       # the copy at the home is set aside, not deleted
    pruefe_zurueck(welt, "presets", vorher, mtime=False)


# ---- in use, undo, setup, home guard -------------------------------------------------------------------------------------

def test_belegt_durch_einheit(welt, capsys):
    vorher = baum(fuelle(welt.alt("presets")))
    laeuft = lambda o: umzug.belegt(o, einheiten=lambda: ["cypherdj-oberflaeche.service"])  # noqa: E731
    assert umzug.main(["presets", "--ausfuehren"], belegt=laeuft) == 3
    assert "einheit cypherdj-oberflaeche.service" in json.loads(capsys.readouterr().out)["grund"]
    assert baum(welt.alt("presets")) == vorher and not welt.neu("presets").exists()


def test_belegt_durch_prozess(welt):
    fuelle(welt.alt("presets"))
    p = subprocess.Popen(["sleep", "30"], cwd=welt.alt("presets") / "sub")
    try:
        b = umzug.ziehe_um("presets", True, belegt=lambda o: umzug.belegt(o, einheiten=lambda: []))
        assert b["code"] == 3 and f"prozess {p.pid} sleep" in b["grund"]
        assert not welt.alt("presets").is_symlink() and not welt.neu("presets").exists()
    finally:
        p.kill()
        p.wait()


def test_zurueck_stellt_alten_zustand_her(welt):
    vorher = umgezogen(welt, "raster")
    assert umzug.main(["zurueck", "raster", "--ausfuehren"], belegt=frei) == 0
    pruefe_zurueck(welt, "raster", vorher)
    assert umzug.ziehe_um("raster", True, belegt=frei)["ergebnis"] == "ok"   # and it can move again
    pruefe_umgezogen(welt, "raster", vorher)


def test_einrichten_frische_installation(welt):
    for _ in range(2):                                                    # the second run changes nothing
        assert umzug.main(["einrichten", "--still"]) == 0
        for art in ("kits", "loops", "geraete"):
            assert welt.neu(art).is_dir() and welt.alt(art).is_symlink() and os.path.realpath(welt.alt(art)) == str(welt.neu(art))
        assert welt.neu("projekte").is_dir() and not os.path.lexists(welt.alt("projekte"))
        assert welt.neu("raster").is_dir() and not os.path.lexists(welt.alt("raster"))


def test_einrichten_nur_neu_legt_link(welt):
    (welt.neu("kits") / "909").mkdir(parents=True)
    (welt.neu("projekte") / "erstes").mkdir(parents=True)
    (welt.neu("projekte") / "erstes" / "project.json").write_text("{}")
    assert umzug.main(["einrichten", "--still"]) == 0
    for art in ("kits", "projekte"):
        assert welt.alt(art).is_symlink() and os.path.realpath(welt.alt(art)) == str(welt.neu(art))
    assert (welt.alt("projekte") / "erstes" / "project.json").read_text() == "{}"


def test_einrichten_beide_warnt(welt, capsys):
    a, n = baum(fuelle(welt.alt("presets"))), baum(fuelle(welt.neu("presets")))
    assert umzug.main(["einrichten", "--still"]) == 0
    assert f"presets: both {welt.alt('presets')} and {welt.neu('presets')} exist; staying at the old place" in capsys.readouterr().err
    assert baum(welt.alt("presets")) == a and baum(welt.neu("presets")) == n and not welt.alt("presets").is_symlink()
    assert [b for b in umzug.einrichten() if b["art"] == "presets"][0]["grund"] == "beide"


def test_einrichten_laesst_echten_alten_ordner(welt):
    vorher = baum(fuelle(welt.alt("kits")))
    assert umzug.main(["einrichten"]) == 0
    assert baum(welt.alt("kits")) == vorher and not welt.alt("kits").is_symlink()
    assert not welt.neu("kits").exists() or os.listdir(welt.neu("kits")) == []


def test_heim_ohne_elternordner_abgelehnt(welt, monkeypatch, capsys):
    monkeypatch.setenv("CYPHERDJ_HEIM", str(welt.tmp / "fehlt" / "heim"))
    assert umzug.main(["einrichten", "--still"]) == 6
    assert "is missing or empty: is the disk mounted?" in capsys.readouterr().err
    assert not (welt.tmp / "fehlt").exists()


def test_heim_auf_leerem_einhaengepunkt_abgelehnt(welt, monkeypatch):
    (welt.tmp / "platte").mkdir()
    monkeypatch.setenv("CYPHERDJ_HEIM", str(welt.tmp / "platte" / "heim"))
    assert umzug.main(["einrichten"]) == 6
    assert os.listdir(welt.tmp / "platte") == []
    assert umzug.main([]) == 6


def test_umzug_heim_nicht_bereit(welt, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_HEIM", str(welt.tmp / "fehlt" / "heim"))
    vorher = baum(fuelle(welt.alt("presets")))
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 6
    assert baum(welt.alt("presets")) == vorher and not (welt.tmp / "fehlt").exists()


def test_heim_relativ_abgelehnt(welt, monkeypatch, capsys):
    monkeypatch.setenv("CYPHERDJ_HEIM", "rel/heim")
    assert umzug.main(["presets"], belegt=frei) == 2
    assert "CYPHERDJ_HEIM must be an absolute path" in capsys.readouterr().err


def test_aufruf_unbekannt(welt):
    assert umzug.main(["gibtsnicht"]) == 2
    assert umzug.main(["presets", "--weg"]) == 2
    assert umzug.main(["zurueck"]) == 2


# ---- pruefen: listed test projects leave the project list ----------------------------------------------------------------

DATEN = json.loads((HIER / "data" / "pruefen_slugs.json").read_text())["slugs"]


def projekte(welt, *slugs) -> dict:
    """Creates projects in the project folder; returns their trees."""
    out = {}
    for s in slugs:
        p = welt.alt("projekte") / s
        (p / "audio").mkdir(parents=True)
        (p / "project.json").write_text(json.dumps({"slug": s}))
        (p / "audio" / "t.f32").write_bytes(b"\x00\x01" * 500)
        out[s] = baum(p)
    return out


def liste(welt, *slugs) -> str:
    p = welt.tmp / "liste.json"
    p.write_text(json.dumps({"slugs": list(slugs)}))
    return str(p)


def pruefe_im_pruefordner(welt, slug, vorher):
    alt, neu = welt.alt("projekte") / slug, welt.heim / "pruefen" / slug
    assert alt.is_symlink() and os.path.realpath(alt) == str(neu) and baum(neu) == vorher
    assert json.loads((alt / "project.json").read_text())["slug"] == slug


def test_vorschlag_vierzig_projekte():
    assert len(DATEN) == 40
    assert {s: umzug.pruefen_vorschlag(s) for s in DATEN} == DATEN
    assert sum(1 for r in DATEN.values() if r) == 29


def test_vorschlag_fremde_slugs():
    # Pinned on purpose: the rule also catches real projects, so it may only suggest and never decide.
    assert [umzug.pruefen_vorschlag(s) for s in ("tr8-bassline", "mk2-acid", "4-4-kick", "hoerspiel-intro")] == ["R3", "R3", "R2", "R1"]


def test_pruefen_ohne_liste_verschiebt_nichts(welt, capsys):
    projekte(welt, "hoerprobe-w2", "demo")
    vorher = baum(welt.tmp)
    assert umzug.main(["pruefen", "--ausfuehren"], belegt=frei) == 2
    assert "--ausfuehren needs --liste" in capsys.readouterr().err
    assert umzug.main(["pruefen"], belegt=frei) == 0
    aus = capsys.readouterr().out
    assert "hoerprobe-w2" in aus and "1 of 2 projects suggested" in aus
    assert baum(welt.tmp) == vorher


def test_pruefen_nur_aus_liste(welt):
    vorher = projekte(welt, "hoerprobe-w2", "gruppen-probe", "sampler-probe", "1-9-kit", "stems-vergleich", "demo")
    assert umzug.main(["pruefen", "--liste", liste(welt, "hoerprobe-w2", "1-9-kit"), "--ausfuehren"], belegt=frei) == 0
    for s in ("hoerprobe-w2", "1-9-kit"):
        pruefe_im_pruefordner(welt, s, vorher[s])
    for s in ("gruppen-probe", "sampler-probe", "stems-vergleich", "demo"):
        assert not (welt.alt("projekte") / s).is_symlink() and baum(welt.alt("projekte") / s) == vorher[s]
    assert sorted(os.listdir(welt.heim / "pruefen")) == ["1-9-kit", "hoerprobe-w2"]


def test_pruefen_zweiter_lauf_derselben_liste(welt, capsys):
    projekte(welt, "hoerprobe-w2")
    l = liste(welt, "hoerprobe-w2")
    assert umzug.main(["pruefen", "--liste", l, "--ausfuehren"], belegt=frei) == 0
    capsys.readouterr()
    assert umzug.main(["pruefen", "--liste", l, "--ausfuehren"], belegt=frei) == 0
    assert json.loads(capsys.readouterr().out)["ergebnis"] == "nichts"


def test_pruefen_trockenlauf_aendert_nichts(welt):
    projekte(welt, "hoerprobe-w2", "demo")
    l = liste(welt, "hoerprobe-w2")
    vorher = baum(welt.tmp)
    assert umzug.main(["pruefen", "--liste", l], belegt=frei) == 0
    assert umzug.main(["pruefen", "zurueck", "--alle"], belegt=frei) == 0
    assert baum(welt.tmp) == vorher


def test_pruefen_ziel_belegt(welt):
    vorher = projekte(welt, "hoerprobe-w2", "1-9-kit")
    fuelle(welt.heim / "pruefen" / "hoerprobe-w2")
    assert umzug.main(["pruefen", "--liste", liste(welt, "hoerprobe-w2", "1-9-kit"), "--ausfuehren"], belegt=frei) == 4
    assert baum(welt.alt("projekte") / "hoerprobe-w2") == vorher["hoerprobe-w2"]
    pruefe_im_pruefordner(welt, "1-9-kit", vorher["1-9-kit"])            # the others are done


def test_pruefen_unbekannter_slug(welt, capsys):
    vorher = projekte(welt, "1-9-kit")
    fremd = fuelle(welt.tmp / "woanders")
    os.symlink(fremd, welt.alt("projekte") / "verlinkt")
    l = liste(welt, "gibt-es-nicht", "../raus", "verlinkt", "1-9-kit")
    assert umzug.main(["pruefen", "--liste", l, "--ausfuehren"], belegt=frei) == 4
    berichte = [json.loads(z) for z in capsys.readouterr().out.splitlines()]
    assert [b["ergebnis"] for b in berichte] == ["abgelehnt", "abgelehnt", "abgelehnt", "ok"]
    assert "unknown project" in berichte[0]["grund"] and "not a project name" in berichte[1]["grund"]
    pruefe_im_pruefordner(welt, "1-9-kit", vorher["1-9-kit"])
    assert sorted(os.listdir(welt.heim / "pruefen")) == ["1-9-kit"] and os.readlink(welt.alt("projekte") / "verlinkt") == str(fremd)
    assert umzug.main(["pruefen", "--liste", str(welt.tmp / "fehlt.json")]) == 2


def test_pruefen_zurueck_einzeln_und_alle(welt):
    vorher = projekte(welt, "hoerprobe-w2", "1-9-kit", "gruppen-probe", "demo")
    l = liste(welt, "hoerprobe-w2", "1-9-kit", "gruppen-probe")
    assert umzug.main(["pruefen", "--liste", l, "--ausfuehren"], belegt=frei) == 0
    assert umzug.main(["pruefen", "zurueck", "1-9-kit", "--ausfuehren"], belegt=frei) == 0
    p = welt.alt("projekte") / "1-9-kit"
    assert p.is_dir() and not p.is_symlink() and baum(p) == vorher["1-9-kit"]
    assert sorted(os.listdir(welt.heim / "pruefen")) == ["gruppen-probe", "hoerprobe-w2"]
    assert umzug.main(["pruefen", "zurueck", "--alle", "--ausfuehren"], belegt=frei) == 0
    for s in vorher:
        p = welt.alt("projekte") / s
        assert p.is_dir() and not p.is_symlink() and baum(p) == vorher[s]
    assert os.listdir(welt.heim / "pruefen") == []
    assert umzug.main(["pruefen", "zurueck"]) == 2 and umzug.main(["pruefen", "zurueck", "demo", "--alle"]) == 2


def test_pruefen_belegt_durch_einheit(welt):
    vorher = projekte(welt, "hoerprobe-w2")
    laeuft = lambda o: umzug.belegt(o, einheiten=lambda: ["cypherdj-kern.service"])  # noqa: E731
    assert umzug.main(["pruefen", "--liste", liste(welt, "hoerprobe-w2"), "--ausfuehren"], belegt=laeuft) == 3
    assert baum(welt.alt("projekte") / "hoerprobe-w2") == vorher["hoerprobe-w2"]
    assert not (welt.heim / "pruefen" / "hoerprobe-w2").exists()


def test_pruefen_abbruch_wird_fortgesetzt(welt, capsys):
    vorher = projekte(welt, "hoerprobe-w2", "1-9-kit", "gruppen-probe")
    l = liste(welt, "hoerprobe-w2", "1-9-kit", "gruppen-probe")
    with pytest.raises(Abbruch):                                          # the crash comes after s3 of the second project
        umzug.main(["pruefen", "--liste", l, "--ausfuehren"], umbenennen=bricht(2, os.rename, danach=True), belegt=frei)
    assert not os.path.lexists(welt.alt("projekte") / "1-9-kit") and not (welt.heim / "pruefen" / "gruppen-probe").exists()
    capsys.readouterr()
    assert umzug.main(["pruefen", "--liste", l, "--ausfuehren"], belegt=frei) == 0
    berichte = {b["slug"]: b for b in map(json.loads, capsys.readouterr().out.splitlines())}
    assert (berichte["hoerprobe-w2"]["ergebnis"], berichte["1-9-kit"]["regel"], berichte["gruppen-probe"]["ergebnis"]) == ("nichts", "U2", "ok")
    for s in vorher:
        pruefe_im_pruefordner(welt, s, vorher[s])


def test_pruefen_nach_umzug_der_projekte(welt):
    vorher = projekte(welt, "hoerprobe-w2", "demo")
    assert umzug.ziehe_um("projekte", True, belegt=frei)["ergebnis"] == "ok"      # the project folder itself is a link now
    assert umzug.main(["pruefen", "--liste", liste(welt, "hoerprobe-w2"), "--ausfuehren"], belegt=frei) == 0
    neu = welt.heim / "pruefen" / "hoerprobe-w2"
    assert baum(neu) == vorher["hoerprobe-w2"]
    assert (welt.neu("projekte") / "hoerprobe-w2").is_symlink() and os.path.realpath(welt.alt("projekte") / "hoerprobe-w2") == str(neu)
    assert not (welt.neu("projekte") / "demo").is_symlink()


# ---- modulnamen: module folders get readable names -------------------------------------------------------------------------

MODUL_VEKTOREN = json.loads((HIER.parents[2] / "docs" / "interfaces" / "modul_ordner_namen.json").read_text(encoding="utf-8"))["vektoren"]


def lege_modul(basis: Path, ordner: str, id_: str, titel: str, slot=None) -> Path:
    d = basis / ordner
    (d / "audio").mkdir(parents=True)
    (d / "audio" / "x.wav").write_bytes(b"RIFF")
    j = {"format": 1, "id": id_, "gespeichert": "2026-11-16T10:00:00Z", "herkunft": {"titel": titel}, "gruppen": [{"name": titel}]}
    if slot:
        j["slot"] = slot
    (d / "modul.json").write_text(json.dumps(j), encoding="utf-8")
    return d


def test_modulnamen_wie_vektoren(welt, capsys):
    basis = welt.alt("module")
    for v in MODUL_VEKTOREN:
        lege_modul(basis, v["id"], v["id"], v["titel"], v["slot"])
    assert umzug.modul_ordnername("Pure and Simple", "A", "276617b78ebc7a9f") == "pure-and-simple-a-2766"
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=frei) == 0
    assert sorted(os.listdir(basis)) == sorted(v["erwartet"] for v in MODUL_VEKTOREN)
    for v in MODUL_VEKTOREN:
        assert umzug.modul_ordnername(v["titel"], v["slot"], v["id"]) == v["erwartet"]
        assert (basis / v["erwartet"] / "audio" / "x.wav").read_bytes() == b"RIFF"
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=frei) == 0          # second run: nothing to do
    assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["ergebnis"] == "nichts"
    assert sorted(os.listdir(basis)) == sorted(v["erwartet"] for v in MODUL_VEKTOREN)


def test_modulnamen_trockenlauf_aendert_nichts(welt, capsys):
    basis = welt.alt("module")
    lege_modul(basis, "276617b78ebc7a9f", "276617b78ebc7a9f", "Pure and Simple", "A")
    vorher = baum(basis)
    assert umzug.main(["modulnamen"], belegt=frei) == 0
    b = json.loads(capsys.readouterr().out)
    assert b["ergebnis"] == "ok" and b["ausgefuehrt"] is False
    assert b["umbenennungen"] == [{"von": "276617b78ebc7a9f", "nach": "pure-and-simple-a-2766"}]
    assert baum(basis) == vorher and not (welt.heim / ".umzug").exists()


def test_modulnamen_belegt_durch_einheit(welt, capsys):
    basis = welt.alt("module")
    lege_modul(basis, "276617b78ebc7a9f", "276617b78ebc7a9f", "Pure and Simple", "A")
    vorher = baum(basis)
    laeuft = lambda o: umzug.belegt(o, einheiten=lambda: ["cypherdj-oberflaeche.service"])  # noqa: E731
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=laeuft) == 3
    assert "einheit cypherdj-oberflaeche.service" in json.loads(capsys.readouterr().out)["grund"]
    assert baum(basis) == vorher


def test_modulnamen_gleicher_name_anderer_id_nimmt_acht_zeichen(welt):
    basis = welt.alt("module")
    lege_modul(basis, "aaaa111122223333", "aaaa111122223333", "Same", None)
    lege_modul(basis, "same-aaaa", "aaaa999988887777", "Same", None)           # holds another module under the wanted name
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=frei) == 0
    assert sorted(os.listdir(basis)) == ["same-aaaa", "same-aaaa1111"]


def test_modulnamen_laesst_fremde_ordner_stehen(welt):
    basis = welt.alt("module")
    lege_modul(basis, "umbenannt", "276617b78ebc7a9f", "Pure", "A")            # already renamed by hand
    (basis / "notizen").mkdir()
    lege_modul(basis, "bbbb111122223333", "cccc111122223333", "Odd", None)     # folder name and id disagree
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=frei) == 0
    assert sorted(os.listdir(basis)) == ["bbbb111122223333", "notizen", "umbenannt"]


def test_modulnamen_ohne_module_ist_nichts_zu_tun(welt, capsys):
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=frei) == 0
    assert json.loads(capsys.readouterr().out)["ergebnis"] == "nichts"


def test_modulnamen_heim_nicht_bereit(welt, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_HEIM", str(welt.tmp / "fehlt" / "cypherdj"))
    assert umzug.main(["modulnamen", "--ausfuehren"], belegt=frei) == 6


# ---- findings of the review of 2026-11-17: crash windows, cleanup, in-use check ----------------------------------------

def nur_inhalt(b: dict) -> dict:
    return {r: e[:3] for r, e in b.items()}


def test_fortsetzung_u5_absturz_vor_journal_kopiert(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    with pytest.raises(Abbruch):                                          # s3c happened, the journal still says "begonnen"
        umzug.ziehe_um("presets", True, umbenennen=bricht(1, os.rename, danach=True), geraet=welt.platten(), belegt=frei)
    assert journal("presets")["schritt"] == "begonnen" and welt.neu("presets").is_dir() and welt.alt("presets").is_dir()
    zweiter_lauf("presets", "U5", geraet=welt.platten())
    assert welt.alt("presets").is_symlink() and nur_inhalt(baum(welt.neu("presets"))) == nur_inhalt(vorher)
    assert umzug.zustand("presets") == "umgezogen" and reste(welt, "presets") == []


def test_fortsetzung_u6_absturz_vor_journal_verschoben(welt):
    fuelle(welt.alt("presets"))
    with pytest.raises(Abbruch):                                          # s4c happened: the old place is gone for the moment
        umzug.ziehe_um("presets", True, umbenennen=bricht(2, os.rename, danach=True), geraet=welt.platten(), belegt=frei)
    assert journal("presets")["schritt"] == "kopiert" and not os.path.lexists(welt.alt("presets"))
    zweiter_lauf("presets", "U6", geraet=welt.platten())
    assert welt.alt("presets").is_symlink() and (welt.alt("presets") / "a.txt").read_text() == "eins"
    assert umzug.zustand("presets") == "umgezogen"


def test_fortsetzung_z4_absturz_nach_r3(welt):
    vorher = umgezogen(welt)
    with pytest.raises(Abbruch):                                          # call 1 is r1, call 2 is r3: all is back, journal open
        umzug.zurueck("presets", True, umbenennen=bricht(2, os.rename, danach=True), belegt=frei)
    assert journal("presets")["schritt"] == "verschoben" and welt.alt("presets").is_dir() and not welt.alt("presets").is_symlink()
    b = umzug.zurueck("presets", True, belegt=frei)
    assert (b["regel"], b["ergebnis"]) == ("Z4", "ok")
    pruefe_zurueck(welt, "presets", vorher)
    assert umzug.ziehe_um("presets", True, belegt=frei)["ergebnis"] == "ok"   # not stuck: it moves again


def test_fortsetzung_z5_absturz_vor_beiseitestellen(welt):
    vorher = umgezogen(welt)
    with pytest.raises(Abbruch):                                          # copied back and renamed, the home copy still in place
        umzug.zurueck("presets", True, umbenennen=bricht(1, os.rename, danach=True), geraet=welt.platten(), belegt=frei)
    assert os.path.isdir(str(welt.alt("presets")) + umzug.ZURUECK) and welt.neu("presets").is_dir()
    b = umzug.zurueck("presets", True, geraet=welt.platten(), belegt=frei)
    assert (b["regel"], b["ergebnis"]) == ("Z5", "ok") and os.path.isdir(b["rest"])
    pruefe_zurueck(welt, "presets", vorher, mtime=False)


def test_fortsetzung_z5_abweichung(welt):
    umgezogen(welt)
    with pytest.raises(Abbruch):
        umzug.zurueck("presets", True, umbenennen=bricht(1, os.rename, danach=True), geraet=welt.platten(), belegt=frei)
    (welt.neu("presets") / "a.txt").write_text("zwei")                    # the new place went on: copy back again
    b = umzug.zurueck("presets", True, geraet=welt.platten(), belegt=frei)
    assert (b["regel"], b["ergebnis"]) == ("Z5", "ok") and b["verworfen"] == ["content differs: a.txt"]
    assert not welt.alt("presets").is_symlink() and (welt.alt("presets") / "a.txt").read_text() == "zwei"
    assert not welt.neu("presets").exists() and umzug.zustand("presets") == "alt" and reste(welt, "presets") == []


def test_u7_nennt_den_handgriff(welt, capsys):
    welt.heim.mkdir()
    setze_journal("presets", richtung="hin", schritt="begonnen")
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 4
    b = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert "Nothing was changed" in b["hinweis"] and str(welt.heim / ".umzug" / "presets.json") in b["hinweis"]


def ueber_platten_umgezogen(welt):
    fuelle(welt.alt("presets"))
    assert umzug.ziehe_um("presets", True, geraet=welt.platten(), belegt=frei)["ergebnis"] == "ok"
    return glob.glob(str(welt.alt("presets")) + umzug.ALTKOPIE + "*")[0]


@pytest.mark.parametrize("schaden, code", [
    (lambda w, kopie: (w.neu("presets") / "sub" / "b.bin").unlink(), 5),                  # a file is gone at the new place
    (lambda w, kopie: [p.unlink() for p in list(w.neu("presets").rglob("*")) if p.is_file() or p.is_symlink()], 5),
    (lambda w, kopie: (Path(kopie) / "spaeter.txt").write_text("written to the old copy after the move"), 5),
    (lambda w, kopie: (Path(kopie) / "a.txt").write_text("drei"), 5),                     # the old copy is not what was copied
    (lambda w, kopie: (w.heim / ".umzug" / "presets.manifest.json").unlink(), 4),         # no record: never delete blind
])
def test_aufraeumen_behaelt_die_alte_kopie(welt, schaden, code):
    kopie = ueber_platten_umgezogen(welt)
    schaden(welt, kopie)
    vorher = baum(kopie)
    b = umzug.aufraeumen("presets", True)
    assert (b["ergebnis"], b["code"]) == ("abgelehnt", code), b
    assert baum(kopie) == vorher


def test_aufraeumen_nach_weiterarbeit_am_neuen_ort(welt):
    kopie = ueber_platten_umgezogen(welt)
    p = welt.neu("presets") / "a.txt"
    p.write_text("weitergearbeitet")                                      # the new place moves on: that is no reason to keep
    spaeter = p.stat().st_mtime_ns + 60_000_000_000                       # in real use the edit is not in the second of the copy
    os.utime(p, ns=(spaeter, spaeter))
    (welt.neu("presets") / "neu.txt").write_text("neu")
    assert umzug.aufraeumen("presets", True)["ergebnis"] == "ok" and not os.path.exists(kopie)
    assert (welt.alt("presets") / "a.txt").read_text() == "weitergearbeitet"


def test_belegt_wird_vor_dem_wegstellen_erneut_gefragt(welt):
    vorher = baum(fuelle(welt.alt("presets")))
    rufe = {"n": 0}

    def spaeter_belegt(_o):                                               # the studio starts while the copy runs
        rufe["n"] += 1
        return [] if rufe["n"] == 1 else ["einheit cypherdj-kern.service"]
    b = umzug.ziehe_um("presets", True, geraet=welt.platten(), belegt=spaeter_belegt)
    assert (b["code"], rufe["n"]) == (3, 2) and baum(welt.alt("presets")) == vorher and not welt.alt("presets").is_symlink()
    assert journal("presets")["schritt"] == "kopiert"
    zweiter_lauf("presets", "U5", geraet=welt.platten())                  # later, with the studio stopped, it verifies again
    assert welt.alt("presets").is_symlink()


@pytest.mark.parametrize("lauf", ["fortsetzung", "zurueck"])
def test_belegt_gilt_auch_fuer_fortsetzung_und_zurueck(welt, lauf):
    laeuft = lambda o: ["einheit cypherdj-kern.service"]  # noqa: E731
    if lauf == "fortsetzung":
        fuelle(welt.alt("presets"))
        with pytest.raises(Abbruch):
            umzug.ziehe_um("presets", True, umbenennen=bricht(1, os.rename, danach=True), belegt=frei)
        b = umzug.ziehe_um("presets", True, belegt=laeuft)
        assert (b["regel"], b["code"]) == ("U2", 3) and not os.path.lexists(welt.alt("presets"))
    else:
        umgezogen(welt)
        b = umzug.zurueck("presets", True, belegt=laeuft)
        assert b["code"] == 3 and welt.alt("presets").is_symlink() and welt.neu("presets").is_dir()


def test_belegt_durch_offene_datei(welt):
    fuelle(welt.alt("presets"))
    p = subprocess.Popen(["sleep", "30"], stdin=open(welt.alt("presets") / "a.txt"), cwd="/")
    try:
        gruende = umzug.belegt(welt.alt("presets"), einheiten=lambda: [])
        assert gruende == [f"prozess {p.pid} sleep"]
    finally:
        p.kill()
        p.wait()


@pytest.mark.parametrize("antwort, erwartet", [
    (SimpleNamespace(returncode=0, stdout="cypherdj-kern.service loaded active running x\n", stderr=""), ["cypherdj-kern.service"]),
    (SimpleNamespace(returncode=0, stdout="", stderr=""), []),
    (SimpleNamespace(returncode=1, stdout="", stderr="Failed to connect to bus"), ["unknown (systemctl exit 1: Failed to connect to bus)"]),
    (subprocess.TimeoutExpired("systemctl", 10), ["unknown (systemctl: TimeoutExpired)"]),
    (FileNotFoundError("systemctl"), []),
])
def test_einheiten_unbekannt_heisst_belegt(monkeypatch, antwort, erwartet):
    def run(*a, **k):
        assert "--state=active,activating,reloading" in a[0]
        if isinstance(antwort, Exception):
            raise antwort
        return antwort
    monkeypatch.setattr(umzug.subprocess, "run", run)
    assert umzug.aktive_einheiten() == erwartet


def test_zweiter_lauf_gleichzeitig_abgelehnt(welt):
    import fcntl
    vorher = baum(fuelle(welt.alt("presets")))
    (welt.heim / ".umzug").mkdir(parents=True)
    with open(welt.heim / ".umzug" / "sperre", "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        b = umzug.ziehe_um("presets", True, belegt=frei)
    assert (b["code"], b["grund"]) == (3, "another djk-umzug run is working") and baum(welt.alt("presets")) == vorher
    assert umzug.ziehe_um("presets", True, belegt=frei)["ergebnis"] == "ok"


def test_sonderdatei_ueber_platten_abgelehnt(welt):
    fuelle(welt.alt("presets"))
    os.mkfifo(welt.alt("presets") / "rohr")
    b = umzug.ziehe_um("presets", True, geraet=welt.platten(), belegt=frei)
    assert b["code"] == 4 and "rohr" in b["grund"] and umzug.zustand("presets") == "alt" and reste(welt, "presets") == []
    assert umzug.ziehe_um("presets", True, belegt=frei)["ergebnis"] == "ok"   # the same disk moves it without copying


def test_kopierfehler_raeumt_auf(welt):
    vorher = baum(fuelle(welt.alt("presets")))

    def scheitert(quelle, ziel, **k):
        os.makedirs(ziel)
        raise OSError(28, "No space left on device")
    b = umzug.ziehe_um("presets", True, kopiere=scheitert, geraet=welt.platten(), belegt=frei)
    assert b["code"] == 1 and "No space left" in b["grund"]
    assert baum(welt.alt("presets")) == vorher and reste(welt, "presets") == [] and umzug.zustand("presets") == "alt"


def test_vergleich_sieht_links_und_ordner(welt):
    a, k = fuelle(welt.tmp / "a"), fuelle(welt.tmp / "k")
    assert umzug.vergleiche(str(a), str(k)) == []
    os.unlink(k / "verweis")
    os.symlink("sub/b.bin", k / "verweis")
    (k / "leer").mkdir()
    assert umzug.vergleiche(str(a), str(k)) == ["only in the copy: leer", "differs: verweis"]


def test_zurueck_ueber_platten_prueft_die_kopie(welt):
    import shutil
    umgezogen(welt)

    def kippt(quelle, ziel, **k):
        shutil.copytree(quelle, ziel, **k)
        (Path(ziel) / "a.txt").write_text("kaputt")
    b = umzug.zurueck("presets", True, kopiere=kippt, geraet=welt.platten(), belegt=frei)
    assert b["code"] == 5 and welt.alt("presets").is_symlink() and (welt.neu("presets") / "a.txt").read_text() == "eins"
    assert umzug.zustand("presets") == "umgezogen" and reste(welt, "presets") == []


def test_links_nach_aussen_werden_gemeldet(welt):
    fuelle(welt.alt("presets"))
    os.symlink("../nachbar/x", welt.alt("presets") / "raus")
    os.symlink("/absolut/bleibt", welt.alt("presets") / "fest")
    b = umzug.ziehe_um("presets", False, belegt=frei)
    assert b["links_nach_aussen"] == ["raus"]


def test_heim_als_toter_link_abgelehnt(welt, monkeypatch):
    os.symlink(welt.tmp / "platte-weg" / "heim", welt.tmp / "heimlink")
    monkeypatch.setenv("CYPHERDJ_HEIM", str(welt.tmp / "heimlink"))
    fuelle(welt.alt("presets"))
    assert umzug.main(["presets", "--ausfuehren"], belegt=frei) == 6
    assert umzug.main(["einrichten"]) == 6 and not (welt.tmp / "platte-weg").exists()


def test_pruefen_lehnt_umzugsreste_als_namen_ab(welt, capsys):
    projekte(welt, "a.umzug-link")
    assert umzug.main(["pruefen", "--liste", liste(welt, "a.umzug-link"), "--ausfuehren"], belegt=frei) == 4
    assert "not a project name" in json.loads(capsys.readouterr().out)["grund"]


# ---- second review round: an untouched but damaged file at the new place, a second crash inside a continuation ---------

def test_aufraeumen_behaelt_bei_beschaedigter_datei_am_neuen_ort(welt):
    kopie = ueber_platten_umgezogen(welt)
    p = welt.neu("presets") / "sub" / "b.bin"
    zeit = p.stat().st_mtime_ns
    p.write_bytes(b"")                                                    # same name, same mtime, no content: a silent write error
    os.utime(p, ns=(zeit, zeit))
    b = umzug.aufraeumen("presets", True)
    assert (b["ergebnis"], b["code"]) == ("abgelehnt", 5) and "sub/b.bin" in b["grund"] and os.path.isdir(kopie)


def test_zweiter_absturz_in_u6_findet_u2(welt):
    fuelle(welt.alt("presets"))
    with pytest.raises(Abbruch):                                          # first crash: right after s4c
        umzug.ziehe_um("presets", True, umbenennen=bricht(2, os.rename, danach=True), geraet=welt.platten(), belegt=frei)
    with pytest.raises(Abbruch):                                          # second crash: inside rule U6, the tmp link exists
        umzug.ziehe_um("presets", True, verlinke=bricht(1, os.symlink, danach=True), geraet=welt.platten(), belegt=frei)
    assert journal("presets")["schritt"] == "kopiert" and os.path.lexists(str(welt.alt("presets")) + umzug.LINK)
    zweiter_lauf("presets", "U2", geraet=welt.platten())
    assert welt.alt("presets").is_symlink() and umzug.zustand("presets") == "umgezogen" and reste(welt, "presets") == []


@pytest.mark.parametrize("stelle, regel", [(1, "Z2"), (2, "Z4")])
def test_zweiter_absturz_in_z1(welt, stelle, regel):
    vorher = umgezogen(welt)
    with pytest.raises(Abbruch):                                          # first crash: right after r1, journal "begonnen"
        umzug.zurueck("presets", True, umbenennen=bricht(1, os.rename, danach=True), belegt=frei)
    with pytest.raises(Abbruch):                                          # second crash inside Z1: before or after r3
        umzug.zurueck("presets", True, umbenennen=bricht(1, os.rename, danach=(stelle == 2)), belegt=frei)
    b = umzug.zurueck("presets", True, belegt=frei)
    assert (b["regel"], b["ergebnis"]) == (regel, "ok")
    pruefe_zurueck(welt, "presets", vorher)
