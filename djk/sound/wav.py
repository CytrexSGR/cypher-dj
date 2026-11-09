"""WAV lesen/schreiben ohne soundfile: liest PCM16/24/32 und float32 (auch WAVE_FORMAT_EXTENSIBLE), schreibt float32."""
import json, subprocess, warnings
from pathlib import Path
import numpy as np
from scipy.io import wavfile

TIMEOUT_S = 60      # gesetzt: ein hängendes ffmpeg soll als Lesefehler enden, nicht den Lauf blockieren

def _lies_ffmpeg(pfad) -> tuple[np.ndarray, int]:
    """Rückfall bei Header-Eigenheiten, an denen scipy scheitert. Original-Rate und -Kanalzahl, float32."""
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=channels,sample_rate", "-of", "json", str(pfad)], capture_output=True, text=True, timeout=TIMEOUT_S)
    try:
        s = json.loads(p.stdout)["streams"][0]
        ch, sr = int(s["channels"]), int(s["sample_rate"])
    except (ValueError, KeyError, IndexError):
        raise ValueError(f"keine lesbare Audiodatei: {pfad}") from None
    d = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(pfad), "-f", "f32le", "-"], capture_output=True, timeout=TIMEOUT_S)
    if d.returncode != 0 or not d.stdout:
        raise ValueError(f"ffmpeg konnte {pfad} nicht dekodieren: {d.stderr.decode(errors='replace')[:200]}")
    return np.frombuffer(d.stdout, dtype="<f4").reshape(-1, ch).copy(), sr

def lies(pfad) -> tuple[np.ndarray, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", wavfile.WavFileWarning)
            sr, x = wavfile.read(str(pfad))
    except Exception:
        return _lies_ffmpeg(pfad)
    if x.dtype == np.int16:
        x = x.astype(np.float32) / 32768.0
    elif x.dtype == np.int32:           # scipy liefert 24 bit als int32, linksbündig
        x = x.astype(np.float32) / 2147483648.0
    elif x.dtype == np.uint8:
        x = (x.astype(np.float32) - 128.0) / 128.0
    x = x.astype(np.float32)
    if x.ndim == 1:
        x = x[:, None]
    return x, int(sr)

def schreibe(pfad, x: np.ndarray, sr: int) -> None:
    Path(pfad).parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(pfad), sr, np.asarray(x, dtype=np.float32))
