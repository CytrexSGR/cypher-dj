"""Tor `eins` und Eins-Entscheidung in der Kette (2026-10-11, Bericht grid-phase): das Tor urteilt auf Anteil und Kick,
nicht mehr auf den Tief-Band-Gleichstand; `unsicher` steht in fassung.json und erreicht die Seite."""
import numpy as np
import pytest
import soundfile as sf

from klickhilfe import klick
from werkstatt import kette, lauf_raster
from werkstatt.bestand import korrektur_anhaengen, lies_json
from werkstatt.karte import Karte
from werkstatt.vertrag import fehler

LAUT = {"echtspitze_dbtp": -3.0}


def material(**raster):
    r = {"pulsklarheit": 0.5, "erste_eins_zweitverfahren": 2}
    r.update(raster)
    return {"raster": r}


def test_tor_unsicher_ist_nicht_ok_auch_wenn_das_tiefband_zustimmt():
    """FEHLERFALL (alt): beat_this 2 == Tief-Band 2 meldete `ok`, obwohl die Mehrheit nur 0,55 trug und der Kick eine
    andere Lage sah (bfdd). Jetzt urteilt das Tor auf `unsicher`."""
    m = material(erste_eins_quell_beat=2, erste_eins_anteil=0.55, erste_eins_kick=0, erste_eins_unsicher=True,
                 erste_eins_quelle="mehrheit")
    t = kette.tore(m, LAUT, 1.0, 2)["eins"]
    assert t["ok"] is False and t["unsicher"] is True and t["anteil"] == 0.55 and t["kick"] == 0 and t["bewertet"] is True


def test_tor_sicher_ist_ok():
    """NEGATIV-KONTROLLE: klare Mehrheit, Kick einig -> ok, auch wenn das Tief-Band etwas anderes sagt."""
    m = material(erste_eins_quell_beat=2, erste_eins_anteil=0.97, erste_eins_kick=2, erste_eins_unsicher=False,
                 erste_eins_quelle="mehrheit", erste_eins_zweitverfahren=3)
    t = kette.tore(m, LAUT, 1.0, 2)["eins"]
    assert t["ok"] is True and t["unsicher"] is False and t["bewertet"] is True


def test_tor_altes_material_ohne_felder_ist_unbewertet_und_nicht_unsicher():
    """Material von vor dem 11.10. hat keinen Anteil: nicht bewertet (kein Zeichen in der Seite), Tor nicht ok."""
    t = kette.tore(material(erste_eins_quell_beat=2), LAUT, 1.0, 2)["eins"]
    assert t["bewertet"] is False and t["unsicher"] is False and t["ok"] is False


def test_tor_von_hand_gesetzte_eins_ist_sicher():
    m = material(erste_eins_quell_beat=2, erste_eins_anteil=0.4, erste_eins_unsicher=True)
    t = kette.tore(m, LAUT, 1.0, 2, eins_hand=True)["eins"]
    assert t["ok"] is True and t["unsicher"] is False and t["quelle"] == "andreas"


@pytest.fixture
def quelle(tmp_path):
    p = tmp_path / "klick134.wav"
    s = klick(p)
    return p, Karte(sekunden=s, beats=np.arange(len(s), dtype=float))


def _einlesen_mit(quelle, tmp_path, monkeypatch, **extra):
    p, karte = quelle
    liste = karte.als_liste()
    raster = kette.raster_aus_wahrheit(karte)
    raster.update({"werkzeug": "beat_this", "zweitwerkzeug": "essentia", "erste_eins_quell_beat": 2, **extra})
    monkeypatch.setattr(kette, "raster_messen", lambda q, g="cpu": (liste, dict(raster), {"eins_beat_this": 2}, []))
    b = tmp_path / "bestand"
    e = kette.einlesen(p, b)
    return b, e["material_id"]


