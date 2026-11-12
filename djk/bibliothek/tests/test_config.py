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
