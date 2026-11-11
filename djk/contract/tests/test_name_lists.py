"""Vertragstest L3 (Paket 0.3): Namenslisten gegeneinander.
pytest -q djk/contract/tests/test_name_lists.py -p no:cacheprovider. Laufzeit < 2 s.
Mutationsprobe und Negativ-Kontrollen arbeiten auf Kopien in tmp_path, nie im Arbeitsbaum."""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import check_name_lists as pn  # noqa: E402

WURZEL = pn.HIER.parents[1]   # Repo-Wurzel dieses Arbeitsbaums (auch im Worktree)

# The parsers read the German contract text; the public export carries only the English edition (same skip as the command line).
if pn.ist_englische_ausgabe(pn.Quelle(WURZEL)):
    pytest.skip(pn.SKIP_GRUND, allow_module_level=True)


@pytest.fixture(scope="module")
def quelldateien():
    """Genau die Dateien, die der Prüfer liest (er führt Buch): eine neue Quelle fehlt so nie in einer Testliste."""
    q = pn.Quelle(WURZEL)
    assert pn.pruefe(q) == []
    assert len(q.gelesen) > 15, q.gelesen
    return sorted(q.gelesen)


@pytest.fixture
def kopie(tmp_path, quelldateien):
    for rel in quelldateien:
        ziel = tmp_path / rel
        ziel.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(WURZEL / rel, ziel)
    return tmp_path


def mutiere(wurzel: Path, rel: str, alt: str, neu: str) -> None:
    p = wurzel / rel
    t = p.read_text(encoding="utf-8")
    treffer = t.count(alt)
    assert treffer == 1, f"Mutation trifft {treffer}x statt 1x in {rel}: {alt!r}"   # sonst Mutation wirkungslos
    p.write_text(t.replace(alt, neu), encoding="utf-8")


def test_arbeitsbaum_ist_gruen():
    assert pn.pruefe(pn.Quelle(WURZEL)) == []


def test_negativ_kontrolle_kopie_ohne_aenderung_ist_gruen(kopie):
    assert pn.pruefe(pn.Quelle(kopie)) == []


def test_negativ_kontrolle_harmlose_aenderungen_bleiben_gruen(kopie):
    # Kommentar in names.cpp, Umordnung der Menge in hand.mjs (Set, ungeordnet), Leerraum: kein Befund
    mutiere(kopie, "djk/core/hand/src/names.cpp", "namespace hand {\n", "namespace hand {\n// harmlos\n")
    mutiere(kopie, "djk/contract/mock_core/hand.mjs", "'annehmen', 'verwerfen',", "'verwerfen', 'annehmen',")
    assert pn.pruefe(pn.Quelle(kopie)) == []


HAND_MJS = "djk/contract/mock_core/hand.mjs"
VERTRAG_MJS = "djk/contract/mock_core/contract.mjs"
NAMEN_CPP = "djk/core/hand/src/names.cpp"
MAPPING_H = "djk/core/hand/include/hand/mapping.h"
MAPPING_CPP = "djk/core/hand/src/mapping.cpp"
HAND_EIN_H = "djk/core/include/cypherdj/hand_in.h"
SERVER_TS = "djk/ui/server.ts"
KURVEN_JS = "djk/ui/public/curves.js"
SOFTCONTROLLER = "djk/config/controller/softcontroller.json"
VIER_TASTEN = "['annehmen', 'verwerfen', 'stopp', 'freigabe']"

