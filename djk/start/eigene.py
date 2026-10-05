#!/usr/bin/env python3
"""Findet und beendet die djk-eigenen Prozesse einer Instanz, die nicht in einer Unit von djk-start laufen: den
Cue-Server (djk/cues/server.ts) und den Vorhörer (djk/vorhoerer/build/cypherdj-vorhoerer). Für `djk-stop --alles`
(Plan M-1 Task 9 R2). Kern, Notbahn, Leitstand und Oberfläche beendet djk-stop über ihre Units.

Aufruf: eigene.py --djk DIR --instanz X (--liste | --beenden)      X leer = Betrieb
Erkennung (jede Bedingung muss stimmen, sonst ist der Prozess fremd und bleibt unberührt):
  Vorhörer    /proc/<pid>/exe ist genau DIR/vorhoerer/build/cypherdj-vorhoerer
  Cue-Server  /proc/<pid>/exe heißt node*, und das erste Argument ohne "-" (das Skript, relativ zum Arbeitsverzeichnis
              des Prozesses aufgelöst) ist genau DIR/cues/server.ts
  Instanz     bei beiden CYPHERDJ_INSTANZ aus /proc/<pid>/environ (Cue-Server: eine Angabe --vorhoerer-instanz gilt
              vor der Umgebung); leer und nicht gesetzt sind gleich. Ein Prozess, dessen environ nicht lesbar ist,
              gehört nicht zu uns.
Beenden (KILL-REGEL): keine PID-Substitution. Die PID wird aus /proc gelesen, Exe und Kommandozeile werden geprüft, und
unmittelbar vor jedem Signal noch einmal (PID-Wiederverwendung); nie PID <= 1, nie der eigene Prozess oder ein Vorfahre.
SIGTERM, bis 3 s Wartezeit, danach SIGKILL nach erneuter Prüfung. Zuerst der Cue-Server (er hält den Vorhörer als Kind),
dann der Vorhörer.
Rückgabe: 0, 1 ein Prozess lebt nach dem Beenden noch, 2 Aufruf."""
import os
import signal
import sys
import time


def lies(pfad, binaer=False):
    try:
        with open(pfad, "rb") as f:
            d = f.read()
        return d if binaer else d.decode("utf-8", "replace")
    except OSError:
        return None


def vorfahren():
    aus, pid = set(), os.getpid()
    while pid > 1:
        aus.add(pid)
        stat = lies(f"/proc/{pid}/stat")
        if not stat:
            break
        pid = int(stat.rsplit(")", 1)[1].split()[1])
    return aus


def beschreibe(pid, djk):
    """(art, instanz, cmdline) wenn PID ein djk-eigener Cue-Server oder Vorhörer ist, sonst None."""
    try:
        exe = os.path.realpath(os.readlink(f"/proc/{pid}/exe"))
        cwd = os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return None
    roh = lies(f"/proc/{pid}/cmdline", binaer=True)
    env = lies(f"/proc/{pid}/environ", binaer=True)
    if not roh or env is None:
        return None
    argv = [a.decode("utf-8", "replace") for a in roh.split(b"\0") if a != b""]
    umgebung = dict(e.split("=", 1) for e in env.decode("utf-8", "replace").split("\0") if "=" in e)
    instanz = umgebung.get("CYPHERDJ_INSTANZ", "")
    cmd = " ".join(argv)
    if exe == os.path.realpath(os.path.join(djk, "vorhoerer/build/cypherdj-vorhoerer")):
        return "vorhoerer", instanz, cmd
    if os.path.basename(exe).startswith("node"):
        skript = next((a for a in argv[1:] if not a.startswith("-")), None)
        if skript and os.path.realpath(os.path.join(cwd, skript)) == os.path.realpath(os.path.join(djk, "cues/server.ts")):
            if "--vorhoerer-instanz" in argv[1:]:
                i = argv.index("--vorhoerer-instanz")
                instanz = argv[i + 1] if i + 1 < len(argv) else ""
            return "cue-server", instanz, cmd
    return None


def finde(djk, instanz):
    aus = []
    tabu = vorfahren()
    for n in os.listdir("/proc"):
        if not n.isdigit() or int(n) <= 1 or int(n) in tabu:
            continue
        b = beschreibe(int(n), djk)
        if b and b[1] == instanz:
            aus.append((int(n),) + b)
    return sorted(aus, key=lambda t: (t[2] != "cue-server", t[0]))


def lebt(pid):
    stat = lies(f"/proc/{pid}/stat")
    return bool(stat) and stat.rsplit(")", 1)[1].split()[0] != "Z"


def beende(eintrag, djk, instanz):
    pid, art, _, cmd = eintrag
    tabu = vorfahren()
    for sig, frist in ((signal.SIGTERM, 3.0), (signal.SIGKILL, 1.0)):
        if not lebt(pid):
            break
        jetzt = beschreibe(pid, djk)
        # erneut prüfen: dieselbe Art, Instanz und Kommandozeile, nie <= 1, nie wir selbst oder ein Vorfahre
        if pid <= 1 or pid in tabu or not jetzt or jetzt[0] != art or jetzt[1] != instanz or jetzt[2] != cmd:
            print(f"  pid {pid}: changed since the scan, left alone", file=sys.stderr)
            return True
        os.kill(pid, sig)
        ende = time.time() + frist
        while time.time() < ende and lebt(pid):
            time.sleep(0.05)
    ok = not lebt(pid)
    print(f"  {'stopped' if ok else 'STILL ALIVE'} {art} pid {pid}: {cmd[:110]}")
    return ok


def main(argv):
    a = list(argv)
    try:
        djk = a[a.index("--djk") + 1]
        instanz = a[a.index("--instanz") + 1]
        modus = "liste" if "--liste" in a else "beenden" if "--beenden" in a else None
    except (ValueError, IndexError):
        modus = None
    if not modus:
        print("usage: eigene.py --djk DIR --instanz X (--liste | --beenden)", file=sys.stderr)
        return 2
    funde = finde(djk, instanz)
    if modus == "liste":
        for pid, art, _, cmd in funde:
            print(f"  would stop {art} pid {pid}: {cmd[:110]}")
        return 0
    ok = True
    for f in funde:
        ok = beende(f, djk, instanz) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
