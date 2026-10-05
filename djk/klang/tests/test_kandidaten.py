import numpy as np
from klang import kandidaten, wav

SR = 44100

def ton(f, sek=0.3):
    t = np.arange(int(SR * sek)) / SR
    return (0.5 * np.sin(2 * np.pi * f * t)).astype(np.float32)[:, None]

def bestand(tmp_path, dateien, ordner="Kick", quelle="q"):
    for name, x in dateien.items():
        wav.schreibe(tmp_path / quelle / ordner / name, x, SR)

def rollen(tmp_path, ordner="Kick", **extra):
    rolle = {"ordner": {"q": [ordner]}, "muster": [0], "spitze_db": -6.0, "max": 6}
    rolle.update(extra)
    return {"kuenstler": ["Liebing", "Slam", "Tracid"], "quellen": {"q": str(tmp_path / "q")},
            "rollen": {"r": rolle}}

def test_nur_kuenstler_dateien(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(60), "Kick Fremd 1.wav": ton(60),
                       "Kick KaiTracid 2.wav": ton(60)})
    out = kandidaten.sammle(rollen(tmp_path))["r"]
    assert sorted(k["kuenstler"] for k in out) == ["Liebing", "Tracid"]
    assert all(k["pfad"].endswith(".wav") and "Fremd" not in k["pfad"] for k in out)

def test_rundlauf_streut_ueber_kuenstler(tmp_path):
    bestand(tmp_path, {f"Kick {k} {i}.wav": ton(60) for k in ["Liebing", "Slam", "Tracid"] for i in range(10)})
    out = kandidaten.sammle(rollen(tmp_path))["r"]
    assert len(out) == 6
    zaehl = {k: sum(1 for o in out if o["kuenstler"] == k) for k in ["Liebing", "Slam", "Tracid"]}
    assert zaehl == {"Liebing": 2, "Slam": 2, "Tracid": 2}

def test_koerper_db_150hz_ueber_50hz(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(150), "Kick Liebing 2.wav": ton(50)})
    r = rollen(tmp_path)
    r["rollen"]["bd"] = r["rollen"].pop("r")
    out = {o["pfad"].split("/")[-1]: o for o in kandidaten.sammle(r)["bd"]}
    assert out["Kick Liebing 1.wav"]["koerper_db"] > out["Kick Liebing 2.wav"]["koerper_db"] + 20

def test_koerper_nur_fuer_bd(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(150)})
    r = rollen(tmp_path)
    assert "koerper_db" not in kandidaten.sammle(r)["r"][0]
    r["rollen"]["bd"] = r["rollen"].pop("r")
    assert "koerper_db" in kandidaten.sammle(r)["bd"][0]

def test_hh_oh_trennung_nach_name(tmp_path):
    bestand(tmp_path, {"ClosedHH Liebing 1.wav": ton(8000, 0.1), "OpenHH Liebing 1.wav": ton(8000, 0.5),
                       "ClosedHH Slam.wav": ton(8000, 0.1)}, ordner="HiHat")
    r = rollen(tmp_path, ordner="HiHat", name_enthaelt=["Closed"])
    hh = kandidaten.sammle(r)["r"]
    assert sorted(o["pfad"].split("/")[-1] for o in hh) == ["ClosedHH Liebing 1.wav", "ClosedHH Slam.wav"]
    r = rollen(tmp_path, ordner="HiHat", name_enthaelt=["Open"])
    oh = kandidaten.sammle(r)["r"]
    assert [o["pfad"].split("/")[-1] for o in oh] == ["OpenHH Liebing 1.wav"]
    assert oh[0]["dauer_s"] > 0.45

def test_leerer_und_fehlender_ordner_kein_absturz(tmp_path, capsys):
    (tmp_path / "q" / "Kick").mkdir(parents=True)
    assert kandidaten.sammle(rollen(tmp_path))["r"] == []
    assert kandidaten.sammle(rollen(tmp_path, ordner="Gibtsnicht"))["r"] == []
    assert "Gibtsnicht" in capsys.readouterr().err

def test_merkmale(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(100, 0.5)})
    k = kandidaten.sammle(rollen(tmp_path))["r"][0]
    assert abs(k["dauer_s"] - 0.5) < 0.01 and abs(k["spitze_db"] - (-6.02)) < 0.1
    assert set(k["baender_db"]) >= {"sub", "tief", "hoch"}

def test_defekte_wav_wird_uebersprungen(tmp_path, capsys):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(60)})
    (tmp_path / "q" / "Kick" / "Kick Liebing 2.wav").write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt kaputt")
    out = kandidaten.sammle(rollen(tmp_path))["r"]
    assert [o["pfad"].split("/")[-1] for o in out] == ["Kick Liebing 1.wav"]
    assert "Liebing 2.wav" in capsys.readouterr().err

