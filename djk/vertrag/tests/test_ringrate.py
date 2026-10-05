"""Das Raten-Instrument messe_ringrate.auswerten an künstlichen Zählerständen: sieht es 1 000 Hz als gut und eine um
0,2 % falsche Rate als falsch? Keine Echtzeit, keine Attrappe; die echte Messung läuft unter dem Schloss (Task 13)."""
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import messe_ringrate as mr  # noqa: E402


def _zaehler(rate, sekunden=66.0, schritt=10, abfrage=0.05, stau=None):
    """w wie die Attrappe: in Schritten von 10 Datensätzen; abgefragt alle 50 ms; stau = (ab_s, dauer_s) hält w an."""
    t = np.arange(0.0, sekunden, abfrage)
    ideal = np.floor(t * rate / schritt) * schritt
    if stau:
        ab, d = stau
        ideal = np.where((t >= ab) & (t < ab + d), np.floor(ab * rate / schritt) * schritt, ideal)
    return t, ideal


def test_richtige_rate_liegt_in_der_grenze():
    e = mr.auswerten(*_zaehler(1000.0), dauer=60.0)
    assert abs(e["abw"]) <= mr.GRENZE and abs(e["rate"] - 1000.0) < 0.5 and e["fenster_s"] >= 59.5


def test_um_0_2_prozent_zu_schnell_ist_ausserhalb():
    e = mr.auswerten(*_zaehler(1002.0), dauer=60.0)
    assert abs(e["abw"] - 0.002) < 0.0003 and abs(e["abw"]) > mr.GRENZE


def test_stau_von_200_ms_zeigt_sich_im_rueckstand():
    """Abfrage alle 50 ms sieht vom Stau höchstens 150 Datensätze Rückstand (letzte Abfrage im Stau bei 150 ms)."""
    e = mr.auswerten(*_zaehler(1000.0, stau=(30.0, 0.2)), dauer=60.0)
    assert 140.0 <= e["rueckstand"] <= 160.0
    assert mr.auswerten(*_zaehler(1000.0), dauer=60.0)["rueckstand"] <= 20.0   # ohne Stau: nur die 10er-Schritte


def test_zu_kurzer_lauf_gibt_keine_zahl():
    assert mr.auswerten(*_zaehler(1000.0, sekunden=30.0), dauer=60.0) is None
