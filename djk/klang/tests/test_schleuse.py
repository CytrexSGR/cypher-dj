import json, subprocess, sys
import numpy as np
from klang import schleuse, wav
from tests.hilfen import sinus, SR

def test_sauberes_signal_besteht():
    u = schleuse.urteil(sinus(440, -14.0, 5.0), SR)
    assert u["bestanden"] is True and u["verstoesse"] == []

def test_geclipptes_signal_faellt_durch_mit_grund():
    x = np.clip(sinus(440, 0.0, 5.0) * 1.5, -1, 1)
    u = schleuse.urteil(x, SR)
    assert u["bestanden"] is False
    assert {"true_peak", "clips"} <= {v["kriterium"] for v in u["verstoesse"]}

def test_gegenphasig_faellt_durch():
    x = sinus(440, -14.0, 5.0); x[:, 1] *= -1
    assert "korrelation" in {v["kriterium"] for v in schleuse.urteil(x, SR)["verstoesse"]}

def test_leere_aufnahme_faellt_durch():
    assert "lautheit" in {v["kriterium"] for v in schleuse.urteil(np.zeros((SR * 5, 2), np.float32), SR)["verstoesse"]}

def test_referenz_liefert_differenzen():
    u = schleuse.urteil(sinus(440, -14.0, 5.0), SR, referenz=sinus(440, -20.0, 5.0))
    assert abs(u["referenz"]["lautheit_diff_db"] - 6.0) < 0.2
    assert set(u["referenz"]["baender_diff_db"]) == {"sub", "tief", "tiefmitte", "mitte", "praesenz", "hoch"}

def test_cli_schreibt_json_und_exitcode(tmp_path):
    p = tmp_path / "m.wav"; wav.schreibe(p, np.clip(sinus(440, 0, 5) * 1.5, -1, 1), SR)
    r = subprocess.run([sys.executable, "-m", "klang.schleuse", str(p), "--json", str(tmp_path / "u.json")],
                       capture_output=True, text=True, cwd=str(tmp_path.parent), env={"PYTHONPATH": schleuse.PAKET_WURZEL})
    assert r.returncode == 1 and "DURCHGEFALLEN" in r.stdout
    assert json.loads((tmp_path / "u.json").read_text())["bestanden"] is False

def test_cli_json_ist_strikt_bei_stiller_aufnahme(tmp_path):
    p = tmp_path / "s.wav"; wav.schreibe(p, np.zeros((SR * 5, 2), np.float32), SR)
    r = subprocess.run([sys.executable, "-m", "klang.schleuse", str(p), "--json", str(tmp_path / "u.json")],
                       capture_output=True, text=True, cwd=str(tmp_path.parent), env={"PYTHONPATH": schleuse.PAKET_WURZEL})
    def streng(c):
        raise ValueError(c)
    u = json.loads((tmp_path / "u.json").read_text(), parse_constant=streng)
    assert r.returncode == 1 and u["messung"]["lufs"] is None


def _kriterien(x):
    return {v["kriterium"] for v in schleuse.urteil(x, SR)["verstoesse"]}

def _cli(tmp_path, *args):
    return subprocess.run([sys.executable, "-m", "klang.schleuse", *map(str, args)], capture_output=True, text=True,
                          cwd=str(tmp_path.parent), env={"PYTHONPATH": schleuse.PAKET_WURZEL})

def test_cli_sauber_exit0(tmp_path):
    p = tmp_path / "s.wav"; wav.schreibe(p, sinus(440, -14.0, 5.0), SR)
    r = _cli(tmp_path, p)
    assert r.returncode == 0 and "BESTANDEN" in r.stdout

def test_cli_fehlende_datei_exit2(tmp_path):
    r = _cli(tmp_path, tmp_path / "gibtsnicht.wav")
    assert r.returncode == 2 and "FEHLER" in r.stderr and "BESTANDEN" not in r.stdout and "DURCHGEFALLEN" not in r.stdout

