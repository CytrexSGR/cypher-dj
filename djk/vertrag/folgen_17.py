"""Golden-Folge für Scheibe 17 (Rechner): Wahl §14.2 hinein, Teile §14.1 heraus, hergeleitet aus der Regel §14.4."""
import json
import pathlib

import herleitung as h
import vertragstext
from folgen_bau import Folge

HIER = pathlib.Path(__file__).resolve().parent


def expandiere_sicher():
    plan, wahl = h.plan_und_wahl(vertragstext.lies())
    teile = h.expandiere(wahl, 1)
    if teile != plan["teile"]:
        raise SystemExit("WIDERSPRUCH: die Regel §14.4 ergibt andere Teile als das Beispiel §14.1")
    f = Folge("expandiere_sicher", "expandiere_sicher", ["17", "29", "41"],
              "Rechner: Wahl §14.2 hinein, genau die Teile aus §14.1 heraus (hergeleitet aus der Regel §14.4)",
              zeitachse=False)
    lage = json.loads((HIER / "beispiele" / "kuratiert.json").read_text(encoding="utf-8"))["takt_zustand"]
    lage.update(takt=105, phrase=14, beat=416.0)
    lage["decks"][0].update(quell_beat=402.0, beats_bis_ende=96.0, ende_takt=129, struktur_jetzt="outro")
    lage["fristen"] = [{"deck": 1, "ende_takt": 129, "rest_takte": 24}]
    f.rechner_frage({"id": 1, "methode": "expandiere", "parameter": {"wahl": wahl, "lage": lage}},
                    "§11 expandiere mit der Wahl aus §14.2 (wörtlich aus dem Vertragstext gelesen), Deck A = 1 läuft")
    erwartet = {k: plan[k] for k in ("quelle", "spielart", "wahl_id", "einstieg_quell_beat", "hoerscheine")}
    erwartet["teile"] = teile
    f.rechner_antwort({"id": 1, "ergebnis": {"plan": erwartet}},
                      "§14.4 Regel → 14 Teile, gleich §14.1 (verglichen beim Erzeugen); id, grund und vorhersage frei")
    return f


FOLGEN = [expandiere_sicher]
