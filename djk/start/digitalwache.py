#!/usr/bin/env python3
"""Digital-Out-Wache (Glanz 2.1, Fund F22): hält den IEC958-Schalter der Studio-Senke an und meldet jeden Abfall.

Gemessen 06.10.: der Schalter fiel seit 05.09. 31-mal auf off (20 davon unter 60 s nach dem Boot, 11 im Lauf);
der System-Watchdog /usr/local/bin/spdif-watchdog.sh schaltet zurück, wartet dabei aber 0,3 s (Zeile 72), und
keine Anzeige im Studio sieht es. Die Kartennummer wandert beim Boot (17-mal 3, 15-mal 2): die Karte wird hier
über die PCI-Adresse der Senke gesucht, nie über eine Nummer.
Endet alsactl monitor, startet die Wache ihn frühestens nach einem Takt neu (nie in Schleife); amixer-Fehler machen
den Zustand 'unlesbar', nicht die Wache tot; SIGTERM räumt den Monitor ab.

Aufruf: digitalwache.py --pci 0000:16:00.6 --status DATEI [--takt-ms 1000] [--nachpruef-ms 300] [--versuche 5]
        digitalwache.py --pci-aus NODE_NAME   (gibt die PCI-Adresse eines alsa_output.pci-…iec958-stereo aus)
Prüfstand: --sysfs, --proc, --amixer, --alsactl ('' = ohne Ereignisweg, nur Takt), --pw-metadata, --runden.
Rückgabe: 0, 1 (--pci-aus: kein IEC958-Ziel), 2 Aufruf."""
import argparse
import glob
import json
import os
import re
import select
import signal
import subprocess
import sys
import time
from datetime import datetime

STEUER = "IEC958 Playback Switch"
SENKE_RE = re.compile(r"^alsa_output\.pci-([0-9a-f]{4})_([0-9a-f]{2})_([0-9a-f]{2})\.([0-7])\.iec958-stereo$")
PCI_RE = re.compile(r"^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$")
WERT_RE = re.compile(r"^\s*: values=(on|off)\s*$", re.M)
KAMPF_FENSTER_S, KAMPF_FAELLE = 10.0, 3


def pci_aus_senke(node_name):
    m = SENKE_RE.match(node_name)
    return f"{m[1]}:{m[2]}:{m[3]}.{m[4]}" if m else None


def finde_karte(sysfs, pci):
    t = glob.glob(os.path.join(sysfs, "bus/pci/devices", pci, "sound", "card[0-9]*"))
    return int(os.path.basename(t[0])[4:]) if len(t) == 1 else None


def zeit():
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