def test_cli_kaputte_wav_exit2(tmp_path):
    p = tmp_path / "k.wav"; p.write_bytes(b"kein wav")
    r = _cli(tmp_path, p)
    assert r.returncode == 2 and "FEHLER" in r.stderr and "BESTANDEN" not in r.stdout and "DURCHGEFALLEN" not in r.stdout

def test_cli_json_in_fehlendes_verzeichnis_exit2_nie_bestanden(tmp_path):
    p = tmp_path / "s.wav"; wav.schreibe(p, sinus(440, -14.0, 5.0), SR)
    r = _cli(tmp_path, p, "--json", tmp_path / "nichtda" / "u.json")
    assert r.returncode == 2 and "FEHLER" in r.stderr and "BESTANDEN" not in r.stdout and "DURCHGEFALLEN" not in r.stdout

def test_cli_referenz_samplerate_mismatch_exit2(tmp_path):
    p, q = tmp_path / "a.wav", tmp_path / "b.wav"
    wav.schreibe(p, sinus(440, -14.0, 5.0), SR); wav.schreibe(q, sinus(440, -14.0, 5.0)[::2], SR // 2)
    r = _cli(tmp_path, p, "--referenz", q)
    assert r.returncode == 2 and "FEHLER" in r.stderr and "BESTANDEN" not in r.stdout and "DURCHGEFALLEN" not in r.stdout

def test_toter_kanal_faellt_durch():
    x = sinus(440, -14.0, 5.0); x[:, 1] = 0
    assert "korrelation" in _kriterien(x)

def test_beide_kanaele_still_korrelation_bleibt_1():
    from klang import lautheit
    assert lautheit.korrelation(np.zeros((SR, 2), np.float32)) == 1.0

def test_grenze_true_peak_allein():
    # -0,5 dBFS: TP -0,49 dBTP, keine Clips; Lautheit (-1,2 LUFS) reißt lufs_max ebenfalls (gemessen), Sinus kann beides nicht trennen
    k = _kriterien(sinus(440, -0.5, 5.0))
    assert "true_peak" in k and "clips" not in k and "korrelation" not in k

def test_grenze_korrelation_quadratur():
    l = sinus(440, -14.0, 5.0, kanaele=1)[:, 0]; r = sinus(440, -14.0, 5.0, kanaele=1, phase=np.pi / 2 + 0.05)[:, 0]  # exakte Quadratur: +1e-15, numerisch auf der Grenze
    assert "korrelation" in _kriterien(np.stack([l, r], axis=1))

def test_grenze_lautheit_zu_laut():
    assert "lautheit" in _kriterien(sinus(440, -4.0, 5.0))

def test_referenz_vorzeichen_sub_ueberschuss():
    x = sinus(60, -20.0, 5.0) + sinus(5000, -20.0, 5.0)
    u = schleuse.urteil(x, SR, referenz=sinus(5000, -20.0, 5.0))
    assert u["referenz"]["baender_diff_db"]["sub"] > 10


# ---- C1 nicht endlich
def _mit(x, wert, i=1000):
    x = x.copy(); x[i, 0] = wert; return x

def _cli_wav(tmp_path, x, *args):
    p = tmp_path / "x.wav"; wav.schreibe(p, x, SR)
    return _cli(tmp_path, p, *args)

def test_nan_faellt_durch_mit_nicht_endlich_und_true_peak(tmp_path):
    r = _cli_wav(tmp_path, _mit(sinus(440, -0.9, 5.0), np.nan))
    assert r.returncode == 1 and "nicht_endlich" in r.stdout and "true_peak" in r.stdout

def test_nan_in_gegenphasigem_faellt_mit_korrelation(tmp_path):
    x = sinus(440, -14.0, 5.0); x[:, 1] *= -1
    r = _cli_wav(tmp_path, _mit(x, np.nan))
    assert r.returncode == 1 and "nicht_endlich" in r.stdout and "korrelation" in r.stdout

def test_inf_faellt_durch(tmp_path):
    for w in (np.inf, -np.inf):
        r = _cli_wav(tmp_path, _mit(sinus(440, -14.0, 5.0), w))
        assert r.returncode == 1 and "nicht_endlich" in r.stdout

def test_nan_urteil_anzahl_und_zahlen_im_json(tmp_path):
    u = schleuse.urteil(_mit(sinus(440, -14.0, 5.0), np.nan), SR)
    assert u["verstoesse"][0]["kriterium"] == "nicht_endlich" and u["verstoesse"][0]["wert"] == 1
    assert np.isfinite(u["messung"]["true_peak_dbtp"]) and np.isfinite(u["messung"]["lufs"])

# ---- C2 Reihenfolge, atomar
def test_json_schreibfehler_kein_urteil_auf_stdout(tmp_path):
    p = tmp_path / "s.wav"; wav.schreibe(p, sinus(440, -14.0, 5.0), SR)
    r = _cli(tmp_path, p, "--json", tmp_path / "nichtda" / "u.json")
    assert r.returncode == 2 and r.stdout == "" and r.stderr.startswith("FEHLER")

def test_json_atomar_kein_tmp_rest(tmp_path):
    p = tmp_path / "s.wav"; wav.schreibe(p, sinus(440, -14.0, 5.0), SR)
    r = _cli(tmp_path, p, "--json", tmp_path / "u.json")
    assert r.returncode == 0 and sorted(q.name for q in tmp_path.iterdir()) == ["s.wav", "u.json"]

# ---- I2 Grenzen beidseitig
def test_clips_grenze():
    assert "clips" not in _kriterien(sinus(440, -14.0, 5.0))
    x = sinus(440, -14.0, 5.0); x[1000, 0] = 1.0
    assert "clips" in _kriterien(x)
    x[1000, 0] = 0.998
    assert "clips" not in _kriterien(x)

def test_lufs_min_grenze():
    assert "lautheit" not in _kriterien(sinus(440, -28.3, 5.0))    # ≈ -29 LUFS
    assert "lautheit" in _kriterien(sinus(440, -30.3, 5.0))        # ≈ -31 LUFS

def test_lufs_max_grenze():
    assert _kriterien(sinus(440, -6.3, 5.0)) == set()              # ≈ -7 LUFS
    assert _kriterien(sinus(440, -4.3, 5.0)) == {"lautheit"}       # ≈ -5 LUFS, TP -4,3 ok

def test_true_peak_grenze():
    assert "true_peak" not in _kriterien(sinus(440, -1.2, 5.0))
    assert "true_peak" in _kriterien(sinus(440, -0.8, 5.0))

def test_korrelation_grenze_beidseitig():
    def mit_korr(c):
        return np.stack([sinus(440, -14.0, 5.0, 1)[:, 0], sinus(440, -14.0, 5.0, 1, phase=np.arccos(c))[:, 0]], axis=1)
    assert "korrelation" not in _kriterien(mit_korr(0.05))
    assert "korrelation" in _kriterien(mit_korr(-0.05))

# ---- I3 fast toter Kanal
def test_fast_toter_kanal_faellt_durch_10_seeds():
    for seed in range(10):
        x = sinus(440, -14.0, 5.0)
        rng = np.random.default_rng(seed)
        x[:, 1] = (rng.standard_normal(len(x)) * (np.sqrt(np.mean(x[:, 0] ** 2)) * 10 ** (-105 / 20))).astype(np.float32)
        assert "korrelation" in _kriterien(x), seed

def test_kanal_minus_60_db_wird_normal_gerechnet():
    x = sinus(440, -14.0, 5.0); x[:, 1] *= 10 ** (-60 / 20)
    assert "korrelation" not in _kriterien(x)
