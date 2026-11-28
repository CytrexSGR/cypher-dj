"""Note editor contract (plan A, task A1): schemas, example files and the command line text of djk/contract/noten.md.

Run: cd djk/contract && python -m pytest -q tests/test_notes_contract.py -p no:cacheprovider

JSON Schema cannot express rules that compare two values of the instance (order and overlap of notes, `ton` against `qton`,
the curve length against `frames`). `regel_gruende` below is a second, independent implementation of those rules in Python;
the first one is `djk/ui/project/notes_contract.ts`. Both must agree with the same example files, which makes the examples the
contract. The expected reasons come from the file names (`<schema>_schlecht_<reason>.json`)."""
import json
import pathlib
import re
import sys

import pytest

HIER = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import schema_loader as sl  # noqa: E402

CASES = HIER / "cases" / "noten"
NOTEN_MD = HIER / "notes.md"

# file name prefix -> schema (longest prefix wins)
SCHEMA_ZU_PRAEFIX = {
    "audio_noten": "audio_noten.schema.json",
    "kurve": "noten_kurve.schema.json",
    "roh": "noten_kurve_roh.schema.json",
    "auftrag": "noten_auftrag.schema.json",
}
GUT = ["audio_noten_gut", "audio_noten_leer_gut", "audio_noten_ton_24_gut", "audio_noten_zeit_gut", "kurve_gut", "kurve_kurz_gut", "kurve_mono_gut",
       "kurve_mono_mehrstimmig_gut", "roh_gut", "auftrag_gut"]
# bad case -> ("regel", [reasons of regel_gruende in rule order]) or ("schema", token in the path or keyword of a schema error)
SCHLECHT = {
    "audio_noten_schlecht_reihenfolge": ("regel", ["reihenfolge"]),
    "audio_noten_schlecht_ueberlappung": ("regel", ["ueberlappung"]),
    "audio_noten_schlecht_ton_gleich": ("regel", ["ton_gleich"]),
    "audio_noten_schlecht_ton_grenze": ("regel", ["ton_grenze"]),
    "audio_noten_schlecht_id": ("schema", "id"),
    "audio_noten_schlecht_id_doppelt": ("regel", ["id"]),
    "audio_noten_schlecht_dauer": ("regel", ["dauer"]),
    "audio_noten_schlecht_a_gleich": ("regel", ["ziel_gleich"]),
    "audio_noten_schlecht_e_gleich": ("regel", ["ziel_gleich"]),
    "audio_noten_schlecht_ziel_ende": ("regel", ["ziel_ende"]),
    "audio_noten_schlecht_ton_bereich": ("schema", "ton"),
    "audio_noten_schlecht_form_vor_regel": ("schema", "id"),
    "audio_noten_schlecht_regelfolge": ("regel", ["id", "ueberlappung"]),
    "audio_noten_schlecht_ziel_ueberlappen": ("regel", ["ziel_ueberlappen"]),
    "audio_noten_schlecht_dehnung_gross": ("regel", ["dehnung"]),
    "audio_noten_schlecht_dehnung_klein": ("regel", ["dehnung"]),
    "kurve_schlecht_laenge": ("regel", ["laenge"]),
    "kurve_schlecht_f0": ("schema", "f0_ct"),
    "kurve_schlecht_praefix": ("schema", "kurve"),
    "kurve_schlecht_noten_dauer": ("regel", ["dauer"]),
    "kurve_schlecht_noten_reihenfolge": ("regel", ["reihenfolge"]),
    "kurve_schlecht_noten_ueberlappung": ("regel", ["ueberlappung"]),
    "kurve_schlecht_noten_ausserhalb": ("regel", ["ausserhalb"]),
    "kurve_schlecht_mono_anteil": ("regel", ["mono_anteil"]),
    "kurve_schlecht_mono_leer": ("regel", ["mono_leer"]),
    "auftrag_schlecht_kurve": ("schema", "kurve"),
    "auftrag_schlecht_id_doppelt": ("regel", ["id"]),
    "auftrag_schlecht_dauer": ("regel", ["dauer"]),
    "auftrag_schlecht_a_gleich": ("regel", ["ziel_gleich"]),
    "auftrag_schlecht_e_gleich": ("regel", ["ziel_gleich"]),
    "auftrag_schlecht_ziel_ende": ("regel", ["ziel_ende"]),
    "auftrag_schlecht_ton_grenze": ("regel", ["ton_grenze"]),
    "auftrag_schlecht_ton_bereich": ("schema", "ton"),
}
MONO_ANTEIL_MAX = 0.30
TON_SPANNE = 24
DEHNUNG_MIN, DEHNUNG_MAX, DEHNUNG_TOLERANZ = 0.25, 4, 1e-9
TON_TOLERANZ = 1e-4   # targets are rounded to 1e-4, qton has no decimals rule
# reasons that are format errors of a file (the schema or the self-consistency of a curve), not rule errors of the notes
FORMAT_GRUENDE = {"laenge", "f0_stellen", "konf_stellen", "mono_anteil", "mono_leer"}


