from tonart_energie.camelot import aus_camelot, aus_keyfinder, aus_name, beziehung, zu_camelot


def test_rundreise_alle_24():
    for g in range(12):
        for moll in (True, False):
            assert aus_camelot(zu_camelot(g, moll)) == (g, moll)


def test_ankerpunkte():
    assert zu_camelot(9, True) == "8A"      # A-Moll
    assert zu_camelot(0, False) == "8B"     # C-Dur
    assert zu_camelot(4, True) == "9A"      # E-Moll
    assert aus_name("Eb", "minor") == (3, True) and zu_camelot(3, True) == "2A"


def test_keyfinder_aufzaehlung():
    assert aus_keyfinder(0) == (9, False)   # A_MAJOR
    assert aus_keyfinder(11) == (2, True)   # D_MINOR
    assert aus_keyfinder(23) == (8, True)   # A_FLAT_MINOR
    assert aus_keyfinder(24) is None        # SILENCE


def test_ungueltig():
    assert aus_camelot("Amin") is None and aus_camelot("13A") is None and aus_camelot("") is None


def test_beziehung():
    assert beziehung("8A", "8A") == "gleich"
    assert beziehung("9A", "8A") == "quinte" and beziehung("12A", "1A") == "quinte"
    assert beziehung("8B", "8A") == "parallel"
    assert beziehung("5B", "8A") == "falsch"
    assert beziehung("11B", "8A") == "gleichnamig"   # A-Dur zu A-Moll
