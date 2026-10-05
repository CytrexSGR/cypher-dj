import numpy as np
import pytest

from klickhilfe import klick, sha_baum
from werkstatt import kette
from werkstatt.bestand import korrektur_anhaengen, lies_json
from werkstatt.index import zaehle
from werkstatt.karte import Karte
from werkstatt.kette import eins_und_hotcues, wende_raster_an
from werkstatt.vertrag import fehler


@pytest.fixture
def quelle(tmp_path):
    p = tmp_path / "klick134.wav"
    s = klick(p)
    return p, Karte(sekunden=s, beats=np.arange(len(s), dtype=float))


def zeile(**k):
    z = {"zeit": "2026-09-24T21:14:03", "von": "andreas", "art": "raster", "fassung": "128000_r1",
         "ab_quell_beat": None, "bis_quell_beat": None, "versatz_ms": None, "nr": None, "text": ""}
    z.update(k)
    return z


def test_raster_verschiebt_nur_den_abschnitt():
    """134er Quelle auf Basis 128: 10 ms zu spaet in der Fassung = 10 ms * (60/134)/(60/128) in der Quelle."""
    s = 0.25 + np.arange(200) * 60.0 / 134.0
    k = wende_raster_an(Karte(sekunden=s, beats=np.arange(200.0)),
                        [zeile(ab_quell_beat=64.0, bis_quell_beat=128.0, versatz_ms=10.0)], 128.0)
    d = (k.sekunden - s) * 1000.0
    assert np.allclose(d[64:128], 10.0 * 128.0 / 134.0, atol=1e-9)
    assert np.all(d[:64] == 0.0) and np.all(d[128:] == 0.0)


def test_andere_arten_lassen_die_karte():
    s = 0.25 + np.arange(20) * 0.5
    k = wende_raster_an(Karte(sekunden=s, beats=np.arange(20.0)), [zeile(art="urteil", text="gut")], 128.0)
    assert np.array_equal(k.sekunden, s)


def test_zu_grosse_korrektur_wird_abgelehnt():
    s = 0.25 + np.arange(20) * 0.5
    with pytest.raises(ValueError):
        wende_raster_an(Karte(sekunden=s, beats=np.arange(20.0)),
                        [zeile(ab_quell_beat=5.0, bis_quell_beat=10.0, versatz_ms=-600.0)], 120.0)


def test_eins_und_hotcues():
    m = {"raster": {"erste_eins_quell_beat": 2}}
    eins, hc = eins_und_hotcues(m, [zeile(art="eins", ab_quell_beat=65.0),
                                    zeile(art="hotcue", nr=1, ab_quell_beat=64.0, text="Drop"),
                                    zeile(art="hotcue", nr=2, ab_quell_beat=96.0),
                                    zeile(art="hotcue", nr=2, ab_quell_beat=None)])
    assert eins == 1
    assert hc == [{"nr": 1, "quell_beat": 64.0, "name": "Drop", "von": "andreas"}]
    assert eins_und_hotcues(m, [])[0] == 2


def test_korrigieren_legt_r2_neben_r1_und_r1_bleibt(quelle, tmp_path):
    p, karte = quelle
    b = tmp_path / "bestand"
    mid = kette.einlesen(p, b, karte=karte)["material_id"]
    r1 = b / mid / "fassungen" / "128000_r1"
    vorher = sha_baum(r1)
    korrektur_anhaengen(b / mid, {"zeit": "2026-09-24T21:14:03", "von": "andreas", "art": "raster",
                                  "fassung": "128000_r1", "ab_quell_beat": 8.0, "bis_quell_beat": 16.0,
                                  "versatz_ms": 5.0, "nr": None, "text": ""})
    k = kette.korrigieren(mid, b)
    assert k["fassung"] == "128000_r2" and k["korrekturen_bis_zeile"] == 1
    assert sha_baum(r1) == vorher
    f2 = lies_json(b / mid / "fassungen" / "128000_r2" / "fassung.json")
    assert f2["fassung"] == 2 and f2["korrekturen_bis_zeile"] == 1 and fehler("fassung.schema.json", f2) == []
    assert zaehle(b) == (1, 2)


def test_korrigieren_ohne_neue_zeilen_legt_nichts_an(quelle, tmp_path):
    """NEGATIV-KONTROLLE: keine neue Zeile -> KeineNeuenKorrekturen, kein r2."""
    p, karte = quelle
    b = tmp_path / "bestand"
    mid = kette.einlesen(p, b, karte=karte)["material_id"]
    with pytest.raises(kette.KeineNeuenKorrekturen):
        kette.korrigieren(mid, b)
    assert [x.name for x in (b / mid / "fassungen").iterdir()] == ["128000_r1"]
