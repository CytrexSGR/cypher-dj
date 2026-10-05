"""Golden-Folgen für Scheibe 20 (Invarianten I1 bis I3, Frist-Wächter), Kern-Attrappe (13) und Kern (43)."""
import herleitung as h
from folgen_bau import (ABGEBROCHEN, GESTARTET, M128, M96, MA, MARGE, MB, ME, ZYKLEN2, Folge, a_hoerbar, b_rein,
                        inhalt, osc)


def sub_doppelt(mit_hand=True):
    name = "sub_doppelt" if mit_hand else "sub_doppelt_kontrolle"
    f = Folge(name, "sub_doppelt", ["20", "13", "43"],
              "a1 aus angriff.mjs: Hand hält A's Bass, B's Bass-Rampe ohne Kopplung → I1 bricht sie ab" if mit_hand
              else "a1 Negativ-Kontrolle: ohne Hand tauscht der Basstausch sauber, kein I1")
    a_hoerbar(f)
    f.laden(11, 2, MB)
    f.hoerschein(12, "h2", "deck/2", inhalt(MB), 192.0, 16.0, 48.0)
    ids = b_rein(f, "p1", 48, 64.0, 32.0, "h2", eq_zu=True)
    t4 = f.teil(48, "cypher", "p1", 4, "deck/2/eq/tief", 92, 4, 0.0, gruppe="b_bass",
                herleitung="Basstausch ohne Kopplung (0 von 105 LLM-Plänen setzen gruppe, ADR 023)")
    t5 = f.teil(48, "cypher", "p1", 5, "deck/1/eq/tief", 92, 4, -30.0, gruppe="a_bass")
    f.fertig(ids["rampe"], "cypher", 96, herleitung="B rein läuft unberührt zu Ende")
    kreuz_b = h.beat_bei_wert(-30.0, 0.0, 92.0, 4.0, h.TIEF_OFFEN_DB)
    kreuz_a = h.beat_bei_wert(0.0, -30.0, 92.0, 4.0, h.TIEF_OFFEN_DB)
    b_fader_kreuz = h.rampe_wert("deck/2/fader", -15.0, 0.0, 64.0, 32.0, kreuz_b)
    if mit_hand:
        f.hand(f.S(89), "deck/1/eq/tief", 0.5, "erster Wert an diesem Regler: nur Stellung (§7.3 Punkt 2)")
        f.hand(f.S(90), "deck/1/eq/tief", 0.5 + 4 / 128, "Andreas hält A's Bass offen (nach oben skaliert: ≥ 0 dB)")
        f.q(t5, "cypher", None, None, None, None, f.S(92) + MARGE, ab=f.S(90),
            herleitung="FORMAT.md Punkt 22 e: der wartende Teil am gegriffenen Regler fällt, beim Griff (Status 7 hand, "
                       "ADR 023) oder an seinem Start (Status 6 regler_beim_menschen, §4.3)")
        f.erwarte_nicht(f.S(90), f.S(97), osc("/q", t5, "cypher", GESTARTET, None, None, None), "regler",
                        herleitung="A's Bass-Rampe startet nicht")
        f.gestartet(t4, "cypher", 92)
        assert h.tief_offen(h.hoerbar(0.0, 0.0), 0, 0.0) and h.hoerbar(0.0, b_fader_kreuz)
        s_kreuz = f.S(kreuz_b)
        f.erwarte_nicht(0, s_kreuz - ZYKLEN2 - 1, osc("/e/invariante", "sub_doppelt", None, None, None, None),
                        "invariante", herleitung="vor dem Kreuzen von −12 dB kein I1")
        f.q(t4, "cypher", ABGEBROCHEN, None, None, "invariante_sub_doppelt", s_kreuz + ZYKLEN2, ab=s_kreuz - ZYKLEN2,
            bereich="invariante",
            herleitung=f"§17 I1: B's eq/tief kreuzt −12 dB bei Beat {kreuz_b:g} (Sample {s_kreuz}); A tief offen, "
                       f"B hörbar (Fader {b_fader_kreuz:g} dB)")
        f.erwarte(s_kreuz + ZYKLEN2, osc("/e/invariante", "sub_doppelt", "p1", 4, None, None), "invariante",
                  ab=s_kreuz - ZYKLEN2)
        f.wert(f.S(97), "deck/2/eq/tief", -12.05, 0.05, "invariante",
               "§17 I1: Wert bleibt am Ist-Wert, also höchstens −12 dB und höchstens einen Zyklus (0,085 dB) darunter")
        f.wert(f.S(97), "deck/1/eq/tief", 3.0, 3.0, "regler", "A's Bass unter der Hand, nach oben skaliert: 0 bis +6 dB")
    else:
        assert kreuz_a < kreuz_b  # A fällt unter −12, bevor B darüber steigt (§14.1 Anmerkung, 40 % gegen 60 %)
        f.gestartet(t4, "cypher", 92)
        f.gestartet(t5, "cypher", 92)
        f.fertig(t4, "cypher", 96)
        f.fertig(t5, "cypher", 96)
        f.erwarte_nicht(0, f.S(100), osc("/e/invariante", None, None, None, None, None), "invariante",
                        herleitung=f"A unter −12 ab Beat {kreuz_a:g}, B darüber ab Beat {kreuz_b:g}: nie beide tief offen")
        f.wert(f.S(97), "deck/2/eq/tief", 0.0, 0.01, "regler")
        f.wert(f.S(97), "deck/1/eq/tief", -30.0, 0.01, "regler")
    return f


