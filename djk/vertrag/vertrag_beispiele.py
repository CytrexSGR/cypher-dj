"""Liest die JSON-Beispiele aus SCHNITTSTELLEN.md, am Text gezählt (nicht aus einer Liste abgeschrieben).

Den Text liefert vertragstext.lies() aus Scheibe 02. Ein Kandidat ist jeder ```json-Block und jeder Inline-Code, der
mit '{' beginnt (auch über Zeilenumbrüche). Kennung: '<Abschnitt>#<laufende Nummer im Abschnitt>' (Blöcke zuerst,
dann Inline in Textfolge), so bleibt sie stabil, wenn anderswo im Text Zeilen dazukommen.

Klassen:
  json         parst, keine Platzhalter, keine Alternativen      → wird so validiert
  alternativen parst, Stringwerte der Form "a|b|c"                → je Alternative eine Variante
  muster       parst nicht oder trägt "..." als Wert              → kuratierte Fassung in beispiele/kuratiert.json
  signatur     Typ-Signatur wie in §10/§11 ("feld"?:str, :int)   → kuratierte Fassung, Pflichtfelder = Felder ohne ?
"""
import json
import re

ALT = re.compile(r"^[a-z0-9_]+(\|[a-z0-9_]+)+$")
SIGNATUR = re.compile(r'"\w+"\?|:\s*(str|int|f|bool|pfad|material_id|id|Wahl|Plan|Takt-Zustand|Kandidat|Passung)\b|≤|\\\|')


def abschnitte(text):
    teile = re.split(r"(?m)^(#{2,3} \d+(?:\.\d+)?\.? .*)$", text)
    out = []
    for i in range(1, len(teile), 2):
        nr = re.match(r"#{2,3} (\d+(?:\.\d+)?)", teile[i]).group(1)
        out.append((nr, teile[i + 1]))
    return out


def kandidaten(text):
    out = []
    for nr, body in abschnitte(text):
        k = 0
        for block in re.findall(r"```json\n(.*?)\n```", body, re.S):
            k += 1
            out.append({"id": f"{nr}#{k}", "abschnitt": nr, "form": "block", "roh": block})
        rest = re.sub(r"```.*?```", "", body, flags=re.S)
        for inl in re.findall(r"(?<!`)`(\{[^`]*?)`(?!`)", rest):
            k += 1
            out.append({"id": f"{nr}#{k}", "abschnitt": nr, "form": "inline", "roh": inl})
    return out


def _strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for v in o.values():
            yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)


def klasse(roh):
    try:
        o = json.loads(roh)
    except ValueError:
        return "signatur" if SIGNATUR.search(roh) else "muster"
    s = list(_strings(o))
    if any(x == "..." for x in s):
        return "muster"
    if any(ALT.match(x) for x in s):
        return "alternativen"
    return "json"


def varianten(roh):
    """Je Alternative eine Variante: Variante i nimmt in jedem Alternativen-Feld die Alternative i (zyklisch)."""
    o = json.loads(roh)
    n = max([len(x.split("|")) for x in _strings(o) if ALT.match(x)] or [1])

    def ersetze(x, i):
        if isinstance(x, str) and ALT.match(x):
            a = x.split("|")
            return a[i % len(a)]
        if isinstance(x, dict):
            return {k: ersetze(v, i) for k, v in x.items()}
        if isinstance(x, list):
            return [ersetze(v, i) for v in x]
        return x
    return [ersetze(o, i) for i in range(n)]


def schluessel(roh):
    """Alle Feldnamen im Text, auch in Pseudo-Notation ohne Anführungszeichen."""
    mit = set(re.findall(r'"([A-Za-z_][A-Za-z0-9_]*)"(?=\s*\??\s*:)', roh)) | set(re.findall(r'"([A-Za-z_][A-Za-z0-9_]*)"\?', roh))
    if mit:
        return mit
    return set(re.findall(r"[{,]\s*([a-z_][a-z0-9_]*)\s*(?=[:,}])", roh))


def oberste_felder(roh):
    """[(name, optional)] der obersten Ebene einer Signatur oder eines Musters."""
    felder, tiefe, i = [], 0, 0
    while i < len(roh):
        c = roh[i]
        if c in "{[":
            tiefe += 1
        elif c in "}]":
            tiefe -= 1
        elif c == '"':
            j = roh.index('"', i + 1)
            if tiefe == 1:
                rest = roh[j + 1:].lstrip()
                if rest.startswith("?:") or rest.startswith(":"):
                    felder.append((roh[i + 1:j], rest.startswith("?")))
            i = j
        i += 1
    return felder


def schluessel_in(o):
    if isinstance(o, dict):
        s = set(o)
        for v in o.values():
            s |= schluessel_in(v)
        return s
    if isinstance(o, list):
        s = set()
        for v in o:
            s |= schluessel_in(v)
        return s
    return set()
