#!/usr/bin/env python3
"""Prüft die Golden-Folgen der Scheibe 09 in folgen/ (oder --ordner) samt INDEX.json.

1. Herleitung: jede Datei von Scheibe 09 gleicht Zeile für Zeile der Neuerzeugung durch erzeuge_golden.py. Eine von
   Hand geänderte Zahl (Mutationsprobe) erscheint als Befund mit Datei, Zeile und Feld.
2. Form: jede Zeile gültig gegen folge.schema.json; Handlungen (sende, buendel, hand, aktion, ws_sende) in nicht
   fallender Sample-Folge (der Läufer arbeitet in Dateireihenfolge); die OSC-Nachrichten der Schritt-Arten, die pruefe_folgen.py (02)
   nicht liest (erwarte_nicht, erlaube, buendel), gegen osc.json (Adresse, Typ-Zeichenkette, Richtung, Wertetypen);
   ws_sende gegen ws_daten.schema.json, rechner_frage gegen rechner.schema.json, jeder Plan-Teil einer rechner_antwort
   gegen plan.schema.json.
3. Innere Stimmigkeit: die ideale Beobachtung (jede positive Erwartung am frühesten Sample) erfüllt die Folge, also
   widerspricht keine erwarte_nicht-Zeile einer positiven Erwartung.
4. Fixtures: jedes Material einer Folge liegt unter folgen/material/ und ist gültig gegen fassung und material.
5. Grundformat: pruefe_folgen.py von Scheibe 02 läuft über denselben Ordner grün (alle Dateien, auch diese).
Mit --voll zusätzlich:
6. Vertragsanker, am Text von §19.3 gelesen: teil_rampe Wert bei Beat 80, hotcue_phase Ziel 64,30, rueckfall Loop [80, 96).
7. Abdeckung: jeder Folgen-Name aus §19 Punkt 3 hat eine Datei.

Aufruf: python3 djk/vertrag/pruefe_golden.py [--voll] [--ordner ORDNER]   Rückgabe 0 = grün, 1 = rot.
"""
import json
import pathlib
import re
import subprocess
import sys

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import erzeuge_golden as eg  # noqa: E402
import folgen_vergleich as fv  # noqa: E402
import schema_lader as sl  # noqa: E402
import vertragstext  # noqa: E402  (Scheibe 02)

OSC = {a["adresse"]: a for a in json.loads((HIER / "osc.json").read_text(encoding="utf-8"))["adressen"]}
HANDLUNG = ("sende", "buendel", "hand", "aktion", "ws_sende")


def _wert_passt(typ, w):
    if w is None:
        return True
    if typ in "ih":
        return isinstance(w, int) and not isinstance(w, bool)
    if typ in "fd":
        return (isinstance(w, (int, float)) and not isinstance(w, bool)) or w in ("NaN", "inf", "-inf")
    return isinstance(w, str)


def pruefe_nachricht(ort, n, soll_richtung):
    """Adresse, Typen, Wertezahl, Wertetypen und Richtung einer OSC-Nachricht gegen osc.json (Scheibe 02)."""
    e = OSC.get(n[0])
    if e is None:
        return [f"{ort}: {n[0]} steht nicht in osc.json"]
    f = []
    if e["typen"] != n[1]:
        f.append(f"{ort}: {n[0]} hat laut osc.json {e['typen']}, die Folge sagt {n[1]}")
    if len(n) - 2 != len(n[1]) - 1:
        f.append(f"{ort}: {n[0]} hat {len(n) - 2} Werte für {n[1]}")
    f += [f"{ort}: {n[0]} Wert {k + 1} ({w!r}) passt nicht zu Typ {t}"
          for k, (t, w) in enumerate(zip(n[1][1:], n[2:])) if not _wert_passt(t, w)]
    if soll_richtung == "an_kern" and e["richtung"] != "an_kern":
        f.append(f"{ort}: {n[0]} geht nicht an den Kern")
    if soll_richtung == "vom_kern" and e["richtung"] == "an_kern":
        f.append(f"{ort}: {n[0]} kommt nie vom Kern oder der Notbahn")
    return f


def folgen_namen(text):
    """Die Folgen-Namen aus §19 Punkt 3: je Aufzählungspunkt und je ';'-Abschnitt die führende Liste in Backticks
    (Klammerzusätze vorher entfernt), z. B. "`laden`, `start_quell_beat` (...), `loop`"."""
    punkt3 = re.search(r"\n3\. \*\*Golden-Folgen\*\*(.*?)\n4\. ", text, re.S).group(1)
    ohne = re.sub(r"\([^()]*\)", "", punkt3)
    namen = set()
    for punkt in re.split(r"\n\s*- ", ohne)[1:]:
        for abschnitt in punkt.split(";"):
            kopf = re.match(r"\s*((?:`[a-z0-9_]+`\s*(?:,|und)?\s*)+)", abschnitt)
            if kopf:
                namen |= set(re.findall(r"`([a-z0-9_]+)`", kopf.group(1)))
    return namen