def master_leer(verriegelt=True):
    name = "master_leer" if verriegelt else "master_leer_kontrolle"
    f = Folge(name, "master_leer", ["20", "13", "43"],
              "a2 aus angriff.mjs: B am Start verriegelt (Hörschein abgelaufen), A-Ausblende → I2 hält A bei −26 dB"
              if verriegelt else "a2 Negativ-Kontrolle: B gültig hörbar, A blendet bis −40 aus")
    a_hoerbar(f)
    f.laden(11, 2, MB)
    bis = 60.0 if verriegelt else 192.0
    hs = f.hoerschein(12, "h2", "deck/2", inhalt(MB), bis, 16.0, 48.0)
    ids = b_rein(f, "p1", 48, 64.0, 32.0, "h2", eq_zu=True, gruppe_fader="")
    t_a = f.teil(48, "cypher", "p1", 5, "deck/1/fader", 80, 16, -40.0, politik=1, gruppe="a_raus")
    f.gestartet(t_a, "cypher", 80)
    grund = h.hs_grund(hs, "deck/2", inhalt(MB), 64.0, 128.0, quell_bei_ab=32.0)
    if verriegelt:
        assert grund == "hoerschein_abgelaufen"
        f.abgelehnt_am_start(ids["setz"], "cypher", 64, grund)
        f.abgelehnt_am_start(ids["rampe"], "cypher", 64, grund,
                             herleitung="§17 I3a: auch die Rampe von −200 (Ist-Wert nach dem abgelehnten Setzen) auf 0 öffnet")
        f.wert(f.S(98), "deck/2/fader", -200.0, 0.0, "hoerschein", "B bleibt zu, also nie hörbar")
        kreuz = h.beat_bei_wert(0.0, -40.0, 80.0, 16.0, h.HOERBAR_DB)
        sk = f.S(kreuz)
        f.erwarte_nicht(0, sk - ZYKLEN2 - 1, osc("/e/invariante", "master_leer", None, None, None, None), "invariante")
        f.erwarte(sk + ZYKLEN2, osc("/e/invariante", "master_leer", "p1", 5, None, None), "invariante", ab=sk - ZYKLEN2,
                  herleitung=f"§17 I2: A kreuzte −26 dB bei Beat {kreuz:g} (Sample {sk}); B nie hörbar")
        f.nicht_fertig(t_a, "cypher", 80, 100, herleitung="§17 I2: Status bleibt gestartet")
        f.wert(f.S(98), "deck/1/fader", -25.985, 0.015, "invariante", "§17 I2: hält am Ist-Wert knapp über −26 dB")
        f.deck_wert(f.S(100), 1, "status", 2, 0, "deck", "A läuft weiter (§5.5 Status 2)")
    else:
        assert grund is None
        f.gestartet(ids["setz"], "cypher", 64)
        f.gestartet(ids["rampe"], "cypher", 64)
        f.fertig(t_a, "cypher", 96)
        f.erwarte_nicht(0, f.S(100), osc("/e/invariante", None, None, None, None, None), "invariante")
        f.wert(f.S(98), "deck/1/fader", -40.0, 0.01, "regler", "Ausblende vollständig")
    return f


