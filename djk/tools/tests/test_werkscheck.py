"""werkscheck.py: the factory sound check. Measurement and verdict on generated WAVs, manifests from fixture folders (no render here)."""
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import werkscheck as wc  # noqa: E402

SR = 48000
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def schreibe_wav(pfad, x):
    """x: (n, 2) float32 -> 32-bit float stereo WAV at 48 kHz."""
    d = np.asarray(x, dtype="<f4").tobytes()
    kopf = b"RIFF" + struct.pack("<I", 36 + len(d)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, SR, SR * 8, 8, 32)
    pfad.write_bytes(kopf + b"data" + struct.pack("<I", len(d)) + d)


def sinus(amp, n=SR, f=440.0):
    t = np.arange(n) / SR
    s = (amp * np.sin(2 * np.pi * f * t)).astype("float32")
    return np.stack([s, s], axis=1)


def test_clean_file_is_green(tmp_path):
    p = tmp_path / "ok.wav"
    schreibe_wav(p, sinus(0.25))
    m = wc.messe_datei(p)
    assert wc.urteil(m) == ("gruen", [])
    assert -13 < m["spitze_db"] < -11 and not m["nan"] and not m["still"] and abs(m["dc"]) < 1e-3


def test_nan_file_is_red(tmp_path):
    x = sinus(0.25)
    x[100, 0] = np.nan
    p = tmp_path / "nan.wav"
    schreibe_wav(p, x)
    m = wc.messe_datei(p)
    u, gruende = wc.urteil(m)
    assert u == "rot" and "nan" in gruende and m["nan"] is True


def test_silent_file_is_red(tmp_path):
    p = tmp_path / "still.wav"
    schreibe_wav(p, sinus(0.0005))          # -66 dBFS peak, below the -60 threshold
    m = wc.messe_datei(p)
    u, gruende = wc.urteil(m)
    assert u == "rot" and "still" in gruende and m["still"] is True


def test_just_audible_file_is_not_silent(tmp_path):
    p = tmp_path / "leise.wav"
    schreibe_wav(p, sinus(0.002))           # -54 dBFS
    assert wc.urteil(wc.messe_datei(p))[0] == "gruen"


def test_zero_dbfs_file_is_red(tmp_path):
    x = sinus(0.5)
    x[10, 1] = 1.0                          # one sample at exactly 0 dBFS counts
    p = tmp_path / "heiss.wav"
    schreibe_wav(p, x)
    u, gruende = wc.urteil(wc.messe_datei(p))
    assert u == "rot" and "uebersteuert" in gruende


def test_dc_offset_is_red_and_small_dc_is_not(tmp_path):
    p = tmp_path / "dc.wav"
    schreibe_wav(p, sinus(0.1) + 0.05)
    m = wc.messe_datei(p)
    u, gruende = wc.urteil(m)
    assert u == "rot" and "dc" in gruende and abs(m["dc"] - 0.05) < 1e-3
    q = tmp_path / "dc_klein.wav"
    schreibe_wav(q, sinus(0.1) + 0.005)
    assert wc.urteil(wc.messe_datei(q))[0] == "gruen"


def test_dc_is_judged_per_channel(tmp_path):
    x = sinus(0.1)
    x[:, 1] += 0.05                         # only the right channel carries DC
    p = tmp_path / "dc_r.wav"
    schreibe_wav(p, x)
    assert "dc" in wc.urteil(wc.messe_datei(p))[1]


def test_missing_or_broken_file_is_red_not_a_crash(tmp_path):
    assert wc.urteil(wc.messe_datei(tmp_path / "gibt-es-nicht.wav"))[1] == ["fehlt"]
    kaputt = tmp_path / "kaputt.wav"
    kaputt.write_bytes(b"not a wav")
    assert wc.urteil(wc.messe_datei(kaputt))[1] == ["unlesbar"]


def test_generated_input_layout(tmp_path):
    p = tmp_path / "eingang.wav"
    wc.erzeuge_eingang(p)
    b = p.read_bytes()
    assert b[:4] == b"RIFF" and b[8:12] == b"WAVE"
    tag, kanaele, rate, _, _, bits = struct.unpack("<HHIIHH", b[20:36])
    assert (tag, kanaele, rate, bits) == (3, 2, SR, 32)       # what leseStarterWav accepts
    x = wc.lies_wav(p)
    assert x.shape == (3 * SR, 2)
    assert 20 * np.log10(np.abs(x[:SR]).max()) == np.float32(20 * np.log10(np.abs(x[:SR]).max())) and abs(20 * np.log10(np.abs(x[:SR]).max()) + 12) < 0.1
    assert abs(20 * np.log10(np.abs(x[SR:2 * SR]).max()) + 12) < 0.1
    assert np.abs(x[2 * SR:]).max() == 0.0                     # the third second is silence (tail)


