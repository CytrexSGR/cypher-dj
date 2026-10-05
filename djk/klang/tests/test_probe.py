import json
from pathlib import Path
import numpy as np
import pytest
from klang import probe, wav, lautheit

SR = 48000


def klick_wav(pfad, db=-6.0, n=48, rechteck=False, gegenphase=False):
    """Kurzer Klick (Rauschburst oder Rechteck) als Stereo-WAV, Spitze `db` dBFS."""
    if rechteck:
        m = np.ones(n, dtype=np.float32)
    else:
        rng = np.random.default_rng(1)
        m = (rng.standard_normal(n) * np.hanning(n)).astype(np.float32)
        m /= np.abs(m).max()
    m *= 10 ** (db / 20)
    x = np.stack([m, -m if gegenphase else m], axis=1)
    wav.schreibe(pfad, x, SR)
    return str(pfad)


def kand(pfad, name="k"):
    return {"pfad": pfad, "kuenstler": name, "dauer_s": 0.001, "spitze_db": 0.0}


def rollen(muster):
    return {"rollen": {"bd": {"muster": muster}, "hh": {"muster": [2, 6, 10, 14]}}}


def test_laenge(tmp_path):
    p = klick_wav(tmp_path / "a.wav")
    for bpm, takte in [(130, 2), (120, 1)]:
        y = probe.render(p, [0, 4, 8, 12], bpm, takte)
        assert y.shape[1] == 2
        takt_n = takte * 4 * 60 / bpm * SR
        assert takt_n - 2 <= len(y) <= takt_n + 1.0 * SR


def test_onsets_an_musterpositionen(tmp_path):
    p = klick_wav(tmp_path / "a.wav", rechteck=True, n=64)
    muster = [0, 4, 8, 12]
    bpm, takte = 130, 2
    y = probe.render(p, muster, bpm, takte)
    sech = SR * 60 / bpm / 4
    erwartet = [round((t * 16 + m) * sech) for t in range(takte) for m in muster]
    mono = np.abs(y[:, 0])
    # Onset = erstes Sample eines Klick-Blocks (Lücke > 1000 Samples davor)
    idx = np.flatnonzero(mono > 0.01)
    starts = [idx[0]] + [b for a, b in zip(idx[:-1], idx[1:]) if b - a > 1000]
    assert len(starts) == len(erwartet)
    for s, e in zip(starts, erwartet):
        assert abs(int(s) - e) <= 1


def test_stimmen_ueberlappen_additiv(tmp_path):
    p = klick_wav(tmp_path / "a.wav", rechteck=True, n=200, db=-20)
    y = probe.render(p, [0, 1], 130, 1)  # Abstand 5538 Samples > 200: getrennt
    y2 = probe.render(p, [0, 0], 130, 1)  # identisch: doppelt
    assert np.abs(y2).max() == pytest.approx(2 * np.abs(y).max(), rel=1e-4)


def test_pegel_und_tp(tmp_path):
    for i, (db, rechteck) in enumerate([(-6, False), (-30, False), (-3, True)]):
        p = klick_wav(tmp_path / f"{i}.wav", db=db, rechteck=rechteck, n=2400 if rechteck else 4800)
        y, ab = probe.normiere(probe.render(p, [0, 4, 8, 12], 130, 2), SR)
        assert lautheit.true_peak_db(y, SR) <= -1.0
        l = lautheit.integriert(y, SR)
        assert abs(l + 18.0) <= 0.2 or ab > 0


def test_12db_unterschied_gleich_laut(tmp_path):
    laut = klick_wav(tmp_path / "l.wav", db=-6, n=4800)
    leise = klick_wav(tmp_path / "s.wav", db=-18, n=4800)
    ya, _ = probe.normiere(probe.render(laut, [0, 4, 8, 12], 130, 2), SR)
    yb, _ = probe.normiere(probe.render(leise, [0, 4, 8, 12], 130, 2), SR)
    assert abs(lautheit.integriert(ya, SR) - lautheit.integriert(yb, SR)) <= 0.2


