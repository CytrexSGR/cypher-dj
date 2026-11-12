"""Time map per bar: every quantity is checked on a synthetic signal with a known target value."""
import json
import math

import numpy as np
import pytest

from werkstatt import zeitkarte as zk

SR = zk.SR
BPM120 = [[0.5 * i, float(i)] for i in range(0, 200)]      # 120 BPM, beat i at 0.5 * i s


def takte_const(n=8, takt_s=2.0):
    return [{"nr": i, "start_s": i * takt_s, "ende_s": (i + 1) * takt_s, "eins": True} for i in range(n)]


def stereo(l, r=None):
    r = l if r is None else r
    return np.stack([l, r], axis=1).astype(np.float32)


def sinus(f, dauer_s, amp=0.5):
    t = np.arange(int(dauer_s * SR)) / SR
    return amp * np.sin(2 * np.pi * f * t)


# ---------------------------------------------------------------- grid
def test_raster_mit_tempowechsel_exakt():
    # beats 0..16 at 0.5 s, then 0.4 s per beat (150 BPM); Takt-Eins at beat 1, 5, 9, ...
    karte = [[0.5 * i, float(i)] for i in range(17)] + [[8.0 + 0.4 * (i - 16), float(i)] for i in range(17, 40)]
    takte, warn = zk.takt_raster(karte, erste_eins_beat=1)
    starts = [t["start_s"] for t in takte]
    assert starts[:5] == pytest.approx([0.5, 2.5, 4.5, 6.5, 8.4], abs=1e-9)
    assert starts[5] == pytest.approx(10.0, abs=1e-9)          # beat 21: 8.0 + 5 * 0.4
    assert takte[3]["ende_s"] == pytest.approx(8.4, abs=1e-9)
    assert [t["nr"] for t in takte[:3]] == [0, 1, 2]
    assert all(t["eins"] for t in takte)
    assert warn == []


def test_raster_halbtempo_zaehlung_mit_bruchbeats():
    karte = [[0.5 * i, 0.5 * i] for i in range(0, 80)]       # v = 0.5: quell_beat steps by 0.5 per entry
    takte, _ = zk.takt_raster(karte, erste_eins_beat=0)
    assert takte[0]["start_s"] == pytest.approx(0.0)
    assert takte[1]["start_s"] == pytest.approx(4.0)          # 4 musical beats = 8 entries = 4 s


def test_raster_extrapoliert_bis_zur_dauer_aber_nicht_darueber():
    karte = [[0.5 * i, float(i)] for i in range(0, 17)]      # map ends at 8 s
    t_ohne, _ = zk.takt_raster(karte, 0)
    t_mit, _ = zk.takt_raster(karte, 0, dauer_s=13.0)
    assert len(t_ohne) == 4 and len(t_mit) == 6
    assert t_mit[-1]["ende_s"] <= 13.0


@pytest.mark.parametrize("karte", [[], [[0.0, 0.0]], [[1.0, 0.0], [0.5, 1.0]]])
def test_raster_leere_oder_kaputte_karte(karte):
    takte, warn = zk.takt_raster(karte, 0)
    assert takte == [] and warn


def test_raster_zu_kurz_fuer_einen_takt():
    takte, warn = zk.takt_raster([[0.0, 0.0], [0.5, 1.0], [1.0, 2.0]], 0)
    assert takte == [] and warn


# ---------------------------------------------------------------- brightness / bass share
def test_sinus_100hz_schwerpunkt_und_bassanteil():
    x = stereo(sinus(100, 16.0))
    takte = takte_const()
    sp = zk.schwerpunkt_je_takt(x, takte)
    ba = zk.bassanteil_je_takt(x, takte)
    assert all(abs(v - 100.0) < 5.0 for v in sp), sp
    assert all(v > 0.98 for v in ba), ba


