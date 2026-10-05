"""Fremdtags von Mixed In Key/Beatport (TKEY, EnergyLevel/Kommentar, TBPM, Artist/Title/Album), gelesen ueber
ffprobe. Testdateien werden hier mit ffmpeg erzeugt (Stille, 1 s), kein echtes Audio noetig."""
import subprocess

import pytest

from werkstatt import fremdtags as F


def erzeuge(pfad, meta=(), sek=1.0):
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
           f"anullsrc=r=44100:channel_layout=stereo", "-t", str(sek)]
    for k, v in meta:
        cmd += ["-metadata", f"{k}={v}"]
    cmd += ["-codec:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3", str(pfad)]
    subprocess.run(cmd, check=True)


# --- Camelot -> Notenname, an den vier vorgegebenen Faellen ---------------------------------------------------

@pytest.mark.parametrize("camelot,erwartet", [("8A", "A-Moll"), ("8B", "C-Dur"), ("5A", "C-Moll"), ("12B", "E-Dur")])
def test_camelot_zu_notenname_vier_faelle(camelot, erwartet):
    assert F.camelot_zu_notenname(camelot) == erwartet


def test_camelot_zu_notenname_unbekannter_code():
    assert F.camelot_zu_notenname("13A") is None
    assert F.camelot_zu_notenname("???") is None


# --- Fehlerfall 1: volles Tag-Set ------------------------------------------------------------------------------

def test_volles_tag_set(tmp_path):
    p = tmp_path / "voll.mp3"
    erzeuge(p, [("TKEY", "5A"), ("TBPM", "128"), ("artist", "Test Artist"), ("title", "Test Title"),
                ("album", "Test Album"), ("EnergyLevel", "7")])
    t = F.lese_tags(p)
    assert t["tkey"] == "5A" and t["notenname"] == "C-Moll" and t["energie"] == 7
    assert t["tag_bpm"] == pytest.approx(128.0)
    assert t["artist"] == "Test Artist" and t["titel"] == "Test Title" and t["album"] == "Test Album"
    assert t["warnungen"] == []


# --- Fehlerfall 2 / NEGATIV-KONTROLLE: keine Tags --------------------------------------------------------------

def test_keine_tags_negativkontrolle(tmp_path):
    p = tmp_path / "leer.mp3"
    erzeuge(p, [])
    t = F.lese_tags(p)
    assert t["tkey"] is None and t["notenname"] is None and t["energie"] is None and t["tag_bpm"] is None
    assert t["artist"] is None and t["titel"] is None and t["album"] is None
    assert t["warnungen"] == ["keine Fremdtags gefunden (TKEY, EnergyLevel/Kommentar, TBPM, Artist, Title, Album)"]


# --- Fehlerfall 3: nur Kommentar-Tag, kein separates EnergyLevel-Feld -------------------------------------------

def test_nur_kommentar_ergibt_tonart_und_energie(tmp_path):
    p = tmp_path / "kommentar.mp3"
    erzeuge(p, [("comment", "5A - 7")])
    t = F.lese_tags(p)
    assert t["tkey"] == "5A" and t["notenname"] == "C-Moll" and t["energie"] == 7
    assert t["warnungen"] == []


def test_kommentar_ohne_treffer_bleibt_leer(tmp_path):
    """NEGATIV-KONTROLLE zu Fall 3: ein Kommentar, der nicht dem Muster 'Tonart - Energie' folgt, liefert nichts."""
    p = tmp_path / "kommentar_frei.mp3"
    erzeuge(p, [("comment", "gemischt, viel Bass")])
    t = F.lese_tags(p)
    assert t["tkey"] is None and t["energie"] is None
    assert t["warnungen"] == ["keine Fremdtags gefunden (TKEY, EnergyLevel/Kommentar, TBPM, Artist, Title, Album)"]


# --- Fehlerfall 4: kaputte Tag-Werte -----------------------------------------------------------------------------

def test_kaputte_tags_bleiben_leer_mit_warnung(tmp_path):
    p = tmp_path / "kaputt.mp3"
    erzeuge(p, [("TKEY", "???"), ("TBPM", "abc")])
    t = F.lese_tags(p)
    assert t["tkey"] is None and t["notenname"] is None and t["tag_bpm"] is None
    assert any("TKEY-Tag ungueltig" in w for w in t["warnungen"]), t["warnungen"]
    assert any("TBPM-Tag ungueltig" in w for w in t["warnungen"]), t["warnungen"]


def test_energylevel_ausserhalb_bereich_bleibt_leer_mit_warnung(tmp_path):
    p = tmp_path / "energie_kaputt.mp3"
    erzeuge(p, [("EnergyLevel", "23")])
    t = F.lese_tags(p)
    assert t["energie"] is None
    assert any("ausserhalb 1-10" in w for w in t["warnungen"]), t["warnungen"]


def test_eigenes_feld_geht_vor_kommentar(tmp_path):
    """Steht sowohl EnergyLevel als auch ein abweichender Kommentar da, gewinnt das eigene Feld (Schritt 3:
    'bevorzugt aus eigenem ID3-Feld')."""
    p = tmp_path / "beides.mp3"
    erzeuge(p, [("TKEY", "9A"), ("EnergyLevel", "3"), ("comment", "5A - 7")])
    t = F.lese_tags(p)
    assert t["tkey"] == "9A" and t["energie"] == 3


# --- Doppelt kodiertes UTF-8 im Tag (Beatport-Datei 'Jesper DahlbÃ¤ck', gefunden 2026-09-27 im Bestand) --------
def test_doppelt_kodierter_titel_wird_repariert(tmp_path):
    p = tmp_path / "moji.mp3"
    erzeuge(p, [("artist", "Alan Fitzpatrick"), ("title", "Paranoize - Adam Beyer & Jesper DahlbÃ¤ck Remix")])
    assert F.lese_tags(p)["titel"] == "Paranoize - Adam Beyer & Jesper Dahlbäck Remix"


def test_echte_umlaute_und_echtes_A_tilde_bleiben():
    assert F.repariere_text("Jesper Dahlbäck") == "Jesper Dahlbäck"   # Negativ-Kontrolle: schon richtig
    assert F.repariere_text("SÃO PAULO") == "SÃO PAULO"               # kein gültiges UTF-8 darunter
    assert F.repariere_text("Plain ASCII") == "Plain ASCII"
    assert F.repariere_text(None) is None
    # zusammengesetzter Titel mit unserem Gedankenstrich (nicht Latin-1): der Rest wird trotzdem repariert
    assert F.repariere_text("Alan Fitzpatrick – Jesper DahlbÃ¤ck Remix") == "Alan Fitzpatrick – Jesper Dahlbäck Remix"
