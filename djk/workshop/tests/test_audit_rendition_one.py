"""Audit U40: a tempo fassung must keep a downbeat (Eins) that Andreas set by hand, like kette.korrigieren does:
rendere gets eins_hand and the warning 'Takt-Eins unsicher' of the original raster decision is dropped."""
from werkstatt import rendition as fassung

from rendition_mock import bestand_mit, rendere_merken, zeile


def test_tempo_fassung_behaelt_andreas_eins(tmp_path, monkeypatch):
    b, mid, _ = bestand_mit(tmp_path, [zeile(art="eins", ab_quell_beat=65.0)])
    aufrufe = rendere_merken(monkeypatch)
    assert fassung.neue_fassung(b, mid, 132.0)["status"] == "neu"
    a = aufrufe[0]
    assert a["eins_hand"] is True
    assert not any(w.startswith("Takt-Eins unsicher") for w in a["warnungen"])
    assert "Stimmung unklar (x)" in a["warnungen"]          # other warnings stay


def test_ohne_eins_von_andreas_bleibt_alles_wie_es_war(tmp_path, monkeypatch):
    """Negativ-Kontrolle: keine eins-Zeile, oder eine von der Werkstatt: eins_hand False, Warnung bleibt."""
    for zeilen in ([], [zeile(art="eins", ab_quell_beat=65.0, von="werkstatt")]):
        b, mid, _ = bestand_mit(tmp_path / str(len(zeilen)), zeilen)
        aufrufe = rendere_merken(monkeypatch)
        fassung.neue_fassung(b, mid, 132.0)
        a = aufrufe[0]
        assert a["eins_hand"] is False
        assert any(w.startswith("Takt-Eins unsicher") for w in a["warnungen"])