def test_sinus_5khz_schwerpunkt_hoch_bassanteil_null():
    x = stereo(sinus(5000, 8.0))
    takte = takte_const(4)
    assert all(abs(v - 5000.0) < 60.0 for v in zk.schwerpunkt_je_takt(x, takte))
    assert all(v < 0.02 for v in zk.bassanteil_je_takt(x, takte))


# ---------------------------------------------------------------- stereo
def test_mono_breite_null_korrelation_eins():
    x = stereo(sinus(220, 8.0) + 0.1 * sinus(3000, 8.0))
    br, ko = zk.breite_je_takt(x, takte_const(4))
    assert all(v == pytest.approx(0.0, abs=1e-6) for v in br)
    assert all(v == pytest.approx(1.0, abs=1e-6) for v in ko)


def test_gegenphase_korrelation_minus_eins_breite_gedeckelt():
    s = sinus(220, 8.0)
    br, ko = zk.breite_je_takt(stereo(s, -s), takte_const(4))
    assert all(v == pytest.approx(-1.0, abs=1e-6) for v in ko)
    assert all(v == zk.BREITE_MAX for v in br)


def test_halb_breit_seite_mitte_verhaeltnis():
    rng = np.random.default_rng(1)
    m = rng.standard_normal(8 * SR)
    s = 0.5 * rng.standard_normal(8 * SR)
    x = stereo(m + s, m - s)                                   # M = m, S = s: ratio about 0.5
    br, ko = zk.breite_je_takt(x, takte_const(4))
    assert all(abs(v - 0.5) < 0.05 for v in br), br
    assert all(0.5 < v < 0.9 for v in ko)


