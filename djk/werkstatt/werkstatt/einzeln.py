"""Eine einzelne Datei in den Bestand einlesen (Mediathek-Anbindung T1).

Aufruf (aus djk/werkstatt):
  nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.einzeln --quelle DATEI [--titel T] [--bestand DIR] [--nur-analyse]
Vorgabe fuer --bestand: $CYPHERDJ_BESTAND, sonst ~/cypher-dj/bestand.
--nur-analyse (Paket 1.13 Warp S3a): nur die Analyse in die Ablage (--bestand = Ablage), Status analysiert; keine Kopie,
keine Fassung; Arbeitsordner a-<mid>.
stdout: am Ende GENAU EINE JSON-Zeile {"status": "neu"|"vorhanden"|"analysiert"|"fehler", "material_id": "<16 hex>"|"",
"grund": "..."} (grund nur bei fehler). Alles andere, auch Ausgaben von Bibliotheken und Kindprozessen, geht auf
stderr. Endcode 0 bei neu/vorhanden/analysiert, 1 bei fehler. Gründe: format, datei_fehlt, sonst '<Ausnahmetyp>: <Kurztext>'.
Keine Sperre: zwei gleichzeitige Laeufe fuer dieselbe Datei zerstoeren sich (.arbeit/e-<mid>); die Seite startet
je material_id hoechstens einen."""
import argparse
import json
import os
import sys
from pathlib import Path

from . import fortschritt
from .bestand import sha256_datei, standard_ablage, standard_bestand
from .kette import einlesen
from .lauf_bestand import ENDUNGEN

BASIS_BPM = 128.0
FAEDEN = 8      # torch-Fäden für beat_this; Logits gemessen bitgleich für 4, 8 und 16 (messungen/2026-10-17-werkstatt-tempo)


def main_bestand(arg):
    return Path(arg) if arg else standard_bestand()


def _kurz(ex):
    text = " ".join(str(ex).split())[:160]
    return f"{type(ex).__name__}: {text}" if text else type(ex).__name__


def _lauf(quelle, bestand, titel, nur_analyse=False):
    quelle = Path(quelle)
    if quelle.suffix.lower() not in ENDUNGEN:
        return {"status": "fehler", "material_id": "", "grund": "format"}
    if not quelle.is_file():
        return {"status": "fehler", "material_id": "", "grund": "datei_fehlt"}
    try:
        import torch
        torch.set_num_threads(FAEDEN)
        if nur_analyse:   # Ablage statt Bestand, nichts rendern, eigener Arbeitsordner (der Nachtlauf nutzt e-<mid> derselben Ablage)
            e = einlesen(quelle, bestand, basis_bpm=BASIS_BPM, titel=titel, melde=fortschritt.melder(), vorab=None, nur_analyse=True,
                         auftrag_id="a-" + sha256_datei(quelle)[:16])
        else:
            e = einlesen(quelle, bestand, basis_bpm=BASIS_BPM, titel=titel, melde=fortschritt.melder(),
                         vorab=standard_ablage(), nur_analyse=False, auftrag_id=None)   # liegt die Nachtanalyse vor, wird nur noch gerendert
        return {"status": e["status"], "material_id": e["material_id"]}
    except Exception as ex:
        print(f"einzeln: {_kurz(ex)}", file=sys.stderr)
        return {"status": "fehler", "material_id": "", "grund": _kurz(ex)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--quelle", required=True)
    ap.add_argument("--titel", default=None)
    ap.add_argument("--bestand", default=None)
    ap.add_argument("--nur-analyse", action="store_true")
    a = ap.parse_args(argv)
    bestand = main_bestand(a.bestand)
    sys.stdout.flush()
    echt = os.dup(1)                      # stdout gehoert allein der Ergebniszeile
    os.dup2(2, 1)
    try:
        erg = _lauf(a.quelle, bestand, a.titel, a.nur_analyse)
    finally:
        sys.stdout.flush()
        os.dup2(echt, 1)
        os.close(echt)
    sys.stdout.write(json.dumps(erg, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0 if erg["status"] in ("neu", "vorhanden", "analysiert") else 1


if __name__ == "__main__":
    sys.exit(main())