MUTATIONEN = [
    # (Datei, alt, neu, erwartete Meldung): je eine Taste, Aktion oder ein Regler fehlt oder ist falsch in einer Quelle
    # ---- Tasten (T01 bis T12)
    (HAND_MJS, "'kiste_laden', ", "", "T08 hand.mjs TASTEN fehlt: kiste_laden"),
    (NAMEN_CPP, '"kiste_laden", ', "", "T05 names.cpp fehlt: kiste_laden"),
    (MAPPING_H, "kiste_laden, ", "", "T06 mapping.h enum fehlt: kiste_laden"),
    ("djk/core/hand/tests/test_names.cpp", '"kiste_laden", ', "", "T07 test_names.cpp fehlt: kiste_laden"),
    ("djk/contract/osc_addresses.ts", "'kiste_laden', ", "", "T04 osc_addresses.ts fehlt: kiste_laden"),
    ("djk/contract/osc_addresses.h", '"kiste_laden", ', "", "T03 osc_addresses.h fehlt: kiste_laden"),
    ("docs/architecture/INTERFACES.md", "`tempo_basis`, `zuruf` (Wert", "`zuruf` (Wert",
     "T01 INTERFACES §5.8 fehlt: tempo_basis"),
    ("djk/contract/osc.json", '"zuruf"]', '"zuruf", "achtzehnte"]', "T05 names.cpp fehlt: achtzehnte"),   # die 18. Taste
    (NAMEN_CPP, '"annehmen", "verwerfen",', '"verwerfen", "annehmen",',
     "Tasten-Reihenfolge: T05 names.cpp weicht von osc.json ab"),
    (SERVER_TS, VIER_TASTEN, VIER_TASTEN.replace("]", ", 'bogus']"), "T09 server.ts TASTEN steht ohne Vertrag: bogus"),
    (SERVER_TS, VIER_TASTEN, VIER_TASTEN.replace("]", ", 'autonomie']"),
     "Annahme-Weg: server.ts lässt Encoder-Taste autonomie zu, der Kern lehnt sie ab (hand_in.h)"),
    ("djk/ui/public/app.js", "'stopp', 'freigabe']) $(`#t-", "'stopp']) $(`#t-", "Annahme-Weg: server.ts ['annehmen', 'verwerfen', 'stopp', 'freigabe'] != app.js ['annehmen', 'verwerfen', 'stopp']"),
    ("djk/tools/softcontroller/keyboard.h", "{'Z', \"taste/zuruf\", true, 16, 20, Wirkung::druecken, 0},", "",
     "Softcontroller-Tasten: T11 keyboard.h fehlt: zuruf"),
    # ---- Encoder und /test/hand-Tasten kommen aus hand_in.h, nicht aus einer Abschrift
    (HAND_EIN_H, "k == hand::Taste::autonomie ||", "k == hand::Taste::stopp ||",
     "Annahme-Weg: server.ts lässt Encoder-Taste stopp zu, der Kern lehnt sie ab (hand_in.h)"),
    (HAND_EIN_H, "k == hand::Taste::autonomie || ", "", "Encoder=§19.0: T13 hand_in.h Encoder fehlt: autonomie"),
    (HAND_EIN_H, "k == hand::Taste::kiste_wahl)", "k == hand::Taste::kiste_wahl || k == hand::Taste::zuruf)",
     "Encoder=§19.0: T13 hand_in.h Encoder steht ohne Vertrag: zuruf"),
    (HAND_EIN_H, "r[1] == 'u'", "r[1] == 'x'", "Deck-Tasten=curves.js: A07 hand_in.h /test/hand steht ohne Vertrag: cxe"),
    (HAND_EIN_H, "r[1] == 'u'", "r[1] == 'x'", "Aktionen: A07 hand_in.h /test/hand kennt cxe, §7.2 nicht"),
    # ---- Deck-Aktionen (A01 bis A1x)
    (HAND_MJS, "|slip|", "|", "Aktionen=§7.2: A05 hand.mjs DECK_AKTION fehlt: slip"),
    (NAMEN_CPP, '{"slip", DeckAktion::slip}', '{"slipx", DeckAktion::slip}',
     "Aktionen=§7.2: A03 names.cpp fehlt: slip"),
    (MAPPING_H, "nudge, tap, slip, laden\n}", "nudge, tap, laden\n}", "Aktionen=§7.2: A02 mapping.h enum fehlt: slip"),
    (MAPPING_CPP, 'strncmp(a, "roll/", 5)', 'strncmp(a, "rollx/", 6)',
     "Aktionen: mapping.cpp parst Präfix rollx/<x>, §7.2 kennt es nicht"),
    (KURVEN_JS, "const DECK_TASTEN = ['play', 'cue'];", "const DECK_TASTEN = ['play', 'cue', 'bogus'];",
     "Aktionen: A06 curves.js DECK_TASTEN kennt bogus, §7.2 nicht"),
    (SOFTCONTROLLER, '"ziel":"deck/1/nudge"', '"ziel":"deck/1/nudgex"',
     "Mapping A1x softcontroller.json: Ziel deck/<n>/nudgex ist nicht in §7.2"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"ziel":"deck/5/play"',
     "Mapping softcontroller.json: Ziel deck/5/play: Deck-Nummer außerhalb 1 bis 4"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"ziel":"deck/x/play"',
     "Mapping softcontroller.json: Ziel deck/x/play: Deck-Nummer außerhalb 1 bis 4"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"ziel":"deck/1x/play"',
     "Mapping softcontroller.json: Ziel deck/1x/play: Deck-Nummer außerhalb 1 bis 4"),
    # ---- veraltete Ausnahmen: die pfl-Ausnahmen (A03, A05) dürfen nicht blind als genutzt gelten
    ("docs/architecture/INTERFACES.md", "`pfl`, ", "",
     "Ausnahme veraltet (tritt nicht mehr auf, streichen): ('A02 mapping.h enum', 'pfl')"),
    (HAND_MJS, "|slip|", "|slip|pfl|", "Ausnahme veraltet (tritt nicht mehr auf, streichen): "
     "('A05 hand.mjs DECK_AKTION', 'pfl')"),
    (NAMEN_CPP, '{"slip", DeckAktion::slip}', '{"slip", DeckAktion::slip}, {"pfl", DeckAktion::slip}',
     "Ausnahme veraltet (tritt nicht mehr auf, streichen): ('A03 names.cpp', 'pfl')"),
    # ---- Regler-Teil (REGLER, ZIELE, PFAD, Regler-Ziele der Mappings)
    (VERTRAG_MJS, "'master/kleber': R(LIN, 0, 1, 0, true), ", "",
     "Regler: curves.js ZIELE enthält master/kleber, attrappe REGLER nicht"),
    (VERTRAG_MJS, "'cue/pegel': R(DB", "'cue/pegelx': R(DB",
     "Regler: attrappe REGLER kennt cue/pegelx, hand_bedienung.PFAD lehnt es ab"),
    (KURVEN_JS, "'xfader', 'master/pegel',", "'xfader', 'master/pegelx',",
     "Regler: curves.js ZIELE enthält master/pegelx, attrappe REGLER nicht"),
    ("djk/ui/hand_operation.ts", "|xseite|pfl|ziel)$", "|xseite|ziel)$",
     "Regler: attrappe REGLER kennt deck/1/pfl, hand_bedienung.PFAD lehnt es ab"),
    (SOFTCONTROLLER, '"ziel":"xfader"', '"ziel":"xfaderx"',
     "Mapping softcontroller.json: Regler-Ziel xfaderx kennt die Attrappe nicht"),
]


# ---- D1 K1 (A11): Spur-Regler in allen Fundorten, Gründe
MUTATIONEN += [
    (KURVEN_JS, "...SPUREN.flatMap((n) => SPUR_REGLER.map((p) => `spur/${n}/${p}`)),",
     "...SPUREN.flatMap((n) => SPUR_REGLER.filter((p) => n !== 1 || p !== 'pan').map((p) => `spur/${n}/${p}`)),",
     "Spur-Regler=Kern: R04 curves.js ZIELE fehlt: spur/1/pan"),   # die Mutation aus Spec A11
    (VERTRAG_MJS, "REGLER.set(`spur/${n}/solo`", "REGLER.set(`spur/${n}/soli`",
     "Spur-Regler=Kern: R03 Attrappe REGLER fehlt: spur/1/solo"),
    ("djk/conductor/src/controls_info.ts", "tabelle.set(`spur/${n}/mute`, { pfad: `spur/${n}/mute`",
     "tabelle.set(`spur/${n}/mutx`, { pfad: `spur/${n}/mutx`", "Spur-Regler=Kern: R05 controls_info.ts fehlt: spur/1/mute"),
    ("docs/architecture/INTERFACES.md", "| `spur/<n>/solo` | Schalter |", "| `spur/<n>/solx` | Schalter |",
     "Spur-Regler=Kern: R02 INTERFACES §1.5 fehlt: spur/1/solo"),
    ("djk/core/signalbox/src/controls.cpp", '"spur/%d/pan"', '"spur/%d/balance"',
     "Spur-Regler=Kern: R03 Attrappe REGLER steht ohne Vertrag: spur/1/pan"),
    ("djk/ui/hand_operation.ts", "|^spur\\/([1-9]|[12][0-9]|3[0-2])\\/(fader|pan|mute|solo)$", "|^spur\\/([1-9]|[12][0-9]|3[0-2])\\/(fader|mute|solo)$",
     "Spur-Regler: R06 hand_bedienung.PFAD lehnt spur/1/pan ab"),
    ("djk/contract/schemas/defs.schema.json", "|spur/([1-9]|[12][0-9]|3[0-2])/(fader|pan|mute|solo)", "|spur/([1-9]|[12][0-9]|3[0-3])/(fader|pan|mute|solo)",
     "Spur-Regler: R07 defs.schema.json regler_pfad nimmt spur/33/fader an"),
    (VERTRAG_MJS, "'spur_bereich', 'reserviert',", "'spur_bereich',",
     "Gründe: Attrappe GRUENDE fehlt: reserviert"),
    ("djk/core/src/core_arr.cpp", 'return ab("nicht_geladen");', 'return ab("nicht_geladenx");',
     "Gründe: Kern-Quelltext vergibt nicht_geladenx, osc.json kennt es nicht"),
    ("djk/contract/osc.json", '"spur_bereich", "reserviert",', '"spur_bereich",',
     "Gründe: Attrappe GRUENDE kennt reserviert, osc.json nicht"),
    ("djk/contract/schemas/defs.schema.json", '"spur_bereich", "reserviert",', '"spur_bereich",',
     "Gründe=osc.json: G05 defs.schema.json grund fehlt: reserviert"),
]

