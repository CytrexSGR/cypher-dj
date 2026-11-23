"""plugin_scan.eigene_pfade(): the own VST3 folders (package 1.0 task 1, spec D6)."""
import os
from pathlib import Path

import plugin_scan

WURZEL = Path(plugin_scan.__file__).resolve().parents[3]
HEIM = os.path.expanduser("~/.local/lib/cypherdj/vst3")


def wurzel_dazu(liste):
    if (WURZEL / "lib" / "vst3").is_dir():
        liste.append(str(WURZEL / "lib" / "vst3"))
    return liste


def test_pfade_mit_env_und_leeren_elementen(monkeypatch):
    monkeypatch.setenv("CYPHERDJ_VST3_PFADE", "/a::/b:")
    assert plugin_scan.eigene_pfade() == wurzel_dazu([HEIM, "/a", "/b"])


def test_pfade_ohne_env(monkeypatch):
    monkeypatch.delenv("CYPHERDJ_VST3_PFADE", raising=False)
    assert plugin_scan.eigene_pfade() == wurzel_dazu([HEIM])
