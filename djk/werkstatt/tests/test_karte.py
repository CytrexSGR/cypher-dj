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


# ---- Ketten verbinden (2026-10-17, Meindl "All Those Moments (Mython Remix)": ein zu kurzes Intervall
# spaltete 897 Schlaege in 439 + 458, die laengere Haelfte gewann und die ersten 181,6 s fielen weg) ----

def bruch_auf_gleichem_raster(n=300, ab=100, bpm=128, versatz=(-0.17, -0.10, -0.05, -0.02)):
    """Raster ohne Phasensprung, aber mit kurzem Wackeln der Schlaege ab `ab`: der erste Abstand ist
    0,83 Perioden (bricht die Kette), danach laufen die Schlaege auf das alte Raster zurueck."""
    per = 60.0 / bpm
    t = raster(bpm, n)
    t[ab:ab + len(versatz)] += np.array(versatz) * per
    return t


def test_bruch_auf_gleichem_raster_ergibt_eine_kette():
    t = bruch_auf_gleichem_raster()
    z, n, info = nummeriere(t)
    assert info["ketten_roh"] == 2 and info["ketten"] == 1 and info["ketten_verbunden"] == 1
    assert len(z) == 300 and info["kette_schlaege"] == 300
    assert z[0] == pytest.approx(t[0]) and n[0] == 0 and n[-1] == 299
    assert np.array_equal(n, np.arange(300))
    assert info["warnungen"] == []


def test_bruch_auf_gleichem_raster_20ms_raster_der_quelle():
    t = auf_20ms(bruch_auf_gleichem_raster())
    z, n, info = nummeriere(t)
    assert info["ketten"] == 1 and info["kette_schlaege"] == 300 and n[-1] == 299


def test_lueckenzaehlung_nach_raster_nicht_nach_schlaganzahl():
    """Drei Schlaege fehlen hinter dem Bruch: die Nummer springt um 4, nicht um 1."""
    t = bruch_auf_gleichem_raster()
    t = np.delete(t, [110, 111, 112])
    z, n, info = nummeriere(t)
    assert info["ketten"] == 1 and len(z) == 297
    assert n[-1] == 299 and n[110] == 113                # Schlag 110 des Eingangs ist Schlag 113 des Rasters


def test_lueckenzaehlung_an_der_bruchstelle_selbst():
    """Zwei Schlaege fehlen genau an der Stelle des kurzen Abstands."""
    per = 60.0 / 128
    t = raster(128, 300)
    t = np.delete(t, [100, 101])
    t[100:104] -= 0.17 * per * np.array([1, 0.6, 0.3, 0.1])
    z, n, info = nummeriere(t)
    assert info["ketten"] == 1 and n[-1] == 299 and len(z) == 298


def test_phasensprung_um_halben_schlag_bleibt_getrennt():
    per = 60.0 / 128
    t = raster(128, 300)
    t[100:] += 0.5 * per
    z, n, info = nummeriere(t)
    assert info["ketten_roh"] == 2 and info["ketten"] == 2 and info["ketten_verbunden"] == 0
    assert info["kette_schlaege"] == 200 and z[0] == pytest.approx(t[100])
    assert any("200 von 300" in w for w in info["warnungen"])        # 67 % < 90 %
    assert any("Anfang" in w for w in info["warnungen"])             # Kette beginnt bei 47,6 s


def test_phasensprung_um_viertel_schlag_bleibt_getrennt():
    per = 60.0 / 128
    t = raster(128, 300)
    t[100:] += 0.25 * per
    z, n, info = nummeriere(t)
    assert info["ketten"] == 2 and info["kette_schlaege"] == 200


def test_phasengrenze_ist_eine_zehntel_periode():
    per = 60.0 / 128
    for versatz, verbunden in ((0.07, True), (0.13, False)):
        t = raster(128, 300)
        t[100:] += versatz * per
        t[99] -= 0.2 * per                                # Abstand 99 -> 100 ist 1,27 Perioden: bricht
        z, n, info = nummeriere(t)
        assert (info["ketten"] == 1) is verbunden, (versatz, info)


