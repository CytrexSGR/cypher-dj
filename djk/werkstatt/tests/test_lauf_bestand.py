"""lauf_bestand --quelle ORDNER: rekursiv, AIFF und M4A/AAC dazu, Uebersprungenes gezaehlt und gemeldet,
Dauer und Last je Track im Bericht. Testdateien werden hier mit ffmpeg erzeugt (2 s Sinus), keine echten Tracks."""
import json
import subprocess

import pytest

from werkstatt import lauf_bestand as L
from werkstatt.eingang import lade_stereo48

SEK = 2.0
# Endung -> ffmpeg-Ausgabeoptionen
FORMATE = {"a.wav": [], "b.flac": [], "c.mp3": ["-c:a", "libmp3lame", "-b:a", "128k"],
           "sub/d.aiff": [], "sub/d2.aif": [], "sub/tief/e.m4a": ["-c:a", "aac", "-b:a", "128k"],
           "f.aac": ["-c:a", "aac", "-b:a", "128k"], "sub/tief/g.m4a": ["-c:a", "alac"]}


def erzeuge(pfad, opt, sek=SEK):
    pfad.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency=440:sample_rate=44100:duration={sek}", "-ac", "2", *opt, str(pfad)], check=True)


@pytest.fixture(scope="module")
def ordner(tmp_path_factory):
    q = tmp_path_factory.mktemp("quelle")
    for name, opt in FORMATE.items():
        erzeuge(q / name, opt)
    erzeuge(q / "sub" / "h.ogg", ["-c:a", "libvorbis"])        # gueltiges Audio, Format nicht unterstuetzt
    (q / "notizen.txt").write_text("keine Musik\n")
    (q / "sub" / "kaputt.m4a").write_bytes(b"\x00" * 4096)      # richtige Endung, nicht dekodierbar
    (q / ".versteckt.mp3").write_bytes(b"x")
    return q


def test_sammle_rekursiv_alle_formate(ordner):
    liste, weg = L.sammle(ordner)
    namen = sorted(p.relative_to(ordner).as_posix() for p, _, _ in liste)
    assert namen == sorted(FORMATE)
    for p, titel, dauer in liste:
        assert titel == p.relative_to(ordner).with_suffix("").as_posix()     # ohne Tags: relativer Pfad ohne Endung
        assert dauer == pytest.approx(SEK, abs=0.1), p


def test_uebersprungen_wird_gezaehlt_und_begruendet(ordner):
    """NEGATIV-KONTROLLE: nicht unterstuetztes Format (.ogg), Nicht-Audio und kaputte .m4a fallen nicht still."""
    _, weg = L.sammle(ordner)
    grund = {p.relative_to(ordner).as_posix(): g for p, g in weg}
    assert set(grund) == {"sub/h.ogg", "notizen.txt", "sub/kaputt.m4a", ".versteckt.mp3"}
    assert grund["sub/h.ogg"].startswith("unsupported format .ogg")
    assert grund["notizen.txt"].startswith("unsupported format .txt")
    assert grund["sub/kaputt.m4a"].startswith("not decodable")
    assert grund[".versteckt.mp3"] == "hidden file"


def test_nur_gueltiges_nichts_uebersprungen(tmp_path):
    """Harmloser Eingang: nur unterstuetzte, gueltige Dateien -> nichts uebersprungen."""
    erzeuge(tmp_path / "x.aiff", [])
    erzeuge(tmp_path / "y" / "z.m4a", ["-c:a", "aac"])
    liste, weg = L.sammle(tmp_path)
    assert len(liste) == 2 and weg == []


@pytest.mark.parametrize("name", ["sub/d.aiff", "sub/tief/e.m4a", "f.aac", "sub/tief/g.m4a"])
def test_neue_formate_dekodiert_die_kette(ordner, name):
    """Der Dekoder der Kette (ffmpeg, eingang.lade_stereo48) liest AIFF, M4A (AAC und ALAC) und AAC (ADTS)."""
    x = lade_stereo48(ordner / name)
    assert x.shape[1] == 2
    assert abs(x.shape[0] / 48000 - SEK) < 0.1
    assert abs(x).max() > 0.05                     # lavfi sine: Amplitude 1/8


