"""lauf_zeitkarte lays the Eins corrections of korrekturen.jsonl (art=eins) over material.json, as kette.korrigieren does.

material.json stays sealed, so an Eins fixed by hand or by lauf_eins lives only in korrekturen.jsonl; the time map must
use it, and must not warn about an uncertain Eins that a correction line has settled."""
import json

import numpy as np
import pytest

from werkstatt import run_zeitkarte as lz

SR = 48000
BPM120 = [[0.5 * i, float(i)] for i in range(0, 40)]      # beat i at 0.5 * i s
UNSICHER = "Eins uncertain"


def _zeile(art, ab, nr=None, zeit="2026-10-09T20:33:30", von="andreas"):
    return {"zeit": zeit, "von": von, "art": art, "fassung": "128000_r1", "ab_quell_beat": ab,
            "bis_quell_beat": None, "versatz_ms": None, "nr": nr, "text": f"{art} {ab}"}


def _lauf(tmp_path, monkeypatch, zeilen, eins=2, unsicher=True):
    ordner = tmp_path / "bestand" / "t0"
    ordner.mkdir(parents=True)
    (ordner / "x.wav").write_bytes(b"")
    material = {"material_id": "t0", "quelle": {"datei": "x.wav", "sr": SR, "kanaele": 2, "dauer_s": 16.0},
                "tempo_karte_quelle": BPM120,
                "raster": {"erste_eins_quell_beat": eins, "erste_eins_unsicher": unsicher, "tempo_vielfaches": 1.0,
                           "taktart": 4}}
    (ordner / "material.json").write_text(json.dumps(material))
    if zeilen is not None:
        (ordner / "korrekturen.jsonl").write_text("".join(json.dumps(z) + "\n" for z in zeilen))
    monkeypatch.setenv("CYPHERDJ_BESTAND", str(tmp_path / "bestand"))
    monkeypatch.setattr(lz, "standard_ablage", lambda: tmp_path / "ablage")
    t = np.arange(16 * SR) / SR
    x = np.stack([0.3 * np.sin(2 * np.pi * 100 * t)] * 2, axis=1).astype(np.float32)
    monkeypatch.setattr(lz, "lade_stereo48", lambda p: x)
    aus = tmp_path / "aus"
    assert lz.main([str(ordner), "--aus", str(aus)]) == 0
    return json.loads((aus / "zeitkarte.json").read_text()), ordner


def test_zeitkarte_nimmt_eins_aus_korrektur(tmp_path, monkeypatch):
    z, ordner = _lauf(tmp_path, monkeypatch, [_zeile("eins", 0.0)])
    # corrected Eins = beat 0 -> first bar starts at 0.0 s; the stale material.json Eins (beat 2) gives 1.0 s
    assert z["takte"][0]["start_s"] == pytest.approx(0.0, abs=1e-6)
    assert not any(UNSICHER in w for w in z["warnungen"])
    assert z["eins_quelle"] == "korrekturen"
    # the sealed material is not touched
    assert json.loads((ordner / "material.json").read_text())["raster"]["erste_eins_quell_beat"] == 2


def test_letzte_eins_zeile_gilt_und_hotcue_zeilen_aendern_nichts(tmp_path, monkeypatch):
    zeilen = [_zeile("eins", 0.0), _zeile("hotcue", 8.0, nr=1), _zeile("eins", 3.0)]
    z, _ = _lauf(tmp_path, monkeypatch, zeilen, eins=1)
    assert z["takte"][0]["start_s"] == pytest.approx(1.5, abs=1e-6)       # Eins at beat 3 -> 1.5 s


def test_ohne_eins_korrektur_bleibt_material_massgebend(tmp_path, monkeypatch):
    for zeilen in (None, [_zeile("hotcue", 8.0, nr=1)]):
        z, _ = _lauf(tmp_path / ("a" if zeilen is None else "b"), monkeypatch, zeilen)
        assert z["takte"][0]["start_s"] == pytest.approx(1.0, abs=1e-6)   # material.json Eins = beat 2
        assert any(UNSICHER in w for w in z["warnungen"])
        assert z["eins_quelle"] == "material"


def test_werkstatt_eins_zeile_wendet_eins_an_aber_laesst_warnung_stehen(tmp_path, monkeypatch):
    # lauf_eins --schreiben writes von=werkstatt, also for an uncertain guess: same rule as kette.korrigieren (eins_hand)
    z, _ = _lauf(tmp_path, monkeypatch, [_zeile("eins", 0.0, von="werkstatt")])
    assert z["takte"][0]["start_s"] == pytest.approx(0.0, abs=1e-6)       # the corrected Eins is applied
    assert z["eins_quelle"] == "korrekturen"
    assert any(UNSICHER in w for w in z["warnungen"])                       # but a machine guess stays uncertain


def test_hand_zeile_nach_werkstatt_zeile_klaert_die_warnung(tmp_path, monkeypatch):
    zeilen = [_zeile("eins", 0.0, von="werkstatt"), _zeile("eins", 3.0, von="andreas")]
    z, _ = _lauf(tmp_path, monkeypatch, zeilen)
    assert z["takte"][0]["start_s"] == pytest.approx(1.5, abs=1e-6)
    assert not any(UNSICHER in w for w in z["warnungen"])
