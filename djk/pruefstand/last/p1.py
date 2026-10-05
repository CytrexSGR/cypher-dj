#!/usr/bin/env python3
"""Lastprofil P1 (ARCHITEKTUR §9.2): Speicher-Streaming `cypherdj-lastgen` 16 x 64 MiB plus `demucs_last.py` mit
8 Fäden (Werkstatt-Stellvertreter, 10 NP N6), beide unter Nice 19 (Entscheidung E6 im Plan: bei Nice 0 für lastgen
bekäme demucs neben 16 streamenden Fäden kaum Rechenzeit, und P1 wäre nur noch Speicherlast). Misst je Sekunde, was P1
wirklich erzeugt: CPU-Belegung der Maschine, CPU-Kerne je Lastprozess, RSS, verfügbaren Speicher, 1-Minuten-Last; dazu
den Durchsatz von lastgen und die Rundenzeiten von demucs. So ist P1 reproduzierbar belegt statt nur gestartet.

Allein: python3 last/p1.py <ordner> <sekunden> [--demucs-python PFAD] [--nice-lastgen N]  (schreibt last.csv, last.json)
"""
import argparse
import json
import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path

HIER = Path(__file__).resolve().parent
DEMUCS_PYTHON = os.environ.get("CYPHERDJ_DEMUCS_PYTHON", "")   # Python mit demucs; Pflicht für Profil p1
TAKT = os.sysconf("SC_CLK_TCK")


def cpu_zeiten():
    f = open("/proc/stat").readline().split()[1:]
    w = [int(x) for x in f]
    return sum(w), w[3] + w[4]                      # gesamt, idle + iowait


def prozess_ticks(pid):
    try:
        f = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
        return int(f[11]) + int(f[12])              # utime + stime
    except (FileNotFoundError, ProcessLookupError, IndexError):
        return None


def rss_mib(pid):
    try:
        for z in open(f"/proc/{pid}/status"):
            if z.startswith("VmRSS:"):
                return int(z.split()[1]) / 1024.0
    except FileNotFoundError:
        pass
    return None


def mem_verfuegbar_mib():
    for z in open("/proc/meminfo"):
        if z.startswith("MemAvailable:"):
            return int(z.split()[1]) / 1024.0
    return None