def b_verriegelt_a_laeuft_aus():
    f = Folge("b_verriegelt_a_laeuft_aus", "b_verriegelt_a_laeuft_aus", ["20", "13", "43"],
              "B am Start ohne Hörschein verriegelt, A läuft aus: I2 hält A raus, Frist-Wächter setzt die Rückfall-Schleife")
    a_hoerbar(f, material=M128)
    f.laden(11, 2, MB)
    ids = b_rein(f, "p1", 48, 64.0, 32.0, "", eq_zu=True, gruppe_fader="")
    assert h.hs_grund(None, "deck/2", inhalt(MB), 64.0, 128.0) == "kein_hoerschein"
    f.abgelehnt_am_start(ids["setz"], "cypher", 64, "kein_hoerschein")
    f.abgelehnt_am_start(ids["rampe"], "cypher", 64, "kein_hoerschein", herleitung="§17 I3a: die Rampe auf 0 öffnet ebenfalls")
    t_a = f.teil(48, "cypher", "p1", 4, "deck/1/fader", 80, 16, -40.0, politik=1, gruppe="a_raus")
    stopp = f.deck_stopp(48, 1, 100.0, quelle="cypher", plan="p1", gruppe="a_raus")
    f.gestartet(t_a, "cypher", 80)
    sk = f.S(h.beat_bei_wert(0.0, -40.0, 80.0, 16.0, h.HOERBAR_DB))
    f.erwarte(sk + ZYKLEN2, osc("/e/invariante", "master_leer", "p1", 4, None, None), "invariante", ab=sk - ZYKLEN2)
    f.erlaube(f.S(100), f.S(160), osc("/e/invariante", "master_leer", "p1", None, None, None), "invariante",
              "FORMAT.md Punkt 22 f: ob der wartende Plan-Stopp eine eigene Meldung trägt, lässt §17 offen")
    f.nicht_fertig(t_a, "cypher", 80, 160)
    f.nicht_gestartet(stopp, "cypher", 100, 160, "deck", "§17 I2: der Stopp wartet (Status bleibt angenommen)")
    q_ende = 128.0
    q0 = h.rueckfall_q0(q_ende, 0.0)
    ab_frist = 8.0 + (q_ende - h.FRIST_BEATS)   # beats_bis_ende < 32 ab Quell-Beat 96 = Master-Beat 104
    f.erwarte_nicht(0, f.S(ab_frist) - 1, osc("/e/rueckfall", 1, 1, None, None, None, None), "invariante")
    f.erwarte(f.S(ab_frist) + ZYKLEN2, osc("/e/rueckfall", 1, 1, q0, h.RUECKFALL_LAENGE, None, None), "invariante",
              ab=f.S(ab_frist), herleitung=f"§17 Frist-Wächter: q0 = 0 + floor((128 − 0 − 16)/16)·16 = {q0:g}")
    for b in (150.0, 160.0):
        q = h.loop_position(q0, h.RUECKFALL_LAENGE, b - 8.0)
        f.deck_wert(f.S(b), 1, "quell_beat", q, 0.01, "invariante", f"Rückfall-Loop [{q0:g}, {q0 + 16:g}): Quell-Beat {q:g}")
    f.deck_wert(f.S(150), 1, "status", 5, 0, "invariante", "§5.5 Status 5 Rückfall")
    f.wert(f.S(150), "deck/1/fader", -25.985, 0.015, "invariante", "A bleibt hörbar: keine Stille")
    return f


