"""Vertragstest L3 (Paket 0.3): Namenslisten gegeneinander.
pytest -q djk/vertrag/tests/test_namenslisten.py -p no:cacheprovider. Laufzeit < 2 s.
Mutationsprobe und Negativ-Kontrollen arbeiten auf Kopien in tmp_path, nie im Arbeitsbaum."""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pruefe_namenslisten as pn  # noqa: E402

WURZEL = pn.HIER.parents[1]   # Repo-Wurzel dieses Arbeitsbaums (auch im Worktree)


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
    # Kommentar in namen.cpp, Umordnung der Menge in hand.mjs (Set, ungeordnet), Leerraum: kein Befund
    mutiere(kopie, "djk/kern/hand/src/namen.cpp", "namespace hand {\n", "namespace hand {\n// harmlos\n")
    mutiere(kopie, "djk/vertrag/attrappe_kern/hand.mjs", "'annehmen', 'verwerfen',", "'verwerfen', 'annehmen',")
    assert pn.pruefe(pn.Quelle(kopie)) == []


HAND_MJS = "djk/vertrag/attrappe_kern/hand.mjs"
VERTRAG_MJS = "djk/vertrag/attrappe_kern/vertrag.mjs"
NAMEN_CPP = "djk/kern/hand/src/namen.cpp"
MAPPING_H = "djk/kern/hand/include/hand/mapping.h"
MAPPING_CPP = "djk/kern/hand/src/mapping.cpp"
HAND_EIN_H = "djk/kern/include/cypherdj/hand_ein.h"
SERVER_TS = "djk/oberflaeche/server.ts"
KURVEN_JS = "djk/oberflaeche/oeffentlich/kurven.js"
SOFTCONTROLLER = "djk/konfig/controller/softcontroller.json"
VIER_TASTEN = "['annehmen', 'verwerfen', 'stopp', 'freigabe']"

