from tonart_energie.pruefung_referenz import bericht


def test_bericht_dur_felder():
    meta = [{"mik": "8B", "ordner": "a"}, {"mik": "8B", "ordner": "a"},
            {"mik": "5A", "ordner": "a"}, {"mik": "5A", "ordner": "b"}]
    b = bericht(["8B", "5A", "5A", "5A"], meta)
    assert b["GESAMT"]["dur_n"] == 2 and b["GESAMT"]["dur_exakt"] == 0.5
    assert b["GESAMT"]["vorhersage_dur"] == 1
    assert b["b"]["dur_n"] == 0 and b["b"]["dur_exakt"] is None and b["b"]["vorhersage_dur"] == 0
