import numpy as np
import soundfile as sf

from werkstatt.eingang import geklemmt, lade_stereo48, luft, quelle_info


def test_luft_ist_minus_12_db():
    y = luft(np.ones((4, 2), dtype=np.float32))
    assert y.dtype == np.float32
    assert np.allclose(y, 10 ** (-12 / 20), rtol=1e-6)


def test_geklemmt_zaehlt_nur_die_grenze():
    assert geklemmt(np.array([[0.5, 0.99999], [1.0, -1.0], [0.9999, -0.2]], dtype=np.float32)) == 3


def test_mono_44k1_wird_stereo_48k(tmp_path):
    t = np.arange(44100) / 44100
    sf.write(str(tmp_path / "m.wav"), (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 44100, subtype="FLOAT")
    x = lade_stereo48(tmp_path / "m.wav")
    assert x.shape == (48000, 2) and x.dtype == np.float32
    assert np.array_equal(x[:, 0], x[:, 1])
    assert quelle_info(tmp_path / "m.wav") == {"sr": 44100, "kanaele": 1, "dauer_s": 1.0}