def schema_name(datei):
    treffer = [p for p in SCHEMA_ZU_PRAEFIX if datei.startswith(p + "_")]
    assert treffer, f"no schema for the prefix of {datei}"
    return SCHEMA_ZU_PRAEFIX[max(treffer, key=len)]


def lade(name):
    return json.loads((CASES / f"{name}.json").read_text(encoding="utf-8"))


def schema_fehler(datei, obj):
    return list(sl.validator(schema_name(datei)).iter_errors(obj))


def schema_tokens(fehler):
    tok = set()
    for f in fehler:
        tok.add(f.validator)
        tok.update(str(p) for p in f.absolute_path)
    return tok


def _nachkommastellen_ok(x, stellen):
    return abs(round(x * 10 ** stellen) - x * 10 ** stellen) < 1e-6


def ton_im_spann(ton, qton):
    return 0 <= ton <= 127 and abs(ton - qton) <= TON_SPANNE + TON_TOLERANZ


def liste_gruende(liste, mit_ziel, ende_max=None):
    """Rule reasons of a note list in the fixed rule order (shape is the schema's business): duplicate ids, duration, targets against
    detected values (per note: ton equal, ton span, a equal, e equal, effective end), order, overlap, end inside the source."""
    g = []
    if mit_ziel:
        ids = [n["id"] for n in liste]
        if len(set(ids)) != len(ids):
            g.append("id")
    if any(n["qe"] <= n["qa"] + 0.01 for n in liste):
        g.append("dauer")
    if mit_ziel:
        for n in liste:
            if "ton" in n:
                if n["ton"] == n["qton"]:
                    g.append("ton_gleich")
                elif not ton_im_spann(n["ton"], n["qton"]):
                    g.append("ton_grenze")
            for ziel, erkannt in (("a", "qa"), ("e", "qe")):
                if ziel in n and n[ziel] == n[erkannt]:
                    g.append("ziel_gleich")
            if n.get("e", n["qe"]) <= n.get("a", n["qa"]):
                g.append("ziel_ende")
            elif not (DEHNUNG_MIN - DEHNUNG_TOLERANZ <= (n.get("e", n["qe"]) - n.get("a", n["qa"])) / (n["qe"] - n["qa"]) <= DEHNUNG_MAX + DEHNUNG_TOLERANZ):
                g.append("dehnung")
    if any(b["qa"] < a["qa"] for a, b in zip(liste, liste[1:])):
        g.append("reihenfolge")
    elif any(a["qe"] > b["qa"] for a, b in zip(liste, liste[1:])):
        g.append("ueberlappung")
    elif mit_ziel and any(a.get("e", a["qe"]) > b.get("a", b["qa"]) for a, b in zip(liste, liste[1:])):
        g.append("ziel_ueberlappen")
    if ende_max is not None and any(n["qe"] > ende_max for n in liste):
        g.append("ausserhalb")
    return list(dict.fromkeys(g))


def mono_gruende(m):
    g = []
    if m["mehrstimmig"] != (m["anteil"] > MONO_ANTEIL_MAX):
        g.append("mono_anteil")
    if m["geprueft_frames"] == 0 and (m["anteil"] != 0 or m["mehrstimmig"]):
        g.append("mono_leer")
    return g