def preset(wurzel, ordner, slug, geraet, graph=None, art="bass", werte=None, stifte=None, typ="instrument"):
    d = wurzel / ordner
    d.mkdir(parents=True, exist_ok=True)
    j = {"schema": 1, "name": slug, "geraet_typ": typ, "geraet": geraet, "werte": werte or {}, "beschreibung": {"art": art}}
    if graph:
        j["graph"] = graph
    if stifte:
        j["stifte"] = stifte
    (d / f"{slug}.preset.json").write_text(json.dumps(j))


def demos_ordner(wurzel, namen, effekte=()):
    d = wurzel / "demos"
    (d / "recipes").mkdir(parents=True)
    for i, n in enumerate(namen):
        knoten = [{"art": "eingang"}] if n in effekte else [{"art": "osz"}]
        ziel = d / "recipes" if i % 2 else d
        (ziel / f"{n}.json").write_text(json.dumps({"knoten": knoten}))
    return d


def test_modular_manifest_from_fixture(tmp_path):
    fabrik = tmp_path / "factory"
    preset(fabrik, "modular", "a-b", "baukasten", "bass-x", art="bass", werte={"knob1": 0.3, "knob7": 1, "volume": 0.5})
    preset(fabrik, "modular", "c-d", "baukasten", "drums-y", art="drums", stifte=[[0, 1, 2, 1.0]])
    preset(fabrik, "modular", "e-f", "baukasten", "fx-z", art="delay", typ="effekt")
    preset(fabrik, "rb338", "g", "rb338")
    demos = demos_ordner(tmp_path, ["bass-x", "drums-y", "fx-z"], effekte=["fx-z"])
    m = wc.manifest_modular(fabrik / "modular", demos)
    assert [e["id"] for e in m] == ["werk:baukasten/a-b", "werk:baukasten/c-d", "werk:baukasten/e-f"]
    a, c, e = m
    assert a["graph"] == "bass-x" and a["knoepfe"] == {"1": 0.3, "7": 1} and a["stifte"] is None and a["phrase"] == "bass"
    assert c["phrase"] == "kit" and c["stifte"] == [[0, 1, 2, 1.0]]
    assert e["effekt"] is True and a["effekt"] is False
    assert a["graph_datei"].endswith("bass-x")        # the name klang_pruefung resolves under demos/ ("recipes/..." when it lives there)
    assert c["graph_datei"] == "recipes/drums-y"


def test_modular_manifest_names_a_missing_graph(tmp_path):
    fabrik = tmp_path / "factory"
    preset(fabrik, "modular", "a-b", "baukasten", "gibt-es-nicht")
    demos = demos_ordner(tmp_path, [])
    e = wc.manifest_modular(fabrik / "modular", demos)[0]
    assert e["graph_datei"] is None and "gibt-es-nicht" in e["grund"]


def test_device_manifest_from_fixture(tmp_path):
    geraete = tmp_path / "geraete.json"
    geraete.write_text(json.dumps([
        {"name": "drums-x", "art": "bk", "familie": "drums"},
        {"name": "bass-y", "art": "bk", "familie": "mono"},
        {"name": "fx-z", "art": "bk", "familie": "fx"},
        {"name": "rb338", "art": "rb338", "familie": "mono"},
        {"name": "surge", "art": "surge", "familie": "poly"},
    ]))
    demos = demos_ordner(tmp_path, ["drums-x", "bass-y", "fx-z"], effekte=["fx-z"])
    m = wc.manifest_geraete(geraete, demos)
    assert [(e["id"], e["weg"]) for e in m] == [("drums-x", "klang_pruefung"), ("bass-y", "klang_pruefung"), ("fx-z", "projekt"), ("rb338", "projekt"), ("surge", "skip")]
    assert m[0]["phrase"] == "kit" and m[1]["phrase"] == "bass"
    assert "third-party plugin" in m[4]["grund"]


