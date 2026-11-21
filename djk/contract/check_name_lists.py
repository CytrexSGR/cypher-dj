#!/usr/bin/env python3
"""Vertragstest L3: Namenslisten für Tasten, Deck-Aktionen und Regler-Pfade gegeneinander.
1.10 Slice 1: dazu grp/<n>/* und pm/fader in denselben Fundorten.
S5r: dazu die Graph-Regler <kanal>/bk/<1..64> (Kanalmenge aus controls.cpp, in alle Fundorte getragen).
1.15 A2 (mix tools): dazu die 345 Werkzeug-Regler gate, util, mb, lim, spektrum/kanal (Quelle: tool_controls.h, strikt gelesen;
dazu INTERFACES §1.5, Attrappe REGLER, controls_info.ts mit Bereich und Vorgabe, hand_bedienung.PFAD und defs.schema.json
als Annahme-Menge gegen ein Universum aller Familien mal aller Kanäle; kein curves.js ZIELE, wie beim Kompressor).
D1 K1 (Spec A11): dazu die Spur-Regler spur/<n>/* in allen sieben Fundorten (Kern-Tabelle controls.cpp, §1.5,
Attrappe REGLER, curves.js ZIELE, controls_info.ts, hand_bedienung.PFAD, defs.schema.json regler_pfad) und die Gründe
(§16.2 mit Kern als Vergeber gegen Attrappe GRUENDE, Attrappe GRUENDE gegen osc.json, Grund-Literale im Kern-Quelltext
djk/core/src gegen osc.json). D1 K1 Slice 10: die Hand-Zielarten arr/<aktion> aus §7.2 gegen mapping.cpp, mapping.h
(ZielArt::arr), hand_in.h (/test/hand) und Attrappe hand.mjs ARR_ZIELE.

Quellen der Wahrheit: osc.json (Tasten), INTERFACES.md §7.2 (Deck-Aktionen; keine Maschinenquelle) und die
Regler-Tabelle der Attrappe (contract.mjs REGLER) gegen curves.js ZIELE, hand_bedienung.PFAD und die Mappings.
Jede Liste wird mit eigenem Parser aus der Quelldatei gelesen; ein Parser, der nichts, eine leere Liste, die falsche
Zahl oder ein Token nicht versteht, wirft ParserFehler (nie ein leeres Grün). Fehlende Schlüssel und unlesbare Dateien
sind ebenfalls ParserFehler, nie ein Traceback. Die Encoder-Tasten (test_taste_pfad) und die /test/hand-Deck-Tasten
(deck_taste_pfad) kommen aus den Rümpfen dieser Funktionen in hand_in.h (Kommentare entfernt). Gelesen werden genau
die Ablehnungsbedingung vor `*t = k` und die ist_-Deklarationen samt r-Zugriffen; dort ist jede fremde Form
(strcmp statt Vergleich, Taste:: ohne hand::, r außerhalb der Deklarationen) ParserFehler. Beide Richtungen werden
verglichen: Encoder gegen INTERFACES (Encoder-Werte), Deck-Tasten gegen curves.js DECK_TASTEN. Der Annahme-Weg
(T09/T10) hat ein festes Soll (ANNAHME_SOLL), keine Wildcard.
NICHT geprüft (offen): Ablehnungen oder Tasten in anderer Form außerhalb der gelesenen Stellen von hand_in.h
(eigene if-Zweige oder strcmp in test_taste_pfad vor oder nach der Bedingung, Zugriffe über p statt r in
deck_taste_pfad, Überladungen dieser Funktionen); LED-Namen (§7.4, keine Maschinenquelle); der Abgleich der
Regler-Tabelle der Attrappe mit
stellwerk/regler.cpp (ein eigener Vergleich, hier nicht gelesen); ob hand_in.h die Tasten tatsächlich so verarbeitet,
wie der Rumpf sie ablehnt (nur Namen, kein Verhalten); ANNAHME_SOLL selbst ist hier festgelegt und kennt nur die
Begründung im Kommentar (server.ts:1685-1688), keine Maschinenquelle.
Container core V6: the expected channel sets no longer come from controls.cpp loops but from pult.json (generate_pult.py): four
containers (deck/1, deck/2, pad/1, pad/2), four buses, streams strom/1..16 with their bk rows, the player rows deck/1..4/stem/* and the
sends fx/3, fx/4 and master for bk. KERN_NUR = {"transport"}: the player suffix `transport` is a core row only (not hand-addressable,
not in the mock, not in the schema), so it is left out of every comparison. controls.cpp itself is read for markers only (see
pruefe_regler_marker): lane K builds its table from the generated pult_table.h and the checker demands the tokens, never a green
without them. The ranges of komp/sc, gate/sc (0..4) and spektrum/kanal (0..9)
are pinned in SC_BEREICH (D-V3) against the kernel rows, the contract text and the mock.
Aufruf: python3 djk/contract/check_name_lists.py [--wurzel DIR] [--rev GITREV]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

sys.dont_write_bytecode = True
HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import generate_pult as erzeuge_pult  # noqa: E402
import contract_text as vertragstext  # noqa: E402

# ---- begründete Ausnahmen: (Liste, Name) -> Grund. Jede Ausnahme MUSS einen Befund unterdrücken, den _diff sonst
# gemeldet hätte, sonst meldet der Test sie als veraltet. "*" deckt nur fehlende Namen, nie überzählige.
AUSNAHMEN = {
    ("T11 keyboard.h", "spielart_start"): "OFFEN: Softcontroller hat kein Kürzel; Absicht ungeprüft",
    ("T11 keyboard.h", "kiste_laden"): "OFFEN: Softcontroller hat kein Kürzel; Absicht ungeprüft",
    ("A05 hand.mjs DECK_AKTION", "pfl"): "pfl ist Regler-Pfad deck/<n>/pfl (REGLER), keine Deck-Aktion (mapping.h:38)",
    ("A03 names.cpp", "pfl"): "wie oben: pfl läuft als Regler",
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
        self._importiert: set[str] = set()
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
        d = "djk/config/controller"
        if self.rev:
            aus = subprocess.run(["git", "-C", str(self.wurzel), "ls-tree", "--name-only", f"{self.rev}:{d}"],
                                 check=True, capture_output=True, text=True).stdout.split()
            return [f"{d}/{n}" for n in aus if n.endswith(".json")]
        return sorted(str(p.relative_to(self.wurzel)) for p in (self.wurzel / d).glob("*.json"))

    def dateien(self, ordner: str, endung: str) -> list[str]:
        """Dateien eines Ordners mit dieser Endung (relativ zur Wurzel); nur im Arbeitsbaum (wie node_json)."""
        return sorted(str(p.relative_to(self.wurzel)) for p in (self.wurzel / ordner).glob("*" + endung))

    def _mit_importen(self, rel: str) -> None:
        """Books `rel` and every file it imports through a relative specifier (transitively), so that the tests copy what node loads."""
        if rel in self._importiert:
            return
        self._importiert.add(rel)
        self.gelesen.add(rel)
        pfad = self.wurzel / rel
        if pfad.suffix not in (".js", ".mjs", ".ts") or not pfad.is_file():
            return
        text = pfad.read_text(encoding="utf-8")
        for spez in re.findall(r"""(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""", text):
            ziel = Path(os.path.normpath(Path(rel).parent / spez)).as_posix()
            self._mit_importen(ziel)

    def node_json(self, ausdruck: str):
        """Wertet ein ES-Modul-Skript in node aus (nur Lesen). Nur im Arbeitsbaum möglich."""
        if self.rev:
            raise ParserFehler("node-Auswertung nur im Arbeitsbaum")
        for rel in re.findall(r"@@/([^'\"]+)", ausdruck):
            self._mit_importen(rel)
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
    wo = "hand_in.h test_taste_pfad"
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
    wo = "hand_in.h deck_taste_pfad"
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
    """INTERFACES: `taste/<name>` mit den Namen aus §5.8 ohne die Encoder-Werte (`a`, `b`, ...)."""
    treffer = re.search(r"ohne die\s+Encoder-Werte \(([^)]*)\)", spec)
    if not treffer:
        raise ParserFehler("INTERFACES: 'ohne die Encoder-Werte (...)' nicht gefunden, "
                           "Parser blind oder Text umgebaut")
    namen = re.findall(r"`([^`]+)`", treffer.group(1))
    if not namen:
        raise ParserFehler("INTERFACES: Encoder-Werte ohne Namen in Backticks")
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
        listen["T02 osc.json"] = json.loads(q.lies("djk/contract/osc.json"))["werte"]["taste"]["liste"]
    except (ValueError, KeyError, TypeError) as fehler:
        raise ParserFehler(f"osc.json: werte.taste.liste fehlt oder ist unlesbar ({fehler!r})") from fehler
    listen["T01 INTERFACES §5.8"] = vertragstext.tasten(q.lies("docs/architecture/INTERFACES.md"))
    adressen_h = q.lies("djk/contract/osc_addresses.h")
    listen["T03 osc_addresses.h"] = _namen(
        _such(r"array<std::string_view, \d+> taste\{([^}]*)\}", adressen_h, "osc_addresses.h").group(1))
    adressen_ts = q.lies("djk/contract/osc_addresses.ts")
    listen["T04 osc_addresses.ts"] = _namen(
        _such(r"export const TASTE = \[([^\]]*)\]", adressen_ts, "osc_addresses.ts").group(1))
    namen_cpp = q.lies("djk/core/hand/src/names.cpp")
    listen["T05 names.cpp"] = _namen(
        _such(r"TASTEN_NAMEN\[TASTEN\]\s*=\s*\{([^}]*)\}", namen_cpp, "names.cpp").group(1))
    mapping_h = _strip_cpp(q.lies("djk/core/hand/include/hand/mapping.h"))
    enum_taste = _such(r"enum class Taste : uint8_t \{([^}]*)\}", mapping_h, "mapping.h").group(1)
    listen["T06 mapping.h enum"] = [x.strip() for x in enum_taste.split(",") if x.strip()]
    test_namen = q.lies("djk/core/hand/tests/test_names.cpp")
    listen["T07 test_names.cpp"] = _namen(
        _such(r"const char\* namen\[\] = \{([^}]*)\}", test_namen, "test_names.cpp").group(1))
    hand_mjs = q.lies("djk/contract/mock_core/hand.mjs")
    listen["T08 hand.mjs TASTEN"] = _namen(
        _such(r"const TASTEN = new Set\(\[([^\]]*)\]", hand_mjs, "hand.mjs").group(1))
    server_ts = q.lies("djk/ui/server.ts")
    listen["T09 server.ts TASTEN"] = _namen(_such(r"const TASTEN = \[([^\]]*)\]", server_ts, "server.ts").group(1))
    # the page keys moved from app.js to stream.js (1868940b); the list keeps its name, the other checks refer to it
    strom_js = q.lies("djk/ui/public/stream.js")
    listen["T10 app.js Tasten"] = _namen(
        _such(r"for \(const n of \[([^\]]*)\]\) \$\(`#t-", strom_js, "stream.js").group(1))
    tastatur_h = q.lies("djk/tools/softcontroller/keyboard.h")
    listen["T11 keyboard.h"] = sorted(set(re.findall(r'"taste/([a-z_]+)"', tastatur_h)))
    soft = _mapping_json(q, "djk/config/controller/softcontroller.json")
    listen["T12 softcontroller.json"] = sorted({e["ziel"][6:] for e in soft if e["ziel"].startswith("taste/")})
    hand_ein_h = q.lies("djk/core/include/cypherdj/hand_in.h")
    listen["T13 hand_in.h Encoder"] = _encoder_aus_hand_ein(hand_ein_h)
    listen["T14 INTERFACES Encoder-Werte"] = _encoder_aus_spec(q.lies("docs/architecture/INTERFACES.md"))
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
    wo = "INTERFACES §7.2"
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
    listen["A01 INTERFACES §7.2"] = _spec_aktionen(q.lies("docs/architecture/INTERFACES.md"))
    mapping_h = _strip_cpp(q.lies("djk/core/hand/include/hand/mapping.h"))
    enum_aktion = _such(r"enum class DeckAktion : uint8_t \{([^}]*)\}", mapping_h, "mapping.h").group(1)
    listen["A02 mapping.h enum"] = sorted({MAPN.get(x.strip(), x.strip()) for x in enum_aktion.split(",") if x.strip()})
    namen_cpp = q.lies("djk/core/hand/src/names.cpp")
    tabelle = _such(r"AKTIONEN\[\] = \{(.*?)\};", namen_cpp, "names.cpp", re.S).group(1)
    aus_schalter = re.findall(r'case DeckAktion::(\w+): return "', namen_cpp)
    aus_tabelle = re.findall(r'\{"(\w+)", DeckAktion', tabelle)
    listen["A03 names.cpp"] = sorted({MAPN.get(x, x) for x in aus_tabelle} | {MAPN.get(x, x) for x in aus_schalter})
    mapping_cpp = q.lies("djk/core/hand/src/mapping.cpp")
    praefixe = re.findall(r'strncmp\(a, "([a-z_]+)/", \d+\)', mapping_cpp)
    listen["A04 mapping.cpp Präfixe"] = sorted({{**MAPN, "loop": "loop/<beats>"}.get(p, p + "/<x>") for p in praefixe})
    hand_mjs = q.lies("djk/contract/mock_core/hand.mjs")
    alternativen = _such(r"const DECK_AKTION = /\^deck\\/\(\[1-4\]\)\\/\((.*?)\)\$/;", hand_mjs,
                         "hand.mjs DECK_AKTION").group(1)
    listen["A05 hand.mjs DECK_AKTION"] = sorted({_regex_alternative_zu_aktion(a) for a in alternativen.split("|")})
    kurven_js = q.lies("djk/ui/public/curves.js")
    listen["A06 curves.js DECK_TASTEN"] = sorted(
        _namen(_such(r"const DECK_TASTEN = \[([^\]]*)\]", kurven_js, "curves.js").group(1)))
    listen["A07 hand_in.h /test/hand"] = _deck_tasten_aus_hand_ein(q.lies("djk/core/include/cypherdj/hand_in.h"))
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
    encoder = tasten["T13 hand_in.h Encoder"]
    if len(vertrag) != len(set(vertrag)) or not vertrag:
        befunde.append("Tasten: osc.json leer oder doppelt")
    for liste in ("T01 INTERFACES §5.8", "T03 osc_addresses.h", "T04 osc_addresses.ts", "T05 names.cpp",
                  "T06 mapping.h enum", "T07 test_names.cpp", "T08 hand.mjs TASTEN"):
        _diff(befunde, "Tasten=osc.json", vertrag, tasten[liste], liste, liste, genutzt)
    for liste in ("T05 names.cpp", "T06 mapping.h enum"):   # Index = Enum-Wert (static_cast<Taste>(i) in names.cpp)
        if tasten[liste] != vertrag:
            befunde.append(f"Tasten-Reihenfolge: {liste} weicht von osc.json ab (Index ist Enum-Wert)")
    _diff(befunde, "Encoder=§19.0", tasten["T14 INTERFACES Encoder-Werte"], encoder, "T13 hand_in.h Encoder")
    for name in encoder:
        if name not in vertrag:
            befunde.append(f"Encoder: hand_in.h lehnt {name} ab, osc.json kennt es nicht")
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
            befunde.append(f"Annahme-Weg: server.ts lässt Encoder-Taste {name} zu, der Kern lehnt sie ab (hand_in.h)")
        if name not in tasten["T08 hand.mjs TASTEN"]:
            befunde.append(f"Annahme-Weg: {name} fehlt in hand.mjs")
    # Softcontroller: keyboard.h = Mapping, beide Teilmenge; Lücken nur als begründete Ausnahme
    if tasten["T11 keyboard.h"] != tasten["T12 softcontroller.json"]:
        abweichung = sorted(set(tasten["T11 keyboard.h"]) ^ set(tasten["T12 softcontroller.json"]))
        befunde.append(f"Softcontroller: keyboard.h {abweichung} weicht von softcontroller.json ab")
    softcontroller = "T11 keyboard.h"
    _diff(befunde, "Softcontroller-Tasten", vertrag, tasten[softcontroller], softcontroller, softcontroller, genutzt)
    return vertrag


def _pruefe_aktionen(q: Quelle, befunde: list[str], genutzt: set) -> None:
    listen = aktionen_listen(q)
    spec = listen["A01 INTERFACES §7.2"]
    hand_mjs = listen["A05 hand.mjs DECK_AKTION"]
    praefixe = listen["A04 mapping.cpp Präfixe"]
    if not spec:
        befunde.append("Deck-Aktionen: §7.2 leer")
    # pfl ist in §7.2 eine Aktion, im Kern aber ein Regler-Pfad: A02, A03 und A05 kennen es nur über begründete
    # Ausnahmen
    _diff(befunde, "Aktionen=§7.2", spec, listen["A02 mapping.h enum"], "A02 mapping.h enum", "A02 mapping.h enum",
          genutzt)
    _diff(befunde, "Aktionen=§7.2", spec, listen["A03 names.cpp"], "A03 names.cpp", "A03 names.cpp", genutzt)
    _diff(befunde, "Aktionen=§7.2", spec, hand_mjs, "A05 hand.mjs DECK_AKTION", "A05 hand.mjs DECK_AKTION", genutzt)
    for name in praefixe:
        if name.endswith("/<x>") or name not in spec:
            befunde.append(f"Aktionen: mapping.cpp parst Präfix {name}, §7.2 kennt es nicht")
    for name in spec:
        if "<" in name and name not in praefixe:
            befunde.append(f"Aktionen: §7.2 nennt {name}, mapping.cpp hat keinen Zweig dafür")
    _diff(befunde, "Deck-Tasten=curves.js", listen["A06 curves.js DECK_TASTEN"], listen["A07 hand_in.h /test/hand"],
          "A07 hand_in.h /test/hand")
    for liste in ("A06 curves.js DECK_TASTEN", "A07 hand_in.h /test/hand"):
        for name in listen[liste]:
            if name not in spec:
                befunde.append(f"Aktionen: {liste} kennt {name}, §7.2 nicht")
    for liste, aktionen in listen.items():
        if not liste.startswith("A1x"):
            continue
        # jedes Mapping unter config/controller: nur Aktionen, die §7.2 kennt UND hand.mjs akzeptiert
        for name in aktionen:
            if name not in spec:
                befunde.append(f"Mapping {liste}: Ziel deck/<n>/{name} ist nicht in §7.2")
            elif name not in hand_mjs and name != "pfl":
                befunde.append(
                    f"Mapping {liste}: Ziel deck/<n>/{name} lehnt die Attrappe hand.mjs ab (unbekannter_regler)")


# ---------------------------------------------------------------- container core V6: pult.json as the source of the expected sets
KERN_NUR = {"transport"}   # player suffixes that are core rows only: not hand-addressable, not in the mock, not in the schema
PULT_FAMILIEN_ANFANG = {"deck", "pad", "bus", "strom", "erz"}   # first path segment of every row family that pult.json describes
PULT_REL = "djk/contract/pult.json"


def _pult(q: Quelle) -> dict:
    """pult.json, validated by erzeuge_pult.laden; every fault is a ParserFehler (never a silent empty set). Working tree only."""
    q.lies(PULT_REL)   # book-keeping: the tests copy exactly the files the checker read
    q.lies("djk/contract/pult.ts")   # the Attrappe imports it; registered so that the mutation tests copy it
    try:
        return erzeuge_pult.laden(q.wurzel / PULT_REL)
    except erzeuge_pult.PultFehler as fehler:
        raise ParserFehler(f"{PULT_REL}: {fehler}") from fehler


def pult_pfade(d: dict) -> list[str]:
    """Every expanded control path of the four families (zug, bus, player, strom) without the KERN_NUR rows, in family order."""
    aus = [p for fam in erzeuge_pult.FAMILIEN for p in erzeuge_pult.regler_pfade(d, fam)]
    return [p for p in aus if p.split("/", 2)[-1] not in KERN_NUR]


def ist_alias(d: dict, name: str) -> bool:
    """`erz/<n>/<suffix>` with n in alias_stroeme and suffix in alias_suffixe (`bk/<k>` for k in 1..bk_n): a row of the page server's alias layer
    (`alias: true` in pult.json). The core has no such row, so the Attrappe does not carry it; the pages and the controller maps address it."""
    m = re.fullmatch(r"erz/(\d+)/(.+)", name)
    if not m or int(m.group(1)) not in d["alias_stroeme"]:
        return False
    k = re.fullmatch(r"bk/([1-9]\d*)", m.group(2))
    return (1 <= int(k.group(1)) <= d["bk_n"]) if k else m.group(2) in d["alias_suffixe"]


def alias_zu_strom(d: dict, name: str) -> str:
    """The core row an alias bk row stands for (`erz/<n>/bk/<k>` is `strom/<n>/bk/<k>`); every other name stays."""
    return re.sub(r"^erz/(\d+)/bk/", r"strom/\1/bk/", name) if ist_alias(d, name) else name


def _container_pfade(d: dict) -> list[str]:
    return [c["pfad"] for c in d["container"]]


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
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "console.log(JSON.stringify({r:[...v.REGLER.keys()],z:[...k.ZIELE]}))")
    regler, ziele = set(ausgewertet["r"]), set(ausgewertet["z"])
    pfad_quelltext = _such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"),
                           "hand_operation.ts").group(1)
    pfad = re.compile(pfad_quelltext.replace("\\/", "/"))
    for name in sorted(regler):
        if not pfad.search(name):
            befunde.append(f"Regler: attrappe REGLER kennt {name}, R06 hand_bedienung.PFAD lehnt es ab")
    d_alias = _pult(q)
    for name in sorted(ziele - regler):
        if ist_alias(d_alias, name):
            continue   # alias row erz/<n>/<suffix>: lives in the page server, not in the core (decision X1), so the Attrappe does not carry it
        if not re.fullmatch(r"deck/[1-4]/(play|cue)", name):   # deck keys of all four decks (80c70be7) are not controls
            befunde.append(f"Regler: R04 curves.js ZIELE enthält {name}, attrappe REGLER nicht")
    # container core V6: the Attrappe carries exactly the rows pult.json describes (minus KERN_NUR) in its families; every other family
    # (master, cue, fx, spur, grp, ret, ins, rack, ...) is not described there and is read by the checks below
    _diff(befunde, "Regler=pult.json", sorted(pult_pfade(_pult(q))),
          sorted(r for r in regler if r.split("/", 1)[0] in PULT_FAMILIEN_ANFANG), "R03 Attrappe REGLER")
    arr_ziele = set(re.findall(r"'([a-z_/]+)'", _such(r"const ARR_ZIELE = new Set\(\[(.*?)\]\)",
                                                       q.lies("djk/contract/mock_core/hand.mjs"), "hand.mjs ARR_ZIELE").group(1)))
    for rel in q.mappings():
        for eintrag in _mapping_json(q, rel):
            ziel = eintrag["ziel"]
            if ziel.startswith(("taste/", "deck/")) and not re.match(_KANALZUG_ZIEL, ziel):
                continue   # Tasten und Deck-Aktionen laufen über die Listen oben, nicht über REGLER
            if ziel.startswith("arr/") and ziel in arr_ziele:
                continue   # hand target kind of the arrangement (mock_core/hand.mjs ARR_ZIELE), not a control row
            if ist_alias(d_alias, ziel):
                continue   # alias row of the page server (checked against alias_suffixe), the controller maps address streams through it
            if ziel != "tempo" and ziel not in regler:
                befunde.append(f"Mapping {Path(rel).name}: Regler-Ziel {ziel} kennt die Attrappe nicht")


# ---------------------------------------------------------------- D1 K1: Spur-Regler in allen Fundorten (A11)
def spur_regler_listen(q: Quelle) -> tuple[int, dict[str, list[str]]]:
    """Spur-Regler je Fundort; n = SPUR_REGLER_SPUREN aus controls.h. Nur im Arbeitsbaum (node)."""
    regler_h = q.lies("djk/core/signalbox/include/cypherdj/signalbox/controls.h")
    n = int(_such(r"constexpr int SPUR_REGLER_SPUREN = (\d+);", regler_h, "controls.h").group(1))
    felder = re.findall(r'"spur/%d/([a-z_]+(?:/[a-z_]+)?)"', q.lies("djk/core/signalbox/src/controls.cpp"))   # KZ1: eq/<band> has one more segment
    cpp_text = q.lies("djk/core/signalbox/src/controls.cpp")
    if '"spur/%d/kill/%s"' in cpp_text:   # container core K7: the three kill rows come from one loop over {tief, mitte, hoch}
        felder += [f"kill/{b}" for b in re.findall(r'\{"(tief|mitte|hoch)", Rolle::spur_kill_', cpp_text)]
    if not felder:
        raise ParserFehler("controls.cpp: kein Pfad spur/%d/…, Parser blind oder Quelle umgebaut")
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    zeilen = []
    for zelle in re.findall(r"^\| (`spur/<n>/[^|]*?`) \|", teil, re.M):   # KZ1: one row may name several paths: `spur/<n>/eq/tief`, `/eq/mitte`, `/eq/hoch`
        roh = re.findall(r"`([^`]+)`", zelle)
        for p in roh:
            if p.startswith("/"):
                p = "/".join(roh[0].split("/")[:-p.count("/")]) + p
            zeilen.append(p[len("spur/<n>/"):])
    if not zeilen:
        raise ParserFehler("INTERFACES §1.5: keine Zeile spur/<n>/…, Parser blind oder Quelle umgebaut")
    alle = lambda fs: sorted(f"spur/{i}/{f}" for i in range(1, n + 1) for f in fs)   # noqa: E731
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const s=(m)=>[...m].filter((p)=>p.startsWith('spur/')&&!p.includes('/send/')&&!p.includes('/bk/'));"
        "console.log(JSON.stringify({a:s(v.REGLER.keys()),z:s(k.ZIELE),l:s(l.REGLER.keys())}))")
    return n, {"R01 Kern controls.cpp": alle(felder), "R02 INTERFACES §1.5": alle(zeilen),
               "R03 Attrappe REGLER": sorted(aus["a"]), "R04 curves.js ZIELE": sorted(aus["z"]),
               "R05 controls_info.ts": sorted(aus["l"])}


def _db(t: str) -> float:
    return float(t.strip().replace("−", "-").replace("+", "").replace("f", "").replace(",", "."))


def spur_fader_bereiche(q: Quelle) -> dict[str, tuple[float, float, float]]:
    """(min, max, vorgabe) von spur/<n>/fader je Fundort mit Wertebereich (D1 Spec 6.16: −200..+6, Vorgabe 0).
    hand_bedienung.PFAD und defs.schema.json regler_pfad tragen nur den Pfad, keinen Bereich. Nur im Arbeitsbaum."""
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    m = _such(r"Rolle::spur_fader, (-?[\d.]+)f?, (-?[\d.]+)f?, (-?[\d.]+)f?,", cpp, "controls.cpp spur_fader")
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    z = _such(r"^\| `spur/<n>/fader` \| dB \| (\S+) bis (\S+) \| (\S+) \|", teil, "INTERFACES §1.5 spur/<n>/fader",
              re.M)
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const p='spur/1/fader',a=v.REGLER.get(p),r=l.REGLER.get(p);"
        "console.log(JSON.stringify({a:[a.min,a.max,a.vorgabe],l:[r.min,r.max,r.vorgabe],"
        "k:[k.wertAusMidi(p,0),k.wertAusMidi(p,1),k.vorgabe(p)]}))")
    return {"R01 Kern controls.cpp": (_db(m.group(1)), _db(m.group(2)), _db(m.group(3))),
            "R02 INTERFACES §1.5": (_db(z.group(1)), _db(z.group(2)), _db(z.group(3))),
            "R03 Attrappe REGLER": tuple(aus["a"]), "R04 curves.js (Griff 0 und 1, Vorgabe)": tuple(aus["k"]),
            "R05 controls_info.ts": tuple(aus["l"])}


def _pruefe_spur_regler(q: Quelle, befunde: list[str]) -> None:
    for name, ist in (bereiche := spur_fader_bereiche(q)).items():   # D1 Review: Bereich in allen Fundorten wie der Kern
        if any(abs(a - b) > 1e-3 for a, b in zip(ist, bereiche["R01 Kern controls.cpp"])):
            befunde.append(f"Spur-Fader-Bereich=Kern: {name} (min, max, vorgabe) {ist} statt {bereiche['R01 Kern controls.cpp']}")
    n, listen = spur_regler_listen(q)
    soll = listen["R01 Kern controls.cpp"]
    for name, ist in listen.items():
        if name != "R01 Kern controls.cpp":
            _diff(befunde, "Spur-Regler=Kern", soll, ist, name)
    pfad = re.compile(_such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"),
                            "hand_operation.ts").group(1).replace("\\/", "/"))
    try:
        schema = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["regler_pfad"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.regler_pfad.pattern ({fehler})") from fehler
    for name in soll:
        if not pfad.search(name):
            befunde.append(f"Spur-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"Spur-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for falsch in (f"spur/{n + 1}/fader", "spur/0/fader", "spur/1/zz"):   # Gegenprobe: kein Muster zu weit
        if pfad.search(falsch):
            befunde.append(f"Spur-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"Spur-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


# ---------------------------------------------------------------- 1.10 Slice 1: Gruppen-Regler und PM in allen Fundorten (A11)
def routing_regler_listen(q: Quelle) -> tuple[int, dict[str, list[str]]]:
    """grp/<n>/* und pm/fader je Fundort; n = GRP_REGLER_GRUPPEN aus controls.h. Nur im Arbeitsbaum (node)."""
    regler_h = q.lies("djk/core/signalbox/include/cypherdj/signalbox/controls.h")
    n = (int(_such(r"constexpr int GRP_REGLER_GRUPPEN = (\d+);", regler_h, "controls.h").group(1))
         + int(_such(r"constexpr int GRP_REGLER_GRUPPEN_NEU = (\d+);", regler_h, "controls.h").group(1)))   # nested groups task 1: groups 9..16 are the second constant
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    felder = re.findall(r'"grp/%d/([a-z_]+)"', cpp)
    if not felder:
        raise ParserFehler("controls.cpp: kein Pfad grp/%d/…, Parser blind oder Quelle umgebaut")
    if '"pm/fader"' not in cpp:
        raise ParserFehler("controls.cpp: kein Pfad pm/fader, Parser blind oder Quelle umgebaut")
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    zeilen = re.findall(r"^\| `grp/<n>/([a-z_]+)` \|", teil, re.M)
    if not zeilen or not re.search(r"^\| `pm/fader` \|", teil, re.M):
        raise ParserFehler("INTERFACES §1.5: keine Zeile grp/<n>/… oder pm/fader, Parser blind oder Quelle umgebaut")
    alle = lambda fs: sorted([f"grp/{i}/{f}" for i in range(1, n + 1) for f in fs] + ["pm/fader"])   # noqa: E731
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const s=(m)=>[...m].filter((p)=>(p.startsWith('grp/')&&!p.includes('/send/'))||p==='pm/fader');"
        "console.log(JSON.stringify({a:s(v.REGLER.keys()),z:s(k.ZIELE),l:s(l.REGLER.keys())}))")
    return n, {"R01 Kern controls.cpp": alle(felder), "R02 INTERFACES §1.5": alle(zeilen),
               "R03 Attrappe REGLER": sorted(aus["a"]), "R04 curves.js ZIELE": sorted(aus["z"]),
               "R05 controls_info.ts": sorted(aus["l"])}


def routing_fader_bereiche(q: Quelle) -> dict[str, tuple[float, float, float]]:
    """(min, max, vorgabe) von pm/fader je Fundort mit Wertebereich (−200..+6, Vorgabe 0). Nur im Arbeitsbaum."""
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    m = _such(r'neu\("pm/fader", -1, Rolle::pm_fader, (-?[\d.]+)f?, (-?[\d.]+)f?, (-?[\d.]+)f?,', cpp, "controls.cpp pm_fader")
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    z = _such(r"^\| `pm/fader` \| dB \| (\S+) bis (\S+) \| (\S+) \|", teil, "INTERFACES §1.5 pm/fader", re.M)
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const p='pm/fader',a=v.REGLER.get(p),r=l.REGLER.get(p);"
        "console.log(JSON.stringify({a:[a.min,a.max,a.vorgabe],l:[r.min,r.max,r.vorgabe],"
        "k:[k.wertAusMidi(p,0),k.wertAusMidi(p,1),k.vorgabe(p)]}))")
    return {"R01 Kern controls.cpp": (_db(m.group(1)), _db(m.group(2)), _db(m.group(3))),
            "R02 INTERFACES §1.5": (_db(z.group(1)), _db(z.group(2)), _db(z.group(3))),
            "R03 Attrappe REGLER": tuple(aus["a"]), "R04 curves.js (Griff 0 und 1, Vorgabe)": tuple(aus["k"]),
            "R05 controls_info.ts": tuple(aus["l"])}


def _pruefe_routing_regler(q: Quelle, befunde: list[str]) -> None:
    for name, ist in (bereiche := routing_fader_bereiche(q)).items():
        if any(abs(a - b) > 1e-3 for a, b in zip(ist, bereiche["R01 Kern controls.cpp"])):
            befunde.append(f"Routing-Fader-Bereich=Kern: {name} (min, max, vorgabe) {ist} statt {bereiche['R01 Kern controls.cpp']}")
    n, listen = routing_regler_listen(q)
    soll = listen["R01 Kern controls.cpp"]
    for name, ist in listen.items():
        if name != "R01 Kern controls.cpp":
            _diff(befunde, "Routing-Regler=Kern", soll, ist, name)
    pfad = re.compile(_such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"),
                            "hand_operation.ts").group(1).replace("\\/", "/"))
    try:
        schema = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["regler_pfad"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.regler_pfad.pattern ({fehler})") from fehler
    for name in soll:
        if not pfad.search(name):
            befunde.append(f"Routing-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"Routing-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for falsch in (f"grp/{n + 1}/fader", "grp/0/fader", "grp/1/trim", "pm/pan", "pm/fader/x"):   # Gegenprobe: kein Muster zu weit
        if pfad.search(falsch):
            befunde.append(f"Routing-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"Routing-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


# ---------------------------------------------------------------- 1.10 Slice 3: Sends, Returns und Hall-Regler in allen Fundorten (A11)
RET_HALL_FELDER = ("an", "pre", "decay", "groesse", "tief", "highcut", "fahne")


def _kern_return_regler(q: Quelle) -> tuple[list[str], dict[str, tuple[float, float, float]]]:
    """Pfade und (min, max, vorgabe) der Send-, Return- und Hall-Regler aus controls.cpp (Quelle der Wahrheit). Nur im Arbeitsbaum."""
    regler_h = q.lies("djk/core/signalbox/include/cypherdj/signalbox/controls.h")
    nr = int(_such(r"constexpr int RET_REGLER_RETURNS = (\d+);", regler_h, "controls.h").group(1))
    ns = int(_such(r"constexpr int SPUR_REGLER_SPUREN = (\d+);", regler_h, "controls.h").group(1))
    ng = (int(_such(r"constexpr int GRP_REGLER_GRUPPEN = (\d+);", regler_h, "controls.h").group(1))
         + int(_such(r"constexpr int GRP_REGLER_GRUPPEN_NEU = (\d+);", regler_h, "controls.h").group(1)))   # nested groups task 1: groups 9..16 are the second constant
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    for muster in ('"spur/%d/send/%d"', '"grp/%d/send/%d"'):
        if muster not in cpp:
            raise ParserFehler(f"controls.cpp: kein Pfad {muster}, Parser blind oder Quelle umgebaut")
    felder = re.findall(r'"ret/%d/([a-z_]+)"', cpp)
    if not felder or "ret/%d/hall/an" not in cpp or "ret/%d/hall/%s" not in cpp:
        raise ParserFehler("controls.cpp: keine ret/%d/…-Pfade, Parser blind oder Quelle umgebaut")
    alle = re.findall(r'\{"([a-z]+)", Rolle::ret_hall_[a-z]+, (-?[\d.]+)f?\}', cpp)
    # two tables: returns 1..4 (old rows) and returns 5..8 (appended by K6), six values each and identical
    if len(alle) != 12 or alle[:6] != alle[6:]:
        raise ParserFehler(f"controls.cpp: {len(alle)} Hall-Werte statt 2x6 gleiche, Parser blind oder Quelle umgebaut")
    hall = [("an", None)] + alle[:6]
    pfade: list[str] = []
    snd = _such(r"Rolle::snd_spur, (-?[\d.]+)f?, (-?[\d.]+)f?, (-?[\d.]+)f?,", cpp, "controls.cpp snd_spur")
    retf = _such(r"Rolle::ret_fader, (-?[\d.]+)f?, (-?[\d.]+)f?, (-?[\d.]+)f?,", cpp, "controls.cpp ret_fader")
    for r in range(1, nr + 1):
        pfade += [f"spur/{n}/send/{r}" for n in range(1, ns + 1)] + [f"grp/{n}/send/{r}" for n in range(1, ng + 1)]
        pfade += [f"ret/{r}/{f}" for f in felder] + [f"ret/{r}/hall/{f}" for f, _ in hall]
    bereich: dict[str, tuple[float, float, float]] = {
        "spur/1/send/1": tuple(_db(snd.group(i)) for i in (1, 2, 3)),
        "ret/1/fader": tuple(_db(retf.group(i)) for i in (1, 2, 3)),
        "ret/1/hall/an": (0.0, 1.0, 1.0),
    }
    for f, v in hall[1:]:
        bereich[f"ret/1/hall/{f}"] = (0.0, 1.0, _db(v))
    return sorted(pfade), bereich


def return_regler_listen(q: Quelle) -> tuple[dict[str, list[str]], dict[str, dict[str, tuple[float, float, float]]]]:
    """Pfade und Wertebereiche je Fundort. Nur im Arbeitsbaum (node)."""
    kern, kbereich = _kern_return_regler(q)
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    zeilen = re.findall(r"^\| `ret/<r>/([a-z_/]+)`", teil, re.M)
    if not zeilen:
        raise ParserFehler("INTERFACES §1.5: keine Zeile ret/<r>/…, Parser blind oder Quelle umgebaut")
    hat_snd = {w: bool(re.search(rf"^\| `{w}/<n>/send/<r>`", teil, re.M)) for w in ("spur", "grp")}
    if not any(hat_snd.values()):
        raise ParserFehler("INTERFACES §1.5: keine Zeile spur|grp/<n>/send/<r>, Parser blind oder Quelle umgebaut")
    regler_h = q.lies("djk/core/signalbox/include/cypherdj/signalbox/controls.h")
    nr = int(_such(r"constexpr int RET_REGLER_RETURNS = (\d+);", regler_h, "controls.h").group(1))
    spec_pfade = [f"ret/{r}/{f}" for r in range(1, nr + 1) for f in zeilen]
    spec_pfade += [p for p in kern if "/send/" in p and hat_snd[p.split("/")[0]]]
    sbereich: dict[str, tuple[float, float, float]] = {}
    for pfad_spec, key in (("spur/<n>/send/<r>", "spur/1/send/1"), ("ret/<r>/fader", "ret/1/fader")):
        z = _such(rf"^\| `{re.escape(pfad_spec)}`[^|]*\| dB \| (\S+) (?:bis|to) (\S+) \| (\S+) \|", teil,
                  f"INTERFACES §1.5 {pfad_spec}", re.M)
        sbereich[key] = tuple(_db(z.group(i)) for i in (1, 2, 3))
    z = _such(r"^\| `ret/<r>/hall/an`[^|]*\|[^|]*\| (\S+)/(\S+) \| (\S+) \|", teil, "INTERFACES §1.5 ret/<r>/hall/an", re.M)
    sbereich["ret/1/hall/an"] = tuple(_db(z.group(i)) for i in (1, 2, 3))
    for f in RET_HALL_FELDER[1:]:
        z = re.search(rf"^\| `ret/<r>/hall/{f}`[^|]*\|[^|]*\| (\S+) (?:bis|to) (\S+) \| (\S+) \|", teil, re.M)
        if z:   # a missing row is reported as a missing path by the list comparison, not as a blind parser
            sbereich[f"ret/1/hall/{f}"] = tuple(_db(z.group(i)) for i in (1, 2, 3))
    probe = list(kbereich)
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const s=(m)=>[...m].filter((p)=>/^(spur|grp)\\/[0-9]+\\/send\\/[0-9]+$/.test(p)||p.startsWith('ret/'));"
        f"const ps={json.dumps(probe)};"
        "const b=(m)=>Object.fromEntries(ps.map((p)=>[p,[m.get(p)?.min,m.get(p)?.max,m.get(p)?.vorgabe]]));"
        "const kb=Object.fromEntries(ps.map((p)=>[p,[k.wertAusMidi(p,0),k.wertAusMidi(p,1),k.vorgabe(p)]]));"
        "console.log(JSON.stringify({a:s(v.REGLER.keys()),z:s(k.ZIELE),l:s(l.REGLER.keys()),ab:b(v.REGLER),lb:b(l.REGLER),kb}))")
    listen = {"R01 Kern controls.cpp": kern, "R02 INTERFACES §1.5": sorted(spec_pfade), "R03 Attrappe REGLER": sorted(aus["a"]),
              "R04 curves.js ZIELE": sorted(aus["z"]), "R05 controls_info.ts": sorted(aus["l"])}
    bereiche = {"R01 Kern controls.cpp": kbereich, "R02 INTERFACES §1.5": sbereich,
                "R03 Attrappe REGLER": {p: tuple(w) for p, w in aus["ab"].items()},
                "R04 curves.js (Griff 0 und 1, Vorgabe)": {p: tuple(w) for p, w in aus["kb"].items()},
                "R05 controls_info.ts": {p: tuple(w) for p, w in aus["lb"].items()}}
    return listen, bereiche


def _pruefe_return_regler(q: Quelle, befunde: list[str]) -> None:
    listen, bereiche = return_regler_listen(q)
    soll = listen["R01 Kern controls.cpp"]
    for name, ist in listen.items():
        if name != "R01 Kern controls.cpp":
            _diff(befunde, "Return-Regler=Kern", soll, ist, name)
    kern_b = bereiche["R01 Kern controls.cpp"]
    for name, bs in bereiche.items():
        for pfad, wert in bs.items():
            erwartet = kern_b[pfad]
            if name.startswith("R04") and erwartet[0] == -200.0 and erwartet[1] == 6.0:
                erwartet = (-200.0, 6.0, erwartet[2])   # the grip travel of a dB control starts silent
            if any(w is None or abs(w - e) > 1e-3 for w, e in zip(wert, erwartet)):
                befunde.append(f"Return-Bereich=Kern: {name} {pfad} (min, max, vorgabe) {wert} statt {erwartet}")
    pfad_re = re.compile(_such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"),
                               "hand_operation.ts").group(1).replace("\\/", "/"))
    try:
        schema = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["regler_pfad"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.regler_pfad.pattern ({fehler})") from fehler
    for name in soll:
        if not pfad_re.search(name):
            befunde.append(f"Return-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"Return-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for falsch in ("spur/33/send/1", "spur/1/send/9", "spur/1/send/0", "grp/17/send/1", "ret/9/fader", "ret/0/fader", "ret/1/hall/mix",
                   "ret/1/send/1", "ret/1/trim"):   # Gegenprobe: kein Muster zu weit
        if pfad_re.search(falsch):
            befunde.append(f"Return-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"Return-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


# ---------------------------------------------------------------- S5r: Graph-Regler <kanal>/bk/<1..64> (A11), container core V6
KERN_TEST = "add_test(NAME test_regler_gegen_pult"   # the core test that compares the whole control table with pult.json (container core K9)
KERN_TEST_CMAKE = "djk/core/signalbox/CMakeLists.txt"
ALTE_KANALLISTE = '{"deck/1", "deck/2", "deck/3"'   # the literal channel list of the pre-container table; it must be gone


def pruefe_regler_marker(q: Quelle, befunde: list[str]) -> None:
    """Contract for lane K: controls.cpp builds its channel list from the four containers and the four buses, and the ctest `test_regler_gegen_pult`
    (signalbox/CMakeLists.txt) compares every row of the table with pult.json. The test must be registered and the old literal channel list
    (deck/1, deck/2, deck/3 ...) must be gone. A missing registration is a finding, never a green."""
    cmake = q.lies(KERN_TEST_CMAKE)
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    if KERN_TEST not in cmake:
        befunde.append(f"R01 Kern controls.cpp: the ctest test_regler_gegen_pult is not registered in {KERN_TEST_CMAKE}, nothing compares the core table with pult.json")
    if ALTE_KANALLISTE in cpp:
        befunde.append(f"R01 Kern controls.cpp: still carries the literal channel list {ALTE_KANALLISTE}...}}, must be the four containers and buses")


def _bk_aus_spec(teil: str, d: dict) -> list[str]:
    """The bk rows of INTERFACES section 1.5 -> expanded paths: `<container>/bk/<n>` over the containers named in its own
    "Wer darf" cell, `strom/<n>/bk/<k>`, `fx/<n>/bk/<m>` and `master/bk/<m>` (S14). A row it cannot read is a ParserFehler."""
    z = _such(r"^\| `<container>/bk/<n>` \(n = 1 to (\d+)\) \|.*\| all; only `<container>` = ([^|]*) \|$", teil,
              "INTERFACES §1.5 bk row (<container>/bk/<n>)", re.M)
    container = re.findall(r"(?:deck|pad)/[1-9]", z.group(2))
    if not container:
        raise ParserFehler("INTERFACES §1.5 bk row: no container in the 'Wer darf' cell, parser blind or source rebuilt")
    zs = _such(r"^\| `strom/<n>/bk/<k>` \(n = 1 to (\d+), k = 1 to (\d+)\) \|", teil, "INTERFACES §1.5 strom bk row", re.M)
    zf = _such(r"^\| `fx/<n>/bk/<m>` \(n = (\d+(?: and \d+)*), m = 1 to (\d+)\) \|", teil, "INTERFACES §1.5 bk-Sendezeile", re.M)   # S14
    zm = _such(r"^\| `master/bk/<m>` \(m = 1 to (\d+)\) \|", teil, "INTERFACES §1.5 bk master row", re.M)
    aus = [f"{k}/bk/{n}" for k in container for n in range(1, int(z.group(1)) + 1)]
    aus += [f"strom/{n}/bk/{k}" for n in range(1, int(zs.group(1)) + 1) for k in range(1, int(zs.group(2)) + 1)]
    aus += [f"fx/{n}/bk/{m}" for n in zf.group(1).split(" and ") for m in range(1, int(zf.group(2)) + 1)]
    aus += [f"master/bk/{m}" for m in range(1, int(zm.group(1)) + 1)]
    return sorted(aus)


def bk_regler_listen(q: Quelle) -> dict[str, list[str]]:
    """bk rows per location, in the ORDER of the table: containers, streams (strom/1..16), the send returns fx/3|4 (S14), master. The
    expected set (R01) is built from pult.json plus the send-return loop of controls.cpp (bk_send_1, unchanged); controls.cpp itself is
    checked for its markers in pruefe_regler_marker. Working tree only (node)."""
    d = _pult(q)
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    ms = _such(r"for \(const char\* bk_send_1 : \{([^}]*)\}\)", cpp, "controls.cpp bk-Sendeschleife")   # S14
    senden = re.findall(r'"(fx/\d+)"', ms.group(1))
    if not senden:
        raise ParserFehler("controls.cpp: keine Send-Returns in der bk-Sendeschleife, Parser blind oder Quelle umgebaut")
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    alle = lambda ks: sorted(f"{k}/bk/{n}" for k in ks for n in range(1, d["bk_n"] + 1))   # noqa: E731
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const k=await import('file://@@/djk/ui/public/curves.js');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const s=(m)=>[...m].filter((p)=>/\\/bk\\/[0-9]+$/.test(p)&&!p.startsWith('spur/'));"
        "console.log(JSON.stringify({a:s(v.REGLER.keys()),z:s(k.ZIELE),l:s(l.REGLER.keys())}))")
    soll = sorted({p for p in pult_pfade(d) if "/bk/" in p} | set(alle(senden + ["master"])))
    # The pages and the conductor address the streams through the alias rows erz/<n>/bk/<k> (page server, decision X1), and only the alias
    # streams (D-U5). The pages (R04) are compared as the strom row an alias row stands for, against the core rows of the alias streams; the
    # conductor (R05) also lists the global rows strom/<1..16>/bk/<k> and is compared against the whole set.
    nur_alias = sorted(p for p in soll if not (m := re.match(r"strom/(\d+)/bk/", p)) or int(m.group(1)) in d["alias_stroeme"])
    seite = lambda ps: sorted({alias_zu_strom(d, p) for p in ps})   # noqa: E731
    return {"R01 Kern controls.cpp (pult.json + kn_bk_send)": soll, "R02 INTERFACES §1.5": _bk_aus_spec(teil, d),
            "R03 Attrappe REGLER": sorted(aus["a"]), "R04 curves.js ZIELE": seite(aus["z"]),
            "R05 controls_info.ts": seite(aus["l"]), "_alias_soll": nur_alias}


def _pfad_und_schema(q: Quelle) -> tuple[re.Pattern, str]:
    pfad = re.compile(_such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"),
                            "hand_operation.ts").group(1).replace("\\/", "/"))
    try:
        schema = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["regler_pfad"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.regler_pfad.pattern ({fehler})") from fehler
    return pfad, schema


def _pruefe_bk_regler(q: Quelle, befunde: list[str]) -> None:
    pruefe_regler_marker(q, befunde)
    listen = bk_regler_listen(q)
    soll = listen["R01 Kern controls.cpp (pult.json + kn_bk_send)"]   # the expected set; no location is "the" truth except pult.json
    for name, ist in listen.items():
        if name == "R04 curves.js ZIELE":
            _diff(befunde, "bk-Regler=Kern", listen["_alias_soll"], ist, name)
        elif not name.startswith(("R01", "_")):
            _diff(befunde, "bk-Regler=Kern", soll, ist, name)
    pfad, schema = _pfad_und_schema(q)
    for name in soll:
        if not pfad.search(name):
            befunde.append(f"bk-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"bk-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    # Gegenprobe: kein Muster zu weit. Every channel number of the old strips (deck/1..4, pad/1..3, bus/1..4) that is not in the set, the
    # erz numbers that are no alias (the alias group has its own check), and the stream and count edges must be refused
    d = _pult(q)
    kanaele = {n.rsplit("/bk/", 1)[0] for n in soll}
    assert "master" in kanaele
    unbekannt = [f"{g}/{i}/bk/1" for g, n in (("deck", 4), ("pad", 3), ("bus", 4)) for i in range(1, n + 1) if f"{g}/{i}" not in kanaele]
    unbekannt += [f"erz/{i}/bk/1" for i in range(0, d["strom_n"] + 1) if i not in d["alias_stroeme"]]
    strom_falsch = [f"strom/0/bk/1", f"strom/{d['strom_n'] + 1}/bk/1", "strom/1/bk/0", f"strom/1/bk/{d['bk_n'] + 1}", "strom/01/bk/1", "strom/1/bk/01"]
    # S14: only the send returns fx/3 and fx/4 have graph knobs
    fx_falsch = ["fx/1/bk/1", "fx/2/bk/1", "fx/5/bk/1", "fx/3/bk/0", "fx/3/bk/65", "fx/4/bk/70", "fx/4/bk/100"]
    for falsch in unbekannt + strom_falsch + fx_falsch + ["master/bk/0", "master/bk/65", "cue/bk/1", "deck/1/bk/65", "deck/1/bk/0", "pad/3/bk/1",
                                                          "deck/1/bk/010", "deck/1/bk/033", "deck/1/bk/640", "deck/1/bk/9x"]:
        if pfad.search(falsch):
            befunde.append(f"bk-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"bk-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


def _pruefe_alias_und_kanal(q: Quelle, befunde: list[str]) -> None:
    """R07 only: the alias group erz/<n>/<suffix> of the schema (n in alias_stroeme, suffix in alias_suffixe) and the channel patterns
    `kanal` and `hoer_kanal`. The page server resolves the alias; PFAD (hand) is not asked about it."""
    d = _pult(q)
    pfad_unused, schema = _pfad_und_schema(q)
    ok = [f"erz/{n}/{s}" for n in d["alias_stroeme"] for s in d["alias_suffixe"] if s != "bk/<k>"]
    ok += [f"erz/{n}/bk/{k}" for n in d["alias_stroeme"] for k in range(1, d["bk_n"] + 1)]
    falsch = [f"erz/{n}/fader" for n in range(0, d["strom_n"] + 1) if n not in d["alias_stroeme"]]
    falsch += [f"erz/{d['alias_stroeme'][0]}/{s}" for s in ("ziel", "xseite", "send/5", "komp/gain", "gate/an", "util/dc", "stem/drums", "bk/0",
                                                            f"bk/{d['bk_n'] + 1}", "fader/x")]
    falsch += ["erz/01/fader", "erz/1/bk/01"]
    for name in ok:
        if not re.fullmatch(schema, name):
            befunde.append(f"Alias-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for name in falsch:
        if re.fullmatch(schema, name):
            befunde.append(f"Alias-Regler: R07 defs.schema.json regler_pfad nimmt {name} an")
    try:
        defs = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]
        kanal, hoer = defs["kanal"]["pattern"], defs["hoer_kanal"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.kanal/hoer_kanal pattern ({fehler})") from fehler
    container = _container_pfade(d)
    for name in container + list(d["busse"]) + [d["master"], d["cue"]]:
        if not re.fullmatch(kanal, name):
            befunde.append(f"Kanal: R07 defs.schema.json kanal lehnt {name} ab")
    for name in [f"deck/{n}" for n in range(1, 5)]:
        if not re.fullmatch(hoer, name):
            befunde.append(f"Kanal: R07 defs.schema.json hoer_kanal lehnt {name} ab")
    fremd = ["deck/3", "deck/4", "pad/3", "erz/1", "erz/8", "bus/0", "bus/5", "fx/3", "spur/1"]
    for name in fremd:
        if re.fullmatch(kanal, name):
            befunde.append(f"Kanal: R07 defs.schema.json kanal nimmt {name} an")
    for name in ["pad/3", "deck/0", "deck/5", "erz/1", "erz/8", "bus/0", "bus/5", "fx/3", "spur/1"] + list(d["busse"]) + [d["master"], d["cue"]]:
        if re.fullmatch(hoer, name):
            befunde.append(f"Kanal: R07 defs.schema.json hoer_kanal nimmt {name} an")


# ---------------------------------------------------------------- controller targets spur/<slot>/bk/<k> (production plan task 8)
def spur_bk_listen(q: Quelle) -> dict[str, list[str]]:
    """spur/<slot>/bk/<k> per location; slots and knobs from controls.h (SPUR_BK_SLOTS, SPUR_BK_KNOEPFE). Only the core, controls_info.ts and the
    schema carry these rows (the mock core and curves.js do not); the Baukasten tracks of a project are not channels. Working tree only (node)."""
    regler_h = q.lies("djk/core/signalbox/include/cypherdj/signalbox/controls.h")
    slots = int(_such(r"constexpr int SPUR_BK_SLOTS = (\d+);", regler_h, "controls.h").group(1))
    knoepfe = int(_such(r"constexpr int SPUR_BK_KNOEPFE = (\d+);", regler_h, "controls.h").group(1))
    if 'std::snprintf(p, sizeof p, "spur/%d/bk/%d", slot, nr)' not in q.lies("djk/core/signalbox/src/controls.cpp"):
        raise ParserFehler("controls.cpp: no spur/%d/bk/%d loop, parser blind or source rebuilt")
    aus = q.node_json(
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "console.log(JSON.stringify({l:[...l.REGLER.keys()].filter((p)=>/^spur\\/[0-9]+\\/bk\\//.test(p))}))")
    return {"R01 Kern controls.cpp": sorted(f"spur/{n}/bk/{k}" for n in range(1, slots + 1) for k in range(1, knoepfe + 1)),
            "R05 controls_info.ts": sorted(aus["l"])}


def _pruefe_spur_bk_regler(q: Quelle, befunde: list[str]) -> None:
    listen = spur_bk_listen(q)
    soll = listen["R01 Kern controls.cpp"]
    _diff(befunde, "Spur-bk-Regler=Kern", soll, listen["R05 controls_info.ts"], "R05 controls_info.ts")
    pfad = re.compile(_such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"), "hand_operation.ts").group(1).replace("\\/", "/"))
    try:
        schema = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["regler_pfad"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.regler_pfad.pattern ({fehler})") from fehler
    for name in soll:
        if not pfad.search(name):
            befunde.append(f"Spur-bk-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"Spur-bk-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for falsch in ("spur/0/bk/1", "spur/17/bk/1", "spur/1/bk/0", "spur/1/bk/65", "spur/1/bk/01", "spur/1/bk/1x", "spur/32/bk/1"):   # no pattern too wide
        if pfad.search(falsch):
            befunde.append(f"Spur-bk-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"Spur-bk-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


# ---------------------------------------------------------------- 1.15 A2: mix-tool controls (345 rows, plan A v2 section 3)
_WZ_KOPF = "djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h"
_WZ_ZEILE = re.compile(r'^\{WzTool::[a-z]+, "([a-z_/]+)", (-?[0-9.]+)f?, (-?[0-9.]+)f?, (-?[0-9.]+)f?, KurvenTyp::(?:schalter|stufen|linear), '
                       r'[0-9]+, (?:true|false), WzKanalart::(quellen|quellen_busse|busse|global)\},$')
_WZ_FILTER_JS = "(p)=>(!p.startsWith('ins/')&&/\\/(gate|util|mb|lim)\\//.test(p))||p.startsWith('spektrum/')"   # ins/lim/... is an insert row, not a mix tool


def _wz_kopf(q: Quelle) -> dict[str, tuple[float, float, float]]:
    """The 345 paths of the one flat table tool_controls.h -> (min, max, default). One row per line; a line of the block this parser
    cannot read, an empty block or a missing channel array is a ParserFehler, never an empty green."""
    kopf = q.lies(_WZ_KOPF)
    von = _index(kopf, "WERKZEUG_ZEILEN[] = {", _WZ_KOPF)
    bis = _index(kopf, "\n};", _WZ_KOPF, von)
    kanaele = {}
    for name in ("QUELLEN", "BUSSE"):
        m = _such(r"WERKZEUG_" + name + r"\[\] = \{([^}]*)\}", kopf, _WZ_KOPF + " " + name)
        kanaele[name] = re.findall(r'"([a-z]+/\d+)"', m.group(1))
        if not kanaele[name]:
            raise ParserFehler(f"{_WZ_KOPF}: WERKZEUG_{name} ohne Kanäle, Parser blind oder Quelle umgebaut")
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    for marke in ("for (const WerkzeugZeile& z : WERKZEUG_ZEILEN)", "WERKZEUG_QUELLEN", "WERKZEUG_BUSSE"):
        if marke not in cpp:
            raise ParserFehler(f"controls.cpp: {marke!r} nicht gefunden, die Tabelle wird nicht (mehr) aus tool_controls.h gebaut")
    aus: dict[str, tuple[float, float, float]] = {}
    zeilen = [z.strip() for z in kopf[von:bis].split("\n")[1:] if z.strip()]
    for zeile in zeilen:
        zeile = re.sub(r"//.*$", "", zeile).strip()
        if not zeile:
            continue
        m = _WZ_ZEILE.match(zeile)
        if not m:
            raise ParserFehler(f"{_WZ_KOPF}: Zeile nicht lesbar: {zeile!r}")
        werte = (float(m.group(2)), float(m.group(3)), float(m.group(4)))
        art = m.group(5)
        ks = {"quellen": kanaele["QUELLEN"], "quellen_busse": kanaele["QUELLEN"] + kanaele["BUSSE"], "busse": kanaele["BUSSE"],
              "global": [""]}[art]
        for k in ks:
            pfad = f"{k}/{m.group(1)}" if k else m.group(1)
            if pfad in aus:
                raise ParserFehler(f"{_WZ_KOPF}: Pfad {pfad} doppelt")
            aus[pfad] = werte
    if not aus:
        raise ParserFehler(f"{_WZ_KOPF}: keine Zeilen gelesen, Parser blind oder Quelle umgebaut")
    return aus


def _wz_vertrag(q: Quelle) -> list[str]:
    """The tool rows of INTERFACES section 1.5, expanded over the channel list of their own "Wer darf" cell ('containers' = the four
    containers of pult.json, 'buses' = bus/1..4, '<b>' over 'b = tief, mitte, hoch'). A tool row it cannot read is a ParserFehler."""
    d = _pult(q)
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    aus: list[str] = []
    for zeile in teil.split("\n"):
        if not re.match(r"^\| `(<k>/(gate|util)/|bus/<n>/(mb|lim)/|spektrum/)", zeile):
            continue
        z = [c.strip() for c in zeile.strip().strip("|").split("|")]
        m = re.match(r"^`([^`]+)`(?: \(b = ([a-z]+(?:, [a-z]+)*)\))?$", z[0]) if len(z) == 6 else None
        if not m:
            raise ParserFehler(f"INTERFACES §1.5: Werkzeug-Zeile nicht lesbar: {zeile[:80]!r}")
        pfad, baender, wer = m.group(1), m.group(2), z[5]
        if pfad == "spektrum/kanal":
            aus.append(pfad)
            continue
        ks: list[str] = []
        if "containers" in wer:
            ks += _container_pfade(d)
        if "buses" in wer:
            ks += list(d["busse"])
        if not ks:
            raise ParserFehler(f"INTERFACES §1.5: keine Kanäle in der Zelle 'Wer darf' der Zeile {pfad}: {wer!r}")
        rest = pfad.split("/", 2)[2] if pfad.startswith("bus/<n>/") else pfad[4:]
        if "<b>" in rest and not baender:
            raise ParserFehler(f"INTERFACES §1.5: Zeile {pfad} ohne 'b = tief, mitte, hoch'")
        for k in ks:
            aus += [f"{k}/{rest.replace('<b>', b)}" for b in (baender.split(", ") if baender else [""])] if "<b>" in rest else [f"{k}/{rest}"]
    if not aus:
        raise ParserFehler("INTERFACES §1.5: keine Werkzeug-Zeilen gefunden, Parser blind oder Quelle umgebaut")
    return aus


def _wz_node(q: Quelle) -> dict[str, dict[str, list[float]]]:
    """Tool rows of the Attrappe (a) and of controls_info.ts (l) as path -> [min, max, default]."""
    return q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        f"const f={_WZ_FILTER_JS};"
        "const s=(m)=>Object.fromEntries([...m.entries()].filter(([p])=>f(p)).map(([p,i])=>[p,[i.min,i.max,i.vorgabe]]));"
        "console.log(JSON.stringify({a:s(v.REGLER),l:s(l.REGLER)}))")


WZ_R01 = "R01 Kern controls.cpp (tool_controls.h)"   # the header table is part of lane K's core table; one label keeps it pending with K


def _wz_soll(d: dict) -> list[str]:
    """The mix-tool paths pult.json describes: gate and util on the containers, util, mb and lim on the buses, plus the global spektrum/kanal."""
    zug = [p for p in erzeuge_pult.regler_pfade(d, "zug") if re.search(r"/(gate|util)/", p)]
    bus = [p for p in erzeuge_pult.regler_pfade(d, "bus") if re.search(r"/(util|mb|lim)/", p)]
    return sorted(zug + bus + ["spektrum/kanal"])


def werkzeug_regler_listen(q: Quelle) -> dict[str, list[str]]:
    """The mix-tool paths per location. WZ_R01 is the header (the table the Stellwerk is built from), R02 the contract text, R03 the
    Attrappe, R05 controls_info.ts; R06 (PFAD) and R07 (schema) are acceptance patterns and are tested in _pruefe_werkzeug_regler. The expected
    set is built from pult.json (_wz_soll). Working tree only."""
    aus = _wz_node(q)
    return {WZ_R01: sorted(_wz_kopf(q)), "R02 INTERFACES §1.5": sorted(_wz_vertrag(q)),
            "R03 Attrappe REGLER": sorted(aus["a"]), "R05 controls_info.ts": sorted(aus["l"])}


def _wz_universum(soll: list[str]) -> list[str]:
    """Every tool suffix on every channel number around the real ones (deck/0..5, erz/0..10, pad/0..3, bus/0..5), the families' unknown
    siblings, and the global row with a suffix: whatever a pattern accepts out of this and is not in the expected set is too wide."""
    suffixe = sorted({p.split("/", 2)[2] for p in soll if p != "spektrum/kanal"})
    fremd = ["gate/zz", "util/zz", "util/gain_db", "mb/zz", "mb/solo", "mb/tief/solo", "mb/zz/ratio", "lim/zz", "lim/vorhalt_ms", "lim/echtspitze"]
    kanaele = ([f"deck/{n}" for n in range(0, 6)] + [f"erz/{n}" for n in range(0, 11)] + [f"pad/{n}" for n in range(0, 4)]
               + [f"bus/{n}" for n in range(0, 6)])
    u = {f"{k}/{x}" for k in kanaele for x in suffixe + fremd}
    u |= {"spektrum", "spektrum/kanal/1", "spektrum/zz", "deck/1/spektrum/kanal", "master/gate/an", "fx/1/util/dc"}
    return sorted(u - set(soll))


def _pruefe_werkzeug_regler(q: Quelle, befunde: list[str]) -> None:
    listen = werkzeug_regler_listen(q)
    soll = _wz_soll(_pult(q))
    for name, ist in listen.items():
        _diff(befunde, "Werkzeug-Regler=Kern", soll, ist, name)
    # range and default in the Attrappe and in controls_info.ts equal the header (within 1e-6: the header writes float literals like 0.1f)
    kopf = _wz_kopf(q)
    zahlen = _wz_node(q)
    for ort, schluessel in (("R03 Attrappe REGLER", "a"), ("R05 controls_info.ts", "l")):
        for name in sorted(set(kopf) & set(zahlen[schluessel])):
            ist = zahlen[schluessel][name]
            if any(abs(x - y) > 1e-6 for x, y in zip(ist, kopf[name])):
                befunde.append(f"Werkzeug-Regler: {ort} Bereich oder Vorgabe von {name} ist {ist}, {WZ_R01} sagt {list(kopf[name])}")
    pfad, schema = _pfad_und_schema(q)
    for name in soll:
        if not pfad.search(name):
            befunde.append(f"Werkzeug-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"Werkzeug-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for falsch in _wz_universum(soll):   # Gegenprobe: kein Muster zu weit
        if pfad.search(falsch):
            befunde.append(f"Werkzeug-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"Werkzeug-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


# ---------------------------------------------------------------- D-V3: the source selectors komp/sc, gate/sc and spektrum/kanal
SC_BEREICH = {"komp/sc": (0, 4), "gate/sc": (0, 4), "spektrum/kanal": (0, 9)}   # 0 own signal (spektrum: off), then containers A..D; spektrum 5..8 buses, 9 master


def _sc_zeile(zeile: str, ort: str, lo: float, hi: float, befunde: list[str]) -> None:
    slo, shi = SC_BEREICH[zeile]
    if (lo, hi) != (slo, shi):
        befunde.append(f"sc-Bereich: {ort} {zeile} {lo:g}..{hi:g}, expected {slo:g}..{shi:g} (D-V3)")


def _pruefe_sc_bereiche(q: Quelle, befunde: list[str]) -> None:
    d = _pult(q)
    k1 = _container_pfade(d)[0]
    kopf = _wz_kopf(q)
    for zeile in ("gate/sc", "spektrum/kanal"):   # the header carries the tool rows
        pfad = zeile if zeile == "spektrum/kanal" else f"{k1}/{zeile}"
        if pfad not in kopf:
            raise ParserFehler(f"tool_controls.h: Zeile {pfad} nicht gelesen, Parser blind oder Quelle umgebaut")
        _sc_zeile(zeile, WZ_R01, kopf[pfad][0], kopf[pfad][1], befunde)
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    m = _such(r"Rolle::komp_sc, (-?\d+), (-?\d+), -?\d+, [^;]*stufen\((-?\d+), (-?\d+)\)", cpp, "controls.cpp komp/sc row")
    _sc_zeile("komp/sc", "R01 Kern controls.cpp", float(m.group(1)), float(m.group(2)), befunde)
    if (m.group(3), m.group(4)) != (m.group(1), m.group(2)):
        befunde.append(f"sc-Bereich: R01 Kern controls.cpp komp/sc row: range {m.group(1)}..{m.group(2)} but curve stufen({m.group(3)}, {m.group(4)})")
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    for zeile, anfang in (("komp/sc", "| `<k>/komp/sc` |"), ("gate/sc", "| `<k>/gate/sc` |"), ("spektrum/kanal", "| `spektrum/kanal` |")):
        treffer = [z for z in teil.split("\n") if z.startswith(anfang)]
        if len(treffer) != 1:
            raise ParserFehler(f"INTERFACES §1.5: Zeile {anfang!r} {len(treffer)}x gefunden, Parser blind oder Quelle umgebaut")
        zellen = [c.strip() for c in treffer[0].strip().strip("|").split("|")]
        r = re.fullmatch(r"(\d+) (?:bis|to) (\d+)", zellen[2]) if len(zellen) == 6 else None
        if not r:
            raise ParserFehler(f"INTERFACES §1.5: Bereich der Zeile {zeile} nicht lesbar: {treffer[0][:90]!r}")
        _sc_zeile(zeile, "R02 INTERFACES §1.5", float(r.group(1)), float(r.group(2)), befunde)
    aus = q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        f"const z=['{k1}/komp/sc','{k1}/gate/sc','spektrum/kanal'];"
        "const s=(m)=>z.map((p)=>m.get(p)?[m.get(p).min,m.get(p).max]:null);"
        "console.log(JSON.stringify({a:s(v.REGLER),l:s(l.REGLER)}))")
    for ort, schluessel in (("R03 Attrappe REGLER", "a"), ("R05 controls_info.ts", "l")):
        for zeile, werte in zip(("komp/sc", "gate/sc", "spektrum/kanal"), aus[schluessel]):
            if werte is None:
                befunde.append(f"sc-Bereich: {ort} {zeile} fehlt")
            else:
                _sc_zeile(zeile, ort, werte[0], werte[1], befunde)


# ---------------------------------------------------------------- 1.10 Slice 4a/4b: insert controls ins/komp|eq|saett|lim/<n>/* (T6, T12)
# Global project-only rows (spec section 3/4): R01 is the generated row table the Stellwerk is built from (insert_zeilen.inc, from
# docs/interfaces/insert_module.json), R02 the contract text, R03 the Attrappe, R05 controls_info.ts; R06 (PFAD) and R07 (schema) are
# acceptance patterns, tested here. No curves.js ZIELE (like the mix tools): the page edits an insert through the project command, not a grip.
_INS_INC = "djk/core/signalbox/src/insert_zeilen.inc"
_INS_ZEILE = re.compile(r'^\{"(ins/[a-z]+/[0-9]+/[a-z0-9_/]+|rack/[0-9]+/m[1-4])", Rolle::[a-z_0-9]+, (-?[0-9.]+)f, (-?[0-9.]+)f, (-?[0-9.]+)f, '
                        r'KurvenTyp::(?:schalter|stufen|linear), [0-9]+, (?:true|false)\},$')


def _ins_inc(q: Quelle) -> dict[str, tuple[float, float, float]]:
    """The rows of the generated table insert_zeilen.inc -> (min, max, default). One row per line; a line of the block this parser cannot
    read, a duplicate or an empty block is a ParserFehler, never an empty green. controls.cpp must still build the table from it."""
    inc = q.lies(_INS_INC)
    von = _index(inc, "INSERT_ZEILEN[] = {", _INS_INC)
    bis = _index(inc, "\n};", _INS_INC, von)
    cpp = q.lies("djk/core/signalbox/src/controls.cpp")
    for marke in ('#include "insert_zeilen.inc"', "INSERT_ZEILEN"):
        if marke not in cpp:
            raise ParserFehler(f"controls.cpp: {marke!r} nicht gefunden, die Tabelle wird nicht (mehr) aus insert_zeilen.inc gebaut")
    aus: dict[str, tuple[float, float, float]] = {}
    for zeile in (z.strip() for z in inc[von:bis].split("\n")[1:]):
        if not zeile:
            continue
        m = _INS_ZEILE.match(zeile)
        if not m:
            raise ParserFehler(f"{_INS_INC}: Zeile nicht lesbar: {zeile!r}")
        if m.group(1) in aus:
            raise ParserFehler(f"{_INS_INC}: Pfad {m.group(1)} doppelt")
        aus[m.group(1)] = (float(m.group(2)), float(m.group(3)), float(m.group(4)))
    if not aus:
        raise ParserFehler(f"{_INS_INC}: keine Zeilen gelesen, Parser blind oder Quelle umgebaut")
    return aus


def _ins_vertrag(q: Quelle) -> dict[str, tuple[float, float, float]]:
    """The rows `ins/komp/<n>/<name>` of INTERFACES section 1.5 expanded over n = 1 to N (N read from the sentence under the table)
    -> (min, max, default). A row it cannot read is a ParserFehler."""
    spec = q.lies("docs/architecture/INTERFACES.md")
    teil = spec[_index(spec, "### 1.5 Kanäle und Regler-Pfade", "§1.5"):_index(spec, "### 1.6", "§1.5")]
    n = {art: int(_such(r"`ins/" + art + r"/<n>/\*` \(n = 1 to (\d+);", teil, f"INTERFACES §1.5 ins/{art}/<n>/*").group(1))
         for art in ("komp", "eq", "saett", "lim", "host", "utility", "bk")}
    racks = int(_such(r"`rack/<k>/m<n>` \(k = 1 to (\d+);", teil, "INTERFACES §1.5 rack/<k>/m<n>").group(1))
    aus: dict[str, tuple[float, float, float]] = {}
    for zeile in teil.split("\n"):
        if zeile.startswith("| `rack/"):   # slice 4c: the macro rows rack/<k>/m<n>, k = 1..racks, n = 1..4
            z = [c.strip() for c in zeile.strip().strip("|").split("|")]
            if len(z) != 6 or z[0] != "`rack/<k>/m<n>`":
                raise ParserFehler(f"INTERFACES §1.5: Rack-Zeile nicht lesbar: {zeile[:80]!r}")
            b = re.fullmatch(r"(\S+) to (\S+)", z[2].replace("−", "-"))
            if not b:
                raise ParserFehler(f"INTERFACES §1.5: Bereich der Rack-Zeile nicht lesbar: {z[2]!r}")
            for k in range(1, racks + 1):
                for i in range(1, 5):
                    if f"rack/{k}/m{i}" in aus:
                        raise ParserFehler(f"INTERFACES §1.5: Rack-Zeile rack/{k}/m{i} doppelt")
                    aus[f"rack/{k}/m{i}"] = (float(b.group(1)), float(b.group(2)), float(z[3]))
            continue
        if not zeile.startswith("| `ins/"):
            continue
        z = [c.strip() for c in zeile.strip().strip("|").split("|")]
        m = re.match(r"^`ins/(komp|eq|saett|lim|host|utility|bk)/<n>/((?:b(?:<m>|[1-8])/)?[a-z0-9_]+)`$", z[0]) if len(z) == 6 else None
        if not m:
            raise ParserFehler(f"INTERFACES §1.5: Insert-Zeile nicht lesbar: {zeile[:80]!r}")
        b = re.fullmatch(r"(?:(\S+) to (\S+)|0/1)", z[2].replace("−", "-"))
        if not b:
            raise ParserFehler(f"INTERFACES §1.5: Bereich der Zeile {m.group(1)} nicht lesbar: {z[2]!r}")
        lo, hi = (float(b.group(1)), float(b.group(2))) if b.group(1) else (0.0, 1.0)
        werte = (lo, hi, float(z[3].replace("−", "-")))
        namen = [m.group(2).replace("<m>", str(b)) for b in range(1, 9)] if "<m>" in m.group(2) else [m.group(2)]   # b<m>: the 8 EQ bands
        for i in range(1, n[m.group(1)] + 1):
            for name in namen:
                if f"ins/{m.group(1)}/{i}/{name}" in aus:
                    raise ParserFehler(f"INTERFACES §1.5: Insert-Zeile ins/{m.group(1)}/{i}/{name} doppelt")
                aus[f"ins/{m.group(1)}/{i}/{name}"] = werte
    if not aus:
        raise ParserFehler("INTERFACES §1.5: keine Insert-Zeilen gefunden, Parser blind oder Quelle umgebaut")
    return aus


def _ins_node(q: Quelle) -> dict[str, dict[str, list[float]]]:
    """Insert rows of the Attrappe (a) and of controls_info.ts (l) as path -> [min, max, default]. Working tree only. Both modules build the rows from the
    generated lists insert_controls.mjs / insert_controls.ts; they are registered as read so that the mutation test copies them."""
    q.lies("djk/contract/mock_core/insert_controls.mjs")
    q.lies("djk/conductor/src/insert_controls.ts")
    return q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "const l=await import('file://@@/djk/conductor/src/controls_info.ts');"
        "const s=(m)=>Object.fromEntries([...m.entries()].filter(([p])=>p.startsWith('ins/')||p.startsWith('rack/'))"
        ".map(([p,i])=>[p,[i.min,i.max,i.vorgabe]]));"
        "console.log(JSON.stringify({a:s(v.REGLER),l:s(l.REGLER)}))")


def insert_regler_listen(q: Quelle) -> dict[str, dict[str, tuple[float, float, float]]]:
    """Path -> (min, max, default) of the insert controls per location (R01 Kern, R02 contract text, R03 Attrappe, R05 controls_info.ts)."""
    aus = _ins_node(q)
    return {"R01 Kern insert_zeilen.inc": _ins_inc(q), "R02 INTERFACES §1.5": _ins_vertrag(q),
            "R03 Attrappe REGLER": {p: tuple(w) for p, w in aus["a"].items()},
            "R05 controls_info.ts": {p: tuple(w) for p, w in aus["l"].items()}}


def _ins_universum(kern: dict[str, tuple[float, float, float]]) -> list[str]:
    """What a pattern must refuse: instance numbers just outside, sibling names, a suffix, a kind that has no table rows, the
    rack family just outside its numbers."""
    u: set[str] = set()
    for art in ("komp", "eq", "saett", "lim", "host", "utility", "bk"):
        namen = sorted({p.split("/", 3)[3] for p in kern if p.split("/")[1] == art})
        n = max(int(p.split("/")[2]) for p in kern if p.split("/")[1] == art)
        u |= {f"ins/{art}/{i}/{x}" for i in (0, n + 1) for x in namen}
        u |= {f"ins/{art}/1/{x}" for x in ("zz", "an/x", "sc2", "schwelle/x", "")}
        u |= {f"ins/{art}/1", f"ins/{art}", f"ins/{art}/01/an"}
    u |= {f"ins/eq/1/b{b}/{x}" for b in (0, 9) for x in ("an", "freq")}   # band numbers just outside
    u |= {"ins/eq/1/b1", "ins/eq/1/b1/zz", "ins/eq/1/b11/an", "ins/saett/1/b1/an", "ins/komp/1/b1/an", "ins/rack/1/an", "komp/1/an"}
    # the rack macro family: instance numbers and macro numbers just outside, a sibling name, a suffix
    u |= {"rack/0/m1", "rack/13/m1", "rack/01/m1", "rack/1/m0", "rack/1/m5", "rack/1/m11", "rack/1/m1/x", "rack/1/m", "rack/1", "rack", "rack/1/zz", "rack/1/m1x"}
    return sorted(u - set(kern))


def _pruefe_insert_regler(q: Quelle, befunde: list[str]) -> None:
    listen = insert_regler_listen(q)
    kern = listen["R01 Kern insert_zeilen.inc"]
    for name, ist in listen.items():
        if name != "R01 Kern insert_zeilen.inc":
            _diff(befunde, "Insert-Regler=Kern", sorted(kern), sorted(ist), name)
            for p in sorted(set(kern) & set(ist)):
                if any(abs(a - b) > 1e-6 for a, b in zip(ist[p], kern[p])):
                    befunde.append(f"Insert-Regler: {name} Bereich oder Vorgabe von {p} ist {list(ist[p])}, insert_zeilen.inc sagt {list(kern[p])}")
    pfad = re.compile(_such(r"export const PFAD = /(.*)/;", q.lies("djk/ui/hand_operation.ts"),
                            "hand_operation.ts").group(1).replace("\\/", "/"))
    try:
        schema = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["regler_pfad"]["pattern"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.regler_pfad.pattern ({fehler})") from fehler
    for name in sorted(kern):
        if not pfad.search(name):
            befunde.append(f"Insert-Regler: R06 hand_bedienung.PFAD lehnt {name} ab")
        if not re.fullmatch(schema, name):
            befunde.append(f"Insert-Regler: R07 defs.schema.json regler_pfad lehnt {name} ab")
    for falsch in _ins_universum(kern):   # Gegenprobe: kein Muster zu weit
        if pfad.search(falsch):
            befunde.append(f"Insert-Regler: R06 hand_bedienung.PFAD nimmt {falsch} an")
        if re.fullmatch(schema, falsch):
            befunde.append(f"Insert-Regler: R07 defs.schema.json regler_pfad nimmt {falsch} an")


# ---------------------------------------------------------------- D1 K1: Gründe (A11)
# String literals the reason patterns catch that are not reasons: `cypher` is a command source compared inside a quittung call
# (core_signalbox.cpp: `!std::strcmp(c.quelle, "cypher") ? "nur_hand" : ...`).
_KEINE_GRUENDE = {"cypher"}
_GRUND_LITERALE = [r'quittung\([^;]*?"([a-z_]+)"\s*\)', r'\bab\("([a-z_]+)"\)', r'Abbruch\("([a-z_]+)"',
                   r'\bgrund = "([a-z_]+)"']


def gruende_listen(q: Quelle) -> dict[str, list[str]]:
    listen: dict[str, list[str]] = {}
    try:
        listen["G01 osc.json"] = json.loads(q.lies("djk/contract/osc.json"))["werte"]["gruende"]["liste"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"osc.json: keine Liste werte.gruende ({fehler})") from fehler
    spec = q.lies("docs/architecture/INTERFACES.md")
    unter = spec[_index(spec, "### 16.2", "§16.2"):_index(spec, "### 16.3", "§16.2")]
    kern: set[str] = set()
    for zeile in unter.split("\n"):
        if zeile.startswith("| `"):
            spalten = vertragstext._tabellenspalten(zeile)
            if "Kern" in spalten[1]:
                kern |= set(vertragstext._namen(spalten[0]))
    if not kern:
        raise ParserFehler("INTERFACES §16.2: keine Zeile mit Vergeber Kern")
    listen["G02 §16.2 vom Kern"] = sorted(kern)
    literale: set[str] = set()
    for rel in q.dateien("djk/core/src", ".cpp"):
        text = q.lies(rel)
        for muster in _GRUND_LITERALE:
            literale |= set(re.findall(muster, text))
    if "ki_gestoppt" not in literale or len(literale) < 15:
        raise ParserFehler(f"djk/core/src: nur {len(literale)} Grund-Literale, Parser blind oder Quelle umgebaut")
    literale -= _KEINE_GRUENDE
    listen["G03 Kern-Quelltext"] = sorted(literale)
    try:
        listen["G05 defs.schema.json grund"] = json.loads(q.lies("djk/contract/schemas/defs.schema.json"))["$defs"]["grund"]["enum"]
    except (ValueError, KeyError) as fehler:
        raise ParserFehler(f"defs.schema.json: kein $defs.grund.enum ({fehler})") from fehler
    listen["G04 Attrappe GRUENDE"] = sorted(q.node_json(
        "const v=await import('file://@@/djk/contract/mock_core/contract.mjs');"
        "console.log(JSON.stringify([...v.GRUENDE]))"))
    return listen


def _pruefe_gruende(q: Quelle, befunde: list[str]) -> None:
    listen = gruende_listen(q)
    vertrag = set(listen["G01 osc.json"])
    for code in listen["G03 Kern-Quelltext"]:
        if code not in vertrag:
            befunde.append(f"Gründe: Kern-Quelltext vergibt {code}, osc.json kennt es nicht")
    _diff(befunde, "Gründe=osc.json", sorted(vertrag), listen["G05 defs.schema.json grund"], "G05 defs.schema.json grund")
    attrappe = listen["G04 Attrappe GRUENDE"]
    for code in listen["G02 §16.2 vom Kern"]:
        if code not in attrappe:
            befunde.append(f"Gründe: Attrappe GRUENDE fehlt: {code} (§16.2 nennt den Kern als Vergeber)")
    for code in attrappe:
        if code not in vertrag:
            befunde.append(f"Gründe: Attrappe GRUENDE kennt {code}, osc.json nicht")


# ---------------------------------------------------------------- D1 K1: Hand-Zielart arr/<aktion> (A11)
def zielart_listen(q: Quelle) -> dict[str, list[str]]:
    wo = "INTERFACES §7.2"
    spec = q.lies("docs/architecture/INTERFACES.md")
    start = _index(spec, "- `ziel`: ein Regler-Pfad (§1.5)", wo)
    stueck = spec[start:_index(spec, "- `quant`", wo, start)]
    listen = {"Z01 INTERFACES §7.2": sorted(set(re.findall(r"`(arr/[a-z_]+)`", stueck)))}
    if not listen["Z01 INTERFACES §7.2"]:
        raise ParserFehler(f"{wo}: keine Zielart arr/<aktion> in der ziel-Zeile, Parser blind oder Quelle umgebaut")
    listen["Z02 mapping.cpp"] = sorted(set(re.findall(r'strcmp\(z, "(arr/[a-z_]+)"\)', q.lies("djk/core/hand/src/mapping.cpp"))))
    listen["Z03 hand_in.h /test/hand"] = sorted(set(re.findall(r'strcmp\(p, "(arr/[a-z_]+)"\)',
                                                              q.lies("djk/core/include/cypherdj/hand_in.h"))))
    listen["Z04 hand.mjs ARR_ZIELE"] = sorted(_namen(_such(r"const ARR_ZIELE = new Set\(\[([^\]]*)\]\)",
                                                          q.lies("djk/contract/mock_core/hand.mjs"), "hand.mjs").group(1)))
    enum = _such(r"enum class ZielArt : uint8_t \{([^}]*)\}", _strip_cpp(q.lies("djk/core/hand/include/hand/mapping.h")),
                 "mapping.h ZielArt").group(1)
    listen["Z05 mapping.h ZielArt"] = [x.strip() for x in enum.split(",") if x.strip()]
    return listen


def _pruefe_zielarten(q: Quelle, befunde: list[str]) -> None:
    listen = zielart_listen(q)
    soll = listen["Z01 INTERFACES §7.2"]
    for name in ("Z02 mapping.cpp", "Z03 hand_in.h /test/hand", "Z04 hand.mjs ARR_ZIELE"):
        _diff(befunde, "Zielarten=§7.2", soll, listen[name], name)
    if "arr" not in listen["Z05 mapping.h ZielArt"]:
        befunde.append("Zielarten: Z05 mapping.h ZielArt kennt arr nicht, §7.2 nennt arr/<aktion>")


def pruefe(q: Quelle) -> list[str]:
    """Every red finding."""
    return pruefe_roh(q)


def pruefe_roh(q: Quelle) -> list[str]:
    """Every finding, pending or not."""
    befunde: list[str] = []
    genutzt: set = set()
    tasten_vertrag = _pruefe_tasten(q, befunde, genutzt)
    _pruefe_aktionen(q, befunde, genutzt)
    _pruefe_mappings(q, befunde, tasten_vertrag)
    if q.rev:
        print(f"Hinweis: --rev {q.rev}: Regler-Teil übersprungen, auch Spur-Regler und Gründe (node wertet nur den "
              "Arbeitsbaum aus)", file=sys.stderr)
    else:
        _pruefe_regler(q, befunde)
        _pruefe_spur_regler(q, befunde)   # D1 K1
        _pruefe_routing_regler(q, befunde)   # 1.10 Slice 1
        _pruefe_bk_regler(q, befunde)     # S5r, container core V6 (also the controls.cpp markers)
        _pruefe_alias_und_kanal(q, befunde)   # container core V6
        _pruefe_spur_bk_regler(q, befunde)   # controller targets spur/<slot>/bk/<k>
        _pruefe_werkzeug_regler(q, befunde)   # 1.15 A2
        _pruefe_sc_bereiche(q, befunde)   # D-V3
        _pruefe_return_regler(q, befunde)   # 1.10 Slice 3
        _pruefe_insert_regler(q, befunde)   # 1.10 Slice 4a
        _pruefe_gruende(q, befunde)       # D1 K1
        _pruefe_zielarten(q, befunde)     # D1 K1 Slice 10
    for schluessel in AUSNAHMEN:
        if schluessel not in genutzt:
            befunde.append(f"Ausnahme veraltet (tritt nicht mehr auf, streichen): {schluessel}")
    return befunde


def ist_englische_ausgabe(q: Quelle) -> bool:
    """True if the interface contract in this tree is the English edition (the public export ships only that)."""
    try:
        kopf = q.lies("docs/architecture/INTERFACES.md")[:200]
    except (OSError, subprocess.CalledProcessError):
        kopf = ""
    return kopf.startswith("# Cypher-DJ: Interfaces")


SKIP_GRUND = "English edition of the interface contract; the name list parsers read the German source text"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wurzel", type=Path)
    parser.add_argument("--rev")
    args = parser.parse_args()
    q = Quelle(args.wurzel, args.rev)
    # The parsers read the German contract text. The public repository carries only its English edition, so the check
    # is skipped there (ctest SKIP_RETURN_CODE 77); the working repository runs it against the German source of truth.
    if ist_englische_ausgabe(q):
        print(f"SKIP: {SKIP_GRUND}")
        return 77
    try:
        fehler = pruefe(q)
    except ParserFehler as problem:
        print(f"PARSERFEHLER: {problem}", file=sys.stderr)
        return 2
    for befund in fehler:
        print("ROT:", befund)
    print("ERGEBNIS:", "ROT" if fehler else "GRÜN", f"({len(fehler)} Befunde, 0 ausstehend)")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
