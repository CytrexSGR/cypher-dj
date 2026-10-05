import pytest
from werkstatt.tempo_wahl import waehle_vielfaches, tor_streckfaktor


@pytest.mark.parametrize("quell, v, faktor", [
    (124.860, 1.0, 1.025148),   # nightshift (c_drift.log)
    (89.905, 2.0, 0.711862),    # all-green: 128 / 179,81
    (180.709, 1.0, 0.708321),   # kannst-du-mich-lesen: Halbtempo waere 1,4166, weiter weg
    (96.0, 1.0, 1.333333),      # Gleichstand 1 gegen 2: 1 gewinnt
    (260.0, 0.5, 0.984615),     # Halbtempo
])
def test_vielfaches_nach_vertrag(quell, v, faktor):
    gv, gf = waehle_vielfaches(quell)
    assert gv == v
    assert gf == pytest.approx(faktor, abs=1e-6)


def test_tor_streckfaktor_grenze():
    assert tor_streckfaktor(1.025148)
    assert tor_streckfaktor(0.908800)
    assert tor_streckfaktor(1.15)
    assert tor_streckfaktor(1.19999)
    assert not tor_streckfaktor(1.2001)  # §2.1: 0,20 aus M19 (2026-09-25)
    assert not tor_streckfaktor(0.711862)


def test_negative_bpm_abgelehnt():
    with pytest.raises(ValueError):
        waehle_vielfaches(0.0)