MUTATIONEN = [
    # (Datei, alt, neu, erwartete Meldung): je eine Taste, Aktion oder ein Regler fehlt oder ist falsch in einer Quelle
    # ---- Tasten (T01 bis T12)
    (HAND_MJS, "'kiste_laden', ", "", "T08 hand.mjs TASTEN fehlt: kiste_laden"),
    (NAMEN_CPP, '"kiste_laden", ', "", "T05 namen.cpp fehlt: kiste_laden"),
    (MAPPING_H, "kiste_laden, ", "", "T06 mapping.h enum fehlt: kiste_laden"),
    ("djk/kern/hand/tests/test_namen.cpp", '"kiste_laden", ', "", "T07 test_namen.cpp fehlt: kiste_laden"),
    ("djk/vertrag/osc_adressen.ts", "'kiste_laden', ", "", "T04 osc_adressen.ts fehlt: kiste_laden"),
    ("djk/vertrag/osc_adressen.h", '"kiste_laden", ', "", "T03 osc_adressen.h fehlt: kiste_laden"),
    ("docs/architektur/SCHNITTSTELLEN.md", "`tempo_basis`, `zuruf` (Wert", "`zuruf` (Wert",
     "T01 SCHNITTSTELLEN §5.8 fehlt: tempo_basis"),
    ("djk/vertrag/osc.json", '"zuruf"]', '"zuruf", "achtzehnte"]', "T05 namen.cpp fehlt: achtzehnte"),   # die 18. Taste
    (NAMEN_CPP, '"annehmen", "verwerfen",', '"verwerfen", "annehmen",',
     "Tasten-Reihenfolge: T05 namen.cpp weicht von osc.json ab"),
    (SERVER_TS, VIER_TASTEN, VIER_TASTEN.replace("]", ", 'bogus']"), "T09 server.ts TASTEN steht ohne Vertrag: bogus"),
    (SERVER_TS, VIER_TASTEN, VIER_TASTEN.replace("]", ", 'autonomie']"),
     "Annahme-Weg: server.ts lässt Encoder-Taste autonomie zu, der Kern lehnt sie ab (hand_ein.h)"),
    ("djk/oberflaeche/oeffentlich/app.js", "'stopp', 'freigabe']) $(`#t-", "'stopp']) $(`#t-", "Annahme-Weg: server.ts ['annehmen', 'verwerfen', 'stopp', 'freigabe'] != app.js ['annehmen', 'verwerfen', 'stopp']"),
    ("djk/werkzeuge/softcontroller/tastatur.h", "{'Z', \"taste/zuruf\", true, 16, 20, Wirkung::druecken, 0},", "",
     "Softcontroller-Tasten: T11 tastatur.h fehlt: zuruf"),
    # ---- Encoder und /test/hand-Tasten kommen aus hand_ein.h, nicht aus einer Abschrift
    (HAND_EIN_H, "k == hand::Taste::autonomie ||", "k == hand::Taste::stopp ||",
     "Annahme-Weg: server.ts lässt Encoder-Taste stopp zu, der Kern lehnt sie ab (hand_ein.h)"),
    (HAND_EIN_H, "k == hand::Taste::autonomie || ", "", "Encoder=§19.0: T13 hand_ein.h Encoder fehlt: autonomie"),
    (HAND_EIN_H, "k == hand::Taste::kiste_wahl)", "k == hand::Taste::kiste_wahl || k == hand::Taste::zuruf)",
     "Encoder=§19.0: T13 hand_ein.h Encoder steht ohne Vertrag: zuruf"),
    (HAND_EIN_H, "r[1] == 'u'", "r[1] == 'x'", "Deck-Tasten=kurven.js: A07 hand_ein.h /test/hand steht ohne Vertrag: cxe"),
    (HAND_EIN_H, "r[1] == 'u'", "r[1] == 'x'", "Aktionen: A07 hand_ein.h /test/hand kennt cxe, §7.2 nicht"),
    # ---- Deck-Aktionen (A01 bis A1x)
    (HAND_MJS, "|slip|", "|", "Aktionen=§7.2: A05 hand.mjs DECK_AKTION fehlt: slip"),
    (NAMEN_CPP, '{"slip", DeckAktion::slip}', '{"slipx", DeckAktion::slip}',
     "Aktionen=§7.2: A03 namen.cpp fehlt: slip"),
    (MAPPING_H, "nudge, tap, slip, laden\n}", "nudge, tap, laden\n}", "Aktionen=§7.2: A02 mapping.h enum fehlt: slip"),
    (MAPPING_CPP, 'strncmp(a, "roll/", 5)', 'strncmp(a, "rollx/", 6)',
     "Aktionen: mapping.cpp parst Präfix rollx/<x>, §7.2 kennt es nicht"),
    (KURVEN_JS, "const DECK_TASTEN = ['play', 'cue'];", "const DECK_TASTEN = ['play', 'cue', 'bogus'];",
     "Aktionen: A06 kurven.js DECK_TASTEN kennt bogus, §7.2 nicht"),
    (SOFTCONTROLLER, '"ziel":"deck/1/nudge"', '"ziel":"deck/1/nudgex"',
     "Mapping A1x softcontroller.json: Ziel deck/<n>/nudgex ist nicht in §7.2"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"ziel":"deck/5/play"',
     "Mapping softcontroller.json: Ziel deck/5/play: Deck-Nummer außerhalb 1 bis 4"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"ziel":"deck/x/play"',
     "Mapping softcontroller.json: Ziel deck/x/play: Deck-Nummer außerhalb 1 bis 4"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"ziel":"deck/1x/play"',
     "Mapping softcontroller.json: Ziel deck/1x/play: Deck-Nummer außerhalb 1 bis 4"),
    # ---- veraltete Ausnahmen: die pfl-Ausnahmen (A03, A05) dürfen nicht blind als genutzt gelten
    ("docs/architektur/SCHNITTSTELLEN.md", "`pfl`, ", "",
     "Ausnahme veraltet (tritt nicht mehr auf, streichen): ('A02 mapping.h enum', 'pfl')"),
    (HAND_MJS, "|slip|", "|slip|pfl|", "Ausnahme veraltet (tritt nicht mehr auf, streichen): "
     "('A05 hand.mjs DECK_AKTION', 'pfl')"),
    (NAMEN_CPP, '{"slip", DeckAktion::slip}', '{"slip", DeckAktion::slip}, {"pfl", DeckAktion::slip}',
     "Ausnahme veraltet (tritt nicht mehr auf, streichen): ('A03 namen.cpp', 'pfl')"),
    # ---- Regler-Teil (REGLER, ZIELE, PFAD, Regler-Ziele der Mappings)
    (VERTRAG_MJS, "'master/kleber': R(LIN, 0, 1, 0, true), ", "",
     "Regler: kurven.js ZIELE enthält master/kleber, attrappe REGLER nicht"),
    (VERTRAG_MJS, "'cue/pegel': R(DB", "'cue/pegelx': R(DB",
     "Regler: attrappe REGLER kennt cue/pegelx, hand_bedienung.PFAD lehnt es ab"),
    (KURVEN_JS, "'xfader', 'master/pegel',", "'xfader', 'master/pegelx',",
     "Regler: kurven.js ZIELE enthält master/pegelx, attrappe REGLER nicht"),
    ("djk/oberflaeche/hand_bedienung.ts", "|xseite|pfl|ziel)$", "|xseite|ziel)$",
     "Regler: attrappe REGLER kennt deck/1/pfl, hand_bedienung.PFAD lehnt es ab"),
    (SOFTCONTROLLER, '"ziel":"xfader"', '"ziel":"xfaderx"',
     "Mapping softcontroller.json: Regler-Ziel xfaderx kennt die Attrappe nicht"),
]