def kurve_gruende(o):
    """Format-class reasons first (lengths, decimals, mono), then the rule reasons of the detected notes"""
    g = []
    n = o["frames"] // 256 + 1
    if len(o["f0_ct"]) != n or len(o["konf"]) != n:
        g.append("laenge")
    elif not all(_nachkommastellen_ok(x, 2) for x in o["f0_ct"]):
        g.append("f0_stellen")
    elif not all(_nachkommastellen_ok(x, 3) for x in o["konf"]):
        g.append("konf_stellen")
    if "mono" in o:
        g += mono_gruende(o["mono"])
    # one hop of slack: the last frame is centred at or before the last sample, a note ends at the end of its last frame
    return g + liste_gruende(o["noten"], False, (o["frames"] + 256) / 48000 + 1e-6)


def regel_gruende(datei, obj):
    """Reasons from the cross-value rules; call it on an object that is valid against its schema."""
    if datei.startswith("audio_noten_") or datei.startswith("auftrag_"):
        return liste_gruende(obj["liste"], True)
    if datei.startswith("kurve_"):
        return kurve_gruende(obj)
    if datei.startswith("roh_"):
        return kurve_gruende({**obj, "noten": []})
    raise AssertionError(datei)


def befund_code(datei, obj):
    """The reason code the contract table gives (notes.md, Reason codes): None when the object is valid."""
    clip = datei.startswith("audio_noten_")
    fehler = schema_fehler(datei, obj)
    if fehler:
        if clip:
            grenze = any(f.validator in ("minimum", "maximum") and list(f.absolute_path)[-1:] == ["ton"] for f in fehler)
            return "noten_ton_grenze" if grenze else "argument_ungueltig"
        return "format"
    g = regel_gruende(datei, obj)
    if not g:
        return None
    if g[0] in FORMAT_GRUENDE:
        return "format"
    if clip:
        return {"ton_grenze": "noten_ton_grenze", "ziel_ueberlappen": "noten_ueberlappen", "dehnung": "noten_dehnung_grenze"}.get(g[0], "argument_ungueltig")
    return "noten_ungueltig"


def test_example_files_are_exactly_the_listed_ones():
    erwartet = set(GUT) | set(SCHLECHT) | {"zeilen", "schluessel", "gruende"}
    assert {p.stem for p in CASES.glob("*.json")} == erwartet


def test_every_good_case_is_valid():
    for name in GUT:
        obj = lade(name)
        fehler = schema_fehler(name, obj)
        assert fehler == [], (name, fehler[0].message, list(fehler[0].absolute_path))
        assert regel_gruende(name, obj) == [], name


def test_every_bad_case_fails_for_its_reason():
    for name, (art, grund) in SCHLECHT.items():
        obj = lade(name)
        fehler = schema_fehler(name, obj)
        if art == "regel":
            assert fehler == [], f"{name}: the schema alone must accept it, the rule rejects it: {fehler[:1]}"
            assert regel_gruende(name, obj) == grund, name
        else:
            assert fehler, f"{name}: expected a schema error"
            assert grund in schema_tokens(fehler), (name, schema_tokens(fehler))


def test_reason_table_gruende_json_covers_every_bad_file():
    tabelle = json.loads((CASES / "gruende.json").read_text(encoding="utf-8"))
    schlecht = {p.name for p in CASES.glob("*_schlecht_*.json")}
    assert set(tabelle) == schlecht
    erlaubt = {"argument_ungueltig", "noten_ton_grenze", "format", "noten_ungueltig", "noten_ueberlappen", "noten_dehnung_grenze"}
    for name, code in tabelle.items():
        assert code in erlaubt, name
        stem = name.removesuffix(".json")
        assert befund_code(stem, lade(stem)) == code, name
    for name in GUT:
        assert befund_code(name, lade(name)) is None, name


