"""Kit sources: ${CYPHERDJ_KLANG_<X>} resolves from the environment first, else from quellen.toml [[klang]]."""
import socket
from pathlib import Path

import pytest

from quellen import file as datei
from sound import candidates as kandidaten


@pytest.fixture
def quellen_datei(tmp_path, monkeypatch):
    # the conftest of this folder does not isolate the environment: do it here, nothing may touch the real home
    import os
    for name in [n for n in os.environ if n.startswith("CYPHERDJ_")]:
        monkeypatch.delenv(name)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setattr(socket, "gethostname", lambda: "laptop-a")
    heim = tmp_path / "home" / "cypherdj"
    heim.mkdir(parents=True)
    q = datei.Quellen(
        wurzeln=[datei.Wurzel(name="Kits", art="sample", pfade={"laptop-a": "/media/tester/Musik/Kit Ordner"},
                              katalog=False),
                 datei.Wurzel(name="Elsewhere", art="sample", pfade={"desktop": "/x"}, katalog=False)],
        klang=[datei.Klang(name="battery", wurzel="Kits", rel="Battery 4"),
               datei.Klang(name="maschine", wurzel="Kits", rel=""),
               datei.Klang(name="fern", wurzel="Elsewhere", rel="")])
    datei.schreibe(heim / "quellen.toml", q)
    return heim / "quellen.toml"


def test_klang_aus_quellen(quellen_datei):
    assert kandidaten._loese("${CYPHERDJ_KLANG_BATTERY}", "bd") == "/media/tester/Musik/Kit Ordner/Battery 4"
    assert kandidaten._loese("${CYPHERDJ_KLANG_MASCHINE}", "bd") == "/media/tester/Musik/Kit Ordner"


def test_umgebung_gewinnt(quellen_datei, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_KLANG_BATTERY", "/media/tester/anders")
    assert kandidaten._loese("${CYPHERDJ_KLANG_BATTERY}/x", "bd") == "/media/tester/anders/x"
    monkeypatch.setenv("CYPHERDJ_KLANG_BATTERY", "")                      # empty counts as unset
    assert kandidaten._loese("${CYPHERDJ_KLANG_BATTERY}", "bd").endswith("Battery 4")


def test_unbekannt_ohne_pfad_oder_ohne_datei_bleibt_fehler(quellen_datei):
    for name in ("CYPHERDJ_KLANG_FERN", "CYPHERDJ_KLANG_NIX"):
        with pytest.raises(kandidaten.KandidatenFehler, match=name):
            kandidaten._loese("${" + name + "}", "bd")
    quellen_datei.unlink()
    with pytest.raises(kandidaten.KandidatenFehler, match="CYPHERDJ_KLANG_BATTERY"):
        kandidaten._loese("${CYPHERDJ_KLANG_BATTERY}", "bd")
