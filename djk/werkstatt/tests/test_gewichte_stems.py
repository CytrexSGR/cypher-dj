"""werkstatt.gewichte_stems: Gewichte von htdemucs aus einer lokalen Datei übernehmen, sha256 entscheidet (Slice 6, D3). Ohne Netz."""
import os

from werkstatt import gewichte_stems as g
from werkstatt.gewichte import sha256


def test_falsche_sha_bleibt_teil_und_kein_ziel(tmp_path):
    von = tmp_path / "x.th"; von.write_bytes(b"nicht die gewichte")
    ziel = tmp_path / "gewichte" / "htdemucs-955717e8.th"
    assert g.uebernimm(von, ziel, g.SHA256) == 2
    assert not ziel.exists()
    assert ziel.with_suffix(".teil").exists()                  # zur Ansicht, wie gewichte.py


def test_richtige_sha_landet_und_zweiter_lauf_kopiert_nicht(tmp_path):
    von = tmp_path / "x.th"; von.write_bytes(b"probe")
    soll = sha256(von)
    ziel = tmp_path / "gewichte" / "h.th"
    assert g.uebernimm(von, ziel, soll) == 0 and sha256(ziel) == soll
    t0 = os.stat(ziel).st_mtime_ns
    assert g.uebernimm(von, ziel, soll) == 0
    assert os.stat(ziel).st_mtime_ns == t0                     # VORHANDEN, nicht neu geschrieben


def test_main_vorhanden_ohne_netz(tmp_path, monkeypatch):
    ziel = tmp_path / "h.th"; ziel.write_bytes(b"probe")
    monkeypatch.setattr(g, "SHA256", sha256(ziel))
    def kein_netz(*a, **k):
        raise AssertionError("Netz trotz vorhandener Gewichte")
    monkeypatch.setattr(g, "groesse_im_netz", kein_netz)
    assert g.main(["--ziel", str(ziel)]) == 0                  # einrichten.sh zum zweiten Mal: kein Download, auch offline


def test_festgenagelt():
    assert g.SHA256 == "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
    assert g.GROESSE == 84141911
    assert g.URL.endswith("/hybrid_transformer/955717e8-8726e21a.th")
    assert g.ZIEL.name == "htdemucs-955717e8.th"