def test_rule_order_and_shape_before_rules():
    liste = lade("audio_noten_gut")["liste"]
    kopie = lambda: json.loads(json.dumps(liste))  # noqa: E731
    # duplicate id and a note that is too short: the duplicate id is reported first
    k = kopie()
    k[1]["id"] = k[0]["id"]
    k[2]["qe"] = k[2]["qa"] + 0.01
    assert liste_gruende(k, True) == ["id", "dauer"]
    # duration before targets before order before overlap
    k = kopie()
    k[0]["qe"] = k[0]["qa"] + 0.01
    k[1]["ton"] = k[1]["qton"]
    assert liste_gruende(k, True) == ["dauer", "ton_gleich"]
    # targets are checked over all notes before order: ton equal in the last note, order broken at the first pair
    k = kopie()
    k[2]["ton"] = k[2]["qton"]
    k[1]["qa"], k[1]["qe"] = 0.1, 0.4
    assert liste_gruende(k, True) == ["ton_gleich", "reihenfolge"]
    # the boundary of the span: 24 inside (also with the rounding of a target to 1e-4), 24.001 outside
    assert liste_gruende(lade("audio_noten_ton_24_gut")["liste"], True) == []
    k = kopie()
    k[0]["ton"] = k[0]["qton"] + 24.001
    assert liste_gruende(k, True) == ["ton_grenze"]
    assert ton_im_spann(84.1235, 60.12346) and not ton_im_spann(84.2, 60.12346)
    assert not ton_im_spann(127.5, 110) and not ton_im_spann(-0.5, 10)
    # duration: exactly 0.01 is refused (the limit is qe > qa + 0.01)
    k = kopie()
    k[0]["qa"], k[0]["qe"] = 0.0, 0.01
    assert liste_gruende(k, True) == ["dauer"]
    k[0]["qe"] = 0.0100001
    assert liste_gruende(k, True) == []


def test_time_target_rules_and_their_boundaries():
    def neu(t1=None, t2=None):
        return [{"id": "t1", "qa": 0.0, "qe": 0.5, "qton": 60, "p": 1, **(t1 or {})},
                {"id": "t2", "qa": 1.0, "qe": 1.5, "qton": 62, "p": 1, **(t2 or {})}]
    one = lambda **z: [{"id": "t1", "qa": 0.0, "qe": 0.5, "qton": 60, "p": 1, **z}]  # noqa: E731
    assert liste_gruende(neu(t1={"e": 1.0}), True) == []                      # touching: e_eff == a_eff
    assert liste_gruende(neu(t1={"e": 1.0 + 1e-6}), True) == ["ziel_ueberlappen"]
    assert liste_gruende(neu(t2={"a": 0.5}), True) == []                      # only a, touching the detected end of t1
    assert liste_gruende(neu(t2={"a": 0.25}), True) == ["ziel_ueberlappen"]
    assert liste_gruende(one(e=2.0), True) == []                              # exactly 4
    assert liste_gruende(one(e=2.001), True) == ["dehnung"]
    assert liste_gruende(one(e=0.125), True) == []                            # exactly 0.25
    assert liste_gruende(one(e=0.124), True) == ["dehnung"]
    # the stretch rule runs with the per-note rules, before the overlap rules
    k = neu(t1={"e": 3.0})
    k[1]["qa"], k[1]["qe"] = 0.2, 0.4
    assert liste_gruende(k, True) == ["dehnung", "ueberlappung"]
    # the detected-overlap rule stays and comes first; the sidecar never runs the target rules
    k = [{"id": "t1", "qa": 0, "qe": 1, "qton": 60, "p": 1}, {"id": "t2", "qa": 0.5, "qe": 2, "qton": 60, "p": 1, "a": 1.5}]
    assert liste_gruende(k, True) == ["ueberlappung"]
    assert liste_gruende(neu(t1={"e": 1.2}), False) == []


def test_mono_rules():
    mono = lade("kurve_mono_gut")["mono"]
    assert mono_gruende(mono) == []
    assert mono_gruende(dict(mono, anteil=MONO_ANTEIL_MAX)) == []          # exactly 0.30 is not more than 0.30
    assert mono_gruende(dict(mono, anteil=0.31, mehrstimmig=True)) == []
    assert mono_gruende(dict(mono, anteil=0.31)) == ["mono_anteil"]
    assert mono_gruende(dict(mono, geprueft_frames=0)) == []
    assert mono_gruende(dict(mono, geprueft_frames=0, anteil=0.1)) == ["mono_leer"]


