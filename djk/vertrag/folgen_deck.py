"""Golden-Folgen der Deck-Grammatik (Scheiben 31, 38) und für Kern-Attrappe (13) und Kern."""
import herleitung as h
from folgen_bau import ABGELEHNT, MA, MARGE, MC, MD, MFEHLT, SPUR, VERSP_AUSGEFUEHRT, Folge


def laden():
    f = Folge("laden", "laden", ["31", "13"], "Laden: Trim aus Lautheit (§1.5), Fader −200, Ablehnungen")
    f.laden(2, 1, MC)
    f.wert(f.S(6), "deck/1/trim", h.trim_beim_laden(-16.0, -9.4), 0.01, "deck", "§1.5: −16 − (−9,4) = −6,6 dB")
    f.wert(f.S(6), "deck/1/fader", -200.0, 0.0, "deck", "§1.5: nach Laden immer −200")
    f.deck_wert(f.S(6), 1, "status", 1, 0, "deck", "§5.5 Status 1 geladen")
    f.laden(8, 2, MD)
    f.wert(f.S(12), "deck/2/trim", h.trim_beim_laden(-16.0, -45.0), 0.0, "deck", "§1.5: +29 auf +24 begrenzt")
    f.laden(14, 3, MFEHLT, ergebnis="abgelehnt", grund="material_fehlt")
    f.material.discard(MFEHLT)
    f.laden(16, 4, MC, mit_stems=1, ergebnis="abgelehnt", grund="pruefung")
    f.hand_auf("deck/1/fader", 20)
    assert h.offen(h.trim_beim_laden(-16.0, -9.4), 0.0)
    # §4.4 (2026-09-27): gesperrt nur laufend UND offen (Andreas am Digital-Out: „neuen track laden geht nicht über
    # load a“). Erst laufend und offen → abgelehnt, dann gestoppt (Fader bleibt offen) → lädt, Fader danach −200.
    i = f.deck_start(21, 1, 24.0, 0.0)
    f.gestartet(i, "andreas", 24, "deck")
    f.laden(26, 1, MC, ergebnis="abgelehnt", grund="deck_hoerbar")
    j = f.deck_stopp(27, 1, 28.0)
    f.gestartet(j, "andreas", 28, "deck")
    f.laden(30, 1, MC)
    f.wert(f.S(32), "deck/1/fader", -200.0, 0.0, "deck", "§1.5: nach Laden −200, auch aus offenem Fader")
    return f


def start_quell_beat():
    f = Folge("start_quell_beat", "start_quell_beat", ["31", "13"], "bei ab_beat erklingt genau quell_beat")
    f.laden(2, 1, MA)
    i = f.deck_start(28, 1, 32.0, 16.5)
    f.gestartet(i, "andreas", 32, "deck")
    f.deck_wert(f.S(32), 1, "quell_beat", 16.5, 0.01)
    f.deck_wert(f.S(40), 1, "quell_beat", 24.5, 0.01, herleitung="Faktor 1 (bpm = basis_bpm)")
    f.deck_wert(f.S(40), 1, "status", 2, 0)
    j = f.deck_start(44, 1, 48.0, 100.25, herleitung="Start auf laufendem Deck: 128-Frame-Blende")
    f.gestartet(j, "andreas", 48, "deck")
    f.deck_wert(f.S(52), 1, "quell_beat", 104.25, 0.01)
    k = f.deck_start(52, 3, 56.0, 0.0, angenommen=False, herleitung="Deck 3 ist leer")
    f.q(k, "andreas", ABGELEHNT, None, None, "nicht_geladen", f.S(56) + MARGE, ab=f.S(52), bereich="deck",
        herleitung="§16.2 nicht_geladen; beim Einsortieren oder am Start, das Fenster deckt beides")
    return f


def loop():
    f = Folge("loop", "loop", ["38", "13"], "Loop ab der Quellposition bei ab_beat (Band), aus mit laenge 0")
    f.laden(2, 1, MA)
    i = f.deck_start(12, 1, 16.0, 0.0)
    f.gestartet(i, "andreas", 16, "deck")
    lp = f.deck_loop(36, 1, 40.0, 4.0)
    f.gestartet(lp, "andreas", 40, "deck")
    q0 = 40.0 - 16.0
    f.deck_wert(f.S(50), 1, "quell_beat", h.loop_position(q0, 4.0, 50.0 - 16.0), 0.01)
    f.deck_wert(f.S(50), 1, "status", 3, 0, herleitung="§5.5 Status 3 Loop")
    aus = f.deck_loop(49, 1, 53.0, 0.0, herleitung="laenge 0 = Loop aus")
    f.gestartet(aus, "andreas", 53, "deck")
    pos = h.loop_position(q0, 4.0, 53.0 - 16.0)
    f.deck_wert(f.S(56), 1, "quell_beat", pos + 3.0, 0.01, herleitung="läuft von der Loop-Position weiter")
    f.deck_wert(f.S(56), 1, "status", 2, 0)
    return f


def roll():
    f = Folge("roll", "roll", ["38", "13"], "Band-Roll mit Schatten: beim Aus zurück zur Schattenposition")
    f.laden(2, 1, MA)
    i = f.deck_start(12, 1, 16.0, 0.0)
    f.gestartet(i, "andreas", 16, "deck")
    r = f.deck_roll(36, 1, 40.0, 1.0)
    f.gestartet(r, "andreas", 40, "deck")
    f.deck_wert(f.S(42.5), 1, "quell_beat", h.loop_position(24.0, 1.0, 42.5 - 16.0), 0.01)
    f.deck_wert(f.S(42.5), 1, "status", 4, 0, herleitung="§5.5 Status 4 Roll")
    aus = f.deck_roll(40, 1, 44.0, 0.0)
    f.gestartet(aus, "andreas", 44, "deck")
    f.deck_wert(f.S(46), 1, "quell_beat", 46.0 - 16.0, 0.01, herleitung="Schatten lief weiter: Position ohne Roll")
    f.deck_wert(f.S(46), 1, "status", 2, 0)
    return f