def anker(text):
    """Die drei Zahlen, die §19.3 selbst nennt (Abnahme Scheibe 09)."""
    punkt3 = re.search(r"\n3\. \*\*Golden-Folgen\*\*(.*?)\n4\. ", text, re.S).group(1)
    zahl = lambda s: float(s.replace("−", "-").replace(" ", "").replace(" ", "").replace(",", "."))
    m = re.search(r"Wert bei Beat (\d+) \(Sample ([\d  ]+)\) = (−?[\d,]+) dB", punkt3)
    hc = re.search(r"Hotcue (\d+,\d+) → Ziel (\d+,\d+)", punkt3)
    lp = re.search(r"Loop\s+`\[(\d+), (\d+)\)`", punkt3)
    if not (m and hc and lp):
        raise ValueError("§19.3: Ankerzahlen nicht gefunden (Vertragstext geändert?)")
    return {"teil_rampe": (int(zahl(m.group(2))), zahl(m.group(3))), "hotcue_phase": zahl(hc.group(2)),
            "rueckfall": (zahl(lp.group(1)), zahl(lp.group(2)))}


def pruefe_anker(ordner, text):
    a = anker(text)
    lies = lambda n: [json.loads(z) for z in (ordner / f"{n}.jsonl").read_text(encoding="utf-8").splitlines()] \
        if (ordner / f"{n}.jsonl").is_file() else []
    s80, w80 = a["teil_rampe"]
    tests = {
        "teil_rampe": any(z["t"] == "wert" and z["sample"] == s80 and z["pfad"] == "deck/2/fader" and z["wert"] == w80
                          for z in lies("teil_rampe")),
        "hotcue_phase": any(z["t"] == "deck_wert" and z["feld"] == "quell_beat"
                            and abs(z["wert"] - (a["hotcue_phase"] + 1.0)) < 1e-9 for z in lies("hotcue_phase")),
        "rueckfall": any(z["t"] == "erwarte" and z["osc"][0] == "/e/rueckfall" and z["osc"][3] == 1
                         and z["osc"][4] == a["rueckfall"][0] and z["osc"][5] == a["rueckfall"][1] - a["rueckfall"][0]
                         for z in lies("rueckfall"))}
    print(f"Vertragsanker aus §19.3: teil_rampe Sample {s80} = {w80:g} dB, hotcue_phase Ziel {a['hotcue_phase']:.2f}, "
          f"rueckfall Loop [{a['rueckfall'][0]:g}, {a['rueckfall'][1]:g})")
    return [f"Vertragsanker {n} fehlt oder weicht ab" for n, ok in tests.items() if not ok]


def pruefe_folge(datei, ist, soll, reg, v_zeile):
    fehler = []
    for n, (a, b) in enumerate(zip(ist, soll), 1):
        if a != b:
            felder = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
            fehler.append(f"{datei} Zeile {n}: weicht von der Herleitung ab in {felder}: "
                          f"{json.dumps({k: a.get(k) for k in felder}, ensure_ascii=False)[:160]} statt "
                          f"{json.dumps({k: b.get(k) for k in felder}, ensure_ascii=False)[:160]}")
    if len(ist) != len(soll):
        fehler.append(f"{datei}: {len(ist)} Zeilen statt {len(soll)}")
    letzte = -1
    for n, z in enumerate(ist, 1):
        if z.get("t") in HANDLUNG:
            if z["sample"] < letzte:
                fehler.append(f"{datei} Zeile {n}: {z['t']} bei Sample {z['sample']} liegt vor der vorigen Handlung "
                              f"({letzte}); FORMAT.md Punkt 15")
            letzte = max(letzte, z["sample"])
    # Validatoren erst beim ersten Gebrauch: die Schemas zu WebSocket, Rechner und Plan kommen in einem späteren Task
    # als die ersten Folgen (Plan Scheibe 09), und eine Folge ohne solche Zeilen braucht sie nicht.
    v = {}

    def val(ref):
        if ref not in v:
            v[ref] = sl.validator(ref, reg)
        return v[ref]
    for n, z in enumerate(ist, 1):
        ort = f"{datei} Zeile {n}"
        f = list(v_zeile.iter_errors(z))
        if f:
            fehler.append(f"{ort}: Form: {f[0].message[:160]}")
            continue
        if z["t"] in ("erwarte_nicht", "erlaube"):
            fehler += pruefe_nachricht(ort, z["osc"], "vom_kern")
        elif z["t"] == "buendel":
            for m in z["nachrichten"]:
                fehler += pruefe_nachricht(ort, m, "an_kern")
        elif z["t"] == "ws_sende" and z["typ"] in ("hallo", "rpc") \
                and not val(f"ws_daten.schema.json#/$defs/{z['typ']}").is_valid(z["daten"]):
            fehler.append(f"{ort}: ws {z['typ']} ungültig gegen ws_daten.schema.json")
        elif z["t"] == "rechner_frage" and not val("rechner.schema.json#/$defs/anfrage").is_valid(z["zeile"]):
            fehler.append(f"{ort}: Rechner-Anfrage ungültig gegen rechner.schema.json#/$defs/anfrage")
        elif z["t"] == "rechner_antwort":
            for t in z["zeile"].get("ergebnis", {}).get("plan", {}).get("teile", []):
                if not val("plan.schema.json#/$defs/teil").is_valid(t):
                    fehler.append(f"{ort}: Plan-Teil {t.get('nr')} ungültig gegen plan.schema.json")
    beob, wert_bei, deck_bei, mess_bei = fv.ideale_beobachtung(ist)
    for n, art, text in fv.pruefe(ist, beob, wert_bei, deck_bei, mess_bei):
        fehler.append(f"{datei} Zeile {n}: innerer Widerspruch ({art}): {text[:160]}")
    return fehler


