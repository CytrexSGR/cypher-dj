"""Glanz 2.1 (F22): Digital-Out-Wache gegen eine nachgebaute Karte (sysfs, amixer, alsactl als Attrappen).
Kein echter Schalter wird berührt; der echte Prüfstand ist tests/pruef_digitalwache.sh (Karte der PCI 0000:16:00.1, ungenutzt)."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
WACHE = HIER.parent / "digitalwache.py"
sys.path.insert(0, str(HIER.parent))
import digitalwache  # noqa: E402

PCI = "0000:16:00.6"
AMIXER = """#!/bin/bash
# Attrappe: amixer -c N cget|cset name='IEC958 Playback Switch' [on]; Zustand in $DW/schalter, Aufrufe in $DW/aufrufe
# $DW/haengt: hängt 3 s; $DW/klemmt: cset wirkt nicht; $DW/rueckfall: einmal 0,15 s nach cset wieder off;
# $DW/rueckfall_immer: nach jedem cset 0,1 s später wieder off (Kampf)
echo "$*" >> "$DW/aufrufe"
[ -e "$DW/haengt" ] && exec sleep 3
if [ "$3" = cset ]; then [ -e "$DW/klemmt" ] || echo on > "$DW/schalter"
  [ -e "$DW/rueckfall_immer" ] && { (sleep 0.1; echo off > "$DW/schalter") >/dev/null 2>&1 & }
  [ -e "$DW/rueckfall" ] && { rm "$DW/rueckfall"; (sleep 0.15; echo off > "$DW/schalter") >/dev/null 2>&1 & }; exit 0; fi
