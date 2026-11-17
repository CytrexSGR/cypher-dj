"""quellen.toml: read, validate, write. Paths are invented."""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

import quellen
from quellen import Klang, Quellen, QuellenFehler, Wurzel

DJK = Path(__file__).resolve().parents[2]


def voll() -> Quellen:
    return Quellen(
        wurzeln=[
            Wurzel(name="Battery 4", art="oneshot", pfad="/data/audio/Battery 4 Samples", pfade={"laptop-a": "/home/u/My Samples"},
                   wechselplatte=False, katalog=False, regal=True, laufwerk="data",
                   mediathek={"ohne": ["a b", 'q"uote'], "pack_ordner": True, "ohne_endung": [".ogg"]}),
            Wurzel(name="Musik", art="track", pfad="/media/tester/Musik/01 MP3"),
            Wurzel(name="Nur Laptop", art="sample", pfade={"laptop-a": "/home/u/Loops"}),
        ],
        klang=[Klang("battery", "Battery 4", "Drums"), Klang("ganz", "Musik", "")],
        fern=[{"host": "laptop-b", "ssh": "tester@laptop-b", "wurzeln": [{"pfad": "~/musik", "typ": "erzeugt"}]}],
    )


def test_rundreise(tmp_path):
    p = tmp_path / "quellen.toml"
    assert quellen.schreibe(p, voll()) is True
    assert quellen.lies(p) == voll()
    assert quellen.schreibe(p, voll()) is False                    # unchanged: not written again
    assert quellen.lies(tmp_path / "fehlt.toml") == Quellen()


@pytest.mark.parametrize("aendern, feld", [
    (lambda q: q.wurzeln.append(Wurzel(name="Musik", art="track", pfad="/x")), 'wurzel "Musik": name is used twice'),
    (lambda q: setattr(q.wurzeln[1], "pfad", "relativ/pfad"), 'wurzel "Musik": pfad must be an absolute path'),
    (lambda q: setattr(q.wurzeln[1], "art", "lied"), 'wurzel "Musik": art must be one of'),
    (lambda q: setattr(q.wurzeln[1], "name", "a/b"), "name must have 1 to 40 characters and no '/'"),
    (lambda q: q.wurzeln[2].pfade.update({"laptop-a": "rel"}), 'wurzel "Nur Laptop": pfade.laptop-a must be an absolute path'),
    (lambda q: setattr(q.klang[0], "wurzel", "weg"), 'klang "battery": wurzel names no root'),
    (lambda q: setattr(q.klang[0], "rel", "../raus"), 'klang "battery": rel must be a relative path'),
])
def test_ungueltig_meldet_feld(tmp_path, aendern, feld):
    q = voll()
    aendern(q)
    with pytest.raises(QuellenFehler, match=re.escape(feld)):
        quellen.schreibe(tmp_path / "quellen.toml", q)
    # the same content read from a file names the file and the field
    p = tmp_path / "kaputt.toml"
    p.write_text(quellen.als_toml(q))
    with pytest.raises(QuellenFehler) as e:
        quellen.lies(p)
    assert feld in str(e.value) and str(p) in str(e.value)


def test_ungueltige_datei(tmp_path):
    p = tmp_path / "q.toml"
    p.write_text("schema = 2\n")
    with pytest.raises(QuellenFehler, match="schema must be 1"):
        quellen.lies(p)
    p.write_text("schema = 1\n[[wurzel]]\nname = 'a'\nart = 'track'\npfad = '/a'\nfarbe = 'rot'\n")
    with pytest.raises(QuellenFehler, match="unknown key farbe"):
        quellen.lies(p)
    p.write_text("schema = [")
    with pytest.raises(QuellenFehler):
        quellen.lies(p)


def test_leerzeichen_im_pfad(tmp_path):
    p = tmp_path / "mein heim" / "quellen.toml"
    p.parent.mkdir()
    q = Quellen(wurzeln=[Wurzel(name="Leer Zeichen", art="loop", pfad="/data/my loops/über 9000")])
    quellen.schreibe(p, q)
    assert quellen.lies(p).wurzeln[0].pfad == "/data/my loops/über 9000"


def test_schreibe_legt_heim_nicht_an(tmp_path):
    with pytest.raises(QuellenFehler, match="heim_nicht_bereit"):
        quellen.schreibe(tmp_path / "fehlt" / "quellen.toml", voll())
    assert not (tmp_path / "fehlt").exists()


def test_wurzel_ohne_pfad_fuer_rechner(tmp_path):
    (tmp_path / "heim").mkdir()
    quellen.schreibe(tmp_path / "heim" / "quellen.toml", voll())
    r = subprocess.run([sys.executable, "-m", "quellen", "zeige", "--json", "--host", "desktop-x"], cwd=DJK, capture_output=True,
                       text=True, env={"HOME": str(tmp_path), "CYPHERDJ_HEIM": str(tmp_path / "heim"), "PATH": "/usr/bin:/bin"}, check=False)
    assert r.returncode == 0, r.stderr
    w = {e["name"]: e for e in json.loads(r.stdout)["wurzeln"]}
    assert (w["Nur Laptop"]["pfad"], w["Nur Laptop"]["grund"]) == (None, "kein_pfad_fuer_rechner")
    assert w["Battery 4"]["pfad"] == "/data/audio/Battery 4 Samples" and "grund" not in w["Battery 4"]
    assert quellen.pfad_fuer(voll().wurzeln[0], "laptop-a") == "/home/u/My Samples"


def test_wechselplatte_nach_einhaengepunkt():
    f = quellen.ist_wechselplatte
    assert f(Wurzel("a", "track", pfad="/media/tester/Musik"), "h") is True
    assert f(Wurzel("b", "track", pfad="/run/media/tester/Stick/x"), "h") is True
    assert f(Wurzel("c", "track", pfad="/data/audio"), "h") is False
    assert f(Wurzel("d", "track", pfad="/media/tester/fest", wechselplatte=False), "h") is False
    assert f(Wurzel("e", "track", pfad="/data/nas", wechselplatte=True), "h") is True
    assert f(Wurzel("f", "track", pfad="/data/a", pfade={"laptop-a": "/media/u/a"}), "laptop-a") is True