def test_real_repo_counts():
    m = wc.manifest_modular(os.path.join(REPO, "djk/ui/presets/factory/modular"), os.path.join(REPO, "djk/instruments/modular_dsp/demos"))
    assert len(m) == 200 and all(e["graph_datei"] for e in m)
    g = wc.manifest_geraete(os.path.join(REPO, "djk/instruments/modular_dsp/geraete.json"), os.path.join(REPO, "djk/instruments/modular_dsp/demos"))
    assert len(g) == 82
    assert sum(e["weg"] == "skip" for e in g) == 1


def test_report_counts_and_red_first(tmp_path):
    zeilen = [
        {"id": "werk:eq/a", "ordner": "eq", "art": "effekt", "weg": "projekt", "urteil": "gruen", "spitze_db": -3.0, "rms_db": -12.0, "dc": 0.0, "nan": False, "still": False, "grund": ""},
        {"id": "werk:eq/b", "ordner": "eq", "art": "effekt", "weg": "projekt", "urteil": "rot", "spitze_db": -90.0, "rms_db": -95.0, "dc": 0.0, "nan": False, "still": True, "grund": "still"},
        {"id": "werk:hall/c", "ordner": "reverb", "art": "effekt", "weg": "skip", "urteil": "skip", "spitze_db": None, "rms_db": None, "dc": None, "nan": None, "still": None, "grund": "cannot be placed"},
    ]
    wc.schreibe_bericht(tmp_path, zeilen, [])
    j = json.loads((tmp_path / "bericht.json").read_text())
    assert j["zahlen"]["eq"] == {"gesamt": 2, "gruen": 1, "rot": 1, "skip": 0}
    assert j["zahlen"]["reverb"]["skip"] == 1
    md = (tmp_path / "bericht.md").read_text()
    assert md.index("werk:eq/b") < md.index("werk:eq/a")          # red rows come first
    assert "cannot be placed" in md                                 # every skip is listed with its reason


def test_exit_code():
    rot = [{"urteil": "rot"}, {"urteil": "gruen"}]
    assert wc.exitcode(rot, werkzeug_fehlt=False) == 1
    assert wc.exitcode([{"urteil": "gruen"}, {"urteil": "skip"}], werkzeug_fehlt=False) == 0
    assert wc.exitcode([], werkzeug_fehlt=True) == 77


def test_generated_input_is_dc_free_per_channel_and_second(tmp_path):
    p = tmp_path / "eingang.wav"
    wc.erzeuge_eingang(p)
    x = wc.lies_wav(p).astype("float64")
    for sek in range(3):
        for kanal in range(2):
            assert abs(x[sek * SR:(sek + 1) * SR, kanal].mean()) < 1e-4, (sek, kanal)
    assert wc.dc_eingang(p) < 1e-4
    assert abs(20 * np.log10(np.abs(x[:SR]).max()) + 12) < 0.1 and abs(20 * np.log10(np.abs(x[SR:2 * SR]).max()) + 12) < 0.1


def test_dc_input_measure(tmp_path):
    p = tmp_path / "dc.wav"
    schreibe_wav(p, sinus(0.1, n=2 * SR) + 0.03)
    assert abs(wc.dc_eingang(p) - 0.03) < 1e-3
    assert wc.dc_eingang(tmp_path / "gibt-es-nicht.wav") == 0.0


def test_dc_is_red_only_above_threshold_and_above_the_input(tmp_path):
    p = tmp_path / "dc.wav"
    schreibe_wav(p, sinus(0.1) + 0.05)
    m = wc.messe_datei(p)
    assert wc.urteil(m, eingang_dc=0.0)[0] == "rot"
    assert wc.urteil(m, eingang_dc=0.06)[0] == "gruen"       # the input carried more than the output has
    assert wc.urteil(m, eingang_dc=0.02)[0] == "rot"          # the effect added DC


def test_report_header_names_the_input_dc(tmp_path):
    wc.schreibe_bericht(tmp_path, [], [], eingang_dc=2.5e-5)
    assert "Input DC" in (tmp_path / "bericht.md").read_text() and "2.50e-05" in (tmp_path / "bericht.md").read_text()
    assert json.loads((tmp_path / "bericht.json").read_text())["eingang_dc"] == 2.5e-5


