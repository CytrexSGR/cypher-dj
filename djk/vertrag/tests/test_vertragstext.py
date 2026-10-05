"""Tests für vertragstext.py (Leser des Vertragstexts): python3 -m pytest djk/vertrag/tests -q"""
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402

TEXT = vertragstext.lies()


def test_zaehlt_69_osc_definitionen_am_text():
    d = vertragstext.osc_definitionen(TEXT)
    assert len(d) == 69
    assert sum(1 for x in d if x.abschnitt == "§4") == 40
    assert sum(1 for x in d if x.abschnitt == "§5") == 27
    assert [x.adresse for x in d if x.abschnitt == "§19.0"] == ["/test/hand", "/test/klick"]


def test_jeder_leseweg_findet_seine_felder():
    d = {x.adresse: x for x in vertragstext.osc_definitionen(TEXT)}
    assert d["/k/teil"].felder[-1] == "hoerschein" and len(d["/k/teil"].felder) == 12   # Feldtabelle
    assert d["/q/stand"].felder == d["/q"].felder                                        # "dieselben Felder wie"
    assert d["/test/hand"].felder == ["pfad", "midi_roh", "sample"]                     # Klammer nach der Adresse
    assert d["/e/taste"].felder == ["name", "wert", "sample", "beat"]                   # Aufzählung unter Überschrift
    assert d["/k/willkommen"].felder[-1] == "kern_version"                              # Doppelpunkt im Fließtext
    assert d["/e/frist"].felder == ["deck", "beats_bis_ende", "beat", "sample"]         # Tabellenzeile mit Semikolon
    assert all(len(x.felder) == len(x.typen) - 1 for x in d.values())                  # jede Feldliste passt


def test_text_ohne_z1_zaehlt_68():
    ohne = "\n".join(z for z in TEXT.split("\n") if "`/test/klick ,hssi`" not in z)
    assert len(vertragstext.osc_definitionen(ohne)) == 68


def test_wertelisten():
    assert vertragstext.politik_codes(TEXT) == {"0": "musik", "1": "zustand", "2": "raster"}
    assert len(vertragstext.status_codes(TEXT)) == 8 and vertragstext.status_codes(TEXT)["8"] == "storniert"
    assert len(vertragstext.gruende(TEXT)) == 42 and "falsche_typen" in vertragstext.gruende(TEXT)
    assert vertragstext.quellen(TEXT)[-1] == "pruefstand"
    assert len(vertragstext.tasten(TEXT)) == 17 and vertragstext.tasten(TEXT)[-1] == "zuruf"


def test_golden_tabelle_und_konfig():
    g = vertragstext.golden_1_3(TEXT)
    assert g["sample(192)"] == (4287104.895, 3) and g["sample(192)_gerundet"] == (4287105.0, 0)
    assert vertragstext.takt_schlag_phrase_1_3(TEXT)[3] == (127.99, 32, 4, 4)
    k = vertragstext.konfig_schluessel(TEXT)
    assert len(k) == 36 and ("kern.toml", "hand_osc", "bool", False) in k and ("werkstatt.toml", "comfy_musik_url", "str", None) in k
