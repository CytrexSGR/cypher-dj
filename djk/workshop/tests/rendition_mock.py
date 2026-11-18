"""Fixture for the audit tests of werkstatt.fassung: a material with one 128 fassung and a korrekturen.jsonl, and a stand-in
for the render (rendere) that records its arguments. No audio, no essentia: neue_fassung is checked for WHAT it hands to the render."""
import json

import numpy as np

from werkstatt import rendition as fassung

BPM_QUELLE = 134.0


def zeile(**k):
    z = {"zeit": "2026-09-24T21:14:03", "von": "andreas", "art": "raster", "fassung": "128000_r1",
         "ab_quell_beat": None, "bis_quell_beat": None, "versatz_ms": None, "nr": None, "text": ""}
    z.update(k)
    return z


def bestand_mit(tmp_path, zeilen, eins_unsicher=True):
    b = tmp_path / "bestand"
    mid = "a" * 16
    mo = b / mid
    r1 = mo / "fassungen" / "128000_r1"
    r1.mkdir(parents=True)
    n = 200
    karte = [[0.25 + i * 60.0 / BPM_QUELLE, float(i)] for i in range(n)]
    (mo / "material.json").write_text(json.dumps({
        "tempo_karte_quelle": karte, "raster": {"tempo_vielfaches": 1.0, "erste_eins_quell_beat": 0},
        "quelle": {"datei": "x.wav"}}), encoding="utf-8")
    warnungen = ["Stimmung unklar (x)"] + (["Takt-Eins unsicher (beat_this und Raster uneins)", "Tor eins gerissen"] if eins_unsicher else [])
    (r1 / "fassung.json").write_text(json.dumps({
        "korrekturen_bis_zeile": len(zeilen), "warnungen": warnungen, "stimmung_korrektur_cent": 0.0,
        "tore": {"eins": {"ok": not eins_unsicher, "unsicher": eins_unsicher, "beat_this": 0}}}), encoding="utf-8")
    (mo / "korrekturen.jsonl").write_text("".join(json.dumps(z) + "\n" for z in zeilen), encoding="utf-8")
    return b, mid, np.asarray([k[0] for k in karte])


def rendere_merken(monkeypatch):
    """Ersetzt rendere, den Audio-Ladeschritt und den Index; Rückgabe: Liste der Aufrufe (Namen wie rendere)."""
    aufrufe = []

    def rendere(x, karte, material, basis_bpm, r, fassung_ordner, arbeit, korrekturen_bis_zeile, erste_eins, hotcues,
                korrektur_cent, warnungen, eins_beat_this, eins_hand=False, melde=None):
        aufrufe.append({"karte": karte, "basis_bpm": basis_bpm, "warnungen": list(warnungen), "eins_hand": eins_hand})
        fassung_ordner.mkdir(parents=True)
        (fassung_ordner / "fassung.json").write_text("{}", encoding="utf-8")
        return {"frames": 1}, {}

    class _Con:
        def close(self):
            pass

    monkeypatch.setattr(fassung, "rendere", rendere)
    monkeypatch.setattr(fassung, "lade_stereo48", lambda p: None)
    monkeypatch.setattr(fassung, "oeffne", lambda b: _Con())
    monkeypatch.setattr(fassung, "eintragen", lambda con, mo, bpm: None)
    return aufrufe
