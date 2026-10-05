"""Die Herleitung trifft die Zahlen, die der Vertrag selbst nennt (§1.2, §1.5, §4.4, §14.1, §17, §19.3)."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import herleitung as h  # noqa: E402
import vertragstext  # noqa: E402


def test_teil_rampe_19_3():
    assert h.rampe_wert("deck/2/fader", -15.0, 0.0, 64.0, 32.0, 80.0) == -7.5


def test_stumm_regel_1_2():
    assert h.rampe_wert("deck/1/fader", 0.0, -200.0, 0.0, 4.0, 2.0) == -30.0      # bis −60 interpoliert
    assert h.rampe_wert("deck/1/fader", 0.0, -200.0, 0.0, 4.0, 4.0) == -200.0     # am Ende stumm
    assert h.rampe_wert("deck/1/send/1", -200.0, -20.0, 0.0, 16.0, 8.0) == -40.0  # ab −60 interpoliert
    assert h.rampe_wert("deck/1/filter", -1.0, 1.0, 0.0, 2.0, 1.0) == 0.0         # kein dB-Regler: linear


def test_hotcue_4_4():
    assert h.hotcue_ziel(37.30, 64.0) == pytest.approx(64.30, abs=1e-9)   # Beispiel aus §4.4
    assert h.hotcue_ziel(71.5, 64.0) == 63.5                             # wrap nach [−0,5; 0,5): 0,5 wird −0,5
    assert h.hotcue_ziel(71.6, 64.0) == pytest.approx(63.6, abs=1e-9)
    assert h.hotcue_ziel(71.45, 64.0) == pytest.approx(64.45, abs=1e-9)


def test_rueckfall_17():
    assert h.rueckfall_q0(96.0, 0.0) == 80.0
    assert h.rueckfall_q0(128.0, 0.0) == 112.0
    assert h.rueckfall_q0(100.0, 2.0) == 82.0     # Takt-Eins bei Quell-Beat 2
    assert h.loop_position(80.0, 16.0, 70.0) == 70.0    # vor dem Loop-Anfang geradeaus
    assert h.loop_position(80.0, 16.0, 102.0) == 86.0   # danach im Kreis


def test_i3_gruende_17():
    hs = dict(kanal="deck/2", inhalt="f0000000000000b2/128000_r1", gueltig_bis_beat=64.0, bpm_messung=128.0,
              quell_von=40.0, quell_bis=60.0)
    i = "f0000000000000b2/128000_r1"
    assert h.hs_grund(hs, "deck/2", i, 64.0, 128.0, 124.0) is None                  # Rand der Gültigkeit und des Abschnitts
    assert h.hs_grund(hs, "deck/2", i, 65.0, 128.0, 50.0) == "hoerschein_abgelaufen"
    assert h.hs_grund(hs, "deck/2", i, 60.0, 128.0, 124.5) == "hoerschein_anderer_abschnitt"
    assert h.hs_grund(dict(hs, bpm_messung=128.64), "deck/2", i, 60.0, 128.0, 50.0) is None
    assert h.hs_grund(dict(hs, bpm_messung=128.65), "deck/2", i, 60.0, 128.0, 50.0) == "hoerschein_anderes_tempo"
    assert h.hs_grund(hs, "deck/3", i, 60.0, 128.0, 50.0) == "hoerschein_anderer_kanal"
    assert h.hs_grund(None, "deck/2", i, 60.0, 128.0) == "kein_hoerschein"


def test_i4_17():
    assert not h.i4_ueberlappt((64.0, 0.0, 0), (64.0, 8.0, 1))   # Setzen vor anschließender Rampe
    assert h.i4_ueberlappt((64.0, 0.0, 2), (64.0, 8.0, 1))       # Setzen nach der Rampe am selben Beat
    assert h.i4_ueberlappt((64.0, 8.0, 1), (70.0, 4.0, 2))
    assert not h.i4_ueberlappt((64.0, 8.0, 1), (72.0, 4.0, 2))   # angrenzend


def test_offen_und_hoerbar_1_6():
    assert h.offen(0.0, -15.0) and not h.offen(0.0, -30.0) and not h.offen(0.0, -26.0)
    assert not h.hoerbar(0.0, -15.0, x_gewicht_db=-200.0)        # Crossfader zu: offen, aber nicht hörbar
    assert not h.hoerbar(0.0, 0.0, deck_laeuft=False)             # angehaltenes Deck ist nie hörbar


def test_trim_1_5():
    assert h.trim_beim_laden(-16.0, -9.4) == pytest.approx(-6.6)
    assert h.trim_beim_laden(-16.0, -45.0) == 24.0


def test_expandiere_gleich_beispiel_14_1():
    plan, wahl = h.plan_und_wahl(vertragstext.lies())
    assert h.expandiere(wahl, 1) == plan["teile"]
    assert len(plan["teile"]) == 14


def test_basstausch_einen_takt_frueher_ist_rot(monkeypatch):
    """Fehlerfall aus Steckbrief 17: Mutation der Regel (Basstausch einen Takt früher) weicht von §14.1 ab."""
    plan, wahl = h.plan_und_wahl(vertragstext.lies())
    monkeypatch.setitem(h.SPIELARTEN, "sicher", dict(h.SPIELARTEN["sicher"], basstausch_takt=8))
    anders = [a for a, b in zip(h.expandiere(wahl, 1), plan["teile"]) if a != b]
    assert [t["nr"] for t in anders] == [4, 5] and anders[0]["ab_beat"] == 472.0
