"""Paket 1.13 Warp, Slice 3b (AK18 neu gefasst): der Kick-Messer. Eichung an bekannter Wahrheit, bevor er einen echten Track misst:
Kick allein → Rest ≈ 0; Kick mit Bassnote 25 ms dahinter im selben Band → er nimmt den Kick (das alte Tief-Band-Tor fand hier zwei Ereignisse);
Takte ohne Kick → NaN statt Fehltreffer; Jitter ±20 ms → er zeigt ihn; Vergleich Export gegen Quelle → klein bei treuem Warp, reißt bei verschobenem."""
import numpy as np

from werkstatt import kick_messer as km

SR = 48000
BPM = 128.0
P = 60.0 / BPM


def kick(amp=0.9, schnell=False):
    t = np.arange(int(0.25 * SR)) / SR
    if schnell:   # Sweep von 245 Hz, kurz (zweiter Kick-Typ der Eichung)
        return amp * np.sin(2 * np.pi * np.cumsum(45 + 200 * np.exp(-t / 0.015)) / SR) * np.exp(-t / 0.2)
    return amp * np.sin(2 * np.pi * np.cumsum(50 + 100 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.12)


def bassnote(amp=0.9, f=70.0, dauer=0.18):
    t = np.arange(int(dauer * SR)) / SR
    h = np.minimum(1, t / 0.004) * np.minimum(1, (dauer - t) / 0.01)
    return amp * np.sin(2 * np.pi * f * t) * h


def lege(x, s, k):
    a = int(round(s * SR))
    e = min(len(x), a + len(k))
    if 0 <= a < len(x):
        x[a:e] += k[:e - a]


def spur(zeiten, dauer_s, bass_nach_ms=None, bass_amp=0.9, schnell=False):
    x = np.zeros(int(dauer_s * SR))
    for s in zeiten:
        lege(x, s, kick(schnell=schnell))
        if bass_nach_ms is not None:
            lege(x, s + bass_nach_ms / 1000, bassnote(bass_amp))
    return x


def test_kick_allein_rest_unter_1ms():
    b = 0.3 + np.arange(100) * P
    for schnell in (False, True):
        r = km.rest_ms(km.einsaetze(spur(b, 100 * P + 1, schnell=schnell), b), b)
        assert np.isfinite(r).sum() == 100
        assert abs(np.median(r)) <= 1.0 and np.percentile(np.abs(r), 90) <= 1.5, (schnell, np.median(r), np.percentile(np.abs(r), 90))


def test_bassnote_dahinter_wird_nicht_genommen():
    b = 0.3 + np.arange(100) * P
    for amp in (0.9, 1.8):   # gleich laut und doppelt so laut wie der Kick
        for schnell in (False, True):
            r = km.rest_ms(km.einsaetze(spur(b, 100 * P + 1, bass_nach_ms=25, bass_amp=amp, schnell=schnell), b), b)
            assert np.isfinite(r).sum() == 100
            assert np.percentile(np.abs(r), 90) <= 2.0, (amp, schnell, np.percentile(np.abs(r), 90), np.median(r))


def test_takte_ohne_kick_sind_nan():
    b = 0.3 + np.arange(64) * P
    mit = np.r_[b[:16], b[32:]]   # Takte 5 bis 8 ohne Kick (Break)
    e = km.einsaetze(spur(mit, 64 * P + 1), b)
    assert np.isnan(e[16:32]).all() and np.isfinite(e[:16]).all() and np.isfinite(e[32:]).all()


def test_jitter_wird_gezeigt():
    rng = np.random.default_rng(7)
    b = 0.3 + np.arange(100) * P
    j = rng.uniform(-0.02, 0.02, 100)
    r = km.rest_ms(km.einsaetze(spur(b + j, 100 * P + 1), b), b)
    assert np.percentile(np.abs(r - j * 1000), 90) <= 1.5
    assert np.percentile(np.abs(r), 90) >= 15


def test_vergleich_treu_klein_verschoben_reisst():
    # Quelle mit schwankendem Tempo (Karte = wahre Schlagzeiten), Export auf 128 starr (Raster = Projekt-Beats): ein treuer Warp legt jeden Kick
    # mit seinem Rest gegen die Karte auf den Rasterschlag. Der Rest der Quelle (Bass dahinter, Kick 3 ms vor der Karte) muss sich herauskürzen.
    rng = np.random.default_rng(3)
    karte = 0.2 + np.cumsum(np.r_[0, 60 / (126 + 4 * rng.standard_normal(99))])
    eigen = -0.003 + rng.uniform(-0.002, 0.002, 100)
    quelle = spur(karte + eigen, karte[-1] + 1, bass_nach_ms=25)
    raster = 0.5 + np.arange(100) * P
    treu = spur(raster + eigen, raster[-1] + 1, bass_nach_ms=25)
    v = km.vergleich(treu, raster, quelle, karte, art="koerper")
    assert v["ok"] is True and v["paare"] == 100 and v["wert_ms"] <= 1.5, v
    falsch = spur(raster + eigen + np.where(np.arange(100) % 2, 0.015, 0), raster[-1] + 1, bass_nach_ms=25)
    w = km.vergleich(falsch, raster, quelle, karte, art="koerper")
    assert w["ok"] is False and w["paare"] == 100 and w["wert_ms"] > 8.0, w


def test_zu_wenige_paare_nicht_ok():
    b = 0.3 + np.arange(40) * P
    x = spur(b, 40 * P + 1)
    v = km.vergleich(x, b, x, b, art="koerper")
    assert v["ok"] is False and v["paare"] == 40


def test_offbeat_bass_davor_wird_nicht_genommen():
    # Techno: Bass auf dem Offbeat, lauter als der Kick (erste Erhebung 29.10.: Fenster ±½ Schlag nahm ihn, Median −230 ms an 4 von 5 Tracks)
    b = 0.6 + np.arange(100) * P
    x = spur(b, 100 * P + 1)
    for s in b - P / 2:
        lege(x, s, bassnote(1.8, dauer=0.15))
    r = km.rest_ms(km.einsaetze(x, b), b)
    assert np.isfinite(r).sum() == 100
    assert np.percentile(np.abs(r), 90) <= 2.0, (np.median(r), np.percentile(np.abs(r), 90))


def test_sechzehntel_bass_wird_nicht_genommen():
    # Bass auf den Sechzehnteln um den Schlag (−¼, +¼, +½), lauter als der Kick (zweite Erhebung 29.10.: Median −114 ms = Fensterrand)
    b = 0.6 + np.arange(100) * P
    x = spur(b, 100 * P + 1)
    for s in b:
        for v in (-0.25, 0.25, 0.5):
            lege(x, s + v * P, bassnote(1.8, dauer=0.09))
    r = km.rest_ms(km.einsaetze(x, b), b)
    assert np.isfinite(r).sum() == 100
    assert np.percentile(np.abs(r), 90) <= 2.0, (np.median(r), np.percentile(np.abs(r), 90))


def test_zwei_gipfel_mehrdeutig_und_vergleich_folgt_der_quelle():
    # Zwei gleich starke Anstiege 30 ms auseinander je Schlag (Gegenprobe a9b19ad5): als mehrdeutig gemeldet; ein um 15 ms verschobener Export reißt
    # in seiner wahren Größe gemessen, weil er am Gipfel der Quelle gesucht wird (Mutation: ohne lage_ms springt „nächster zur Null“ zum anderen Gipfel)
    b = 0.6 + np.arange(100) * P
    def doppel(zeiten):
        x = spur(zeiten - 0.020, 100 * P + 1)
        for s in zeiten + 0.0105:
            lege(x, s, kick())
        return x
    _, info = km.einsaetze(doppel(b), b, mit_lage=True)
    assert info["mehrdeutig"] is True and len(info["gipfel_ms"]) >= 2, info
    v = km.vergleich(doppel(b + 0.006), b, doppel(b), b, art="koerper")   # 6 ms Versatz wird als 6 ms gemessen, nicht als Sprung zum anderen Gipfel (≈ 24 ms)
    assert v["mehrdeutig"] is True and 5.0 <= v["wert_ms"] <= 7.0 and v["ok"] is True, v
    u = km.vergleich(doppel(b + 0.015), b, doppel(b), b, art="koerper")
    assert u["ok"] is False and u["wert_ms"] > 8.0, u
    w = km.vergleich(doppel(b), b, doppel(b), b, art="koerper")
    assert w["ok"] is True and w["wert_ms"] <= 1.0, w


def test_eindeutiger_kick_nicht_mehrdeutig():
    b = 0.6 + np.arange(100) * P
    _, info = km.einsaetze(spur(b, 100 * P + 1, bass_nach_ms=25), b, mit_lage=True)
    assert abs(info["lage_ms"]) <= 1.0, info


# --- art "anschlag" (Vorgabe seit 2026-10-29): Versatz je Schlag aus der Kreuzkorrelation der Hochpass-Hüllkurven ---

def klick(amp=0.3, f=3000.0):
    t = np.arange(int(0.004 * SR)) / SR
    return amp * np.sin(2 * np.pi * f * t) * np.exp(-t / 0.001)


def klickspur(zeiten, dauer_s, spitzen=((0.0, 1.0),), rng=None, bass_nach_ms=25):
    """Kick mit Klick (Körper + Hochton-Anschlag), Bass dahinter; spitzen: (Lage s, Pegel) weiterer Hochton-Spitzen je Schlag, mit rng je Schlag
    zufällig gewichtet (Funk Phenomena: Spitzen bei −10, 0 und +13 ms, die steilste kippt)."""
    x = spur(zeiten, dauer_s, bass_nach_ms=bass_nach_ms)
    for s in zeiten:
        for lage, pegel in spitzen:
            g = pegel * (rng.uniform(0.5, 1.5) if rng is not None else 1.0)
            lege(x, s + lage, klick(0.3 * g))
    return x


def test_versatz_treu_null_verschoben_in_wahrer_groesse():
    # Fehlerfall Queen of Pain: die ganze Fassung 20 ms früher. Treu → 0; −20 ms und +31 ms (Klickspur 124 → 128) werden in ihrer Größe gemessen
    rng = np.random.default_rng(5)
    karte = 0.3 + np.cumsum(np.r_[0, 60 / (126 + 3 * rng.standard_normal(99))])
    quelle = klickspur(karte, karte[-1] + 1)
    raster = 0.5 + np.arange(100) * P
    for soll_ms in (0.0, -20.0, 31.0):
        v = km.versatz(klickspur(raster + soll_ms / 1000, raster[-1] + 1), raster, quelle, karte)
        assert np.isfinite(v).sum() >= 95, soll_ms
        assert abs(np.nanmedian(v) - soll_ms) <= 0.5 and np.nanpercentile(np.abs(v - soll_ms), 90) <= 1.0, (soll_ms, np.nanmedian(v))


def test_vergleich_anschlag_reisst_bei_konstantem_versatz_wo_der_koerper_es_kann_auch():
    raster = 0.5 + np.arange(100) * P
    quelle = klickspur(raster, raster[-1] + 1)
    treu = km.vergleich(klickspur(raster, raster[-1] + 1), raster, quelle, raster)
    assert treu["ok"] is True and treu["art"] == "anschlag" and treu["paare"] >= 95 and treu["wert_ms"] <= 1.0, treu
    falsch = km.vergleich(klickspur(raster - 0.020, raster[-1] + 1), raster, quelle, raster)
    assert falsch["ok"] is False and 19.0 <= -falsch["median_ms"] <= 21.0, falsch


def test_mehrere_hochton_spitzen_kippen_den_versatz_nicht():
    # Negativ-Kontrolle aus Funk Phenomena: drei Spitzen je Schlag mit wechselnden Pegeln. Die Wahl des steilsten Anstiegs springt zwischen ihnen
    # (anschlaege, gegen dieselbe Spur mit neuen Pegeln: Streuung ≥ 10 ms), der Versatz nicht.
    sp = ((-0.010, 1.0), (0.0, 1.0), (0.013, 1.0))
    raster = 0.5 + np.arange(100) * P
    quelle = klickspur(raster, raster[-1] + 1, sp, np.random.default_rng(1))
    export = klickspur(raster, raster[-1] + 1, sp, np.random.default_rng(2))
    gewaehlt = km.rest_ms(km.anschlaege(export, raster), raster) - km.rest_ms(km.anschlaege(quelle, raster), raster)
    assert np.nanpercentile(np.abs(gewaehlt), 90) >= 10, np.nanpercentile(np.abs(gewaehlt), 90)
    v = km.vergleich(export, raster, quelle, raster)
    assert v["ok"] is True and v["wert_ms"] <= 3.0, v
    w = km.vergleich(klickspur(raster + 0.012, raster[-1] + 1, sp, np.random.default_rng(2)), raster, quelle, raster)
    assert w["ok"] is False and 10.0 <= w["median_ms"] <= 14.0, w


def test_versatz_ohne_anschlag_nan_und_rand_nan():
    raster = 0.5 + np.arange(64) * P
    mit = np.r_[raster[:16], raster[32:]]                     # Takte 5 bis 8 ohne Kick
    quelle = klickspur(mit, raster[-1] + 1)
    v = km.versatz(klickspur(mit, raster[-1] + 1), raster, quelle, raster)
    assert np.isnan(v[16:32]).all() and np.isfinite(v[:16]).all() and np.isfinite(v[33:]).all()
    # 60 ms daneben liegt außerhalb der Suche (±40 ms): NaN, kein Versatz von 40 ms
    weit = km.versatz(klickspur(raster + 0.060, raster[-1] + 1), raster, klickspur(raster, raster[-1] + 1), raster)
    assert not np.any(np.abs(weit[np.isfinite(weit)]) >= 39.5), weit


def test_anschlaege_eichung():
    b = 0.3 + np.arange(100) * P
    r = km.rest_ms(km.anschlaege(klickspur(b, 100 * P + 1), b), b)
    assert np.isfinite(r).sum() == 100 and abs(np.median(r)) <= 1.0 and np.percentile(np.abs(r), 90) <= 1.5, (np.median(r),)


def test_versatz_dehnt_die_quelle_aufs_oertliche_tempo():
    # Quelle 100 BPM, Export 128: der Warp staucht auch die Abstände der Hochton-Spitzen eines Schlags (×100/128). Ohne Dehnung der Quelle passt das
    # Muster nicht mehr und der Gipfel wandert (Mutation dehn = 1.0)
    sp = ((-0.030, 1.0), (0.0, 0.6), (0.045, 1.0))
    karte = 0.5 + np.arange(80) * 0.6
    raster = 0.5 + np.arange(80) * P
    quelle = klickspur(karte, karte[-1] + 1, sp, bass_nach_ms=None)
    export = klickspur(raster, raster[-1] + 1, tuple((l * 100 / 128, g) for l, g in sp), bass_nach_ms=None)
    v = km.versatz(export, raster, quelle, karte)
    assert np.isfinite(v).sum() >= 75 and np.nanpercentile(np.abs(v), 90) <= 1.0, (np.nanmedian(v), np.nanpercentile(np.abs(v), 90))
