import json
from pathlib import Path
from werkstatt.vertrag import fehler

BEISPIEL_FASSUNG = {
    "schema": 1, "material_id": "3fa1c09b2e7d4410", "basis_bpm": 128.0, "fassung": 1, "korrekturen_bis_zeile": 0,
    "datei": "basis.f32", "frames": 480000, "sha256": "a" * 64, "erster_schlag_frame": 12000, "beats": 20.8,
    "erste_eins_quell_beat": 0, "analyse_quelle": "basis", "stems": {}, "schuesse": [], "headroom_db": -12.0,
    "stimmung_korrektur_cent": 0.0,
    "lautheit": {"lufs_integriert": -26.0, "echtspitze_dbtp": -12.5, "crest_db": 14.0, "lufs_je_takt": [-26.1, None]},
    "struktur": {"phrasen": []}, "hotcues": [], "loops": [],
    "tore": {"raster": {"ok": False, "wert_ms": None, "grenze_ms": 8.0, "anschlaege": 0},
             "headroom": {"ok": True, "wert_dbtp": -12.5, "grenze_dbtp": -1.0},
             "klarheit": {"ok": True, "wert": 0.97, "grenze": 0.1},
             "streckfaktor": {"ok": True, "wert": 0.9552, "grenze": 0.2},
             "eins": {"ok": False, "beat_this": None, "zweitverfahren": None}},
    "nur_fuer_andreas": True, "warnungen": []}


def test_fassung_gueltig():
    assert fehler("fassung.schema.json", BEISPIEL_FASSUNG) == []


def test_fassung_ohne_lautheit_ungueltig():
    f = dict(BEISPIEL_FASSUNG); del f["lautheit"]
    assert any("lautheit" in e for e in fehler("fassung.schema.json", f))


def test_fassung_stems_leer_verlangt_basis():
    f = dict(BEISPIEL_FASSUNG, analyse_quelle="stems")
    assert fehler("fassung.schema.json", f) != []


def test_korrektur_zeile():
    z = {"zeit": "2026-09-24T21:14:03", "von": "andreas", "art": "raster", "fassung": "128000_r1",
         "ab_quell_beat": 64.0, "bis_quell_beat": 128.0, "versatz_ms": -10.4, "nr": None, "text": ""}
    assert fehler("korrektur.schema.json", z) == []
    assert fehler("korrektur.schema.json", dict(z, fassung="128000_r0")) != []


def test_numpy_zahlen_zaehlen_wie_json():
    """FEHLERFALL VORHER (Planprobe): np.True_ in tore/headroom/ok liess das Schema scheitern ('is not of type
    boolean'), obwohl json.dump daraus true schreibt. NACHHER prueft `fehler` die Form, die in der Datei steht."""
    import numpy as np
    f = dict(BEISPIEL_FASSUNG, tore=dict(BEISPIEL_FASSUNG["tore"], headroom={"ok": np.True_, "wert_dbtp": np.float64(-12.5),
                                                                              "grenze_dbtp": -1.0}))
    assert fehler("fassung.schema.json", f) == []