# ---- D1 K1 Slice 10: Hand-Zielart arr/start_stopp
MUTATIONEN += [
    (HAND_MJS, "new Set(['arr/start_stopp'])", "new Set([])", "Zielarten=§7.2: Z04 hand.mjs ARR_ZIELE fehlt: arr/start_stopp"),
    (MAPPING_CPP, 'strcmp(z, "arr/start_stopp")', 'strcmp(z, "arr/startstopp")',
     "Zielarten=§7.2: Z02 mapping.cpp fehlt: arr/start_stopp"),
    (HAND_EIN_H, 'strcmp(p, "arr/start_stopp")', 'strcmp(p, "arr/start")',
     "Zielarten=§7.2: Z03 hand_in.h /test/hand steht ohne Vertrag: arr/start"),
    (MAPPING_H, "taste, arr };", "taste };", "Zielarten: Z05 mapping.h ZielArt kennt arr nicht"),
]


# ---- D1 K1 Review (Spec 6.16): Spur-Fader −200..+6 dB, Vorgabe 0, in allen Fundorten mit Bereich
MUTATIONEN += [
    ("djk/ui/public/curves.js", "spur_fader: { typ: 'fader_db', min: -200, max: 6,",
     "spur_fader: { typ: 'fader_db', min: -200, max: 0,", "Spur-Fader-Bereich=Kern: R04 curves.js"),
    (VERTRAG_MJS, "REGLER.set(`spur/${n}/fader`, { ...R(DB, -200, 6, 0)",
     "REGLER.set(`spur/${n}/fader`, { ...R(DB, -200, 0, 0)", "Spur-Fader-Bereich=Kern: R03 Attrappe REGLER"),
    ("djk/conductor/src/controls_info.ts",
     "tabelle.set(`spur/${n}/fader`, { pfad: `spur/${n}/fader`, kanal: null, ...r('db', -200, 6, 0) });",
     "tabelle.set(`spur/${n}/fader`, { pfad: `spur/${n}/fader`, kanal: null, ...r('db', -200, 0, 0) });",
     "Spur-Fader-Bereich=Kern: R05 controls_info.ts"),
    ("docs/architecture/INTERFACES.md", "| `spur/<n>/fader` | dB | −200 bis +6 |", "| `spur/<n>/fader` | dB | −200 bis 0 |",
     "Spur-Fader-Bereich=Kern: R02 INTERFACES §1.5"),
]


# ---- 1.10 Slice 1: Gruppen-Regler und PM in allen Fundorten
MUTATIONEN += [
    (KURVEN_JS, "...GRUPPEN.flatMap((n) => SPUR_REGLER.map((p) => `grp/${n}/${p}`)),",
     "...GRUPPEN.flatMap((n) => SPUR_REGLER.filter((p) => n !== 1 || p !== 'pan').map((p) => `grp/${n}/${p}`)),",
     "Routing-Regler=Kern: R04 curves.js ZIELE fehlt: grp/1/pan"),
    (VERTRAG_MJS, "REGLER.set(`grp/${n}/solo`", "REGLER.set(`grp/${n}/soli`", "Routing-Regler=Kern: R03 Attrappe REGLER fehlt: grp/1/solo"),
    ("djk/conductor/src/controls_info.ts", "tabelle.set(`grp/${n}/mute`, { pfad: `grp/${n}/mute`",
     "tabelle.set(`grp/${n}/mutx`, { pfad: `grp/${n}/mutx`", "Routing-Regler=Kern: R05 controls_info.ts fehlt: grp/1/mute"),
    ("docs/architecture/INTERFACES.md", "| `grp/<n>/solo` | Schalter |", "| `grp/<n>/solx` | Schalter |",
     "Routing-Regler=Kern: R02 INTERFACES §1.5 fehlt: grp/1/solo"),
    ("djk/core/signalbox/src/controls.cpp", '"grp/%d/pan"', '"grp/%d/balance"',
     "Routing-Regler=Kern: R03 Attrappe REGLER steht ohne Vertrag: grp/1/pan"),
    ("djk/ui/hand_operation.ts", "|^pm\\/fader$|^(spur", "|^(spur", "Routing-Regler: R06 hand_bedienung.PFAD lehnt pm/fader ab"),
    ("djk/contract/schemas/defs.schema.json", "|pm/fader|(spur/", "|pm/fadex|(spur/", "Routing-Regler: R07 defs.schema.json regler_pfad lehnt pm/fader ab"),
    (VERTRAG_MJS, "REGLER.set('pm/fader', { ...R(DB, -200, 6, 0), kanal: null });", "REGLER.set('pm/fader', { ...R(DB, -200, 0, 0), kanal: null });",
     "Routing-Fader-Bereich=Kern: R03 Attrappe REGLER"),
]


# ---- S5r: Graph-Regler <kanal>/bk/<1..8>, nur auf Kanälen mit Graph (deck/1..4, erz/1,2,3,5,6,7, pad/1,2)
MUTATIONEN += [
    (KURVEN_JS, "...BK_KANAELE.flatMap((k) => Array.from({ length: 8 }, (_, i) => `${k}/bk/${i + 1}`)),",
     "...BK_KANAELE.filter((k) => !k.startsWith('pad/')).flatMap((k) => Array.from({ length: 8 }, (_, i) => `${k}/bk/${i + 1}`)),",
     "bk-Regler=Kern: R04 curves.js ZIELE fehlt: pad/1/bk/1"),
    (VERTRAG_MJS, "for (const k of BK_KANAELE) for (let n = 1; n <= 8; n++) REGLER.set(",
     "for (const k of BK_KANAELE) for (let n = 1; n <= 7; n++) REGLER.set(", "bk-Regler=Kern: R03 Attrappe REGLER fehlt: deck/1/bk/8"),
    ("djk/conductor/src/controls_info.ts", "for (let n = 1; n <= 8; n++) tabelle.set(`${k}/bk/${n}`",
     "for (let n = 2; n <= 8; n++) tabelle.set(`${k}/bk/${n}`", "bk-Regler=Kern: R05 controls_info.ts fehlt: deck/1/bk/1"),
    ("djk/conductor/src/controls_info.ts", "'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];\nfor (const k of BK_KANAELE)",
     "'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];\nfor (const k of BK_KANAELE)", "bk-Regler=Kern: R05 controls_info.ts steht ohne Vertrag: erz/4/bk/1"),
    ("docs/architecture/INTERFACES.md", "erz/1, 2, 3, 5, 6, 7 und pad/1, 2 (Instrument", "erz/1, 2, 3, 4, 5, 6, 7 und pad/1, 2 (Instrument",
     "bk-Regler=Kern: R02 INTERFACES §1.5 steht ohne Vertrag: erz/4/bk/1"),
    ("djk/core/signalbox/src/controls.cpp", '"erz/3", "erz/5", "erz/6"', '"erz/3", "erz/4", "erz/5", "erz/6"',
     "bk-Regler=Kern: R03 Attrappe REGLER fehlt: erz/4/bk/1"),
    ("djk/ui/hand_operation.ts", "|^(deck\\/[1-4]|erz\\/[1-35-7]|pad\\/[12]|fx\\/[34])\\/bk\\/[1-8]$/;", "|^(deck\\/[1-4]|erz\\/[1-8]|pad\\/[12]|fx\\/[34])\\/bk\\/[1-8]$/;",
     "bk-Regler: R06 hand_bedienung.PFAD nimmt erz/4/bk/1 an"),
    ("djk/ui/hand_operation.ts", "|^(deck\\/[1-4]|erz\\/[1-35-7]|pad\\/[12]|fx\\/[34])\\/bk\\/[1-8]$/;", "/;",
     "bk-Regler: R06 hand_bedienung.PFAD lehnt deck/1/bk/1 ab"),
    ("djk/contract/schemas/defs.schema.json", "|(deck/[1-4]|erz/[1-35-7]|pad/[12]|fx/[34])/bk/[1-8])$\"", "|(deck/[1-4]|erz/[1-35-7]|pad/[12]|fx/[34])/bk/[1-9])$\"",
     "bk-Regler: R07 defs.schema.json regler_pfad nimmt deck/1/bk/9 an"),
    ("djk/contract/schemas/defs.schema.json", "|(deck/[1-4]|erz/[1-35-7]|pad/[12]|fx/[34])/bk/[1-8])$\"", "|(deck/[1-4]|erz/[1-8]|pad/[12]|fx/[34])/bk/[1-8])$\"",
     "bk-Regler: R07 defs.schema.json regler_pfad nimmt erz/4/bk/1 an"),
]


