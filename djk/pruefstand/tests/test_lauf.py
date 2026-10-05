"""Die reinen Teile von lauf.py ohne JACK und systemd: Unit-Befehl, kern.toml des Laufs, Ziel eines Eingriffs."""
import socket
import subprocess
import time

import pytest

import lauf

KERN_TOML = """version = 1
start_bpm = 128.0                            # Tempo einer neuen Zeitachse ohne Anker (§1.1)
udp_port = 47100                             # Befehle (§2)
pruefmodus = false                           # erlaubt /test/* (§19.0)
"""


def test_unit_befehl_ohne_und_mit_neustart():
    c = lauf.unit_befehl("cypherdj-pruef-f-x-quelle", ["/usr/bin/pw-jack", "-p", 256, "q"], "f", False)
    assert c[:6] == ["systemd-run", "--user", "--unit=cypherdj-pruef-f-x-quelle", "--collect", "--quiet",
                     "--setenv=CYPHERDJ_INSTANZ=f"]
    assert "Restart=no" in c and c[-5:] == ["--", "/usr/bin/pw-jack", "-p", "256", "q"]
    n = lauf.unit_befehl("u", ["a"], "f", True, ["WatchdogSec=200ms"])
    assert "RestartSec=20ms" in n and "Restart=no" not in n
    assert n.index("WatchdogSec=200ms") > n.index("RestartSec=20ms")    # eigenschaften kommen zuletzt


def test_kern_toml_setzt_pruefmodus_und_bpm(tmp_path):
    v = tmp_path / "vorlage.toml"
    v.write_text(KERN_TOML)
    lauf.kern_toml(tmp_path, 124.0, True, vorlage=v)
    t = (tmp_path / "kern.toml").read_text()
    assert "pruefmodus = true\n" in t and "start_bpm = 124.0\n" in t and "udp_port = 47100" in t


def test_kern_toml_ohne_schluessel_ist_fehler(tmp_path):
    v = tmp_path / "vorlage.toml"
    v.write_text("version = 1\nstart_bpm = 128.0\n")
    with pytest.raises(lauf.LaufFehler, match="pruefmodus"):
        lauf.kern_toml(tmp_path, 128.0, True, vorlage=v)


def test_aufnehmer_in_der_gruppe_der_instanz(tmp_path, monkeypatch):
    monkeypatch.delenv("CYPHERDJ_INSTANZ", raising=False)            # die Session selbst hat keine Instanz gesetzt
    argv, env = lauf.aufnehmer_aufruf("cypherdj-pruef-f-x", tmp_path, 60.0, 256, "f", tmp_path / "b")
    assert env["CYPHERDJ_INSTANZ"] == "f"
    assert argv[:3] == ["/usr/bin/pw-jack", "-p", "256"]
    assert argv[argv.index("--quelle") + 1] == "cypherdj-pruef-f-x:monitor_F"
    assert argv[argv.index("--sekunden") + 1] == "60.0"


GRAPH = """cypherdj-kern-f:master_L
  |-> cypherdj-pruef-f-x:playback_FL
  |-> cypherdj-notbahn-f:kante
cypherdj-kern-f:master_R
  |-> cypherdj-pruef-f-x:playback_FR
cypherdj-notbahn-f:master_L
  |-> cypherdj-pruef-f-x:playback_FL
cypherdj-notbahn-f:master_R
  |-> cypherdj-pruef-f-x:playback_FR
cypherdj-pruef-f-x:playback_FL
  |<- cypherdj-notbahn-f:master_L
cypherdj-pruef-f-x:monitor_FL
  |-> cypherdj-aufnehmer-f:in_L
cypherdj-pruef-f-x:monitor_FR
  |-> cypherdj-aufnehmer-f:in_R
"""


