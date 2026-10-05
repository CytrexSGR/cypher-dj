"""analyse: Ordner → JSON-Zeilen, Datei bleibt unverändert (sha1 und mtime vorher = nachher)."""
import hashlib
import json
import os
import wave

import numpy as np
import pytest

pytest.importorskip("essentia.standard")
from tonart_energie import analyse  # noqa: E402

SR = 44100


def _wav(p, midis, dauer=12.0):
    z = np.arange(int(SR * dauer)) / SR
    x = sum(0.2 / h * np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * h * z) for m in midis for h in range(1, 5)) / 4
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def test_ordner_zu_json_und_datei_unveraendert(tmp_path, capsys):
    _wav(tmp_path / "a_moll.wav", [45, 57, 60, 64])
    (tmp_path / "notiz.txt").write_text("kein Audio")
    _wav(tmp_path / "kurz.wav", [45], dauer=2.0)
    vorher = {p.name: (hashlib.sha1(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns) for p in tmp_path.iterdir()}
    analyse.main([str(tmp_path), "--prozesse", "1"])
    zeilen = [json.loads(z) for z in capsys.readouterr().out.splitlines()]
    assert [os.path.basename(z["pfad"]) for z in zeilen] == ["a_moll.wav", "kurz.wav"]   # .txt übergangen
    a = zeilen[0]
    assert a["fehler"] is None and a["camelot"] == "8A" and 1 <= a["energie"] <= 10 and 0 <= a["konfidenz"] <= 1
    assert "zu kurz" in zeilen[1]["fehler"]
    nachher = {p.name: (hashlib.sha1(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns) for p in tmp_path.iterdir()}
    assert nachher == vorher                                           # nichts geschrieben, nichts dazugekommen
