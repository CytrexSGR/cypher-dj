import numpy as np
import pytest
from werkstatt.karte import Karte
from werkstatt.warp import ausduennen, frames_je_beat, timemap


def test_frames_je_beat_128_exakt():
    assert frames_je_beat(128.0) == 22500.0


def test_timemap_starrer_134er_klick():
    """konst134 aus b_timemap: Schlaege ab 0,25 s, Periode 60/134. Quell-Beat 0 landet bei 0,25 s * 134/128."""
    s = 0.25 + np.arange(134) * 60.0 / 134.0
    tm = timemap(Karte(sekunden=s, beats=np.arange(134.0)), 128.0, 2904000)
    assert tm.erster_schlag_frame == 12562            # 0,25 / (60/134) * 22500 = 12562,5 -> gerade gerundet
    assert tm.ziel_frames == 3040125                  # 2 904 000 * 134/128
    d = np.diff(tm.ziel)
    assert np.all(d[:-1] == 45000) and d[-1] == 22500  # Anker je 2 Ziel-Beats, der letzte immer
    assert tm.quelle[0] == 12000 and tm.ziel[-1] == 12562 + 133 * 22500


def test_ausduennen_haelt_ersten_und_letzten():
    z = np.arange(0, 11) * 22500
    assert list(ausduennen(z, 45000 - 0.5)) == [0, 2, 4, 6, 8, 10]
    assert list(ausduennen(z[:10], 45000 - 0.5)) == [0, 2, 4, 6, 8, 9]


def test_timemap_doppeltempo_nimmt_jeden_eintrag():
    s = 0.2 + np.arange(20) * 60.0 / 90.0
    tm = timemap(Karte(sekunden=s, beats=2.0 * np.arange(20), vielfaches=2.0), 128.0, 48000 * 20)
    assert len(tm.quelle) == 20


def test_timemap_lehnt_fallende_karte_ab():
    with pytest.raises(ValueError):
        timemap(Karte(sekunden=np.array([1.0, 0.5, 2.0]), beats=np.arange(3.0)), 128.0, 480000)