# ---- D1 K1 (A11): Spur-Regler in allen Fundorten, Gründe
MUTATIONEN += [
    (KURVEN_JS, "...SPUREN.flatMap((n) => SPUR_REGLER.map((p) => `spur/${n}/${p}`)),",
     "...SPUREN.flatMap((n) => SPUR_REGLER.filter((p) => n !== 1 || p !== 'pan').map((p) => `spur/${n}/${p}`)),",
     "Spur-Regler=Kern: R04 kurven.js ZIELE fehlt: spur/1/pan"),   # die Mutation aus Spec A11
    (VERTRAG_MJS, "REGLER.set(`spur/${n}/solo`", "REGLER.set(`spur/${n}/soli`",
     "Spur-Regler=Kern: R03 Attrappe REGLER fehlt: spur/1/solo"),
    ("djk/leitstand/src/regler_info.ts", "tabelle.set(`spur/${n}/mute`, { pfad: `spur/${n}/mute`",
     "tabelle.set(`spur/${n}/mutx`, { pfad: `spur/${n}/mutx`", "Spur-Regler=Kern: R05 regler_info.ts fehlt: spur/1/mute"),
    ("docs/architektur/SCHNITTSTELLEN.md", "| `spur/<n>/solo` | Schalter |", "| `spur/<n>/solx` | Schalter |",
     "Spur-Regler=Kern: R02 SCHNITTSTELLEN §1.5 fehlt: spur/1/solo"),
    ("djk/kern/stellwerk/src/regler.cpp", '"spur/%d/pan"', '"spur/%d/balance"',
     "Spur-Regler=Kern: R03 Attrappe REGLER steht ohne Vertrag: spur/1/pan"),
    ("djk/oberflaeche/hand_bedienung.ts", "|^spur\\/[1-8]\\/(fader|pan|mute|solo)$", "|^spur\\/[1-8]\\/(fader|mute|solo)$",
     "Spur-Regler: R06 hand_bedienung.PFAD lehnt spur/1/pan ab"),
    ("djk/vertrag/schemas/defs.schema.json", "|spur/[1-8]/(fader|pan|mute|solo)", "|spur/[1-9]/(fader|pan|mute|solo)",
     "Spur-Regler: R07 defs.schema.json regler_pfad nimmt spur/9/fader an"),
    (VERTRAG_MJS, "'spur_bereich', 'reserviert']", "'spur_bereich']",
     "Gründe: Attrappe GRUENDE fehlt: reserviert"),
    ("djk/kern/src/kern_arr.cpp", 'return ab("nicht_geladen");', 'return ab("nicht_geladenx");',
     "Gründe: Kern-Quelltext vergibt nicht_geladenx, osc.json kennt es nicht"),
    ("djk/vertrag/osc.json", '"spur_bereich", "reserviert"]', '"spur_bereich"]',
     "Gründe: Attrappe GRUENDE kennt reserviert, osc.json nicht"),
    ("djk/vertrag/schemas/defs.schema.json", '"spur_bereich", "reserviert"]', '"spur_bereich"]',
     "Gründe=osc.json: G05 defs.schema.json grund fehlt: reserviert"),
]

