"""Ein Prüflauf nach Profil (Scheibe 16): Schloss, Fremdlast, eigene Senke, Notbahn und Quelle als transiente Units,
Hörer, Aufnehmer am Ziel, Lastprofil, Eingriffe, Abbau, Nachweis. Schreibt alles in den Laufordner; die Auswertung liest
nur diesen Ordner (auswertung.py).

Regeln aus ROADMAP §8.3 bis §8.5: nur stumm (eigene Senke cypherdj-pruef-<instanz>-<name>), Units nur transient
(systemd-run --user), zeitkritisch nur unter flock $CYPHERDJ_ECHTZEIT_SCHLOSS, Fremdlast vor und nach dem Lauf.
"""
import fcntl
import json
import os
import re
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path

import osc

PRUEF = Path(__file__).resolve().parent
DJK = PRUEF.parent
def echtzeit_schloss():
    """Sperrdatei der Echtzeit-Läufe: CYPHERDJ_ECHTZEIT_SCHLOSS, sonst die Zeile in umgebung.env, sonst XDG_RUNTIME_DIR oder /tmp."""
    v = os.environ.get("CYPHERDJ_ECHTZEIT_SCHLOSS")
    if not v:
        umg = Path(os.environ.get("CYPHERDJ_UMGEBUNG") or Path.home() / ".config/cypherdj/umgebung.env")
        try:
            for z in umg.read_text().splitlines():
                if z.startswith("CYPHERDJ_ECHTZEIT_SCHLOSS="):
                    v = z.split("=", 1)[1].strip().strip("\"'")
        except OSError:
            pass
    return v or str(Path(os.environ.get("XDG_RUNTIME_DIR") or "/tmp") / "cypherdj-echtzeit.lock")


SCHLOSS = echtzeit_schloss()
AUFNEHMER = PRUEF / "aufnehmer" / "build" / "cypherdj-aufnehmer"
LASTGEN = PRUEF / "build" / "cypherdj-lastgen"
SIGNALE = {"kill9": signal.SIGKILL, "sigstop": signal.SIGSTOP}


class LaufFehler(RuntimeError):
    pass


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def programm(pfad):
    p = Path(pfad)
    return p if p.is_absolute() else DJK / p


def fremdlast():
    gpu = sh(["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader"])
    return {"uptime": sh(["uptime"]).stdout.strip(), "last1": float(open("/proc/loadavg").read().split()[0]),
            "gpu": gpu.stdout.strip() or gpu.stderr.strip()}


def module():
    return sorted(sh(["pactl", "list", "short", "modules"]).stdout.splitlines())


def main_pid(unit):
    try:
        return int(sh(["systemctl", "--user", "show", "-p", "MainPID", "--value", unit]).stdout.strip() or 0)
    except ValueError:
        return 0


def unit_befehl(unit, argv, inst, neustart, eigenschaften=()):
    """systemd-run für eine transiente User-Unit (ROADMAP §8.4: nie enable). Neustart wie 10 Probe f empfohlen
    (RestartSec=20ms, bei 0 rechnet systemd 255 keine Stufen); `eigenschaften` kommen zuletzt und gewinnen."""
    cmd = ["systemd-run", "--user", f"--unit={unit}", "--collect", "--quiet", f"--setenv=CYPHERDJ_INSTANZ={inst}",
           "-p", "Type=exec", "-p", "KillMode=mixed", "-p", "TimeoutStopSec=3"]
    cmd += ["-p", "Restart=always", "-p", "RestartSec=20ms", "-p", "StartLimitIntervalSec=0"] if neustart \
        else ["-p", "Restart=no"]
    for e in eigenschaften:
        cmd += ["-p", e]
    return cmd + ["--"] + [str(a) for a in argv]


def starte_unit(unit, argv, inst, neustart, ordner, eigenschaften=()):
    cmd = unit_befehl(unit, argv, inst, neustart, eigenschaften)
    r = sh(cmd)
    with open(ordner / "units.txt", "a") as f:
        f.write(" ".join(cmd) + f"\nrc {r.returncode} {r.stderr.strip()}\n")
    if r.returncode:
        raise LaufFehler(f"systemd-run {unit}: {r.stderr.strip()}")


def warte_pid(unit, sekunden, nicht=0):
    ende = time.monotonic() + sekunden
    while time.monotonic() < ende:
        p = main_pid(unit)
        if p and p != nicht:
            return p, time.monotonic_ns()
        time.sleep(0.002)
    return 0, None


