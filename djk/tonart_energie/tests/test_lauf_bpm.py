"""lauf_bpm: misst BPM einer Datei (Plan 2026-10-10-bpm-nachtragen, T1)."""
import subprocess

from tonart_energie.lauf_bpm import miss


def test_klickspur_126(tmp_path):
    # 60 s Klick bei 126 BPM (kurzer 1-kHz-Ton je Schlag), als WAV über ffmpeg
    wav = tmp_path / "klick.wav"
    abstand = 60 / 126
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                    f"aevalsrc='if(lt(mod(t\\,{abstand:.6f})\\,0.03)\\,sin(2*PI*1000*t)\\,0)':s=44100:d=60",
                    str(wav)], check=True)
    r = miss(str(wav))
    assert abs(r["bpm"] - 126) <= 0.5, r
    assert abs(r["bpm_degara"] - 126) <= 0.5, r
    assert r["fehler"] is None


def test_fehlende_datei_ist_fehlerzeile(tmp_path):
    r = miss(str(tmp_path / "gibt-es-nicht.mp3"))
    assert r["fehler"] and r["bpm"] is None
