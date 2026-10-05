"""Schema-Pruefung gegen den Vertrag als Code (`djk/vertrag/schemas/`, Scheibe 09; Draft 2020-12, Querverweise
ueber `$id`). Die Werkstatt schreibt keine JSON-Datei in den Bestand, die hier nicht besteht."""
import json
import os
from pathlib import Path

import numpy as np
from jsonschema import Draft202012Validator
from referencing import Registry, Resource


def schema_ordner():
    basis = os.environ.get("CYPHERDJ_VERTRAG", str(Path.home() / "cypher-dj" / "djk" / "vertrag"))
    return Path(basis) / "schemas"


_cache = {}


def _laden():
    ordner = schema_ordner()
    if ordner not in _cache:
        schemas = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in sorted(ordner.glob("*.schema.json"))}
        if not schemas:
            raise FileNotFoundError(f"keine Schemas unter {ordner}")
        reg = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in schemas.values())
        _cache[ordner] = (schemas, reg)
    return _cache[ordner]


def sauber(obj):
    """numpy-Zahlen zu Python-Zahlen, fuer json und jsonschema."""
    if isinstance(obj, dict):
        return {str(k): sauber(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sauber(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def fehler(datei, obj):
    """Liste der Verstoesse (leer = gueltig). datei z. B. 'fassung.schema.json'. Geprueft wird die Form, die
    json.dump schreibt (numpy-Zahlen als Python-Zahlen, `sauber`)."""
    schemas, reg = _laden()
    v = Draft202012Validator(schemas[datei], registry=reg)
    return [f"{'/'.join(map(str, e.absolute_path)) or '(wurzel)'}: {e.message}" for e in v.iter_errors(sauber(obj))]


def pruefe(datei, obj):
    f = fehler(datei, obj)
    if f:
        raise ValueError(f"{datei}: {len(f)} Verstoesse: " + "; ".join(f[:5]))