def test_rules_catch_what_the_examples_do_not_cover():
    liste = lade("audio_noten_gut")["liste"]
    doppelt = json.loads(json.dumps(liste))
    doppelt[1]["id"] = doppelt[0]["id"]
    assert liste_gruende(doppelt, True) == ["id"]
    kurz = json.loads(json.dumps(liste))
    kurz[0]["qe"] = kurz[0]["qa"] + 0.01
    assert liste_gruende(kurz, True) == ["dauer"]
    ziel = json.loads(json.dumps(liste))
    ziel[0]["a"] = ziel[0]["qa"]
    assert liste_gruende(ziel, True) == ["ziel_gleich"]
    ende = json.loads(json.dumps(liste))
    ende[0]["a"] = ende[0]["qe"] + 0.1
    assert liste_gruende(ende, True) == ["ziel_ende"]
    # touching notes are allowed, an octave pair at exactly +-24 too
    ok = json.loads(json.dumps(liste))
    ok[0]["ton"] = ok[0]["qton"] + 24
    assert liste_gruende(ok, True) == []


def test_schema_refuses_default_valued_and_unknown_fields():
    v = sl.validator("audio_noten.schema.json")
    basis = lade("audio_noten_gut")
    for feld, wert in (("vib", 1), ("drift", 1), ("formant", 0), ("gain_db", 0), ("extra", 1), ("vib", 4.5), ("formant", 12.5),
                       ("gain_db", -48.5), ("gain_db", 12.5), ("ton", 127.5), ("ton", -1)):
        kaputt = json.loads(json.dumps(basis))
        kaputt["liste"][0][feld] = wert
        assert not v.is_valid(kaputt), (feld, wert)
    for feld, wert in (("vib", 0), ("vib", 4), ("drift", 0.5), ("formant", -12), ("formant", 12), ("gain_db", -48), ("gain_db", 12)):
        gut = json.loads(json.dumps(basis))
        gut["liste"][0][feld] = wert
        assert v.is_valid(gut), (feld, wert)
    zu_viele = {"kurve": basis["kurve"], "liste": [{"id": f"t{i + 1}", "qa": i, "qe": i + 0.5, "qton": 60, "p": 1} for i in range(4097)]}
    assert not v.is_valid(zu_viele)
    assert v.is_valid({"kurve": basis["kurve"], "liste": zu_viele["liste"][:4096]})
    for kurve in ("pyin-1", "pyin-1.noten_hmm", "PYIN-1.noten_hmm-1", "pyin-1.noten_hmm-1 "):
        assert not v.is_valid({"kurve": kurve, "liste": []}), kurve


def test_sidecar_curve_id_follows_the_detector():
    v = sl.validator("noten_kurve.schema.json")
    basis = lade("kurve_gut")
    assert basis["detektor"] == "pyin"
    netz = dict(basis, detektor="netz", kurve="netz-1.noten_hmm-1")
    assert v.is_valid(netz)
    assert not v.is_valid(dict(basis, detektor="netz"))          # curve id says pyin
    assert not v.is_valid(dict(basis, kurve="netz-1.noten_hmm-1"))  # detector says pyin
    assert not v.is_valid(lade("kurve_schlecht_praefix"))
    assert not v.is_valid(dict(basis, sr=44100))
    assert not v.is_valid(dict(basis, hop=512))
    assert not v.is_valid(dict(basis, quelle="A" * 64))
    assert not v.is_valid(dict(basis, stimmhaft_anteil=1.5))
    mono = lade("kurve_mono_gut")["mono"]
    for feld in mono:
        kaputt = dict(basis, mono={k: w for k, w in mono.items() if k != feld})
        assert not v.is_valid(kaputt), feld