def hand_stoppt_a_raus():
    f = Folge("hand_stoppt_a_raus", "hand_stoppt_a_raus", ["20", "13", "43"],
              "Griff an A's Fader während A raus: Gruppe a_raus samt Deck-Stopp fällt, A läuft")
    a_hoerbar(f)
    f.laden(11, 2, MB)
    f.hoerschein(12, "h2", "deck/2", inhalt(MB), 192.0, 64.0, 80.0)
    wahl = dict(id="w1", von="cypher", material_id=MB, spielart="sicher", start_takt=17, hoerschein="h2",
                einstieg_quell_beat=64.0, deck=2)
    teile = h.expandiere(wahl, 1)
    for t in teile:   # FORMAT.md Punkt 22 n: B's Bass schließt einen Beat vor S, B liegt dann noch hinter dem Fader
        if t["art"] == "regler" and t["pfad"] == "deck/2/eq/tief" and t["dauer_beats"] == 0 and t["ab_beat"] == 64.0:
            t["ab_beat"] = 63.0
    ids = {}
    for t in teile:
        if t["art"] == "deck" and t["aktion"] == "start":
            ids[t["nr"]] = f.deck_start(48, t["deck"], t["ab_beat"], t["quell_beat"], quelle="cypher", plan="p17",
                                        gruppe=t["gruppe"], hs=t["hoerschein"], politik=t["politik"])
        elif t["art"] == "deck":
            ids[t["nr"]] = f.deck_stopp(48, t["deck"], t["ab_beat"], quelle="cypher", plan="p17", gruppe=t["gruppe"],
                                        hs=t["hoerschein"], politik=t["politik"])
        else:
            ids[t["nr"]] = f.teil(48, "cypher", "p17", t["nr"], t["pfad"], t["ab_beat"], t["dauer_beats"], t["nach"],
                                  politik=t["politik"], gruppe=t["gruppe"], hs=t["hoerschein"],
                                  herleitung="§14.4 Regel sicher mit S = Beat 64 (herleitung.expandiere)")
    greif = f.S(116)
    f.erwarte_nicht(0, greif - 1, osc("/q", None, "cypher", ABGEBROCHEN, None, None, None), "regler")
    f.hand(greif, "deck/1/fader", 1.0 - 4 / 128,
           "A's Fader steht seit a_hoerbar physisch auf 1,0 (kein erster Wert mehr); 4/128 nach unten liegt über der "
           "Totzone, während Teil 8 den Regler hält (§7.3 Punkt 3)")
    for t in teile:
        laeuft_oder_wartet = t["ab_beat"] + t.get("dauer_beats", 0.0) > 116.0
        if t["gruppe"] == "a_raus" and laeuft_oder_wartet:
            f.q(ids[t["nr"]], "cypher", ABGEBROCHEN, greif, 116.0, "hand", greif + MARGE, ab=greif,
                bereich="deck" if t["art"] == "deck" else "regler",
                herleitung=f"§14.1: greift Andreas A's Fader, fällt die ganze Gruppe a_raus, auch der Stopp (Teil {t['nr']})")
    f.fertig(ids[4], "cypher", 96)
    f.fertig(ids[5], "cypher", 96)
    f.wert(f.S(120), "deck/1/eq/mitte", h.rampe_wert("deck/1/eq/mitte", 0.0, -26.25, 96.0, 28.0, 116.0), 0.01, "regler",
           "abgebrochen: hält am Ist-Wert von Beat 116")
    f.deck_wert(f.S(132), 1, "status", 2, 0, "deck", "A läuft")
    f.deck_wert(f.S(132), 1, "quell_beat", 132.0 - 8.0, 0.01, "deck", "A ohne Stopp und ohne Sprung")
    f.wert(f.S(100), "deck/2/fader", 0.0, 0.01, "regler", "B rein unberührt")
    return f


