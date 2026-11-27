"""werkstatt.noten_netz (note editor, task B3): the SwiftF0 path that writes the raw curve of djk/contract/noten.md.

All tests but the last one replace the network (`netz_roh`) by a stand-in with known frames, so the mapping onto the contract grid,
the curve format and the command line are pinned without the model. The last test runs the real network on a chirp and is skipped
where swift_f0 is not installed."""
import importlib.util
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from werkstatt import notes_net as nn
from click_helper import braucht_swift_f0

HIER = Path(__file__).resolve().parent.parent
CONTRACT = HIER.parent / "contract"
SR = 48000


def schreibe_f32(pfad, mono, rechts=None):
    st = np.stack([mono, mono if rechts is None else rechts], 1).astype("<f4")
    st.tofile(pfad)
    return len(st)


def sinus(n, hz=440.0, amp=0.5):
    return (amp * np.sin(2 * np.pi * hz * np.arange(n) / SR)).astype(np.float32)


@pytest.fixture
def attrappe(monkeypatch):
    """Stand-in network: every 16 ms frame voiced at 441 Hz with confidence 0.9 (a 440 Hz sine is the source)."""
    def netz_roh(x, sr):
        m = len(nn._auf_16k(x, sr)) // nn.NETZ_HOP + 1
        return np.arange(m) * 0.016 + nn.FRAME_VERSATZ, np.full(m, 441.0), np.full(m, 0.9)
    monkeypatch.setattr(nn, "netz_roh", netz_roh)
    monkeypatch.setattr(nn, "_netz", lambda: object())


def schema_pruefer():
    pytest.importorskip("jsonschema")
    pytest.importorskip("referencing")
    sys.path.insert(0, str(CONTRACT))
    import schema_loader as schema_lader
    return schema_lader.validator("noten_kurve_roh.schema.json")


def test_raster_mapping_on_a_fake_network():
    """Expected values copied from the bench's auf_raster (m21_k_swiftf0.py) on this input: unvoiced gaps, interpolation between
    voiced neighbours, voicing from the nearest network frame, linear confidence."""
    zeit = np.arange(8) * 0.016 + nn.FRAME_VERSATZ
    hz = np.array([0.0, 220.0, 224.0, 0.0, 440.0, 446.0, 330.0, 0.0])
    konf = np.array([0.1, 0.9, 0.8, 0.3, 0.95, 0.7, 0.6, 0.2])
    f0, k = nn.auf_raster(zeit, hz, konf, SR, 5000)
    assert len(f0) == 5000 // 256 + 1 == 20
    soll_f0 = [0.0, 0.0, 5700.0, 5702.729497, 5713.12758, 5723.525664, 5731.19425, 5731.19425, 0.0, 0.0, 0.0, 6900.0, 6902.05172,
               6909.867794, 6917.683869, 6877.817567, 6703.986492, 6530.155418, 6401.955001, 6401.955001]
    soll_k = [0.17, 0.436667, 0.703333, 0.89125, 0.857917, 0.824583, 0.75625, 0.589583, 0.422917, 0.356875, 0.573542, 0.790208,
              0.928125, 0.844792, 0.761458, 0.69125, 0.657917, 0.624583, 0.565, 0.431667]
    np.testing.assert_allclose(f0, soll_f0, atol=1e-5)
    np.testing.assert_allclose(k, soll_k, atol=1e-5)


def test_yin_fein_pulls_a_coarse_value_onto_the_tone():
    """A coarse value 30 cents off inside the band is refined to the true pitch; an unvoiced frame stays 0; a coarse value more than
    the band away cannot jump to another pitch."""
    n = SR // 2
    x = sinus(n)
    nf = n // nn.HOP + 1
    grob = np.full(nf, 6930.0)
    grob[10] = 0.0
    fein, dmin = nn.yin_fein(x, SR, grob)
    assert fein[10] == 0.0
    voll = np.delete(fein, [10])[8:-8]                      # skip the edges where the window is cut
    assert np.max(np.abs(voll - 6900.0)) < 1.0
    weit = nn.yin_fein(x, SR, np.full(nf, 7100.0))[0][8:-8]  # 200 cents off: outside the band, the search cannot reach 6900
    assert np.min(weit) > 6900.0 + 100.0


def test_output_follows_the_raw_curve_schema(tmp_path, attrappe, capsys):
    pruefer = schema_pruefer()
    n = 12345
    quelle = tmp_path / "quelle.f32"
    schreibe_f32(quelle, sinus(n))
    aus = tmp_path / "roh.json"
    assert nn.main(["--quelle", str(quelle), "--aus", str(aus)]) == 0
    zeilen = capsys.readouterr().out.splitlines()
    assert len(zeilen) == 1
    erg = json.loads(zeilen[0])
    kurve = json.loads(aus.read_text(encoding="utf-8"))
    pruefer.validate(kurve)
    frames = n // 256 + 1
    assert kurve["frames"] == n and kurve["detektor"] == "netz" and kurve["detektor_version"] == "netz-1"
    assert len(kurve["f0_ct"]) == len(kurve["konf"]) == frames
    assert erg["status"] == "ok" and erg["frames"] == n
    stimmhaft = sum(1 for v in kurve["f0_ct"] if v) / frames
    assert erg["stimmhaft"] == pytest.approx(stimmhaft, abs=1e-4) and stimmhaft > 0.9
    assert all(round(v, 2) == v for v in kurve["f0_ct"]) and all(round(v, 3) == v for v in kurve["konf"])
    voll = np.array([v for v in kurve["f0_ct"] if v][8:-8])
    assert abs(np.median(voll) - 6900.0) < 1.0                # the stand-in says 441 Hz, YIN finds the 440 Hz of the source
    assert not list(tmp_path.glob("*.tmp"))


