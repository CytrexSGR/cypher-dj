"""plugin_scan.eigene_pfade(): the own VST3 folders (package 1.0 task 1, spec D6).
plugin_scan.datei_pfade() / suchwurzeln(): the user's plugin folders file as extra scan roots (browser plan 6 task 8)."""
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


# ---- plugin_pfade.txt: extra scan roots, never own-bundle locations ------------------------------------------------------------------------
def heim_mit_datei(tmp_path, monkeypatch, inhalt=None):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("CYPHERDJ_VST3_PFADE", raising=False)
    if inhalt is not None:
        d = tmp_path / ".config" / "cypherdj"
        d.mkdir(parents=True)
        (d / "plugin_pfade.txt").write_text(inhalt)
    return tmp_path


DATEI = "# my folders\n\n/opt/plugins-a\nrelative/dir\n   /opt/plugins-b   \n~/not-absolute\n#/opt/commented\n"


def test_datei_aendert_die_eigenen_pfade_nicht(tmp_path, monkeypatch):
    heim_mit_datei(tmp_path, monkeypatch)
    ohne = plugin_scan.eigene_pfade()
    monkeypatch.undo()
    heim_mit_datei(tmp_path / "zwei", monkeypatch, DATEI)
    # the own-bundle order stays: user folder, CYPHERDJ_VST3_PFADE elements, the package folder; a file entry never joins it
    assert plugin_scan.eigene_pfade() == wurzel_dazu([str(tmp_path / "zwei" / ".local" / "lib" / "cypherdj" / "vst3")])
    assert len(ohne) == len(plugin_scan.eigene_pfade())
    assert "/opt/plugins-a" not in plugin_scan.eigene_pfade() and "/opt/plugins-b" not in plugin_scan.eigene_pfade()


def test_datei_pfade_liest_nur_absolute_zeilen(tmp_path, monkeypatch):
    heim_mit_datei(tmp_path, monkeypatch, DATEI)
    assert plugin_scan.datei_pfade() == ["/opt/plugins-a", "/opt/plugins-b"]


def test_ohne_datei_sind_die_wurzeln_die_standardpfade(tmp_path, monkeypatch):
    heim_mit_datei(tmp_path, monkeypatch)
    assert plugin_scan.datei_pfade() == []
    assert plugin_scan.suchwurzeln() == [os.path.expanduser(p) for p in plugin_scan.STANDARD_PFADE]


def test_wurzeln_sind_standard_dann_dateipfade_ohne_doppelte(tmp_path, monkeypatch):
    heim_mit_datei(tmp_path, monkeypatch, DATEI + "/usr/lib/vst3\n/opt/plugins-a\n")
    standard = [os.path.expanduser(p) for p in plugin_scan.STANDARD_PFADE]
    assert plugin_scan.suchwurzeln() == standard + ["/opt/plugins-a", "/opt/plugins-b"]


def test_plugin_aus_dateiordner_ist_nicht_eigen(tmp_path, monkeypatch):
    heim = heim_mit_datei(tmp_path, monkeypatch, f"{tmp_path}/fremd\n")
    fremd = heim / "fremd" / "x.vst3"
    fremd.mkdir(parents=True)
    eigen = heim / ".local" / "lib" / "cypherdj" / "vst3" / "y.vst3"
    eigen.mkdir(parents=True)
    assert plugin_scan.ist_eigen({"maker": "someone"}, str(fremd)) is False
    assert plugin_scan.ist_eigen({"maker": "someone"}, str(eigen)) is True


def test_pfade_option_ersetzt_die_wurzeln(tmp_path, monkeypatch, capsys):
    heim_mit_datei(tmp_path, monkeypatch, "/opt/plugins-a\n")
    gesehen = []
    monkeypatch.setattr(plugin_scan, "scanne", lambda wurzeln, index, mit: gesehen.append(list(wurzeln)) or {"neu": 0, "entfernt": 0, "geaendert": 0, "blockiert": 0})
    assert plugin_scan.main(["--index", str(tmp_path / "i.json"), "--pfade", "/only/here"]) == 0
    assert plugin_scan.main(["--index", str(tmp_path / "i.json")]) == 0
    assert gesehen[0] == ["/only/here"]
    assert gesehen[1] == [os.path.expanduser(p) for p in plugin_scan.STANDARD_PFADE] + ["/opt/plugins-a"]


def test_env_datei_ersetzt_die_pfade_datei_der_pruefinstanz(tmp_path, monkeypatch):
    """CYPHERDJ_PLUGIN_PFADE_DATEI (a test instance's own file) is read instead of ~/.config/cypherdj/plugin_pfade.txt."""
    heim_mit_datei(tmp_path, monkeypatch, "/aus/home\n")
    eigene = tmp_path / "inst.txt"
    eigene.write_text("/aus/instanz\n")
    monkeypatch.setenv("CYPHERDJ_PLUGIN_PFADE_DATEI", str(eigene))
    assert plugin_scan.datei_pfade() == ["/aus/instanz"]
    monkeypatch.setenv("CYPHERDJ_PLUGIN_PFADE_DATEI", "")
    assert plugin_scan.datei_pfade() == ["/aus/home"]