class Schloss:
    """flock auf das Echtzeit-Schloss (dieselbe Sperre wie flock(1)), blockierend wie `flock -w`, damit der Lauf sich in
    die Schlange der Wartenden einreiht (ein Abfragen mit LOCK_NB verliert gegen blockierte Wartende jedes Mal); nach
    `sekunden` bricht SIGALRM das Warten ab. Nur im Hauptfaden benutzen."""

    def __init__(self, sekunden, pfad=SCHLOSS):
        self.sekunden, self.pfad = sekunden, pfad

    def __enter__(self):
        self.fd = open(self.pfad, "a")

        def abbruch(sig, frame):
            raise TimeoutError

        alt = signal.signal(signal.SIGALRM, abbruch)
        signal.setitimer(signal.ITIMER_REAL, self.sekunden)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX)
        except TimeoutError:
            self.fd.close()
            raise LaufFehler(f"Echtzeit-Schloss nach {self.sekunden} s nicht frei")
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, alt)
        return self

    def __exit__(self, *a):
        fcntl.flock(self.fd, fcntl.LOCK_UN)
        self.fd.close()


def kern_toml(ordner, bpm, pruefmodus, vorlage=DJK / "konfig" / "kern.toml"):
    """kern.toml für den Lauf: die Standard-Datei aus Scheibe 08 mit pruefmodus und start_bpm dieses Laufs."""
    text = Path(vorlage).read_text()
    text, n1 = re.subn(r"(?m)^pruefmodus\s*=.*$", f"pruefmodus = {'true' if pruefmodus else 'false'}", text)
    text, n2 = re.subn(r"(?m)^start_bpm\s*=.*$", f"start_bpm = {bpm:.1f}", text)
    if n1 != 1 or n2 != 1:
        raise LaufFehler("djk/konfig/kern.toml: pruefmodus oder start_bpm nicht genau einmal gefunden")
    (ordner / "kern.toml").write_text(text)


def quelle_client(art, inst):
    """JACK-Name der Quelle (§8, ROADMAP Z2): der Kern aus 08/10k oder die Prüfquelle, beide mit Ports master_L/R."""
    return f"cypherdj-{'kern' if art == 'kern' else 'pruefquelle'}-{inst}"


def notbahn_aufruf(programm_pfad, senke, art, inst, kante=True):
    """Notbahn daneben (ADR 016 Nachtrag 2026-09-25, Scheibe 10): eigene Ausgänge an die Senke, Kante vom master_L der
    Quelle auf den eigenen Eingang, damit der Graph die Quelle zuerst rechnet. Kein --vorhalt, kein --blende mehr.
    `kante=False` nur als Vergleich (Befund sigstop-kern 2026-09-26: mit Kante wartet die Notbahn auf den hängenden Kern)."""
    a = [programm_pfad, "--master", f"{senke}:playback_F", "--daneben"]
    return a + ["--kante", f"{quelle_client(art, inst)}:master_L"] if kante else a


def aufnehmer_aufruf(senke, ordner, sekunden, quantum, inst, bereit):
    """Befehl und Umgebung des Aufnehmers aus Scheibe 01 am Monitor der eigenen Senke (SCHNITTSTELLEN §19.5).
    CYPHERDJ_INSTANZ setzt seine Gruppe (node.group cypherdj-<i>, Scheibe 01 Entscheidung 11): ohne sie hinge er in
    der Gruppe der Vorgabe-Instanz, an einem anderen Treiber als Quelle und Notbahn."""
    argv = ["/usr/bin/pw-jack", "-p", str(quantum), str(AUFNEHMER), "--quelle", f"{senke}:monitor_F", "--datei",
            str(Path(ordner) / "aufnahme.wav"), "--sekunden", str(sekunden), "--bereit", str(bereit)]
    return argv, dict(os.environ, CYPHERDJ_INSTANZ=inst)


def verbindungen(text):
    """Kanten aus `pw-link -l`: Menge von (ausgang, eingang). Eine Zeile ohne Einrückung nennt einen Port, darunter
    `  |-> <eingang>` für jede Kante, die von ihm ausgeht (`|<-` ist dieselbe Kante von der anderen Seite)."""
    kanten, port = set(), None
    for z in text.splitlines():
        if not z.startswith(" "):
            port = z.strip()
        elif z.strip().startswith("|->") and port:
            kanten.add((port, z.strip()[3:].strip()))
    return kanten


