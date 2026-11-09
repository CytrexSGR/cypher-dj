"""werkstatt.gewichte_stems: take the BS-RoFormer-SW weights from a local file, sha256 decides (plan 2026-11-06-stems-roformer-gpu). No network."""
import os

from werkstatt import weights_stems as g
from werkstatt.weights import sha256


def test_falsche_sha_bleibt_teil_und_kein_ziel(tmp_path):
    von = tmp_path / "x.th"; von.write_bytes(b"nicht die gewichte")
    ziel = tmp_path / "gewichte" / "BS-Rofo-SW-Fixed.ckpt"
    assert g.uebernimm(von, ziel, g.SHA256) == 2
    assert not ziel.exists()
    assert ziel.with_suffix(".teil").exists()                  # zur Ansicht, wie weights.py


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
    assert g.main(["--ziel", str(ziel)]) == 0                  # setup.sh zum zweiten Mal: kein Download, auch offline


def test_festgenagelt():
    assert g.SHA256 == "24e7d35ee9c64415673d3fd33e06a67cac2c103c5df6267ba1576459c775916e"
    assert g.GROESSE == 699412152
    assert g.URL.endswith("/BS-ROFO-SW-Fixed/resolve/main/BS-Rofo-SW-Fixed.ckpt")
    assert g.ZIEL.name == "BS-Rofo-SW-Fixed.ckpt"