# ---- S14: graph knobs of the send returns fx/3/bk/1..8, fx/4/bk/1..8 (global controls) in all locations
MUTATIONEN += [
    ("djk/contract/schemas/defs.schema.json", "|(deck/[1-4]|erz/[1-35-7]|pad/[12]|fx/[34])/bk/[1-8])$\"", "|(deck/[1-4]|erz/[1-35-7]|pad/[12])/bk/[1-8])$\"",
     "bk-Regler: R07 defs.schema.json regler_pfad lehnt fx/3/bk/1 ab"),
    ("djk/contract/schemas/defs.schema.json", "|(deck/[1-4]|erz/[1-35-7]|pad/[12]|fx/[34])/bk/[1-8])$\"", "|(deck/[1-4]|erz/[1-35-7]|pad/[12]|fx/[1-4])/bk/[1-8])$\"",
     "bk-Regler: R07 defs.schema.json regler_pfad nimmt fx/1/bk/1 an"),
    ("djk/ui/hand_operation.ts", "|pad\\/[12]|fx\\/[34])\\/bk\\/[1-8]$/;", "|pad\\/[12])\\/bk\\/[1-8]$/;",
     "bk-Regler: R06 hand_bedienung.PFAD lehnt fx/3/bk/1 ab"),
    ("djk/ui/hand_operation.ts", "|pad\\/[12]|fx\\/[34])\\/bk\\/[1-8]$/;", "|pad\\/[12]|fx\\/[1-4])\\/bk\\/[1-8]$/;",
     "bk-Regler: R06 hand_bedienung.PFAD nimmt fx/1/bk/1 an"),
    (KURVEN_JS, "  ...BK_SEND_KANAELE.flatMap((k) => Array.from({ length: 8 }, (_, i) => `${k}/bk/${i + 1}`)),   // S14: graph knobs of fx/3, fx/4\n", "",
     "bk-Regler=Kern: R04 curves.js ZIELE fehlt: fx/3/bk/1"),
    (VERTRAG_MJS, "for (const k of BK_SEND_KANAELE) for (let n = 1; n <= 8; n++) REGLER.set(",
     "for (const k of BK_SEND_KANAELE) for (let n = 1; n <= 7; n++) REGLER.set(", "bk-Regler=Kern: R03 Attrappe REGLER fehlt: fx/3/bk/8"),
    ("djk/conductor/src/controls_info.ts", "for (let m = 1; m <= 8; m++) tabelle.set(`${k}/bk/${m}`",
     "for (let m = 2; m <= 8; m++) tabelle.set(`${k}/bk/${m}`", "bk-Regler=Kern: R05 controls_info.ts fehlt: fx/3/bk/1"),
    ("docs/architecture/INTERFACES.md", "`fx/<n>/bk/<m>` (n = 3 and 4, m = 1 to 8)", "`fx/<n>/bk/<m>` (n = 3, m = 1 to 8)",
     "bk-Regler=Kern: R02 INTERFACES §1.5 fehlt: fx/4/bk/1"),
    ("djk/core/signalbox/src/controls.cpp", 'for (const char* kn_bk_send : {"fx/3", "fx/4"})', 'for (const char* kn_bk_send : {"fx/3"})',
     "bk-Regler=Kern: R02 INTERFACES §1.5 steht ohne Vertrag: fx/4/bk/1"),
]