def test_lauf_mit_quelle_meldet_dauer_last_und_uebersprungenes(ordner, tmp_path, monkeypatch, capsys):
    gesehen = []

    def falsch_einlesen(p, bestand, titel=None):
        gesehen.append(titel)
        if titel == "b":
            raise RuntimeError("kaputt im Test")
        return {"material_id": f"id-{titel}", "status": "neu"}

    monkeypatch.setattr(L, "einlesen", falsch_einlesen)
    berichte = tmp_path / "berichte"
    L.main(["--quelle", str(ordner), "--bestand", str(tmp_path / "bestand"), "--berichte", str(berichte),
            "--bericht", "probe"])
    assert "mfbass" not in gesehen                              # --quelle ersetzt samples/bestand samt Kontrolle
    assert sorted(gesehen) == sorted(n.rsplit(".", 1)[0] for n in FORMATE)
    j = json.loads((berichte / "probe.json").read_text())
    q = j["quelle"]
    assert q["ordner"] == str(ordner)
    assert q["gefunden"] == 8 and q["eingelesen"] == 7 and q["fehlgeschlagen"] == 1 and q["uebersprungen"] == 4
    assert {u["datei"] for u in q["uebersprungen_liste"]} == {"sub/h.ogg", "notizen.txt", "sub/kaputt.m4a",
                                                              ".versteckt.mp3"}
    t = {e["titel"]: e for e in q["tracks"]}
    assert t["b"]["status"] == "failed" and "kaputt im Test" in t["b"]["fehler"]
    for e in q["tracks"]:
        assert e["dauer_s"] == pytest.approx(SEK, abs=0.1)
        assert len(e["last_vor_nach"]) == 2 and e["sekunden"] >= 0
    md = (berichte / "probe.md").read_text()
    assert "Übersprungen: 4" in md and "sub/h.ogg" in md and "unsupported format .ogg" in md
    assert "Fehlgeschlagen: 1" in md
    assert "| sub/tief/e | `id-sub/tief/e` | neu |" in md                          # Zeile je Track mit Dauer und Last
    aus = capsys.readouterr().out
    assert "skipped 4" in aus and "failed 1" in aus


# --- Befunde der adversarialen Pruefung (2026-09-26) ---------------------------------------------------------------

@pytest.mark.parametrize("art", ["fehlt", "datei"])
def test_quelle_fehlt_oder_ist_datei_endet_mit_fehler(tmp_path, capsys, art):
    """FEHLERFALL Befund 1: --quelle auf einen fehlenden Pfad oder eine Datei war Erfolg mit "found 0"."""
    q = tmp_path / "gibt_es_nicht"
    if art == "datei":
        q = tmp_path / "lied.wav"
        erzeuge(q, [])
    berichte = tmp_path / "berichte"
    with pytest.raises(SystemExit) as ex:
        L.main(["--quelle", str(q), "--bestand", str(tmp_path / "bestand"), "--berichte", str(berichte)])
    assert ex.value.code not in (0, None)
    err = capsys.readouterr().err
    assert str(q) in err and ("does not exist" if art == "fehlt" else "not a folder") in err
    assert not berichte.exists()                                 # kein Bericht ueber einen Lauf, der nicht stattfand


def test_leere_quelle_ist_kein_fehler(tmp_path, capsys):
    """NEGATIV-KONTROLLE zu Befund 1: ein vorhandener, leerer Ordner ist ein gueltiger Lauf mit found 0."""
    (tmp_path / "leer").mkdir()
    rc = L.main(["--quelle", str(tmp_path / "leer"), "--bestand", str(tmp_path / "bestand"),
                 "--berichte", str(tmp_path / "berichte"), "--bericht", "probe"])
    assert rc == 0 and "found 0" in capsys.readouterr().out


