"""Vergleich einer Beobachtung mit einer Golden-Folge nach folgen/FORMAT.md (Punkte 1 bis 12 von Scheibe 02, ab 13 die
Zusätze von Scheibe 09). Gebraucht von pruefe_golden.py (innere Stimmigkeit, Mutationsprobe) und von jedem Läufer, der
seine Beobachtung in Python auswertet (Scheiben 08, 11, 13, 16, 17, 21).

Beobachtung: Liste von {"sample": int, "osc": [adresse, typen, ...werte]} (Kennungen in der Zählung der Folge, also
ohne die Basis B des Läufers, FORMAT.md Punkt 4), {"sample": int, "ws": {"typ", "daten"}} und {"rechner": {...}};
dazu die Abfragen wert_bei(pfad, sample), deck_bei(deck, feld, sample), mess_bei(name, sample), je Zahl oder None.
Ergebnis: Liste von Befunden (Zeilennummer 1-basiert, Art, Text); leer heißt: die Beobachtung erfüllt die Folge.

Regeln: Adresse und Typ-Zeichenkette gleich; i, h, s genau; f, d mit |soll - ist| <= toleranz (Vorgabe 0, FORMAT.md
Punkt 6); null in der Erwartung passt auf alles; "NaN" nur auf NaN; ws und rechner als Teilmenge (erwartete Schlüssel
müssen da sein und passen, weitere sind erlaubt, Listen gleich lang). Eine Nachricht erfüllt höchstens einen Schritt;
die Zuordnung ist ein größtes Matching, keine Reihenfolge (Punkt 6). erlaube-Zeilen verbrauchen, was übrig bleibt.
Am Ende macht jede unverbrauchte Nachricht /e/protokollfehler, /e/invariante oder /q mit Status 4 bis 8 die Folge rot
(Punkt 8).
"""
import math

POSITIV = ("erwarte", "ws_erwarte", "rechner_antwort")
PUNKT_8 = ("/e/protokollfehler", "/e/invariante")


def wert_passt(soll, ist, tol):
    if soll is None:
        return True
    if soll == "NaN":
        return isinstance(ist, float) and math.isnan(ist)
    if soll in ("inf", "-inf"):
        return isinstance(ist, float) and ist == float(soll)
    if isinstance(soll, bool) or isinstance(ist, bool):
        return soll is ist
    if isinstance(soll, float) and isinstance(ist, (int, float)):
        return abs(soll - ist) <= tol
    if isinstance(soll, int) and isinstance(ist, int):
        return soll == ist
    if isinstance(soll, dict):
        return isinstance(ist, dict) and all(k in ist and wert_passt(v, ist[k], tol) for k, v in soll.items())
    if isinstance(soll, list):
        return isinstance(ist, list) and len(soll) == len(ist) and all(wert_passt(x, y, tol) for x, y in zip(soll, ist))
    return soll == ist


def osc_passt(soll, ist, tol):
    return (isinstance(ist, list) and len(soll) == len(ist) and soll[0] == ist[0] and soll[1] == ist[1]
            and all(wert_passt(x, y, tol) for x, y in zip(soll[2:], ist[2:])))


def passt(zeile, nachricht):
    tol = zeile.get("toleranz", 0.0)
    t = zeile["t"]
    if t in ("erwarte", "erwarte_nicht", "erlaube"):
        return "osc" in nachricht and osc_passt(zeile["osc"], nachricht["osc"], tol)
    if t == "ws_erwarte":
        return "ws" in nachricht and wert_passt({"typ": zeile["typ"], "daten": zeile["daten"]}, nachricht["ws"], tol)
    if t == "rechner_antwort":
        return "rechner" in nachricht and wert_passt(zeile["zeile"], nachricht["rechner"], tol)
    return False


def im_fenster(zeile, nachricht):
    if zeile["t"] == "rechner_antwort":
        return True
    s = nachricht.get("sample")
    return s is not None and zeile.get("ab_sample", 0) <= s <= zeile["bis_sample"]


def _matching(schritte, beobachtet):
    """Größtes Matching Schritt -> Nachricht (Augmentierungspfade); Rückgabe {schritt_index: nachricht_index}."""
    kanten = {i: [j for j, m in enumerate(beobachtet) if im_fenster(z, m) and passt(z, m)] for i, z in schritte}
    belegt = {}

    def versuche(i, gesehen):
        for j in kanten[i]:
            if j in gesehen:
                continue
            gesehen.add(j)
            if j not in belegt or versuche(belegt[j], gesehen):
                belegt[j] = i
                return True
        return False

    for i, _ in schritte:
        versuche(i, set())
    return {i: j for j, i in belegt.items()}


