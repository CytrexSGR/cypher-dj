"""Eine einzelne Datei in den Bestand einlesen (Mediathek-Anbindung T1).

Aufruf (aus djk/werkstatt):
  nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.einzeln --quelle DATEI [--titel T] [--bestand DIR]
Vorgabe fuer --bestand: $CYPHERDJ_BESTAND, sonst ~/cypher-dj/bestand.
stdout: am Ende GENAU EINE JSON-Zeile {"status": "neu"|"vorhanden"|"fehler", "material_id": "<16 hex>"|"",
"grund": "..."} (grund nur bei fehler). Alles andere, auch Ausgaben von Bibliotheken und Kindprozessen, geht auf
stderr. Endcode 0 bei neu/vorhanden, 1 bei fehler. Gründe: format, datei_fehlt, sonst '<Ausnahmetyp>: <Kurztext>'.
Keine Sperre: zwei gleichzeitige Laeufe fuer dieselbe Datei zerstoeren sich (.arbeit/e-<mid>); die Seite startet
je material_id hoechstens einen."""
import argparse
import json
import os
import sys
from pathlib import Path

from .bestand import standard_bestand
from .kette import einlesen
from .lauf_bestand import ENDUNGEN

BASIS_BPM = 128.0
FAEDEN = 4


def main_bestand(arg):
    return Path(arg) if arg else standard_bestand()


def _kurz(ex):
    text = " ".join(str(ex).split())[:160]
    return f"{type(ex).__name__}: {text}" if text else type(ex).__name__


def _lauf(quelle, bestand, titel):
    quelle = Path(quelle)
    if quelle.suffix.lower() not in ENDUNGEN:
        return {"status": "fehler", "material_id": "", "grund": "format"}
    if not quelle.is_file():
        return {"status": "fehler", "material_id": "", "grund": "datei_fehlt"}
    try:
        import torch
        torch.set_num_threads(FAEDEN)
        e = einlesen(quelle, bestand, basis_bpm=BASIS_BPM, titel=titel)
        return {"status": e["status"], "material_id": e["material_id"]}
    except Exception as ex:
        print(f"einzeln: {_kurz(ex)}", file=sys.stderr)
        return {"status": "fehler", "material_id": "", "grund": _kurz(ex)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--quelle", required=True)
    ap.add_argument("--titel", default=None)
    ap.add_argument("--bestand", default=None)
    a = ap.parse_args(argv)
    bestand = main_bestand(a.bestand)
    sys.stdout.flush()
    echt = os.dup(1)                      # stdout gehoert allein der Ergebniszeile
    os.dup2(2, 1)
    try:
        erg = _lauf(a.quelle, bestand, a.titel)
    finally:
        sys.stdout.flush()
        os.dup2(echt, 1)
        os.close(echt)
    sys.stdout.write(json.dumps(erg, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0 if erg["status"] in ("neu", "vorhanden") else 1


if __name__ == "__main__":
    sys.exit(main())