printf "numid=33,iface=MIXER,name='IEC958 Playback Switch'\\n  ; type=BOOLEAN,access=rw------,values=1\\n  : values=%s\\n" "$(cat "$DW/schalter")"
"""
ALSACTL = """#!/bin/bash
# Attrappe: alsactl monitor hw:N; nach $DW/ereignis_nach s Schalter off und eine Ereigniszeile wie alsactl.
# $DW/stirbt: endet sofort (jeder Start eine Zeile in $DW/spawns); $DW/mon_pid: PID des laufenden Monitors
[ -e "$DW/stirbt" ] && { echo x >> "$DW/spawns"; exit 1; }
echo $$ > "$DW/mon_pid"
[ -e "$DW/ereignis_nach" ] || exec sleep 60
sleep "$(cat "$DW/ereignis_nach")"; echo "${DW_EREIGNIS_WERT:-off}" > "$DW/schalter"
echo "node hw:2, #33 (2,0,0,IEC958 Playback Switch,0) VALUE"
for i in 1 2 3; do sleep 0.1; echo "node hw:2, #12 (2,0,0,Master Playback Volume,0) VALUE"; done
exec sleep 60
"""


@pytest.fixture
def karte(tmp_path):
    dw = tmp_path / "dw"
    dw.mkdir()
    (tmp_path / "sys/bus/pci/devices" / PCI / "sound/card2").mkdir(parents=True)
    (tmp_path / "proc/asound/card2/pcm1p/sub0").mkdir(parents=True)
    (tmp_path / "proc/asound/card2/pcm1p/sub0/status").write_text("state: RUNNING\n")
    for name, text in (("amixer", AMIXER), ("alsactl", ALSACTL)):
        (dw / name).write_text(text)
        (dw / name).chmod(0o755)
    (dw / "schalter").write_text("on\n")
    (dw / "aufrufe").write_text("")
    return tmp_path


def starte(k, *extra, runden=None):
    args = [sys.executable, str(WACHE), "--pci", PCI, "--status", str(k / "status.json"), "--sysfs", str(k / "sys"),
            "--proc", str(k / "proc"), "--amixer", str(k / "dw/amixer"), "--alsactl", str(k / "dw/alsactl"),
            "--pw-metadata", "", *extra]
    if runden is not None:
        args += ["--runden", str(runden)]
    env = {**os.environ, "DW": str(k / "dw")}
    if runden is not None:
        return subprocess.run(args, env=env, capture_output=True, text=True, timeout=20)
    return subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def status(k):
    try:
        return json.loads((k / "status.json").read_text())
    except (OSError, ValueError):
        return {}


def warte_auf(bed, s):
    ende = time.monotonic() + s
    while time.monotonic() < ende:
        if bed():
            return True
        time.sleep(0.01)
    return bed()


def test_pci_aus_senke():
    assert digitalwache.pci_aus_senke("alsa_output.pci-0000_16_00.6.iec958-stereo") == "0000:16:00.6"
    # Negativ: stumme Senke, analoger Ausgang, Bluetooth, Prüfsenke -> keine Wache
    for n in ("cypher_stumm", "alsa_output.pci-0000_16_00.6.analog-stereo", "bluez_output.84_9D_4B_87_54_98.1",
              "cypherdj-pruef-i-start"):
        assert digitalwache.pci_aus_senke(n) is None, n


def test_karte_ueber_pci_auch_wenn_die_nummer_wandert(karte):
    sysfs = karte / "sys"
    assert digitalwache.finde_karte(str(sysfs), PCI) == 2
    (sysfs / "bus/pci/devices" / PCI / "sound/card2").rename(sysfs / "bus/pci/devices" / PCI / "sound/card3")
    assert digitalwache.finde_karte(str(sysfs), PCI) == 3          # Boot: 17x Karte 3, 15x Karte 2 (Journal 05.09.-06.10.)
    assert digitalwache.finde_karte(str(sysfs), "0000:16:00.1") is None


def test_takt_heilt_und_meldet(karte):
    (karte / "dw/schalter").write_text("off\n")
    r = starte(karte, "--alsactl", "", "--takt-ms", "50", runden=2)
    s = status(karte)
    assert (karte / "dw/schalter").read_text().strip() == "on"
    assert s["zustand"] == "gut" and s["faelle"] == 1 and s["letzter"]["quelle"] == "start", s
    assert s["letzter"]["kontext"]["pcm"] == {"pcm1p": "RUNNING"}
    assert "digitalout war aus, wieder an: karte=2 quelle=start" in r.stdout


def test_ereignisweg_heilt_vor_dem_takt(karte):
    (karte / "dw/ereignis_nach").write_text("0.5")
    p = starte(karte, "--takt-ms", "5000")       # Takt 5 s: was vorher kommt, kam über das Ereignis
    try:
        t0 = time.monotonic()
        assert warte_auf(lambda: status(karte).get("faelle") == 1, 3), status(karte)
        dauer = time.monotonic() - t0
        s = status(karte)
        assert s["letzter"]["quelle"] == "ereignis" and dauer < 1.5, (dauer, s)
        assert (karte / "dw/schalter").read_text().strip() == "on"
    finally:
        p.terminate(); p.wait()


def test_negativ_ereignisse_ohne_abfall_schalten_nichts(karte, monkeypatch):
    monkeypatch.setenv("DW_EREIGNIS_WERT", "on")  # vier Ereigniszeilen, der Schalter bleibt on
    (karte / "dw/ereignis_nach").write_text("0.2")
    p = starte(karte, "--takt-ms", "5000")
    try:
        assert warte_auf(lambda: "lebenszeichen" in status(karte), 2)
        time.sleep(1.0)
    finally:
        p.terminate(); p.wait()
    assert status(karte)["faelle"] == 0
    assert (karte / "dw/aufrufe").read_text().count("cget") >= 5   # Gegenprobe: die Ereignisse kamen an und wurden gelesen
    assert "cset" not in (karte / "dw/aufrufe").read_text()


def test_klemmender_schalter_wird_alarm_und_meldet_einmal(karte):
    (karte / "dw/schalter").write_text("off\n")
    (karte / "dw/klemmt").write_text("")
    r = starte(karte, "--alsactl", "", "--takt-ms", "50", "--versuche", "3", runden=2)
    s = status(karte)
    assert s["zustand"] == "aus" and s["faelle"] == 0, s
    assert (karte / "dw/aufrufe").read_text().count("cset") == 9          # drei Prüfungen zu je 3 Versuchen
    assert r.stdout.count("digitalout bleibt aus karte=2") == 1, r.stdout  # eine Zeile beim Eintritt, nicht je Takt


def test_rueckfall_wird_nachgeprueft(karte):
    (karte / "dw/schalter").write_text("off\n")
    (karte / "dw/rueckfall").write_text("")      # nach dem ersten Einschalten fällt er 0,15 s später wieder
    p = starte(karte, "--alsactl", "", "--takt-ms", "5000", "--nachpruef-ms", "300")
    try:
        assert warte_auf(lambda: status(karte).get("faelle") == 2, 2), status(karte)
        assert status(karte)["letzter"]["quelle"] == "nachpruefung"
    finally:
        p.terminate(); p.wait()


def test_kampf(karte):
    (karte / "dw/schalter").write_text("off\n")
    (karte / "dw/rueckfall_immer").write_text("")   # jemand schaltet nach jedem Einschalten wieder ab
    p = starte(karte, "--alsactl", "", "--takt-ms", "5000", "--nachpruef-ms", "200")
    try:
        assert warte_auf(lambda: status(karte).get("zustand") == "kampf", 3), status(karte)
        assert status(karte)["faelle"] >= 4
    finally:
        p.terminate(); p.wait()


def test_ereignisweg_stirbt_ohne_startschleife(karte):
    (karte / "dw/stirbt").write_text("")
    (karte / "dw/spawns").write_text("")
    p = starte(karte, "--takt-ms", "200")
    try:
        time.sleep(0.5)
        (karte / "dw/schalter").write_text("off\n")
        assert warte_auf(lambda: status(karte).get("faelle") == 1, 1.0), status(karte)   # der Takt trägt weiter
        assert status(karte)["letzter"]["quelle"] == "takt"
    finally:
        p.terminate(); p.wait()
    n = len((karte / "dw/spawns").read_text().splitlines())
    assert n <= 12, n        # höchstens ein Neustart je Takt; ohne Sperre im Review gemessen: 800


def test_amixer_haengt_wird_unlesbar(karte):
    (karte / "dw/haengt").write_text("")
    r = starte(karte, "--alsactl", "", "--takt-ms", "50", runden=0)
    assert r.returncode == 0 and status(karte)["zustand"] == "unlesbar", (r.returncode, r.stderr[-300:])


def test_stopp_raeumt_den_monitor_ab(karte):
    p = starte(karte, "--takt-ms", "5000")
    assert warte_auf(lambda: (karte / "dw/mon_pid").exists() and (karte / "dw/mon_pid").read_text().strip(), 3)
    pid = int((karte / "dw/mon_pid").read_text())
    p.terminate(); p.wait()

    def weg():
        try:
            os.kill(pid, 0)
            return False
        except ProcessLookupError:
            return True
    assert warte_auf(weg, 1.0), f"Monitor {pid} lebt nach SIGTERM der Wache weiter"


def test_karte_fehlt(karte):
    (karte / "sys/bus/pci/devices" / PCI / "sound/card2").rmdir()
    r = starte(karte, "--alsactl", "", "--takt-ms", "50", runden=1)
    assert status(karte)["zustand"] == "karte_fehlt" and r.returncode == 0


def test_aufruf_fehler():
    assert digitalwache.main(["--pci", "16:00.6", "--status", "/x"]) == 2