def rueckfall(kontrolle=False):
    name = "rueckfall_kontrolle" if kontrolle else "rueckfall"
    f = Folge(name, "rueckfall", ["20", "13", "43"],
              "Deck als einziger hörbarer Kanal, 96 Beats, erste_eins 0, kein Plan → Loop [80, 96)" if not kontrolle
              else "Negativ-Kontrolle: ein zweiter Kanal ist hörbar, kein Rückfall")
    a_hoerbar(f, material=M96)
    if kontrolle:
        f.laden(11, 2, MB)
        i = f.deck_start(12, 2, 16.0, 0.0)
        f.gestartet(i, "andreas", 16, "deck")
        f.hand_auf("deck/2/fader", 17)
        f.erwarte_nicht(0, f.S(104), osc("/e/rueckfall", 1, 1, None, None, None, None), "invariante",
                        herleitung="§17: nur wenn das Deck der einzige hörbare Kanal ist")
        return f
    q_ende, e = 96.0, 0.0
    q0 = h.rueckfall_q0(q_ende, e)
    assert (q0, q0 + 16) == (80.0, 96.0)
    for rest in (64.0, 32.0):
        b = 8.0 + q_ende - rest
        f.erwarte(f.S(b) + ZYKLEN2, osc("/e/frist", 1, rest, None, None), "invariante", ab=f.S(b), toleranz=0.05,
                  herleitung=f"§5.9 /e/frist bei {rest:g} Beats vor dem Ende eines hörbaren Decks")
    b_frist = 8.0 + q_ende - h.FRIST_BEATS
    f.erwarte_nicht(0, f.S(b_frist) - 1, osc("/e/rueckfall", 1, 1, None, None, None, None), "invariante")
    f.erwarte(f.S(b_frist) + ZYKLEN2, osc("/e/rueckfall", 1, 1, q0, 16.0, None, None), "invariante", ab=f.S(b_frist),
              herleitung="§19.3 rueckfall: Loop [80, 96), sobald beats_bis_ende < 32 (§17 q0-Formel)")
    for b in (110.0, 121.0):
        f.deck_wert(f.S(b), 1, "quell_beat", h.loop_position(q0, 16.0, b - 8.0), 0.01, "invariante")
    f.deck_wert(f.S(110), 1, "status", 5, 0, "invariante", "§5.5 Status 5 Rückfall")
    i = f.deck_stopp(123, 1, 124.0, quelle="andreas", politik=1)
    f.gestartet(i, "andreas", 124, "deck")
    f.erwarte(f.S(124) + ZYKLEN2, osc("/e/rueckfall", 1, 0, None, None, None, None), "invariante", ab=f.S(123),
              herleitung="§17: jeder Befehl an dieses Deck beendet den Rückfall (an = 0); ob schon beim Eintreffen oder "
                         "erst beim Ausführen, lässt der Text offen: Fenster ab dem Senden")
    f.deck_wert(f.S(126), 1, "status", 1, 0, "deck", "nach dem Stopp: geladen")
    return f


def _i3_grundaufbau(f, hs_args, gegen=None):
    """deck/2 lädt B, läuft ab Beat 32 von Quell-Beat 16 (Quell = Master − 16). Öffnen bei 64, Gegenprobe bei 96."""
    f.laden(2, 2, MB)
    i = f.deck_start(28, 2, 32.0, 16.0)
    f.gestartet(i, "andreas", 32, "deck")
    hs = f.hoerschein(40, *hs_args) if hs_args else None
    ok = f.hoerschein(40, *(gegen or ("h_ok", "deck/2", inhalt(MB), 192.0, 40.0, 60.0)))
    return hs, ok


def i3(grund):
    f = Folge(f"i3_{grund}", "i3_gruende", ["20", "13", "43"], f"I3a: Öffnen von deck/2 mit {grund}, danach Gegenprobe")
    B = inhalt(MB)
    if grund == "ziel_ungehoert":
        return i3_ziel_ungehoert(f)
    fall = {"kein_hoerschein": (None, ""), "hoerschein_anderer_kanal": (("h_d3", "deck/3", B, 192.0, 40.0, 60.0), "h_d3"),
            "hoerschein_anderer_inhalt": (("h_a", "deck/2", inhalt(MA), 192.0, 40.0, 60.0), "h_a"),
            "hoerschein_anderes_tempo": (("h_t", "deck/2", B, 192.0, 40.0, 60.0, 130.0), "h_t"),
            "hoerschein_abgelaufen": (("h_alt", "deck/2", B, 60.0, 40.0, 60.0), "h_alt"),
            "hoerschein_anderer_abschnitt": (("h_ab", "deck/2", B, 192.0, 100.0, 110.0), "h_ab")}[grund]
    gegen = ("h_t2", "deck/2", B, 192.0, 40.0, 60.0, 128.64) if grund == "hoerschein_anderes_tempo" else None
    hs, ok = _i3_grundaufbau(f, fall[0], gegen)
    t = f.teil(48, "cypher", "p1", 0, "deck/2/fader", 64, 0, -15.0, hs=fall[1], herleitung=f"öffnet deck/2 mit {fall[1]!r}")
    assert h.hs_grund(hs, "deck/2", B, 64.0, 128.0, quell_bei_ab=48.0) == grund
    f.abgelehnt_am_start(t, "cypher", 64, grund)
    if grund == "kein_hoerschein":
        t2 = f.teil(64, "cypher", "p2", 0, "deck/2/fader", 72, 0, -15.0, hs="h_nie", herleitung="unbekannte hs_id")
        f.abgelehnt_am_start(t2, "cypher", 72, "kein_hoerschein")
    f.wert(f.S(80), "deck/2/fader", -200.0, 0.0, "hoerschein", "verriegelt: Kanal bleibt zu")
    assert h.hs_grund(ok, "deck/2", B, 96.0, 128.0, quell_bei_ab=80.0) is None
    g = f.teil(88, "cypher", "p3", 0, "deck/2/fader", 96, 0, -15.0, hs=ok["id"],
               herleitung="Gegenprobe: gültiger Hörschein (Tempo-Rand 0,4975 %)" if gegen else "Gegenprobe: gültiger Hörschein")
    f.gestartet(g, "cypher", 96)
    f.wert(f.S(100), "deck/2/fader", -15.0, 0.01, "regler")
    return f