def main(argv):
    ordner = pathlib.Path(argv[argv.index("--ordner") + 1]) if "--ordner" in argv else HIER / "folgen"
    fehler = []
    if not (ordner / "INDEX.json").is_file():
        print(f"ROT: {ordner}/INDEX.json fehlt")
        return 1
    index = json.loads((ordner / "INDEX.json").read_text(encoding="utf-8"))
    folgen = eg.alle_folgen()
    neu = {f.name: f for f in folgen}
    if index != eg.index_zeilen(folgen):
        fehler.append("INDEX.json ist nicht, was erzeuge_golden.py erzeugt")
    reg = sl.registry()
    v_zeile = sl.validator("folge.schema.json", reg)
    zeilen_09 = 0
    for e in index:
        datei = ordner / e["datei"]
        if not datei.is_file():
            fehler.append(f"{e['datei']} fehlt")
            continue
        if e["von"] != "09":
            continue
        ist = [json.loads(z) for z in datei.read_text(encoding="utf-8").splitlines() if z.strip()]
        if e["name"] not in neu:
            fehler.append(f"{e['name']}: keine Herleitung in erzeuge_golden.MODULE")
            continue
        zeilen_09 += len(ist)
        fehler += pruefe_folge(e["datei"], ist, neu[e["name"]].zeilen, reg, v_zeile)
        for mid in e["material"]:
            fj = HIER / "folgen" / "material" / mid / "fassungen" / "128000_r1" / "fassung.json"
            mj = HIER / "folgen" / "material" / mid / "material.json"
            if not fj.is_file() or not mj.is_file():
                fehler.append(f"{e['name']}: Fixture {mid} fehlt")
            elif not (sl.validator("fassung.schema.json", reg).is_valid(json.loads(fj.read_text(encoding="utf-8")))
                      and sl.validator("material.schema.json", reg).is_valid(json.loads(mj.read_text(encoding="utf-8")))):
                fehler.append(f"{e['name']}: Fixture {mid} schema-ungültig")
    ohne_index = sorted({p.name for p in ordner.glob("*.jsonl")} - {e["datei"] for e in index})
    fehler += [f"{d}: Datei ohne Eintrag in INDEX.json" for d in ohne_index]
    r = subprocess.run([sys.executable, str(HIER / "pruefe_folgen.py"), "--ordner", str(ordner)], capture_output=True,
                       text=True)
    if r.returncode != 0:
        fehler.append("pruefe_folgen.py (Scheibe 02) über denselben Ordner: " + " | ".join(
            z for z in r.stdout.splitlines() if z.startswith("ROT"))[:600])
    text = vertragstext.lies()
    if "--voll" in argv:
        fehler += pruefe_anker(ordner, text)
        namen = folgen_namen(text)
        hat = {e["vertrag"] for e in index}
        fehlt = sorted(namen - hat)
        print(f"§19.3 nennt {len(namen)} Namen, davon {len(namen & hat)} mit Datei")
        if fehlt:
            fehler.append(f"§19.3 ohne Folge: {fehlt}")
    print(f"{len(index)} Folgen im INDEX ({sum(1 for e in index if e['von'] == '09')} von Scheibe 09 mit {zeilen_09} "
          f"Zeilen); pruefe_folgen.py (02) über denselben Ordner: {'grün' if r.returncode == 0 else 'ROT'}")
    for f in fehler:
        print("FEHLER", f)
    print("GRÜN" if not fehler else f"ROT: {len(fehler)} Fehler")
    return 0 if not fehler else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
