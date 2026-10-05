"""Schritt 2a: tonart(pfad) an synthetischen Dreiklängen (nur Rechnung, kein Ton) und die Regel-Bausteine."""
import wave

import numpy as np
import pytest

from tonart_energie import tonart as t
from tonart_energie.camelot import aus_camelot, zu_camelot
from tonart_energie.vergleich_tonart import als_moll, intervall

es = pytest.importorskip("essentia.standard")
SR = t.SR


def _dreiklang(midis, dauer=12.0):
    zeit = np.arange(int(SR * dauer)) / SR
    x = np.zeros_like(zeit)
    for midi in midis:
        f0 = 440 * 2 ** ((midi - 69) / 12)
        for h in range(1, 5):
            x += 0.2 / h * np.sin(2 * np.pi * f0 * h * zeit)
    return (x / 4).astype(np.float32)


C_DUR = [48, 60, 64, 67]      # C2 im Bass, C4 E4 G4
A_MOLL = [45, 57, 60, 64]     # A1 im Bass, A3 C4 E4


def test_camelot_anker():
    assert zu_camelot(0, False) == "8B" and aus_camelot("8B") == (0, False)   # C-Dur
    assert zu_camelot(9, True) == "8A" and aus_camelot("8A") == (9, True)     # A-Moll


def test_c_dur_dreiklang_wird_8B():
    r = t.tonart_signal(_dreiklang(C_DUR))
    assert r["camelot"] == "8B"
    assert 0.0 <= r["konfidenz"] <= 1.0


def test_a_moll_dreiklang_wird_8A():
    assert t.tonart_signal(_dreiklang(A_MOLL))["camelot"] == "8A"


def test_ohne_dur_weg_wird_c_dur_zu_c_moll():
    # Gegenprobe zur Dur-Ausnahme: abgeschaltet fällt C-Dur auf die gleichnamige Molltonart (5A)
    assert t.tonart_signal(_dreiklang(C_DUR), dur_schwelle=None)["camelot"] == "5A"


def test_edmm_kann_kein_dur():
    # Warum das roh beste Profil (edmm) nicht gewählt ist: es nennt reines C-Dur C-Moll
    key, scale, _ = es.KeyExtractor(profileType="edmm", sampleRate=SR)(_dreiklang(C_DUR))
    assert (key, scale) == ("C", "minor")


def test_tonart_pfad_ueber_datei(tmp_path):
    x = _dreiklang(A_MOLL, dauer=8.0)
    p = tmp_path / "a_moll.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    r = t.tonart(p)
    assert r["camelot"] == "8A" and set(r) >= {"camelot", "konfidenz"}


def test_entscheide_regel():
    g = (0, False)
    voll = {"edma": g, "edmm": (0, True), "bgate": g, "braw": g, "kf": g}
    assert t.entscheide(voll, 0.95) == (0, False, 4)   # n_einig zählt Grundton, edmm C-Moll zählt mit
    assert t.entscheide(voll, 0.80)[1] is True                      # zu unsicher -> Moll
    assert t.entscheide(voll | {"kf": (0, True)}, 0.95)[1] is True  # eine Stimme uneinig -> Moll
    assert t.entscheide(voll | {"kf": None}, 0.95)[1] is True       # libKeyFinder fehlt -> Moll


def test_hilfen():
    assert als_moll("8B") == "5A" and als_moll("8A") == "8A"
    assert intervall("9A", "8A") == "-5 HT, gleiches Geschlecht"   # E zu A: Quinte, gefaltet auf -5..+6
    assert intervall("8B", "8A") == "+3 HT, Dur statt Moll"


def test_entscheide_modus_offen_ohne_kf_und_schwelle():
    # Schritt 3: im Modus offen reicht Einigkeit von edma, bgate, braw; libKeyFinder und Stärke zählen nicht
    g = (0, False)
    st = {"edma": g, "edmm": (0, True), "bgate": g, "braw": g, "kf": (9, True)}
    assert t.entscheide(st, 0.5, None, t.DUR_STIMMEN_OFFEN, dur_weg=True)[1] is False    # Dur
    assert t.entscheide(st, 0.5)[1] is True                                               # bestand: Moll
    assert t.entscheide(st | {"braw": (0, True)}, 0.99, None, t.DUR_STIMMEN_OFFEN, dur_weg=True)[1] is True
    assert t.entscheide(st | {"edma": (0, True)}, 0.99, None, t.DUR_STIMMEN_OFFEN, dur_weg=True)[1] is True


def test_modi_am_dreiklang():
    x = _dreiklang(C_DUR)
    assert t.tonart_signal(x, modus="offen")["camelot"] == "8B"
    assert t.tonart_signal(x, modus="moll")["camelot"] == "5A"
    assert t.tonart_signal(_dreiklang(A_MOLL), modus="offen")["camelot"] == "8A"
    with pytest.raises(ValueError):
        t.tonart_signal(x, modus="quatsch")