def i3_ziel_ungehoert(f):
    hs, ok = _i3_grundaufbau(f, None)
    t = f.teil(48, "cypher", "p1", 0, "deck/2/fader", 64, 0, -15.0, hs="h_ok")
    f.gestartet(t, "cypher", 64)
    q = lambda b: b - 16.0
    s1 = f.deck_sprung(72, 2, 80.0, 40.0, quelle="cypher", plan="p1", hs="h_ok")
    ziel1 = q(80.0) + 40.0
    assert ok["quell_von"] <= ziel1 <= ok["quell_bis"] + h.HS_ABSCHNITT_NACHLAUF
    f.gestartet(s1, "cypher", 80, "deck", f"I3d: Ziel {ziel1:g} in [40, 124]")
    q2 = lambda b: b + 24.0
    s2 = f.deck_sprung(84, 2, 88.0, 100.0, quelle="cypher", plan="p1", hs="h_ok")
    ziel2 = q2(88.0) + 100.0
    assert ziel2 > ok["quell_bis"] + h.HS_ABSCHNITT_NACHLAUF
    f.abgelehnt_am_start(s2, "cypher", 88, "ziel_ungehoert", "deck", f"I3d: Ziel {ziel2:g} außerhalb [40, 124]")
    s3 = f.deck_sprung(92, 2, 96.0, 100.0, quelle="cypher", plan="p1", hs="annahme:v1")
    f.gestartet(s3, "cypher", 96, "deck", "I3d: annahme:<vorschlag_id> lässt passieren")
    f.deck_wert(f.S(84), 2, "quell_beat", q2(84.0), 0.01, "deck")
    f.deck_wert(f.S(92), 2, "quell_beat", q2(92.0), 0.01, "deck", "abgelehnter Sprung ändert nichts")
    f.deck_wert(f.S(100), 2, "quell_beat", q2(96.0) + 100.0 + 4.0, 0.01, "deck")
    return f


def hoerschein_rand():
    f = Folge("hoerschein_rand", "hoerschein_rand", ["20", "13", "43"],
              "Start genau bei gueltig_bis_beat → angenommen, einen Beat danach → abgelaufen")
    B = inhalt(MB)
    f.laden(2, 2, MB)
    f.laden(3, 3, MB)
    for d in (2, 3):
        i = f.deck_start(28, d, 32.0, 16.0)
        f.gestartet(i, "andreas", 32, "deck")
    h2 = f.hoerschein(40, "h_r2", "deck/2", B, 64.0, 40.0, 60.0)
    h3 = f.hoerschein(40, "h_r3", "deck/3", B, 64.0, 40.0, 60.0)
    assert h.hs_grund(h2, "deck/2", B, 64.0, 128.0, 48.0) is None
    assert h.hs_grund(h3, "deck/3", B, 65.0, 128.0, 49.0) == "hoerschein_abgelaufen"
    t2 = f.teil(48, "cypher", "p1", 0, "deck/2/fader", 64, 0, -15.0, hs="h_r2", herleitung="beat 64 ≤ gueltig_bis 64")
    t3 = f.teil(48, "cypher", "p2", 0, "deck/3/fader", 65, 0, -15.0, hs="h_r3", herleitung="beat 65 > gueltig_bis 64")
    f.gestartet(t2, "cypher", 64)
    f.abgelehnt_am_start(t3, "cypher", 65, "hoerschein_abgelaufen")
    return f


