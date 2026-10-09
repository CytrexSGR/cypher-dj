"""Tests für vertragstext.py (Leser des Vertragstexts): python3 -m pytest djk/vertrag/tests -q"""
import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402

TEXT = vertragstext.lies()
# osc.json wird von Hand gepflegt (eigene Quelle, nicht aus dem Text erzeugt): die erwarteten Zählungen kommen von dort.
OSC = json.loads((HIER / "osc.json").read_text(encoding="utf-8"))["adressen"]
SCHEMA = json.loads((HIER / "konfig.schema.json").read_text(encoding="utf-8"))


def im_abschnitt(haupt):
    """Adressen aus osc.json, deren Abschnitt zu §<haupt> gehört (osc.json schreibt "4.4", der Text "§4")."""
    return [e["adresse"] for e in OSC if e["abschnitt"].split(".")[0] == haupt]


def test_zaehlt_osc_definitionen_am_text_wie_osc_json():
    d = vertragstext.osc_definitionen(TEXT)
    assert len(OSC) > 0 and len(d) == len(OSC)
    assert sorted(x.adresse for x in d if x.abschnitt == "§4") == sorted(im_abschnitt("4"))
    assert sorted(x.adresse for x in d if x.abschnitt == "§5") == sorted(im_abschnitt("5"))
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


def test_text_ohne_z1_zaehlt_eine_weniger():
    ohne = "\n".join(z for z in TEXT.split("\n") if "`/test/klick ,hssi`" not in z)
    assert len(vertragstext.osc_definitionen(ohne)) == len(OSC) - 1


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
    n_schema = sum(1 for teil in SCHEMA["$defs"].values() for s in teil["properties"] if s != "version")
    assert len(k) == n_schema and ("kern.toml", "hand_osc", "bool", False) in k and ("werkstatt.toml", "comfy_musik_url", "str", None) in k
