"""Dekodieren und Tags ueber ffmpeg/ffprobe. Liest nur, schreibt nie in die Quelldatei."""
import json
import subprocess
import numpy as np


def lade_mono(pfad, sr=22050):
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(pfad), "-ac", "1", "-ar", str(sr),
           "-f", "f32le", "-"]
    roh = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(roh, dtype=np.float32).copy()


def lies_tags(pfad):
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=TBPM,TKEY,EnergyLevel",
           "-of", "json", str(pfad)]
    j = json.loads(subprocess.run(cmd, capture_output=True, check=True).stdout or b"{}")
    fmt = j.get("format", {})
    tags = {k.upper(): v for k, v in fmt.get("tags", {}).items()}

    def zahl(s):
        try:
            return float(str(s).replace(",", "."))
        except (TypeError, ValueError):
            return None
    return {"tbpm": zahl(tags.get("TBPM")), "tkey": tags.get("TKEY"),
            "energy": zahl(tags.get("ENERGYLEVEL")), "dauer_s": zahl(fmt.get("duration"))}