def crossfader_luecke():
    f = Folge("crossfader_luecke", "crossfader_luecke", ["20", "13", "43"],
              "Fader hinter geschlossenem Crossfader ohne Hörschein aufziehen → abgelehnt (offen zählt ohne Crossfader)")
    f.laden(2, 2, MB)
    i = f.deck_start(28, 2, 32.0, 16.0)
    f.gestartet(i, "andreas", 32, "deck")
    f.hand(f.S(34), "deck/2/xseite", 0.5, "erster Wert nur Stellung")
    f.hand(f.S(35), "deck/2/xseite", 1.0, "FORMAT.md Punkt 22 g: xseite = round(2·midi_roh) → 2 = Seite B")
    f.hand(f.S(36), "xfader", 0.5, "erster Wert nur Stellung")
    f.hand(f.S(37), "xfader", 0.0, "Anschlag unten = −1, nur Seite A (§1.2)")
    f.wert(f.S(40), "deck/2/xseite", 2, 0, "regler", "prüft die Annahme zur Schalter-Abbildung am Ziel")
    f.wert(f.S(40), "xfader", -1.0, 0.001, "regler")
    assert h.offen(0.0, -15.0) and not h.hoerbar(0.0, -15.0, x_gewicht_db=-200.0)
    t = f.teil(48, "cypher", "p1", 0, "deck/2/fader", 64, 0, -15.0, hs="", herleitung="öffnet (offen ohne Crossfader), aber nicht hörbar")
    f.abgelehnt_am_start(t, "cypher", 64, "kein_hoerschein")
    assert not h.offen(0.0, -30.0)
    t2 = f.teil(64, "cypher", "p2", 0, "deck/2/fader", 72, 0, -30.0, hs="", herleitung="Negativ-Kontrolle: −30 ≤ −26 öffnet nicht")
    f.gestartet(t2, "cypher", 72)
    f.wert(f.S(74), "deck/2/fader", -30.0, 0.01, "regler")
    return f


def pad_ungehoert():
    f = Folge("pad_ungehoert", "pad_ungehoert", ["20", "13", "54"],
              "I3b: Schuss auf offenes Pad nur mit Hörschein genau dieses Schusses (Quelle andreas ausgenommen)")
    f.material.add(ME)
    f.hand_auf("pad/1/fader", 4)

    def schuss(sende, ab, nr, pad, quelle="cypher"):
        i = f.nid()
        f.sende(f.S(sende), osc("/k/schuss", i, quelle, float(ab), ME, 1, nr, pad, 0.0, 0), "schuss",
                f"§4.6 Schuss {nr} auf pad/{pad}")
        return i
    a = schuss(56, 64, 1, 1)
    f.abgelehnt_am_start(a, "cypher", 64, "kein_hoerschein", "schuss", "§4.6 I3b: offenes Pad, kein Hörschein")
    f.hoerschein(66, "h_s2", "pad/1", inhalt(ME, schuss=2), 192.0, None, None)
    b = schuss(68, 72, 1, 1)
    f.abgelehnt_am_start(b, "cypher", 72, "kein_hoerschein", "schuss", "§4.6: Hörschein nur für Schuss 2")
    c = schuss(76, 80, 2, 1)
    f.gestartet(c, "cypher", 80, "schuss", "Hörschein mit genau diesem Schuss")
    d = schuss(84, 88, 1, 1, quelle="andreas")
    f.gestartet(d, "andreas", 88, "schuss", "§4.6: Quelle andreas braucht keinen Hörschein")
    e = schuss(92, 96, 1, 2)
    f.gestartet(e, "cypher", 96, "schuss", "Negativ-Kontrolle: geschlossenes Pad 2 = Vorhören")
    return f