def test_klang_pruefung_raw_peak_decides_clipping_not_the_clamped_wav(tmp_path):
    p = tmp_path / "geklemmt.wav"
    schreibe_wav(p, sinus(0.99))                      # the clamped file stays below 0 dBFS
    m = wc.messe_datei(p)
    assert wc.urteil(m)[0] == "gruen"
    m = wc.mit_rohspitze(m, {"peak_db": 1.07})        # the engine's raw peak was +1.07 dB
    u, gruende = wc.urteil(m)
    assert u == "rot" and "uebersteuert" in gruende and m["spitze_db"] == 1.07
    assert wc.urteil(wc.mit_rohspitze(wc.messe_datei(p), {"peak_db": -0.4}))[0] == "gruen"
    assert wc.urteil(wc.mit_rohspitze(wc.messe_datei(p), {"peak_db": 0.0}))[0] == "rot"
    assert wc.mit_rohspitze({"fehlt": True}, {"peak_db": 3.0}) == {"fehlt": True}      # an unreadable file stays as it is


def test_clipping_verdict_takes_the_loudest_of_all_phrases(tmp_path):
    p = tmp_path / "w.wav"
    schreibe_wav(p, sinus(0.3))
    gemessen = wc.messe_datei(p)
    m = dict(gemessen, spitze_db=-3.0)                                  # the role phrase is clean
    m = wc.mit_maximaler_rohspitze(m, {"lead": -3.0, "bass": 1.9, "kit": -8.0})
    u, gruende = wc.urteil(m)
    assert u == "rot" and "uebersteuert" in gruende and m["spitze_db"] == 1.9 and m["spitzen_phrase"] == "bass"
    sauber = wc.mit_maximaler_rohspitze(dict(gemessen, spitze_db=-3.0), {"lead": -3.0, "bass": -1.0})
    assert wc.urteil(sauber)[0] == "gruen" and sauber["spitze_db"] == -1.0 and "spitzen_phrase" not in sauber
    assert wc.mit_maximaler_rohspitze({"fehlt": True}, {"bass": 3.0}) == {"fehlt": True}


def test_laufe_klang_all_phrases_turns_a_hidden_clip_red(tmp_path, monkeypatch):
    peaks = {"leise": {"lead": -6.0, "bass": -5.0, "chord": -4.0, "held": -7.0, "perc": -9.0, "kit": -9.0},
             "laut": {"lead": -6.0, "bass": -5.0, "chord": 0.6, "held": -7.0, "perc": -9.0, "kit": -9.0}}
    wav = tmp_path / "x.wav"
    schreibe_wav(wav, sinus(0.3))

    def fake(binar, faelle, phrase_je_fall, tmp, wurzel):
        return {wc._sicher(e["id"]): {"peak_db": peaks[e["id"]][phrase_je_fall[e["id"]]], "_mass": wc.messe_datei(wav)} for e in faelle}
    monkeypatch.setattr(wc, "_klang_pruefung", fake)
    eintraege = [{"id": i, "ordner": "modular", "art": "instrument", "graph_datei": "g", "knoepfe": {}, "stifte": None, "phrase": "lead", "effekt": False}
                 for i in peaks]
    (tmp_path / "aus").mkdir()
    z = {r["id"]: r for r in wc.laufe_klang("bin", eintraege, tmp_path / "aus", tmp_path, alle_phrasen=True)}
    assert z["leise"]["urteil"] == "gruen" and z["leise"]["spitze_db"] == -4.0
    assert z["laut"]["urteil"] == "rot" and z["laut"]["spitze_db"] == 0.6 and "chord" in z["laut"]["grund"]
    # without the flag only the role phrase counts, as before
    z0 = {r["id"]: r for r in wc.laufe_klang("bin", eintraege, tmp_path / "aus", tmp_path)}
    assert z0["laut"]["urteil"] == "gruen"


def test_preset_eintraege_reads_another_checkout(tmp_path):
    (tmp_path / "comp").mkdir()
    (tmp_path / "comp" / "a.preset.json").write_text(json.dumps({"geraet": "comp", "geraet_typ": "effekt"}))
    assert [e["id"] for e in wc.preset_eintraege("comp", tmp_path)] == ["werk:comp/a"]