def graph_fehlt(text, senke, inst, art, notbahn_an, kante=True):
    """Welche Kante am Ziel fehlt (leere Liste: der Graph steht). Verlangt: die Quelle (Kern oder Prüfquelle) selbst an
    playback_FL/FR der eigenen Senke, die Notbahn daneben ebenso und mit der Kante master_L der Quelle -> kante, der
    Aufnehmer an monitor_FL/FR, alle mit dem JACK-Namen der Instanz (Z2). Fehlt eine Kante, hat der Lauf nicht am
    eigenen Ziel gemessen, und er ist unbrauchbar."""
    q = quelle_client(art, inst)
    soll = [(f"{q}:master_L", f"{senke}:playback_FL"), (f"{q}:master_R", f"{senke}:playback_FR")]
    if notbahn_an:
        nb = f"cypherdj-notbahn-{inst}"
        soll += [(f"{nb}:master_L", f"{senke}:playback_FL"), (f"{nb}:master_R", f"{senke}:playback_FR")]
        if kante:
            soll.append((f"{q}:master_L", f"{nb}:kante"))
    soll += [(f"{senke}:monitor_FL", f"cypherdj-aufnehmer-{inst}:in_L"),
             (f"{senke}:monitor_FR", f"cypherdj-aufnehmer-{inst}:in_R")]
    k = verbindungen(text)
    return [f"{a} -> {b}" for a, b in soll if (a, b) not in k]


def ziel_pid(e, units):
    z = e["ziel"]
    if z.startswith("pid:"):
        return int(z[4:])
    unit = z[5:] if z.startswith("unit:") else units[z]
    return main_pid(unit)


def instanz_belegt(inst, ring, mit_kern):
    """Was von Instanz `inst` gerade ein anderer benutzt: Prüfstand-Port 47140 + 1000·k, beim Kern auch 47100 + 1000·k
    (ROADMAP Z2), und der Ring (fuser). Leere Liste heißt frei."""
    k = osc.instanz_k(inst)
    belegt = []
    for port in ([47100 + 1000 * k] if mit_kern else []) + [47140 + 1000 * k]:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            belegt.append(f"UDP {port}")
        finally:
            s.close()
    if Path(ring).exists() and sh(["fuser", str(ring)]).returncode == 0:
        belegt.append(f"{ring} (fuser)")
    return belegt


class RingWaechter:
    """Schaut zweimal je Sekunde mit fuser, wer den Ring offen hat. Die Pläne der Nacht haben gezeigt, dass zwei Sessions
    dieselbe Instanz greifen können; dann schreibt ein fremder Kern in den eigenen Ring, und der Lauf misst Unsinn.
    `fremde(eigene)` nennt jede andere PID mit Befehlszeile; der Lauf wird dann unbrauchbar."""

    def __init__(self, ring):
        self.ring, self.gesehen, self.stop = str(ring), {}, threading.Event()
        self.faden = threading.Thread(target=self._lauf, daemon=True)
        self.faden.start()

    def _lauf(self):
        while not self.stop.wait(0.5):
            for pid in sh(["fuser", self.ring]).stdout.split():
                pid = int(pid.rstrip("cefFrm"))
                if pid not in self.gesehen:
                    try:
                        self.gesehen[pid] = open(f"/proc/{pid}/cmdline").read().replace("\0", " ").strip()[:160]
                    except OSError:
                        self.gesehen[pid] = "?"

    def fremde(self, eigene):
        self.stop.set()
        self.faden.join()
        return {pid: z for pid, z in self.gesehen.items() if pid not in eigene}