# ---- 1.10 Slice 3: Sends, Returns und Hall-Regler (204) in allen Fundorten
MUTATIONEN += [
    (KURVEN_JS, "...SPUREN.flatMap((n) => RETURNS.map((r) => `spur/${n}/send/${r}`)),",
     "...SPUREN.filter((n) => n !== 1).flatMap((n) => RETURNS.map((r) => `spur/${n}/send/${r}`)),",
     "Return-Regler=Kern: R04 curves.js ZIELE fehlt: spur/1/send/1"),
    ("djk/contract/schemas/defs.schema.json", "|ret/[1-4]/(fader|pan|mute|solo|hall/", "|ret/[1-4]/(pan|mute|solo|hall/",
     "Return-Regler: R07 defs.schema.json regler_pfad lehnt ret/1/fader ab"),
    ("docs/architecture/INTERFACES.md", "| `ret/<r>/hall/decay` |", "| `ret/<r>/hall/decai` |",
     "Return-Regler=Kern: R02 INTERFACES §1.5 fehlt: ret/1/hall/decay"),
    (VERTRAG_MJS, "REGLER.set(`ret/${r}/mute`, { ...R(SCHALTER, 0, 1, 0), kanal: null });", "REGLER.set(`ret/${r}/mutx`, { ...R(SCHALTER, 0, 1, 0), kanal: null });",
     "Return-Regler=Kern: R03 Attrappe REGLER fehlt: ret/1/mute"),
    ("djk/conductor/src/controls_info.ts", "for (let n = 1; n <= 8; n++) tabelle.set(`grp/${n}/send/${ret}`",
     "for (let n = 2; n <= 8; n++) tabelle.set(`grp/${n}/send/${ret}`", "Return-Regler=Kern: R05 controls_info.ts fehlt: grp/1/send/1"),
    ("djk/ui/hand_operation.ts", "|^ret\\/[1-4]\\/(fader|pan|mute|solo|hall", "|^ret\\/[1-5]\\/(fader|pan|mute|solo|hall",
     "Return-Regler: R06 hand_bedienung.PFAD nimmt ret/5/fader an"),
    ("djk/contract/schemas/defs.schema.json", "|(spur/([1-9]|[12][0-9]|3[0-2])|grp/[1-8])/send/[1-4]|", "|(spur/([1-9]|[12][0-9]|3[0-2])|grp/[1-8])/send/[1-5]|",
     "Return-Regler: R07 defs.schema.json regler_pfad nimmt spur/1/send/5 an"),
    ("djk/core/signalbox/src/controls.cpp", "Rolle::snd_spur, -200, 6, -200,", "Rolle::snd_spur, -200, 6, 0,",
     "Return-Bereich=Kern: R03 Attrappe REGLER spur/1/send/1 (min, max, vorgabe)"),
    ("djk/core/signalbox/src/controls.cpp", '{"decay", Rolle::ret_hall_decay, 0.5252f}', '{"decay", Rolle::ret_hall_decay, 0.6f}',
     "Return-Bereich=Kern: R03 Attrappe REGLER ret/1/hall/decay (min, max, vorgabe)"),
    (VERTRAG_MJS, "const HALL_VORGABE = { pre: 0.04,", "const HALL_VORGABE = { pre: 0.05,",
     "Return-Bereich=Kern: R03 Attrappe REGLER ret/1/hall/pre (min, max, vorgabe)"),
    (KURVEN_JS, "const VORGABE_HALL = { an: 1, pre: 0.04,", "const VORGABE_HALL = { an: 1, pre: 0.05,",
     "Return-Bereich=Kern: R04 curves.js (Griff 0 und 1, Vorgabe) ret/1/hall/pre (min, max, vorgabe)"),
]


def test_bk_zeile_in_schnittstellen_weg_wirft_parserfehler(kopie):
    mutiere(kopie, "docs/architecture/INTERFACES.md", "| `<k>/bk/<n>` (n = 1 bis 8)", "| `<k>/bx/<n>` (n = 1 bis 8)")
    with pytest.raises(pn.ParserFehler, match="bk"):
        pn.pruefe(pn.Quelle(kopie))


def test_bk_sendschleife_in_regler_cpp_weg_wirft_parserfehler(kopie):
    mutiere(kopie, "djk/core/signalbox/src/controls.cpp", "for (const char* kn_bk_send : ", "for (const char* kn_bk_sendx : ")
    with pytest.raises(pn.ParserFehler, match="bk"):
        pn.pruefe(pn.Quelle(kopie))


def test_bk_sendzeile_in_schnittstellen_weg_wirft_parserfehler(kopie):
    mutiere(kopie, "docs/architecture/INTERFACES.md", "| `fx/<n>/bk/<m>` (n = 3 and 4", "| `fx/<n>/bx/<m>` (n = 3 and 4")
    with pytest.raises(pn.ParserFehler, match="bk"):
        pn.pruefe(pn.Quelle(kopie))


def test_spur_fader_bereich_wie_spec_6_16():
    """D1 Spec 6.16 (und §4 Wertebereiche): spur/<n>/fader −200..+6 dB, Vorgabe 0, überall gleich."""
    b = pn.spur_fader_bereiche(pn.Quelle(WURZEL))
    assert b["R01 Kern controls.cpp"] == (-200.0, 6.0, 0.0), b
    for name, ist in b.items():
        assert all(abs(x - y) <= 1e-3 for x, y in zip(ist, (-200.0, 6.0, 0.0))), (name, ist)


# ---- 1.15 A2: the 345 mix-tool controls (gate, util, mb, lim, spektrum/kanal) in all locations. The four "one path dropped" mutations
# (controls_info.ts, PFAD, schema, Attrappe) come first, each found by name.
WZ_KOPF = "djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h"
SCHEMA = "djk/contract/schemas/defs.schema.json"
HAND_BED = "djk/ui/hand_operation.ts"
SPEC = "docs/architecture/INTERFACES.md"
MUTATIONEN += [
    ("djk/conductor/src/controls_info.ts", "['gate/hold', 'linear', 0, 2000, 20], ", "", "Werkzeug-Regler=Kern: R05 controls_info.ts fehlt: deck/1/gate/hold"),
    (HAND_BED, "attack|hold|release|sc)$", "attack|release|sc)$", "Werkzeug-Regler: R06 hand_bedienung.PFAD lehnt deck/1/gate/hold ab"),
    (SCHEMA, "|tausch|dc)", "|dc)", "Werkzeug-Regler: R07 defs.schema.json regler_pfad lehnt deck/1/util/tausch ab"),
    (VERTRAG_MJS, "['mb/grenze_tief', LIN, 20, 20000, 200], ", "", "Werkzeug-Regler=Kern: R03 Attrappe REGLER fehlt: bus/1/mb/grenze_tief"),
    # too many: an extra channel or an extra path in a pattern, an extra row in a list
    (HAND_BED, "|^(deck\\/[1-4]|erz\\/[1-7]|pad\\/[12])\\/gate\\/", "|^(deck\\/[1-4]|erz\\/[1-8]|pad\\/[12])\\/gate\\/",
     "Werkzeug-Regler: R06 hand_bedienung.PFAD nimmt erz/8/gate/an an"),
    (SCHEMA, "bus/[1-4]/lim/(an|decke|abklingen)", "bus/[1-4]/lim/(an|decke|abklingen|zz)", "Werkzeug-Regler: R07 defs.schema.json regler_pfad nimmt bus/1/lim/zz an"),
    (VERTRAG_MJS, "['lim/an', SCHALTER, 0, 1, 0], ", "['lim/an', SCHALTER, 0, 1, 0], ['lim/zz', LIN, 0, 1, 0], ",
     "Werkzeug-Regler=Kern: R03 Attrappe REGLER steht ohne Vertrag: bus/1/lim/zz"),
    ("djk/conductor/src/controls_info.ts", "{ kanaele: WZ_QUELLEN, zeilen: [", "{ kanaele: [...WZ_QUELLEN, 'erz/8'], zeilen: [",
     "Werkzeug-Regler=Kern: R05 controls_info.ts steht ohne Vertrag: erz/8/gate/an"),
    # the contract text and the header
    (SPEC, "| `<k>/util/dc` |", "| `<k>/util/dx` |", "Werkzeug-Regler=Kern: R02 INTERFACES §1.5 fehlt: deck/1/util/dc"),
    (SPEC, "| `<k>/gate/hold` | ms | 0 bis 2000 | 20 | 10 ms | alle; nur Quellkanäle ausser erz/8 |",
     "| `<k>/gate/hold` | ms | 0 bis 2000 | 20 | 10 ms | alle; nur Quellkanäle |", "Werkzeug-Regler=Kern: R02 INTERFACES §1.5 steht ohne Vertrag: erz/8/gate/hold"),
    (WZ_KOPF, '{WzTool::limiter, "lim/abklingen", 1, 2000, 80, KurvenTyp::linear, 10, false, WzKanalart::busse},\n',
     '{WzTool::limiter, "lim/abklingen", 1, 2000, 80, KurvenTyp::linear, 10, false, WzKanalart::busse},\n'
     '    {WzTool::limiter, "lim/zz", 0, 1, 0, KurvenTyp::linear, 10, false, WzKanalart::busse},\n', "Werkzeug-Regler=Kern: R05 controls_info.ts fehlt: bus/1/lim/zz"),
    (WZ_KOPF, '{WzTool::gate, "gate/hold", 0, 2000, 20,', '{WzTool::gate, "gate/hold", 0, 1999, 20,',
     "Werkzeug-Regler: R05 controls_info.ts Bereich oder Vorgabe von deck/1/gate/hold"),
    (WZ_KOPF, '{WzTool::gate, "gate/hold", 0, 2000, 20,', '{WzTool::gate, "gate/hold", 0, 2000, 21,',
     "Werkzeug-Regler: R03 Attrappe REGLER Bereich oder Vorgabe von pad/2/gate/hold"),
    (WZ_KOPF, '"erz/6",  "erz/7",', '"erz/6",  "erz/7", "erz/8",', "Werkzeug-Regler=Kern: R05 controls_info.ts fehlt: erz/8/gate/an"),
]

