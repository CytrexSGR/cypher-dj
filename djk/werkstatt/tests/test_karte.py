import numpy as np
import pytest
from werkstatt.karte import nummeriere, karte_aus_schlaegen, karte_fest, rest_gegen_wahrheit, vergleiche


# beat_this 1.1.0 (Checkpoint final0, CPU) an proben/07-werkstatt-zerleger/b_out/konst134_quelle.wav:
# Bildnummern bei 50 Bildern je Sekunde (Schlagzeit = Nummer * 0,02 s), Planprobe 05 am 2026-09-23.
KONST134_BILDER = [
    15, 37, 60, 82, 105, 127, 149, 172, 194, 216, 239, 261, 284, 306, 328, 351, 373, 396, 418, 440,
    463, 485, 508, 530, 552, 575, 597, 619, 642, 664, 687, 709, 731, 754, 776, 799, 821, 843, 866, 888,
    911, 933, 955, 978, 1000, 1022, 1045, 1067, 1090, 1112, 1134, 1157, 1179, 1202, 1224, 1246, 1269,
    1291, 1313, 1336, 1358, 1381, 1403, 1425, 1447, 1470, 1493, 1516, 1539, 1560, 1584, 1605, 1627,
    1649, 1672, 1694, 1716, 1739, 1761, 1784, 1806, 1828, 1851, 1873, 1896, 1918, 1940, 1963, 1985,
    2008, 2030, 2052, 2075, 2097, 2119, 2142, 2164, 2187, 2209, 2231, 2254, 2276, 2299, 2321, 2343,
    2366, 2388, 2411, 2433, 2455, 2478, 2500, 2522, 2545, 2567, 2590, 2612, 2634, 2657, 2679, 2702,
    2724, 2746, 2769, 2791, 2813, 2836, 2858, 2880, 2903, 2925, 2947, 2970, 2993]


def raster(bpm, n, t0=0.5):
    return t0 + np.arange(n) * 60.0 / bpm


def auf_20ms(t):
    """So liefert beat_this Zeiten: auf dem Raster seiner 50 Bilder je Sekunde."""
    return np.round(np.asarray(t) / 0.02) * 0.02


def drift_wahrheit():
    """Tempokurve wie proben/07 b_timemap.py: 127,5 + t/120 + 0,5 sin(2 pi t / 45) BPM."""
    tt = np.arange(0, 120, 1e-3)
    bpm = 127.5 + tt / 120 + 0.5 * np.sin(2 * np.pi * tt / 45)
    phase = np.cumsum(bpm / 60) * 1e-3
    return 0.25 + np.interp(np.arange(1, int(phase[-1]) - 1), phase, tt)


def test_luecke_bekommt_ihre_nummer():
    t = np.delete(raster(120, 40), 10)
    z, n, info = nummeriere(t)
    assert n[10] == 11 and n[-1] == 39


def test_doppelter_treffer_faellt_weg():
    t = np.sort(np.append(raster(120, 40), 0.5 + 10 * 0.5 + 0.03))
    z, n, info = nummeriere(t)
    assert len(z) == 40 and n[-1] == 39 and info["ohne_doppelte"] == 40


def test_intro_in_anderem_tempo_bleibt_draussen():
    intro = np.arange(12) * 0.6                       # 100 BPM, passt nicht ins 128er Raster
    haupt = 10.0 + raster(128, 200, t0=0.0)
    z, n, info = nummeriere(np.concatenate([intro, haupt]))
    assert info["kette_schlaege"] == 200
    assert z[0] == pytest.approx(10.0) and n[-1] == 199


def test_phasensprung_trennt_die_kette():
    per = 60.0 / 128
    vorn = raster(128, 30, t0=0.0) + per / 2          # Offbeat-Kette, 30 Schlaege
    hinten = 30 * per + per + raster(128, 100, t0=0.0)   # nach 1,5 Perioden Abstand auf dem Schlag
    z, n, info = nummeriere(np.concatenate([vorn, hinten]))
    assert info["ketten"] == 2 and info["kette_schlaege"] == 100
    assert z[0] == pytest.approx(31 * per)


def test_periode_aus_20ms_raster_ueber_lange_luecke():
    """Der Median der Abstaende waere 0,44 s (1,7 % zu kurz) und zaehlte eine Luecke von 40
    Schlaegen falsch; das Mittel trifft 0,4478 s."""
    t = auf_20ms(raster(134, 300))
    t = np.delete(t, np.arange(100, 140))
    z, n, info = nummeriere(t)
    assert info["periode_s"] == pytest.approx(60 / 134, abs=0.001)
    assert info["kette_schlaege"] == 260 and n[-1] == 299


