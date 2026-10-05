"""Lädt die JSON-Schemas aus djk/vertrag/schemas/ mit Querverweisen (Draft 2020-12, referencing-Registry).

Dazu, nur gelesen, das Folgen-Schema von Scheibe 02 (djk/vertrag/folge.schema.json), damit die Beispiele aus §19.0
gegen dieselbe Datei geprüft werden, die auch pruefe_folgen.py benutzt.

Gebrauch:  from schema_lader import validator
           validator("plan.schema.json").validate(obj)
           validator("mcp.schema.json#/$defs/waehle_eingabe").iter_errors(obj)
"""
import json
import pathlib

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

HIER = pathlib.Path(__file__).resolve().parent
ORDNER = HIER / "schemas"
FREMD = {"folge.schema.json": HIER / "folge.schema.json"}   # Scheibe 02


def alle_schemas():
    """Die Schemas dieser Scheibe (schemas/*.schema.json), Name -> Objekt."""
    return {p.name: json.loads(p.read_text(encoding="utf-8")) for p in sorted(ORDNER.glob("*.schema.json"))}


def _alle():
    return {**alle_schemas(), **{n: json.loads(p.read_text(encoding="utf-8")) for n, p in FREMD.items()}}


def registry():
    return Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in _alle().values())


def validator(ref, reg=None):
    datei, _, zeiger = ref.partition("#")
    ziel = _alle()[datei]["$id"] + (f"#{zeiger}" if zeiger else "")
    return Draft202012Validator({"$ref": ziel}, registry=reg or registry())


def teilschema(ref):
    """Das Schema-Objekt hinter einer Referenz 'datei.schema.json#/pfad' (ohne Auflösung weiterer $ref)."""
    datei, _, zeiger = ref.partition("#")
    obj = _alle()[datei]
    for teil in [t for t in zeiger.split("/") if t]:
        obj = obj[teil.replace("~1", "/").replace("~0", "~")]
    return obj