def test_graph_steht_und_fehlende_kante():
    assert lauf.graph_fehlt(GRAPH, "cypherdj-pruef-f-x", "f", "kern", True) == []
    fremd = GRAPH.replace("cypherdj-aufnehmer-f:in_R", "cypherdj-aufnehmer-g:in_R")   # Aufnehmer einer anderen Instanz
    assert lauf.graph_fehlt(fremd, "cypherdj-pruef-f-x", "f", "kern", True) == [
        "cypherdj-pruef-f-x:monitor_FR -> cypherdj-aufnehmer-f:in_R"]
    ohne_kante = GRAPH.replace("  |-> cypherdj-notbahn-f:kante\n", "")               # Notbahn ohne Kante: Reihenfolge offen
    assert lauf.graph_fehlt(ohne_kante, "cypherdj-pruef-f-x", "f", "kern", True) == [
        "cypherdj-kern-f:master_L -> cypherdj-notbahn-f:kante"]
    assert lauf.graph_fehlt(ohne_kante, "cypherdj-pruef-f-x", "f", "kern", True, kante=False) == []
    assert lauf.graph_fehlt(GRAPH, "cypherdj-pruef-f-x", "f", "pruefquelle_direkt", False) == [
        "cypherdj-pruefquelle-f:master_L -> cypherdj-pruef-f-x:playback_FL",
        "cypherdj-pruefquelle-f:master_R -> cypherdj-pruef-f-x:playback_FR"]
    ohne_quelle = "\n".join(z for z in GRAPH.splitlines() if not z.startswith("cypherdj-kern-f:master_R"))
    assert "cypherdj-kern-f:master_R -> cypherdj-pruef-f-x:playback_FR" in lauf.graph_fehlt(
        ohne_quelle, "cypherdj-pruef-f-x", "f", "kern", True)                          # Quelle spielt nicht selbst


def test_ziel_pid_direkt():
    assert lauf.ziel_pid({"ziel": "pid:4242"}, {}) == 4242


def test_notbahn_daneben_mit_kante():
    """Aufruf wie Scheibe 10 (djk/units/cypherdj-notbahn.service, ADR 016 Nachtrag): daneben, Kante vom master_L der
    Quelle, kein --vorhalt und kein --blende (die Notbahn aus 10 lehnt beide mit Rückgabe 2 ab)."""
    a = lauf.notbahn_aufruf("/x/cypherdj-notbahn", "cypherdj-pruef-f-x", "kern", "f")
    assert a == ["/x/cypherdj-notbahn", "--master", "cypherdj-pruef-f-x:playback_F", "--daneben", "--kante",
                 "cypherdj-kern-f:master_L"]
    b = lauf.notbahn_aufruf("/x/nb", "cypherdj-pruef-f-y", "pruefquelle", "f")
    assert b[-1] == "cypherdj-pruefquelle-f:master_L" and "--vorhalt" not in b and "--blende" not in b
    assert lauf.notbahn_aufruf("/x/nb", "s", "kern", "f", kante=False) == ["/x/nb", "--master", "s:playback_F", "--daneben"]


def test_notbahn_aufruf_passt_zur_unit_von_scheibe_10():
    unit = (lauf.DJK / "units" / "cypherdj-notbahn.service").read_text()
    zeile = next(z for z in unit.splitlines() if z.startswith("ExecStart="))
    schalter = {w for w in zeile.split() if w.startswith("--")}
    assert schalter == {w for w in lauf.notbahn_aufruf("nb", "s", "kern", "f") if w.startswith("--")}


def test_schloss_wartet_und_bricht_ab(tmp_path):
    s = tmp_path / "schloss"
    start = time.monotonic()
    fremd = subprocess.Popen(["flock", str(s), "sleep", "2"])           # ein anderer hält das Schloss 2 s
    time.sleep(0.3)
    t0 = time.monotonic()
    with pytest.raises(lauf.LaufFehler, match="nicht frei"):
        with lauf.Schloss(0.5, s):
            pass
    assert 0.4 < time.monotonic() - t0 < 1.0
    with lauf.Schloss(10, s):                                          # wartet, bis der andere fertig ist
        assert time.monotonic() - start >= 1.9
    fremd.wait()


def test_instanz_belegt_meldet_den_port(tmp_path):
    ring = tmp_path / "bus"
    frei = [i for i in "abcdefghi" if lauf.instanz_belegt(i, ring, mit_kern=True) == []]
    if not frei:
        pytest.skip("alle Instanzen a bis i sind gerade belegt")
    inst = frei[0]
    k = ord(inst) - ord("a") + 1
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 47140 + 1000 * k))                            # jemand hört auf dem Prüfstand-Port
    try:
        assert lauf.instanz_belegt(inst, ring, mit_kern=False) == [f"UDP {47140 + 1000 * k}"]
        assert lauf.instanz_belegt(inst, ring, mit_kern=True) == [f"UDP {47140 + 1000 * k}"]
    finally:
        s.close()
    assert lauf.instanz_belegt(inst, ring, mit_kern=True) == []
