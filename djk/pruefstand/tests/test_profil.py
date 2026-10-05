"""Profile: Vorgaben, Fehler mit Schlüsselnamen, und alle Profile im Ordner profile/ laden fehlerfrei."""
from pathlib import Path

import pytest

import profil

MIN = {"name": "t", "zweck": "Test.", "quelle": {"art": "pruefquelle"}}


def test_vorgaben():
    p = profil.pruefe(MIN)
    assert p["instanz"] == "f" and p["quantum"] == 256 and p["notbahn"] == {"an": True, "programm": "notbahn/build/cypherdj-notbahn", "kante": True}
    assert p["quelle"]["programm"] == "pruefstand/build/cypherdj-pruefquelle"


@pytest.mark.parametrize("aenderung, schluessel", [
    ({"tempo": 1}, "tempo"),
    ({"quelle": {"art": "pruefquelle", "farbe": 1}}, "farbe"),
    ({"erwartung": {"stille_max": 0}}, "stille_max"),
    ({"quelle": {"art": "radio"}}, "quelle.art"),
    ({"instanz": ""}, "instanz"),
    ({"name": "Gross"}, "name"),
    ({"quelle": {"art": "pruefquelle_direkt"}}, "notbahn.an"),
    ({"eingriff": [{"nach_s": 5, "art": "kill9", "ziel": "leitstand"}]}, "ziel"),
    ({"eingriff": [{"nach_s": 99, "art": "kill9", "ziel": "quelle"}]}, "nach_s"),
    ({"eingriff": [{"nach_s": 5, "art": "sigstop", "ziel": "quelle"}]}, "halten_s"),
    ({"kern": {"test_last_alle": 500, "test_last_perioden": 1.5}}, "test_last"),
    ({"notbahn": {"blende": 0}}, "blende"),                        # die Notbahn daneben hat keine Blende mehr
    ({"quelle": {"art": "kern", "eigenschaften": ["kaputt"]}}, "eigenschaften"),
])
def test_fehler_nennt_schluessel(aenderung, schluessel):
    p = dict(MIN)
    p.update(aenderung)
    with pytest.raises(profil.ProfilFehler, match=schluessel):
        profil.pruefe(p)


def test_ziel_unit_und_pid_erlaubt():
    p = dict(MIN, eingriff=[{"nach_s": 5, "art": "kill9", "ziel": "unit:cypherdj-leitstand-f"},
                            {"nach_s": 6, "art": "sigstop", "ziel": "pid:1234", "halten_s": 1.0}])
    assert len(profil.pruefe(p)["eingriff"]) == 2


def test_alle_profile_laden():
    ordner = Path(__file__).resolve().parent.parent / "profile"
    dateien = sorted(ordner.glob("*.toml"))
    assert dateien, "keine Profile gefunden"
    for d in dateien:
        p = profil.lade(d)
        assert p["name"] == d.stem, f"{d.name}: name muss dem Dateinamen gleichen"


def test_kurz_kuerzt_und_benennt(tmp_path):
    d = tmp_path / "x.toml"
    d.write_text('name = "kill-kern"\nzweck = "T."\ndauer_s = 32.0\n[quelle]\nart = "kern"\n'
                 '[[eingriff]]\nnach_s = 10.0\nart = "kill9"\nziel = "quelle"\n'
                 '[[eingriff]]\nnach_s = 25.0\nart = "kill9"\nziel = "quelle"\n')
    p = profil.lade(d, kurz_s=20)
    assert p["name"] == "kill-kern-kurz" and p["dauer_s"] == 20.0 and [e["nach_s"] for e in p["eingriff"]] == [10.0]
