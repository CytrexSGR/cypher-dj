#!/usr/bin/env python3
"""Baut aus einer Unit-Datei (djk/units/ oder vorlagen/) und ihrem Betriebs-Drop-in (vorlagen/<unit>.service.d/
betrieb.conf) die Argumente für `systemd-run --user`, damit djk-start die Unit transient mit genau ihren Eigenschaften
startet (ROADMAP §8.4: nie enable). Eine Zeile je Argument auf stdout, danach "--" und das ExecStart.

Regeln: [Service] der Unit ohne ExecStart; Schlüssel aus dem Drop-in ersetzen gleichnamige der Unit (Environment
wird ergänzt); "ExecStart=" im Drop-in löscht, die nächste ExecStart-Zeile gilt. Aus [Unit] nur Description,
StartLimitIntervalSec, StartLimitBurst (Reihenfolge und Warten macht djk-start selbst). %h/cypher-dj/djk wird zu --djk,
%h zu $HOME; Platzhalter @NAME@ aus --var NAME=WERT, leere fallen weg.
Namen mit Leerzeichen (Beschreibungsname eines Geräts, ziel.py): ein Platzhalter, der als ganzes Wort im ExecStart
steht (@MASTER@), bleibt EIN Argument; in einer gerenderten Datei wird er bei Bedarf in "..." gesetzt. Nur die
Mehrwort-Platzhalter (ARG_VARS: @CUE_ARG@, @TON_FREI@, @KERN_ARGS@ ...) werden mit shlex zerlegt; ihr Aufrufer setzt
Namen mit Leerzeichen darin in "...".

Aufruf: einheit.py --unit DATEI [--dropin DATEI] [--djk DIR] [--var NAME=WERT ...] [--env NAME=WERT ...]
        einheit.py --rendern ZIEL --unit DATEI [--dropin DATEI] [--var ...]   (schreibt die gefüllte Datei, installiert nichts)
Rückgabe 2: Datei fehlt, Platzhalter ungefüllt, kein ExecStart."""
import argparse
import os
import re
import shlex
import sys

AUS_UNIT = {"StartLimitIntervalSec", "StartLimitBurst"}
# Platzhalter, die mehrere Argumente tragen (oder keines): ihr Wert wird zerlegt. Alle anderen sind ein Argument.
ARG_VARS = {"CUE_ARG", "TON_FREI", "KERN_ARGS", "LEITSTAND_ARGS", "OBERFLAECHE_ARGS"}
EINFACH = re.compile(r"[A-Za-z0-9._:/+=,-]+")


def setze(wert):
    """Wert für eine Datei: unverändert, wenn er ohne Anführungszeichen ein Wort bleibt, sonst in "..."."""
    return wert if EINFACH.fullmatch(wert) else '"' + wert + '"'


def exec_args(text, var, djk, home):
    """Zerlegt die ExecStart-Zeile zuerst (mit Platzhaltern), setzt danach ein: so zerfällt kein Wert."""
    aus = []
    for wort in shlex.split(text.replace("%h/cypher-dj/djk", djk).replace("%h", home)):
        m = re.fullmatch(r"@([A-Z_]+)@", wort)
        if m and m.group(1) in var:
            w = var[m.group(1)]
            if m.group(1) in ARG_VARS:
                aus += shlex.split(w)
            elif w:
                aus.append(w)
            continue
        aus.append(fuelle(wort, var, djk, home))
    return aus


def lies(pfad):
    teile = []
    teil = None
    for zeile in open(pfad, encoding="utf-8"):
        z = zeile.strip()
        if not z or z.startswith("#") or z.startswith(";"):
            continue
        if z.startswith("["):
            teil = z
            continue
        k, _, w = z.partition("=")
        teile.append((teil, k.strip(), w.strip()))
    return teile


def fuelle(text, var, djk, home):
    text = text.replace("%h/cypher-dj/djk", djk).replace("%h", home)
    offen = set(re.findall(r"@([A-Z_]+)@", text)) - set(var)
    if offen:
        raise SystemExit(f"einheit.py: Platzhalter ungefüllt: {', '.join(sorted(offen))}")
    return re.sub(r"@([A-Z_]+)@", lambda m: var[m.group(1)], text)


def baue(unit, dropin, var, djk, home):
    service = []  # (schlüssel, wert) in Reihenfolge
    beschreibung = None
    unit_eig = []
    exec_start = None
    for teil, k, w in lies(unit):
        if teil == "[Unit]" and k == "Description":
            beschreibung = w
        elif teil == "[Unit]" and k in AUS_UNIT:
            unit_eig.append((k, w))
        elif teil == "[Service]" and k == "ExecStart":
            exec_start = w
        elif teil == "[Service]":
            service.append((k, w))
    if dropin:
        for teil, k, w in lies(dropin):
            if teil != "[Service]":
                continue
            if k == "ExecStart":
                exec_start = w or None
            elif k == "Environment":
                service.append((k, w))
            else:
                service = [(a, b) for a, b in service if a != k] + [(k, w)]
    if not exec_start:
        raise SystemExit(f"einheit.py: kein ExecStart in {unit} / {dropin}")
    aus = []
    if beschreibung:
        aus.append(f"--description={beschreibung}")
    for k, w in unit_eig + service:
        aus += ["-p", f"{k}={fuelle(w, var, djk, home)}"]
    aus.append("--")
    aus += exec_args(exec_start, var, djk, home)
    return aus


def rendern(ziel, quelle, var):
    # Für die Installation: %h bleibt stehen (systemd löst es selbst auf), nur Platzhalter werden gefüllt.
    # Erst fallen die leeren Platzhalter samt einem Leerzeichen weg und doppelte Leerzeichen der Vorlage werden
    # gezogen, danach werden die gefüllten eingesetzt: ein Doppel-Leerzeichen im Namen bleibt so erhalten.
    text = open(quelle, encoding="utf-8").read()
    zeilen = []
    for z in text.splitlines():
        if z.lstrip().startswith("#"):
            zeilen.append(z)
            continue
        offen = set(re.findall(r"@([A-Z_]+)@", z)) - set(var)
        if offen:
            raise SystemExit(f"einheit.py: Platzhalter ungefüllt: {', '.join(sorted(offen))}")
        z = re.sub(r" ?@([A-Z_]+)@", lambda m: "" if not var[m.group(1)] else m.group(0), z)
        z = re.sub(r"  +", " ", z).rstrip()
        z = re.sub(r"@([A-Z_]+)@", lambda m: var[m.group(1)] if m.group(1) in ARG_VARS else setze(var[m.group(1)]), z)
        zeilen.append(z)
    os.makedirs(os.path.dirname(ziel) or ".", exist_ok=True)
    with open(ziel, "w", encoding="utf-8") as f:
        f.write("\n".join(zeilen) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--unit", required=True)
    p.add_argument("--dropin")
    p.add_argument("--djk", default=os.path.expanduser("~/cypher-dj/djk"))
    p.add_argument("--var", action="append", default=[])
    p.add_argument("--rendern")
    a = p.parse_args()
    var = dict(v.split("=", 1) for v in a.var)
    for d in (a.unit, a.dropin):
        if d and not os.path.isfile(d):
            print(f"einheit.py: fehlt: {d}", file=sys.stderr)
            return 2
    if a.rendern:
        rendern(a.rendern, a.dropin or a.unit, var)
        return 0
    try:
        for x in baue(a.unit, a.dropin, var, a.djk, os.path.expanduser("~")):
            print(x)
    except SystemExit as e:
        print(e, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
