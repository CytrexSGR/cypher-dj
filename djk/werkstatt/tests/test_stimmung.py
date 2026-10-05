from werkstatt.stimmung import entscheide, kreis_abstand, kreis_mittel


def test_kreis():
    assert round(kreis_abstand(-39.76, 64.0), 2) == -3.76     # Essentia meldet -36 ct als +64 ct
    assert round(kreis_mittel(-39.76, 64.0), 2) == -37.88
    assert kreis_abstand(10.0, -10.0) == 20.0


def test_einig_und_nah_wird_korrigiert():
    d = entscheide(-19.75, 0.999, -20.0)
    assert d["grund"] == "korrigiert" and d["korrektur_cent"] == 19.9 and d["warnung"] is None


def test_uneinig_warnt():
    d = entscheide(-1.0, 0.158, -23.0)
    assert d["grund"] == "uneinig" and d["korrektur_cent"] == 0.0 and "uneinig" in d["warnung"]


def test_zu_weit_warnt():
    d = entscheide(-39.76, 0.999, 64.0)
    assert d["grund"] == "zu_weit" and d["korrektur_cent"] == 0.0


def test_schwache_richtung_warnt():
    d = entscheide(-5.7, 0.012, 30.0)
    assert d["grund"] == "r_klein" and d["korrektur_cent"] == 0.0


def test_grenzen_genau():
    assert entscheide(-5.0, 0.5, 5.0)["grund"] == "korrigiert"          # Abstand genau 10: einig
    assert entscheide(-5.0, 0.5, 5.2)["grund"] == "uneinig"
    assert entscheide(-35.0, 0.5, -35.0)["grund"] == "zu_weit"          # 35 ist nicht unter 35