def test_anderes_tempo_bleibt_getrennt():
    per = 60.0 / 128
    vorn = raster(128, 150, t0=0.0)
    hinten = vorn[-1] + 1.5 * per + np.arange(150) * 60.0 / 133   # 3,9 % schneller, Luecke 1,5 Perioden
    z, n, info = nummeriere(np.concatenate([vorn, hinten]))
    assert info["ketten_roh"] == 2 and info["ketten"] == 2 and info["ketten_verbunden"] == 0


def test_tempo_pruefung_allein_wenn_die_phase_passt():
    """Gleiche Phase an der Naht, aber 3 % anderes Tempo: allein die Periodenpruefung trennt."""
    from werkstatt.karte import _anschluss
    za = raster(128, 100, t0=0.0)
    na = np.arange(100)
    pb = 60.0 / 128 * 1.03
    zb = za[-1] + pb + np.arange(100) * pb               # naechster Schlag nach genau einer (langsameren) Periode
    assert _anschluss(za, na, zb, np.arange(100)) is None
    zb2 = za[-1] + 60.0 / 128 + np.arange(100) * 60.0 / 128
    assert _anschluss(za, na, zb2, np.arange(100)) == 100


def test_zu_kurze_kette_wird_nicht_verbunden():
    """Unter MIN_SCHLAEGE Schlaegen ist das Raster nicht belastbar genug fuer die Phasenpruefung."""
    from werkstatt.karte import _anschluss
    per = 60.0 / 128
    za = raster(128, 100, t0=0.0)
    zb = za[-1] + per + np.arange(5) * per
    assert _anschluss(za, np.arange(100), zb, np.arange(5)) is None


def test_ohne_bruch_unveraendert():
    t = auf_20ms(raster(134, 300))
    z, n, info = nummeriere(t)
    assert info["ketten_roh"] == 1 and info["ketten"] == 1 and info["ketten_verbunden"] == 0
    assert np.array_equal(z, np.unique(t)) and np.array_equal(n, np.arange(300))
    assert info["warnungen"] == []


def test_warnung_wenn_kette_unter_90_prozent_traegt(caplog):
    per = 60.0 / 128
    vorn = raster(128, 40, t0=0.0) + per / 2
    hinten = 40 * per + per + raster(128, 100, t0=0.0)
    with caplog.at_level("WARNING", logger="werkstatt.karte"):
        z, n, info = nummeriere(np.concatenate([vorn, hinten]))
    assert info["kette_schlaege"] == 100
    assert any("Schlaege" in w and "%" in w for w in info["warnungen"])
    assert any(r.name == "werkstatt.karte" for r in caplog.records)


def test_warnung_wenn_anfang_ueber_30s_fehlt(caplog):
    per = 60.0 / 128
    vorn = raster(128, 80, t0=0.0) + per / 2             # 37,5 s Offbeat-Kette
    hinten = vorn[-1] + 1.0 * per + per / 2 + np.arange(700) * per
    with caplog.at_level("WARNING", logger="werkstatt.karte"):
        z, n, info = nummeriere(np.concatenate([vorn, hinten]))
    assert z[0] == pytest.approx(hinten[0])
    assert any("Anfang" in w for w in info["warnungen"]) and not any("Ende" in w for w in info["warnungen"])


# ---- Anker: Ketten gegen das Raster der Hauptkette pruefen, nicht nur gegen den Nachbarn (2026-10-17;
# "Wake up fucked up" und "Still I Am": Stoerketten zwischen den guten Ketten sperrten den Nachbar-Anschluss) ----

