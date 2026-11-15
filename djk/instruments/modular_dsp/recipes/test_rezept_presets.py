"""Tests for the recipe presets (one factory preset per recipe graph) and for the ownership rule of build_factory_presets.py.

    python3 -m pytest djk/instruments/modular_dsp/recipes/test_rezept_presets.py
"""
import json
import pathlib
import re
import subprocess
import sys

import pytest

HIER = pathlib.Path(__file__).resolve().parent
MOD = HIER.parent
FACTORY = MOD.parents[1] / "ui" / "presets" / "factory"
WERK = FACTORY / "modular"
REZEPTE = MOD / "demos" / "recipes"
MANIFEST = json.loads((REZEPTE / "MANIFEST.json").read_text())["patches"]
VOK = json.loads((MOD.parents[1] / "ui" / "presets" / "vokabular.json").read_text())["inhalt"]
GRAPHEN = {p["datei"][:-5] for p in MANIFEST}


def rezept_presets():
    out = []
    for f in sorted(WERK.glob("*.preset.json")):
        d = json.loads(f.read_text())
        if d["graph"] in GRAPHEN:
            out.append((f, d))
    return out


def test_46_presets_one_per_recipe_graph():
    ps = rezept_presets()
    assert len(MANIFEST) == 46
    assert len(ps) == 46
    assert sorted(d["graph"] for _, d in ps) == sorted(GRAPHEN)


def test_every_file_name_is_a_valid_store_slug():
    """The store accepts 48 characters; a longer file name is silently left out of the register."""
    for f, _ in rezept_presets():
        slug = f.name[: -len(".preset.json")]
        assert re.fullmatch(r"[a-z0-9][a-z0-9-]{0,47}", slug), f.name


def test_graph_is_a_recipe_file_and_keys_are_knobs_of_that_graph():
    for f, d in rezept_presets():
        graph = REZEPTE / (d["graph"] + ".json")
        assert graph.exists(), f.name
        namen = json.loads(graph.read_text())["regler_namen"]
        erlaubt = {f"knob{n}" for n in namen}
        assert d["werte"], f.name
        assert set(d["werte"]) == erlaubt, f.name


def test_character_words_are_in_the_vocabulary_and_notiz_names_the_card():
    wort = set(VOK["charakter"])
    ps = {d["graph"]: d for _, d in rezept_presets()}
    for p in MANIFEST:
        d = ps[p["datei"][:-5]]
        assert set(d["beschreibung"]["charakter"]) <= wort, d["name"]
        assert d["beschreibung"]["genre"] == []
        assert d["notiz"].startswith(f"Source rule: recipe card `{p['karte']}`, {p['zitat']}."), d["name"]
        assert "not yet heard" in d["notiz"]
        assert d["name"] == p["titel"][0].upper() + p["titel"][1:]


def test_out_of_vocabulary_words_are_mapped_and_the_original_stays_in_notiz():
    abbild = {"sub": "deep", "harsh": "aggressive", "nasal": "thin", "digital": "clean",
              "analog": "warm", "boxy": "dark", "boomy": "thick", "heavy": "thick"}
    gesehen = set()
    ps = {d["graph"]: d for _, d in rezept_presets()}
    for p in MANIFEST:
        d = ps[p["datei"][:-5]]
        for w in p["beschreibung"]["charakter"]:
            if w in abbild:
                gesehen.add(w)
                # the mapped word, unless it is the opposite of an earlier word (then the notiz says it was dropped)
                assert abbild[w] in d["beschreibung"]["charakter"] or "Dropped" in d["notiz"], (d["name"], w)
                assert w in d["notiz"], (d["name"], w)
    assert gesehen == set(abbild)


def test_builder_leaves_every_preset_it_does_not_own_byte_identical(tmp_path):
    """A run of build_factory_presets.py must reproduce each file it writes exactly as committed (git status stays clean)."""
    r = subprocess.run([sys.executable, str(MOD / "build_factory_presets.py"), str(tmp_path)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    erzeugt = sorted((tmp_path / "modular").glob("*.preset.json"))
    assert erzeugt
    for f in erzeugt:
        assert (WERK / f.name).exists(), f.name
        assert f.read_bytes() == (WERK / f.name).read_bytes(), f.name
    namen = {f.name for f in erzeugt}
    # presets of the synth build-out belong to baue_ausbau_presets_<synth>.py
    assert "synth-mono-dub-bass.preset.json" not in namen
    assert "synth-mono-evolving-lead.preset.json" not in namen
    # and the recipe presets are owned by it
    assert sum(1 for _, d in rezept_presets() if f"{d['graph']}" in GRAPHEN) == 46
    assert len([n for n in namen if n.split(".")[0] in {f.name.split(".")[0] for f, _ in rezept_presets()}]) == 46


def test_recipe_patch_builder_is_deterministic(tmp_path):
    out = tmp_path / "recipes-patches.json"
    r = subprocess.run([sys.executable, str(HIER / "build_rezept_presets.py"), str(out)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert out.read_bytes() == (MOD / "patches" / "recipes-patches.json").read_bytes()


def test_recipe_categories_are_in_kategorien_json_and_the_script_is_idempotent(tmp_path):
    kat = MOD / "kategorien.json"
    kopie = tmp_path / "kategorien.json"
    kopie.write_bytes(kat.read_bytes())
    r = subprocess.run([sys.executable, str(HIER / "build_rezept_kategorien.py"), str(kopie)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert kopie.read_bytes() == kat.read_bytes()   # the committed file is what the script writes
    k = json.loads(kat.read_text())
    soll = {"bass": "bass", "lead": "lead", "pad": "pad", "keys": "keys", "pluck": "keys", "drums": "drums", "percussion": "drums", "fx": "textur"}
    for g in GRAPHEN:
        assert k[g]["kategorie"] == soll[g.split("-")[0]], g
        assert 1 <= len(k[g]["text"]) <= 90 and k[g]["text"].endswith(".") and "—" not in k[g]["text"], g
