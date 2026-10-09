import numpy as np

from werkstatt.phase import SR, phase_messen, sollzeiten


def kicks(zeiten, dauer_s, versatz_s=0.0, bass=True, seed=0):
    """Synthetische Kicks (Sinus-Sweep + Klick) bei zeiten + versatz_s, dazu Offbeat-Bass und Rauschen als Stoerer."""
    rng = np.random.default_rng(seed)
    x = 0.002 * rng.standard_normal(int(dauer_s * SR))
    n = int(0.25 * SR)
    tt = np.arange(n) / SR
    kick = 0.8 * np.sin(2 * np.pi * (55 + 120 * np.exp(-tt / 0.01)) * tt) * np.exp(-tt / 0.08)
    klick = 0.3 * rng.standard_normal(n) * np.exp(-tt / 0.002)
    for t in zeiten:
        i = int(round((t + versatz_s) * SR))
        if 0 <= i and i + n <= len(x):
            x[i:i + n] += kick + klick
    if bass:
        t = np.arange(len(x)) / SR
        x += 0.05 * np.sin(2 * np.pi * 110 * t) * (np.sin(2 * np.pi * t * 128 / 60 * 2) > 0)
    return x


RASTER = 2.0 + np.arange(120) * 60.0 / 128.0


def test_findet_bekannten_versatz():
    """Anschlaege 10 ms vor dem Raster: versatz -10 ms (Semantik korrektur.versatz_ms: negativ = zu frueh)."""
    m = phase_messen(kicks(RASTER, 70.0, versatz_s=-0.010), RASTER)
    assert m["ok"], m
    assert abs(m["versatz_ms"] + 10.0) < 0.6


def test_negativkontrolle_ohne_versatz():
    m = phase_messen(kicks(RASTER, 70.0), RASTER)
    assert m["ok"], m
    assert abs(m["versatz_ms"]) < 0.6


def test_spaete_anschlaege_positiv():
    m = phase_messen(kicks(RASTER, 70.0, versatz_s=0.007), RASTER)
    assert abs(m["versatz_ms"] - 7.0) < 0.6


def test_stille_reisst_das_tor():
    x = 0.002 * np.random.default_rng(1).standard_normal(70 * SR)
    m = phase_messen(x, RASTER)
    assert not m["ok"] and m["versatz_ms"] is None


def test_halbschlag_reisst_das_tor():
    """Kicks einen halben Schlag daneben (234 ms) liegen ausserhalb des Fensters: kein Phasenfehler, sondern ein
    anderes Problem; das Tor darf nicht 'ok' melden."""
    m = phase_messen(kicks(RASTER, 70.0, versatz_s=60.0 / 128.0 / 2), RASTER)
    assert not m["ok"]


def test_sollzeiten_starres_raster():
    f = {"basis_bpm": 128.0, "frames": 48000 * 10, "erster_schlag_frame": 903}
    s = sollzeiten(f)
    assert abs(s[0] - 903 / 48000) < 1e-12
    assert np.allclose(np.diff(s), 60.0 / 128.0)
    assert s[-1] <= 10.0


def kicks_wandernd(zeiten, dauer_s, amplitude_s, periode_s, seed=0):
    """Wie kicks, aber jeder Kick um amplitude * sin(2 pi t / periode) verschoben: ein schwankendes Stueck."""
    zeiten = np.asarray(zeiten, dtype=float)
    return kicks(zeiten + amplitude_s * np.sin(2 * np.pi * zeiten / periode_s), dauer_s, seed=seed)


RASTER_LANG = 2.0 + np.arange(400) * 60.0 / 128.0


def test_abschnitte_folgen_der_schwankung():
    """+-10 ms Welle ueber 60 s: die Kurve je Takt trifft die Wahrheit in der Takt-Mitte auf 1,5 ms."""
    from werkstatt.phase import abschnitte_messen
    x = kicks_wandernd(RASTER_LANG, 200.0, 0.010, 60.0)
    m = abschnitte_messen(x, RASTER_LANG)
    assert m["ok"], m
    for t in m["takte"][3:-3]:
        mitte = RASTER_LANG[t["ab_beat"]:t["bis_beat"]].mean()
        assert abs(t["versatz_ms"] - 10.0 * np.sin(2 * np.pi * mitte / 60.0)) < 1.5, t
    assert m["rest_ms"] < 3.0


def test_abschnitte_konstant_ist_flach():
    from werkstatt.phase import abschnitte_messen
    m = abschnitte_messen(kicks(RASTER_LANG, 200.0, versatz_s=-0.006), RASTER_LANG)
    assert m["ok"], m
    v = np.array([t["versatz_ms"] for t in m["takte"]])
    assert np.all(np.abs(v + 6.0) < 0.8)


def test_abschnitte_stille_reisst():
    from werkstatt.phase import abschnitte_messen
    m = abschnitte_messen(0.002 * np.random.default_rng(2).standard_normal(200 * SR), RASTER_LANG)
    assert not m["ok"] and m["takte"] == []


def test_abschnitte_clap_hinter_dem_kick_reisst():
    """Wie Lovelee Dae: auf 2 und 4 liegt der Hochband-Einsatz 25 ms spaeter (Clap). Das Tor muss das erkennen."""
    from werkstatt.phase import abschnitte_messen
    zeiten = RASTER_LANG + np.where(np.arange(len(RASTER_LANG)) % 2 == 1, 0.025, 0.0)
    m = abschnitte_messen(kicks(zeiten, 200.0), RASTER_LANG)
    assert not m["ok"] and "Schlagpositionen" in m["grund"], m


def test_tonklick_ohne_hochband_wird_nicht_vermessen():
    """konst134-Fall: 1-kHz-Ton mit hartem Ende nach 60 ms. Das Ende darf nicht als Einsatz zaehlen."""
    from werkstatt.phase import einsaetze
    x = 0.002 * np.random.default_rng(3).standard_normal(70 * SR)
    L = int(0.060 * SR)
    t = np.arange(L) / SR
    burst = 0.7 * np.sin(2 * np.pi * 1000 * t) * np.minimum(1, t / 0.002) * np.exp(-t / 0.030)
    for z in RASTER:
        i = int(round(z * SR))
        x[i:i + L] += burst
    e = einsaetze(x, RASTER)
    d = (e - RASTER)[~np.isnan(e)] * 1000
    assert len(d) == 0 or np.all(np.abs(d) < 5.0), np.round(d[:8], 1)
