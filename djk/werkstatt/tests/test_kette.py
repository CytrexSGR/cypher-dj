"""Kette Ende zu Ende an einem kurzen synthetischen Klick (134 BPM, 24 s, Wahrheit bekannt) in einem Bestand unter
tmp_path. Braucht rubberband, ffmpeg, Essentia (venv) und die Schemas aus djk/vertrag/ (CYPHERDJ_VERTRAG)."""
import hashlib
import stat

import numpy as np
import pytest

from klickhilfe import klick, sha_baum
from werkstatt import kette
from werkstatt.bestand import lies_json
from werkstatt.index import zaehle
from werkstatt.karte import Karte
from werkstatt.vertrag import fehler


@pytest.fixture
def quelle(tmp_path):
    p = tmp_path / "klick134.wav"
    s = klick(p)
    return p, Karte(sekunden=s, beats=np.arange(len(s), dtype=float))


def test_einlesen_legt_material_und_r1_an(quelle, tmp_path):
    p, karte = quelle
    b = tmp_path / "bestand"
    e = kette.einlesen(p, b, karte=karte)
    assert e["status"] == "neu" and e["fassung"] == "128000_r1"
    mo = b / e["material_id"]
    assert sorted(x.name for x in mo.iterdir()) == ["fassungen", "korrekturen.jsonl", "material.json", "original.wav"]
    r1 = mo / "fassungen" / "128000_r1"
    assert sorted(x.name for x in r1.iterdir()) == ["basis.f32", "fassung.json"]
    f = lies_json(r1 / "fassung.json")
    m = lies_json(mo / "material.json")
    assert fehler("fassung.schema.json", f) == [] and fehler("material.schema.json", m) == []
    assert (r1 / "basis.f32").stat().st_size == f["frames"] * 2 * 4
    assert hashlib.sha256((r1 / "basis.f32").read_bytes()).hexdigest() == f["sha256"]
    assert f["korrekturen_bis_zeile"] == 0 and f["headroom_db"] == -12.0 and f["analyse_quelle"] == "basis"
    assert stat.S_IMODE((r1 / "basis.f32").stat().st_mode) == 0o444
    assert stat.S_IMODE(r1.stat().st_mode) == 0o555
    assert zaehle(b) == (1, 1)
    assert not any((b / ".arbeit").iterdir())
    assert e["messwerte"]["geklemmt"] == 0


def test_zweites_einlesen_aendert_nichts(quelle, tmp_path):
    """NEGATIV-KONTROLLE: dieselbe Quelle noch einmal -> 'vorhanden', kein Byte im Bestand anders."""
    p, karte = quelle
    b = tmp_path / "bestand"
    e = kette.einlesen(p, b, karte=karte)
    r1 = b / e["material_id"] / "fassungen" / "128000_r1"
    vorher = sha_baum(r1), sha_baum(b / e["material_id"])
    assert kette.einlesen(p, b, karte=karte) == {"material_id": e["material_id"], "status": "vorhanden"}
    assert (sha_baum(r1), sha_baum(b / e["material_id"])) == vorher
    assert zaehle(b) == (1, 1)


def test_abbruch_vor_veroeffentlichen_hinterlaesst_kein_material(quelle, tmp_path, monkeypatch):
    """FEHLERFALL: stirbt die Kette vor dem rename, gibt es kein halbes Material im Bestand; der naechste Lauf raeumt
    .arbeit/ auf und veroeffentlicht."""
    p, karte = quelle
    b = tmp_path / "bestand"

    def stirbt(*a, **k):
        raise RuntimeError("abgebrochen")

    monkeypatch.setattr(kette, "rename_ohne_ueberschreiben", stirbt)
    with pytest.raises(RuntimeError):
        kette.einlesen(p, b, karte=karte)
    assert [x.name for x in b.iterdir() if x.name != ".arbeit"] == []
    monkeypatch.undo()
    e = kette.einlesen(p, b, karte=karte)
    assert e["status"] == "neu" and zaehle(b) == (1, 1)
    assert not any((b / ".arbeit").iterdir())