# ---- 1.10 slice 4a T6 / 4b T12: the insert controls ins/komp|eq|saett/<n>/* (120 + 59 + 4 controls) in all locations. Dropped, too many, wrong range, per location.
INS_INC = "djk/core/signalbox/src/insert_zeilen.inc"
INS_TS = "djk/conductor/src/insert_controls.ts"
INS_MJS = "djk/contract/mock_core/insert_controls.mjs"
MUTATIONEN += [
    (INS_TS, "  ['ins/komp/1/schp', 'linear', 0, 300, 0],\n", "", "Insert-Regler=Kern: R05 controls_info.ts fehlt: ins/komp/1/schp"),
    (HAND_BED, "|knie|attack|release|makeup|mix|schp|sc)$", "|attack|release|makeup|mix|schp|sc)$", "Insert-Regler: R06 hand_bedienung.PFAD lehnt ins/komp/1/knie ab"),
    (SCHEMA, "|makeup|mix|schp|sc)|ins/eq/", "|makeup|mix|sc)|ins/eq/", "Insert-Regler: R07 defs.schema.json regler_pfad lehnt ins/komp/1/schp ab"),
    (INS_MJS, "  ['ins/komp/1/mix', 'lin', 0, 1, 1],\n", "", "Insert-Regler=Kern: R03 Attrappe REGLER fehlt: ins/komp/1/mix"),
    # too many: a 13th instance in a pattern or in a list, a sibling name
    (HAND_BED, "ins\\/komp\\/([1-9]|1[0-2])\\/", "ins\\/komp\\/([1-9]|1[0-3])\\/", "Insert-Regler: R06 hand_bedienung.PFAD nimmt ins/komp/13/an an"),
    (SCHEMA, "ins/komp/([1-9]|1[0-2])/", "ins/komp/([1-9]|1[0-3])/", "Insert-Regler: R07 defs.schema.json regler_pfad nimmt ins/komp/13/an an"),
    (SCHEMA, "|makeup|mix|schp|sc)|ins/eq/", "|makeup|mix|schp|sc|zz)|ins/eq/", "Insert-Regler: R07 defs.schema.json regler_pfad nimmt ins/komp/1/zz an"),
    (INS_MJS, "  ['ins/komp/12/sc', 'stufe', 0, 32, 0],\n", "  ['ins/komp/12/sc', 'stufe', 0, 32, 0],\n  ['ins/komp/13/an', 'schalter', 0, 1, 0],\n",
     "Insert-Regler=Kern: R03 Attrappe REGLER steht ohne Vertrag: ins/komp/13/an"),
    (INS_TS, "  ['ins/komp/12/an', 'schalter', 0, 1, 0],\n", "", "Insert-Regler=Kern: R05 controls_info.ts fehlt: ins/komp/12/an"),
    # the contract text and the table
    (SPEC, "| `ins/komp/<n>/knie` |", "| `ins/komp/<n>/knx` |", "Insert-Regler=Kern: R02 INTERFACES §1.5 fehlt: ins/komp/1/knie"),
    (SPEC, "(n = 1 to 12; package 1.10 slice 4a", "(n = 1 to 11; package 1.10 slice 4a", "Insert-Regler=Kern: R02 INTERFACES §1.5 fehlt: ins/komp/12/an"),
    (SPEC, "| `ins/komp/<n>/schwelle` | dB | −60 to 0 | −18 |", "| `ins/komp/<n>/schwelle` | dB | −60 to 0 | −17 |",
     "Insert-Regler: R02 INTERFACES §1.5 Bereich oder Vorgabe von ins/komp/1/schwelle"),
    (INS_INC, '{"ins/komp/1/ratio", Rolle::ins_komp_ratio, 1.0f, 20.0f, 4.0f,', '{"ins/komp/1/ratio", Rolle::ins_komp_ratio, 1.0f, 21.0f, 4.0f,',
     "Insert-Regler: R03 Attrappe REGLER Bereich oder Vorgabe von ins/komp/1/ratio"),
    (INS_INC, '{"ins/komp/12/sc", Rolle::ins_komp_sc, 0.0f, 32.0f, 0.0f, KurvenTyp::stufen, 0, true},\n',
     '{"ins/komp/12/sc", Rolle::ins_komp_sc, 0.0f, 32.0f, 0.0f, KurvenTyp::stufen, 0, true},\n'
     '    {"ins/komp/13/an", Rolle::ins_komp_an, 0.0f, 1.0f, 0.0f, KurvenTyp::schalter, 0, true},\n',
     "Insert-Regler=Kern: R03 Attrappe REGLER fehlt: ins/komp/13/an"),
    # slice 4b: the eq (59 rows per instance, the band rows b<m>/...) and the saturator
    (INS_TS, "  ['ins/eq/1/b8/platz', 'stufe', 0, 2, 0],\n", "", "Insert-Regler=Kern: R05 controls_info.ts fehlt: ins/eq/1/b8/platz"),
    (INS_MJS, "  ['ins/saett/1/drive', 'lin', 0, 36, 12],\n", "", "Insert-Regler=Kern: R03 Attrappe REGLER fehlt: ins/saett/1/drive"),
    (HAND_BED, "b[1-8]\\/(an|typ|freq|gain|q|steil|platz)", "b[1-7]\\/(an|typ|freq|gain|q|steil|platz)", "Insert-Regler: R06 hand_bedienung.PFAD lehnt ins/eq/1/b8/an ab"),
    (HAND_BED, "ins\\/eq\\/[1-8]\\/", "ins\\/eq\\/[1-9]\\/", "Insert-Regler: R06 hand_bedienung.PFAD nimmt ins/eq/9/an an"),
    (SCHEMA, "ins/saett/[1-4]/(an|drive|out|mix)", "ins/saett/[1-4]/(an|drive|out|mix|zz)", "Insert-Regler: R07 defs.schema.json regler_pfad nimmt ins/saett/1/zz an"),
    (SCHEMA, "ins/eq/[1-8]/(an|out|propq|b[1-8]/", "ins/eq/[1-8]/(an|out|propq|b[0-8]/", "Insert-Regler: R07 defs.schema.json regler_pfad nimmt ins/eq/1/b0/an an"),
    (SPEC, "| `ins/eq/<n>/b<m>/gain` |", "| `ins/eq/<n>/b<m>/gaen` |", "Insert-Regler=Kern: R02 INTERFACES §1.5 fehlt: ins/eq/1/b1/gain"),
    (SPEC, "| `ins/eq/<n>/b1/freq` | Hz | 10 to 22000 | 30 |", "| `ins/eq/<n>/b1/freq` | Hz | 10 to 22000 | 31 |",
     "Insert-Regler: R02 INTERFACES §1.5 Bereich oder Vorgabe von ins/eq/1/b1/freq"),
]