def _checkout(tmp_path, mit_demos=True, mit_geraete=True, presets=1):
    wt = tmp_path / "wt"
    fabrik = wt / "djk/ui/presets/factory"
    (fabrik / "modular").mkdir(parents=True)
    dsp = wt / "djk/instruments/modular_dsp"
    (dsp / "demos").mkdir(parents=True) if mit_demos else dsp.mkdir(parents=True)
    if mit_geraete:
        (dsp / "geraete.json").write_text("[]")
    for i in range(presets):
        (fabrik / "modular" / f"p{i}.preset.json").write_text(json.dumps({"geraet": "baukasten", "graph": "g", "werte": {}}))
    return fabrik, dsp


def test_presets_of_another_checkout_bring_their_own_graphs_and_devices(tmp_path):
    assert wc.layout_zu_presets(wc.FABRIK) == (wc.DEMOS, wc.GERAETE)
    fabrik, dsp = _checkout(tmp_path)
    assert wc.layout_zu_presets(fabrik) == (dsp.resolve() / "demos", dsp.resolve() / "geraete.json")
    assert wc.graph_fuer_binar(None, dsp / "demos") is None
    rel = wc.graph_fuer_binar("recipes/x", dsp / "demos")
    assert os.path.normpath(os.path.join(wc.DEMOS, rel)) == os.path.normpath(str((dsp / "demos").resolve() / "recipes/x"))
    assert wc.graph_fuer_binar("recipes/x", wc.DEMOS) == "recipes/x"


def test_unrecognised_layout_is_an_error_not_a_silent_mix(tmp_path):
    import pytest
    fabrik, _ = _checkout(tmp_path)
    with pytest.raises(ValueError):
        wc.layout_zu_presets(fabrik / "modular")                 # the .../factory/modular path
    with pytest.raises(ValueError):
        wc.layout_zu_presets(tmp_path)                           # a folder outside the layout
    fabrik2, _ = _checkout(tmp_path / "b", mit_demos=False)
    with pytest.raises(ValueError):
        wc.layout_zu_presets(fabrik2)                            # a checkout without demos/ (dsp folder exists, demos/ does not)
    fabrik3, _ = _checkout(tmp_path / "c", mit_geraete=False)
    with pytest.raises(ValueError):
        wc.layout_zu_presets(fabrik3)                            # no devices file


def _main_vorbereiten(monkeypatch, tmp_path, aufrufe):
    exe = tmp_path / "render"
    exe.write_text("")
    monkeypatch.setattr(wc.shutil, "which", lambda _: "/usr/bin/cargo")
    monkeypatch.setattr(wc, "render_programm", lambda: exe)
    monkeypatch.setattr(wc, "baue_beispiele", lambda: tmp_path)
    monkeypatch.setattr(wc, "erzeuge_eingang", lambda p: None)
    monkeypatch.setattr(wc, "dc_eingang", lambda p: 0.0)
    monkeypatch.setattr(wc, "erzeuge_proben", lambda b, z: None)

    def klang(binar, eintraege, ausgabe, wurzel, alle_phrasen=False):
        aufrufe.append((sorted(e["ordner"] for e in eintraege), alle_phrasen))
        return [{"id": e["id"], "ordner": e["ordner"], "art": "instrument", "weg": "klang_pruefung", "urteil": "gruen", "spitze_db": -3.0,
                 "rms_db": -20.0, "dc": 0.0, "nan": False, "still": False, "grund": ""} for e in eintraege]
    monkeypatch.setattr(wc, "laufe_klang", klang)


def test_main_asks_for_all_phrases_for_presets_and_devices(tmp_path, monkeypatch):
    fabrik, dsp = _checkout(tmp_path)
    (dsp / "demos" / "g.json").write_text('{"knoten": [{"id": "aus", "art": "ausgang"}], "kanten": []}')
    (dsp / "geraete.json").write_text(json.dumps([{"name": "g", "art": "bk", "familie": "synth"}]))
    aufrufe = []
    _main_vorbereiten(monkeypatch, tmp_path, aufrufe)
    rc = wc.main(["--presets", str(fabrik), "--ausgabe", str(tmp_path / "aus"), "--nur", "modular"])
    assert rc == 0 and aufrufe and all(flag for _, flag in aufrufe)              # fails when main drops alle_phrasen=True for the modular run
    aufrufe.clear()
    wc.main(["--presets", str(fabrik), "--ausgabe", str(tmp_path / "aus2"), "--nur", "geraete"])
    assert aufrufe and all(flag for _, flag in aufrufe)                          # ... or for the devices
    kopf = (tmp_path / "aus" / "bericht.md").read_text()
    assert str(fabrik.resolve()) in kopf and str((dsp / "demos").resolve()) in kopf and str((dsp / "geraete.json").resolve()) in kopf
    q = json.loads((tmp_path / "aus" / "bericht.json").read_text())["quellen"]
    assert q["devices"] == str((dsp / "geraete.json").resolve())