def test_unsicher_kommt_in_fassung_und_warnung(quelle, tmp_path, monkeypatch):
    b, mid = _einlesen_mit(quelle, tmp_path, monkeypatch, erste_eins_anteil=0.5, erste_eins_kick=None,
                           erste_eins_unsicher=True, erste_eins_quelle="mehrheit")
    f = lies_json(b / mid / "fassungen" / "128000_r1" / "fassung.json")
    m = lies_json(b / mid / "material.json")
    assert fehler("fassung.schema.json", f) == [] and fehler("material.schema.json", m) == []
    assert f["tore"]["eins"]["unsicher"] is True and f["tore"]["eins"]["ok"] is False
    assert "Tor eins gerissen" in f["warnungen"]
    assert m["raster"]["erste_eins_anteil"] == 0.5 and m["raster"]["erste_eins_unsicher"] is True


def test_sicher_kein_eins_tor_riss(quelle, tmp_path, monkeypatch):
    b, mid = _einlesen_mit(quelle, tmp_path, monkeypatch, erste_eins_anteil=0.95, erste_eins_kick=2,
                           erste_eins_unsicher=False, erste_eins_quelle="mehrheit")
    f = lies_json(b / mid / "fassungen" / "128000_r1" / "fassung.json")
    assert f["tore"]["eins"]["ok"] is True and "Tor eins gerissen" not in f["warnungen"]


def test_handkorrektur_eins_hebt_unsicher_in_der_naechsten_fassung(quelle, tmp_path, monkeypatch):
    """Andreas setzt die Eins (art=eins): r2 hat die neue Eins, das Tor ist ok, kein „Takt-Eins unsicher“ mehr."""
    b, mid = _einlesen_mit(quelle, tmp_path, monkeypatch, erste_eins_anteil=0.5, erste_eins_kick=None,
                           erste_eins_unsicher=True, erste_eins_quelle="mehrheit")
    korrektur_anhaengen(b / mid, {"zeit": "2026-10-11T03:00:00", "von": "andreas", "art": "eins", "fassung": "128000_r1",
                                  "ab_quell_beat": 0.0, "bis_quell_beat": None, "versatz_ms": None, "nr": None, "text": "SET"})
    kette.korrigieren(mid, b)
    f2 = lies_json(b / mid / "fassungen" / "128000_r2" / "fassung.json")
    assert fehler("fassung.schema.json", f2) == []
    assert f2["erste_eins_quell_beat"] == 0
    assert f2["tore"]["eins"]["ok"] is True and f2["tore"]["eins"]["unsicher"] is False
    assert not any(w.startswith("Takt-Eins unsicher") for w in f2["warnungen"]) and "Tor eins gerissen" not in f2["warnungen"]


def test_raster_korrektur_ohne_eins_zeile_behaelt_unsicher(quelle, tmp_path, monkeypatch):
    """NEGATIV-KONTROLLE: eine reine Raster-Korrektur klaert die Eins nicht."""
    b, mid = _einlesen_mit(quelle, tmp_path, monkeypatch, erste_eins_anteil=0.5, erste_eins_kick=None,
                           erste_eins_unsicher=True, erste_eins_quelle="mehrheit")
    korrektur_anhaengen(b / mid, {"zeit": "2026-10-11T03:00:00", "von": "andreas", "art": "raster", "fassung": "128000_r1",
                                  "ab_quell_beat": 8.0, "bis_quell_beat": 16.0, "versatz_ms": 5.0, "nr": None, "text": ""})
    kette.korrigieren(mid, b)
    f2 = lies_json(b / mid / "fassungen" / "128000_r2" / "fassung.json")
    assert f2["tore"]["eins"]["unsicher"] is True and f2["erste_eins_quell_beat"] == 2


# --- lauf_raster.miss: die Entscheidung am Signal -----------------------------------------------------------------

