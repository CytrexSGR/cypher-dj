import pytest
import numpy as np
from werkstatt.karte import karte_aus_schlaegen
from werkstatt.eins import eins_beat_this, eins_tiefband

SR = 22050


def kicks(betont, gleich=False, bpm=120.0, n=64, t0=0.5):
    per = 60.0 / bpm
    x = np.zeros(int((t0 + (n + 1) * per) * SR))
    tk = np.arange(int(0.2 * SR)) / SR
    kick = np.sin(2 * np.pi * 60 * tk) * np.exp(-tk / 0.05)
    for i in range(n):
        a = int((t0 + i * per) * SR)
        x[a:a + len(kick)] += (2.0 if (i % 4 == betont and not gleich) else 1.0) * kick
    return x, t0 + np.arange(n) * per


def test_downbeats_auf_lage_1():
    t = 0.5 + np.arange(64) * 0.5
    eins, zaehl = eins_beat_this(t[1::4], karte_aus_schlaegen(t))
    assert eins == 1 and zaehl == [0, 16, 0, 0]


def test_downbeats_ausserhalb_der_karte_zaehlen_nicht():
    t = 0.5 + np.arange(64) * 0.5
    eins, zaehl = eins_beat_this(np.array([0.1, 100.0]), karte_aus_schlaegen(t))
    assert eins is None and zaehl == [0, 0, 0, 0]


def test_tiefband_findet_betonte_lage():
    x, t = kicks(2)
    eins, vorsprung, energie = eins_tiefband(x, SR, karte_aus_schlaegen(t))
    assert eins == 2 and vorsprung > 0.5


def test_tiefband_ohne_betonung_ohne_vorsprung():
    x, t = kicks(2, gleich=True)
    eins, vorsprung, energie = eins_tiefband(x, SR, karte_aus_schlaegen(t))
    assert vorsprung < 0.05


def test_tiefband_ueberhoert_den_clap():
    """Clap (Rauschen, doppelt so laut wie der Kick) auf 2 und 4: die Eins bleibt beim betonten Kick."""
    x, t = kicks(0)
    rng = np.random.default_rng(3)
    clap = rng.standard_normal(int(0.08 * SR)) * np.exp(-np.arange(int(0.08 * SR)) / SR / 0.02)
    for i in range(1, 64, 2):
        a = int(t[i] * SR)
        x[a:a + len(clap)] += 2.0 * clap
    eins, vorsprung, energie = eins_tiefband(x, SR, karte_aus_schlaegen(t))
    assert eins == 0


# --- Eins-Entscheidung aus Mehrheit, Anteil und erstem Kick (2026-10-11, Bericht grid-phase) -----------------------
import json
from pathlib import Path
from werkstatt.eins import MEHRHEIT_SCHWELLE, eins_anteil, entscheide_eins, erster_kick

BEKANNTE = json.loads((Path(__file__).parent / "daten" / "eins_bekannte.json").read_text())["faelle"]
FALL = {f["mid"][:4]: f for f in BEKANNTE}


def _entscheide(f, kick_gueltig=True):
    z = f["zaehlung"]
    mehrheit = int(np.argmax(z))
    kick = {"anwendbar": bool(kick_gueltig), "beat": f["kick_beat"], "lage": f["kick_lage"]} if kick_gueltig else \
           {"anwendbar": False, "beat": None, "lage": None}
    return entscheide_eins(mehrheit, z, kick)


def test_anteil():
    assert eins_anteil([0, 109, 0, 156]) == pytest.approx(156 / 265)
    assert eins_anteil([0, 0, 0, 0]) == 0.0
    assert MEHRHEIT_SCHWELLE == 0.85


@pytest.mark.parametrize("mid,wahr", [("580d", 1), ("929d", 0), ("bfdd", 0), ("1fc7", 0)])
def test_bekannte_halbtakt_fehler_werden_auf_die_kick_lage_gezogen(mid, wahr):
    """FEHLERFALL: alter Weg (argmax der Stimmen) liegt bei allen vier um 2 daneben; die Wahrheit ist die Minderheit."""
    f = FALL[mid]
    assert int(np.argmax(f["zaehlung"])) != wahr                      # alt: falsch
    e = _entscheide(f)
    assert e["eins"] == wahr and e["quelle"] == "kick" and e["unsicher"] is False and e["anteil"] < 0.85


@pytest.mark.parametrize("mid", ["6b09", "9b44"])
def test_negativkontrolle_klare_mehrheit_bleibt(mid):
    """NEGATIV-KONTROLLE: 6b09 (0,97) und 9b44 (0,91) hatten schon die richtige Eins; Anteil >= 0,85, Kick einig."""
    f = FALL[mid]
    e = _entscheide(f)
    assert e["eins"] == f["wahrheit"] and e["quelle"] == "mehrheit" and e["unsicher"] is False


def test_treffer_an_den_sechs_bekannten():
    bekannt = [f for f in BEKANNTE if f["wahrheit"] is not None]
    assert len(bekannt) == 6
    assert sum(_entscheide(f)["eins"] == f["wahrheit"] for f in bekannt) == 6
    assert sum(int(np.argmax(f["zaehlung"])) == f["wahrheit"] for f in bekannt) == 2     # alt: 2 von 6


def test_gegenbeispiel_d976_kick_gate_schliesst_aus_eins_bleibt():
    """d976 Perc - Antifunk: Karte ab 4,54 s, Kick ab Beat 4 = Lage 0, beat_this 0,978 auf Lage 1. Das Tor der Kick-Regel
    (Karte <= 1 s) laesst die Regel gar nicht erst zu: Eins bleibt 1, nicht unsicher."""
    f = FALL["d976"]
    e = _entscheide(f, kick_gueltig=False)
    assert e["eins"] == 1 and e["quelle"] == "mehrheit" and e["unsicher"] is False and e["anteil"] > 0.97