class LastP1:
    def __init__(self, ordner, lastgen, demucs_python=DEMUCS_PYTHON, faeden=16, mib=64, demucs_faeden=8,
                 nice_lastgen=19, nice_demucs=19):
        self.o = Path(ordner)
        self.lastgen, self.demucs_python = str(lastgen), demucs_python
        self.faeden, self.mib, self.demucs_faeden = faeden, mib, demucs_faeden
        self.nice_lastgen, self.nice_demucs = nice_lastgen, nice_demucs
        self.proben = []
        self.stop = threading.Event()

    def start(self, sekunden):
        if not self.demucs_python:
            raise RuntimeError("Last p1 braucht ein Python mit demucs: Umgebungsvariable CYPHERDJ_DEMUCS_PYTHON setzen "
                               "oder --demucs-python angeben (Vorlage: djk/konfig/umgebung.env.beispiel)")
        dauer = str(int(sekunden) + 30)             # Obergrenze; beendet wird mit SIGTERM
        self.lg_out = open(self.o / "lastgen.log", "w")
        self.dm_out = open(self.o / "demucs.log", "w")
        self.lg = subprocess.Popen(["nice", "-n", str(self.nice_lastgen), self.lastgen, str(self.faeden), dauer,
                                    str(self.mib)], stdout=self.lg_out, stderr=subprocess.STDOUT)
        self.dm = subprocess.Popen(["nice", "-n", str(self.nice_demucs), self.demucs_python,
                                    str(HIER / "demucs_last.py"), dauer, str(self.demucs_faeden), "20"],
                                   stdout=self.dm_out, stderr=subprocess.STDOUT,
                                   env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1", CUDA_VISIBLE_DEVICES=""))   # keine GPU
        self.t0 = time.monotonic()
        self.faden = threading.Thread(target=self._proben, daemon=True)
        self.faden.start()

    def _proben(self):
        g0, i0 = cpu_zeiten()
        l0, d0 = prozess_ticks(self.lg.pid), prozess_ticks(self.dm.pid)
        while not self.stop.wait(1.0):
            g1, i1 = cpu_zeiten()
            l1, d1 = prozess_ticks(self.lg.pid), prozess_ticks(self.dm.pid)
            dt = g1 - g0
            self.proben.append({
                "t_s": round(time.monotonic() - self.t0, 2),
                "cpu_belegt_pct": round(100.0 * (dt - (i1 - i0)) / dt, 1) if dt else None,
                "lastgen_kerne": round((l1 - l0) / TAKT, 2) if l0 is not None and l1 is not None else None,
                "demucs_kerne": round((d1 - d0) / TAKT, 2) if d0 is not None and d1 is not None else None,
                "lastgen_rss_mib": rss_mib(self.lg.pid), "demucs_rss_mib": rss_mib(self.dm.pid),
                "mem_verfuegbar_mib": mem_verfuegbar_mib(),
                "last1": float(open("/proc/loadavg").read().split()[0]),
            })
            g0, i0, l0, d0 = g1, i1, l1, d1

    def stopp(self):
        self.stop.set()
        self.faden.join()
        for p in (self.lg, self.dm):
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
        for p in (self.lg, self.dm):
            try:
                p.wait(timeout=20)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        self.lg_out.close()
        self.dm_out.close()
        with open(self.o / "last.csv", "w") as f:
            if self.proben:
                f.write(",".join(self.proben[0]) + "\n")
                for p in self.proben:
                    f.write(",".join("" if v is None else str(v) for v in p.values()) + "\n")
        return self.zusammenfassung()

    def zusammenfassung(self, ab_s=10.0):
        """Mittel der Sekundenproben ab `ab_s` (demucs baut sein Modell in den ersten Sekunden)."""
        p = [x for x in self.proben if x["t_s"] >= ab_s]

        def mittel(k):
            v = [x[k] for x in p if x[k] is not None]
            return round(sum(v) / len(v), 2) if v else None
        lg = (self.o / "lastgen.log").read_text()
        m = re.search(r"durchsatz_gib_s ([\d.]+)", lg)
        runden = [float(x) for x in re.findall(r"runde \d+ ([\d.]+) s", (self.o / "demucs.log").read_text())]
        runden_s = sorted(runden)
        return {"proben": len(p), "cpu_belegt_pct": mittel("cpu_belegt_pct"), "lastgen_kerne": mittel("lastgen_kerne"),
                "demucs_kerne": mittel("demucs_kerne"), "lastgen_rss_mib": mittel("lastgen_rss_mib"),
                "demucs_rss_mib": mittel("demucs_rss_mib"), "mem_verfuegbar_mib_min": min(
                    (x["mem_verfuegbar_mib"] for x in p), default=None),
                "last1_max": max((x["last1"] for x in p), default=None),
                "lastgen_durchsatz_gib_s": float(m.group(1)) if m else None,
                "demucs_runden": len(runden), "demucs_runde_median_s": runden_s[len(runden_s) // 2] if runden_s else None}


def vergleiche(a, b, schluessel=("lastgen_kerne", "demucs_kerne", "lastgen_rss_mib", "lastgen_durchsatz_gib_s",
                                 "demucs_runde_median_s")):
    """Relative Abweichung je Kennzahl zwischen zwei P1-Läufen: |a - b| / max(a, b)."""
    out = {}
    for k in schluessel:
        x, y = a.get(k), b.get(k)
        out[k] = round(abs(x - y) / max(abs(x), abs(y)), 3) if x and y else None
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ordner")
    ap.add_argument("sekunden", type=float)
    ap.add_argument("--demucs-python", default=DEMUCS_PYTHON)
    ap.add_argument("--lastgen", default=str(HIER.parent / "build" / "cypherdj-lastgen"))
    ap.add_argument("--faeden", type=int, default=16)
    ap.add_argument("--mib", type=int, default=64)
    ap.add_argument("--demucs-faeden", type=int, default=8)
    ap.add_argument("--nice-lastgen", type=int, default=19)
    a = ap.parse_args()
    Path(a.ordner).mkdir(parents=True, exist_ok=True)
    last = LastP1(a.ordner, a.lastgen, a.demucs_python, a.faeden, a.mib, a.demucs_faeden, a.nice_lastgen)
    last.start(a.sekunden)
    time.sleep(a.sekunden)
    z = last.stopp()
    (Path(a.ordner) / "last.json").write_text(json.dumps(z, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(z, ensure_ascii=False))