def test_main_stops_on_bad_layout_and_on_zero_presets(tmp_path, monkeypatch):
    fabrik, _ = _checkout(tmp_path)
    aufrufe = []
    _main_vorbereiten(monkeypatch, tmp_path, aufrufe)
    assert wc.main(["--presets", str(fabrik / "modular"), "--ausgabe", str(tmp_path / "a")]) == 2
    leer, _ = _checkout(tmp_path / "leer", presets=0)
    assert wc.main(["--presets", str(leer), "--ausgabe", str(tmp_path / "b")]) == 2
    assert aufrufe == []                                                          # nothing was measured


def test_a_crash_in_a_non_role_phrase_is_reported_not_left_out(tmp_path, monkeypatch):
    wav = tmp_path / "x.wav"
    schreibe_wav(wav, sinus(0.3))

    def fake(binar, faelle, phrase_je_fall, tmp, wurzel):
        out = {}
        for e in faelle:
            ph = phrase_je_fall[e["id"]]
            out[wc._sicher(e["id"])] = {"abgestuerzt": "panic in kit"} if ph == "kit" else {"peak_db": -6.0, "_mass": wc.messe_datei(wav)}
        return out
    monkeypatch.setattr(wc, "_klang_pruefung", fake)
    e = {"id": "g", "ordner": "modular", "art": "instrument", "graph_datei": "g", "knoepfe": {}, "stifte": None, "phrase": "lead", "effekt": False}
    (tmp_path / "aus").mkdir()
    z = wc.laufe_klang("bin", [e], tmp_path / "aus", tmp_path, alle_phrasen=True)[0]
    assert z["urteil"] == "rot" and "phrase kit" in z["grund"] and "panic in kit" in z["grund"]


def test_project_render_reads_the_presets_of_the_folder_under_test(tmp_path, monkeypatch):
    fabrik, dsp = _checkout(tmp_path)
    (fabrik / "comp").mkdir()
    (fabrik / "comp" / "a.preset.json").write_text(json.dumps({"geraet": "comp", "geraet_typ": "effekt"}))
    cmds = []

    def fake_run(cmd, **kw):
        cmds.append((cmd, kw))
        raise OSError("stop")                       # no render; only the command is of interest
    _main_vorbereiten(monkeypatch, tmp_path, [])
    monkeypatch.setattr(wc.subprocess, "run", fake_run)
    try:
        wc.main(["--presets", str(fabrik), "--ausgabe", str(tmp_path / "aus"), "--nur", "effekte"])
    except OSError:
        pass
    assert cmds, "no project render was started"
    cmd = cmds[0][0]
    assert cmd[cmd.index("--preset") + 1] == "werk:comp/a"
    assert cmd[cmd.index("--werk") + 1] == str(fabrik.resolve())          # another checkout's folder, never this checkout's
    fremd = [x for x in cmd if str(x).startswith(str(wc.REPO)) and x != str(wc.RENDER_PRESET)]
    assert fremd == []                              # no argument points into this checkout (the tool itself aside)


def test_project_render_default_is_this_checkouts_factory(tmp_path, monkeypatch):
    cmds = []
    monkeypatch.setattr(wc.subprocess, "run", lambda cmd, **kw: cmds.append(cmd) or (_ for _ in ()).throw(OSError("stop")))
    e = {"id": "werk:comp/a", "ordner": "comp", "art": "effekt", "effekt": True}
    try:
        wc.laufe_projekt(e, tmp_path, tmp_path / "in.wav", tmp_path)
    except OSError:
        pass
    assert cmds[0][cmds[0].index("--werk") + 1] == str(wc.FABRIK)


def test_main_with_zero_rows_exits_2(tmp_path, monkeypatch):
    fabrik, _ = _checkout(tmp_path)                 # modular presets exist, but --nur effekte finds no effect folder
    _main_vorbereiten(monkeypatch, tmp_path, [])
    assert wc.main(["--presets", str(fabrik), "--ausgabe", str(tmp_path / "aus"), "--nur", "effekte"]) == 2
    assert not (tmp_path / "aus" / "bericht.md").exists()