def test_gegenbeispiel_d976_auch_mit_offenem_tor_dreht_die_regel_nicht():
    """Haette das Tor d976 durchgelassen: Kick 1 Beat daneben (Lage 0 gegen 1) -> Eins bleibt 1, nur unsicher."""
    f = FALL["d976"]
    e = _entscheide(f, kick_gueltig=True)
    assert e["eins"] == 1 and e["quelle"] == "mehrheit" and e["unsicher"] is True


def test_kick_einen_beat_daneben_laesst_eins_und_markiert_unsicher():
    e = entscheide_eins(2, [10, 5, 40, 5], {"anwendbar": True, "beat": 1, "lage": 1})
    assert e["eins"] == 2 and e["unsicher"] is True and e["quelle"] == "mehrheit"


def test_klare_mehrheit_gegen_kick_um_zwei_bleibt_aber_unsicher():
    """Anteil >= 0,85: Regel 1 greift nicht; widerspricht der Kick trotzdem um 2, ist das Ergebnis unsicher."""
    e = entscheide_eins(2, [2, 0, 98, 0], {"anwendbar": True, "beat": 0, "lage": 0})
    assert e["eins"] == 2 and e["unsicher"] is True


def test_schwache_mehrheit_ohne_kick_ist_unsicher_aber_unveraendert():
    e = entscheide_eins(2, [20, 10, 40, 10], {"anwendbar": False, "beat": None, "lage": None})
    assert e["eins"] == 2 and e["unsicher"] is True and e["quelle"] == "mehrheit"


def test_schwache_mehrheit_vom_kick_bestaetigt_ist_nicht_unsicher():
    e = entscheide_eins(2, [20, 10, 40, 10], {"anwendbar": True, "beat": 2, "lage": 2})
    assert e["eins"] == 2 and e["unsicher"] is False


def test_ohne_downbeats_kein_tiefband_rueckgriff():
    """Der Tief-Band-Rueckgriff ist weg: ohne Stimmen und ohne Kick gilt 0, unsicher; mit Kick dessen Lage, unsicher."""
    e = entscheide_eins(None, [0, 0, 0, 0], {"anwendbar": False, "beat": None, "lage": None})
    assert e["eins"] == 0 and e["unsicher"] is True and e["quelle"] == "keine"
    e = entscheide_eins(None, [0, 0, 0, 0], {"anwendbar": True, "beat": 3, "lage": 3})
    assert e["eins"] == 3 and e["unsicher"] is True and e["quelle"] == "kick"


# --- erster Kick: Detektor an synthetischem Signal ------------------------------------------------------------------

def _loop(erster_kick_beat, bpm=120.0, n=64, t0=0.5, clap=True):
    """Kicks ab Beat `erster_kick_beat`, Clap auf jedem zweiten Beat ab Beat 1 (Halbtakt-symmetrisch)."""
    per = 60.0 / bpm
    x = np.zeros(int((t0 + (n + 1) * per) * SR))
    tk = np.arange(int(0.2 * SR)) / SR
    kick = np.sin(2 * np.pi * 60 * tk) * np.exp(-tk / 0.05)
    rng = np.random.default_rng(1)
    cl = rng.standard_normal(int(0.08 * SR)) * np.exp(-np.arange(int(0.08 * SR)) / SR / 0.02)
    for i in range(erster_kick_beat, n):
        a = int((t0 + i * per) * SR)
        x[a:a + len(kick)] += kick
    if clap:
        for i in range(1, n, 2):
            a = int((t0 + i * per) * SR)
            x[a:a + len(cl)] += 2.0 * cl
    return x, t0 + np.arange(n) * per


@pytest.mark.parametrize("beat", [0, 1, 2, 3, 6])
def test_erster_kick_wird_gefunden(beat):
    x, t = _loop(beat)
    k = erster_kick(x, SR, karte_aus_schlaegen(t))
    assert k["anwendbar"] is True and k["beat"] == beat and k["lage"] == beat % 4


def test_kick_karte_beginnt_spaet_nicht_anwendbar():
    """Karte erst bei 4,5 s (Intro): das Tor der Regel (<= 1 s) schliesst."""
    x, t = _loop(0, t0=4.5)
    k = erster_kick(x, SR, karte_aus_schlaegen(t))
    assert k["anwendbar"] is False and k["lage"] is None and "Karte" in k["grund"]


def test_kick_erst_nach_beat_16_nicht_anwendbar():
    x, t = _loop(20)
    k = erster_kick(x, SR, karte_aus_schlaegen(t))
    assert k["anwendbar"] is False and "16" in k["grund"]


def test_nur_clap_ohne_kick_nicht_anwendbar():
    x, t = _loop(1000)
    k = erster_kick(x, SR, karte_aus_schlaegen(t))
    assert k["anwendbar"] is False


def test_kick_bestaetigt_bei_zu_schwacher_mehrheit_ist_unsicher():
    """Review B5: 8ee4 [140,122,136,90] (Anteil 0,29) und Kick einig ist nahe Zufall, kein zweiter Zeuge."""
    e = entscheide_eins(0, [140, 122, 136, 90], {"anwendbar": True, "beat": 0, "lage": 0})
    assert e["eins"] == 0 and e["unsicher"] is True and e["anteil"] < 0.5
    # NEGATIV: Anteil 0,57 (a1d7) mit Kick-Bestaetigung bleibt sicher
    assert entscheide_eins(3, [55, 49, 16, 160], {"anwendbar": True, "beat": 3, "lage": 3})["unsicher"] is False
