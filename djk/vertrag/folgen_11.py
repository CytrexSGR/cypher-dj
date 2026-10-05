"""Golden-Folgen für Scheibe 11 (Stellwerk ohne Prüfer) und alle weiteren Läufer: Regler, Hand, Verspätung, I4,
KI-Stopp. teil_rampe(neustart=True) baut zusätzlich die Folge neustart (in folgen_betrieb.py eingetragen)."""
import herleitung as h
from folgen_bau import (ABGEBROCHEN, ABGELEHNT, GESTARTET, MARGE, MB, SPUR, STARTFRIST, VERSP_AUSGEFUEHRT, VERWORFEN,
                        ZYKLEN2, Folge, b_rein, inhalt, osc)


def teil_rampe(neustart=False):
    name = "neustart" if neustart else "teil_rampe"
    f = Folge(name, name, ["18", "13", "43"] if neustart else ["11", "13", "20", "25"],
              "kill -9 mitten in der Rampe: Rampe endet am unveränderten Ende-Beat" if neustart
              else "/k/teil deck/2/fader von −15 nach 0 dB, ab_beat 64, 32 Beats bei 128 BPM")
    f.laden(2, 2, MB)
    hs = f.hoerschein(8, "h2", "deck/2", inhalt(MB), 128.0, 16.0, 32.0)
    ids = b_rein(f, "p1", 48, 64.0, 32.0, "h2", eq_zu=False)
    assert h.hs_grund(hs, "deck/2", inhalt(MB), 64.0, 128.0, quell_bei_ab=32.0) is None
    f.gestartet(ids["start"], "cypher", 64, "deck")
    f.gestartet(ids["setz"], "cypher", 64)
    f.fertig_setzen(ids["setz"], "cypher", 64)
    f.gestartet(ids["rampe"], "cypher", 64)
    f.erwarte(f.S(64) + MARGE, osc("/e/regler", "deck/2/fader", None, "plan:p1", f.S(64), 64.0), "regler", ab=f.S(64),
              herleitung="§5.7: /e/regler bei Teilstart, Halter plan:<plan> (§4.3)")
    rw = lambda b: h.rampe_wert("deck/2/fader", -15.0, 0.0, 64.0, 32.0, b)
    f.wert(f.S(64) - 1000, "deck/2/fader", -200.0, 0.0, "regler", "Negativ-Kontrolle: vor dem Start stumm (§1.5 Vorgabe)")
    f.wert(f.S(64), "deck/2/fader", rw(64.0), 0.01, "regler", "§4.3: w0 = Zielwert des Setzens am selben Sample")
    if neustart:
        ks = f.S(72)
        f.aktion(ks, "kern_kill9", "§19.3 neustart: kill -9 zwischen Teilstart und Teilende")
        f.erwarte(ks + STARTFRIST, osc("/e/neustart", 1, None), "zeitachse", ab=ks,
                  herleitung="§4.1: erste Nachricht der neuen Generation an die gespeicherten Abonnenten; "
                             "ARCHITEKTUR §7: wieder da nach höchstens 250 ms")
        bis = ks + STARTFRIST + 48000
        f.erwarte(bis, osc("/k/willkommen", 1, 1, None, None, None, None), "zeitachse", ab=ks,
                  herleitung="§4.1: der Herzschlag des Läufers (FORMAT.md Punkt 13) meldet ihn in Generation 1 an")
        f.erwarte(bis, osc("/e/neustart", 1, None), "zeitachse", ab=ks,
                  herleitung="§4.1: nach willkommen /e/neustart an den in der neuen Generation Angemeldeten")
        f.erwarte(bis, osc("/q/stand", ids["rampe"], "cypher", GESTARTET, None, None, ""), "regler", ab=ks,
                  herleitung="§5.1 /q/stand: Status 2 für den laufenden Teil")
        f.erwarte_nicht(ks, f.S(80), osc("/q/stand", ids["setz"], "cypher", None, None, None, None), "regler",
                        herleitung="§5.1: fertige Befehle der alten Generation meldet der Kern nicht erneut")
    else:
        f.wert(f.S(72), "deck/2/fader", rw(72.0), 0.01, "regler", "§4.3 linear: −15 + 15·8/32")
    f.wert(f.S(80), "deck/2/fader", rw(80.0), 0.01, "regler", "§19.3 teil_rampe: Wert bei Beat 80 (Sample 1 800 000) = −7,5 dB")
    f.fertig(ids["rampe"], "cypher", 96)
    f.wert(f.S(96), "deck/2/fader", rw(96.0), 0.01, "regler", "Ende der Rampe, Sample 2 160 000")
    f.erwarte(f.S(96) + ZYKLEN2, osc("/e/regler", "deck/2/fader", None, "frei", None, None), "regler", ab=f.S(96),
              herleitung="§4.3: Halter plan:p1 nur während des Teils, danach frei (§5.7 bei Halterwechsel)")
    f.wert(f.S(98), "deck/2/fader", 0.0, 0.01, "regler", "Wert bleibt nach dem Ende")
    return f


