"""folgen_vergleich.py an kleinen Hand-Folgen: grün für die vertragstreue Beobachtung, rot für jede Mutation."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import folgen_vergleich as fv  # noqa: E402

Q = ",hsihds"
ZEILEN = [
    {"t": "sende", "sample": 0, "osc": ["/k/set/neu", ",hsd", 1, "pruefstand", 128.0]},
    {"t": "erwarte", "ab_sample": 1440000, "bis_sample": 1442400, "osc": ["/q", Q, 2, "cypher", 2, 1440000, 64.0, ""],
     "toleranz": 1e-6},
    {"t": "erwarte", "ab_sample": 1620000, "bis_sample": 1622400, "osc": ["/q", Q, 3, "cypher", 7, 1620000, 72.0, "hand"],
     "toleranz": 1e-6},
    {"t": "erwarte_nicht", "ab_sample": 0, "bis_sample": 1619999, "osc": ["/q", Q, None, "cypher", 7, None, None, None]},
    {"t": "erlaube", "ab_sample": 1440000, "bis_sample": 1442400,
     "osc": ["/e/invariante", ",ssihd", "hoerschein", None, None, None, None], "herleitung": "offen"},
    {"t": "wert", "sample": 1800000, "pfad": "deck/2/fader", "wert": -7.5, "toleranz": 0.01},
    {"t": "deck_wert", "sample": 1800000, "deck": 2, "feld": "quell_beat", "wert": 48.0, "toleranz": 0.01},
    {"t": "ws_erwarte", "ab_sample": 0, "bis_sample": 48000, "typ": "willkommen", "daten": {"autonomie": 1}},
]


def _gut():
    beob = [{"sample": 1440010, "osc": ["/q", Q, 2, "cypher", 2, 1440000, 64.0, ""]},
            {"sample": 1620100, "osc": ["/q", Q, 3, "cypher", 7, 1620000, 72.0, "hand"]},
            {"sample": 1440020, "osc": ["/e/invariante", ",ssihd", "hoerschein", "p1", 0, 1440000, 64.0]},
            {"sample": 900, "ws": {"typ": "willkommen", "daten": {"rolle": "mcp", "autonomie": 1, "generation": 0}}}]
    return beob, (lambda p, s: -7.5 + 0.004), (lambda d, f, s: 48.0)


def test_vertragstreue_beobachtung_ist_gruen():
    assert fv.pruefe(ZEILEN, *_gut()) == []


def test_falscher_wert_wird_gemeldet():
    beob, _, deck = _gut()
    befunde = fv.pruefe(ZEILEN, beob, lambda p, s: -7.4, deck)
    assert befunde == [(6, "wert", "deck/2/fader bei 1800000: -7.4 statt -7.5 ±0.01")]


def test_abbruch_einen_zyklus_zu_spaet_wird_gemeldet():
    beob, w, d = _gut()
    beob[1]["osc"][5] = 1620256
    arten = [(n, art) for n, art, _ in fv.pruefe(ZEILEN, beob, w, d)]
    assert arten == [(3, "fehlt"), (0, "unverbraucht")]


def test_abbruch_zu_frueh_trifft_die_negativ_zeile():
    beob, w, d = _gut()
    beob.append({"sample": 1500000, "osc": ["/q", Q, 9, "cypher", 7, 1500000, 66.67, "hand"]})
    arten = [art for _, art, _ in fv.pruefe(ZEILEN, beob, w, d)]
    assert "unerwartet" in arten and "unverbraucht" in arten


def test_fremde_invariante_ist_rot_die_erlaubte_nicht():
    beob, w, d = _gut()
    beob.append({"sample": 1441000, "osc": ["/e/invariante", ",ssihd", "master_leer", "p1", 5, 1441000, 64.04]})
    assert [art for _, art, _ in fv.pruefe(ZEILEN, beob, w, d)] == ["unverbraucht"]


def test_eine_nachricht_erfuellt_hoechstens_einen_schritt():
    zwei = ZEILEN + [dict(ZEILEN[1])]
    beob, w, d = _gut()
    assert [art for _, art, _ in fv.pruefe(zwei, beob, w, d)] == ["fehlt"]
    beob.append(dict(beob[0]))
    assert fv.pruefe(zwei, beob, w, d) == []


def test_toleranz_vorgabe_ist_null():
    z = [{"t": "erwarte", "bis_sample": 10, "osc": ["/e/tempo", ",dddh", 128.0, 0.0, 1.0, 0]}]
    assert fv.pruefe(z, [{"sample": 5, "osc": ["/e/tempo", ",dddh", 128.0000001, 0.0, 1.0, 0]}], None) != []
    assert fv.pruefe(z, [{"sample": 5, "osc": ["/e/tempo", ",dddh", 128.0, 0.0, 1.0, 0]}], None) == []


def test_ideale_beobachtung_erfuellt_die_hand_folge():
    assert fv.pruefe(ZEILEN, *fv.ideale_beobachtung(ZEILEN)) == []


def test_ideale_beobachtung_zeigt_inneren_widerspruch():
    kaputt = ZEILEN + [{"t": "erwarte_nicht", "ab_sample": 1620000, "bis_sample": 1622400,
                        "osc": ["/q", Q, 3, "cypher", 7, None, None, None]}]
    assert [art for _, art, _ in fv.pruefe(kaputt, *fv.ideale_beobachtung(kaputt))] == ["unerwartet"]


def test_rechner_antwort_als_teilmenge():
    z = [{"t": "rechner_antwort", "zeile": {"id": 1, "ergebnis": {"plan": {"teile": [{"nr": 0, "ab_beat": 448.0}]}}}}]
    gut = {"id": 1, "ergebnis": {"plan": {"id": "p1", "teile": [{"nr": 0, "ab_beat": 448.0, "art": "deck"}]},
                                 "vorhersage": {}}}
    assert fv.pruefe(z, [{"rechner": gut}], None) == []
    gut["ergebnis"]["plan"]["teile"][0]["ab_beat"] = 444.0
    assert [art for _, art, _ in fv.pruefe(z, [{"rechner": gut}], None)] == ["fehlt"]
