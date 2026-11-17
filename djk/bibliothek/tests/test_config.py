import json
import os
from pathlib import Path

import pytest

from bibliothek.config import Konfig, KonfigFehler, Wurzel, katalog_ziel, lies_konfig, schreibe_konfig


def test_katalog_ziel_default_is_home_share():
    assert katalog_ziel({}) == Path(os.environ["HOME"]) / ".local/share/cypherdj/mediathek/katalog.sqlite"


def test_katalog_ziel_follows_mediathek_folder():
    assert katalog_ziel({"CYPHERDJ_MEDIATHEK": "/x/m.sqlite"}) == Path("/x/katalog.sqlite")


def test_katalog_ziel_explicit_wins():
    env = {"CYPHERDJ_MEDIATHEK": "/x/m.sqlite", "CYPHERDJ_KATALOG": "/y/k?#%.sqlite"}
    assert katalog_ziel(env) == Path("/y/k?#%.sqlite")


def test_absent_config_means_no_roots():
    k = lies_konfig()
    assert k.schema == 1 and k.wurzeln == []


def test_roundtrip_default_path():
    k = Konfig(1, [Wurzel(Path("/a/b c"), "auto"), Wurzel(Path("/d"), "loop")])
    schreibe_konfig(k)
    assert (Path(os.environ["HOME"]) / ".config/cypherdj/bibliothek.json").is_file()
    assert lies_konfig() == k


def test_env_override(monkeypatch, tmp_path):
    p = tmp_path / "sub" / "b.json"
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_KONFIG", str(p))
    schreibe_konfig(Konfig(1, [Wurzel(Path("/m"), "track")]))
    assert json.loads(p.read_text())["wurzeln"] == [{"pfad": "/m", "typ": "track"}]
    assert not list(p.parent.glob("*.tmp*"))


def test_schema_2_rejected(monkeypatch, tmp_path):
    p = tmp_path / "b.json"
    p.write_text('{"schema": 2, "wurzeln": []}')
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_KONFIG", str(p))
    with pytest.raises(KonfigFehler):
        lies_konfig()


@pytest.mark.parametrize("text", [
    "{nope", "[]", '{"schema": 1}', '{"schema": 1, "wurzeln": [{"pfad": "rel", "typ": "auto"}]}',
    '{"schema": 1, "wurzeln": [{"pfad": "/a", "typ": "weird"}]}', '{"schema": 1, "wurzeln": [5]}',
])
def test_bad_config_rejected(monkeypatch, tmp_path, text):
    p = tmp_path / "b.json"
    p.write_text(text)
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_KONFIG", str(p))
    with pytest.raises(KonfigFehler):
        lies_konfig()


def test_konfig_pfad_aus_tabelle(tmp_path, monkeypatch):
    import storage as tabelle  # the package djk/ablage

    from bibliothek.config import konfig_pfad

    assert Path(tabelle.__file__).resolve() == Path(__file__).resolve().parents[2] / "ablage" / "__init__.py"
    assert konfig_pfad() == tabelle.fest("bibliothek_konfig") == Path(os.environ["HOME"]) / ".config/cypherdj/bibliothek.json"
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_KONFIG", "")
    assert konfig_pfad() == Path(os.environ["HOME"]) / ".config/cypherdj/bibliothek.json"
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_KONFIG", str(tmp_path / "k.json"))
    assert konfig_pfad() == tmp_path / "k.json"
    # catalog target: next to the media database of the table, empty values count as unset
    assert katalog_ziel({"HOME": "/tmp/h0"}) == Path("/tmp/h0/.local/share/cypherdj/mediathek/katalog.sqlite")
    assert katalog_ziel({"HOME": "/tmp/h0", "CYPHERDJ_MEDIATHEK": ""}) == Path("/tmp/h0/.local/share/cypherdj/mediathek/katalog.sqlite")
    assert katalog_ziel({"HOME": "/tmp/h0", "CYPHERDJ_MEDIATHEK": "/x/m.sqlite"}) == Path("/x/katalog.sqlite")


# --- quellen.toml takes precedence over bibliothek.json (plan task 10) ---------------------------------------------

import socket

import storage as ablage
from quellen import file as quellen_datei


@pytest.fixture
def heim(tmp_path, monkeypatch):
    h = tmp_path / "home" / "cypherdj"
    h.mkdir(parents=True)
    monkeypatch.setattr(socket, "gethostname", lambda: "laptop-a")
    return h


def _quellen(heim, *wurzeln, klang=()):
    q = quellen_datei.Quellen(wurzeln=list(wurzeln), klang=list(klang))
    quellen_datei.schreibe(heim / "quellen.toml", q)


def test_quellen_vor_bibliothek_json(heim):
    schreibe_konfig(Konfig(1, [Wurzel(Path("/old/only"), "auto")]))          # old list, must be ignored
    _quellen(
        heim,
        quellen_datei.Wurzel(name="Musik", art="track", pfad="/media/tester/Musik"),
        quellen_datei.Wurzel(name="Bits", art="sample", pfade={"laptop-a": "/media/tester/Bits x"}),
        quellen_datei.Wurzel(name="Other", art="loop", pfade={"desktop": "/elsewhere"}),    # no path for this host
        quellen_datei.Wurzel(name="Mix", art="mix", pfad="/media/tester/Mix"),              # art not a catalog kind
        quellen_datei.Wurzel(name="Hidden", art="track", pfad="/media/tester/Hidden", katalog=False),
    )
    k = lies_konfig()
    assert k == Konfig(1, [Wurzel(Path("/media/tester/Musik"), "track"), Wurzel(Path("/media/tester/Bits x"), "auto")])


def test_ohne_quellen_wie_bisher(heim):
    assert not (heim / "quellen.toml").exists()
    k = Konfig(1, [Wurzel(Path("/a/b"), "loop")])
    schreibe_konfig(k)
    assert lies_konfig() == k
    assert not (heim / "quellen.toml").exists()          # writing never creates quellen.toml


def test_schreiben_geht_in_quellen_wenn_es_sie_gibt(heim):
    _quellen(heim, quellen_datei.Wurzel(name="Musik", art="track", pfad="/media/tester/Musik"),
             quellen_datei.Wurzel(name="Mix", art="mix", pfad="/media/tester/Mix"))
    k = lies_konfig()
    schreibe_konfig(Konfig(1, [*k.wurzeln, Wurzel(Path("/media/tester/neu eins"), "oneshot")]))
    q = quellen_datei.lies(heim / "quellen.toml")
    assert [(w.name, w.art, w.pfad) for w in q.wurzeln] == [
        ("Musik", "track", "/media/tester/Musik"), ("Mix", "mix", "/media/tester/Mix"),
        ("neu eins", "oneshot", "/media/tester/neu eins")]
    assert not ablage.fest("bibliothek_konfig").exists()
    schreibe_konfig(Konfig(1, [Wurzel(Path("/media/tester/neu eins"), "oneshot")]))      # removal
    q = quellen_datei.lies(heim / "quellen.toml")
    assert [w.name for w in q.wurzeln if w.katalog] == ["Mix", "neu eins"]
    assert lies_konfig().wurzeln == [Wurzel(Path("/media/tester/neu eins"), "oneshot")]


def test_kaputte_quellen_sind_ein_konfigfehler(heim):
    (heim / "quellen.toml").write_text("schema = 7\n")
    with pytest.raises(KonfigFehler):
        lies_konfig()
