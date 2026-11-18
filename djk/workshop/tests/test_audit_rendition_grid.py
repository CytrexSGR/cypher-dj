"""Audit U41: a raster line (versatz_ms) was measured against the grid of the fassung it names; a tempo fassung on another basis
must shift the source by that, not by the basis being rendered."""
import numpy as np

from werkstatt import rendition as fassung
from werkstatt.map import Karte
from werkstatt.chain import wende_raster_an

from rendition_mock import BPM_QUELLE, bestand_mit, rendere_merken, zeile


def test_neue_fassung_150_verschiebt_um_die_basis_der_zeile(tmp_path, monkeypatch):
    """Line measured on 128000_r1: 10 ms late in the fassung = 10 ms * (60/134)/(60/128) in the source, whatever basis is rendered now."""
    b, mid, s = bestand_mit(tmp_path, [zeile(ab_quell_beat=64.0, bis_quell_beat=128.0, versatz_ms=10.0)])
    aufrufe = rendere_merken(monkeypatch)
    assert fassung.neue_fassung(b, mid, 150.0)["status"] == "neu"
    d = (aufrufe[0]["karte"].sekunden - s) * 1000.0
    assert np.allclose(d[64:128], 10.0 * 128.0 / BPM_QUELLE, atol=1e-6), d[64]
    assert np.all(d[:64] == 0.0) and np.all(d[128:] == 0.0)


def test_unter_128_gleicher_fehler_andere_richtung(tmp_path, monkeypatch):
    b, mid, s = bestand_mit(tmp_path, [zeile(ab_quell_beat=64.0, bis_quell_beat=128.0, versatz_ms=-30.0)])
    aufrufe = rendere_merken(monkeypatch)
    fassung.neue_fassung(b, mid, 120.0)
    d = (aufrufe[0]["karte"].sekunden - s) * 1000.0
    assert np.allclose(d[64:128], -30.0 * 128.0 / BPM_QUELLE, atol=1e-6)


def test_wende_raster_an_nimmt_die_basis_der_genannten_fassung():
    s = 0.25 + np.arange(200) * 60.0 / BPM_QUELLE
    k = wende_raster_an(Karte(sekunden=s, beats=np.arange(200.0)),
                        [zeile(fassung="132000_r1", ab_quell_beat=64.0, bis_quell_beat=128.0, versatz_ms=10.0)], 150.0)
    assert np.allclose((k.sekunden - s)[64:128] * 1000.0, 10.0 * 132.0 / BPM_QUELLE, atol=1e-9)


def test_unlesbarer_fassungsname_faellt_auf_die_gerenderte_basis_zurueck():
    """Negativ-Kontrolle: a line without a usable fassung name behaves as before (the basis passed in)."""
    s = 0.25 + np.arange(200) * 60.0 / BPM_QUELLE
    k = wende_raster_an(Karte(sekunden=s, beats=np.arange(200.0)),
                        [zeile(fassung="kaputt", ab_quell_beat=64.0, bis_quell_beat=128.0, versatz_ms=10.0)], 150.0)
    assert np.allclose((k.sekunden - s)[64:128] * 1000.0, 10.0 * 150.0 / BPM_QUELLE, atol=1e-9)
