#!/usr/bin/env python3
"""Prüft die JSON-Schemas in djk/vertrag/schemas/ gegen die Beispiele in SCHNITTSTELLEN.md.

1. Metaschema: jedes Schema ist gültiges Draft 2020-12.
2. Zählung am Text: alle JSON-Kandidaten (vertrag_beispiele.kandidaten) der Abschnitte aus zuordnung.json "geltung"
   werden aus dem Vertragstext gelesen; jeder braucht einen Eintrag in beispiele/zuordnung.json mit gleichem Anfang,
   und umgekehrt. Kandidaten außerhalb der Geltung brauchen eine Begründung in "ausserhalb".
3. Gültigkeit: json-Beispiele direkt, alternativen je Variante, muster und signatur über die kuratierte Fassung aus
   beispiele/kuratiert.json, die jedes Feld des Textes trägt (Platzhalter ausgenommen). Bei signatur zusätzlich:
   Pflichtfelder des Schemas = Felder ohne ? im Text.
4. Fehlerfall: je Schema-Einheit wird aus dem ersten gültigen Beispiel jedes Pflichtfeld einzeln entfernt; jede dieser
   Fassungen muss abgelehnt werden. Zusätzlich die zusatz-Beispiele für Schemas ohne Textbeispiel.
5. Abdeckung: jede Schema-Datei in schemas/ außer defs.schema.json kommt in mindestens einer Einheit vor.

Aufruf: python3 djk/vertrag/pruefe_schemas.py [--ohne-pflicht] [--vertrag PFAD]   Rückgabe 0 = grün, 1 = rot.
--vertrag liest eine andere Fassung des Vertragstexts (für die Mutationsprobe).
"""
import copy
import json
import pathlib
import sys

from jsonschema import Draft202012Validator

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import schema_lader as sl  # noqa: E402
import vertrag_beispiele as vb  # noqa: E402
import vertragstext  # noqa: E402  (Scheibe 02)

BEISPIELE = HIER / "beispiele"
ABNAHME = ("6.5", "9.1", "12.1", "12.2", "13.3")   # dazu jeder Abschnitt 14.x (Steckbrief 09, Abnahme)


def anfang(roh):
    return " ".join(roh.split())[:32]


def entfaltet_required(schema, felder):
    """required einer Einheit; bei oneOf der Zweig, dessen properties alle Felder tragen."""
    if "oneOf" in schema:
        for zweig in schema["oneOf"]:
            if set(felder) <= set(zweig.get("properties", {})):
                return set(zweig.get("required", []))
    return set(schema.get("required", []))


def lade_kuratiert():
    return json.loads((BEISPIELE / "kuratiert.json").read_text(encoding="utf-8"))


def lade_zuordnung():
    return json.loads((BEISPIELE / "zuordnung.json").read_text(encoding="utf-8"))


def ist_abnahme(abschnitt):
    return abschnitt in ABNAHME or abschnitt.startswith("14.")