MUTATION_IDS = [f"{m[0].split('/')[-1]}:{m[3][:40]}" for m in MUTATIONEN]


@pytest.mark.parametrize("datei,alt,neu,erwartet", MUTATIONEN, ids=MUTATION_IDS)
def test_mutation_wird_rot(kopie, datei, alt, neu, erwartet):
    mutiere(kopie, datei, alt, neu)
    try:
        f = pn.pruefe(pn.Quelle(kopie))
    except pn.ParserFehler as e:   # ein blinder Parser zählt auch als rot, ist aber nicht die gemeinte Meldung
        pytest.fail(f"Parser blind statt gezielter Meldung: {e}")
    assert any(erwartet in x for x in f), f"keine Meldung mit {erwartet!r}; gemeldet: {f}"


def test_blinder_parser_wirft_statt_gruen(kopie):
    mutiere(kopie, "djk/contract/mock_core/hand.mjs", "const TASTEN = new Set([", "const TASTEX = new Set([")
    with pytest.raises(pn.ParserFehler, match="hand.mjs"):
        pn.pruefe(pn.Quelle(kopie))


@pytest.mark.parametrize("datei,alt,neu,wort", [
    ("docs/architecture/INTERFACES.md", "`tap`, `slip`,", "`tap`, `sync2`, `slip`,", "sync2"),
    ("docs/architecture/INTERFACES.md", "`tap`, `slip`,", "`tap`, `beatjump/<n2>`, `slip`,", "beatjump"),
    ("docs/architecture/INTERFACES.md", "- `ziel`: ein Regler-Pfad (§1.5)", "- `zielx`: ein Regler-Pfad (§1.5)",
     "§7.2"),
    ("djk/core/include/cypherdj/hand_in.h", "test_taste_pfad", "test_taste_pfadx", "hand_in.h"),
], ids=["sync2", "beatjump", "marke_weg", "encoder_blind"])
def test_parser_meldet_verworfenes_oder_fehlendes_als_parserfehler(kopie, datei, alt, neu, wort):
    mutiere(kopie, datei, alt, neu)
    with pytest.raises(pn.ParserFehler, match=wort):
        pn.pruefe(pn.Quelle(kopie))


SERVER_TS_ALT = "const TASTEN = ['annehmen', 'verwerfen', 'stopp', 'freigabe'];"
APP_JS = "djk/ui/public/app.js"
APP_JS_ALT = "for (const n of ['annehmen', 'verwerfen', 'stopp', 'freigabe']) $(`#t-"
DECK_PFAD = "inline bool deck_taste_pfad(const char* p, int* deck, bool* play) {"
IST_CUE = "  const bool ist_cue = r[0] == 'c' && r[1] == 'u' && r[2] == 'e' && r[3] == '\\0';\n"

