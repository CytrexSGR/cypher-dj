"""Fortschrittsmeldungen der Werkstatt (Anzeige PREPARING auf der Seite).

Je Meldung EINE Zeile auf stderr: `@@fortschritt {"stufe": 2, "von": 5, "name": "beats", "prozent": null, "teil": "tracking"}`.
Gemeldet wird nur, was die Kette wirklich tut: jede Stufe beim Eintritt, `teil` bei Zwischenschritten, `prozent` nur
dort, wo ein Werkzeug selbst Prozente liefert (rubberband beim Rendern). Keine Schaetzung, keine Zeitanimation.
stdout bleibt allein der Ergebniszeile von einzeln.py.
Lebenszeichen langer Stufen (Essentia haelt den GIL) misst der Server von aussen (CPU-Zeit des Prozessbaums aus /proc), nicht diese Datei."""
import json
import sys

PRAEFIX = "@@fortschritt "
STUFEN = ("decode", "beats", "key", "render", "save")


def melder(ziel=None):
    """Rueckgabe: melde(name, prozent=None, teil=None). `ziel` (Vorgabe sys.stderr zum Zeitpunkt des Aufrufs)."""
    def melde(name, prozent=None, teil=None):
        if name not in STUFEN:
            raise ValueError(f"unbekannte Stufe {name!r}")
        z = {"stufe": STUFEN.index(name) + 1, "von": len(STUFEN), "name": name,
             "prozent": None if prozent is None else round(float(prozent), 1), "teil": teil}
        out = ziel if ziel is not None else sys.stderr
        out.write(PRAEFIX + json.dumps(z, ensure_ascii=False) + "\n")
        out.flush()
    return melde


def lies_zeile(zeile):
    """Eine stderr-Zeile -> Meldung (dict) oder None, wenn sie keine Fortschrittszeile ist."""
    if not zeile.startswith(PRAEFIX):
        return None
    try:
        z = json.loads(zeile[len(PRAEFIX):])
    except ValueError:
        return None
    return z if isinstance(z, dict) and "name" in z else None
