#!/usr/bin/env python3
"""Prüf-Abonnent der Scheibe 18: meldet sich beim Kern an (/k/hallo, Herzschlag fest alle --herzschlag s, §4.1),
schickt Befehle zu Kern-Samples und schreibt jede empfangene Nachricht mit Empfangszeit (CLOCK_MONOTONIC, ns) als
JSON-Zeile. Er ist ein gespeicherter Abonnent im Sinn von §4.1: er meldet sich nach einem Neustart NICHT von sich aus
neu an, sondern nur im festen Herzschlag. So misst die Auswertung, ob /e/neustart vor seinem nächsten Herzschlag kam.

Aufruf: abonnent.py --kern-port P --port P --log datei.jsonl --dauer S [--herzschlag 2.0] [--name pruefstand]
                    [--bpm 128] [--rampe ab:ziel:dauer] [--klick-nach-neustart]
                    [--abschuss-bei SAMPLE --unit UNIT --ereignisse datei.jsonl]
Ablauf: /k/hallo; sobald /uhr kommt: /k/set/neu (bpm), nach dessen /q gestartet (2): /test/klick master 1, bei --rampe
/k/tempo/rampe. --abschuss-bei: kill -9 auf den Hauptprozess von --unit, sobald die Kern-Uhr (hochgerechnet aus /uhr,
§5.2) das Sample erreicht (Golden-Folgen notbahn_124, notbahn_rampe: "aktion kern_kill9").
--klick-nach-neustart (Fehlerfall mit dem Kern aus 08): springt das Kern-Sample zurück, schickt er /test/klick erneut,
damit die Auswertung den Rastersprung am Klick messen kann.
"""
import argparse
import json
import os
import select
import signal
import socket
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osc  # noqa: E402


def mono_ns():
    return time.clock_gettime_ns(time.CLOCK_MONOTONIC)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kern-port", type=int, required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--dauer", type=float, required=True)
    ap.add_argument("--herzschlag", type=float, default=2.0)
    ap.add_argument("--name", default="pruefstand")
    ap.add_argument("--bpm", type=float, default=128.0)
    ap.add_argument("--rampe", default="")
    ap.add_argument("--klick-nach-neustart", action="store_true")
    ap.add_argument("--abschuss-bei", type=int, default=-1)
    ap.add_argument("--unit", default="")
    ap.add_argument("--ereignisse", default="")
    a = ap.parse_args()

    stop = [False]
    signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__(0, True))
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", a.port))
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
    kern = ("127.0.0.1", a.kern_port)
    log = open(a.log, "w", buffering=1)
    basis = mono_ns()  # §1.4: Zählerstart beim Prozessstart = mono_ns
    ids = {"set_neu": basis + 1, "klick": basis + 2, "rampe": basis + 3}
    t0 = mono_ns()
    ende = t0 + int(a.dauer * 1e9)
    naechster_herz = t0
    phase = "warte_uhr"
    letzte_sample = None
    abschuss_t = None  # CLOCK_MONOTONIC, zu der die Kern-Uhr --abschuss-bei erreicht

    def sende(adr, typen, *werte):
        s.sendto(osc.kodiere(adr, typen, *werte), kern)
        log.write(json.dumps({"t": mono_ns(), "gesendet": adr, "w": list(werte)}) + "\n")

    while not stop[0] and mono_ns() < ende:
        jetzt = mono_ns()
        if abschuss_t is not None and jetzt >= abschuss_t:
            pid = int(subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", a.unit],
                                     capture_output=True, text=True).stdout.strip() or 0)
            t = mono_ns()
            if pid > 0:
                os.kill(pid, signal.SIGKILL)
            with open(a.ereignisse, "a") as f:
                f.write(json.dumps({"i": 1, "art": "kill", "pid": pid, "t_ns": t, "bei_sample": a.abschuss_bei}) + "\n")
            abschuss_t = None
            a.abschuss_bei = -1
        if jetzt >= naechster_herz:
            sende("/k/hallo", ",sii", a.name, a.port, 1)
            naechster_herz += int(a.herzschlag * 1e9)
        r, _, _ = select.select([s], [], [], 0.001)
        if not r:
            continue
        while True:
            try:
                b = s.recv(2048, socket.MSG_DONTWAIT)
            except BlockingIOError:
                break
            t = mono_ns()
            m = osc.lies(b)
            if m is None:
                log.write(json.dumps({"t": t, "adr": "?", "roh": b.hex()}) + "\n")
                continue
            adr, typen, w = m
            log.write(json.dumps({"t": t, "adr": adr, "w": w}) + "\n")
            if adr == "/uhr":
                smp = w[0]
                if phase == "warte_uhr":
                    sende("/k/set/neu", ",hsd", ids["set_neu"], "pruefstand", a.bpm)
                    phase = "warte_set_neu"
                elif a.klick_nach_neustart and letzte_sample is not None and smp < letzte_sample:
                    ids["klick"] += 100
                    sende("/test/klick", ",hssi", ids["klick"], "pruefstand", "master", 1)
                letzte_sample = smp
                if phase == "laeuft" and a.abschuss_bei >= 0 and smp <= a.abschuss_bei:
                    abschuss_t = w[1] + int((a.abschuss_bei - smp) * 1e9 / 48000)
            elif adr == "/q" and phase == "warte_set_neu" and w[0] == ids["set_neu"] and w[2] in (2, 3):
                sende("/test/klick", ",hssi", ids["klick"], "pruefstand", "master", 1)
                if a.rampe:
                    ab, ziel, dauer = (float(x) for x in a.rampe.split(":"))
                    sende("/k/tempo/rampe", ",hsddd", ids["rampe"], "pruefstand", ab, ziel, dauer)
                phase = "laeuft"
    try:
        s.sendto(osc.kodiere("/k/tschuess", ",s", a.name), kern)
    except OSError:
        pass
    log.close()


if __name__ == "__main__":
    main()