def test_negativkontrolle_rechteck_wird_abgesenkt(tmp_path):
    # kurzer, schmaler Rechteck-Klick bei -18 LUFS: Spitze weit ueber -1 dBTP
    p = klick_wav(tmp_path / "r.wav", db=0, n=24, rechteck=True)
    x = probe.render(p, [0, 4, 8, 12], 130, 2)
    gain = 10 ** ((-18 - lautheit.integriert(x, SR)) / 20)
    assert lautheit.true_peak_db(x * gain, SR) > -1.0, "Vorbedingung: Normierung allein wuerde clippen"
    y, ab = probe.normiere(x, SR)
    assert ab > 0
    assert lautheit.true_peak_db(y, SR) <= -1.0
    assert lautheit.clips(y) == 0


def test_normiere_harmlos_nicht_abgesenkt(tmp_path):
    p = klick_wav(tmp_path / "h.wav", db=-6, n=4800)
    y, ab = probe.normiere(probe.render(p, [0, 4, 8, 12], 130, 2), SR)
    assert ab == 0
    assert lautheit.integriert(y, SR) == pytest.approx(-18.0, abs=0.2)


def test_gegenphase_landet_in_verworfen(tmp_path):
    gut = klick_wav(tmp_path / "gut.wav", db=-6, n=4800)
    schlecht = klick_wav(tmp_path / "schlecht.wav", db=-6, n=4800, gegenphase=True)
    kands = {"bd": [kand(gut, "gut"), kand(schlecht, "schlecht")]}
    ziel = tmp_path / "out"
    idx = probe.rendere(kands, rollen([0, 4, 8, 12]), ziel, bpm=130, takte=2)
    verw = json.loads((ziel / "verworfen.json").read_text())
    assert [v["quelle"] for v in verw] == [schlecht]
    assert "korrelation" in verw[0]["grund"]
    assert all(e["quelle"] != schlecht for e in idx["bd"])
    gespeichert = json.loads((ziel / "index.json").read_text())
    assert gespeichert == idx
    e = idx["bd"][0]
    assert set(["nr", "pfad", "quelle", "kuenstler", "lufs", "tp"]) <= set(e)
    assert (ziel / "bd" / "1.wav").exists()


def test_bd_bekommt_kontext_variante(tmp_path):
    bd = klick_wav(tmp_path / "bd.wav", db=-6, n=4800)
    hh = klick_wav(tmp_path / "hh.wav", db=-6, n=480)
    kands = {"bd": [kand(bd)], "hh": [kand(hh)]}
    ziel = tmp_path / "out"
    idx = probe.rendere(kands, rollen([0, 4, 8, 12]), ziel, bpm=130, takte=2)
    assert len(idx["bd"]) == 2
    kontext = [e for e in idx["bd"] if e.get("kontext")]
    assert len(kontext) == 1 and (ziel / "bd" / "1_kontext.wav").exists()
    assert len(idx["hh"]) == 1 and not idx["hh"][0].get("kontext")


def _gruppe(tmp_path, specs, muster=(0, 4, 8, 12)):
    return [probe.render(klick_wav(tmp_path / f"g{i}.wav", **kw), list(muster), 130, 2) for i, kw in enumerate(specs)]


def test_c_gruppe_pegel_und_tp(tmp_path):
    xs = _gruppe(tmp_path, [dict(db=-6, n=4800), dict(db=-30, n=4800), dict(db=-3, n=2400, rechteck=True)])
    ys, z = probe.normiere_gruppe(xs, SR)
    ls = [lautheit.integriert(y, SR) for y in ys]
    assert max(ls) - min(ls) <= 0.2
    assert all(lautheit.true_peak_db(y, SR) <= -1.0 for y in ys)
    assert z <= -18.0 and abs(ls[0] - z) <= 0.2