class Wache:
    def __init__(self, a):
        self.a = a
        self.karte = None
        self.zustand = "unlesbar"
        self.seit = zeit()
        self.faelle = 0
        self.letzter = None
        self.heilungen = []      # monotone Zeiten der letzten Heilungen (Kampf-Erkennung)
        self.nachpruefung = None  # monotone Zeit einer fälligen Nachprüfung

    def sag(self, text):
        print(f"digitalout {text}", flush=True)

    def amixer(self, *args):
        cmd = [self.a.amixer, "-c", str(self.karte), *args]
        try:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.TimeoutExpired):   # hängt oder fehlt: 'unlesbar', nicht tot
            return subprocess.CompletedProcess(cmd, 1, "", "")

    def lies(self):
        r = self.amixer("cget", f"name='{self.a.steuer}'")
        m = WERT_RE.search(r.stdout) if r.returncode == 0 else None
        return m[1] if m else None

    def kontext(self):
        pcm = {}
        for f in sorted(glob.glob(os.path.join(self.a.proc, f"asound/card{self.karte}/pcm*p/sub0/status"))):
            try:
                with open(f) as d:
                    pcm[f.split("/")[-3]] = d.readline().split(":", 1)[-1].strip()
            except OSError:
                pass
        senke = None
        if self.a.pw_metadata:
            try:
                r = subprocess.run([self.a.pw_metadata, "-n", "default", "0", "default.audio.sink"],
                                   capture_output=True, text=True, timeout=1)
                m = re.search(r'"name":"([^"]+)"', r.stdout)
                senke = m[1] if m else None
            except (OSError, subprocess.TimeoutExpired):
                pass
        return {"pcm": pcm, "default_sink": senke}

    def setze(self, zustand):
        if zustand != self.zustand:
            self.zustand, self.seit = zustand, zeit()

    def schreibe(self):
        d = {"version": 1, "pci": self.a.pci, "karte": self.karte, "zustand": self.zustand, "seit": self.seit,
             "faelle": self.faelle, "letzter": self.letzter, "takt_ms": self.a.takt_ms, "lebenszeichen": zeit()}
        tmp = f"{self.a.status}.{os.getpid()}"
        with open(tmp, "w") as f:
            json.dump(d, f)
        os.replace(tmp, self.a.status)

    def pruefe(self, quelle):
        k = finde_karte(self.a.sysfs, self.a.pci)
        if k != self.karte:
            self.sag(f"karte {self.karte} -> {k} (pci {self.a.pci})")
            self.karte = k
        if k is None:
            self.setze("karte_fehlt")
            return
        w = self.lies()
        if w is None:
            self.setze("unlesbar")
            return
        jetzt = time.monotonic()
        self.heilungen = [h for h in self.heilungen if jetzt - h < KAMPF_FENSTER_S]
        if w == "on":
            self.setze("kampf" if len(self.heilungen) > KAMPF_FAELLE else "gut")
            return
        erkannt, t0 = zeit(), time.monotonic()
        for v in range(1, self.a.versuche + 1):
            self.amixer("cset", f"name='{self.a.steuer}'", "on")
            if self.lies() == "on":
                break
            time.sleep(0.05)
        else:
            if self.zustand != "aus":   # eine Zeile beim Eintritt, nicht je Takt
                self.sag(f"bleibt aus karte={k} quelle={quelle} versuche={self.a.versuche}")
            self.setze("aus")
            return
        ms = round((time.monotonic() - t0) * 1000)
        self.faelle += 1
        self.heilungen.append(time.monotonic())
        self.setze("kampf" if len(self.heilungen) > KAMPF_FAELLE else "gut")
        self.letzter = {"erkannt": erkannt, "quelle": quelle, "erkannt_bis_an_ms": ms, "versuche": v, "kontext": self.kontext()}
        self.sag(f"war aus, wieder an: karte={k} quelle={quelle} erkannt_bis_an_ms={ms} versuche={v} "
                 f"faelle={self.faelle} zustand={self.zustand} default_sink={self.letzter['kontext']['default_sink']}")
        self.nachpruefung = time.monotonic() + self.a.nachpruef_ms / 1000

    def lauf(self):
        mon, runden, mon_ab = None, self.a.runden, 0.0   # mon_ab: Monitor frühestens dann neu starten
        self.pruefe("start")
        self.schreibe()
        self.sag(f"wache an: pci={self.a.pci} karte={self.karte} zustand={self.zustand}")
        naechster = time.monotonic() + self.a.takt_ms / 1000
        try:
            while runden is None or runden > 0:
                if runden is not None:
                    runden -= 1
                if mon is not None and (mon.poll() is not None or getattr(self, "_mon_karte", None) != self.karte):
                    mon.kill(); mon.wait(); mon = None
                    mon_ab = time.monotonic() + self.a.takt_ms / 1000
                if mon is None and self.a.alsactl and self.karte is not None and time.monotonic() >= mon_ab:
                    mon = subprocess.Popen(["stdbuf", "-oL", self.a.alsactl, "monitor", f"hw:{self.karte}"],
                                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                    self._mon_karte = self.karte
                ziel = min(naechster, self.nachpruefung or naechster)
                warte = max(0.0, ziel - time.monotonic())
                bereit = select.select([mon.stdout], [], [], warte)[0] if mon else (time.sleep(warte) or [])
                if bereit:
                    if not os.read(mon.stdout.fileno(), 65536):   # Monitor beendet: bis zum nächsten Takt nur Takt
                        mon.wait(); mon = None
                        mon_ab = time.monotonic() + self.a.takt_ms / 1000
                        continue
                    self.pruefe("ereignis")
                elif self.nachpruefung is not None and time.monotonic() >= self.nachpruefung:
                    self.nachpruefung = None
                    self.pruefe("nachpruefung")
                else:
                    self.pruefe("takt")
                    naechster = time.monotonic() + self.a.takt_ms / 1000
                self.schreibe()
        finally:
            if mon is not None:
                mon.kill()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--pci-aus")
    p.add_argument("--pci")
    p.add_argument("--status")
    p.add_argument("--steuer", default=STEUER)
    p.add_argument("--takt-ms", type=int, default=1000)
    p.add_argument("--nachpruef-ms", type=int, default=300)
    p.add_argument("--versuche", type=int, default=5)
    p.add_argument("--sysfs", default="/sys")
    p.add_argument("--proc", default="/proc")
    p.add_argument("--amixer", default="amixer")
    p.add_argument("--alsactl", default="alsactl")
    p.add_argument("--pw-metadata", default="pw-metadata")
    p.add_argument("--runden", type=int)
    a = p.parse_args(argv)
    if a.pci_aus is not None:
        pci = pci_aus_senke(a.pci_aus)
        if pci:
            print(pci)
        return 0 if pci else 1
    if not a.pci or not PCI_RE.match(a.pci) or not a.status or not 50 <= a.takt_ms <= 10000 or a.versuche < 1:
        print("digitalwache: need --pci 0000:00:00.0, --status FILE, --takt-ms 50..10000, --versuche >= 1", file=sys.stderr)
        return 2
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))   # finally in lauf() räumt den Monitor ab
    Wache(a).lauf()
    return 0


if __name__ == "__main__":
    sys.exit(main())
