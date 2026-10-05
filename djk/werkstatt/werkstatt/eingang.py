"""Schritt 1 der Kette (ADR 011 Entscheidung 2.1): dekodieren (ffmpeg, Float32, 48 kHz, Stereo) und
-12 dB Luft vor R3 (SCHNITTSTELLEN §2.1 `luft_db`; 08 NP K5: die Kommandozeile klemmt bei +-1,0 auch
mit --ignore-clipping, MFB bis +5,09 dBFS). Dazu der Klemm-Zaehler fuer das Ergebnis."""
import json
import subprocess
import numpy as np
import soundfile as sf

SR = 48000
LUFT_DB = -12.0
KLEMM_GRENZE = 0.99999      # wie rb_klemmt.py (08 NP K5): Samples an der Grenze +-1,0


def lade_stereo48(pfad):
    """(n, 2) float32 bei 48 kHz; Mono-Quellen werden verdoppelt."""
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(pfad), "-ac", "2", "-ar", str(SR),
           "-f", "f32le", "-"]
    roh = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(roh, dtype="<f4").reshape(-1, 2).copy()


def quelle_info(pfad):
    """sr, kanaele, dauer_s der gelieferten Datei (ffprobe, JSON)."""
    q = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                        "stream=sample_rate,channels:format=duration", "-of", "json", str(pfad)],
                       capture_output=True, text=True, check=True)
    d = json.loads(q.stdout)
    s = d["streams"][0]
    return {"sr": int(s["sample_rate"]), "kanaele": int(s["channels"]),
            "dauer_s": round(float(d["format"]["duration"]), 3)}


def luft(x, db=LUFT_DB):
    return (np.asarray(x, dtype=np.float32) * np.float32(10.0 ** (db / 20.0))).astype(np.float32)


def geklemmt(y, grenze=KLEMM_GRENZE):
    """Zahl der Samples an der Klemmgrenze (beide Kanaele zusammen)."""
    return int(np.count_nonzero(np.abs(y) >= grenze))


def spitze_dbfs(y):
    return round(float(20.0 * np.log10(np.abs(y).max() + 1e-12)), 2)


def schreibe_float_wav(x, pfad):
    sf.write(str(pfad), np.asarray(x, dtype=np.float32), SR, subtype="FLOAT")