# Jede Mutation: Datei, alt, neu, Wort, das die ParserFehler-Meldung nennen muss. Der Parser darf nichts verwerfen.
PARSERFEHLER = [
    (HAND_EIN_H, DECK_PFAD, DECK_PFAD.replace("deck_taste_pfad", "deck_taste_pfadx"), "deck_taste_pfad"),
    (HAND_EIN_H, DECK_PFAD, DECK_PFAD.replace("deck_taste_pfad", "irgendwas"), "deck_taste_pfad"),
    (HAND_EIN_H, "if (!ist_play && !ist_cue) return false;",
     "if (!ist_play && !ist_cue && std::strcmp(r, \"bogus\") != 0) return false;", "deck_taste_pfad"),
    (HAND_EIN_H, "if (!ist_play && !ist_cue) return false;", "if (!ist_play) return false;", "ist_cue"),
    (HAND_EIN_H, "k == hand::Taste::kiste_wahl)", "k == hand::Taste::kiste_wahl || k == Taste::stopp)", "test_taste_pfad"),
    (HAND_EIN_H, "k == hand::Taste::kiste_wahl)", "k == hand::Taste::kiste_wahl || std::strcmp(p, \"x\") == 0)",
     "test_taste_pfad"),
    (HAND_EIN_H, "test_taste_pfad", "test_taste_pfadx", "test_taste_pfad"),
    (SERVER_TS, SERVER_TS_ALT, "const TASTEN = [];", "server.ts"),
    (APP_JS, APP_JS_ALT, APP_JS_ALT.replace("['annehmen', 'verwerfen', 'stopp', 'freigabe']", "[]"), "app.js"),
    (KURVEN_JS, "const DECK_TASTEN = ['play', 'cue'];", "const DECK_TASTEN = [];", "curves.js"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"zielx":"deck/1/play"', "ziel"),
    ("djk/contract/osc.json", '"abschnitt": "5.8", "liste"', '"abschnitt": "5.8", "listex"', "osc.json"),
    (KURVEN_JS, "const DECK_TASTEN = ['play', 'cue'];", "console.log('Lärm vor dem JSON');\nconst DECK_TASTEN = ['play', 'cue'];",
     "node"),
]


PARSERFEHLER += [
    (WZ_KOPF, "WERKZEUG_ZEILEN[] = {", "WERKZEUG_ZEILENX[] = {", "tool_controls.h"),
    (WZ_KOPF, '{WzTool::gate, "gate/hold", 0, 2000, 20, KurvenTyp::linear, 10, false, WzKanalart::quellen},',
     '{WzTool::gate, "gate/hold", 0, 2000, 20, KurvenTyp::linear, 10, false, WzKanalart::quellen, 99},', "Zeile nicht lesbar"),
    (WZ_KOPF, '{WzTool::gate, "gate/hold", 0, 2000, 20, KurvenTyp::linear, 10, false, WzKanalart::quellen},',
     '{WzTool::gate, "gate/release", 1, 5000, 100, KurvenTyp::linear, 10, false, WzKanalart::quellen},', "doppelt"),
    (WZ_KOPF, "WERKZEUG_BUSSE[] = {", "WERKZEUG_BUSSEX[] = {", "BUSSE"),
    ("djk/core/signalbox/src/controls.cpp", "for (const WerkzeugZeile& z : WERKZEUG_ZEILEN)", "for (const WerkzeugZeile& z : ANDERE_ZEILEN)", "controls.cpp"),
    (SPEC, "| `<k>/util/balance` | Balance (−1 links, +1 rechts) | −1 bis +1 | 0 | 10 ms | alle; Quellkanäle ausser erz/8 und Busse |",
     "| `<k>/util/balance` | Balance | −1 bis +1 | 0 | 10 ms |", "Werkzeug-Zeile nicht lesbar"),
    (SPEC, "| `bus/<n>/mb/<b>/ratio` (b = tief, mitte, hoch) |", "| `bus/<n>/mb/<b>/ratio` |", "ohne 'b = tief, mitte, hoch'"),
]


PARSERFEHLER += [   # 1.10 slice 4a T6: the insert reader never turns a rebuilt source into an empty green
    (INS_INC, "INSERT_ZEILEN[] = {", "INSERT_ZEILENX[] = {", "insert_zeilen.inc"),
    (INS_INC, '{"ins/komp/1/mix", Rolle::ins_komp_mix, 0.0f, 1.0f, 1.0f, KurvenTyp::linear, 10, false},',
     '{"ins/komp/1/mix", Rolle::ins_komp_mix, 0.0f, 1.0f, 1.0f, KurvenTyp::linear, 10, false, 99},', "Zeile nicht lesbar"),
    (INS_INC, '{"ins/komp/1/mix", Rolle::ins_komp_mix, 0.0f, 1.0f, 1.0f, KurvenTyp::linear, 10, false},',
     '{"ins/komp/1/ratio", Rolle::ins_komp_ratio, 1.0f, 20.0f, 4.0f, KurvenTyp::linear, 10, false},', "doppelt"),
    ("djk/core/signalbox/src/controls.cpp", '#include "insert_zeilen.inc"', '#include "andere_zeilen.inc"', "controls.cpp"),
    (SPEC, "| `ins/komp/<n>/mix` | 0 (dry) to 1 (wet) | 0 to 1 | 1 | 10 ms | all |", "| `ins/komp/<n>/mix` | 0 to 1 | 1 |", "Insert-Zeile nicht lesbar"),
    (SPEC, "`ins/komp/<n>/*` (n = 1 to 12;", "`ins/komp/<n>/*` (n = twelve;", "INTERFACES"),
]


@pytest.mark.parametrize("datei,alt,neu,wort", PARSERFEHLER, ids=[f"{p[0].split('/')[-1]}:{i}" for i, p in enumerate(PARSERFEHLER)])
def test_umgebaute_quelle_wirft_parserfehler_statt_gruen(kopie, datei, alt, neu, wort):
    mutiere(kopie, datei, alt, neu)
    with pytest.raises(pn.ParserFehler, match=wort):
        pn.pruefe(pn.Quelle(kopie))


def test_fremde_funktion_mit_ist_praefix_zaehlt_nicht_als_deck_taste(kopie):
    # Negativ-Kontrolle zu den Parsern: ein ist_zz in einer ANDEREN Funktion ist keine Deck-Taste und kein Befund
    mutiere(kopie, HAND_EIN_H, DECK_PFAD, "inline bool andere() { const bool ist_zz = r[0] == 'z'; return ist_zz; }\n" + DECK_PFAD)
    assert pn.pruefe(pn.Quelle(kopie)) == []


def test_deck_taste_cue_weg_wird_beidseitig_gemeldet(kopie):
    mutiere(kopie, HAND_EIN_H, IST_CUE, "")
    mutiere(kopie, HAND_EIN_H, "if (!ist_play && !ist_cue) return false;", "if (!ist_play) return false;")
    assert "Deck-Tasten=curves.js: A07 hand_in.h /test/hand fehlt: cue" in pn.pruefe(pn.Quelle(kopie))


@pytest.mark.parametrize("ersatz", ["['verwerfen', 'stopp', 'freigabe']", "['annehmen', 'verwerfen', 'stopp', 'freigabe', 'bogus']"])
def test_annahme_weg_hat_festes_soll(kopie, ersatz):
    mutiere(kopie, SERVER_TS, SERVER_TS_ALT, f"const TASTEN = {ersatz};")
    mutiere(kopie, APP_JS, APP_JS_ALT, APP_JS_ALT.replace("['annehmen', 'verwerfen', 'stopp', 'freigabe']", ersatz))
    f = pn.pruefe(pn.Quelle(kopie))
    assert any("Annahme-Weg: T09 server.ts TASTEN" in x and "weicht vom Soll" in x for x in f), f
    assert any("Annahme-Weg: T10 app.js Tasten" in x and "weicht vom Soll" in x for x in f), f


def test_taste_ziel_in_zweitem_mapping_wird_geprueft(kopie):
    d = kopie / "djk/config/controller"
    t = (d / "softcontroller.json").read_text(encoding="utf-8")
    (d / "zweit.json").write_text(t.replace('"taste/zuruf"', '"taste/zurufx"'), encoding="utf-8")
    f = pn.pruefe(pn.Quelle(kopie))
    assert any("zweit.json" in x and "taste/zurufx" in x for x in f), f


def test_node_fehler_wird_mit_stderr_gemeldet(kopie):
    (kopie / "djk/contract/mock_core/contract.mjs").write_text("export const REGLER = ;\n", encoding="utf-8")
    with pytest.raises(pn.ParserFehler, match="SyntaxError"):
        pn.pruefe(pn.Quelle(kopie))


def test_relative_wurzel_funktioniert():
    r = subprocess.run([sys.executable, str(HIER / "check_name_lists.py"), "--wurzel", "."], cwd=WURZEL,
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stdout[-400:] + r.stderr[-400:]


def test_rev_meldet_uebersprungenen_regler_teil(capsys):
    pn.pruefe(pn.Quelle(WURZEL, "HEAD"))
    assert "Regler-Teil übersprungen" in capsys.readouterr().err


def test_wildcard_ausnahme_ohne_treffer_ist_veraltet(kopie, monkeypatch):
    monkeypatch.setitem(pn.AUSNAHMEN, ("T07 test_names.cpp", "*"), "erfunden")
    assert any("Ausnahme veraltet" in x and "T07" in x for x in pn.pruefe(pn.Quelle(kopie)))


def test_veraltete_ausnahme_wird_gemeldet(kopie, monkeypatch):
    monkeypatch.setitem(pn.AUSNAHMEN, ("T11 keyboard.h", "zuruf"), "erfunden")
    assert any("Ausnahme veraltet" in x and "zuruf" in x for x in pn.pruefe(pn.Quelle(kopie)))
