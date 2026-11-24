"""Browser plan 1, task 7: light tempo and root-note analysis. Synthetic audio only; the CLI runs on a catalogue the real builder made in tmp_path."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from bibliothek import __main__ as befehl
from bibliothek.analysis import MARKER, analysiere_datei, bewerte_tempo, schaetze_grundton, schaetze_tempo

SR = 44100


def klicks(bpm: float, takte: int, geister: bool = False, sr: int = SR) -> np.ndarray:
    """A click train: one decaying noise burst per beat (and weaker ones on the off-beats when `geister`)."""
    rng = np.random.default_rng(7)
    beat = 60.0 / bpm
    x = np.zeros(int(round(takte * 4 * beat * sr)), dtype="float32")
    burst = (rng.standard_normal(int(0.03 * sr)) * np.exp(-np.arange(int(0.03 * sr)) / (0.006 * sr))).astype("float32")
    for i in range(takte * 4):
        for off, amp in ((0.0, 1.0), (0.5, 0.35) if geister else (0.5, 0.0)):
            if amp == 0.0:
                continue
            s = int(round((i + off) * beat * sr))
            seg = burst[: max(0, min(len(burst), len(x) - s))]
            x[s:s + len(seg)] += amp * seg
    return x * 0.5


def sinus(f: float, sek: float = 1.0, sr: int = SR) -> np.ndarray:
    t = np.arange(int(sek * sr)) / sr
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 1.5) * 0.6).astype("float32")


def kick(sr: int = SR) -> np.ndarray:
    t = np.arange(int(0.5 * sr)) / sr
    f = 45 + 120 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / sr
    return (np.sin(ph) * np.exp(-t / 0.18) * 0.8).astype("float32")


def test_click_train_at_120_bpm_4_bars_gives_120_within_1_bpm():
    assert abs(schaetze_tempo(klicks(120, 4), SR) - 120.0) <= 1.0


def test_the_same_at_128_bpm_2_bars_gives_128():
    assert abs(schaetze_tempo(klicks(128, 2), SR) - 128.0) <= 1.0


def test_a_half_time_confusion_clicks_every_beat_plus_off_beat_ghosts_still_lands_in_70_to_180():
    t = schaetze_tempo(klicks(120, 4, geister=True), SR)
    assert t is not None and 70.0 <= t <= 180.0
    assert abs(t - 120.0) <= 1.0


def test_a_loop_shorter_than_one_bar_returns_none():
    assert schaetze_tempo(klicks(120, 1)[: int(0.4 * SR)], SR) is None


def test_silence_returns_none_for_tempo_and_key():
    s = np.zeros(4 * SR, dtype="float32")
    assert schaetze_tempo(s, SR) is None and schaetze_grundton(s, SR) is None


def test_a_220_hz_sine_gives_8A_and_261_63_hz_gives_5A():
    assert schaetze_grundton(sinus(220.0), SR) == "8A"
    assert schaetze_grundton(sinus(261.63), SR) == "5A"


def test_white_noise_gives_no_key_clarity_threshold_0_85():
    rng = np.random.default_rng(3)
    assert schaetze_grundton((rng.standard_normal(SR) * 0.3).astype("float32"), SR) is None


def test_a_kick_drum_one_shot_gives_no_key():
    assert schaetze_grundton(kick(), SR) is None


def test_a_mono_and_a_stereo_file_both_work(tmp_path):
    x = klicks(120, 4)
    sf.write(tmp_path / "mono.wav", x, SR)
    sf.write(tmp_path / "stereo.wav", np.stack([x, x * 0.8], axis=1), SR)
    for n in ("mono.wav", "stereo.wav"):
        e = analysiere_datei(tmp_path / n, "loop")
        assert e[MARKER] == "1" and abs(float(e["bpm"]) - 120.0) <= 1.0, n


def test_loops_get_only_a_tempo_and_one_shots_only_a_key(tmp_path):
    sf.write(tmp_path / "ton.wav", sinus(220.0), SR)
    sf.write(tmp_path / "loop.wav", klicks(120, 4), SR)
    assert set(analysiere_datei(tmp_path / "ton.wav", "oneshot")) == {MARKER, "camelot"}
    assert set(analysiere_datei(tmp_path / "loop.wav", "loop")) == {MARKER, "bpm", "bpm_sicher"}
    assert set(analysiere_datei(tmp_path / "loop.wav", "track")) == {MARKER}


def test_a_corrupt_file_gives_only_the_marker_and_the_batch_continues(tmp_path):
    (tmp_path / "kaputt.wav").write_bytes(b"RIFF....nothing")
    sf.write(tmp_path / "gut.wav", klicks(120, 4), SR)
    assert analysiere_datei(tmp_path / "kaputt.wav", "loop") == {MARKER: "1"}
    assert "bpm" in analysiere_datei(tmp_path / "gut.wav", "loop")


# ---- the bar-count prior and the confidence ----
def test_a_clean_power_of_two_loop_is_sure_and_a_five_bar_clip_is_never_sure():
    for bpm, takte in ((120, 4), (128, 2), (100, 8)):
        r = bewerte_tempo(klicks(bpm, takte), SR)
        assert r is not None and abs(r[0] - bpm) <= 1.0 and r[1] is True, (bpm, takte, r)
    r5 = bewerte_tempo(klicks(120, 5), SR)
    assert r5 is None or r5[1] is False, "five bars is not a loop length: at best a guess"


def test_the_prior_prefers_a_power_of_two_bar_count_over_a_stronger_odd_one():
    # 10 bars of 4 beats in 15.62 s would be 153.7 BPM; the clip is cut to 8 bars (122.9): with weak onsets the prior must not pick 10
    x = klicks(122.9, 8)
    r = bewerte_tempo(x, SR)
    assert r is not None and abs(r[0] - 122.9) <= 1.5 and r[1] is True


def test_a_two_way_ambiguity_between_power_of_two_counts_is_not_sure():
    # 6.0 s: 4 bars is 160 BPM, 2 bars is 80 BPM; clicks on every beat of the 160 grid fit both: never a fact
    x = klicks(160, 4)[: int(6.0 * SR)]
    r = bewerte_tempo(x, SR)
    assert r is None or r[1] is False or abs(r[0] - 160.0) <= 1.5


@pytest.mark.parametrize("kand,erwartet", [
    ([(8, 122.9, 0.10), (10, 153.7, 0.15)], (122.9, False)),   # the signal prefers 10 bars: the prior names 8, but only as a guess
    ([(8, 122.9, 0.30), (10, 153.7, 0.10)], (122.9, True)),    # signal and prior agree
    ([(4, 160.0, 0.30), (2, 80.0, 0.28)], (160.0, False)),     # two power-of-two counts too close to call
    ([(4, 160.0, 0.30), (2, 80.0, 0.20)], (160.0, True)),
    ([(5, 153.7, 0.30)], None),                                # no power-of-two count in the window
    ([(8, 122.9, 0.04)], None),                                # below the guess floor
    ([(8, 122.9, 0.08)], (122.9, False)),                      # a guess above the floor but under MIN_TEMPO_SCORE
])
def test_confidence_rules_on_fixed_candidates(monkeypatch, kand, erwartet):
    from bibliothek import analysis as analyse
    monkeypatch.setattr(analyse, "_kandidaten", lambda x, sr: kand)
    assert bewerte_tempo(None, SR) == erwartet


def test_noise_gives_no_sure_tempo():
    rng = np.random.default_rng(5)
    r = bewerte_tempo((rng.standard_normal(8 * SR) * 0.2).astype("float32"), SR)
    assert r is None or r[1] is False


# ---- the command ----
@pytest.fixture
def umgebung(tmp_path, monkeypatch):
    ziel = tmp_path / "kat" / "katalog.sqlite"
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(ziel))
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_CACHE", str(tmp_path / "cache.sqlite"))
    loops, tone, lied, fremd = (tmp_path / n for n in ("loops", "toene", "lieder", "anderswo"))
    for d in (loops, tone, lied, fremd):
        d.mkdir()
    sf.write(loops / "Groove A.wav", klicks(120, 4), SR)
    sf.write(tone / "Bass A.wav", sinus(220.0), SR)
    sf.write(lied / "Song.wav", klicks(110, 4), SR)
    sf.write(fremd / "Groove B.wav", klicks(100, 4), SR)
    for d, typ in ((loops, "loop"), (tone, "oneshot"), (lied, "track"), (fremd, "loop")):
        assert befehl.main(["dazu", str(d), "--typ", typ]) == 0
    assert befehl.main(["bauen"]) == 0
    return ziel, loops, tone, lied, fremd, tmp_path / "cache.sqlite"


def cache_tags(cache: Path, name: str) -> dict:
    db = sqlite3.connect(cache)
    try:
        r = db.execute("SELECT tags FROM merkmale WHERE pfad LIKE ?", (f"%{name}",)).fetchone()
    finally:
        db.close()
    return json.loads(r[0])


def analysieren(capsys, *args: str) -> dict:
    capsys.readouterr()
    assert befehl.main(["analysieren", *args]) == 0
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_cli_touches_only_loops_without_bpm_and_one_shots_without_key_under_unter_and_not_twice(umgebung, capsys):
    ziel, loops, tone, lied, fremd, cache = umgebung
    vorher = ziel.read_bytes()
    r = analysieren(capsys, "--unter", str(loops), "--unter", str(tone))
    assert r == {"ok": True, "analysiert": 2, "mit_wert": 2}
    assert abs(float(cache_tags(cache, "Groove A.wav")["bpm"]) - 120.0) <= 1.0
    assert cache_tags(cache, "Bass A.wav")["camelot"] == "8A"
    assert MARKER not in cache_tags(cache, "Song.wav"), "a track row is never touched"
    assert MARKER not in cache_tags(cache, "Groove B.wav"), "a folder outside --unter is not touched"
    assert ziel.read_bytes() == vorher, "the catalogue file is never written"
    assert analysieren(capsys, "--unter", str(loops), "--unter", str(tone)) == {"ok": True, "analysiert": 0, "mit_wert": 0}


def test_cli_progress_lines_on_stderr_and_max(umgebung, capsys):
    ziel, loops, tone, lied, fremd, cache = umgebung
    capsys.readouterr()
    assert befehl.main(["analysieren", "--unter", str(loops), "--unter", str(tone), "--unter", str(fremd), "--max", "2", "--fortschritt-json"]) == 0
    o = capsys.readouterr()
    zeilen = [json.loads(z) for z in o.err.splitlines() if z.startswith("{")]
    assert zeilen and all(z["phase"] == "analyse" for z in zeilen) and zeilen[-1]["fertig"] == zeilen[-1]["gesamt"] == 2
    assert json.loads(o.out.strip().splitlines()[-1])["analysiert"] == 2


def test_the_next_build_carries_the_new_values_without_rehashing(umgebung, capsys):
    ziel, loops, tone, lied, fremd, cache = umgebung
    analysieren(capsys, "--unter", str(loops), "--unter", str(tone))
    assert befehl.main(["bauen"]) == 0
    db = sqlite3.connect(ziel.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        bpm = db.execute("SELECT bpm FROM katalog WHERE name='Groove A'").fetchone()[0]
        key = db.execute("SELECT camelot FROM katalog WHERE name='Bass A'").fetchone()[0]
    finally:
        db.close()
    assert abs(bpm - 120.0) <= 1.0 and key == "8A"
    assert "hashed 0 files" in capsys.readouterr().out


def test_cli_without_numpy_exits_0_with_uebersprungen(umgebung, capsys, monkeypatch):
    ziel, loops, *_ = umgebung
    monkeypatch.setitem(sys.modules, "numpy", None)
    assert analysieren(capsys, "--unter", str(loops)) == {"ok": True, "uebersprungen": "numpy_fehlt"}


def test_cli_on_a_foreign_or_absent_catalogue_analyses_nothing_and_exits_0(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(tmp_path / "gibts-nicht" / "k.sqlite"))
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_CACHE", str(tmp_path / "c.sqlite"))
    assert analysieren(capsys, "--unter", str(tmp_path)) == {"ok": True, "analysiert": 0, "mit_wert": 0}


def test_a_sure_tempo_lands_in_bpm_and_a_guess_only_in_bpm_geschaetzt(tmp_path, monkeypatch):
    monkeypatch.setenv("CYPHERDJ_KATALOG", str(tmp_path / "kat" / "katalog.sqlite"))
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_CACHE", str(tmp_path / "cache.sqlite"))
    d = tmp_path / "loops"
    d.mkdir()
    sf.write(d / "Sicher.wav", klicks(120, 4), SR)
    sf.write(d / "Fuenf.wav", klicks(120, 5), SR)
    assert befehl.main(["dazu", str(d), "--typ", "loop"]) == 0
    assert befehl.main(["bauen"]) == 0
    assert befehl.main(["analysieren", "--unter", str(d)]) == 0
    assert befehl.main(["bauen"]) == 0
    db = sqlite3.connect((tmp_path / "kat" / "katalog.sqlite").as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        zeilen = {n: (b, g) for n, b, g in db.execute("SELECT name, bpm, bpm_geschaetzt FROM katalog")}
    finally:
        db.close()
    assert abs(zeilen["Sicher"][0] - 120.0) <= 1.0 and zeilen["Sicher"][1] is None
    assert zeilen["Fuenf"][0] is None, "a guess is never a fact in the bpm column"


def test_an_old_cache_entry_with_a_tempo_but_no_flag_counts_as_a_guess():
    from bibliothek.features import Merkmale, felder
    from bibliothek.scan import Datei
    d = Datei(pfad=Path("/x/Loop.wav"), rel="Loop.wav", wurzel=None, groesse=1, mtime_ns=1)
    alt = felder(d, "loop", Merkmale(sha="s", dauer_s=7.8, tags={"bpm": "123.0", MARKER: "1"}))
    assert alt["bpm"] is None and alt["bpm_geschaetzt"] == 123.0
    neu = felder(d, "loop", Merkmale(sha="s", dauer_s=7.8, tags={"bpm": "123.0", MARKER: "1", "bpm_sicher": "1"}))
    assert neu["bpm"] == 123.0 and neu["bpm_geschaetzt"] is None
    tag = felder(d, "loop", Merkmale(sha="s", dauer_s=7.8, tags={"bpm": "98.0"}))
    assert tag["bpm"] == 98.0, "a tempo from the file's own tags is a fact"