class OhneSchloss:
    """Für `reihe`: der Aufrufer hält das Echtzeit-Schloss schon für die ganze Reihe."""

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def lauf(p, ordner, schloss_s=3600.0, schloss=None):
    """Führt Profil `p` (profil.lade) aus und schreibt ordner/lauf.json. Gibt das lauf-dict zurück. `schloss` ersetzt
    das eigene Schloss (reihe: OhneSchloss, weil die Reihe es hält)."""
    ordner = Path(ordner).resolve()                      # Units laufen mit cwd $HOME: nur absolute Pfade weitergeben
    inst, q, nb = p["instanz"], p["quelle"], p["notbahn"]
    senke = f"cypherdj-pruef-{inst}-{p['name']}"
    units = {"quelle": f"{senke}-quelle", "notbahn": f"{senke}-notbahn"}
    ring = Path(f"/dev/shm/cypherdj-{inst}/bus")
    anker = ordner / "anker.txt"
    L = {"profil": p, "senke": senke, "units": units, "eingriffe": [], "fehler": None}
    with schloss or Schloss(schloss_s):
        L["t_start_ns"], L["t_start_wand"] = time.monotonic_ns(), int(time.time()) - 1
        reste = sh(["systemctl", "--user", "list-units", "--all", f"cypherdj-pruef-{inst}-*", "--no-legend"]).stdout.strip()
        if reste:
            raise LaufFehler(f"Reste einer früheren Prüfung: {reste}")
        belegt = instanz_belegt(inst, ring, q["art"] == "kern")
        if belegt:
            raise LaufFehler(f"Instanz {inst} ist belegt ({', '.join(belegt)}): eine andere Session benutzt sie; "
                             f"andere Instanz im Profil wählen (ROADMAP §8.3)")
        ordner.mkdir(parents=True, exist_ok=True)
        L["fremdlast_vorher"] = fremdlast()
        L["module_vorher"] = module()
        r = sh([str(PRUEF / "senke" / "senke_an.sh"), senke])
        if r.returncode:
            raise LaufFehler(f"senke_an: {r.stderr.strip()}")
        L["senke_modul"] = r.stdout.strip()
        hoerer = last = auf = waechter = None
        eigene = set()
        try:
            if ring.exists():                                # jeder Lauf mit frischem Ring dieser Instanz
                ring.unlink()
            hoerer = osc.Hoerer(ordner / "osc.jsonl", inst, mit_kern=q["art"] == "kern")
            pwj = ["/usr/bin/pw-jack", "-p", str(p["quantum"])]
            if nb["an"]:
                L["notbahn_aufruf"] = notbahn_aufruf(programm(nb["programm"]), senke, q["art"], inst, nb["kante"])
                starte_unit(units["notbahn"], pwj + L["notbahn_aufruf"], inst, False, ordner)
            argv = pwj + [programm(q["programm"])]
            if q["art"] == "kern":
                if any("{ordner}/kern.toml" in a for a in q["argumente"]):
                    kern_toml(ordner, p["bpm"], p["kern"]["pruefmodus"])
                argv += [a.replace("{ordner}", str(ordner)).replace("{bpm}", str(p["bpm"])) for a in q["argumente"]]
                argv += ["--master", f"{senke}:playback_F"]         # eigene Ausgänge hinter dem Riegel (10k)
                if p["kern"]["test_last_alle"]:                    # Fehlerfall 10 K1b im Kern (Scheibe 08)
                    argv += ["--test-last-alle", p["kern"]["test_last_alle"],
                             "--test-last-perioden", p["kern"]["test_last_perioden"]]
            else:
                argv += ["--bpm", p["bpm"]]
                argv += ["--ring", ring, "--master", f"{senke}:playback_F"] if q["art"] == "pruefquelle" \
                    else ["--direkt", f"{senke}:playback_F"]
                if q["art"] == "pruefquelle" and q["anker"]:
                    argv += ["--anker", anker]
                if q["spin_alle"]:
                    argv += ["--spin-alle", q["spin_alle"], "--spin-anteil", q["spin_anteil"]]
            starte_unit(units["quelle"], argv, inst, q["neustart"], ordner, q["eigenschaften"])
            pid_q = warte_pid(units["quelle"], 5.0)[0]
            if not pid_q:
                raise LaufFehler("Quelle startet nicht (journal-quelle.txt)")
            eigene = {pid_q, main_pid(units["notbahn"])} if nb["an"] else {pid_q}
            waechter = RingWaechter(ring) if q["art"] != "pruefquelle_direkt" else None
            if q["art"] == "kern":
                if not hoerer.warte_auf("/k/willkommen", 5.0):
                    raise LaufFehler("Kern antwortet nicht auf /k/hallo")
                i = hoerer.naechste_id()
                hoerer.sende("/k/set/neu", "hsd", i, osc.QUELLE, float(p["bpm"]))
                if not hoerer.warte_auf("/q", 3.0, lambda w: w[0] == i and w[2] == 2):
                    raise LaufFehler("keine Quittung 2 auf /k/set/neu")
                i = hoerer.naechste_id()
                hoerer.sende("/test/klick", "hssi", i, osc.QUELLE, "master", 1)
                if not hoerer.warte_auf("/q", 3.0, lambda w: w[0] == i and w[2] == 2):
                    raise LaufFehler("keine Quittung 2 auf /test/klick (Prüfmodus an?)")
            time.sleep(1.0)
            if p["last"]["profil"] == "p1":
                from last.p1 import LastP1
                last = LastP1(ordner, LASTGEN, p["last"]["demucs_python"])
                last.start(p["dauer_s"] + p["last"]["vorlauf_s"] + 10)
                time.sleep(p["last"]["vorlauf_s"])
            bereit = ordner / "aufnahme.bereit"
            argv_auf, env_auf = aufnehmer_aufruf(senke, ordner, p["dauer_s"], p["quantum"], inst, bereit)
            auf = subprocess.Popen(argv_auf, env=env_auf, stderr=open(ordner / "aufnehmer.err", "w"))
            ende = time.monotonic() + 10
            while not bereit.exists() and time.monotonic() < ende:
                time.sleep(0.01)
            if not bereit.exists():
                raise LaufFehler("Aufnehmer meldet sich nicht (aufnehmer.err)")
            t_auf = int(bereit.read_text().split()[0])
            L["aufnahme_start_ns"] = t_auf
            g = sh(["pw-link", "-l"]).stdout
            (ordner / "graph.txt").write_text(g)
            fehlt = graph_fehlt(g, senke, inst, q["art"], nb["an"], nb["kante"])
            if fehlt:
                raise LaufFehler(f"Graph am Ziel unvollständig (graph.txt): {'; '.join(fehlt)}")
            for e in p["eingriff"]:
                warte_bis = t_auf + int(e["nach_s"] * 1e9)
                while (rest := warte_bis - time.monotonic_ns()) > 0:
                    time.sleep(min(rest / 1e9, 0.05))
                pid = ziel_pid(e, units)
                if not pid:
                    raise LaufFehler(f"Eingriff {e}: kein Prozess")
                t = time.monotonic_ns()
                os.kill(pid, SIGNALE[e["art"]])
                g = {"art": e["art"], "ziel": e["ziel"], "pid": pid, "t_ns": t}
                if e["art"] == "sigstop":
                    time.sleep(e["halten_s"])
                    g["t_cont_ns"] = time.monotonic_ns()
                    os.kill(pid, signal.SIGCONT)
                elif e["ziel"] == "quelle" and q["neustart"]:
                    neu, tn = warte_pid(units["quelle"], 3.0, nicht=pid)
                    g["neue_pid"], g["t_neu_ns"] = neu, tn
                    eigene.add(neu)
                L["eingriffe"].append(g)
            auf.wait(timeout=p["dauer_s"] + 30)
        except (LaufFehler, subprocess.TimeoutExpired, OSError) as ex:
            L["fehler"] = str(ex)
        finally:
            if waechter:
                L["ring_fremde"] = fremd = waechter.fremde(eigene | {os.getpid()})
                if fremd and not L["fehler"]:
                    L["fehler"] = f"fremder Prozess am Ring {ring}: {fremd} (Instanz {inst} doppelt vergeben)"
            if auf and auf.poll() is None:
                auf.terminate()
                auf.wait()
            if last:
                L["last"] = last.stopp()
            for u in units.values():
                sh(["systemctl", "--user", "stop", u])
                sh(["systemctl", "--user", "reset-failed", u])
            if hoerer:
                hoerer.ende()
            for rolle, u in units.items():
                (ordner / f"journal-{rolle}.txt").write_text(sh(
                    ["journalctl", "--user", "-u", u, "-o", "short-monotonic", "--no-pager",
                     "--since", f"@{L['t_start_wand']}"]).stdout)
            r = sh([str(PRUEF / "senke" / "senke_ab.sh"), senke])
            L["senke_ab"] = (r.stdout + r.stderr).strip()
            L["module_nachher"] = module()
            L["units_reste"] = sh(["systemctl", "--user", "list-units", "--all", f"cypherdj-pruef-{inst}-*",
                                   "--no-legend"]).stdout.strip()
            for f in (ring, anker):
                if f.exists():
                    f.unlink()
            L["fremdlast_nachher"] = fremdlast()
            L["t_ende_ns"] = time.monotonic_ns()
            (ordner / "lauf.json").write_text(json.dumps(L, indent=1, ensure_ascii=False, default=str) + "\n")
    return L
