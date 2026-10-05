"""Die Invarianten-Folgen tragen die Zahlen, die aus §1.6 und §17 folgen; Mutationen fallen auf."""
import json
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import folgen_vergleich as fv  # noqa: E402
import pruefe_golden as pg  # noqa: E402
import schema_lader as sl  # noqa: E402
import vertragstext  # noqa: E402


def _zeilen(name):
    return [json.loads(z) for z in (HIER / "folgen" / f"{name}.jsonl").read_text(encoding="utf-8").splitlines()]


def _erwartet(name, adresse):
    return [z["osc"] for z in _zeilen(name) if z["t"] == "erwarte" and z["osc"][0] == adresse]


def test_i1_bricht_bei_minus_12_db_ab():
    q7 = [o for o in _erwartet("sub_doppelt", "/q") if o[4] == 7 and o[7] == "invariante_sub_doppelt"]
    assert len(q7) == 1
    fenster = next(z for z in _zeilen("sub_doppelt") if z["t"] == "erwarte" and z["osc"] == q7[0])
    assert fenster["ab_sample"] <= 2124000 <= fenster["bis_sample"]          # Beat 94,4 = 92 + 4·18/30
    assert ["/e/invariante", ",ssihd", "sub_doppelt", "p1", 4, None, None] in _erwartet("sub_doppelt", "/e/invariante")
    assert _erwartet("sub_doppelt_kontrolle", "/e/invariante") == []


def test_i2_haelt_a_bei_minus_26_db():
    f = next(z for z in _zeilen("master_leer") if z["t"] == "erwarte" and z["osc"][0] == "/e/invariante")
    assert f["osc"][2:5] == ["master_leer", "p1", 5] and f["ab_sample"] <= 2034000 <= f["bis_sample"]   # Beat 90,4
    w = next(z for z in _zeilen("master_leer") if z["t"] == "wert" and z["pfad"] == "deck/1/fader")
    assert -26.0 <= w["wert"] - w["toleranz"] and w["wert"] + w["toleranz"] <= -25.97


def test_rueckfall_loop_aus_dem_vertragstext():
    q0, ende = pg.anker(vertragstext.lies())["rueckfall"]
    assert ["/e/rueckfall", ",iidddh", 1, 1, q0, ende - q0, None, None] in _erwartet("rueckfall", "/e/rueckfall")
    assert ["/e/rueckfall", ",iidddh", 1, 1, 112.0, 16.0, None, None] in _erwartet("b_verriegelt_a_laeuft_aus",
                                                                                  "/e/rueckfall")


def test_wartender_plan_stopp_bleibt_angenommen():
    nicht = [z for z in _zeilen("b_verriegelt_a_laeuft_aus") if z["t"] == "erwarte_nicht" and z["osc"][4] == 2]
    assert len(nicht) == 1 and nicht[0]["ab_sample"] == 2250000


def test_hand_an_a_faellt_die_ganze_gruppe_a_raus():
    zeilen = _zeilen("hand_stoppt_a_raus")
    hand = [z for z in zeilen if z["t"] == "hand"]
    assert hand[-1] == {"t": "hand", "sample": 2610000, "pfad": "deck/1/fader", "midi_roh": 1.0 - 4 / 128, "bereich": "regler",
                        "herleitung": hand[-1]["herleitung"]}
    assert len([o for o in _erwartet("hand_stoppt_a_raus", "/q") if o[4] == 7 and o[5] == 2610000]) == 8


def test_jeder_i3_grund_hat_seine_folge():
    for grund in ("kein_hoerschein", "hoerschein_anderer_kanal", "hoerschein_anderer_inhalt", "hoerschein_anderes_tempo",
                  "hoerschein_abgelaufen", "hoerschein_anderer_abschnitt", "ziel_ungehoert"):
        assert any(o[4] == 6 and o[7] == grund for o in _erwartet(f"i3_{grund}", "/q")), grund


def test_buendel_mit_falschen_typen_ist_rot():
    zeilen = _zeilen("muster_ungehoert")
    b = next(z for z in zeilen if z["t"] == "buendel")
    b["nachrichten"][1][1] = ",iiiidd"
    fehler = pg.pruefe_folge("muster_ungehoert.jsonl", zeilen, zeilen, sl.registry(), sl.validator("folge.schema.json"))
    assert any("/erz/ev hat laut osc.json ,iiiiddf, die Folge sagt ,iiiidd" in f for f in fehler)


def test_unerwarteter_rueckfall_in_der_kontrolle_ist_rot():
    zeilen = _zeilen("rueckfall_kontrolle")
    beob, w, d, m = fv.ideale_beobachtung(zeilen)
    beob = beob + [{"sample": 1000000, "osc": ["/e/rueckfall", ",iidddh", 1, 1, 80.0, 16.0, 0.0, 1000000]}]
    assert [art for _, art, _ in fv.pruefe(zeilen, beob, w, d, m)] == ["unerwartet"]