def test_e_gruppe_negativkontrolle(tmp_path):
    xs = _gruppe(tmp_path, [dict(db=-6, n=4800), dict(db=0, n=24, rechteck=True)])
    gain = 10 ** ((-18 - lautheit.integriert(xs[1], SR)) / 20)
    assert lautheit.true_peak_db(xs[1] * gain, SR) > -1.0, "Vorbedingung"
    ys, z = probe.normiere_gruppe(xs, SR)
    assert z < -18.0
    assert all(lautheit.true_peak_db(y, SR) <= -1.0 and lautheit.clips(y) == 0 for y in ys)
    ls = [lautheit.integriert(y, SR) for y in ys]
    assert max(ls) - min(ls) <= 0.2


def test_g_hoher_crest_beide_gleich_laut(tmp_path):
    xs = _gruppe(tmp_path, [dict(db=-6, n=4800), dict(db=0, n=24, rechteck=True)])
    ys, z = probe.normiere_gruppe(xs, SR)
    ls = [lautheit.integriert(y, SR) for y in ys]
    assert abs(ls[0] - ls[1]) <= 0.2
    assert all(lautheit.true_peak_db(y, SR) <= -1.0 for y in ys)


def test_h_gruppen_unabhaengig(tmp_path):
    bd1 = klick_wav(tmp_path / "bd1.wav", db=-6, n=4800)
    bd2 = klick_wav(tmp_path / "bd2.wav", db=-12, n=4800)
    cp = klick_wav(tmp_path / "cp.wav", db=0, n=600, rechteck=True)
    cfg = {"rollen": {"bd": {"muster": [0, 4, 8, 12]}, "cp": {"muster": [4, 12]}}}
    idx = probe.rendere({"bd": [kand(bd1), kand(bd2)], "cp": [kand(cp), kand(bd1)]}, cfg, tmp_path / "o", 130, 2)
    assert all(e["ziel_lufs"] == -18.0 for e in idx["bd"])
    assert idx["cp"][0]["ziel_lufs"] < -18.0
    assert len({e["ziel_lufs"] for e in idx["cp"]}) == 1
    assert max(e["lufs"] for e in idx["bd"]) - min(e["lufs"] for e in idx["bd"]) <= 0.2
    assert max(e["lufs"] for e in idx["cp"]) - min(e["lufs"] for e in idx["cp"]) <= 0.2


def test_kontext_ist_eigene_gruppe(tmp_path):
    bd = klick_wav(tmp_path / "bd.wav", db=-6, n=4800)
    hh = klick_wav(tmp_path / "hh.wav", db=-6, n=480)
    idx = probe.rendere({"bd": [kand(bd)], "hh": [kand(hh)]}, rollen([0, 4, 8, 12]), tmp_path / "o", 130, 2)
    assert all("ziel_lufs" in e for e in idx["bd"])


def test_vorlauf_still_und_ende_leise(tmp_path):
    p = klick_wav(tmp_path / "k.wav", db=-6, n=4800)
    sech = SR * 60 / 130 / 4
    y = probe.render(p, [4, 12], 130, 2)
    erster = int(np.flatnonzero(np.abs(y).max(axis=1) > 0)[0])
    assert abs(erster - round(4 * sech)) <= 1
    assert np.all(y[max(0, erster - int(sech)):erster] == 0)          # erstes Sechzehntel davor: digital still
    ende = np.abs(y[-int(0.005 * SR):]).max()
    assert 20 * np.log10(max(ende, 1e-12) / np.abs(y).max()) < -60


def test_lange_stimme_wird_bei_1s_ausgeblendet(tmp_path):
    lang = tmp_path / "lang.wav"
    wav.schreibe(lang, np.full((3 * SR, 2), 0.5, dtype=np.float32), SR)
    y = probe.render(str(lang), [12], 130, 1)
    takt_n = round(4 * SR * 60 / 130)
    assert len(y) == takt_n + SR
    assert np.all(np.diff(np.abs(y[-int(0.02 * SR):, 0])) <= 1e-6)   # monoton auf 0
    assert 20 * np.log10(np.abs(y[-int(0.005 * SR):]).max() / np.abs(y).max()) < -60   # auch beim Schnitt mitten im Signal
    assert abs(y[-1, 0]) < 1e-3