def sprung():
    f = Folge("sprung", "sprung", ["38", "13"], "Beatjump; im aktiven Loop verschiebt er den Loop")
    f.laden(2, 1, MA)
    i = f.deck_start(12, 1, 16.0, 0.0)
    f.gestartet(i, "andreas", 16, "deck")
    s = f.deck_sprung(36, 1, 40.0, 8.0)
    f.gestartet(s, "andreas", 40, "deck")
    f.deck_wert(f.S(44), 1, "quell_beat", 44.0 - 16.0 + 8.0, 0.01)
    lp = f.deck_loop(56, 1, 60.0, 4.0)
    f.gestartet(lp, "andreas", 60, "deck")
    q_loop = 60.0 - 16.0 + 8.0
    s2 = f.deck_sprung(62, 1, 66.0, 4.0, herleitung="§4.4: im aktiven Loop verschiebt der Sprung den Loop")
    f.gestartet(s2, "andreas", 66, "deck")
    pos66 = h.loop_position(q_loop, 4.0, 66.0 - 16.0 + 8.0) + 4.0
    neu = q_loop + 4.0
    for b in (67.0, 69.0):
        f.deck_wert(f.S(b), 1, "quell_beat", h.loop_position(neu, 4.0, pos66 + (b - 66.0)), 0.01,
                    herleitung=f"Loop [{neu:g}, {neu + 4:g}) nach dem Sprung")
    f.deck_wert(f.S(69), 1, "status", 3, 0)
    return f


def hotcue_phase():
    f = Folge("hotcue_phase", "hotcue_phase", ["38", "13", "35"],
              "phasentreu: p = 37,30, hc = 64,00 → 64,30 (Vertrag); dazu Phase 0,60 (Sprung nach vorn) und 0,45")
    f.laden(2, 1, MA)
    i = f.deck_start(12, 1, 16.0, 0.0)
    f.gestartet(i, "andreas", 16, "deck")
    f.hotcue_setzen(20, 1, 1, 64.0, MA)
    anker_s, anker_frame = f.S(16), 0          # Quell-Frame ab erster_schlag_frame = 0 der Fixture
    for ab in (53.3, 60.6, 68.45):
        frame = anker_frame + (f.S(ab) - anker_s)
        p = frame / SPUR
        ziel = h.hotcue_ziel(p, 64.0)
        hc = f.deck_hotcue(ab - 4, 1, ab, 1)
        f.gestartet(hc, "andreas", ab, "deck")
        f.deck_wert(f.S(ab + 1.0), 1, "quell_beat", ziel + 1.0, 0.01,
                    herleitung=f"§4.4: 64 + wrap(phase({p:.2f}) − 0) = {ziel:.2f}")
        anker_s, anker_frame = f.S(ab), h.llround(ziel * SPUR)
    return f


def politik_raster():
    f = Folge("politik_raster", "politik_raster", ["38", "13", "35"],
              "Politik 2 zu spät → nächster Rasterpunkt der Größe raster_beats")
    f.laden(2, 1, MA)
    i = f.deck_start(12, 1, 16.0, 0.0)
    f.gestartet(i, "andreas", 16, "deck")
    ankunft = 41.3
    ziel = h.naechster_rasterpunkt(ankunft, 1.0)
    lp = f.deck_loop(ankunft, 1, 40.0, 4.0, politik=2, raster=1.0, angenommen=False)
    f.q(lp, "andreas", VERSP_AUSGEFUEHRT, f.S(ziel), ziel, None, f.S(ziel) + MARGE, ab=f.S(ankunft), bereich="deck",
        herleitung=f"§16.1 Politik 2: nächster erreichbarer Rasterpunkt nach {ankunft} bei Raster 1 = {ziel:g}; "
                   "Grund frei (FORMAT.md Punkt 22 i)")
    q0 = ziel - 16.0
    f.deck_wert(f.S(45), 1, "quell_beat", h.loop_position(q0, 4.0, 45.0 - 16.0), 0.01)
    ankunft2 = 46.1
    ziel2 = h.naechster_rasterpunkt(ankunft2, 4.0)
    aus = f.deck_loop(ankunft2, 1, 44.0, 0.0, politik=2, raster=4.0, angenommen=False)
    f.q(aus, "andreas", VERSP_AUSGEFUEHRT, f.S(ziel2), ziel2, None, f.S(ziel2) + MARGE, ab=f.S(ankunft2),
        bereich="deck", herleitung=f"Raster 4: nächster Punkt nach {ankunft2} = {ziel2:g}")
    pos = h.loop_position(q0, 4.0, ziel2 - 16.0)
    assert pos != q0, "Ausschalten fiele auf die Naht"
    f.deck_wert(f.S(50), 1, "quell_beat", pos + (50.0 - ziel2), 0.01)
    s = f.deck_sprung(52, 1, 56.0, 4.0, politik=2, raster=1.0, herleitung="Negativ-Kontrolle: rechtzeitig, kein Versatz")
    f.gestartet(s, "andreas", 56, "deck")
    f.deck_wert(f.S(58), 1, "quell_beat", pos + (56.0 - ziel2) + 4.0 + 2.0, 0.01)
    return f


FOLGEN = [laden, start_quell_beat, loop, roll, sprung, hotcue_phase, politik_raster]