# ---- D1 K1 Slice 10: Hand-Zielart arr/start_stopp
MUTATIONEN += [
    (HAND_MJS, "new Set(['arr/start_stopp'])", "new Set([])", "Zielarten=§7.2: Z04 hand.mjs ARR_ZIELE fehlt: arr/start_stopp"),
    (MAPPING_CPP, 'strcmp(z, "arr/start_stopp")', 'strcmp(z, "arr/startstopp")',
     "Zielarten=§7.2: Z02 mapping.cpp fehlt: arr/start_stopp"),
    (HAND_EIN_H, 'strcmp(p, "arr/start_stopp")', 'strcmp(p, "arr/start")',
     "Zielarten=§7.2: Z03 hand_ein.h /test/hand steht ohne Vertrag: arr/start"),
    (MAPPING_H, "taste, arr };", "taste };", "Zielarten: Z05 mapping.h ZielArt kennt arr nicht"),
]


# ---- D1 K1 Review (Spec 6.16): Spur-Fader −200..+6 dB, Vorgabe 0, in allen Fundorten mit Bereich
MUTATIONEN += [
    ("djk/oberflaeche/oeffentlich/kurven.js", "spur_fader: { typ: 'fader_db', min: -200, max: 6,",
     "spur_fader: { typ: 'fader_db', min: -200, max: 0,", "Spur-Fader-Bereich=Kern: R04 kurven.js"),
    (VERTRAG_MJS, "REGLER.set(`spur/${n}/fader`, { ...R(DB, -200, 6, 0)",
     "REGLER.set(`spur/${n}/fader`, { ...R(DB, -200, 0, 0)", "Spur-Fader-Bereich=Kern: R03 Attrappe REGLER"),
    ("djk/leitstand/src/regler_info.ts", "...r('db', -200, 6, 0) });", "...r('db', -200, 0, 0) });",
     "Spur-Fader-Bereich=Kern: R05 regler_info.ts"),
    ("docs/architektur/SCHNITTSTELLEN.md", "| `spur/<n>/fader` | dB | −200 bis +6 |", "| `spur/<n>/fader` | dB | −200 bis 0 |",
     "Spur-Fader-Bereich=Kern: R02 SCHNITTSTELLEN §1.5"),
]


def test_spur_fader_bereich_wie_spec_6_16():
    """D1 Spec 6.16 (und §4 Wertebereiche): spur/<n>/fader −200..+6 dB, Vorgabe 0, überall gleich."""
    b = pn.spur_fader_bereiche(pn.Quelle(WURZEL))
    assert b["R01 Kern regler.cpp"] == (-200.0, 6.0, 0.0), b
    for name, ist in b.items():
        assert all(abs(x - y) <= 1e-3 for x, y in zip(ist, (-200.0, 6.0, 0.0))), (name, ist)


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
    mutiere(kopie, "djk/vertrag/attrappe_kern/hand.mjs", "const TASTEN = new Set([", "const TASTEX = new Set([")
    with pytest.raises(pn.ParserFehler, match="hand.mjs"):
        pn.pruefe(pn.Quelle(kopie))


@pytest.mark.parametrize("datei,alt,neu,wort", [
    ("docs/architektur/SCHNITTSTELLEN.md", "`tap`, `slip`,", "`tap`, `sync2`, `slip`,", "sync2"),
    ("docs/architektur/SCHNITTSTELLEN.md", "`tap`, `slip`,", "`tap`, `beatjump/<n2>`, `slip`,", "beatjump"),
    ("docs/architektur/SCHNITTSTELLEN.md", "- `ziel`: ein Regler-Pfad (§1.5)", "- `zielx`: ein Regler-Pfad (§1.5)",
     "§7.2"),
    ("djk/kern/include/cypherdj/hand_ein.h", "test_taste_pfad", "test_taste_pfadx", "hand_ein.h"),
], ids=["sync2", "beatjump", "marke_weg", "encoder_blind"])
def test_parser_meldet_verworfenes_oder_fehlendes_als_parserfehler(kopie, datei, alt, neu, wort):
    mutiere(kopie, datei, alt, neu)
    with pytest.raises(pn.ParserFehler, match=wort):
        pn.pruefe(pn.Quelle(kopie))


