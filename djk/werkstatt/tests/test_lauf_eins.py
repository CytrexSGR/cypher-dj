"""Bestand neu bewerten (lauf_eins): Handkorrekturen bleiben unveraendert, der Trockenlauf schreibt nichts."""
import json
import shutil

import numpy as np
import pytest

from klickhilfe import klick, sha_baum
from werkstatt import kette, lauf_eins
from werkstatt.bestand import korrektur_anhaengen, lies_json
from werkstatt.karte import Karte


@pytest.fixture
def bestand(tmp_path):
    """Zwei Materialien mit Eins 0 (aus der Wahrheits-Karte) im Bestand unter tmp_path."""
    b = tmp_path / "bestand"
    ids = []
    for n, bpm in enumerate((134.0, 130.0)):
        p = tmp_path / f"k{n}.wav"
        s = klick(p, bpm=bpm, dauer_s=16.0 + n)
        ids.append(kette.einlesen(p, b, karte=Karte(sekunden=s, beats=np.arange(len(s), dtype=float)))["material_id"])
    return b, ids, tmp_path


def baum(b):
    return {str(p.relative_to(b)): p.read_bytes() for p in sorted(b.rglob("*")) if p.is_file() and ".arbeit" not in p.parts}


KICK2 = {"anwendbar": True, "beat": 2, "lage": 2, "grund": "erster Kick bei Beat 2"}


def fake(monkeypatch, zaehlung, kick=KICK2, mehrheit=None):
    """beat_this/Kick ersetzen: Zaehlung der Lagen und Kick-Ergebnis fest."""
    monkeypatch.setattr(lauf_eins, "messe_stimmen", lambda mo, material, karte, geraet: (zaehlung, np.zeros(1), np.zeros(1)))
    monkeypatch.setattr(lauf_eins, "messe_kick", lambda mo, material, karte: kick)


def test_trockenlauf_listet_aenderung_und_schreibt_nichts(bestand, monkeypatch, tmp_path):
    b, ids, t = bestand
    fake(monkeypatch, [13, 0, 9, 0])                        # Mehrheit 0 (13/22 = 0,59), Kick sagt 2 -> Halbtakt
    vorher = baum(b)
    zeilen = lauf_eins.bewerte_bestand(b, raster_ordner=t / "leer", geraet="cpu")
    assert baum(b) == vorher                                # NEGATIV: Trockenlauf aendert keine Datei
    z = {r["mid"]: r for r in zeilen}
    assert all(r["alt"] == 0 and r["neu"] == 2 and r["aendert"] for r in z.values())
    assert z[ids[0]]["grund"].startswith("Anteil 0.59")


def test_handkorrektur_bleibt_unveraendert_raster_datei_ab_einem_beat(bestand, monkeypatch):
    b, ids, t = bestand
    fake(monkeypatch, [13, 0, 9, 0])
    ro = t / "raster"
    ro.mkdir()
    (ro / f"{ids[0]}_128000_r1.json").write_text(json.dumps({"versatz_frames": -45480}))     # -2 Beats -10 ms
    (ro / f"{ids[1]}_128000_r1.json").write_text(json.dumps({"versatz_frames": -480}))       # nur Feinversatz
    z = {r["mid"]: r for r in lauf_eins.bewerte_bestand(b, raster_ordner=ro, geraet="cpu")}
    assert z[ids[0]]["aendert"] is False and z[ids[0]]["status"] == "handkorrektur" and z[ids[0]]["neu"] == z[ids[0]]["alt"]
    assert z[ids[1]]["aendert"] is True                    # 10 ms Feinversatz ist keine Eins-Korrektur


def test_handkorrektur_eins_zeile_bleibt_unveraendert(bestand, monkeypatch):
    b, ids, t = bestand
    fake(monkeypatch, [13, 0, 9, 0])
    korrektur_anhaengen(b / ids[0], {"zeit": "2026-10-11T03:00:00", "von": "andreas", "art": "eins", "fassung": "128000_r1",
                                     "ab_quell_beat": 1.0, "bis_quell_beat": None, "versatz_ms": None, "nr": None, "text": "x"})
    z = {r["mid"]: r for r in lauf_eins.bewerte_bestand(b, raster_ordner=t / "leer", geraet="cpu")}
    assert z[ids[0]]["status"] == "handkorrektur" and z[ids[0]]["aendert"] is False
    assert z[ids[1]]["aendert"] is True


def test_klare_mehrheit_aendert_nichts(bestand, monkeypatch):
    b, ids, t = bestand
    fake(monkeypatch, [22, 0, 0, 0], kick={"anwendbar": True, "beat": 0, "lage": 0, "grund": "x"})
    zeilen = lauf_eins.bewerte_bestand(b, raster_ordner=t / "leer", geraet="cpu")
    assert not any(r["aendert"] for r in zeilen) and all(r["unsicher"] is False for r in zeilen)


