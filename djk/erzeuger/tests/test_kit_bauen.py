"""Plan 2026-09-27 Task 6: kit_bauen.py macht aus einer Strudel-Liste ein Kit (ADR 024)."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kit_bauen  # noqa: E402


def wav(p: Path, sek: float, hz: float, rate=44100, kanaele=1):
    p.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", f"sine=f={hz}:r={rate}:d={sek}",
                    "-ac", str(kanaele), str(p)], check=True)


def test_baut_kit_mit_noten_namen_und_laenge(tmp_path):
    q = tmp_path / "quelle"
    wav(q / "Drums/Kick/Kick A.wav", 0.5, 60)
    wav(q / "Drums/Kick/Kick B.wav", 0.25, 80)
    wav(q / "Drums/Hat/Hat.wav", 6.0, 3000)  # länger als max_sek
    liste = {"_base": "http://x/", "bd": ["Drums/Kick/Kick%20A.wav", "Drums/Kick/Kick%20B.wav"], "hh": ["Drums/Hat/Hat.wav"]}
    kit = kit_bauen.baue(liste, q, tmp_path / "kit", "t", 4.0)
    assert [k["name"] for k in kit["klaenge"]] == ["bd:0", "bd:1", "hh:0"]
    assert [k["note"] for k in kit["klaenge"]] == [0, 1, 2]
    k0, k2 = kit["klaenge"][0], kit["klaenge"][2]
    assert k0["frames"] == 24000                      # 0,5 s bei 48 kHz (aus 44,1 kHz)
    assert k2["frames"] == 4 * 48000                  # auf max_sek gekürzt
    d = np.fromfile(tmp_path / "kit" / k2["datei"], dtype="<f4")
    assert d.size == 2 * k2["frames"] and np.all(np.isfinite(d))
    assert abs(d[-2]) < 1e-6 and abs(d[-1]) < 1e-6   # Ausblende am Ende
    assert np.allclose(d[0::2], d[1::2])              # Mono → beide Seiten gleich
    j = json.loads((tmp_path / "kit" / "kit.json").read_text())
    assert j["schema"] == 1 and j["name"] == "t" and len(j["klaenge"]) == 3


def _cli(tmp_path, liste, auswahl=None, quelle=None):
    (tmp_path / "l.json").write_text(json.dumps(liste))
    arg = ["--liste", str(tmp_path / "l.json"), "--quelle", str(quelle or tmp_path), "--ziel", str(tmp_path / "kit")]
    if auswahl is not None:
        (tmp_path / "a.json").write_text(json.dumps(auswahl))
        arg += ["--auswahl", str(tmp_path / "a.json")]
    return kit_bauen.main(arg)


def test_fehlende_datei_meldet_pfad_exit_2_schreibt_nichts(tmp_path, capsys):
    rc = _cli(tmp_path, {"bd": ["gibt/es/nicht.wav"]})
    err = capsys.readouterr().err
    assert rc == 2 and "kit_bauen:" in err and "nicht.wav" in err and "Traceback" not in err
    assert not (tmp_path / "kit").exists()


def test_fehlende_auswahl_datei_meldet_pfad_exit_2(tmp_path, capsys):
    q, ext, liste = _basis(tmp_path)
    rc = _cli(tmp_path, liste, auswahl={"bd": [str(ext / "weg.wav")]}, quelle=q)
    err = capsys.readouterr().err
    assert rc == 2 and "weg.wav" in err and "Traceback" not in err
    assert not (tmp_path / "kit").exists()


def test_muelldatei_meldet_ffmpeg_zeile_exit_2(tmp_path, capsys):
    q, ext, liste = _basis(tmp_path)
    (q / "a/bd.wav").write_bytes(b"das ist kein audio" * 20)
    rc = _cli(tmp_path, liste, quelle=q)
    err = capsys.readouterr().err
    assert rc == 2 and "bd.wav" in err and len(err.strip().splitlines()) == 1 and "Traceback" not in err
    assert not (tmp_path / "kit").exists()


def test_ffmpeg_fehlt_meldet_sauber(tmp_path, capsys, monkeypatch):
    q, ext, liste = _basis(tmp_path)
    monkeypatch.setenv("PATH", str(tmp_path / "leer"))
    rc = _cli(tmp_path, liste, quelle=q)
    err = capsys.readouterr().err
    assert rc == 2 and "ffmpeg" in err and "Traceback" not in err and not (tmp_path / "kit").exists()


def test_ffmpeg_timeout_meldet_sauber(tmp_path, capsys, monkeypatch):
    q, ext, liste = _basis(tmp_path)
    echt = subprocess.run

    def langsam(cmd, **kw):
        assert kw.get("timeout") == 60
        raise subprocess.TimeoutExpired(cmd, kw["timeout"])
    monkeypatch.setattr(kit_bauen.subprocess, "run", langsam)
    rc = _cli(tmp_path, liste, quelle=q)
    err = capsys.readouterr().err
    assert rc == 2 and ".wav" in err and "Traceback" not in err
    monkeypatch.setattr(kit_bauen.subprocess, "run", echt)


# ---- Klang K1 Task 7: --auswahl, --rollen, --ohne-praefix, Grenze 112 ----
def spitze_db(p: Path) -> float:
    return 20 * np.log10(np.max(np.abs(np.fromfile(p, dtype="<f4"))))


def _basis(tmp_path):
    q = tmp_path / "quelle"
    wav(q / "a/bd.wav", 0.3, 60)
    wav(q / "a/hh.wav", 0.3, 3000)
    wav(q / "a/bat.wav", 0.3, 500)
    ext = tmp_path / "ext"
    wav(ext / "neu_bd.wav", 0.3, 50, rate=48000, kanaele=2)
    wav(ext / "neu_perc.wav", 0.3, 700)
    liste = {"_base": "x", "bd": ["a/bd.wav"], "hh": ["a/hh.wav"], "bat_x": ["a/bat.wav"]}
    return q, ext, liste


def test_auswahl_ersetzt_nur_ihre_rolle(tmp_path):
    q, ext, liste = _basis(tmp_path)
    kit = kit_bauen.baue(liste, q, tmp_path / "k", "t", 4.0, auswahl={"bd": [str(ext / "neu_bd.wav")]})
    assert [k["name"] for k in kit["klaenge"]] == ["bat_x:0", "bd:0", "hh:0"]
    ref = kit_bauen.baue(liste, q, tmp_path / "r", "t", 4.0)
    assert (tmp_path / "k/hh_0.f32").read_bytes() == (tmp_path / "r/hh_0.f32").read_bytes()
    assert (tmp_path / "k/bd_0.f32").read_bytes() != (tmp_path / "r/bd_0.f32").read_bytes()
    assert kit["klaenge"][1]["frames"] == ref["klaenge"][1]["frames"]  # 0,3 s beide, Ersatz wirklich gebaut


def test_rollen_pegel_bd_minus6_hh_minus16(tmp_path):
    q, ext, liste = _basis(tmp_path)
    rollen = {"rollen": {"bd": {"spitze_db": -6.0}, "hh": {"spitze_db": -16.0}}}
    kit = kit_bauen.baue(liste, q, tmp_path / "k", "t", 4.0, rollen=rollen)
    by = {k["name"]: k for k in kit["klaenge"]}
    assert abs(spitze_db(tmp_path / "k" / by["bd:0"]["datei"]) + 6.0) < 0.01
    assert abs(spitze_db(tmp_path / "k" / by["hh:0"]["datei"]) + 16.0) < 0.01
    assert by["bd:0"]["spitze_db"] == -6.0 and by["hh:0"]["spitze_db"] == -16.0
    assert "spitze_db" not in by["bat_x:0"]


def test_rolle_ohne_rollen_eintrag_bitgleich_altes_verhalten(tmp_path):
    q, ext, liste = _basis(tmp_path)
    kit_bauen.baue(liste, q, tmp_path / "alt", "t", 4.0)
    kit_bauen.baue(liste, q, tmp_path / "neu", "t", 4.0, rollen={"rollen": {"bd": {"spitze_db": -6.0}}})
    assert (tmp_path / "alt/bat_x_0.f32").read_bytes() == (tmp_path / "neu/bat_x_0.f32").read_bytes()
    assert (tmp_path / "alt/hh_0.f32").read_bytes() == (tmp_path / "neu/hh_0.f32").read_bytes()


def test_mehr_als_112_klaenge_bricht_vor_dem_schreiben_ab(tmp_path):
    q, ext, liste = _basis(tmp_path)
    liste = {"bd": ["a/bd.wav"] * 113}
    ziel = tmp_path / "k"
    try:
        kit_bauen.baue(liste, q, ziel, "t", 4.0)
    except ValueError as e:
        assert "Noten 112+ belegt das Zusatz-Kit rec" in str(e)
    else:
        raise AssertionError("113 Klänge ohne Fehler")
    assert not ziel.exists()
    ziel.mkdir()
    (ziel / "alt.f32").write_bytes(b"x")
    try:
        kit_bauen.baue({"bd": ["a/bd.wav"] * 113}, q, ziel, "t", 4.0)
    except ValueError:
        pass
    assert [p.name for p in ziel.iterdir()] == ["alt.f32"]


def test_112_klaenge_sind_erlaubt(tmp_path):
    q, ext, liste = _basis(tmp_path)
    kit = kit_bauen.baue({"bd": ["a/bd.wav"] * 112}, q, tmp_path / "k", "t", 4.0)
    assert len(kit["klaenge"]) == 112 and kit["klaenge"][-1]["note"] == 111


def test_ohne_praefix_entfernt_genau_diese_eintraege(tmp_path):
    q, ext, liste = _basis(tmp_path)
    liste["bat_y"] = ["a/bat.wav"]
    kit = kit_bauen.baue(liste, q, tmp_path / "k", "t", 4.0, ohne_praefix=["bat_"])
    assert [k["name"] for k in kit["klaenge"]] == ["bd:0", "hh:0"]
    assert not list((tmp_path / "k").glob("bat_*"))


def test_neue_rolle_perc_aus_auswahl(tmp_path):
    q, ext, liste = _basis(tmp_path)
    kit = kit_bauen.baue(liste, q, tmp_path / "k", "t", 4.0, auswahl={"perc": [str(ext / "neu_perc.wav")]})
    assert "perc:0" in [k["name"] for k in kit["klaenge"]] and len(kit["klaenge"]) == 4


def test_cli_ohne_auswahl_bitgleich_zum_echten_battery_kit(tmp_path):
    echt = Path.home() / ".config/cypherdj/kits/battery"
    liste = Path(__file__).resolve().parents[3] / "battery.json"
    import os
    import pytest
    if not os.environ.get("CYPHERDJ_KLANG_BATTERY_SAMPLES"):
        pytest.skip("CYPHERDJ_KLANG_BATTERY_SAMPLES nicht gesetzt (Wurzel der Battery4-Samples)")
    quelle = Path(os.environ["CYPHERDJ_KLANG_BATTERY_SAMPLES"])
    if not (echt.exists() and liste.exists() and quelle.exists()):
        pytest.skip("echtes Kit oder Quelle fehlt")
    assert kit_bauen.main(["--liste", str(liste), "--quelle", str(quelle), "--ziel", str(tmp_path / "battery")]) == 0
    dateien = sorted(p.name for p in echt.glob("*.f32"))
    assert len(dateien) == 112
    import hashlib
    for d in dateien:
        assert hashlib.md5((tmp_path / "battery" / d).read_bytes()).hexdigest() == hashlib.md5((echt / d).read_bytes()).hexdigest(), d
    assert json.loads((tmp_path / "battery/kit.json").read_text()) == json.loads((echt / "kit.json").read_text())


# ---- Nachbesserung T7: ungleiche Kanäle, CLI, leere Auswahl, Restpegel, Fehlermeldung ----
def wav_lr(p: Path, gain_l: float, gain_r: float):
    p.parent.mkdir(parents=True, exist_ok=True)
    fc = (f"sine=f=100:d=0.3:r=48000,volume={gain_l}[l];sine=f=100:d=0.3:r=48000,volume={gain_r}[r];"
          "[l][r]amerge=inputs=2")
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-filter_complex", fc, str(p)], check=True)


def test_normierung_nimmt_spitze_ueber_beide_kanaele(tmp_path):
    for name, gl, gr in (("l", 4.0, 0.5), ("r", 0.5, 4.0)):
        q = tmp_path / name
        wav_lr(q / "x.wav", gl, gr)
        kit = kit_bauen.baue({"bd": ["x.wav"]}, q, tmp_path / f"k{name}", "t", 4.0,
                             rollen={"rollen": {"bd": {"spitze_db": -6.0}}})
        d = np.fromfile(tmp_path / f"k{name}" / kit["klaenge"][0]["datei"], dtype="<f4")
        assert abs(20 * np.log10(np.max(np.abs(d))) + 6.0) < 0.01, name
        assert np.max(np.abs(d[0::2])) != np.max(np.abs(d[1::2]))  # Kanäle wirklich ungleich geblieben


def test_cli_reicht_alle_flags_durch(tmp_path):
    q, ext, liste = _basis(tmp_path)
    (tmp_path / "l.json").write_text(json.dumps(liste))
    (tmp_path / "a.json").write_text(json.dumps({"bd": [str(ext / "neu_bd.wav")], "perc": [str(ext / "neu_perc.wav")]}))
    (tmp_path / "r.json").write_text(json.dumps({"rollen": {"bd": {"spitze_db": -6.0}}, "pegel_zusatz": {"perc": -12}}))
    rc = kit_bauen.main(["--liste", str(tmp_path / "l.json"), "--quelle", str(q), "--ziel", str(tmp_path / "k"),
                         "--auswahl", str(tmp_path / "a.json"), "--rollen", str(tmp_path / "r.json"),
                         "--ohne-praefix", "bat_", "--ohne-praefix", "zzz_"])
    assert rc == 0
    kit = json.loads((tmp_path / "k/kit.json").read_text())
    assert [k["name"] for k in kit["klaenge"]] == ["bd:0", "hh:0", "perc:0"]  # bat_ weg (M5), perc neu (M4)
    assert abs(spitze_db(tmp_path / "k/bd_0.f32") + 6.0) < 0.01               # --rollen wirkt
    assert abs(spitze_db(tmp_path / "k/perc_0.f32") + 12.0) < 0.01            # pegel_zusatz wirkt
    ref = kit_bauen.baue(liste, q, tmp_path / "r", "t", 4.0)
    assert (tmp_path / "k/bd_0.f32").read_bytes() != (tmp_path / "r/bd_0.f32").read_bytes()  # --auswahl wirkt


def test_leere_auswahl_laesst_rolle_wie_in_liste(tmp_path):
    q, ext, liste = _basis(tmp_path)
    kit = kit_bauen.baue(liste, q, tmp_path / "k", "t", 4.0, auswahl={"hh": [], "oh": []})
    assert [k["name"] for k in kit["klaenge"]] == ["bat_x:0", "bd:0", "hh:0"]  # hh bleibt, oh entsteht nicht


def _laut(tmp_path):
    q = tmp_path / "q"
    wav_lr(q / "laut.wav", 12.0, 12.0)  # ffmpeg-Sinus 0,125 * 12 = +3,5 dBFS als float-WAV
    return q


def test_klang_ueber_minus1_dbfs_ohne_rolle_bricht_vor_dem_schreiben_ab(tmp_path):
    q = _laut(tmp_path)
    ziel = tmp_path / "k"
    try:
        kit_bauen.baue({"rd": ["laut.wav"]}, q, ziel, "t", 4.0, rollen={"rollen": {}})
    except ValueError as e:
        assert "rd:0" in str(e) and "dBFS" in str(e)
    else:
        raise AssertionError("Übersteuerung nicht erkannt")
    assert not ziel.exists()


def test_pegel_zusatz_normiert_und_rollen_haben_vorrang(tmp_path):
    q = _laut(tmp_path)
    kit = kit_bauen.baue({"rd": ["laut.wav"], "bd": ["laut.wav"]}, q, tmp_path / "k", "t", 4.0,
                         rollen={"rollen": {"bd": {"spitze_db": -6.0}}, "pegel_zusatz": {"rd": -16, "bd": -3}})
    by = {k["name"]: k for k in kit["klaenge"]}
    assert abs(spitze_db(tmp_path / "k" / by["rd:0"]["datei"]) + 16.0) < 0.01
    assert abs(spitze_db(tmp_path / "k" / by["bd:0"]["datei"]) + 6.0) < 0.01


def test_ohne_rollen_keine_spitzengrenze(tmp_path):
    q = _laut(tmp_path)
    kit_bauen.baue({"rd": ["laut.wav"]}, q, tmp_path / "k", "t", 4.0)  # altes Verhalten bleibt


def test_cli_fehler_auf_stderr_exit_1_ohne_traceback(tmp_path, capsys):
    q, ext, liste = _basis(tmp_path)
    (tmp_path / "l.json").write_text(json.dumps({"bd": ["a/bd.wav"] * 113}))
    rc = kit_bauen.main(["--liste", str(tmp_path / "l.json"), "--quelle", str(q), "--ziel", str(tmp_path / "k")])
    err = capsys.readouterr().err
    assert rc == 1 and "Noten 112+ belegt das Zusatz-Kit rec" in err and "Traceback" not in err
    assert not (tmp_path / "k").exists()


def test_rolle_gleich_laut_im_muster_hoechste_spitze_auf_spitze_db(tmp_path):
    from klang import lautheit, probe
    q = tmp_path / "q"
    wav(q / "lang.wav", 1.0, 60)     # gleiche Spitze, aber viel Energie
    wav(q / "kurz.wav", 0.03, 60)    # gleiche Spitze, kaum Energie: anderer Crest
    muster = [0, 4, 8, 12]
    rollen = {"rollen": {"bd": {"spitze_db": -6.0, "muster": muster}}}
    kit = kit_bauen.baue({"bd": ["lang.wav", "kurz.wav"]}, q, tmp_path / "k", "t", 4.0, rollen=rollen)
    ls, sp = [], []
    for e in kit["klaenge"]:
        d = np.fromfile(tmp_path / "k" / e["datei"], dtype="<f4")
        sp.append(20 * np.log10(np.max(np.abs(d))))
        ls.append(lautheit.integriert(probe.rendere_muster(d.reshape(-1, 2), rollen['rollen']['bd'], 48000), 48000))
        assert abs(e["muster_lufs"] - ls[-1]) < 0.02
    assert abs(ls[0] - ls[1]) < 0.2, ls
    assert abs(max(sp) + 6.0) < 0.01 and max(sp) <= -1.0 and min(sp) < max(sp) - 3.0  # die Spitzen liegen wirklich auseinander


def test_ohne_muster_bleibt_spitzen_normierung(tmp_path):
    q = tmp_path / "q"
    wav(q / "lang.wav", 1.0, 60)
    kit = kit_bauen.baue({"bd": ["lang.wav"]}, q, tmp_path / "k", "t", 4.0, rollen={"rollen": {"bd": {"spitze_db": -6.0}}})
    assert "muster_lufs" not in kit["klaenge"][0]


def test_exit_codes_fachlich_1_bedienfehler_2(tmp_path, capsys):
    q, ext, liste = _basis(tmp_path)
    assert _cli(tmp_path, {"bd": ["a/bd.wav"] * 113}, quelle=q) == 1
    (tmp_path / "kaputt.json").write_text("{nicht json")
    rc = kit_bauen.main(["--liste", str(tmp_path / "kaputt.json"), "--quelle", str(q), "--ziel", str(tmp_path / "z")])
    assert rc == 2 and "Traceback" not in capsys.readouterr().err