def muster_ungehoert():
    f = Folge("muster_ungehoert", "muster_ungehoert", ["20", "13", "54"],
              "I3c: Muster auf offenem Erzeuger-Kanal ohne Hörschein → ungehoert in /erz/quittung")
    for strom, kanal in ((1, "erz/1"), (2, "erz/2")):
        i = f.nid()
        f.sende(f.S(4), osc("/erz/strom", i, "leitstand", strom, f"midi:1:{strom}", kanal), "erzeuger", "§4.8 /erz/strom")
        f.angenommen(i, "leitstand", f.S(4), "erzeuger")
    f.hand_auf("erz/1/fader", 5)

    def fenster(sende_beat, strom, sendung, muster, ungehoert, n=4):
        ab = sende_beat + 4.0   # §3: Fenster [n+1, n+3) bei Takt n
        s = f.S(sende_beat)
        msgs = [osc("/erz/fenster", strom, sendung, 66, 0, float(ab), float(ab + 8), 0)]
        msgs += [osc("/erz/ev", strom, muster, 100 * sendung + k, 36, float(ab + k), 0.25, 1.0) for k in range(n)]
        f.buendel(s, msgs, "erzeuger", "§4.8 Bündel: Fenster [n+1, n+3) Takte, 4 Ereignisse; t_send_us 0 (nur Diagnose)")
        f.erwarte(s + MARGE, osc("/erz/quittung", strom, sendung, 0, 0, None, 0, ungehoert), "erzeuger", ab=s,
                  herleitung=f"§4.8 I3c: {ungehoert} ungehoert (FORMAT.md Punkt 22 h: gezählt beim Einsetzen)")
        if ungehoert:
            f.erlaube(s, s + MARGE, osc("/e/invariante", "hoerschein", None, None, None, None), "invariante",
                      "FORMAT.md Punkt 22 a")

    fenster(52, 1, 1, 7, 4)
    f.hoerschein(60, "h_m7", "erz/1", "muster/7", 192.0, None, None)
    fenster(64, 1, 2, 7, 0)
    fenster(72, 1, 3, 8, 4)
    fenster(72, 2, 1, 9, 0)
    return f


def einstieg(falsch=False):
    name = "einstieg_falsch" if falsch else "einstieg"
    f = Folge(name, "einstieg", ["20", "13", "21", "41"],
              "Vorhören ab Einstieg 64, Plan startet B an S neu am Einstieg → I3a sieht die Quellposition im Hörschein"
              if not falsch else "Fehlerfall: Plan startet B an Quell-Beat 0 statt am Einstieg → hoerschein_anderer_abschnitt")
    B = inhalt(MB)
    f.laden(2, 2, MB)
    v = f.deck_start(12, 2, 16.0, 64.0, quelle="leitstand",
                     herleitung="§10 vorhoeren: Deck startet synchron am Einstieg, hinter dem Fader")
    f.gestartet(v, "leitstand", 16, "deck")
    hs = f.hoerschein(33, "h_e", "deck/2", B, 32.0 + h.HS_GUELTIG_BEATS, 64.0, 80.0)
    quell = 0.0 if falsch else 64.0
    st = f.deck_start(48, 2, 64.0, quell, quelle="cypher", plan="p1", gruppe="b_rein")
    t = f.teil(48, "cypher", "p1", 1, "deck/2/fader", 64, 0, -15.0, gruppe="", hs="h_e")
    f.gestartet(st, "cypher", 64, "deck")
    grund = h.hs_grund(hs, "deck/2", B, 64.0, 128.0, quell_bei_ab=quell)
    if falsch:
        assert grund == "hoerschein_anderer_abschnitt"
        f.abgelehnt_am_start(t, "cypher", 64, grund, herleitung="§17 I3a: Quell-Beat 0 außerhalb [64, 144]")
    else:
        assert grund is None
        f.gestartet(t, "cypher", 64, herleitung="§14.2: Start am Einstieg, Quell-Beat 64 in [64, 144]")
        f.deck_wert(f.S(68), 2, "quell_beat", 68.0, 0.01, "deck", "ab S erklingt genau der gemessene Abschnitt")
    return f


FOLGEN = [sub_doppelt, lambda: sub_doppelt(False), master_leer, lambda: master_leer(False), b_verriegelt_a_laeuft_aus,
          hand_stoppt_a_raus, rueckfall, lambda: rueckfall(True),
          *[(lambda g: (lambda: i3(g)))(g) for g in ("kein_hoerschein", "hoerschein_anderer_kanal",
                                                      "hoerschein_anderer_inhalt", "hoerschein_anderes_tempo",
                                                      "hoerschein_abgelaufen", "hoerschein_anderer_abschnitt",
                                                      "ziel_ungehoert")],
          hoerschein_rand, crossfader_luecke, pad_ungehoert, muster_ungehoert, einstieg, lambda: einstieg(True)]
