"""probe_vor_dem_schreiben muss die echte Quell-Laenge kennen: material.json fuehrt kein `frames` in `quelle`
(Schema: datei, sr, kanaele, dauer_s, sha256), der alte Wert 10**12 schaltete den Dateiende-Waechter ab."""
import json
import numpy as np
import soundfile as sf
from werkstatt.lauf_phase import probe_vor_dem_schreiben


def _mo(tmp_path, letzte_s, dauer_s=10.0):
    mo = tmp_path / "abcd0123abcd0123"
    mo.mkdir()
    sf.write(str(mo / "original.wav"), np.zeros((int(dauer_s * 48000), 2), dtype="float32"), 48000, subtype="FLOAT")
    s = np.arange(0.25, letzte_s + 1e-9, 0.5)
    material = {"quelle": {"datei": "original.wav", "sr": 48000, "kanaele": 2, "dauer_s": dauer_s, "sha256": "0" * 64},
                "tempo_karte_quelle": [[float(a), float(i)] for i, a in enumerate(s)],
                "raster": {"tempo_vielfaches": 1.0}}
    (mo / "material.json").write_text(json.dumps(material))
    (mo / "korrekturen.jsonl").write_text("")
    return mo


def test_probe_sieht_karte_hinter_dem_dateiende(tmp_path):
    """Fehlerfall: Karte reicht 2 s ueber die Datei. Vorher None (Waechter mit 10**12 blind), jetzt der Grund."""
    mo = _mo(tmp_path, letzte_s=12.25)
    assert "Dateiende" in (probe_vor_dem_schreiben(mo, 128.0, []) or "")


def test_probe_laesst_passende_karte_durch(tmp_path):
    """Negativkontrolle: Karte endet 0,25 s vor dem Dateiende: kein Grund."""
    mo = _mo(tmp_path, letzte_s=9.75)
    assert probe_vor_dem_schreiben(mo, 128.0, []) is None


def test_probe_laesst_korrektur_vor_den_dateianfang_mit_vorlauf_durch(tmp_path):
    """Fehlerfall 580de55457b9bbba (2026-10-30): eine Korrektur, die quell_beat 0 vor den Dateianfang legt, scheiterte an
    der Probe („quell_beat 0 laege vor dem Dateianfang“). Gerendert wird mit Vorlauf, also lässt die Probe sie durch."""
    mo = _mo(tmp_path, letzte_s=9.75)
    zeile = {"art": "raster", "ab_quell_beat": -1e6, "bis_quell_beat": 1e6, "versatz_ms": -300.0}
    assert probe_vor_dem_schreiben(mo, 128.0, [zeile]) is None
