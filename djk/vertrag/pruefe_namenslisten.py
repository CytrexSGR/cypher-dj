#!/usr/bin/env python3
"""Vertragstest L3: Namenslisten für Tasten, Deck-Aktionen und Regler-Pfade gegeneinander.

Quellen der Wahrheit: osc.json (Tasten), SCHNITTSTELLEN.md §7.2 (Deck-Aktionen; keine Maschinenquelle) und die
Regler-Tabelle der Attrappe (vertrag.mjs REGLER) gegen kurven.js ZIELE, hand_bedienung.PFAD und die Mappings.
Jede Liste wird mit eigenem Parser aus der Quelldatei gelesen; ein Parser, der nichts, eine leere Liste, die falsche
Zahl oder ein Token nicht versteht, wirft ParserFehler (nie ein leeres Grün). Fehlende Schlüssel und unlesbare Dateien
sind ebenfalls ParserFehler, nie ein Traceback. Die Encoder-Tasten (test_taste_pfad) und die /test/hand-Deck-Tasten
(deck_taste_pfad) kommen aus den Rümpfen dieser Funktionen in hand_ein.h (Kommentare entfernt). Gelesen werden genau
die Ablehnungsbedingung vor `*t = k` und die ist_-Deklarationen samt r-Zugriffen; dort ist jede fremde Form
(strcmp statt Vergleich, Taste:: ohne hand::, r außerhalb der Deklarationen) ParserFehler. Beide Richtungen werden
verglichen: Encoder gegen SCHNITTSTELLEN (Encoder-Werte), Deck-Tasten gegen kurven.js DECK_TASTEN. Der Annahme-Weg
(T09/T10) hat ein festes Soll (ANNAHME_SOLL), keine Wildcard.
NICHT geprüft (offen): Ablehnungen oder Tasten in anderer Form außerhalb der gelesenen Stellen von hand_ein.h
(eigene if-Zweige oder strcmp in test_taste_pfad vor oder nach der Bedingung, Zugriffe über p statt r in
deck_taste_pfad, Überladungen dieser Funktionen); LED-Namen (§7.4, keine Maschinenquelle); der Abgleich der
Regler-Tabelle der Attrappe mit
stellwerk/regler.cpp (ein eigener Vergleich, hier nicht gelesen); ob hand_ein.h die Tasten tatsächlich so verarbeitet,
wie der Rumpf sie ablehnt (nur Namen, kein Verhalten); ANNAHME_SOLL selbst ist hier festgelegt und kennt nur die
Begründung im Kommentar (server.ts:1685-1688), keine Maschinenquelle.
Aufruf: python3 djk/vertrag/pruefe_namenslisten.py [--wurzel DIR] [--rev GITREV]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

sys.dont_write_bytecode = True
HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402

# ---- begründete Ausnahmen: (Liste, Name) -> Grund. Jede Ausnahme MUSS einen Befund unterdrücken, den _diff sonst
# gemeldet hätte, sonst meldet der Test sie als veraltet. "*" deckt nur fehlende Namen, nie überzählige.
AUSNAHMEN = {
    ("T11 tastatur.h", "spielart_start"): "OFFEN: Softcontroller hat kein Kürzel; Absicht ungeprüft",
    ("T11 tastatur.h", "kiste_laden"): "OFFEN: Softcontroller hat kein Kürzel; Absicht ungeprüft",
    ("A05 hand.mjs DECK_AKTION", "pfl"): "pfl ist Regler-Pfad deck/<n>/pfl (REGLER), keine Deck-Aktion (mapping.h:38)",
    ("A03 namen.cpp", "pfl"): "wie oben: pfl läuft als Regler",
    ("A02 mapping.h enum", "pfl"): "wie oben: der Enum kennt pfl nie, es ist Regler-Pfad deck/<n>/pfl (mapping.h:38)",
}
# Annahme-Weg der Seite: genau diese vier Knöpfe (server.ts:1685-1688), sonst 400 unbekannte_taste. Festes Soll statt
# Wildcard: Schrumpfen bis zur leeren Liste fällt auf.
ANNAHME_SOLL = ["annehmen", "freigabe", "stopp", "verwerfen"]


class ParserFehler(Exception):
    pass


class Quelle:
    """Dateien aus einem Verzeichnis oder aus einem Git-Stand (git show), nie schreibend."""

    def __init__(self, wurzel: Path | None = None, rev: str | None = None):
        self.wurzel = Path(wurzel).resolve() if wurzel else HIER.parents[1]
        self.rev = rev
        self.gelesen: set[str] = set()   # alle Quelldateien dieses Laufs (die Tests kopieren genau diese)

    def lies(self, rel: str) -> str:
        self.gelesen.add(rel)
        try:
            if self.rev:
                return subprocess.run(["git", "-C", str(self.wurzel), "show", f"{self.rev}:{rel}"], check=True,
                                      capture_output=True, text=True).stdout
            return (self.wurzel / rel).read_text(encoding="utf-8")
        except (OSError, subprocess.CalledProcessError, UnicodeDecodeError) as fehler:
            raise ParserFehler(f"{rel}: nicht lesbar ({fehler})") from fehler

    def mappings(self) -> list[str]:
        d = "djk/konfig/controller"
        if self.rev:
            aus = subprocess.run(["git", "-C", str(self.wurzel), "ls-tree", "--name-only", f"{self.rev}:{d}"],
                                 check=True, capture_output=True, text=True).stdout.split()
            return [f"{d}/{n}" for n in aus if n.endswith(".json")]
        return sorted(str(p.relative_to(self.wurzel)) for p in (self.wurzel / d).glob("*.json"))

    def node_json(self, ausdruck: str):
        """Wertet ein ES-Modul-Skript in node aus (nur Lesen). Nur im Arbeitsbaum möglich."""
        if self.rev:
            raise ParserFehler("node-Auswertung nur im Arbeitsbaum")
        self.gelesen.update(re.findall(r"@@/([^'\"]+)", ausdruck))
        r = subprocess.run(["node", "--input-type=module", "-e", ausdruck.replace("@@", self.wurzel.as_posix())],
                           capture_output=True, text=True, timeout=20)
        if r.returncode != 0:
            raise ParserFehler(f"node-Auswertung fehlgeschlagen (Exit {r.returncode}): {r.stderr.strip()[:600]}")
        try:
            return json.loads(r.stdout)
        except ValueError as fehler:
            raise ParserFehler(f"node-Auswertung lieferte kein JSON ({fehler}): {r.stdout.strip()[:300]}") from fehler


def _strip_cpp(text: str) -> str:
    return re.sub(r"//[^\n]*", "", text)


def _namen(text: str) -> list[str]:
    return [dopp or einf for dopp, einf in re.findall(r'"([^"]+)"|\'([^\']+)\'', text)]


def _such(muster: str, text: str, wo: str, flags: int = 0) -> re.Match:
    treffer = re.search(muster, text, flags)
    if not treffer:
        raise ParserFehler(f"{wo}: Muster nicht gefunden ({muster[:50]}), Parser blind oder Quelle umgebaut")
    return treffer


def _index(text: str, marke: str, wo: str, ab: int = 0) -> int:
    pos = text.find(marke, ab)
    if pos < 0:
        raise ParserFehler(f"{wo}: Marke {marke!r} nicht gefunden, Parser blind oder Quelle umgebaut")
    return pos


# Normalform einer Deck-Aktion: Zahlen im Namen werden zum Platzhalter, wie §7.2 sie schreibt
_PLATZHALTER = [
    (r"^(hotcue|hotcue_setzen)/\d+$", r"\1/<nr>"),
    (r"^(roll|loop)/[\d.]+$", r"\1/<beats>"),
    (r"^sprung/[+-][\d.]+$", "sprung/<+-beats>"),
]


def norm_aktion(aktion: str) -> str:
    for muster, ersatz in _PLATZHALTER:
        aktion = re.sub(muster, ersatz, aktion)
    return aktion


# hand.mjs DECK_AKTION steht als Regex-Quelltext; jede Zahlenklasse wird zu einem Beispielwert, in dieser Reihenfolge
_ZAHLENKLASSEN = [
    (r"\\/\[0-9\.\]\+", "/1.5"),
    (r"\\/\[\+-\]\[0-9\.\]\+", "/+1.5"),
    (r"\\/\[1-8\]", "/1"),
]


def _regex_alternative_zu_aktion(alternative: str) -> str:
    for muster, beispiel in _ZAHLENKLASSEN:
        alternative = re.sub(muster, beispiel, alternative)
    return norm_aktion(alternative.replace("\\/", "/"))


def _rumpf(text: str, kopf: str, wo: str) -> str:
    """Rumpf einer Funktion von der Signatur bis zur schließenden Klammer in Spalte 0 (Quelle ist so formatiert)."""
    start = _index(text, kopf, wo)
    return text[start:_index(text, "\n}", f"{wo} (Ende von {kopf})", start)]


def _encoder_aus_hand_ein(hand_ein: str) -> list[str]:
    """Tasten, die test_taste_pfad (/test/hand taste/<name>) ablehnt: genau die Bedingung des if vor `*t = k`.
    Jede andere Form als `k == hand::Taste::<name>` verbunden mit `||` ist ParserFehler."""
    wo = "hand_ein.h test_taste_pfad"
    rumpf = _strip_cpp(_rumpf(hand_ein, "inline bool test_taste_pfad(", wo))
    treffer = re.search(r"if \(([^;]*?)\)\s*return false;\s*\*t = k;", rumpf)
    if not treffer:
        raise ParserFehler(f"{wo}: Ablehnungsbedingung vor '*t = k;' nicht gefunden, Parser blind oder Quelle umgebaut")
    bedingung = " ".join(treffer.group(1).split())
    if not re.fullmatch(r"k == hand::Taste::\w+( \|\| k == hand::Taste::\w+)*", bedingung):
        raise ParserFehler(f"{wo}: Bedingung hat eine unbekannte Form (erlaubt: k == hand::Taste::<name> mit ||): "
                           f"{bedingung}")
    return sorted(set(re.findall(r"hand::Taste::(\w+)", bedingung)))


def _deck_tasten_aus_hand_ein(hand_ein: str) -> list[str]:
    """Deck-Tasten, die deck_taste_pfad (/test/hand deck/<n>/<name>) annimmt: jede `const bool ist_<x> = r[0] == ...
    && r[n] == '\\0';` im Rumpf. Alles andere im Rumpf, was r benutzt, und jede ist_-Variable, die das abschließende
    if nicht verwendet (oder umgekehrt), ist ParserFehler."""
    wo = "hand_ein.h deck_taste_pfad"
    rumpf = _strip_cpp(_rumpf(hand_ein, "inline bool deck_taste_pfad(", wo))
    deklarationen = re.findall(r"const bool ist_(\w+) = ([^;]*);", rumpf)
    if not deklarationen:
        raise ParserFehler(f"{wo}: keine ist_-Deklaration gefunden, Parser blind oder Quelle umgebaut")
    tasten = []
    for name, ausdruck in deklarationen:
        if not re.fullmatch(r"(r\[\d\] == '[^'\\]' && )+r\[\d\] == '\\0'", ausdruck.strip()):
            raise ParserFehler(f"{wo}: ist_{name} hat eine unbekannte Form: {ausdruck.strip()}")
        tasten.append("".join(re.findall(r"r\[\d\] == '([^'\\])'", ausdruck)))
    rest = re.sub(r"const bool ist_\w+ = [^;]*;", "", rumpf)
    rest = rest.replace("const char* r = p + 7;", "")
    abnahme = re.search(r"if \((!ist_\w+(?: && !ist_\w+)*)\) return false;", rest)
    if not abnahme:
        raise ParserFehler(f"{wo}: abschließendes 'if (!ist_.. && ..) return false;' nicht gefunden")
    rest = rest.replace(abnahme.group(0), "")
    benutzt = sorted(x[1:].removeprefix("ist_") for x in abnahme.group(1).split(" && "))
    if benutzt != sorted(n for n, _ in deklarationen):
        abweichend = sorted(set(benutzt) ^ {n for n, _ in deklarationen})
        raise ParserFehler(f"{wo}: Deklaration und abschließendes if stimmen nicht überein bei "
                           f"{['ist_' + n for n in abweichend]}")
    if re.search(r"\br\b", rest):
        raise ParserFehler(f"{wo}: r wird außerhalb der ist_-Deklarationen benutzt (neue Taste auf anderem Weg?)")
    return sorted(tasten)


def _encoder_aus_spec(spec: str) -> list[str]:
    """SCHNITTSTELLEN: `taste/<name>` mit den Namen aus §5.8 ohne die Encoder-Werte (`a`, `b`, ...)."""
    treffer = re.search(r"ohne die\s+Encoder-Werte \(([^)]*)\)", spec)
    if not treffer:
        raise ParserFehler("SCHNITTSTELLEN: 'ohne die Encoder-Werte (...)' nicht gefunden, "
                           "Parser blind oder Text umgebaut")
    namen = re.findall(r"`([^`]+)`", treffer.group(1))
    if not namen:
        raise ParserFehler("SCHNITTSTELLEN: Encoder-Werte ohne Namen in Backticks")
    return sorted(namen)


def _mapping_json(q: Quelle, rel: str) -> list[dict]:
    try:
        eintraege = json.loads(q.lies(rel))["eintraege"]
    except (ValueError, KeyError, TypeError) as fehler:
        raise ParserFehler(f"{rel}: kein Mapping mit 'eintraege' ({fehler})") from fehler
    for nr, eintrag in enumerate(eintraege):
        if not isinstance(eintrag, dict) or not isinstance(eintrag.get("ziel"), str):
            raise ParserFehler(f"{rel}: Eintrag {nr} hat kein 'ziel' als Text: {str(eintrag)[:120]}")
    return eintraege


# ---------------------------------------------------------------- Parser: Tasten
def tasten_listen(q: Quelle) -> dict[str, list[str]]:
    listen: dict[str, list[str]] = {}
    try:
        listen["T02 osc.json"] = json.loads(q.lies("djk/vertrag/osc.json"))["werte"]["taste"]["liste"]
    except (ValueError, KeyError, TypeError) as fehler:
        raise ParserFehler(f"osc.json: werte.taste.liste fehlt oder ist unlesbar ({fehler!r})") from fehler
    listen["T01 SCHNITTSTELLEN §5.8"] = vertragstext.tasten(q.lies("docs/architektur/SCHNITTSTELLEN.md"))
    adressen_h = q.lies("djk/vertrag/osc_adressen.h")
    listen["T03 osc_adressen.h"] = _namen(
        _such(r"array<std::string_view, \d+> taste\{([^}]*)\}", adressen_h, "osc_adressen.h").group(1))
    adressen_ts = q.lies("djk/vertrag/osc_adressen.ts")
    listen["T04 osc_adressen.ts"] = _namen(
        _such(r"export const TASTE = \[([^\]]*)\]", adressen_ts, "osc_adressen.ts").group(1))
    namen_cpp = q.lies("djk/kern/hand/src/namen.cpp")
    listen["T05 namen.cpp"] = _namen(
        _such(r"TASTEN_NAMEN\[TASTEN\]\s*=\s*\{([^}]*)\}", namen_cpp, "namen.cpp").group(1))
    mapping_h = _strip_cpp(q.lies("djk/kern/hand/include/hand/mapping.h"))
    enum_taste = _such(r"enum class Taste : uint8_t \{([^}]*)\}", mapping_h, "mapping.h").group(1)
    listen["T06 mapping.h enum"] = [x.strip() for x in enum_taste.split(",") if x.strip()]
    test_namen = q.lies("djk/kern/hand/tests/test_namen.cpp")
    listen["T07 test_namen.cpp"] = _namen(
        _such(r"const char\* namen\[\] = \{([^}]*)\}", test_namen, "test_namen.cpp").group(1))
    hand_mjs = q.lies("djk/vertrag/attrappe_kern/hand.mjs")
    listen["T08 hand.mjs TASTEN"] = _namen(
        _such(r"const TASTEN = new Set\(\[([^\]]*)\]", hand_mjs, "hand.mjs").group(1))
    server_ts = q.lies("djk/oberflaeche/server.ts")
    listen["T09 server.ts TASTEN"] = _namen(_such(r"const TASTEN = \[([^\]]*)\]", server_ts, "server.ts").group(1))
    app_js = q.lies("djk/oberflaeche/oeffentlich/app.js")
    listen["T10 app.js Tasten"] = _namen(
        _such(r"for \(const n of \[([^\]]*)\]\) \$\(`#t-", app_js, "app.js").group(1))
    tastatur_h = q.lies("djk/werkzeuge/softcontroller/tastatur.h")
    listen["T11 tastatur.h"] = sorted(set(re.findall(r'"taste/([a-z_]+)"', tastatur_h)))
    soft = _mapping_json(q, "djk/konfig/controller/softcontroller.json")
    listen["T12 softcontroller.json"] = sorted({e["ziel"][6:] for e in soft if e["ziel"].startswith("taste/")})
    hand_ein_h = q.lies("djk/kern/include/cypherdj/hand_ein.h")
    listen["T13 hand_ein.h Encoder"] = _encoder_aus_hand_ein(hand_ein_h)
    listen["T14 SCHNITTSTELLEN Encoder-Werte"] = _encoder_aus_spec(q.lies("docs/architektur/SCHNITTSTELLEN.md"))
    leer = [name for name, liste in listen.items() if not liste]
    if leer:
        raise ParserFehler(f"leere Liste(n) {leer}: Quelle leergeräumt oder Parser blind")
    return listen


# ---------------------------------------------------------------- Parser: Deck-Aktionen
MAPN = {"hotcue": "hotcue/<nr>", "hotcue_setzen": "hotcue_setzen/<nr>", "roll": "roll/<beats>",
        "sprung": "sprung/<+-beats>", "loop_fest": "loop/<beats>"}
# Regler-Pfade unter deck/<n>/, die keine Aktion sind (Kanalzug, Zuweisung, Kompressor)
_KEINE_AKTION = r"^(fader|trim|eq/|kill/|filter|send/|stem/|xseite|ziel|komp/)"
_AKTION_TOKEN = r"[a-z_]+(/<[a-z+\-]+>)?"


def _spec_aktionen(spec: str) -> list[str]:
    """§7.2: die Aktionsliste hinter `deck/<n>/<aktion>`. Ein Token außerhalb des Namensmusters ist ein Fehler."""
    wo = "SCHNITTSTELLEN §7.2"
    start = _index(spec, "- `ziel`: ein Regler-Pfad (§1.5)", wo)
    stueck = spec[start:_index(spec, "- `quant`", wo, start)]
    teil = stueck[_index(stueck, "`deck/<n>/<aktion>`", wo):_index(stueck, "`tempo`", wo)]
    tokens = [t.replace("<±beats>", "<+-beats>") for t in re.findall(r"`([^`]+)`", teil)[1:]]
    verworfen = [t for t in tokens if not re.fullmatch(_AKTION_TOKEN, t)]
    if verworfen:
        raise ParserFehler(f"{wo}: Token passt nicht ins Aktionsmuster {_AKTION_TOKEN}: {verworfen}")
    return sorted(tokens)


def aktionen_listen(q: Quelle) -> dict[str, list[str]]:
    listen: dict[str, list[str]] = {}
    listen["A01 SCHNITTSTELLEN §7.2"] = _spec_aktionen(q.lies("docs/architektur/SCHNITTSTELLEN.md"))
    mapping_h = _strip_cpp(q.lies("djk/kern/hand/include/hand/mapping.h"))
    enum_aktion = _such(r"enum class DeckAktion : uint8_t \{([^}]*)\}", mapping_h, "mapping.h").group(1)
    listen["A02 mapping.h enum"] = sorted({MAPN.get(x.strip(), x.strip()) for x in enum_aktion.split(",") if x.strip()})
    namen_cpp = q.lies("djk/kern/hand/src/namen.cpp")
    tabelle = _such(r"AKTIONEN\[\] = \{(.*?)\};", namen_cpp, "namen.cpp", re.S).group(1)
    aus_schalter = re.findall(r'case DeckAktion::(\w+): return "', namen_cpp)
    aus_tabelle = re.findall(r'\{"(\w+)", DeckAktion', tabelle)
    listen["A03 namen.cpp"] = sorted({MAPN.get(x, x) for x in aus_tabelle} | {MAPN.get(x, x) for x in aus_schalter})
    mapping_cpp = q.lies("djk/kern/hand/src/mapping.cpp")
    praefixe = re.findall(r'strncmp\(a, "([a-z_]+)/", \d+\)', mapping_cpp)
    listen["A04 mapping.cpp Präfixe"] = sorted({{**MAPN, "loop": "loop/<beats>"}.get(p, p + "/<x>") for p in praefixe})
    hand_mjs = q.lies("djk/vertrag/attrappe_kern/hand.mjs")
    alternativen = _such(r"const DECK_AKTION = /\^deck\\/\(\[1-4\]\)\\/\((.*?)\)\$/;", hand_mjs,
                         "hand.mjs DECK_AKTION").group(1)
    listen["A05 hand.mjs DECK_AKTION"] = sorted({_regex_alternative_zu_aktion(a) for a in alternativen.split("|")})
    kurven_js = q.lies("djk/oberflaeche/oeffentlich/kurven.js")
    listen["A06 kurven.js DECK_TASTEN"] = sorted(
        _namen(_such(r"const DECK_TASTEN = \[([^\]]*)\]", kurven_js, "kurven.js").group(1)))
    listen["A07 hand_ein.h /test/hand"] = _deck_tasten_aus_hand_ein(q.lies("djk/kern/include/cypherdj/hand_ein.h"))
    leer = [name for name, liste in listen.items() if not liste]
    if leer:
        raise ParserFehler(f"leere Liste(n) {leer}: Quelle leergeräumt oder Parser blind")
    for rel in q.mappings():
        ziele = [e["ziel"] for e in _mapping_json(q, rel)]
        aktionen = set()
        for ziel in ziele:
            treffer = re.match(r"^deck/[1-4]/(.+)$", ziel)
            if treffer and not re.match(_KEINE_AKTION, treffer.group(1)):
                aktionen.add(norm_aktion(treffer.group(1)))
        listen[f"A1x {Path(rel).name}"] = sorted(aktionen)
    return listen


# ---------------------------------------------------------------- Regeln
def _diff(befunde: list[str], regel: str, soll: list[str], ist: list[str], ort_ist: str,
          ausnahme_von: str | None = None, genutzt: set | None = None) -> None:
    """Meldet Namen, die in soll stehen und in ist fehlen (fehlt) oder umgekehrt (extra), abzüglich begründeter
    Ausnahmen. Als genutzt gilt eine Ausnahme nur, wenn sie hier einen Befund tatsächlich unterdrückt hat."""
    fehlt = set(soll) - set(ist)
    extra = set(ist) - set(soll)
    for art, menge in (("fehlt", fehlt), ("steht ohne Vertrag", extra)):
        for name in sorted(menge):
            schluessel = [(ausnahme_von, name)] + ([(ausnahme_von, "*")] if art == "fehlt" else [])
            getroffen = next((k for k in schluessel if k in AUSNAHMEN), None)
            if getroffen:
                if genutzt is not None:
                    genutzt.add(getroffen)
            else:
                befunde.append(f"{regel}: {ort_ist} {art}: {name}")


def _pruefe_tasten(q: Quelle, befunde: list[str], genutzt: set) -> list[str]:
    tasten = tasten_listen(q)
    vertrag = tasten["T02 osc.json"]
    encoder = tasten["T13 hand_ein.h Encoder"]
    if len(vertrag) != len(set(vertrag)) or not vertrag:
        befunde.append("Tasten: osc.json leer oder doppelt")
    for liste in ("T01 SCHNITTSTELLEN §5.8", "T03 osc_adressen.h", "T04 osc_adressen.ts", "T05 namen.cpp",
                  "T06 mapping.h enum", "T07 test_namen.cpp", "T08 hand.mjs TASTEN"):
        _diff(befunde, "Tasten=osc.json", vertrag, tasten[liste], liste, liste, genutzt)
    for liste in ("T05 namen.cpp", "T06 mapping.h enum"):   # Index = Enum-Wert (static_cast<Taste>(i) in namen.cpp)
        if tasten[liste] != vertrag:
            befunde.append(f"Tasten-Reihenfolge: {liste} weicht von osc.json ab (Index ist Enum-Wert)")
    _diff(befunde, "Encoder=§19.0", tasten["T14 SCHNITTSTELLEN Encoder-Werte"], encoder, "T13 hand_ein.h Encoder")
    for name in encoder:
        if name not in vertrag:
            befunde.append(f"Encoder: hand_ein.h lehnt {name} ab, osc.json kennt es nicht")
    # Annahme-Weg: Server und Seite gleich und gleich ANNAHME_SOLL, Teilmenge des Vertrags und von hand.mjs, keine
    # Encoder (Kern lehnt sie ab).
    server, seite = tasten["T09 server.ts TASTEN"], tasten["T10 app.js Tasten"]
    if sorted(server) != sorted(seite):
        befunde.append(f"Annahme-Weg: server.ts {server} != app.js {seite}")
    for liste in ("T09 server.ts TASTEN", "T10 app.js Tasten"):
        for name in sorted(set(tasten[liste]) - set(vertrag)):
            befunde.append(f"Annahme-Weg=osc.json: {liste} steht ohne Vertrag: {name}")
        if sorted(tasten[liste]) != ANNAHME_SOLL:
            befunde.append(f"Annahme-Weg: {liste} {sorted(tasten[liste])} weicht vom Soll {ANNAHME_SOLL} ab")
    for name in server:
        if name in encoder:
            befunde.append(f"Annahme-Weg: server.ts lässt Encoder-Taste {name} zu, der Kern lehnt sie ab (hand_ein.h)")
        if name not in tasten["T08 hand.mjs TASTEN"]:
            befunde.append(f"Annahme-Weg: {name} fehlt in hand.mjs")
    # Softcontroller: tastatur.h = Mapping, beide Teilmenge; Lücken nur als begründete Ausnahme
    if tasten["T11 tastatur.h"] != tasten["T12 softcontroller.json"]:
        abweichung = sorted(set(tasten["T11 tastatur.h"]) ^ set(tasten["T12 softcontroller.json"]))
        befunde.append(f"Softcontroller: tastatur.h {abweichung} weicht von softcontroller.json ab")
    softcontroller = "T11 tastatur.h"
    _diff(befunde, "Softcontroller-Tasten", vertrag, tasten[softcontroller], softcontroller, softcontroller, genutzt)
    return vertrag


def _pruefe_aktionen(q: Quelle, befunde: list[str], genutzt: set) -> None:
    listen = aktionen_listen(q)
    spec = listen["A01 SCHNITTSTELLEN §7.2"]
    hand_mjs = listen["A05 hand.mjs DECK_AKTION"]
    praefixe = listen["A04 mapping.cpp Präfixe"]
    if not spec:
        befunde.append("Deck-Aktionen: §7.2 leer")
    # pfl ist in §7.2 eine Aktion, im Kern aber ein Regler-Pfad: A02, A03 und A05 kennen es nur über begründete
    # Ausnahmen
    _diff(befunde, "Aktionen=§7.2", spec, listen["A02 mapping.h enum"], "A02 mapping.h enum", "A02 mapping.h enum",
          genutzt)
    _diff(befunde, "Aktionen=§7.2", spec, listen["A03 namen.cpp"], "A03 namen.cpp", "A03 namen.cpp", genutzt)
    _diff(befunde, "Aktionen=§7.2", spec, hand_mjs, "A05 hand.mjs DECK_AKTION", "A05 hand.mjs DECK_AKTION", genutzt)
    for name in praefixe:
        if name.endswith("/<x>") or name not in spec:
            befunde.append(f"Aktionen: mapping.cpp parst Präfix {name}, §7.2 kennt es nicht")
    for name in spec:
        if "<" in name and name not in praefixe:
            befunde.append(f"Aktionen: §7.2 nennt {name}, mapping.cpp hat keinen Zweig dafür")
    _diff(befunde, "Deck-Tasten=kurven.js", listen["A06 kurven.js DECK_TASTEN"], listen["A07 hand_ein.h /test/hand"],
          "A07 hand_ein.h /test/hand")
    for liste in ("A06 kurven.js DECK_TASTEN", "A07 hand_ein.h /test/hand"):
        for name in listen[liste]:
            if name not in spec:
                befunde.append(f"Aktionen: {liste} kennt {name}, §7.2 nicht")
    for liste, aktionen in listen.items():
        if not liste.startswith("A1x"):
            continue
        # jedes Mapping unter konfig/controller: nur Aktionen, die §7.2 kennt UND hand.mjs akzeptiert
        for name in aktionen:
            if name not in spec:
                befunde.append(f"Mapping {liste}: Ziel deck/<n>/{name} ist nicht in §7.2")
            elif name not in hand_mjs and name != "pfl":
                befunde.append(
                    f"Mapping {liste}: Ziel deck/<n>/{name} lehnt die Attrappe hand.mjs ab (unbekannter_regler)")


_KANALZUG_ZIEL = r"^deck/\d/(fader|trim|eq|kill|filter|send|stem|xseite|ziel|komp|pfl)"


def _pruefe_mappings(q: Quelle, befunde: list[str], tasten_vertrag: list[str]) -> None:
    """Ziele aller Mappings, die keine Regler sind: taste/<name> im Vertrag, deck/<n> mit n von 1 bis 4."""
    for rel in q.mappings():
        for eintrag in _mapping_json(q, rel):
            ziel = eintrag["ziel"]
            if ziel.startswith("taste/") and ziel[6:] not in tasten_vertrag:
                befunde.append(f"Mapping {Path(rel).name}: Taste-Ziel {ziel} ist nicht in osc.json")
            if ziel.startswith("deck/") and not re.match(r"^deck/[1-4]/", ziel):
                befunde.append(f"Mapping {Path(rel).name}: Ziel {ziel}: Deck-Nummer außerhalb 1 bis 4")


def _pruefe_regler(q: Quelle, befunde: list[str]) -> None:
    ausgewertet = q.node_json(
        "const v=await import('file://@@/djk/vertrag/attrappe_kern/vertrag.mjs');"
        "const k=await import('file://@@/djk/oberflaeche/oeffentlich/kurven.js');"
        "console.log(JSON.stringify({r:[...v.REGLER.keys()],z:[...k.ZIELE]}))")
    regler, ziele = set(ausgewertet["r"]), set(ausgewertet["z"])
    pfad_quelltext = _such(r"export const PFAD = /(.*)/;", q.lies("djk/oberflaeche/hand_bedienung.ts"),
                           "hand_bedienung.ts").group(1)
    pfad = re.compile(pfad_quelltext.replace("\\/", "/"))
    for name in sorted(regler):
        if not pfad.search(name):
            befunde.append(f"Regler: attrappe REGLER kennt {name}, hand_bedienung.PFAD lehnt es ab")
    for name in sorted(ziele - regler):
        if not re.fullmatch(r"deck/[12]/(play|cue)", name):
            befunde.append(f"Regler: kurven.js ZIELE enthält {name}, attrappe REGLER nicht")
    for rel in q.mappings():
        for eintrag in _mapping_json(q, rel):
            ziel = eintrag["ziel"]
            if ziel.startswith(("taste/", "deck/")) and not re.match(_KANALZUG_ZIEL, ziel):
                continue   # Tasten und Deck-Aktionen laufen über die Listen oben, nicht über REGLER
            if ziel != "tempo" and ziel not in regler:
                befunde.append(f"Mapping {Path(rel).name}: Regler-Ziel {ziel} kennt die Attrappe nicht")


def pruefe(q: Quelle) -> list[str]:
    befunde: list[str] = []
    genutzt: set = set()
    tasten_vertrag = _pruefe_tasten(q, befunde, genutzt)
    _pruefe_aktionen(q, befunde, genutzt)
    _pruefe_mappings(q, befunde, tasten_vertrag)
    if q.rev:
        print(f"Hinweis: --rev {q.rev}: Regler-Teil übersprungen (node wertet nur den Arbeitsbaum aus)",
              file=sys.stderr)
    else:
        _pruefe_regler(q, befunde)
    for schluessel in AUSNAHMEN:
        if schluessel not in genutzt:
            befunde.append(f"Ausnahme veraltet (tritt nicht mehr auf, streichen): {schluessel}")
    return befunde


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wurzel", type=Path)
    parser.add_argument("--rev")
    args = parser.parse_args()
    try:
        fehler = pruefe(Quelle(args.wurzel, args.rev))
    except ParserFehler as problem:
        print(f"PARSERFEHLER: {problem}", file=sys.stderr)
        return 2
    for befund in fehler:
        print("ROT:", befund)
    print("ERGEBNIS:", "ROT" if fehler else "GRÜN", f"({len(fehler)} Befunde)")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
