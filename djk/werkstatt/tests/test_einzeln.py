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


def test_nur_analyse_ruft_einlesen_ohne_render_ohne_vorab_und_mit_eigener_auftrags_id(tmp_path, monkeypatch, capsys):
    q = tmp_path / "a.wav"
    q.write_bytes(b"x")
    gesehen = {}

    def falsch(quelle, bestand, **k):
        gesehen.update(k)
        gesehen["bestand"] = bestand
        return {"material_id": "0123456789abcdef", "status": "analysiert"}
    monkeypatch.setattr(einzeln, "einlesen", falsch)
    monkeypatch.setattr(einzeln, "standard_ablage", lambda: pytest.fail("bei --nur-analyse wird die Ablage nicht als vorab gelesen"))
    rc = einzeln.main(["--quelle", str(q), "--bestand", str(tmp_path / "ablage"), "--nur-analyse"])
    j = eine_zeile(capsys.readouterr().out)
    assert rc == 0 and j == {"status": "analysiert", "material_id": "0123456789abcdef"}
    assert gesehen["nur_analyse"] is True and gesehen["vorab"] is None
    assert gesehen["auftrag_id"] == "a-" + einzeln.sha256_datei(q)[:16], "eigener Arbeitsordner: nie e-<mid> (den nutzt der Nachtlauf)"
    assert gesehen["bestand"] == tmp_path / "ablage"


def test_ohne_nur_analyse_bleibt_alles_wie_vorher(tmp_path, monkeypatch, capsys):
    """Negativ-Kontrolle zum Test davor: ohne das Flag rendert der Einstieg wie bisher (vorab = Ablage, keine eigene Auftrags-ID, nur_analyse falsch)."""
    q = tmp_path / "a.wav"
    q.write_bytes(b"x")
    gesehen = {}

    def falsch(quelle, bestand, **k):
        gesehen.update(k)
        return {"material_id": "0123456789abcdef", "status": "neu"}
    monkeypatch.setattr(einzeln, "einlesen", falsch)
    monkeypatch.setattr(einzeln, "standard_ablage", lambda: tmp_path / "ablage-vorgabe")
    rc = einzeln.main(["--quelle", str(q), "--bestand", str(tmp_path / "bestand")])
    assert rc == 0 and eine_zeile(capsys.readouterr().out)["status"] == "neu"
    assert gesehen["nur_analyse"] is False and gesehen["vorab"] == tmp_path / "ablage-vorgabe" and gesehen["auftrag_id"] is None


def test_analysiert_zaehlt_als_erfolg_vorhanden_auch(tmp_path, monkeypatch, capsys):
    q = tmp_path / "a.wav"
    q.write_bytes(b"x")
    for status, rc_soll in (("analysiert", 0), ("vorhanden", 0), ("fehler", 1)):
        monkeypatch.setattr(einzeln, "einlesen", lambda *a, _s=status, **k: {"material_id": "0123456789abcdef", "status": _s})
        assert einzeln.main(["--quelle", str(q), "--bestand", str(tmp_path / "b"), "--nur-analyse"]) == rc_soll, status
        capsys.readouterr()


@pytest.fixture(scope="module")
def echt_analyse(tmp_path_factory):
    d = tmp_path_factory.mktemp("echt_analyse")
    q = d / "kick170.wav"
    kick(q)
    a = d / "ablage"
    return q, a, lauf("--quelle", q, "--bestand", a, "--nur-analyse"), lauf("--quelle", q, "--bestand", a, "--nur-analyse")


def test_nur_analyse_echt_schreibt_nur_die_analyse_dann_vorhanden(echt_analyse):
    """Echter Durchlauf an einem 12-s-Kick (170 BPM): zwei Dateien in der Ablage (material.json, vorab.json), keine Kopie der Quelle, keine Fassung; der zweite Aufruf meldet vorhanden."""
    q, a, (rc1, o1, _), (rc2, o2, _) = echt_analyse
    j1, j2 = eine_zeile(o1), eine_zeile(o2)
    assert rc1 == 0 and j1["status"] == "analysiert" and len(j1["material_id"]) == 16
    ordner = a / j1["material_id"]
    # tags.json schreibt kette.einlesen nur, wenn die Quelle Fremdtags trägt (kette.py:315-317); der synthetische Kick hat keine
    assert sorted(p.name for p in ordner.iterdir()) == ["material.json", "vorab.json"]
    m = json.loads((ordner / "material.json").read_text())
    assert m["quelle"]["sha256"].startswith(j1["material_id"]) and len(m["tempo_karte_quelle"]) > 8
    assert "raster" in m and "erste_eins_quell_beat" in m["raster"]
    assert rc2 == 0 and j2 == {"status": "vorhanden", "material_id": j1["material_id"]}
    assert not any(p.name.startswith("e-") for p in (a / ".arbeit").iterdir()) if (a / ".arbeit").exists() else True