def gute_stoerung_gute(stoer_versatz=0.5, stoer_n=30, stoer_per_faktor=1.0, vorn_n=120, hinten_n=300, luecke=4):
    """gute Kette | kurze Stoerkette (Off-Beat bzw. anderes Tempo) | gute Kette, alle mit einem Schlag Abstand
    zwischen den Ketten auf dem Raster (die gute Kette hinten ist die laengste)."""
    per = 60.0 / 128
    vorn = raster(128, vorn_n, t0=0.0)
    s0 = vorn[-1] + 3 * per
    stoer = s0 + (stoer_versatz + np.arange(stoer_n) * stoer_per_faktor) * per
    k_hinten = int(np.ceil((stoer[-1] + 2.3 * per) / per)) + luecke
    hinten = k_hinten * per + np.arange(hinten_n) * per
    return vorn, stoer, hinten


def test_stoerkette_zwischen_zwei_guten_ketten_wird_uebersprungen():
    vorn, stoer, hinten = gute_stoerung_gute()
    t = np.concatenate([vorn, stoer, hinten])
    z, n, info = nummeriere(t)
    assert len(z) == len(vorn) + len(hinten)
    assert z[0] == pytest.approx(vorn[0]) and z[-1] == pytest.approx(hinten[-1])
    assert not np.any(np.isin(z, stoer))
    assert info["ketten_angeschlossen"] == 1 and info["stoerketten"] == 1
    per = 60.0 / 128
    assert np.all(np.abs(z - (n * per)) < 1e-9) and n[0] == 0        # Nummern nach Raster: die Luecke bleibt Luecke
    assert n[len(vorn)] - n[len(vorn) - 1] > 1
    assert info["warnungen"] == []


def test_stoerkette_links_der_hauptkette_wird_uebersprungen():
    vorn, stoer, hinten = gute_stoerung_gute(vorn_n=300, hinten_n=120)
    z, n, info = nummeriere(np.concatenate([vorn, stoer, hinten]))
    assert z[0] == pytest.approx(vorn[0]) and z[-1] == pytest.approx(hinten[-1])
    assert len(z) == 420 and info["stoerketten"] == 1


def test_mehrere_stoerketten_nacheinander():
    per = 60.0 / 128
    a = raster(128, 100, t0=0.0)
    s1 = a[-1] + 2.5 * per + np.arange(20) * per          # Off-Beat
    s2 = s1[-1] + 3.75 * per + np.arange(15) * per * 0.5   # Doppeltempo
    b0 = int(np.ceil((s2[-1] + 2 * per) / per)) + 2
    b = b0 * per + np.arange(250) * per
    z, n, info = nummeriere(np.concatenate([a, s1, s2, b]))
    assert len(z) == 350 and info["ketten_angeschlossen"] == 1 and info["stoerketten"] >= 1


def test_lange_zweite_kette_um_halben_schlag_bleibt_draussen():
    per = 60.0 / 128
    a = raster(128, 300, t0=0.0)
    stoer = a[-1] + 3 * per + 0.5 * per + np.arange(120) * per          # lang, aber halber Schlag daneben
    b0 = int(np.ceil((stoer[-1] + 2 * per) / per)) + 3
    b = b0 * per + np.arange(60) * per
    # b ist kurz: Hauptkette ist a (300); stoer liegt dazwischen, b traegt das Raster von a
    z, n, info = nummeriere(np.concatenate([a, stoer, b]))
    assert not np.any(np.isin(z, stoer))
    assert len(z) == 360 and info["ketten_angeschlossen"] == 1


def test_lange_zweite_kette_mit_halbem_schlag_ohne_dritte_wird_nicht_aufgenommen():
    per = 60.0 / 128
    a = raster(128, 300, t0=0.0)
    b = a[-1] + 4 * per + 0.5 * per + np.arange(200) * per
    z, n, info = nummeriere(np.concatenate([a, b]))
    assert len(z) == 300 and z[-1] == pytest.approx(a[-1])
    assert info["ketten_angeschlossen"] == 0 and info["stoerketten"] == 1
    assert any("Ende" in w for w in info["warnungen"]) or len(z) / 500 < 0.9


