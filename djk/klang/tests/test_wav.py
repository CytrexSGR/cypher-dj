import json, os, subprocess
from pathlib import Path
import numpy as np
import pytest
from klang import wav

_MASCHINE = os.environ.get("CYPHERDJ_KLANG_MASCHINE")
CLAP = Path(_MASCHINE or "/nicht/gesetzt") / "Clap" / "Clap ChrisLiebing.wav"

@pytest.mark.skipif(not _MASCHINE, reason="CYPHERDJ_KLANG_MASCHINE nicht gesetzt")
@pytest.mark.skipif(not CLAP.exists(), reason=f"Bestand nicht gemountet: {CLAP}")
def test_liebing_clap_liest():
    x, sr = wav.lies(CLAP)
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                                   "stream=duration,sample_rate", "-of", "json", str(CLAP)],
                                  capture_output=True, text=True, check=True).stdout)["streams"][0]
    assert sr == int(j["sample_rate"]) and x.ndim == 2 and x.shape[0] > 0
    assert abs(x.shape[0] / sr - float(j["duration"])) < 0.01
    assert np.abs(x).max() > 0.01

def test_24bit_mit_zusatzchunk(tmp_path):
    p = tmp_path / "a.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.5",
                    "-af", "volume=4", "-c:a", "pcm_s24le", "-write_bext", "1", str(p)], check=True)
    x, sr = wav.lies(p)
    assert sr == 44100 and x.shape[1] == 1 and abs(x.shape[0] - 22050) <= 2
    assert abs(np.abs(x).max() - 0.5) < 1e-3     # lavfi sine hat Amplitude 1/8, mal 4

def test_muell_wirft(tmp_path):
    p = tmp_path / "m.wav"
    p.write_bytes(b"das ist keine wav datei" * 10)
    with pytest.raises(Exception):
        wav.lies(p)

def _roh_wav(pfad, daten: bytes, bits=24, kanaele=1, sr=44100, vor_data=b"", data_laenge=None):
    ba = kanaele * bits // 8
    fmt = b"fmt " + (16).to_bytes(4, "little") + (1).to_bytes(2, "little") + kanaele.to_bytes(2, "little") + \
          sr.to_bytes(4, "little") + (sr * ba).to_bytes(4, "little") + ba.to_bytes(2, "little") + bits.to_bytes(2, "little")
    dl = len(daten) if data_laenge is None else data_laenge
    body = b"WAVE" + fmt + vor_data + b"data" + dl.to_bytes(4, "little") + daten
    Path(pfad).write_bytes(b"RIFF" + len(body).to_bytes(4, "little") + body)

def _pcm24(x):
    v = np.round(x * 8388607).astype(np.int32)
    return b"".join(int(i).to_bytes(3, "little", signed=True) for i in v)

def test_datenchunk_kein_vielfaches_der_blockgroesse(tmp_path):
    from scipy.io import wavfile
    p = tmp_path / "k.wav"
    t = np.arange(4410) / 44100
    _roh_wav(p, _pcm24(0.5 * np.sin(2 * np.pi * 440 * t)) + b"\x00", bits=24)     # 13231 Bytes, nicht durch 3 teilbar
    with pytest.raises(Exception):
        wavfile.read(str(p))                    # Vorbedingung: so scheiterte der Liebing-Clap
    x, sr = wav.lies(p)                         # -> ffmpeg-Rückfall
    assert sr == 44100 and x.shape[1] == 1 and abs(x.shape[0] - 4410) <= 2
    assert abs(np.abs(x).max() - 0.5) < 1e-3

def test_wavfilewarning_unterdrueckt(tmp_path, recwarn, monkeypatch):
    from scipy.io import wavfile
    p = tmp_path / "w.wav"
    _roh_wav(p, np.zeros(200, np.int16).tobytes(), bits=16, vor_data=b"abcd" + (4).to_bytes(4, "little") + b"xxxx")
    with pytest.warns(wavfile.WavFileWarning):
        wavfile.read(str(p))                    # Vorbedingung: scipy warnt bei dieser Datei
    recwarn.clear()
    monkeypatch.setattr(wav, "_lies_ffmpeg", lambda *_: pytest.fail("scipy-Pfad erwartet"))
    x, sr = wav.lies(p)
    assert x.shape == (200, 1) and not recwarn.list

def test_ffmpeg_timeout_ist_lesefehler(tmp_path, monkeypatch):
    import subprocess
    p = tmp_path / "t.wav"
    p.write_bytes(b"kein wav")
    gesehen = {}
    def haengt(cmd, **kw):
        gesehen["timeout"] = kw.get("timeout")
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))
    monkeypatch.setattr(wav.subprocess, "run", haengt)
    with pytest.raises(subprocess.TimeoutExpired):
        wav.lies(p)
    assert gesehen["timeout"] == 60