def hand_gewinnt():
    f = Folge("hand_gewinnt", "hand_gewinnt", ["11", "13", "25", "35"],
              "Hand bei Sample 1 620 000 über der Totzone bricht Rampe und Gruppe b_rein ab, Gruppe echo läuft weiter")
    f.laden(2, 2, MB)
    f.hoerschein(8, "h2", "deck/2", inhalt(MB), 128.0, 16.0, 32.0)
    ids = b_rein(f, "p1", 48, 64.0, 32.0, "h2", eq_zu=True)
    t4 = f.teil(48, "cypher", "p1", 4, "deck/2/eq/tief", 76, 4, 0.0, gruppe="b_rein",
                herleitung="wartet bei Beat 72, gehört zur Gruppe b_rein")
    t5 = f.teil(48, "cypher", "p1", 5, "deck/2/send/1", 68, 16, -20.0, gruppe="echo",
                herleitung="läuft bei Beat 72, andere Gruppe")
    f.gestartet(ids["rampe"], "cypher", 64)
    stell = 1500000
    f.hand(stell, "deck/2/fader", 0.5, "§19.3: 0,5 bei Sample 1 500 000 ist erster Wert, nur Stellung (§7.3 Punkt 2)")
    rw = lambda b: h.rampe_wert("deck/2/fader", -15.0, 0.0, 64.0, 32.0, b)
    f.wert(1560000, "deck/2/fader", rw(1560000 / SPUR), 0.01, "regler", "Negativ-Kontrolle: Stellung allein ändert nichts")
    greif = 1620000
    f.erwarte_nicht(0, greif - 1, osc("/q", None, "cypher", ABGEBROCHEN, None, None, None), "regler",
                    herleitung="vor dem Griff kein Abbruch")
    assert 4 / 128 > h.TOTZONE
    f.hand(greif, "deck/2/fader", 0.5 + 4 / 128, "§19.3: 0,5 + 4/128 bei Sample 1 620 000, über der Totzone 3/128")
    gb = greif / SPUR
    f.q(ids["rampe"], "cypher", ABGEBROCHEN, greif, gb, "hand", greif + MARGE, ab=greif,
        herleitung="§7.3 Punkt 3: Abbruch am selben Sample, Grund hand")
    f.q(t4, "cypher", ABGEBROCHEN, greif, gb, "hand", greif + MARGE, ab=greif,
        herleitung="ADR 023 Entscheidung 2: wartender Teil derselben Gruppe fällt mit")
    f.erwarte(greif + MARGE, osc("/e/halter", "deck/2/fader", "mensch", greif, gb), "regler", ab=greif,
              herleitung="§7.3 Punkt 3: Halter mensch am selben Sample")
    f.erwarte_nicht(greif, f.S(80), osc("/q", ids["start"], "cypher", ABGEBROCHEN, None, None, None), "deck",
                    herleitung="FORMAT.md Punkt 22 c: der ausgeführte Deck-Start ist abgeschlossen und fällt nicht mehr")
    f.wert(f.S(80), "deck/2/eq/tief", -30.0, 0.01, "regler", "Teil 4 entfiel: Bass bleibt beim gesetzten −30")
    f.wert(f.S(76), "deck/2/send/1", h.rampe_wert("deck/2/send/1", -200.0, -20.0, 68.0, 16.0, 76.0), 0.01, "regler",
           "Gruppe echo läuft weiter; von stumm ab −60 interpoliert (§1.2)")
    f.fertig(t5, "cypher", 84)
    f.wert(f.S(80), "deck/2/fader", -5.625, 5.625, "regler",
           "nach der Übernahme führt die Hand; skaliert nach oben heißt zwischen Ist-Wert −11,25 und 0 dB "
           "(die genaue Kurve legt §7.2 nicht fest, FORMAT.md Punkt 22 d)")
    return f