def test_mono_mix_is_the_mean_of_both_channels(tmp_path, monkeypatch):
    """One channel carries the tone, the other its inverse: the detector sees silence."""
    gesehen = []

    def netz_roh(x, sr):
        gesehen.append(np.max(np.abs(x)))
        return np.array([0.0, 0.016]), np.array([0.0, 0.0]), np.array([0.0, 0.0])
    monkeypatch.setattr(nn, "netz_roh", netz_roh)
    x = sinus(4000)
    stereo = np.stack([x, -x], 1)
    kurve = nn.roh_kurve(stereo)
    assert gesehen == [0.0]
    assert set(kurve["f0_ct"]) == {0}


def test_pruefen_reports_missing_runtime(monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "swift_f0", None)         # import raises ImportError
    monkeypatch.setattr(nn, "_NETZ", None)
    assert nn.main(["--pruefen"]) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "fehler", "grund": "netz_fehlt"}


def test_pruefen_reports_a_usable_runtime(monkeypatch, capsys):
    monkeypatch.setattr(nn, "_netz", lambda: object())
    assert nn.main(["--pruefen"]) == 0
    assert capsys.readouterr().out == '{"status":"ok","netz":true,"version":"netz-1"}\n'


def test_missing_runtime_in_a_run_is_netz_fehlt_and_writes_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "swift_f0", None)
    monkeypatch.setattr(nn, "_NETZ", None)
    quelle = tmp_path / "q.f32"
    schreibe_f32(quelle, sinus(5000))
    assert nn.main(["--quelle", str(quelle), "--aus", str(tmp_path / "roh.json")]) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "fehler", "grund": "netz_fehlt"}
    assert not (tmp_path / "roh.json").exists()


@pytest.mark.parametrize("frames", [0, 100])
def test_empty_and_short_input(tmp_path, monkeypatch, frames):
    """0 frames and 100 frames: a valid curve of floor(n/256)+1 = 1 frame, unvoiced."""
    pruefer = schema_pruefer()
    monkeypatch.setattr(nn, "_netz", lambda: object())
    monkeypatch.setattr(nn, "netz_roh", lambda x, sr: (np.array([0.0]), np.array([0.0]), np.array([0.0])))
    quelle = tmp_path / "q.f32"
    schreibe_f32(quelle, sinus(frames))
    aus = tmp_path / "roh.json"
    assert nn.main(["--quelle", str(quelle), "--aus", str(aus)]) == 0
    kurve = json.loads(aus.read_text(encoding="utf-8"))
    pruefer.validate(kurve)
    assert kurve["frames"] == frames and kurve["f0_ct"] == [0] and kurve["konf"] == [0.0]


def test_empty_input_never_reaches_the_network(monkeypatch):
    monkeypatch.setattr(nn, "netz_roh", lambda x, sr: pytest.fail("the network must not run on an empty source"))
    kurve = nn.roh_kurve(np.zeros((0, 2), np.float32))
    assert kurve["f0_ct"] == [0] and kurve["frames"] == 0


def test_errors_and_progress(tmp_path, attrappe, capsys):
    ok = tmp_path / "q.f32"
    schreibe_f32(ok, sinus(5000))
    assert nn.main(["--quelle", str(tmp_path / "gibt_es_nicht.f32"), "--aus", str(tmp_path / "r.json")]) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "fehler", "grund": "datei_fehlt"}
    kaputt = tmp_path / "kaputt.f32"
    kaputt.write_bytes(b"\x00" * 7)                             # not a multiple of 8
    assert nn.main(["--quelle", str(kaputt), "--aus", str(tmp_path / "r.json")]) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "fehler", "grund": "datei_kaputt"}
    assert nn.main(["--quelle", str(ok), "--aus", str(tmp_path / "kein_ordner" / "r.json")]) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "fehler", "grund": "schreiben"}
    assert nn.main(["--quelle", str(ok), "--aus", str(tmp_path / "r.json")]) == 0
    aus = capsys.readouterr()
    namen = [json.loads(z[len("@@fortschritt "):])["name"] for z in aus.err.splitlines() if z.startswith("@@fortschritt ")]
    assert [n for i, n in enumerate(namen) if i == 0 or n != namen[i - 1]] == ["laden", "tonhoehe", "schreiben"]
    assert len(aus.out.splitlines()) == 1