# --- Befunde der adversarialen Pruefung (2026-09-26) ---------------------------------------------------------------

def test_gescheiterter_track_raeumt_arbeit_auf(quelle, tmp_path, monkeypatch):
    """FEHLERFALL Befund 3: scheitert die Kette nach der Kopie des Originals, blieb .arbeit/e-<id>/ mit der Kopie
    liegen, bis ein spaeterer Lauf derselben Quelle kam."""
    p, karte = quelle
    b = tmp_path / "bestand"

    def stirbt(*a, **k):
        raise RuntimeError("Lautheit kaputt im Test")

    monkeypatch.setattr(kette, "lautheit", stirbt)
    with pytest.raises(RuntimeError, match="Lautheit kaputt"):
        kette.einlesen(p, b, karte=karte)
    assert list((b / ".arbeit").iterdir()) == []
    assert [x.name for x in b.iterdir()] == [".arbeit"]


def _kick(pfad, bpm=170.0, dauer_s=16.0, sr=48000):
    """Kick, dessen erster Anschlag (Transient) auf Sample 0 beginnt; Raster wird mit beat_this gemessen."""
    import soundfile as sf
    n = int(dauer_s * sr)
    x = np.zeros(n)
    t = np.arange(int(0.25 * sr)) / sr
    k = 0.9 * np.sin(2 * np.pi * np.cumsum(50 + 100 * np.exp(-t / 0.03)) / sr) * np.exp(-t / 0.12)
    for s in np.arange(0, dauer_s, 60.0 / bpm):
        a = int(round(s * sr))
        e = min(n, a + len(k))
        x[a:e] += k[:e - a]
    sf.write(str(pfad), np.stack([x, x], 1).astype(np.float32), sr, subtype="FLOAT")


def test_erster_schlag_minus_8_ms_wird_auf_0_geklemmt(quelle, tmp_path, monkeypatch):
    """FEHLERFALL Befund 5: erster Schlag bei -8 ms (raster/karte bei Signal, das auf der Eins beginnt) liess
    material.json am Schema scheitern (tempo_karte_quelle/0/0 < 0). Jetzt: auf 0 geklemmt, als Warnung vermerkt."""
    p, karte = quelle
    liste = karte.als_liste()
    liste[0][0] = -0.008
    raster = kette.raster_aus_wahrheit(karte)
    raster.update({"werkzeug": "beat_this", "zweitwerkzeug": "essentia", "erster_schlag_quelle_s": -0.008})
    monkeypatch.setattr(kette, "raster_messen",
                        lambda q, g="cpu": (liste, dict(raster), {"eins_beat_this": 0}, []))
    b = tmp_path / "bestand"
    e = kette.einlesen(p, b)
    m = lies_json(b / e["material_id"] / "material.json")
    f = lies_json(b / e["material_id"] / "fassungen" / "128000_r1" / "fassung.json")
    assert m["tempo_karte_quelle"][0] == [0.0, 0.0] and m["raster"]["erster_schlag_quelle_s"] == 0.0
    assert m["tempo_karte_quelle"][1:] == liste[1:]
    assert fehler("material.schema.json", m) == [] and fehler("fassung.schema.json", f) == []
    assert any("auf 0 geklemmt" in w and "-8.0 ms" in w for w in f["warnungen"]), f["warnungen"]


def test_klick_mit_vorlauf_wird_nicht_geklemmt(quelle, tmp_path):
    """NEGATIV-KONTROLLE zu Befund 5: erster Schlag bei 0,25 s bleibt unberuehrt, keine Klemm-Warnung."""
    p, karte = quelle
    e = kette.einlesen(p, tmp_path / "bestand", karte=karte)
    mo = tmp_path / "bestand" / e["material_id"]
    assert lies_json(mo / "material.json")["tempo_karte_quelle"][0][0] == pytest.approx(0.25)
    assert not any("geklemmt" in w for w in lies_json(mo / "fassungen" / "128000_r1" / "fassung.json")["warnungen"])