def zu_spaet():
    f = Folge("zu_spaet", "zu_spaet", ["11", "13", "25"], "Politik 0 zu spät → Status 4, Politik 1 zu spät → Status 5")
    i0 = f.teil(44, "leitstand", "p1", 0, "deck/2/eq/mitte", 40, 8, -20.0, politik=0, angenommen=False,
                herleitung="ab_beat 40 liegt beim Senden (Beat 44) in der Vergangenheit")
    s0 = f.S(44)
    f.q(i0, "leitstand", VERWORFEN, None, None, "zu_spaet", s0 + MARGE, ab=s0,
        herleitung="§16.1 Politik 0: verworfen, Quittung 4, Grund zu_spaet (§16.2)")
    f.wert(f.S(50), "deck/2/eq/mitte", 0.0, 0.0, "regler", "verworfen: Wert unverändert (§1.5 Vorgabe 0)")
    i1 = f.teil(64, "leitstand", "p1", 1, "deck/2/eq/hoch", 60, 16, -30.0, politik=1, angenommen=False)
    s1 = f.S(64)
    f.q(i1, "leitstand", VERSP_AUSGEFUEHRT, None, 64.0, None, s1 + MARGE, ab=s1, toleranz=0.05,
        herleitung="§16.1 Politik 1: am nächsten Zyklus (ist_sample = nächster Blockanfang nach der Ankunft), Quittung 5; "
                   "Grund \"\" oder zu_spaet (FORMAT.md Punkt 22 i)")
    f.wert(f.S(70), "deck/2/eq/hoch", h.restrampe_wert(0.0, -30.0, 64.0, 76.0, 70.0), 0.1, "regler",
           "§16.1 Restrampe vom Ist-Wert bis zum unveränderten Ende-Beat 76 (Start höchstens 1 000 Samples nach Beat 64)")
    f.fertig(i1, "leitstand", 76)
    f.wert(f.S(78), "deck/2/eq/hoch", -30.0, 0.01, "regler", "Ende-Beat unverändert")
    i2 = f.teil(80, "leitstand", "p1", 2, "deck/2/filter", 88, 4, 0.5, politik=0,
                herleitung="Negativ-Kontrolle: rechtzeitig gesendet")
    f.gestartet(i2, "leitstand", 88)
    f.fertig(i2, "leitstand", 92)
    return f


def i4_ueberlappung():
    f = Folge("i4_ueberlappung", "i4_ueberlappung", ["11", "13", "25"],
              "I4: Überlappung am selben Regler abgelehnt, auch im selben Plan; Setzen vor anschließender Rampe erlaubt")
    angenommen = {}
    faelle = [("p1", 0, "deck/1/eq/tief", 64, 0, -10.0), ("p1", 1, "deck/1/eq/tief", 64, 8, -20.0),
              ("p1", 2, "deck/1/eq/tief", 70, 4, 0.0), ("p1", 3, "deck/1/eq/tief", 72, 4, -30.0),
              ("p1", 4, "deck/1/eq/tief", 74, 0, -5.0), ("p2", 0, "deck/1/eq/tief", 66, 2, 0.0),
              ("p2", 1, "deck/1/eq/mitte", 66, 2, -6.0), ("p1", 5, "deck/1/eq/tief", 76, 0, 0.0)]
    s = f.S(16)
    for plan, nr, pfad, ab, dauer, nach in faelle:
        ref = (float(ab), float(dauer), nr)
        # Reihenfolge nach Teil-Nummer gilt innerhalb eines Plans; planübergreifend zählt nur die Zeit
        kollision = any(p == pfad and h.i4_ueberlappt((a[0], a[1], a[2] if pl == plan else -1), ref)
                        for (pl, p), liste in angenommen.items() for a in liste)
        i = f.teil(16, "leitstand", plan, nr, pfad, ab, dauer, nach, angenommen=not kollision,
                   herleitung=f"I4: [{ab}, {ab + dauer}) gegen angenommene Teile am selben Regler")
        if kollision:
            f.q(i, "leitstand", ABGELEHNT, None, None, "ueberlappung", s + MARGE, ab=s,
                herleitung="§17 I4: beim Einsortieren abgelehnt")
        else:
            angenommen.setdefault((plan, pfad), []).append(ref)
    f.wert(f.S(68), "deck/1/eq/tief", h.rampe_wert("deck/1/eq/tief", -10.0, -20.0, 64.0, 8.0, 68.0), 0.01, "regler",
           "Rampe startet beim Zielwert des Setzens am selben Beat")
    f.wert(f.S(73), "deck/1/eq/tief", h.rampe_wert("deck/1/eq/tief", -20.0, -30.0, 72.0, 4.0, 73.0), 0.01, "regler",
           "angrenzende Rampe [72, 76) war erlaubt")
    f.wert(f.S(67), "deck/1/eq/mitte", h.rampe_wert("deck/1/eq/mitte", 0.0, -6.0, 66.0, 2.0, 67.0), 0.01, "regler",
           "Negativ-Kontrolle: anderer Regler, gleiche Zeit, angenommen")
    f.wert(f.S(76.5), "deck/1/eq/tief", 0.0, 0.01, "regler", "Setzen am Ende-Beat einer Rampe liegt außerhalb [72, 76)")
    return f