def pruefe(zeilen, beobachtet, wert_bei, deck_bei=None, mess_bei=None):
    befunde = []
    positiv = [(n, z) for n, z in enumerate(zeilen, 1) if z["t"] in POSITIV]
    zuordnung = _matching(positiv, beobachtet)
    verbraucht = set(zuordnung.values())
    for n, z in positiv:
        if n not in zuordnung:
            was = z.get("osc") or z.get("zeile") or {"typ": z.get("typ"), "daten": z.get("daten")}
            fenster = "" if z["t"] == "rechner_antwort" else f" im Fenster [{z.get('ab_sample', 0)}, {z['bis_sample']}]"
            befunde.append((n, "fehlt", f"{z['t']} {was}{fenster}"))
    for n, z in enumerate(zeilen, 1):
        t = z["t"]
        if t == "erwarte_nicht":
            treffer = [m for m in beobachtet if im_fenster(z, m) and passt(z, m)]
            if treffer:
                befunde.append((n, "unerwartet", f"{treffer[0]} im Fenster [{z['ab_sample']}, {z['bis_sample']}]"))
        elif t == "erlaube":
            verbraucht |= {j for j, m in enumerate(beobachtet) if j not in verbraucht and im_fenster(z, m) and passt(z, m)}
        elif t in ("wert", "deck_wert", "messung"):
            abfrage = {"wert": lambda: wert_bei(z["pfad"], z["sample"]),
                       "deck_wert": lambda: deck_bei(z["deck"], z["feld"], z["sample"]) if deck_bei else None,
                       "messung": lambda: mess_bei(z["name"], z["sample"]) if mess_bei else None}[t]
            v = abfrage()
            ziel = z.get("pfad") or (f"deck/{z['deck']}/{z['feld']}" if t == "deck_wert" else f"messung/{z.get('name')}")
            if v is None or abs(v - z["wert"]) > z["toleranz"]:
                befunde.append((n, t, f"{ziel} bei {z['sample']}: {v} statt {z['wert']} ±{z['toleranz']}"))
    for j, m in enumerate(beobachtet):
        o = m.get("osc")
        if j in verbraucht or not o:
            continue
        if o[0] in PUNKT_8 or (o[0] == "/q" and isinstance(o[4], int) and 4 <= o[4] <= 8):
            befunde.append((0, "unverbraucht", f"{m} (FORMAT.md Punkt 8)"))
    return befunde


def _platzhalter(typ):
    return {"h": 0, "i": 0, "d": 0.0, "f": 0.0, "s": "x"}.get(typ, 0)


def ideale_beobachtung(zeilen):
    """Was ein vertragstreuer Kern liefern würde: jede positive Erwartung einmal, am frühesten erlaubten Sample, null
    durch einen Platzhalter des OSC-Typs ersetzt; Werte aus den wert-, deck_wert- und messung-Zeilen.
    Rückgabe: (beobachtet, wert_bei, deck_bei, mess_bei)."""
    nachrichten, werte, deck, mess = [], {}, {}, {}
    for z in zeilen:
        t = z["t"]
        if t == "erwarte":
            o = z["osc"]
            nachrichten.append({"sample": z.get("ab_sample", z["bis_sample"]),
                                "osc": o[:2] + [_platzhalter(ty) if v is None else (float("nan") if v == "NaN" else v)
                                                for ty, v in zip(o[1][1:], o[2:])]})
        elif t == "ws_erwarte":
            nachrichten.append({"sample": z.get("ab_sample", z["bis_sample"]), "ws": {"typ": z["typ"], "daten": z["daten"]}})
        elif t == "rechner_antwort":
            nachrichten.append({"rechner": z["zeile"]})
        elif t == "wert":
            werte[(z["pfad"], z["sample"])] = z["wert"]
        elif t == "deck_wert":
            deck[(z["deck"], z["feld"], z["sample"])] = z["wert"]
        elif t == "messung":
            mess[(z["name"], z["sample"])] = z["wert"]
    return (nachrichten, lambda p, s: werte.get((p, s)), lambda d, f, s: deck.get((d, f, s)),
            lambda n, s: mess.get((n, s)))