def burst(f, sek, start=0.0, tau=0.05, a=0.5, gesamt=None):
    n = int(SR * (gesamt or start + sek))
    t = np.arange(n) / SR
    env = np.where(t >= start, np.exp(-(t - start) / tau), 0.0)
    return (a * env * np.sin(2 * np.pi * f * t)).astype(np.float32)[:, None]

def test_kuenstler_case_insensitiv(tmp_path):
    bestand(tmp_path, {"kick LIEBING 3.wav": ton(60)})
    assert [o["kuenstler"] for o in kandidaten.sammle(rollen(tmp_path))["r"]] == ["Liebing"]

def test_koerper_db_exakter_wert(tmp_path):
    t = np.arange(SR) / SR
    def zwei(a150, a60):
        return (a150 * np.sin(2 * np.pi * 150 * t) + a60 * np.sin(2 * np.pi * 60 * t)).astype(np.float32)[:, None]
    bestand(tmp_path, {"Kick Liebing 1.wav": zwei(0.4, 0.1), "Kick Liebing 2.wav": zwei(0.1, 0.4)})
    r = rollen(tmp_path, max_dauer_s=2.0)
    r["rollen"]["bd"] = r["rollen"].pop("r")
    out = {o["pfad"].split("/")[-1]: o["koerper_db"] for o in kandidaten.sammle(r)["bd"]}
    assert abs(out["Kick Liebing 1.wav"] - 12.04) < 0.5     # 20*log10(0.4/0.1)
    assert abs(out["Kick Liebing 2.wav"] + 12.04) < 0.5

def test_anschlaege_zaehler():
    assert kandidaten.anschlaege(burst(150, 0.5), SR) == 1
    assert kandidaten.anschlaege(burst(50, 0.5, tau=0.1), SR) == 1          # tiefer Kick, Welligkeit der Hüllkurve
    zwei = burst(3000, 1.0, gesamt=1.0) + burst(3000, 1.0, start=0.3, gesamt=1.0)
    assert kandidaten.anschlaege(zwei, SR) == 2
    fill = sum(burst(3000, 1.0, start=s, gesamt=1.5) for s in [0.0, 0.15, 0.3, 0.45, 0.6, 0.75])
    assert kandidaten.anschlaege(fill, SR) == 6
    assert kandidaten.anschlaege(np.zeros((SR, 1), np.float32), SR) == 0

def test_einzelschlag_filter(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": burst(100, 0.4),
                       "Kick Slam 1.wav": burst(100, 1.0, gesamt=1.0) + burst(100, 1.0, start=0.3, gesamt=1.0),
                       "Kick Tracid 1.wav": burst(100, 2.0, tau=0.5)})
    r = rollen(tmp_path, max_dauer_s=1.5)
    assert [o["kuenstler"] for o in kandidaten.sammle(r)["r"]] == ["Liebing"]     # Slam: 2 Anschläge, Tracid: zu lang

def test_name_ohne_rim(tmp_path):
    bestand(tmp_path, {"Snare Liebing 1.wav": ton(200), "RimShot Slam.wav": ton(200), "snare rimshot Tracid.wav": ton(200)},
            ordner="Snare")
    out = kandidaten.sammle(rollen(tmp_path, ordner="Snare", name_ohne=["Rim"]))["r"]
    assert [o["kuenstler"] for o in out] == ["Liebing"]

def test_klingt_s_ignoriert_stillen_ausklang():
    x = np.concatenate([burst(100, 0.3, tau=0.05), np.zeros((SR * 2, 1), np.float32)])
    assert 0.2 < kandidaten.klingt_s(x, SR) < 0.5 and len(x) / SR > 2.2

def test_lange_stille_datei_bleibt_kandidat(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": np.concatenate([burst(100, 0.3), np.zeros((SR * 3, 1), np.float32)])})
    out = kandidaten.sammle(rollen(tmp_path, max_dauer_s=1.5))["r"]
    assert len(out) == 1 and out[0]["dauer_s"] > 3

import json, pytest

def _cfg_datei(tmp_path, cfg):
    p = tmp_path / "rollen.json"
    p.write_text(json.dumps(cfg))
    return p

def test_programmierfehler_bricht_ab_json_bleibt(tmp_path, monkeypatch):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(60)})
    cfg = _cfg_datei(tmp_path, rollen(tmp_path))
    aus = tmp_path / "aus" / "kandidaten.json"
    aus.parent.mkdir()
    aus.write_text('{"alt": true}')
    def kaputt(*a, **k): raise TypeError("Programmierfehler")
    monkeypatch.setattr(kandidaten, "anschlaege", kaputt)
    with pytest.raises(TypeError):
        kandidaten.main(["--rollen", str(cfg), "--aus", str(aus)])
    assert aus.read_text() == '{"alt": true}'
    assert not list(aus.parent.glob("*.tmp"))

