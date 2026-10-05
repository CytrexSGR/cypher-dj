"""Golden-Folgen für Neustart (Scheibe 18), Leitstand (21) und Prüfstand (16, 18)."""
from folgen_11 import teil_rampe
from folgen_bau import LADEN_FRIST, Folge, a_hoerbar, osc


def autonomie_1_eq():
    f = Folge("autonomie_1_eq", "autonomie_1_eq", ["21", "13"],
              "Leitstand gegen Attrappe: Stufe 1, EQ-Teil an hörbarem Deck → vorgeschlagen, kein /k/teil an den Kern")
    a_hoerbar(f)
    f.ws_sende(f.S(12), "hallo", {"rolle": "mcp", "name": "golden-autonomie", "protokoll": 1},
               "§9.2 Anmeldung als mcp")
    f.ws_erwarte(f.S(12), f.S(12) + LADEN_FRIST, "willkommen", {"rolle": "mcp", "autonomie": 1},
                 "§2.1 autonomie_start = 1")
    f.ws_sende(f.S(40), "rpc", {"id": 1, "methode": "plan_einreichen", "parameter": {
        "grund": "Höhen von A zurück", "teile": [{"regler": "deck/1/eq/hoch", "art": "setze", "ab_takt": 17, "nach": -6.0}]}},
        "§10 plan_einreichen, Takt 17 = Beat 64")
    f.ws_erwarte(f.S(40), f.S(40) + LADEN_FRIST, "rpc_antwort", {"id": 1, "ergebnis": {"status": "vorgeschlagen"}},
                 "§10 Stufe 1: jede Einreichung wird Vorschlag")
    f.erwarte_nicht(f.S(40), f.S(80), osc("/q", None, "cypher", None, None, None, None), "leitstand",
                    herleitung="kein /k/teil mit Quelle cypher am Kern, also keine Quittung dafür")
    f.wert(f.S(68), "deck/1/eq/hoch", 0.0, 0.0, "regler", "unverändert")
    return f


def notbahn(rampe=False):
    name = "notbahn_rampe" if rampe else "notbahn_124"
    bpm = 128.0 if rampe else 124.0
    f = Folge(name, name, ["16", "18"], "Kern-Absturz bei fester Basis 124" if not rampe
              else "Kern-Absturz in einer Rampe 128 → 132", bpm=bpm)
    i = f.nid()
    f.sende(f.S(1), osc("/test/klick", i, "pruefstand", "master", 1), "pruefstand", "ROADMAP Z1: Klick je Schlag auf master")
    kill_beat = 74.0 if rampe else 66.0
    if rampe:
        j = f.nid()
        f.sende(f.S(48), osc("/k/tempo/rampe", j, "pruefstand", 64.0, 132.0, 32.0), "zeitachse",
                "§4.2: ohne laufendes Deck angenommen (kein_stretcher gilt nur bei laufendem Deck)")
        f.angenommen(j, "pruefstand", f.S(48), "zeitachse")
        f.karte.rampe(64.0, 132.0, 32.0)
    takt_ende = (kill_beat // 4) * 4
    tf = f.S(takt_ende) - f.S(takt_ende - 4)
    ks = f.S(kill_beat)
    f.aktion(ks, "kern_kill9", f"Absturz bei Beat {kill_beat:g} (Takt {int(kill_beat // 4) + 1}, Schlag {int(kill_beat % 4) + 1})")
    f.erwarte(ks + 4800, osc("/nb", 1, None, None, None), "pruefstand", ab=ks, herleitung="§5.10 Zustand 1 Schleife")
    f.messung(ks, "schleife_frames", tf, 0,
              f"§6.1: Schleife um takt_frames = llround(sample({takt_ende:g})) − llround(sample({takt_ende - 4:g})) = {tf}")
    f.messung(ks + 12000, "stille_ms", 0, 0, "ARCHITEKTUR §7: 0 ms Stille")
    f.erwarte(ks + 96000, osc("/nb", 0, None, None, None), "pruefstand", ab=ks, herleitung="§5.10 zurück zu durchreichen")
    f.messung(ks + 96000, "rueckgabe_raster_abw_samples", 0, 1,
              "ARCHITEKTUR §7: Klicks nach der Rückgabe auf llround(sample_at(b)) ± 1 Sample")
    return f


FOLGEN = [lambda: teil_rampe(True), autonomie_1_eq, notbahn, lambda: notbahn(True)]