def test_zweite_lange_kette_in_anderem_tempo_bleibt_draussen():
    per = 60.0 / 128
    a = raster(128, 300, t0=0.0)
    b = a[-1] + 4.5 * per + np.arange(200) * 60.0 / 133          # 3,9 % schneller, Bruch ueber 4,5 Perioden
    z, n, info = nummeriere(np.concatenate([a, b]))
    assert info["ketten_roh"] == 2 and len(z) == 300 and info["ketten_angeschlossen"] == 0


def test_stoerkette_im_doppeltempo_zwischen_guten_ketten_faellt_weg():
    vorn, stoer, hinten = gute_stoerung_gute(stoer_versatz=0.25, stoer_n=60, stoer_per_faktor=0.5)
    z, n, info = nummeriere(np.concatenate([vorn, stoer, hinten]))
    assert len(z) == len(vorn) + len(hinten)        # die Doppeltempo-Schlaege fallen schon beim Entdoppeln weg


def test_anker_ueber_20ms_raster():
    vorn, stoer, hinten = gute_stoerung_gute()
    z, n, info = nummeriere(auf_20ms(np.concatenate([vorn, stoer, hinten])))
    assert len(z) == len(vorn) + len(hinten) and info["ketten_angeschlossen"] == 1


def test_tempowechsel_ueber_die_luecke_wird_nicht_uebernommen():
    """Die hintere Kette laeuft 1 % schneller/langsamer nicht, aber 3 % anders: bleibt draussen, auch mit Stoerkette davor."""
    per = 60.0 / 128
    vorn = raster(128, 300, t0=0.0)
    stoer = vorn[-1] + 3 * per + 0.5 * per + np.arange(20) * per
    hinten = stoer[-1] + 4 * per + np.arange(120) * 60.0 / 132
    z, n, info = nummeriere(np.concatenate([vorn, stoer, hinten]))
    assert len(z) == 300 and info["ketten_angeschlossen"] == 0


def test_langsame_drift_wird_stueckweise_gefolgt():
    """Tempo waechst um 1e-5 je Schlag (0,4 % ueber 400 Schlaege). Ein einziges Raster der Hauptkette, bis zum Anfang
    verlaengert, laege um Schlaege daneben; das schrittweise nachgefuehrte Raster folgt ihr durch die Stoerketten."""
    per0 = 60.0 / 128
    k = np.arange(420)
    t = np.cumsum(per0 * (1 + 1e-5 * k))
    stoer = np.zeros(len(t), bool)
    stoer[100:112] = True
    stoer[215:227] = True
    t_roh = np.where(stoer, t + 0.5 * per0 * (1 + 1e-5 * k), t)       # Off-Beat statt Raster
    z, n, info = nummeriere(t_roh)
    assert info["ketten_angeschlossen"] == 2 and info["stoerketten"] == 2
    assert len(z) == 420 - 24 and z[0] == pytest.approx(t[0]) and z[-1] == pytest.approx(t[-1])
    assert np.array_equal(n, k[~stoer])                                # Nummern nach Raster, Luecken bleiben
    # Gegenprobe: die Gerade der Hauptkette, ueber die Strecke verlaengert, verfehlt das Raster am Anfang deutlich
    hk = np.arange(227, 420)
    a, c = np.polyfit(hk, t[hk], 1)
    assert abs((t[0] - c) / a - 0) > 3 * 0.1                    # weit ueber PHASE_TOL


def test_lauf_ohne_stoerketten_bitgleich_zu_vorher():
    """Eine Kette, mehrere Ketten ohne Anschluss: die Aufnahme aendert nichts, wo nichts aufzunehmen ist."""
    t = auf_20ms(raster(134, 300))
    z, n, info = nummeriere(t)
    assert info["ketten_angeschlossen"] == 0 and info["stoerketten"] == 0
