"""Ring-Attrappe gegen den Vertrag §6.2: Kopf, Stille, 60 Hz in band[0], 1 kHz in band[3], Pegel wie baender.json."""
import json
import pathlib
import sys

import numpy as np
import pytest
from scipy import signal
from scipy.io import wavfile

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import attrappe_huellen as ah  # noqa: E402
import huellen_ring as hr  # noqa: E402

SR = 48000


def _wav(tmp_path, name, x):
    p = tmp_path / name
    wavfile.write(p, SR, x.astype(np.float32))
    return str(p)


def _lauf(tmp_path, kanal, x, sekunden=2.0, baender=None):
    ring = tmp_path / "huellen"
    argv = ["--kanal", f"{kanal}={_wav(tmp_path, 'ein.wav', x)}", "--sekunden", str(sekunden), "--pfad", str(ring), "--schnell"]
    if baender:
        argv += ["--baender", baender]
    assert ah.main(argv) == 0
    return hr.HuellenLeser(ring)


def _sinus(f, sekunden=2.0, a=0.5):
    t = np.arange(int(SR * sekunden)) / SR
    return a * np.sin(2 * np.pi * f * t)


def _leistung_db(leser, kanal, von_s=0.2):
    w = leser.w()
    saetze = np.array([leser.lies(r)[kanal]["band"] for r in range(int(von_s * 1000), w)], dtype=np.float64)
    return 10 * np.log10((saetze ** 2).mean(axis=0) + 1e-30)


def test_kopf_und_zaehler(tmp_path):
    leser = _lauf(tmp_path, 0, np.zeros(SR), sekunden=1.0)
    assert leser.w() == 1000
    satz = leser.lies(999)
    assert satz["sample"][0] == 999 * 48 + 47 and satz["beat"][0] == pytest.approx((999 * 48 + 47) / 22500.0)
    assert np.isnan(satz["quell_beat"][14])      # master: kein Deck
    assert leser.lies(1000) is None               # noch nicht geschrieben


def test_stille_alle_baender_null(tmp_path):
    leser = _lauf(tmp_path, 0, np.zeros(2 * SR))
    for r in range(leser.w()):
        s = leser.lies(r)
        assert not s["band"].any() and not s["k_leistung"].any() and not s["spitze"].any()


def _gang_db(f):
    b = json.loads((HIER / "baender.json").read_text(encoding="utf-8"))["baender"]
    return np.array([20 * np.log10(abs(signal.sosfreqz(np.array(x["sos"]), worN=[f], fs=SR)[1][0])) for x in b])


@pytest.mark.parametrize("f,soll", [(60.0, 0), (1000.0, 3)])
def test_sinus_landet_im_richtigen_band(tmp_path, f, soll):
    leser = _lauf(tmp_path, 0, _sinus(f))
    p = _leistung_db(leser, 0)
    assert int(np.argmax(p)) == soll
    zweit = np.sort(p)[-2]
    assert p[soll] - zweit >= 6.0, p
    # Pegel wie der Frequenzgang aus baender.json: Sinus 0,5 hat Leistung 0,125 (−9,03 dB); unter −100 dB
    # liegt die Rechengenauigkeit (float32-Ablage, Einschwingen), dort zählt nur "unter −100 dB"
    soll_db = 10 * np.log10(0.125) + _gang_db(f)
    laut = soll_db > -100.0
    np.testing.assert_allclose(p[laut], soll_db[laut], atol=0.1)
    assert (p[~laut] < -100.0).all(), p
    assert not leser.lies(500)[1]["band"].any()   # andere Kanäle bleiben Null


def test_vertauschte_baender_fallen_auf(tmp_path):
    b = json.loads((HIER / "baender.json").read_text(encoding="utf-8"))
    b["baender"][0]["sos"], b["baender"][3]["sos"] = b["baender"][3]["sos"], b["baender"][0]["sos"]
    falsch = tmp_path / "baender_falsch.json"
    falsch.write_text(json.dumps(b))
    leser = _lauf(tmp_path, 0, _sinus(60.0), baender=str(falsch))
    assert int(np.argmax(_leistung_db(leser, 0))) == 3