def pruefe(text, z, kur, mit_pflicht=True):
    """Gibt (fehler, zahl) zurück; fehler leer heißt grün."""
    fehler = []
    zahl = {"json": 0, "alternativen": 0, "varianten": 0, "muster": 0, "signatur": 0, "zusatz": 0, "pflicht_proben": 0,
            "abnahme_text": 0, "abnahme_gueltig": 0}
    reg = sl.registry()
    for name, s in sl.alle_schemas().items():
        try:
            Draft202012Validator.check_schema(s)
        except Exception as e:  # noqa: BLE001 - jede Metaschema-Verletzung ist ein Befund
            fehler.append(f"Metaschema {name}: {e}")
    kand = {k["id"]: k for k in vb.kandidaten(text)}
    im_text = {i: k for i, k in kand.items() if k["abschnitt"] in z["geltung"]}
    ausser = sorted(i for i, k in kand.items() if k["abschnitt"] not in z["geltung"])
    for i in ausser:
        if i not in z["ausserhalb"]:
            fehler.append(f"{i}: außerhalb der Geltung, aber nicht in 'ausserhalb' begründet")
    eintraege = {e["id"]: e for e in z["beispiele"]}
    for i in sorted(set(im_text) - set(eintraege)):
        fehler.append(f"{i}: Beispiel im Text ohne Zuordnung: {anfang(im_text[i]['roh'])!r}")
    for i in sorted(set(eintraege) - set(im_text)):
        fehler.append(f"{i}: Zuordnung ohne Beispiel im Text")
    zahl["abnahme_text"] = sum(1 for k in kand.values() if ist_abnahme(k["abschnitt"]))
    einheiten = {}   # schema-ref -> erstes gültiges Beispiel
    for i, e in eintraege.items():
        if i not in im_text:
            continue
        roh = im_text[i]["roh"]
        if anfang(roh) != e["anfang"]:
            fehler.append(f"{i}: Text geändert: {anfang(roh)!r} statt {e['anfang']!r}")
            continue
        kl = vb.klasse(roh)
        if kl != e["klasse"]:
            fehler.append(f"{i}: Klasse {kl} statt {e['klasse']}")
        datei = e["schema"].split("#")[0]
        if datei not in sl.alle_schemas() and datei not in sl.FREMD:
            fehler.append(f"{i}: Schema {e['schema']} fehlt")
            continue
        v = sl.validator(e["schema"], reg)
        if kl == "json":
            objekte = [json.loads(roh)]
        elif kl == "alternativen":
            objekte = vb.varianten(roh)
            zahl["varianten"] += len(objekte)
        else:
            if e.get("kuratiert") not in kur:
                fehler.append(f"{i}: {kl} ohne kuratierte Fassung")
                continue
            obj = kur[e["kuratiert"]]
            fehlt = vb.schluessel(roh) - vb.schluessel_in(obj) - set(z.get("platzhalter", {}).get(i, []))
            if fehlt:
                fehler.append(f"{i}: kuratierte Fassung {e['kuratiert']} ohne Felder {sorted(fehlt)}")
            if kl == "signatur":
                felder = vb.oberste_felder(roh)
                pflicht_text = {n for n, opt in felder if not opt}
                pflicht_schema = entfaltet_required(sl.teilschema(e["schema"]), [n for n, _ in felder])
                if pflicht_text != pflicht_schema:
                    fehler.append(f"{i}: Pflichtfelder Text {sorted(pflicht_text)} gegen Schema {sorted(pflicht_schema)}")
            objekte = [obj]
        zahl[kl] += 1
        gueltig = True
        for n, o in enumerate(objekte):
            try:
                f = sorted(v.iter_errors(o), key=str)
            except Exception as ex:  # noqa: BLE001 - unauflösbare $ref zählt als Befund
                fehler.append(f"{i}: Schema nicht auswertbar: {ex}")
                gueltig = False
                continue
            if f:
                gueltig = False
                fehler.append(f"{i} (Variante {n}) gegen {e['schema']}: {f[0].message} bei {list(f[0].absolute_path)}")
            elif datei in sl.alle_schemas():
                einheiten.setdefault(e["schema"], o)
        if gueltig and ist_abnahme(im_text[i]["abschnitt"]):
            zahl["abnahme_gueltig"] += 1
    for e in z["zusatz"]:
        quelle = HIER / e["datei"] if "datei" in e else None
        if e["schema"].split("#")[0] not in sl.alle_schemas() or (quelle is None and e.get("kuratiert") not in kur) \
                or (quelle is not None and not quelle.is_file()):
            fehler.append(f"zusatz {e.get('kuratiert') or e.get('datei')} oder {e['schema']} fehlt")
            continue
        o = json.loads(quelle.read_text(encoding="utf-8")) if quelle else kur[e["kuratiert"]]
        f = list(sl.validator(e["schema"], reg).iter_errors(o))
        zahl["zusatz"] += 1
        if f:
            fehler.append(f"zusatz {e.get('kuratiert') or e.get('datei')} gegen {e['schema']}: {f[0].message}")
        else:
            einheiten.setdefault(e["schema"] + " (zusatz)", o)
    if mit_pflicht:
        for ref, o in einheiten.items():
            ref_rein = ref.replace(" (zusatz)", "")
            if not isinstance(o, dict):
                continue
            v = sl.validator(ref_rein, reg)
            for feld in sorted(entfaltet_required(sl.teilschema(ref_rein), list(o))):
                kaputt = copy.deepcopy(o)
                del kaputt[feld]
                zahl["pflicht_proben"] += 1
                if v.is_valid(kaputt):
                    fehler.append(f"Fehlerfall {ref}: ohne Pflichtfeld {feld!r} trotzdem gültig")
    abgedeckt = {r.split("#")[0].replace(" (zusatz)", "") for r in einheiten}
    for name in sl.alle_schemas():
        if name not in abgedeckt and name != "defs.schema.json":
            fehler.append(f"Abdeckung: {name} hat kein gültiges Beispiel")
    zahl["kandidaten"], zahl["in_geltung"], zahl["ausserhalb"] = len(kand), len(im_text), ausser
    zahl["einheiten"], zahl["schemas"] = len(einheiten), len(sl.alle_schemas())
    return fehler, zahl


def main(argv):
    pfad = pathlib.Path(argv[argv.index("--vertrag") + 1]) if "--vertrag" in argv else vertragstext.VERTRAG
    if not (BEISPIELE / "zuordnung.json").is_file() or not (BEISPIELE / "kuratiert.json").is_file():
        print("ROT: beispiele/zuordnung.json oder beispiele/kuratiert.json fehlt")
        return 1
    fehler, zahl = pruefe(vertragstext.lies(pfad), lade_zuordnung(), lade_kuratiert(), "--ohne-pflicht" not in argv)
    print(f"Beispiele am Text: {zahl['kandidaten']} Kandidaten, davon {zahl['in_geltung']} in der Geltung, "
          f"{len(zahl['ausserhalb'])} außerhalb ({', '.join(zahl['ausserhalb'])})")
    print(f"Abnahme-Abschnitte §6.5, §9.1, §12.1, §12.2, §13.3, §14.x: {zahl['abnahme_text']} Beispiele am Text, "
          f"davon {zahl['abnahme_gueltig']} gültig gegen ihr Schema")
    print(f"geprüft: json {zahl['json']}, alternativen {zahl['alternativen']} ({zahl['varianten']} Varianten), "
          f"muster {zahl['muster']}, signatur {zahl['signatur']}; zusatz {zahl['zusatz']}; "
          f"Pflichtfeld-Proben {zahl['pflicht_proben']} in {zahl['einheiten']} Einheiten; Schemas {zahl['schemas']}")
    for f in fehler:
        print("FEHLER", f)
    print("GRÜN" if not fehler else f"ROT: {len(fehler)} Fehler")
    return 0 if not fehler else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
