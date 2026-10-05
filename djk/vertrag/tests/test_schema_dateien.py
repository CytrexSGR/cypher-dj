"""Die Schema-Dateien (SCHNITTSTELLEN §19.0: §6.2, §6.5, §9 bis §15): vollständig, gültiges Draft 2020-12, jede $ref
auflösbar. Die Prüfung gegen die Beispiele im Vertragstext macht pruefe_schemas.py (tests/test_schemas.py)."""
import pathlib
import sys

from jsonschema import Draft202012Validator
from referencing.exceptions import Unresolvable

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import schema_lader as sl  # noqa: E402
import vertragstext  # noqa: E402  (Scheibe 02)

ERWARTET = ["aufnahme", "auftrag", "auftrag_status", "baender", "defs", "fassung", "hoerschein", "journal_zeile",
            "kandidat", "kiste", "korrektur", "material", "material_fertig", "mcp", "passung", "plan", "rechner",
            "spielart", "takt_bericht", "takt_zustand", "urteil", "vorschlag", "wahl", "ws_daten", "ws_nachricht",
            "ws_umschlag"]


def _refs(o):
    if isinstance(o, dict):
        for k, w in o.items():
            if k == "$ref" and isinstance(w, str):
                yield w
            else:
                yield from _refs(w)
    elif isinstance(o, list):
        for w in o:
            yield from _refs(w)


def unaufloesbar(schemas, reg):
    """[(datei, ref)] jeder $ref, die sich nicht auflösen lässt."""
    fehler = []
    for name, s in schemas.items():
        r = reg.resolver(base_uri=s["$id"])
        for ref in _refs(s):
            try:
                r.lookup(ref)
            except Unresolvable:
                fehler.append((name, ref))
    return fehler


def test_alle_schema_dateien_da():
    assert sorted(n.removesuffix(".schema.json") for n in sl.alle_schemas()) == ERWARTET


def test_metaschema_und_ids():
    for name, s in sl.alle_schemas().items():
        Draft202012Validator.check_schema(s)
        assert s["$id"] == f"https://cypherdj.invalid/vertrag/1/{name}", name


def test_jede_referenz_loest_auf():
    assert unaufloesbar(sl.alle_schemas(), sl.registry()) == []


def test_kaputte_referenz_faellt_auf():
    s = dict(sl.alle_schemas())
    s["wahl.schema.json"] = dict(s["wahl.schema.json"], properties={"deck": {"$ref": "defs.schema.json#/$defs/gibt_es_nicht"}})
    assert unaufloesbar({"wahl.schema.json": s["wahl.schema.json"]}, sl.registry()) == [
        ("wahl.schema.json", "defs.schema.json#/$defs/gibt_es_nicht")]


def test_gruende_wie_16_2_plus_neustart():
    """defs.schema.json: die Codes aus §16.2 am Text gelesen (seit 2026-09-25 mit neustart und grenze_sub; das
    „| {"neustart"}" bleibt für den Fall, dass er dort wieder fehlt)."""
    enum = sl.alle_schemas()["defs.schema.json"]["$defs"]["grund"]["enum"]
    assert len(enum) == len(set(enum)) == 42
    assert set(enum) == set(vertragstext.gruende(vertragstext.lies())) | {"neustart"}