def test_kick_einen_beat_daneben_bleibt_aber_unsicher(bestand, monkeypatch):
    b, ids, t = bestand
    fake(monkeypatch, [13, 0, 9, 0], kick={"anwendbar": True, "beat": 1, "lage": 1, "grund": "x"})
    zeilen = lauf_eins.bewerte_bestand(b, raster_ordner=t / "leer", geraet="cpu")
    assert not any(r["aendert"] for r in zeilen) and all(r["unsicher"] for r in zeilen)


def test_schreiben_haengt_nur_bei_aenderung_eine_eins_zeile_an_und_sichert_vorher(bestand, monkeypatch, tmp_path):
    b, ids, t = bestand
    fake(monkeypatch, [13, 0, 9, 0])
    # nur das erste Material aendert sich: das zweite hat Handkorrektur
    ro = t / "raster"
    ro.mkdir()
    (ro / f"{ids[1]}_128000_r1.json").write_text(json.dumps({"versatz_frames": -45000}))
    gerendert = []
    monkeypatch.setattr(lauf_eins, "rendere_neu", lambda mid, bestand: gerendert.append(mid))
    sich = tmp_path / "sicherung"
    zeilen = lauf_eins.bewerte_bestand(b, raster_ordner=ro, geraet="cpu")
    lauf_eins.schreibe(b, zeilen, sicherung=sich)
    z1 = lies_json(b / ids[0] / "material.json")
    ks = [json.loads(l) for l in (b / ids[0] / "korrekturen.jsonl").read_text().splitlines()]
    assert len(ks) == 1 and ks[0]["art"] == "eins" and ks[0]["ab_quell_beat"] == 2 and ks[0]["von"] == "werkstatt"
    assert (b / ids[1] / "korrekturen.jsonl").read_text() == ""            # Handkorrektur: nichts angehaengt
    assert gerendert == [ids[0]]
    assert (sich / "index.sqlite").is_file() and (sich / ids[0] / "korrekturen.jsonl").is_file()
    assert (sich / ids[0] / "material.json").read_bytes() == (b / ids[0] / "material.json").read_bytes()
    assert not (sich / ids[1]).exists()                                    # nur Betroffene gesichert
    assert z1["raster"]["erste_eins_quell_beat"] == 0                      # sealed material bleibt, die Eins kommt per Korrektur


def test_klare_mehrheit_gegen_kick_um_zwei_aendert_nichts_aber_unsicher(bestand, monkeypatch):
    """d976-Art: Anteil >= 0,85 und Kick widerspricht: Eins bleibt (kein Eingriff), die Liste markiert es."""
    b, ids, t = bestand
    fake(monkeypatch, [22, 0, 0, 0])                         # Kick-Lage 2 gegen Mehrheit 0
    zeilen = lauf_eins.bewerte_bestand(b, raster_ordner=t / "leer", geraet="cpu")
    assert not any(r["aendert"] for r in zeilen) and all(r["unsicher"] for r in zeilen)


def test_bewerten_schreibt_nur_seitendateien_nicht_in_material_oder_fassung(bestand, monkeypatch, tmp_path):
    """Review B2: eins_bewertung.json neben material.json; material.json, fassungen, korrekturen bleiben bitgleich;
    Handkorrekturen bekommen keine Datei."""
    b, ids, t = bestand
    fake(monkeypatch, [13, 0, 9, 0])
    ro = t / "raster"
    ro.mkdir()
    (ro / f"{ids[1]}_128000_r1.json").write_text(json.dumps({"versatz_frames": -45000}))
    vorher = baum(b)
    zeilen = lauf_eins.bewerte_bestand(b, raster_ordner=ro, geraet="cpu")
    sich = tmp_path / "s" / "sicherung"
    n = lauf_eins.schreibe_seitendateien(b, zeilen, sicherung=sich)
    assert n == 1
    nachher = baum(b)
    neu = {k for k in set(nachher) - set(vorher) if not k.startswith("index.sqlite-")}   # WAL-Nebendateien eines lesenden sqlite
    assert neu == {f"{ids[0]}/eins_bewertung.json"}
    assert all(nachher[k] == vorher[k] for k in vorher)                     # nichts Bestehendes geaendert
    d = json.loads(nachher[f"{ids[0]}/eins_bewertung.json"])
    assert d["eins_vorschlag"] == 2 and d["eins_material"] == 0 and d["quelle"] == "kick" and d["unsicher"] is False
    assert (sich / "index.sqlite").is_file()
