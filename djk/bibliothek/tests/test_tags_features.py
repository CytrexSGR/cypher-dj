"""Pass B: spectral features, character words, fallback class, cache, caps, order. Signals are synthetic (numpy + soundfile)."""
from __future__ import annotations

import json
import os
import sqlite3

import numpy as np
import pytest
import soundfile as sf

from bibliothek import tags_features as tm
from bibliothek import tags_measure as tags_messen
from bibliothek import tags_store as ts
from test_tags_measure import baue

SR = 44100
RNG = np.random.default_rng(7)


def schreibe(pfad, daten, sr=SR):
    sf.write(str(pfad), np.asarray(daten, dtype="float32"), sr, subtype="PCM_16")
    return pfad


def sinus(f, s=1.0, amp=0.5):
    return amp * np.sin(2 * np.pi * f * np.arange(int(SR * s)) / SR)


def rauschen(s=0.5, amp=0.4):
    return amp * RNG.uniform(-1, 1, int(SR * s))


def bandrauschen(lo, hi, s=1.0):
    n = int(SR * s)
    spek = np.fft.rfft(RNG.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spek[(f < lo) | (f > hi)] = 0
    x = np.fft.irfft(spek, n)
    return 0.5 * x / np.max(np.abs(x))


def klicks(s=1.0):
    x = np.zeros(int(SR * s))
    t = np.arange(int(0.01 * SR))
    for start in range(0, len(x) - len(t), SR // 4):
        x[start:start + len(t)] = np.exp(-t / (0.002 * SR))
    return 0.9 * x


def merk(tmp_path, daten, name="x.wav"):
    m = tm.merkmale_von(schreibe(tmp_path / name, daten))
    assert m is not None
    return m


# ---------------------------------------------------------------- features and words

def test_sine_60_is_deep_and_dark_not_bright(tmp_path):
    m = merk(tmp_path, sinus(60))
    assert m["anteil_sub"] > 0.9
    w = tm.charakter_aus(m)
    assert "deep" in w and "dark" in w and "bright" not in w


def test_noise_burst_is_airy_and_bright_not_dark(tmp_path):
    w = tm.charakter_aus(merk(tmp_path, rauschen()))
    assert "airy" in w and "bright" in w and "dark" not in w


def test_dual_mono_is_mono_and_independent_noise_is_wide(tmp_path):
    s = sinus(60)
    m = merk(tmp_path, np.stack([s, s], axis=1))
    assert m["korrelation"] > 0.99 and "mono" in tm.charakter_aus(m)
    n = np.stack([rauschen(), rauschen()], axis=1)
    w = tm.charakter_aus(merk(tmp_path, n, "n.wav"))
    assert "wide" in w and "mono" not in w


def test_punchy_and_tight_are_not_measured(tmp_path):
    for d in (klicks(), sinus(60), rauschen()):
        w = tm.charakter_aus(merk(tmp_path, d))
        assert "punchy" not in w and "tight" not in w


def test_band_limited_low_mids_is_warm(tmp_path):
    assert "warm" in tm.charakter_aus(merk(tmp_path, bandrauschen(120, 180)))


def test_only_vocabulary_words(tmp_path):
    erlaubt = {"bright", "dark", "warm", "deep", "airy", "wide", "mono"}
    for d in (sinus(60), rauschen(), klicks(), bandrauschen(120, 180)):
        assert set(tm.charakter_aus(merk(tmp_path, d))) <= erlaubt


def test_silence_has_no_words_and_no_class(tmp_path):
    m = merk(tmp_path, np.zeros(SR))
    assert tm.charakter_aus(m) == [] and tm.klasse_aus(m, "loop") is None


def test_klasse_aus(tmp_path):
    assert tm.klasse_aus(merk(tmp_path, sinus(60)), "oneshot") == "kick"
    assert tm.klasse_aus(merk(tmp_path, rauschen(0.1), "h.wav"), "oneshot") == "hihat"
    assert tm.klasse_aus(merk(tmp_path, sinus(150), "b.wav"), "oneshot") is None   # bass, snare, clap, tom, perc and synth are not given (measured: mostly wrong)
    assert tm.klasse_aus(merk(tmp_path, sinus(60), "t.wav"), "track") is None


def test_short_and_empty_files_give_none(tmp_path):
    assert tm.merkmale_von(schreibe(tmp_path / "k.wav", np.zeros(50) + 0.1)) is None
    assert tm.merkmale_von(schreibe(tmp_path / "z.wav", np.zeros(0))) is None
    assert tm.merkmale_von(tmp_path / "gibtsnicht.wav") is None


def test_long_file_reads_only_a_window(tmp_path, monkeypatch):
    p = schreibe(tmp_path / "lang.wav", sinus(200, 30.0))
    gelesen = []
    echt = sf.read

    def zaehle(*a, **k):
        r = echt(*a, **k)
        gelesen.append(len(r[0]))
        return r

    monkeypatch.setattr(sf, "read", zaehle)
    assert tm.merkmale_von(p) is not None
    assert gelesen and max(gelesen) <= int(10.0 * SR) + 1


# ---------------------------------------------------------------- through the hook

@pytest.fixture
def pf(tmp_path):
    return tmp_path / "katalog.sqlite", tmp_path / "tags.sqlite"


def lauf(pf, *extra):
    return tags_messen.haupt(["--katalog", str(pf[0]), "--tags", str(pf[1]), *extra])


def sha(n):
    return f"{n:02d}" * 32


def sechs(tmp_path, pf, typen=("loop",) * 6):
    zeilen = []
    for i, typ in enumerate(typen):
        p = schreibe(tmp_path / f"f{i}.wav", sinus(100 + 40 * i, 0.3))
        zeilen.append(dict(sha=sha(i), typ=typ, pfad=str(p), name=f"f{i}"))
    baue(pf[0], zeilen)


def merkmal_shas(pfad):
    c = ts.oeffne(pfad)
    try:
        return {r[0] for r in c.execute("SELECT sha FROM merkmal")}
    finally:
        c.close()


def stand(pfad):
    c = ts.oeffne(pfad)
    try:
        return dict(c.execute("SELECT schluessel, wert FROM stand").fetchall())
    finally:
        c.close()


def test_order_loops_and_oneshots_before_tracks(tmp_path, pf):
    sechs(tmp_path, pf, ("track", "track", "loop", "loop", "oneshot", "oneshot"))
    assert lauf(pf, "--max-dateien", "4") == 0
    assert merkmal_shas(pf[1]) == {sha(2), sha(3), sha(4), sha(5)}


def test_cap_leaves_the_rest_for_the_next_run_and_reads_nothing_twice(tmp_path, pf, monkeypatch):
    sechs(tmp_path, pf)
    gelesen = []
    echt = sf.read

    def zaehle(*a, **k):
        gelesen.append(str(a[0]))
        return echt(*a, **k)

    monkeypatch.setattr(sf, "read", zaehle)
    assert lauf(pf, "--max-dateien", "3") == 0
    assert len(merkmal_shas(pf[1])) == 3 and stand(pf[1])["messen_offen"] == "3"
    assert lauf(pf, "--max-dateien", "3") == 0
    assert len(merkmal_shas(pf[1])) == 6 and stand(pf[1])["messen_offen"] == "0"
    assert len(gelesen) == 6 and len(set(gelesen)) == 6
    assert lauf(pf) == 0 and len(gelesen) == 6
    monkeypatch.setattr(tm, "MERKMAL_VERSION", tm.MERKMAL_VERSION + 1)
    assert lauf(pf) == 0
    assert len(gelesen) == 12


def test_unreadable_and_vanished_files_are_skipped_once(tmp_path, pf, monkeypatch):
    gut = schreibe(tmp_path / "gut.wav", sinus(100, 0.3))
    kaputt = tmp_path / "kaputt.wav"
    kaputt.write_bytes(os.urandom(300))
    baue(pf[0], [dict(sha=sha(1), typ="loop", pfad=str(gut), name="gut"),
                 dict(sha=sha(2), typ="loop", pfad=str(kaputt), name="kaputt"),
                 dict(sha=sha(3), typ="loop", pfad=str(tmp_path / "weg.wav"), name="weg")])
    aufrufe = []
    echt = tm.merkmale_von
    monkeypatch.setattr(tm, "merkmale_von", lambda p, *a, **k: aufrufe.append(os.fspath(p)) or echt(p, *a, **k))
    assert lauf(pf) == 0
    assert merkmal_shas(pf[1]) == {sha(1)}
    c = ts.oeffne(pf[1])
    assert c.execute("SELECT count(*) FROM merkmal_fehl").fetchone()[0] == 1
    c.close()
    assert stand(pf[1])["messen_offen"] == "0"
    n1 = [a for a in aufrufe if a.endswith("kaputt.wav")]
    assert len(n1) == 1
    assert lauf(pf) == 0
    assert len([a for a in aufrufe if a.endswith("kaputt.wav")]) == 1
    st = kaputt.stat()
    os.utime(kaputt, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert lauf(pf) == 0
    assert len([a for a in aufrufe if a.endswith("kaputt.wav")]) == 2


def test_no_placeholder_word_is_ever_written(tmp_path, pf):
    # a mid-frequency decaying burst that no class rule fires on
    p = schreibe(tmp_path / "m.wav", sinus(1500, 3.0) * np.exp(-np.arange(3 * SR) / SR))
    baue(pf[0], [dict(sha=sha(1), typ="oneshot", pfad=str(p), name="m")])
    assert lauf(pf) == 0
    c = ts.oeffne(pf[1])
    tags = [r[0] for r in c.execute("SELECT tag FROM item_tag")]
    c.close()
    assert not any("unklar" in t or "unknown" in t for t in tags)


def test_class_only_without_catalogue_instrument(tmp_path, pf):
    a = schreibe(tmp_path / "a.wav", sinus(60, 0.5))
    b = schreibe(tmp_path / "b.wav", sinus(60, 0.5) * 0.9)
    baue(pf[0], [dict(sha=sha(1), typ="oneshot", pfad=str(a), name="a"),
                 dict(sha=sha(2), typ="oneshot", pfad=str(b), name="b", instrument="snare")])
    assert lauf(pf) == 0
    c = ts.oeffne(pf[1])
    eff = {(r["item"], r["tag"]) for r in c.execute("SELECT item, tag FROM wirksam")}
    c.close()
    assert (f"datei:{sha(1)}", "typ:kick") in eff
    assert (f"datei:{sha(2)}", "typ:snare") in eff and (f"datei:{sha(2)}", "typ:kick") not in eff


def test_second_run_writes_nothing(tmp_path, pf):
    sechs(tmp_path, pf)
    assert lauf(pf) == 0
    c = ts.oeffne(pf[1])
    vorher = [tuple(r) for r in c.execute("SELECT * FROM item_tag ORDER BY item, tag, herkunft, quelle")]
    c.close()
    assert lauf(pf) == 0
    c = ts.oeffne(pf[1])
    nachher = [tuple(r) for r in c.execute("SELECT * FROM item_tag ORDER BY item, tag, herkunft, quelle")]
    c.close()
    assert vorher == nachher and any(t[1].startswith("charakter:") for t in vorher)


def test_nice_value_during_pass_b_is_19(tmp_path, pf, monkeypatch):
    sechs(tmp_path, pf)
    werte = []
    echt = tm.merkmale_von
    monkeypatch.setattr(tm, "merkmale_von", lambda p, *a, **k: werte.append(os.nice(0)) or echt(p, *a, **k))
    assert lauf(pf, "--max-dateien", "1") == 0
    assert werte == [19]


def test_manual_removal_of_a_measured_word_survives(tmp_path, pf, monkeypatch):
    p = schreibe(tmp_path / "n.wav", rauschen())
    baue(pf[0], [dict(sha=sha(1), typ="oneshot", pfad=str(p), name="n")])
    monkeypatch.setattr(os, "nice", lambda n: 0)
    assert lauf(pf) == 0
    item = f"datei:{sha(1)}"
    c = ts.oeffne(pf[1])
    assert c.execute("SELECT 1 FROM wirksam WHERE item=? AND tag='charakter:bright'", (item,)).fetchone()
    c.execute("INSERT INTO item_tag(item, tag, herkunft, quelle, an, zeit) VALUES (?, 'charakter:bright', 'nutzer', '', 0, 5e9)", (item,))
    c.close()
    monkeypatch.setattr(tm, "MERKMAL_VERSION", tm.MERKMAL_VERSION + 1)
    assert lauf(pf) == 0
    c = ts.oeffne(pf[1])
    assert not c.execute("SELECT 1 FROM wirksam WHERE item=? AND tag='charakter:bright'", (item,)).fetchone()
    c.close()


def test_without_spectrum_flag_skips_pass_b(tmp_path, pf):
    sechs(tmp_path, pf)
    assert lauf(pf, "--ohne-spektrum") == 0
    assert merkmal_shas(pf[1]) == set()