def ki_stopp():
    f = Folge("ki_stopp", "ki_stopp", ["11", "13", "25", "35"],
              "/k/ki/stopp: alle cypher-Teile ab, KI-Spur über 4 Beats stumm, danach ki_gestoppt, frei nur durch andreas")
    f.hand_auf("deck/3/fader", 2)
    i = f.nid()
    f.sende(f.S(4), osc("/k/ki/spur", i, "leitstand", "deck/3,erz/1"), "ki", "§4.7 /k/ki/spur")
    f.angenommen(i, "leitstand", f.S(4), "ki")
    c0 = f.teil(24, "cypher", "c1", 0, "deck/3/eq/hoch", 40, 16, -20.0, herleitung="läuft beim Stopp")
    c1 = f.teil(24, "cypher", "c1", 1, "deck/1/eq/mitte", 52, 8, -10.0, herleitung="wartet beim Stopp")
    l0 = f.teil(24, "leitstand", "l1", 0, "deck/1/filter", 40, 16, 0.5, herleitung="Negativ-Kontrolle: Quelle leitstand")
    stopp = f.S(48)
    i = f.nid()
    f.sende(stopp, osc("/k/ki/stopp", i, "andreas"), "ki", "§4.7 wirkt wie die Stopp-Taste, bei Ankunft")
    for c in (c0, c1):
        f.q(c, "cypher", ABGEBROCHEN, None, None, "ki_stopp", stopp + MARGE, ab=stopp,
            herleitung="§4.7: alle Teile mit Quelle cypher abgebrochen, Grund ki_stopp")
    f.erwarte(stopp + MARGE, osc("/e/ki", 1, None, None), "ki", ab=stopp, herleitung="§5.9 /e/ki gestoppt 1")
    f.wert(f.S(50), "deck/3/fader", h.rampe_wert("deck/3/fader", 0.0, -200.0, 48.0, 4.0, 50.0), 0.7, "ki",
           "§4.7 KI-Spur über 4 Beats auf −200, §1.2 bis −60 interpoliert; Toleranz für bis zu 1 000 Samples Ankunft")
    f.wert(f.S(52) + MARGE, "deck/3/fader", -200.0, 0.0, "ki", "nach 4 Beats stumm (§1.2)")
    f.wert(f.S(54), "deck/3/eq/hoch", h.rampe_wert("deck/3/eq/hoch", 0.0, -20.0, 40.0, 16.0, 48.0) - 0.028, 0.03, "ki",
           "§4.3 /k/abbruch-Semantik: laufender Teil hält am Ist-Wert (Ankunft zwischen Beat 48 und 48,044)")
    f.wert(f.S(58), "deck/1/eq/mitte", 0.0, 0.0, "ki", "wartender cypher-Teil entfällt")
    f.fertig(l0, "leitstand", 56)
    c2 = f.teil(56, "cypher", "c2", 0, "deck/1/eq/tief", 64, 0, -6.0, angenommen=False)
    f.q(c2, "cypher", ABGELEHNT, None, None, "ki_gestoppt", f.S(56) + MARGE, ab=f.S(56),
        herleitung="§4.7: weitere cypher-Befehle abgelehnt bis /k/ki/frei")
    l2 = f.teil(56, "leitstand", "l2", 0, "deck/1/eq/hoch", 64, 0, -3.0, herleitung="Negativ-Kontrolle: leitstand geht")
    f.gestartet(l2, "leitstand", 64)
    i = f.nid()
    f.sende(f.S(68), osc("/k/ki/frei", i, "andreas"), "ki", "§4.7 /k/ki/frei nur andreas")
    f.erwarte(f.S(68) + MARGE, osc("/e/ki", 0, None, None), "ki", ab=f.S(68))
    c3 = f.teil(72, "cypher", "c3", 0, "deck/1/eq/tief", 80, 0, -6.0, herleitung="nach frei wieder angenommen")
    f.gestartet(c3, "cypher", 80)
    return f


FOLGEN = [teil_rampe, hand_gewinnt, zu_spaet, i4_ueberlappung, ki_stopp]
