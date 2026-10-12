from wirtwache import Wache


def test_wache_meldet_nur_neue_verbindungen_nicht_den_ausgangsstand_nicht_das_trennen():
    stand = [{"kern:midi_aus_1"}]
    n = []
    w = Wache(lambda: stand[0], lambda: n.append(1), periode=0.0)
    assert w.takt(0.0) is False and n == []          # erste Abfrage: Ausgangsstand
    assert w.takt(1.0) is False and n == []          # unverändert
    stand[0] = set()
    assert w.takt(2.0) is False and n == []          # getrennt: kein Alarm (das Off kommt ja noch, nichts verloren)
    stand[0] = {"kern:midi_aus_1"}
    assert w.takt(3.0) is True and n == [1]          # neu verbunden: Alarm
    assert w.takt(4.0) is False and n == [1]


def test_wache_respektiert_die_periode():
    n, stand = [], [set()]
    w = Wache(lambda: stand[0], lambda: n.append(1), periode=0.5)
    w.takt(0.0)
    stand[0] = {"x"}
    assert w.takt(0.2) is False and n == []          # zu früh
    assert w.takt(0.6) is True and n == [1]


def test_wache_fehler_beendet_nur_die_wache_nicht_den_wirt():
    def kaputt():
        raise OSError("jack weg")
    w = Wache(kaputt, lambda: None, periode=0.0)
    assert w.takt(0.0) is False                      # kein Durchschlagen der Ausnahme
    assert w.fehler == "OSError: jack weg"
    assert w.takt(1.0) is False                      # bleibt aus, fragt nicht erneut
    n = []
    w2 = Wache(lambda: {"a"} if n else set(), lambda: (_ for _ in ()).throw(RuntimeError("panik kaputt")), periode=0.0)
    w2.takt(0.0)
    n.append(1)
    assert w2.takt(1.0) is False and w2.fehler == "RuntimeError: panik kaputt"
