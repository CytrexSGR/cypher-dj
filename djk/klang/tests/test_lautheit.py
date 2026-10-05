import numpy as np
import pytest
from scipy import signal
from klang import lautheit, wav
from tests.hilfen import sinus, SR

def test_ebu3341_fall1_stereo_sinus_minus23():
    # EBU Tech 3341, Fall 1: Stereo-Sinus 1 kHz, −23 dBFS, 20 s → −23,0 LUFS ±0,1
    assert lautheit.integriert(sinus(1000, -23.0), SR) == pytest.approx(-23.0, abs=0.1)

def test_ebu3341_fall2_minus33():
    assert lautheit.integriert(sinus(1000, -33.0), SR) == pytest.approx(-33.0, abs=0.1)

def test_gating_ignoriert_stille():
    # 10 s Signal −23 + 10 s Stille: die Stille fällt hier schon am RELATIVEN Gate (nicht am absoluten;
    # das prüft test_absolutes_gate_wirft_alles_unter_minus70_raus) → weiter −23,0
    x = np.concatenate([sinus(1000, -23.0, 10), np.zeros((SR * 10, 2), np.float32)])
    assert lautheit.integriert(x, SR) == pytest.approx(-23.0, abs=0.1)

def test_true_peak_findet_zwischenwert():
    # fs/4-Sinus mit 45° Phase: jedes Sample liegt bei 0,707 (−3,01 dBFS), die Kurve erreicht 1,0 (0 dBTP)
    x = sinus(SR / 4, 0.0, 1.0, phase=np.pi / 4)
    assert lautheit.sample_spitze_db(x) == pytest.approx(-3.01, abs=0.05)
    assert lautheit.true_peak_db(x, SR) == pytest.approx(0.0, abs=0.3)

def test_true_peak_negativkontrolle_tiefer_sinus():
    x = sinus(100, -6.0, 1.0)
    assert lautheit.true_peak_db(x, SR) == pytest.approx(-6.0, abs=0.1)

def test_clip_zaehlt_nur_volle_samples():
    x = sinus(100, 0.0, 1.0) * 1.2
    assert lautheit.clips(np.clip(x, -1, 1)) > 0
    assert lautheit.clips(sinus(100, -1.0, 1.0)) == 0

def test_korrelation_mono_eins_gegenphase_minus_eins():
    x = sinus(440, -10, 1.0)
    assert lautheit.korrelation(x) == pytest.approx(1.0, abs=1e-3)
    y = x.copy(); y[:, 1] *= -1
    assert lautheit.korrelation(y) == pytest.approx(-1.0, abs=1e-3)

def test_bandbilanz_sinus_landet_im_richtigen_band():
    b = lautheit.baender_db(sinus(60, -10, 2.0), SR)
    assert max(b, key=b.get) == "sub"          # "sub" = 20–80 Hz
    b = lautheit.baender_db(sinus(5000, -10, 2.0), SR)
    assert max(b, key=b.get) == "praesenz"     # 2–6 kHz

def test_wav_rundreise_float32(tmp_path):
    x = sinus(440, -10, 0.5)
    p = tmp_path / "a.wav"
    wav.schreibe(p, x, SR)
    y, sr = wav.lies(p)
    assert sr == SR and y.shape == x.shape and np.array_equal(y, x)

def test_hochpass_stufe_30hz():
    # Orakel pyloudnorm 0.2.0, gemessen 2026-09-29: Meter(48000).integrated_loudness, Stereo-Sinus 30 Hz, −23 dBFS, 20 s.
    # Ohne die RLB-Hochpassstufe läge der Wert bei ≈ −23,7 (gemessen an Mutation M4), mit ihr bei ≈ −32,0.
    assert lautheit.integriert(sinus(30, -23.0), SR) == pytest.approx(-32.005624735935626, abs=0.1)

def test_relatives_gate_10s_minus23_plus_10s_minus38():
    # Orakel pyloudnorm 0.2.0, gemessen 2026-09-29: 10 s −23 dBFS + 10 s −38 dBFS (1 kHz, stereo).
    # Das relative Gate (−10 LU) schneidet den leisen Teil ab; ein Gate bei −20 LU ließe ihn mitzählen (−25,9).
    x = np.concatenate([sinus(1000, -23.0, 10), sinus(1000, -38.0, 10)])
    assert lautheit.integriert(x, SR) == pytest.approx(-23.09824745597186, abs=0.1)

def test_absolutes_gate_wirft_alles_unter_minus70_raus():
    # −80 dBFS-Sinus ≈ −80 LUFS < −70: kein Block übersteht das absolute Gate → -inf
    assert lautheit.integriert(sinus(1000, -80.0), SR) == float("-inf")

def test_true_peak_abseits_fs4_vierfach_trifft_referenz():
    # 16 kHz, Phase π/3: Sample-Spitze −1,25, 2× Überabtastung −1,06 (unterschätzt um 1,2 dB), 4× und 32× +0,13.
    x = sinus(16000, 0.0, 0.3, phase=np.pi / 3)
    ref = float(20 * np.log10(np.abs(signal.resample_poly(x.astype(np.float64), 32, 1, axis=0)).max()))
    zweifach = float(20 * np.log10(np.abs(signal.resample_poly(x.astype(np.float64), 2, 1, axis=0)).max()))
    assert ref - zweifach >= 0.5                       # Fall gilt: 2× wäre zu grob
    assert lautheit.true_peak_db(x, SR) == pytest.approx(ref, abs=0.2)


def test_true_peak_blockweise_gleich_ganz():
    # I1: 30 s, Spitze mitten im Signal (nicht am Blockrand), Ganz vs. blockweise ±0,01 dB
    x = sinus(997, -12.0, 30.0)
    x[int(SR * 12.3):int(SR * 12.3) + 40, :] *= 1.9
    ganz = float(20 * np.log10(np.abs(signal.resample_poly(x.astype(np.float64), 4, 1, axis=0)).max()))
    assert lautheit.true_peak_db(x, SR) == pytest.approx(ganz, abs=0.01)

def test_true_peak_spitze_genau_auf_blockgrenze():
    x = sinus(16000, -20.0, 25.0, phase=np.pi / 3)
    n = 10 * SR
    x[n - 2:n + 2] = 0.9 * np.array([[1, 1], [-1, -1], [1, 1], [-1, -1]], np.float32)
    ganz = float(20 * np.log10(np.abs(signal.resample_poly(x.astype(np.float64), 4, 1, axis=0)).max()))
    assert lautheit.true_peak_db(x, SR) == pytest.approx(ganz, abs=0.01)
