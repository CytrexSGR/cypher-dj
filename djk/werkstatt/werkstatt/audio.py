"""Dekodieren ueber ffmpeg (wie proben/07-werkstatt-zerleger/c_drift.py `lade`): mono, float32."""
import subprocess
import numpy as np


def lade_mono(pfad, sr):
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(pfad), "-ac", "1", "-ar", str(sr),
           "-f", "f32le", "-"]
    roh = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(roh, dtype=np.float32).copy()