def test_konstant_rest_null():
    w = raster(134, 134)
    k = karte_aus_schlaegen(w)
    r = rest_gegen_wahrheit(k, w)
    assert k.bpm_gesamt() == pytest.approx(134.0, abs=1e-6)
    assert r["rest_p90_ms"] < 0.01 and abs(r["versatz_ms"]) < 0.01


def test_starres_20ms_raster_gibt_gerade():
    """NULL im Kleinen: ein starres Stueck, so gerastert wie beat_this es liefert, bekommt die
    Gerade; die Karte ist konstant (alle lokalen Tempi gleich) und trifft die Wahrheit."""
    w = raster(134, 134, t0=0.25)
    k = karte_aus_schlaegen(auf_20ms(w))
    assert k.info["modell"] == "gerade"
    assert np.ptp(k.bpm_lokal()) < 1e-6
    assert rest_gegen_wahrheit(k, w)["rest_p90_ms"] < 1.0


def test_echte_beat_this_zeiten_konst134_gerade_statt_gcv():
    """NULL an echten Werkzeugzeiten: beat_this auf dem starren Klick. GCV (Fehlerfall) laesst die
    Karte wackeln (gemessen 4,14 ms p90 gegen die Gerade), die Modellwahl nimmt die Gerade."""
    t = np.array(KONST134_BILDER) * 0.02
    wahr = 0.25 + np.arange(134) * 60.0 / 134.0          # b_timemap.py, konst134
    assert vergleiche(karte_fest(t), karte_aus_schlaegen(t, glaettung="gcv"))["form_p90_ms"] > 1.0
    k = karte_aus_schlaegen(t)
    assert k.info["modell"] == "gerade"
    assert rest_gegen_wahrheit(k, wahr)["rest_p90_ms"] < 1.0


def test_drift_am_20ms_raster_bekommt_spline():
    """POSITIV im Kleinen: die driftende Tempokurve aus b_timemap, auf 20 ms gerastert."""
    w = drift_wahrheit()
    k = karte_aus_schlaegen(auf_20ms(w))
    assert k.info["modell"] == "spline"
    assert rest_gegen_wahrheit(k, w)["rest_rms_ms"] < 8.0


def test_feste_bpm_verfehlt_drift():
    w = drift_wahrheit()
    r = rest_gegen_wahrheit(karte_fest(w), w)
    assert r["rest_rms_ms"] > 40.0


def test_karte_folgt_drift_trotz_zittern():
    w = drift_wahrheit()
    rng = np.random.default_rng(1)
    gemessen = w + rng.uniform(-0.010, 0.010, len(w)) + 0.045
    r = rest_gegen_wahrheit(karte_aus_schlaegen(gemessen), w)
    assert r["rest_p90_ms"] < 8.0
    assert r["versatz_ms"] == pytest.approx(45.0, abs=3.0)


def test_kurze_kette_bekommt_gerade():
    k = karte_aus_schlaegen(raster(128, 40))
    assert k.info["modell"] == "gerade" and k.info["bloecke_innen"] == 1


def test_vergleich_trennt_form_und_versatz():
    a = karte_aus_schlaegen(raster(128, 100))
    b = karte_aus_schlaegen(raster(128, 100) + 0.012)
    v = vergleiche(a, b)
    assert v["form_p90_ms"] < 0.01
    assert v["versatz_ms"] == pytest.approx(12.0, abs=0.01)


def test_vielfaches_zaehlt_doppelt():
    k = karte_aus_schlaegen(raster(90, 64), vielfaches=2.0)
    assert k.beats[1] == 2.0
    assert k.bpm_gesamt() == pytest.approx(180.0, abs=1e-6)
    assert k.als_liste()[1] == [round(0.5 + 60 / 90, 6), 2.0]


def test_gezaehlt_aendert_nur_die_zaehlung():
    k = karte_aus_schlaegen(raster(90, 64))
    k2 = k.gezaehlt(2.0)
    assert np.array_equal(k2.sekunden, k.sekunden) and k2.beats[3] == 6.0 and k2.vielfaches == 2.0
    assert k.beats[3] == 3.0