SERVER_TS_ALT = "const TASTEN = ['annehmen', 'verwerfen', 'stopp', 'freigabe'];"
APP_JS = "djk/oberflaeche/oeffentlich/app.js"
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
    (KURVEN_JS, "const DECK_TASTEN = ['play', 'cue'];", "const DECK_TASTEN = [];", "kurven.js"),
    (SOFTCONTROLLER, '"ziel":"deck/1/play"', '"zielx":"deck/1/play"', "ziel"),
    ("djk/vertrag/osc.json", '"abschnitt": "5.8", "liste"', '"abschnitt": "5.8", "listex"', "osc.json"),
    (KURVEN_JS, "const DECK_TASTEN = ['play', 'cue'];", "console.log('Lärm vor dem JSON');\nconst DECK_TASTEN = ['play', 'cue'];",
     "node"),
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
    assert "Deck-Tasten=kurven.js: A07 hand_ein.h /test/hand fehlt: cue" in pn.pruefe(pn.Quelle(kopie))


@pytest.mark.parametrize("ersatz", ["['verwerfen', 'stopp', 'freigabe']", "['annehmen', 'verwerfen', 'stopp', 'freigabe', 'bogus']"])
def test_annahme_weg_hat_festes_soll(kopie, ersatz):
    mutiere(kopie, SERVER_TS, SERVER_TS_ALT, f"const TASTEN = {ersatz};")
    mutiere(kopie, APP_JS, APP_JS_ALT, APP_JS_ALT.replace("['annehmen', 'verwerfen', 'stopp', 'freigabe']", ersatz))
    f = pn.pruefe(pn.Quelle(kopie))
    assert any("Annahme-Weg: T09 server.ts TASTEN" in x and "weicht vom Soll" in x for x in f), f
    assert any("Annahme-Weg: T10 app.js Tasten" in x and "weicht vom Soll" in x for x in f), f


def test_taste_ziel_in_zweitem_mapping_wird_geprueft(kopie):
    d = kopie / "djk/konfig/controller"
    t = (d / "softcontroller.json").read_text(encoding="utf-8")
    (d / "zweit.json").write_text(t.replace('"taste/zuruf"', '"taste/zurufx"'), encoding="utf-8")
    f = pn.pruefe(pn.Quelle(kopie))
    assert any("zweit.json" in x and "taste/zurufx" in x for x in f), f


def test_node_fehler_wird_mit_stderr_gemeldet(kopie):
    (kopie / "djk/vertrag/attrappe_kern/vertrag.mjs").write_text("export const REGLER = ;\n", encoding="utf-8")
    with pytest.raises(pn.ParserFehler, match="SyntaxError"):
        pn.pruefe(pn.Quelle(kopie))


def test_relative_wurzel_funktioniert():
    r = subprocess.run([sys.executable, str(HIER / "pruefe_namenslisten.py"), "--wurzel", "."], cwd=WURZEL,
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stdout[-400:] + r.stderr[-400:]


def test_rev_meldet_uebersprungenen_regler_teil(capsys):
    pn.pruefe(pn.Quelle(WURZEL, "HEAD"))
    assert "Regler-Teil übersprungen" in capsys.readouterr().err


def test_wildcard_ausnahme_ohne_treffer_ist_veraltet(kopie, monkeypatch):
    monkeypatch.setitem(pn.AUSNAHMEN, ("T07 test_namen.cpp", "*"), "erfunden")
    assert any("Ausnahme veraltet" in x and "T07" in x for x in pn.pruefe(pn.Quelle(kopie)))


def test_veraltete_ausnahme_wird_gemeldet(kopie, monkeypatch):
    monkeypatch.setitem(pn.AUSNAHMEN, ("T11 tastatur.h", "zuruf"), "erfunden")
    assert any("Ausnahme veraltet" in x and "zuruf" in x for x in pn.pruefe(pn.Quelle(kopie)))