def _wav(pfad, erster_kick, bpm=120.0, n=96, t0=0.5, sr=44100):
    per = 60.0 / bpm
    x = np.zeros(int((t0 + (n + 1) * per) * sr))
    tk = np.arange(int(0.2 * sr)) / sr
    kick = np.sin(2 * np.pi * 60 * tk) * np.exp(-tk / 0.05)
    rng = np.random.default_rng(2)
    cl = rng.standard_normal(int(0.08 * sr)) * np.exp(-np.arange(int(0.08 * sr)) / sr / 0.02)
    for i in range(erster_kick, n):
        a = int((t0 + i * per) * sr)
        x[a:a + len(kick)] += kick
    for i in range(1, n, 2):
        a = int((t0 + i * per) * sr)
        x[a:a + len(cl)] += 2.0 * cl
    sf.write(str(pfad), x.astype(np.float32), sr, subtype="FLOAT")
    return t0 + np.arange(n) * per


def _miss(tmp_path, monkeypatch, erster_kick, downbeat_lagen):
    """downbeat_lagen: Lage der Downbeats je 4 Beats; Liste, Element i gilt fuer den i-ten Takt."""
    t = _wav(tmp_path / "s.wav", erster_kick)
    db = np.array([t[4 * i + lage] for i, lage in enumerate(downbeat_lagen) if 4 * i + lage < len(t)])
    monkeypatch.setattr(lauf_raster, "beat_this", lambda x, geraet="cpu": (t, db))
    monkeypatch.setattr(lauf_raster, "essentia_schlaege", lambda x: (t, 120.0, 4.0))
    monkeypatch.setattr(lauf_raster, "verfeinere_schlaege",
                        lambda x, sr, s: (s, {"verfeinert": True, "grund": ""}))
    return lauf_raster.miss("s", tmp_path / "s.wav")


def test_miss_chunkspaltung_wird_vom_kick_gerettet(tmp_path, monkeypatch):
    """FEHLERFALL: Downbeats spalten sich 2:1 auf Lage 0 und 2 (Chunk-Zufall), der Kick setzt bei Beat 2 ein. Alt:
    Mehrheit Lage 0. Neu: Eins 2 (Kick), nicht unsicher."""
    e = _miss(tmp_path, monkeypatch, 2, [0] * 13 + [2] * 9)
    assert e["eins_beat_this"] == 0                        # Mehrheit allein (alt): 0, Anteil rund 0,57
    r = e["raster"]
    assert r["erste_eins_quell_beat"] == 2 and r["erste_eins_quelle"] == "kick"
    assert r["erste_eins_unsicher"] is False and r["erste_eins_kick"] == 2 and r["erste_eins_anteil"] == pytest.approx(0.59, abs=0.03)


def test_miss_klare_mehrheit_bleibt(tmp_path, monkeypatch):
    """NEGATIV-KONTROLLE: alle Downbeats auf Lage 2, Kick bei Beat 2: Eins 2, Quelle Mehrheit, sicher."""
    e = _miss(tmp_path, monkeypatch, 2, [2] * 22)
    r = e["raster"]
    assert r["erste_eins_quell_beat"] == 2 and r["erste_eins_quelle"] == "mehrheit"
    assert r["erste_eins_unsicher"] is False and r["erste_eins_anteil"] == 1.0 and r["erste_eins_kick"] == 2


def test_werkstatt_eins_zeile_ist_keine_handkorrektur(quelle, tmp_path, monkeypatch):
    """Review B9: eine Zeile von=werkstatt (lauf_eins --schreiben) macht das Tor nicht „andreas“/sicher."""
    b, mid = _einlesen_mit(quelle, tmp_path, monkeypatch, erste_eins_anteil=0.5, erste_eins_kick=None,
                           erste_eins_unsicher=True, erste_eins_quelle="mehrheit")
    korrektur_anhaengen(b / mid, {"zeit": "2026-10-11T03:00:00", "von": "werkstatt", "art": "eins", "fassung": "128000_r1",
                                  "ab_quell_beat": 0.0, "bis_quell_beat": None, "versatz_ms": None, "nr": None, "text": "x"})
    kette.korrigieren(mid, b)
    f2 = lies_json(b / mid / "fassungen" / "128000_r2" / "fassung.json")
    assert f2["erste_eins_quell_beat"] == 0 and f2["tore"]["eins"]["quelle"] != "andreas" and f2["tore"]["eins"]["unsicher"] is True