def test_progress_lines_follow_the_progress_schema(tmp_path, attrappe, capsys):
    """Every real progress line of a run is valid against noten_zeile.schema.json#/$defs/fortschritt (prozent a number 0..100, no
    null) and the stages come in order: each starts at 0 and ends at 100."""
    sys.path.insert(0, str(CONTRACT))
    pytest.importorskip("jsonschema")
    import schema_loader as schema_lader
    pruefer = schema_lader.validator("noten_zeile.schema.json#/$defs/fortschritt")
    quelle = tmp_path / "q.f32"
    schreibe_f32(quelle, sinus(5000))
    assert nn.main(["--quelle", str(quelle), "--aus", str(tmp_path / "r.json")]) == 0
    zeilen = [z for z in capsys.readouterr().err.splitlines() if z.startswith("@@fortschritt ")]
    assert zeilen
    meldungen = [json.loads(z[len("@@fortschritt "):]) for z in zeilen]
    for m in meldungen:
        pruefer.validate(m)
        assert m["stufe"] <= m["von"]
    assert [(m["name"], m["prozent"]) for m in meldungen] == [
        ("laden", 0), ("laden", 100), ("tonhoehe", 0), ("tonhoehe", 100), ("schreiben", 0), ("schreiben", 100)]


def test_a_programming_error_is_not_reported_as_netz_fehlt(tmp_path, monkeypatch, capsys):
    """Import and model-load failures and runtime errors of the network are `netz_fehlt`; a TypeError is a bug and propagates."""
    quelle = tmp_path / "q.f32"
    schreibe_f32(quelle, sinus(5000))
    monkeypatch.setattr(nn, "_netz", lambda: object())

    def kaputt(x, sr):
        raise TypeError("bug")
    monkeypatch.setattr(nn, "netz_roh", kaputt)
    with pytest.raises(TypeError):
        nn.main(["--quelle", str(quelle), "--aus", str(tmp_path / "r.json")])
    capsys.readouterr()
    assert not (tmp_path / "r.json").exists()


def test_a_runtime_error_of_the_network_is_netz_fehlt(tmp_path, monkeypatch, capsys):
    quelle = tmp_path / "q.f32"
    schreibe_f32(quelle, sinus(5000))

    class Netz:
        def detect(self, audio, sr):
            raise RuntimeError("onnxruntime failed")
    monkeypatch.setattr(nn, "_netz", lambda: Netz())
    assert nn.main(["--quelle", str(quelle), "--aus", str(tmp_path / "r.json")]) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "fehler", "grund": "netz_fehlt"}


def test_usage_errors_exit_2(capsys):
    for argv in ([], ["--quelle", "x"], ["--pruefen", "--aus", "x"]):
        with pytest.raises(SystemExit) as ex:
            nn.main(argv)
        assert ex.value.code == 2
    capsys.readouterr()


@braucht_swift_f0
def test_real_network_on_a_chirp(tmp_path):
    """The real network through the real command line: chirp 110..880 Hz with six harmonics, 4 s; median error at most 3 cents on
    the voiced frames in the middle, one result line on stdout, a curve that the schema accepts (when jsonschema is there)."""
    f_a, f_e, dauer = 110.0, 880.0, 4.0
    t = np.arange(int(dauer * SR)) / SR
    rate = math.log(f_e / f_a) / dauer
    ph = 2 * np.pi * f_a * (np.exp(rate * t) - 1.0) / rate
    x = sum(np.sin(k * ph) / k for k in range(1, 7))
    x = (0.5 * x / np.max(np.abs(x))).astype(np.float32)
    quelle, aus = tmp_path / "chirp.f32", tmp_path / "roh.json"
    n = schreibe_f32(quelle, x)
    p = subprocess.run([sys.executable, "-m", "werkstatt.notes_net", "--quelle", str(quelle), "--aus", str(aus)],
                       cwd=HIER, capture_output=True, text=True, timeout=300, env={**os.environ, "OMP_NUM_THREADS": "2"})
    assert p.returncode == 0, p.stderr
    assert len(p.stdout.splitlines()) == 1 and json.loads(p.stdout)["status"] == "ok"
    kurve = json.loads(aus.read_text(encoding="utf-8"))
    if importlib.util.find_spec("jsonschema") is not None:     # the bench venv has none; the stand-in tests cover the schema there
        schema_pruefer().validate(kurve)
    assert kurve["frames"] == n and len(kurve["f0_ct"]) == n // 256 + 1
    f0 = np.array(kurve["f0_ct"])
    zeit = np.arange(len(f0)) * 256 / SR
    wahr = 6900.0 + 1200.0 * np.log2(f_a * np.exp(rate * zeit) / 440.0)
    mitte = (zeit > 0.3) & (zeit < 3.5) & (f0 > 0)
    assert mitte.sum() > 0.8 * ((zeit > 0.3) & (zeit < 3.5)).sum()
    assert np.median(np.abs(f0[mitte] - wahr[mitte])) <= 3.0