def test_kick_ab_sample_0_mit_echtem_raster(tmp_path):
    """Befund 5 am gemessenen Raster: Kick ab Sample 0, 170 BPM; beat_this/Karte legt den ersten Schlag hier
    knapp vor 0 (gemessen 2026-09-26: -0,058 ms). Die Kette muss das Material trotzdem schemagerecht anlegen."""
    p = tmp_path / "kick170.wav"
    _kick(p)
    b = tmp_path / "bestand"
    e = kette.einlesen(p, b)
    m = lies_json(b / e["material_id"] / "material.json")
    assert e["status"] == "neu" and fehler("material.schema.json", m) == []
    assert m["tempo_karte_quelle"][0][0] >= 0 and m["raster"]["erster_schlag_quelle_s"] >= 0


# --- Fremdtags (Mixed In Key/Beatport): tags.json neben material.json --------------------------------------------

def test_fremdtags_landen_in_tags_json(quelle, tmp_path):
    """Traegt die Quelle ID3-Fremdtags (TKEY, EnergyLevel, TBPM, Artist/Title/Album), schreibt die Kette sie in
    tags.json neben material.json; material.json und das eigene, audio-gemessene `tonart`-Feld bleiben davon
    unberuehrt (die Werkzeuge sind unabhaengig von den Tags)."""
    import subprocess
    p, karte = quelle
    mp3 = tmp_path / "klick134_getaggt.mp3"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(p), "-metadata", "TKEY=5A",
                    "-metadata", "TBPM=134", "-metadata", "EnergyLevel=7", "-metadata", "artist=Test Artist",
                    "-metadata", "title=Test Title", "-metadata", "album=Test Album", "-codec:a", "libmp3lame",
                    "-b:a", "192k", "-id3v2_version", "3", str(mp3)], check=True)
    b = tmp_path / "bestand"
    e = kette.einlesen(mp3, b, karte=karte)
    mo = b / e["material_id"]
    assert (mo / "tags.json").is_file()
    tags = lies_json(mo / "tags.json")
    assert tags["tkey"] == "5A" and tags["notenname"] == "C-Moll" and tags["energie"] == 7
    assert tags["artist"] == "Test Artist" and tags["titel"] == "Test Title" and tags["album"] == "Test Album"
    assert tags["tag_bpm"] == pytest.approx(134.0)
    assert tags["tag_bpm_abweichung_prozent"] is not None and abs(tags["tag_bpm_abweichung_prozent"]) < 5.0
    m = lies_json(mo / "material.json")
    assert "tags" not in m and set(m["tonart"]) == {"camelot", "r", "vorsprung", "stimmung_cent", "stimmung_r",
                                                      "stimmung_cent_zweitwerkzeug", "aus_stems"}  # unveraendert
    assert stat.S_IMODE((mo / "tags.json").stat().st_mode) == 0o444


def test_ohne_fremdtags_kein_tags_json(quelle, tmp_path):
    """NEGATIV-KONTROLLE: die Standard-Quelle (klick134.wav, keine ID3-Tags) legt kein tags.json an; die
    bestehende Dateiliste der Kette (test_einlesen_legt_material_und_r1_an) bleibt unveraendert."""
    p, karte = quelle
    b = tmp_path / "bestand"
    e = kette.einlesen(p, b, karte=karte)
    mo = b / e["material_id"]
    assert not (mo / "tags.json").exists()
    f = lies_json(mo / "fassungen" / "128000_r1" / "fassung.json")
    assert any("keine Fremdtags gefunden" in w for w in f["warnungen"]), f["warnungen"]