def test_mehr_als_die_haelfte_unlesbar_bricht_ab_json_bleibt(tmp_path, capsys):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(60)})
    for i in (2, 3):
        (tmp_path / "q" / "Kick" / f"Kick Liebing {i}.wav").write_bytes(b"kaputt")
    cfg = _cfg_datei(tmp_path, rollen(tmp_path))
    aus = tmp_path / "kandidaten.json"
    aus.write_text('{"alt": true}')
    with pytest.raises(SystemExit) as e:
        kandidaten.main(["--rollen", str(cfg), "--aus", str(aus)])
    assert e.value.code == 2
    assert "FEHLER:" in capsys.readouterr().err
    assert aus.read_text() == '{"alt": true}'

def test_rolle_leer_obwohl_dateien_bricht_ab(tmp_path, capsys):
    bestand(tmp_path, {"Kick Liebing 1.wav": burst(100, 1.0, gesamt=1.0) + burst(100, 1.0, start=0.3, gesamt=1.0)})
    cfg = _cfg_datei(tmp_path, rollen(tmp_path))
    aus = tmp_path / "kandidaten.json"
    with pytest.raises(SystemExit) as e:
        kandidaten.main(["--rollen", str(cfg), "--aus", str(aus)])
    assert e.value.code == 2 and "FEHLER:" in capsys.readouterr().err
    assert not aus.exists()

def test_rollen_datei_fehlt_exit_2(tmp_path, capsys):
    with pytest.raises(SystemExit) as e:
        kandidaten.main(["--rollen", str(tmp_path / "gibtsnicht.json"), "--aus", str(tmp_path / "k.json")])
    assert e.value.code == 2 and "FEHLER:" in capsys.readouterr().err

def test_erfolg_schreibt_atomar_ohne_tmp(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(60)})
    cfg = _cfg_datei(tmp_path, rollen(tmp_path))
    aus = tmp_path / "kandidaten.json"
    kandidaten.main(["--rollen", str(cfg), "--aus", str(aus)])
    assert len(json.loads(aus.read_text())["r"]) == 1 and not list(tmp_path.glob("*.tmp"))

def test_nicht_endliche_samples_verworfen(tmp_path, capsys):
    schlecht = ton(60).copy(); schlecht[100, 0] = np.nan
    inf = ton(60).copy(); inf[5, 0] = np.inf
    bestand(tmp_path, {"Kick Liebing 1.wav": schlecht, "Kick Slam 1.wav": inf, "Kick Tracid 1.wav": ton(60),
                       "Kick Tracid 2.wav": ton(61), "Kick Tracid 3.wav": ton(62)})
    out = kandidaten.sammle(rollen(tmp_path))["r"]
    assert {o["kuenstler"] for o in out} == {"Tracid"} and len(out) == 3
    err = capsys.readouterr().err
    assert err.count("(nicht_endlich)") == 2
    json.dumps(out, allow_nan=False)

def test_welch_warnung_unterdrueckt(tmp_path, recwarn):
    bestand(tmp_path, {"Kick Liebing 1.wav": ton(60, 0.1)})
    assert len(kandidaten.sammle(rollen(tmp_path))["r"]) == 1
    assert not [w for w in recwarn.list if "nperseg" in str(w.message)]

def schwell(f, anstieg_s, sek=0.6, tau=0.08, a=0.5):
    """Setzt sofort ein, Spitze erst nach anstieg_s (wie Kick Liebing 1: Einsatz 0,2 ms, Spitze 101 ms)."""
    t = np.arange(int(SR * sek)) / SR
    env = np.where(t < anstieg_s, t / anstieg_s, np.exp(-(t - anstieg_s) / tau))
    return (a * env * np.sin(2 * np.pi * f * t)).astype(np.float32)[:, None]

def test_spitze_ms_gemessen(tmp_path):
    bestand(tmp_path, {"Kick Liebing 1.wav": schwell(60, 0.1), "Kick Slam 1.wav": burst(60, 0.4)})
    out = {o["kuenstler"]: o for o in kandidaten.sammle(rollen(tmp_path))["r"]}
    assert 95 <= out["Liebing"]["spitze_ms"] <= 105
    assert out["Slam"]["spitze_ms"] <= 10

def test_max_spitze_ms_verwirft_spaete_spitze(tmp_path):
    # 2026-09-30: Kit techno trug bd:0 (Spitze 161 ms) und bd:4 (101 ms), Andreas: „keinen geraden beat“
    bestand(tmp_path, {"Kick Liebing 1.wav": schwell(60, 0.1), "Kick Slam 1.wav": burst(60, 0.4),
                       "Kick Tracid 1.wav": schwell(60, 0.012)})
    out = kandidaten.sammle(rollen(tmp_path, max_spitze_ms=20))["r"]
    assert sorted(o["kuenstler"] for o in out) == ["Slam", "Tracid"]
    # ohne Schwelle bleibt alles (Rollen ohne Taktbezug, z. B. Crash, sollen nicht verlieren)
    assert len(kandidaten.sammle(rollen(tmp_path))["r"]) == 3