def test_toter_symlink_wird_gemeldet(tmp_path):
    """FEHLERFALL Befund 2: ein toter Symlink mit unterstuetzter Endung fiel still weg. Gegenprobe im selben Ordner:
    ein lebender Symlink auf gueltiges Audio wird eingelesen."""
    erzeuge(tmp_path / "echt" / "a.wav", [])
    q = tmp_path / "q"
    q.mkdir()
    (q / "tot.mp3").symlink_to(tmp_path / "weg" / "nie.mp3")
    (q / "lebt.wav").symlink_to(tmp_path / "echt" / "a.wav")
    liste, weg = L.sammle(q)
    assert [p.name for p, _, _ in liste] == ["lebt.wav"]
    grund = {p.name: g for p, g in weg}
    assert set(grund) == {"tot.mp3"} and grund["tot.mp3"].startswith("broken symlink")
    assert str(tmp_path / "weg" / "nie.mp3") in grund["tot.mp3"]


def test_titel_eindeutig_aus_tags_sonst_relativer_pfad(tmp_path):
    """FEHLERFALL Befund 4: gleicher Dateiname in anderem Ordner oder mit anderer Endung gab gleichen Titel.
    Titel aus den Tags (Artist – Title), sonst relativer Pfad ohne Endung; bleibt es doppelt, mit Endung."""
    erzeuge(tmp_path / "a" / "lied.mp3", ["-c:a", "libmp3lame"])
    erzeuge(tmp_path / "b" / "lied.mp3", ["-c:a", "libmp3lame"])
    erzeuge(tmp_path / "b" / "lied.flac", [])
    erzeuge(tmp_path / "b" / "lied.wav", [])
    erzeuge(tmp_path / "c" / "getaggt.mp3", ["-c:a", "libmp3lame", "-metadata", "artist=Die Ärzte",
                                              "-metadata", "title=Schrei nach Liebe"])
    erzeuge(tmp_path / "c" / "nur_titel.flac", ["-metadata", "title=Ohne Künstler"])
    liste, weg = L.sammle(tmp_path)
    assert weg == []
    titel = {p.relative_to(tmp_path).as_posix(): t for p, t, _ in liste}
    assert titel == {"a/lied.mp3": "a/lied", "b/lied.mp3": "b/lied.mp3", "b/lied.flac": "b/lied.flac",
                     "b/lied.wav": "b/lied.wav", "c/getaggt.mp3": "Die Ärzte – Schrei nach Liebe",
                     "c/nur_titel.flac": "Ohne Künstler"}
    assert len(set(titel.values())) == len(titel)


def test_gleiche_tags_werden_unterschieden(tmp_path):
    """Zwei Dateien mit denselben Tags (derselbe Song in zwei Formaten) bekommen den Pfad angehaengt."""
    tags = ["-metadata", "artist=X", "-metadata", "title=Y"]
    erzeuge(tmp_path / "y.mp3", ["-c:a", "libmp3lame", *tags])
    erzeuge(tmp_path / "y.flac", tags)
    liste, _ = L.sammle(tmp_path)
    assert sorted(t for _, t, _ in liste) == ["X – Y (y.flac)", "X – Y (y.mp3)"]


def test_nur_passt_auf_titel_und_dateinamen(tmp_path, monkeypatch):
    """--nur trifft weiter den Dateinamen ohne Endung (wie vor Befund 4), dazu Titel und relativen Pfad."""
    erzeuge(tmp_path / "q" / "sub" / "eins.wav", [])
    erzeuge(tmp_path / "q" / "zwei.mp3", ["-c:a", "libmp3lame", "-metadata", "artist=A", "-metadata", "title=B"])
    erzeuge(tmp_path / "q" / "drei.wav", [])
    gesehen = []
    monkeypatch.setattr(L, "einlesen", lambda p, b, titel=None: gesehen.append(titel) or
                        {"material_id": "m-" + p.stem, "status": "neu"})
    L.main(["--quelle", str(tmp_path / "q"), "--bestand", str(tmp_path / "bestand"), "--nur", "eins,A – B",
            "--berichte", str(tmp_path / "berichte"), "--bericht", "probe"])
    assert sorted(gesehen) == ["A – B", "sub/eins"]
