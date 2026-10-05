"""werkstatt.einzeln: genau eine Datei einlesen, am Ende EINE JSON-Zeile auf stdout, Logs auf stderr.
Echter Durchlauf an einem 12-s-Kick (170 BPM) im tmp-Bestand; die Fehlerfaelle brauchen keine Kette."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from werkstatt import einzeln

HIER = Path(__file__).resolve().parent.parent


def kick(pfad, bpm=170.0, dauer_s=12.0, sr=48000):
    n = int(dauer_s * sr)
    x = np.zeros(n)
    t = np.arange(int(0.25 * sr)) / sr
    k = 0.9 * np.sin(2 * np.pi * np.cumsum(50 + 100 * np.exp(-t / 0.03)) / sr) * np.exp(-t / 0.12)
    for s in np.arange(0, dauer_s, 60.0 / bpm):
        a = int(round(s * sr))
        e = min(n, a + len(k))
        x[a:e] += k[:e - a]
    sf.write(str(pfad), np.stack([x, x], 1).astype(np.float32), sr, subtype="FLOAT")


def lauf(*args):
    """Echter Prozess wie die Seite ihn startet; (rc, stdout, stderr)."""
    p = subprocess.run(["nice", "-n", "19", sys.executable, "-m", "werkstatt.einzeln", *map(str, args)],
                       cwd=HIER, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


@pytest.fixture(scope="module")
def echt(tmp_path_factory):
    d = tmp_path_factory.mktemp("echt")
    q = d / "kick170.wav"
    kick(q)
    b = d / "bestand"
    return q, b, lauf("--quelle", q, "--bestand", b, "--titel", "Test – Kick"), lauf("--quelle", q, "--bestand", b)


def eine_zeile(out):
    zeilen = out.splitlines()
    assert len(zeilen) == 1, out
    return json.loads(zeilen[0])


def test_neu_dann_vorhanden(echt):
    q, b, (rc1, o1, e1), (rc2, o2, e2) = echt
    j1, j2 = eine_zeile(o1), eine_zeile(o2)
    assert rc1 == 0 and j1["status"] == "neu" and "grund" not in j1
    assert len(j1["material_id"]) == 16 and int(j1["material_id"], 16) >= 0
    assert (b / j1["material_id"] / "material.json").exists()
    assert rc2 == 0 and j2 == {"status": "vorhanden", "material_id": j1["material_id"]}


def test_titel_landet_im_material(echt):
    q, b, (_, o1, _), _ = echt
    m = json.loads((b / eine_zeile(o1)["material_id"] / "material.json").read_text())
    assert m["titel"] == "Test – Kick"


def test_falsche_endung_ist_fehler_format(tmp_path):
    q = tmp_path / "a.ogg"
    q.write_bytes(b"x")
    rc, out, _ = lauf("--quelle", q, "--bestand", tmp_path / "b")
    j = eine_zeile(out)
    assert rc == 1 and j["status"] == "fehler" and j["grund"] == "format"
    assert not (tmp_path / "b").exists()


def test_fehlende_datei_ist_fehler_datei_fehlt(tmp_path):
    rc, out, _ = lauf("--quelle", tmp_path / "gibtsnicht.wav", "--bestand", tmp_path / "b")
    j = eine_zeile(out)
    assert rc == 1 and j["status"] == "fehler" and j["grund"] == "datei_fehlt"


def test_ausnahme_in_einlesen_wird_fehler_mit_typ(tmp_path, monkeypatch, capsys):
    q = tmp_path / "a.wav"
    q.write_bytes(b"x")

    def boese(*a, **k):
        raise ValueError("kaputt hier")
    monkeypatch.setattr(einzeln, "einlesen", boese)
    rc = einzeln.main(["--quelle", str(q), "--bestand", str(tmp_path / "b")])
    out = capsys.readouterr().out
    j = eine_zeile(out)
    assert rc == 1 and j["status"] == "fehler" and j["grund"] == "ValueError: kaputt hier"
    assert j["material_id"] == ""


def test_bestand_vorgabe_aus_umgebung(tmp_path, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_BESTAND", str(tmp_path / "env"))
    assert einzeln.main_bestand(None) == tmp_path / "env"
