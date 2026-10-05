"""Liest die maschinenprüfbaren Teile aus docs/architektur/SCHNITTSTELLEN.md (Vertragsversion 1).

Nur Standardbibliothek. Wird von pruefe_osc.py, pruefe_konfig.py und pruefe_folgen.py benutzt.
Grundsatz: gezählt wird am Text. Eine OSC-Definition ist eine Adresse mit Typ-Zeichenkette, entweder als
Tabellenzeile ``| `/adresse` | `,typen` | Felder |`` oder im Fließtext als ```/adresse ,typen``` in einem
Backtick-Paar. Erwähnungen einer Adresse ohne Typ-Zeichenkette zählen nicht.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

WURZEL = Path(__file__).resolve().parents[2]
VERTRAG = WURZEL / "docs" / "architektur" / "SCHNITTSTELLEN.md"

_TABELLE = re.compile(r"^\|\s*`(/[a-z0-9_/]+)`\s*\|\s*`(,[a-z]*)`\s*\|")
_INLINE = re.compile(r"`(/[a-z0-9_/]+) (,[a-z]+)`")
_BEZEICHNER = re.compile(r"`([a-z_][a-z0-9_]*)`")
_SATZENDE = re.compile(r"\.(?=\s|$)|;")


@dataclass
class Definition:
    adresse: str
    typen: str
    abschnitt: str
    zeile: int
    felder: list[str] = field(default_factory=list)


def lies(pfad: Path = VERTRAG) -> str:
    return pfad.read_text(encoding="utf-8")


def abschnitt(text: str, nummer: int) -> tuple[str, int]:
    """Text von '## <nummer>.' bis zur nächsten '## '-Überschrift, dazu die Startzeile (1-basiert)."""
    zeilen = text.split("\n")
    start = next(i for i, z in enumerate(zeilen) if z.startswith(f"## {nummer}. "))
    ende = next((i for i in range(start + 1, len(zeilen)) if zeilen[i].startswith("## ")), len(zeilen))
    return "\n".join(zeilen[start:ende]), start + 1


def abschnitt_19_0(text: str) -> tuple[str, int]:
    """§19.0 ist der Listenpunkt '0. **Werkstück V0' bis vor '1. **Kern-Attrappe**'."""
    teil, start = abschnitt(text, 19)
    zeilen = teil.split("\n")
    a = next(i for i, z in enumerate(zeilen) if z.startswith("0. **Werkstück V0"))
    e = next(i for i, z in enumerate(zeilen) if z.startswith("1. **Kern-Attrappe**"))
    return "\n".join(zeilen[a:e]), start + a


def ohne_klammern(s: str) -> str:
    """Entfernt geklammerte Einschübe, auch geschachtelte."""
    aus, tiefe = [], 0
    for z in s:
        if z == "(":
            tiefe += 1
        elif z == ")" and tiefe > 0:
            tiefe -= 1
        elif tiefe == 0:
            aus.append(z)
    return "".join(aus)


def _namen(feldtext: str) -> list[str]:
    return _BEZEICHNER.findall(feldtext)


def _bis_satzende(s: str) -> str:
    s = ohne_klammern(s)
    m = _SATZENDE.search(s)
    return s[: m.start()] if m else s


def _tabellenspalten(zeile: str) -> list[str]:
    return [t.strip() for t in re.split(r"(?<!\\)\|", zeile)[1:-1]]


def _klammerinhalt(s: str) -> str:
    """Inhalt der ersten Klammer am Anfang von s (s beginnt mit Leerzeichen und '(')."""
    s = s.lstrip()
    tiefe = 0
    for i, z in enumerate(s):
        if z == "(":
            tiefe += 1
        elif z == ")":
            tiefe -= 1
            if tiefe == 0:
                return s[1:i]
    return s[1:]


def definitionen(text: str, name: str, startzeile: int) -> list[Definition]:
    zeilen = text.split("\n")
    gefunden: list[Definition] = []
    for i, zeile in enumerate(zeilen):
        m = _TABELLE.match(zeile)
        if m:
            spalten = _tabellenspalten(zeile)
            feldtext = ohne_klammern(spalten[2]) if len(spalten) > 2 else ""
            feldtext = re.split(r";", feldtext)[0]
            gefunden.append(Definition(m.group(1), m.group(2), name, startzeile + i, _namen(feldtext)))
            continue
        for m in _INLINE.finditer(zeile):
            d = Definition(m.group(1), m.group(2), name, startzeile + i)
            rest_zeile = zeile[m.end():]
            danach = "\n".join([rest_zeile] + zeilen[i + 1: i + 12])
            if zeile.startswith("#"):
                d.felder = _felder_nach_ueberschrift(d.adresse, zeilen, i)
            elif rest_zeile.startswith(" ("):
                d.felder = _namen(_klammerinhalt(rest_zeile))
            elif rest_zeile.lstrip("*").startswith(":"):
                koerper = danach.split(":", 1)[1]
                koerper = koerper.split("\n\n")[0].replace("\n", " ")
                wie = re.match(r"\*?\*?\s*dieselben Felder wie `(/[a-z0-9_/]+)`", koerper)
                d.felder = ["=" + wie.group(1)] if wie else _namen(_bis_satzende(koerper))
            elif rest_zeile.strip() == "":
                d.felder = _felder_aus_feldtabelle(zeilen, i)
            gefunden.append(d)
    return gefunden


def _felder_nach_ueberschrift(adresse: str, zeilen: list[str], i: int) -> list[str]:
    absatz: list[str] = []
    j = i + 1
    while j < len(zeilen) and zeilen[j].strip() == "":
        j += 1
    while j < len(zeilen) and zeilen[j].strip() != "" and not zeilen[j].startswith("#"):
        absatz.append(zeilen[j])
        j += 1
    for k, z in enumerate(absatz):
        if z.startswith(f"- `{adresse}`:"):
            rest = [z.split(":", 1)[1]]
            for w in absatz[k + 1:]:
                if w.startswith("- "):
                    break
                rest.append(w)
            return _namen(_bis_satzende(" ".join(rest)))
    return _namen(_bis_satzende(" ".join(absatz)))


def _felder_aus_feldtabelle(zeilen: list[str], i: int) -> list[str]:
    j = i + 1
    while j < len(zeilen) and zeilen[j].strip() == "":
        j += 1
    if j >= len(zeilen) or not zeilen[j].startswith("| Nr | Feld"):
        return []
    namen = []
    for z in zeilen[j + 2:]:
        if not z.startswith("|"):
            break
        spalten = _tabellenspalten(z)
        namen += _namen(spalten[1])
    return namen


def osc_definitionen(text: str) -> list[Definition]:
    """Alle OSC-Definitionen aus §4, §5 und §19.0, in Textreihenfolge; 'dieselben Felder wie' aufgelöst."""
    alle: list[Definition] = []
    for nr in (4, 5):
        teil, start = abschnitt(text, nr)
        alle += definitionen(teil, f"§{nr}", start)
    teil, start = abschnitt_19_0(text)
    alle += definitionen(teil, "§19.0", start)
    nach_adresse = {d.adresse: d for d in alle}
    for d in alle:
        if len(d.felder) == 1 and d.felder[0].startswith("="):
            vorbild = nach_adresse.get(d.felder[0][1:])
            d.felder = list(vorbild.felder) if vorbild else []
    return alle


def politik_codes(text: str) -> dict[str, str]:
    teil, _ = abschnitt(text, 4)
    absatz = next(a for a in teil.split("\n\n") if a.startswith("**Politik-Codes**"))
    return {n: w for n, w in re.findall(r"(\d) = `([a-z_]+)`", absatz.replace("\n", " "))}


def status_codes(text: str) -> dict[str, str]:
    teil, _ = abschnitt(text, 5)
    return {n: w for n, w in re.findall(r"^\| (\d) \| `([a-z_]+)` \|", teil, flags=re.M)}


def gruende(text: str) -> list[str]:
    teil, _ = abschnitt(text, 16)
    unter = teil.split("### 16.2", 1)[1].split("### 16.3", 1)[0]
    codes: list[str] = []
    for z in unter.split("\n"):
        if z.startswith("| `"):
            codes += _namen(_tabellenspalten(z)[0])
    return codes


def quellen(text: str) -> list[str]:
    teil, _ = abschnitt(text, 1)
    zeile = next(z for z in teil.split("\n") if z.startswith("| `quelle` |"))
    return _namen(_tabellenspalten(zeile)[1])


def tasten(text: str) -> list[str]:
    teil, _ = abschnitt(text, 5)
    zeilen = teil.split("\n")
    i = next(k for k, z in enumerate(zeilen) if z.startswith("- `/e/taste`:"))
    stueck = [zeilen[i]]
    for z in zeilen[i + 1:]:
        if z.startswith("- ") or z.strip() == "" or z.startswith("#"):
            break
        stueck.append(z)
    namen_teil = " ".join(stueck).split("Namen:", 1)[1]
    return _namen(ohne_klammern(namen_teil))


def _zahl(s: str) -> tuple[float, int]:
    """Deutsche Zahl mit Leerzeichen als Tausender und Komma: Wert und Zahl der Nachkommastellen."""
    s = s.replace(" ", "").replace("−", "-")
    nachkomma = len(s.split(",")[1]) if "," in s else 0
    return float(s.replace(",", ".")), nachkomma


_ZAHL = r"-?\d{1,3}(?: \d{3})*(?:,\d+)?"


def golden_1_3(text: str) -> dict[str, tuple[float, int]]:
    """Die Golden-Werte der Tempo-Karte aus der Tabelle in §1.3: Name -> (Wert, Nachkommastellen im Text)."""
    teil, _ = abschnitt(text, 1)
    zeilen = [z for z in teil.split("\n") if z.startswith("| ")]
    werte: dict[str, tuple[float, int]] = {}

    def zelle(muster: str) -> str:
        z = next(z for z in zeilen if muster in z)
        return _tabellenspalten(z)[1]

    werte["sample(64)"] = _zahl(re.match(_ZAHL, zelle("`sample(64,0)`")).group(0))
    werte["beat(1440000)"] = _zahl(re.match(_ZAHL, zelle("`beat(1 440 000)`")).group(0))
    start = zelle("Rampe 128 → 132 ab Beat 128 über 32 Beats: Start")
    werte["rampe_start"] = _zahl(re.search(r"Sample (" + _ZAHL + ")", start).group(1))
    werte["rampe_T"] = _zahl(re.search(r"`T` = (" + _ZAHL + ")", start).group(1))
    werte["rampe_k"] = _zahl(re.search(r"`k` = (" + _ZAHL + ")", start).group(1))
    for b in (144, 160, 192):
        z = zelle(f"`sample({b},0)`")
        werte[f"sample({b})"] = _zahl(re.match(_ZAHL, z).group(0))
        werte[f"sample({b})_gerundet"] = _zahl(re.search(r"gerundet (" + _ZAHL + ")", z).group(1))
        if b == 144:
            werte["bpm(144)"] = _zahl(re.search(r"`bpm` dort (" + _ZAHL + ")", z).group(1))
    return werte


def takt_schlag_phrase_1_3(text: str) -> list[tuple[float, int, int, int]]:
    """Zeile 'Takt/Schlag/Phrase für Beat ...' aus §1.3: [(beat, takt, schlag, phrase), ...]."""
    teil, _ = abschnitt(text, 1)
    z = next(z for z in teil.split("\n") if z.startswith("| Takt/Schlag/Phrase für Beat"))
    links, rechts = _tabellenspalten(z)[:2]
    beats = [_zahl(b.strip())[0] for b in links.split("Beat", 1)[1].split("/")]
    tsp = [re.fullmatch(r"(\d+)\.(\d) P(\d+)", r.strip()).groups() for r in rechts.split("/")]
    return [(b, int(t), int(s), int(p)) for b, (t, s, p) in zip(beats, tsp)]


def konfig_schluessel(text: str) -> list[tuple[str, str, str, object]]:
    """Tabelle §2.1: [(datei, schluessel, typ, vorgabe)], vorgabe None, wenn der Text keine nennt."""
    teil, _ = abschnitt(text, 2)
    unter = teil.split("### 2.1", 1)[1]
    ergebnis = []
    datei = ""
    for z in unter.split("\n"):
        if not z.startswith("| ") or z.startswith("| Datei") or z.startswith("|---"):
            continue
        spalten = _tabellenspalten(z)
        if spalten[0]:
            datei = spalten[0].strip("`")
        namen = _namen(spalten[1])
        typ = spalten[2]
        vorgaben = [v.strip() for v in spalten[3].split(", ")] if not spalten[3].startswith("(") else [None] * len(namen)
        if len(vorgaben) != len(namen):
            raise ValueError(f"§2.1: {len(namen)} Schlüssel, {len(vorgaben)} Vorgaben in Zeile: {z}")
        for n, v in zip(namen, vorgaben):
            ergebnis.append((datei, n, typ, _vorgabe(typ, v)))
    return ergebnis


def _vorgabe(typ: str, v: str | None):
    if v is None:
        return None
    v = v.strip("`")
    if typ in ("str", "Pfad"):
        return v[1:-1] if v.startswith('"') and v.endswith('"') else v
    if typ == "bool":
        return {"true": True, "false": False}[v]
    v = v.replace("−", "-")
    return int(v) if typ == "int" else float(v)