def test_lines_follow_the_line_schema():
    v = sl.validator("noten_zeile.schema.json")
    paare = json.loads((CASES / "zeilen.json").read_text(encoding="utf-8"))
    assert all(set(p) == {"zeile", "gut"} for p in paare)
    gut_zahl = schlecht_zahl = 0
    for p in paare:
        zeile = p["zeile"]
        assert isinstance(zeile, str)
        try:
            text = zeile[:-1] if zeile.endswith("\n") else zeile   # one trailing LF is the line end
            obj = json.loads(text)
            gueltig = "\n" not in text and "\r" not in text and v.is_valid(obj)
        except ValueError:
            gueltig = False
        assert gueltig == p["gut"], zeile
        gut_zahl += p["gut"]
        schlecht_zahl += not p["gut"]
    assert schlecht_zahl >= 3
    gute = [json.loads(p["zeile"]) for p in paare if p["gut"]]
    # every command has an ok line, every error code exactly one failure line
    assert sum("programm" in o for o in gute) == 1
    assert sum("bereiche" in o for o in gute) >= 1
    assert sum("anteil" in o for o in gute) >= 1
    assert sum("noten" in o for o in gute) >= 2     # analyse and segment
    codes = [o["fehler"] for o in gute if o["status"] == "fehler"]
    assert codes == schema_codes()


def schema_codes():
    return sl.teilschema("noten_zeile.schema.json#/$defs/fehler_code")["enum"]


def test_progress_payload_follows_the_line_schema():
    v = sl.validator("noten_zeile.schema.json#/$defs/fortschritt")
    gut = {"stufe": 2, "von": 5, "name": "tonhoehe", "prozent": 40.5}
    assert v.is_valid(gut)
    for name in ("laden", "tonhoehe", "noten", "pruefen", "rendern", "schreiben"):
        assert v.is_valid(dict(gut, name=name)), name
    assert v.is_valid(dict(gut, teil="stem 2"))          # the optional field liesFortschrittsZeichen reads
    for kaputt in (dict(gut, teil=3), dict(gut, name="warten"), dict(gut, stufe=0), dict(gut, von=0), dict(gut, prozent=101), dict(gut, prozent=-1),
                   dict(gut, extra=1), {k: w for k, w in gut.items() if k != "prozent"}):
        assert not v.is_valid(kaputt), kaputt


def md_codes():
    text = NOTEN_MD.read_text(encoding="utf-8")
    m = re.search(r"^## Error codes\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    assert m, "notes.md needs a section '## Error codes'"
    return re.findall(r"^\| `([a-z_]+)` \|", m.group(1), re.M)


def test_error_codes_enum_matches_noten_md():
    assert md_codes() == schema_codes()


def test_noten_md_names_the_constants_of_the_schemas():
    text = NOTEN_MD.read_text(encoding="utf-8")
    for const in ("cdj-noten-kurve/1", "cdj-noten-kurve-roh/1", "cdj-noten-auftrag/1", "cdj-noten-render/1", "DETEKTOR_VERSION",
                  "NETZ_VERSION", "SEGMENTIERER_VERSION", "MASCHINE_VERSION", "@@fortschritt", "cypherdj-noten", "MONO_ANTEIL_MAX"):
        assert const in text, const
    # the version numbers live in notes_contract.ts only; the segmenter number bumps with the monophonic check
    assert "noten_hmm-1" not in text
    for befehl in ("version", "analyse", "segment", "pruefe", "render"):
        assert re.search(rf"^### `{befehl}\b", text, re.M), befehl
    assert "## Reason codes" in text
    assert sl.teilschema("noten_kurve.schema.json")["properties"]["format"]["const"] == "cdj-noten-kurve/1"
    assert sl.teilschema("noten_kurve_roh.schema.json")["properties"]["format"]["const"] == "cdj-noten-kurve-roh/1"
    assert sl.teilschema("noten_auftrag.schema.json")["properties"]["format"]["const"] == "cdj-noten-auftrag/1"


def test_render_key_pre_images_are_hand_written_and_hash_correctly():
    import hashlib
    faelle = json.loads((CASES / "schluessel.json").read_text(encoding="utf-8"))
    assert len(faelle) == 3
    for f in faelle:
        assert set(f) == {"quelle", "kurve", "maschine", "liste", "text", "sha256"}
        kopf = f"cdj-noten-render/1\n{f['quelle']}\n{f['kurve']}\n{f['maschine']}\n"
        assert f["text"].startswith(kopf)
        assert "\n" not in f["text"][len(kopf):]
        assert hashlib.sha256(f["text"].encode("utf-8")).hexdigest() == f["sha256"]
        assert re.fullmatch(r"[0-9a-f]{64}", f["sha256"])
