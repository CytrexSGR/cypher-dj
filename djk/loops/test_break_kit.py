import json, struct, subprocess, sys, tempfile, wave
from pathlib import Path

HIER = Path(__file__).parent

def _wav(pfad: Path, sek: float):
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100)
        n = int(44100 * sek)
        w.writeframes(b"".join(struct.pack("<hh", (i % 200) * 50, -(i % 200) * 50) for i in range(n)))

def test_schreibt_kit_mit_48k_float_und_namen():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t); _wav(t / "a.wav", 1.71); _wav(t / "b.wav", 3.43)
        ziel = t / "rec-a"
        r = subprocess.run([sys.executable, str(HIER / "break_kit.py"), "--ziel", str(ziel),
                            f"brk140a={t/'a.wav'}", f"brk140b={t/'b.wav'}"], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        kit = json.loads((ziel / "kit.json").read_text())
        assert kit["schema"] == 1 and kit["name"] == "rec-a"
        namen = [k["name"] for k in kit["klaenge"]]
        assert namen == ["brk140a:0", "brk140b:0"]
        for k in kit["klaenge"]:
            groesse = (ziel / k["datei"]).stat().st_size
            assert groesse == k["frames"] * 8          # float32 × 2 Kanäle
        assert abs(kit["klaenge"][0]["frames"] - int(1.71 * 48000)) < 50

def test_behaelt_fremde_eintraege_und_ersetzt_gleichnamige():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t); _wav(t / "a.wav", 1.0); ziel = t / "rec-a"; ziel.mkdir()
        (ziel / "kit.json").write_text(json.dumps({"schema": 1, "name": "rec-a", "klaenge": [
            {"note": 112, "name": "rec0:0", "datei": "rec0_0.f32", "frames": 10, "quelle": "loop:x"}]}))
        for _ in range(2):
            r = subprocess.run([sys.executable, str(HIER / "break_kit.py"), "--ziel", str(ziel), f"brk140a={t/'a.wav'}"],
                               capture_output=True, text=True)
            assert r.returncode == 0, r.stderr
        kit = json.loads((ziel / "kit.json").read_text())
        assert [(k["name"], k["note"]) for k in kit["klaenge"]] == [("rec0:0", 112), ("brk140a:0", 113)]
        assert not (ziel / ".sperre").exists()

def test_lehnt_zu_lange_datei_ab():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t); _wav(t / "lang.wav", 11.0)
        r = subprocess.run([sys.executable, str(HIER / "break_kit.py"), "--ziel", str(t / "k"), f"lang={t/'lang.wav'}"],
                           capture_output=True, text=True)
        assert r.returncode == 2 and "10 s" in r.stderr