def test_wandle_blendet_immer_aus_wie_kit_bauen(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("kit_bauen", Path(__file__).resolve().parents[2] / "erzeuger" / "kit_bauen.py")
    kb = importlib.util.module_from_spec(spec); spec.loader.exec_module(kb)
    t = np.arange(6 * SR) / SR
    ton = (0.8 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    p = tmp_path / "ton.wav"
    wav.schreibe(p, np.stack([ton, ton], axis=1), SR)
    x = probe.wandle(str(p))
    assert len(x) == 4 * SR
    assert np.abs(x[-1]).max() < 1e-3
    assert np.abs(np.diff(x[:, 0])).max() < 0.1                      # kein Sprung am Schnitt
    kurz = probe.wandle(str(p), max_sek=8)                           # auch am natuerlichen Ende: immer ausgeblendet
    assert len(kurz) == 6 * SR and abs(kurz[-1, 0]) < 1e-3 and np.abs(kurz[-240:, 0]).max() < np.abs(ton[-240:]).max()
    for sek in (4, 8):
        assert np.array_equal(probe.wandle(str(p), max_sek=sek), kb.wandle(p, sek).reshape(-1, 2))
    kurz_p = klick_wav(tmp_path / "k.wav", db=-6, n=100)             # kuerzer als 240 Samples
    assert np.array_equal(probe.wandle(kurz_p), kb.wandle(Path(kurz_p), 4).reshape(-1, 2))


def test_kontext_hat_abstand_aus_rollen(tmp_path):
    bd = klick_wav(tmp_path / "bd.wav", db=-6, n=4800)
    hh = klick_wav(tmp_path / "hh.wav", db=-6, n=4800)
    spitzen = []
    for abstand in (-6.0, -20.0):
        cfg = {"rollen": {"bd": {"muster": [0], "spitze_db": -6.0}, "hh": {"muster": [8], "spitze_db": -6.0 + abstand}}}
        ziel = tmp_path / f"o{abstand}"
        idx = probe.rendere({"bd": [kand(bd)], "hh": [kand(hh)]}, cfg, ziel, 130, 2)
        e = [e for e in idx["bd"] if e.get("kontext")][0]
        y, _ = wav.lies(e["pfad"])
        sech = SR * 60 / 130 / 4
        kick = np.abs(y[: int(4 * sech)]).max()
        hat = np.abs(y[int(8 * sech): int(8 * sech) + 4800]).max()
        spitzen.append(20 * np.log10(hat / kick))
    assert spitzen[0] == pytest.approx(-6.0, abs=0.7) and spitzen[1] == pytest.approx(-20.0, abs=0.7)


def test_kontext_mit_ungleich_langen_ausklaengen(tmp_path):
    bd = klick_wav(tmp_path / "bd.wav", db=-6, n=4800)
    hh = klick_wav(tmp_path / "hh.wav", db=-6, n=480)
    lang = tmp_path / "lang.wav"
    r = np.random.default_rng(2).standard_normal(SR).astype(np.float32) * np.exp(-np.arange(SR) / 8000, dtype=np.float32)
    wav.schreibe(lang, np.stack([r, r], axis=1) * 0.3, SR)
    idx = probe.rendere({"bd": [kand(str(lang))], "hh": [kand(hh)]}, rollen([0, 4, 8, 12]), tmp_path / "o", 130, 2)
    assert any(e.get("kontext") for e in idx["bd"])


def _kandidaten_dateien(tmp_path, n=5):
    return [kand(klick_wav(tmp_path / f"c{i}.wav", db=-6 - i, n=4800), f"k{i}") for i in range(n)]


def test_abbruch_mitten_im_render_laesst_alten_index_unberuehrt(tmp_path, monkeypatch):
    ziel = tmp_path / "out"
    kands = {"bd": _kandidaten_dateien(tmp_path)}
    probe.rendere(kands, rollen([0, 4, 8, 12]), ziel, 130, 2)
    alt = (ziel / "index.json").read_bytes()
    alt_v = (ziel / "verworfen.json").read_bytes()
    echt = wav.schreibe
    zaehler = {"n": 0}

    def bricht(pfad, x, sr):
        zaehler["n"] += 1
        if zaehler["n"] == 4:
            raise RuntimeError("simulierter Abbruch")
        return echt(pfad, x, sr)
    monkeypatch.setattr(probe.wav, "schreibe", bricht)
    with pytest.raises(RuntimeError):
        probe.rendere(kands, rollen([0, 4, 8, 12]), ziel, 130, 2)
    assert (ziel / "index.json").read_bytes() == alt
    assert (ziel / "verworfen.json").read_bytes() == alt_v
    assert not list(ziel.rglob("*.tmp.*"))            # keine halben Dateien


def test_wavs_atomar_tmp_dann_replace(tmp_path, monkeypatch):
    kands = {"bd": _kandidaten_dateien(tmp_path, 1)}
    geschrieben = []
    echt = wav.schreibe
    monkeypatch.setattr(probe.wav, "schreibe", lambda p, x, sr: (geschrieben.append(str(p)), echt(p, x, sr))[1])
    probe.rendere(kands, rollen([0, 4, 8, 12]), tmp_path / "o", 130, 2)
    assert geschrieben and all(".tmp." in p for p in geschrieben)
    assert (tmp_path / "o" / "bd" / "1.wav").exists()


def test_exit_2_fehlende_kandidaten(tmp_path, capsys):
    r = tmp_path / "r.json"; r.write_text(json.dumps(rollen([0])))
    assert probe.main(["--kandidaten", str(tmp_path / "fehlt.json"), "--rollen", str(r), "--ziel", str(tmp_path / "o")]) == 2
    err = capsys.readouterr().err
    assert err.startswith("FEHLER:") and "Traceback" not in err


def test_exit_2_kaputte_rollen(tmp_path, capsys):
    k = tmp_path / "k.json"; k.write_text("{}")
    r = tmp_path / "r.json"; r.write_text("{kaputt")
    assert probe.main(["--kandidaten", str(k), "--rollen", str(r), "--ziel", str(tmp_path / "o")]) == 2
    err = capsys.readouterr().err
    assert err.startswith("FEHLER:") and "Traceback" not in err


def test_exit_2_ziel_nicht_schreibbar(tmp_path, capsys):
    k = tmp_path / "k.json"; k.write_text("{}")
    r = tmp_path / "r.json"; r.write_text(json.dumps(rollen([0])))
    datei = tmp_path / "keinordner"; datei.write_text("x")
    assert probe.main(["--kandidaten", str(k), "--rollen", str(r), "--ziel", str(datei / "unter")]) == 2
    assert capsys.readouterr().err.startswith("FEHLER:")


def test_exit_0_bei_erfolg_negativkontrolle(tmp_path, capsys):
    k = tmp_path / "k.json"; k.write_text(json.dumps({"bd": _kandidaten_dateien(tmp_path, 1)}))
    r = tmp_path / "r.json"; r.write_text(json.dumps(rollen([0, 4, 8, 12])))
    assert probe.main(["--kandidaten", str(k), "--rollen", str(r), "--ziel", str(tmp_path / "o")]) == 0
    assert capsys.readouterr().err == ""


def test_rendere_muster_oeffentlich(tmp_path):
    p = klick_wav(tmp_path / "a.wav", rechteck=True, n=64)
    a = probe.rendere_muster(probe.wandle(p), {"muster": [0, 4]}, SR, 130, 1)
    assert np.array_equal(a, probe.render(p, [0, 4], 130, 1))
    with pytest.raises(ValueError):
        probe.rendere_muster(probe.wandle(p), {"muster": [0]}, 44100, 130, 1)