# ---------------------------------------------------------------- onsets
def kick_burst(n_samples):
    t = np.arange(n_samples) / SR
    return 0.8 * np.sin(2 * np.pi * (50 + 100 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.08)


def hat_burst(n_samples, rng):
    t = np.arange(n_samples) / SR
    from scipy import signal
    sos = signal.butter(4, 7000, "highpass", fs=SR, output="sos")
    return 0.4 * signal.sosfilt(sos, rng.standard_normal(n_samples)) * np.exp(-t / 0.02)


def test_anschlaege_kick_und_hat_gezaehlt():
    rng = np.random.default_rng(2)
    takte = takte_const(8)
    x = 0.001 * rng.standard_normal(16 * SR)
    nk = int(0.25 * SR)
    nh = int(0.06 * SR)
    soll_k, soll_h = [], []
    for i in range(8):
        k = 4 if i % 2 == 0 else 2                              # 4 kicks in even bars, 2 in odd bars
        h = 8 if i < 4 else 0                                   # 8 hats in the first four bars
        soll_k.append(k)
        soll_h.append(h)
        for j in range(k):
            a = int((i * 2.0 + j * (2.0 / k) + 0.05) * SR)
            x[a:a + nk] += kick_burst(nk)
        for j in range(h):
            a = int((i * 2.0 + j * 0.25 + 0.125) * SR)
            x[a:a + nh] += hat_burst(nh, rng)
    kicks, hats = zk.anschlaege_je_takt(stereo(x), takte)
    assert kicks == soll_k
    assert hats == soll_h


# ---------------------------------------------------------------- pump depth
def sidechain(duck_db, dauer_s=16.0, f=100.0, beat_s=0.5, tau=0.1):
    x = sinus(f, dauer_s)
    t = np.arange(len(x)) / SR
    g0 = 10 ** (-duck_db / 20)
    gain = 1.0 - (1.0 - g0) * np.exp(-(t % beat_s) / tau)
    return stereo(x * gain)


def test_pumptiefe_sechs_db_duck():
    pump = zk.pump_je_takt(sidechain(6.0), takte_const(8))
    assert all(abs(v - 6.0) < 1.0 for v in pump[1:-1]), pump  # tolerance +-1 dB (10 ms smoothing eats a little)


def test_pumptiefe_drei_db_duck_haelfte():
    pump = zk.pump_je_takt(sidechain(3.0), takte_const(8))
    assert all(abs(v - 3.0) < 0.7 for v in pump[1:-1]), pump      # bars 0 and last: the tone starts and stops abruptly (filter edge effects)


def test_pumptiefe_ohne_duck_null():
    pump = zk.pump_je_takt(stereo(sinus(100, 16.0)), takte_const(8))
    assert all(v < 0.3 for v in pump[1:-1]), pump                 # bars 0 and last: the tone starts and stops abruptly (filter edge effects)


# ---------------------------------------------------------------- loudness
def test_lautheit_stufen_und_stille():
    x = np.concatenate([sinus(1000, 4.0, 0.5), sinus(1000, 4.0, 0.25), np.zeros(4 * SR)])
    l = zk.lautheit_je_takt(stereo(x), takte_const(6))
    assert l[0] - l[2] == pytest.approx(6.02, abs=0.1)         # amplitude / 2 = -6 dB
    assert l[4] < -50.0 and l[5] is None                       # bar 4 only holds the K-filter tail of the step


# ---------------------------------------------------------------- breaks
def folge(n=120, lufs=-10.0, bass=0.9):
    return [lufs] * n, [bass] * n


def test_breaks_kurz_und_lang_laenger_als_altes_fenster():
    lufs, bass = folge(140)
    for i in range(20, 36):                                     # 16 bars
        lufs[i], bass[i] = -17.0, 0.05
    for i in range(70, 102):                                    # 32 bars, longer than the old 33-bar window median could take
        lufs[i], bass[i] = -17.0, 0.1
    br = zk.breaks_finden(lufs, bass)
    assert [(b["start_takt"], b["laenge_takte"]) for b in br] == [(20, 16), (70, 32)]
    assert all(b["grund"] == "beides" and b["bass_weg"] for b in br)
    assert br[0]["tiefe_db"] == pytest.approx(7.0, abs=0.2)


def test_breaks_nur_bass_weg_lautheit_fast_gleich():
    lufs, bass = folge(80)
    for i in range(30, 42):
        lufs[i], bass[i] = -10.5, 0.05
    br = zk.breaks_finden(lufs, bass)
    assert [(b["start_takt"], b["laenge_takte"], b["grund"], b["bass_weg"]) for b in br] == [(30, 12, "bass", True)]


def test_breaks_nur_lautheit_bass_bleibt():
    lufs, bass = folge(80)
    for i in range(30, 42):
        lufs[i] = -17.0
    br = zk.breaks_finden(lufs, bass)
    assert [(b["grund"], b["bass_weg"]) for b in br] == [("lautheit", False)]


def test_breaks_kleine_luecke_wird_geschlossen_grosse_nicht():
    lufs, bass = folge(100)
    for i in list(range(30, 40)) + list(range(41, 50)):         # one full bar (40) in between
        lufs[i], bass[i] = -17.0, 0.05
    br = zk.breaks_finden(lufs, bass)
    assert [(b["start_takt"], b["laenge_takte"]) for b in br] == [(30, 20)]
    lufs, bass = folge(100)
    for i in list(range(30, 40)) + list(range(43, 50)):         # three full bars in between
        lufs[i], bass[i] = -17.0, 0.05
    assert len(zk.breaks_finden(lufs, bass)) == 2


def test_breaks_keine_falschmeldung_und_dauerhaft_wenig_bass():
    lufs, bass = folge(80)
    assert zk.breaks_finden(lufs, bass) == []
    assert zk.breaks_finden(*folge(80, bass=0.08)) == []        # always little bass: no permanent break
    rng = np.random.default_rng(3)
    lufs = list(-9.0 + rng.normal(0, 0.3, 80))
    bass = list(0.92 + rng.normal(0, 0.02, 80))
    assert zk.breaks_finden(lufs, bass) == []


def test_breaks_intro_outro_und_einzelner_takt_und_none():
    lufs = [-20.0] * 8 + [-10.0] * 40 + [-20.0] * 8             # quiet intro and outro
    assert zk.breaks_finden(lufs) == []
    bass = [0.0] * 8 + [0.9] * 40 + [0.0] * 8                   # intro without bass stays exempt
    assert zk.breaks_finden(lufs, bass) == []
    lufs, bass = folge(40)
    lufs[20], bass[20] = -25.0, 0.0                             # one bar only
    lufs[30:33] = [None, None, None]
    bass[30:33] = [None, None, None]                            # silence is not a break
    assert zk.breaks_finden(lufs, bass) == []
    assert zk.breaks_finden([]) == [] and zk.breaks_finden([None] * 10, [None] * 10) == []


# ---------------------------------------------------------------- whole
def material(karte=BPM120, eins=0, unsicher=False, dauer=16.0):
    return {"material_id": "t0", "quelle": {"datei": "x", "sr": 48000, "kanaele": 2, "dauer_s": dauer},
            "tempo_karte_quelle": karte,
            "raster": {"erste_eins_quell_beat": eins, "erste_eins_unsicher": unsicher, "tempo_vielfaches": 1.0,
                       "taktart": 4}}


def test_gesamt_schema_und_json_ohne_nan():
    x = sidechain(6.0, 16.0)
    z = zk.zeitkarte_berechnen(material(unsicher=True), x)
    assert z["schema"] == "zeitkarte/1" and z["track"] == "t0"
    assert len(z["takte"]) == 8
    t0 = z["takte"][0]
    assert set(t0) == {"nr", "start_s", "ende_s", "eins", "lufs", "schwerpunkt_hz", "bassanteil", "kicks", "hats",
                       "breite", "korrelation", "pump_db"}
    assert any("Eins" in w for w in z["warnungen"])
    assert z["breaks_anzahl"] == len(z["breaks"]) == 0
    assert z["tempo"]["bpm_mittel"] == pytest.approx(120.0, abs=0.01)
    json.dumps(z, allow_nan=False)


def test_gesamt_stille_null_statt_nan():
    z = zk.zeitkarte_berechnen(material(), np.zeros((16 * SR, 2), np.float32))
    for t in z["takte"]:
        for k in ("lufs", "schwerpunkt_hz", "bassanteil", "kicks", "hats", "breite", "korrelation", "pump_db"):
            assert t[k] is None, (k, t)
    assert z["warnungen"]
    json.dumps(z, allow_nan=False)


def test_gesamt_audio_kuerzer_als_raster():
    z = zk.zeitkarte_berechnen(material(dauer=16.0), stereo(sinus(100, 9.0)))
    assert len(z["takte"]) == 4                                 # only complete bars: 9 s -> 4 bars of 2 s
    assert any("shorter" in w for w in z["warnungen"])


def test_gesamt_leere_karte():
    z = zk.zeitkarte_berechnen(material(karte=[]), stereo(sinus(100, 4.0)))
    assert z["takte"] == [] and z["breaks"] == [] and z["warnungen"]
    json.dumps(z, allow_nan=False)


def test_gesamt_monodatei_eindimensional_und_eine_spalte():
    s = sinus(100, 16.0)
    z1 = zk.zeitkarte_berechnen(material(), s.astype(np.float32))
    z2 = zk.zeitkarte_berechnen(material(), s.astype(np.float32)[:, None])
    z3 = zk.zeitkarte_berechnen(material(), stereo(s))
    assert z1["takte"][2]["lufs"] == z2["takte"][2]["lufs"] == z3["takte"][2]["lufs"]
    assert z1["takte"][2]["breite"] == pytest.approx(0.0, abs=1e-6)
    assert z1["takte"][2]["korrelation"] == pytest.approx(1.0, abs=1e-6)


def test_gesamt_zu_kurzes_audio_ohne_takt():
    z = zk.zeitkarte_berechnen(material(), stereo(sinus(100, 0.5)))
    assert z["takte"] == [] and z["warnungen"]
