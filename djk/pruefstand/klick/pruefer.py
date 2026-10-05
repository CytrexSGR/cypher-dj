#!/usr/bin/env python3
"""Prüfer der Scheibe 01: spricht mit cypherdj-kern über OSC/UDP (SCHNITTSTELLEN.md §4.1, §4.2, §5, ROADMAP Z1) und
schreibt jede empfangene Nachricht als JSON-Zeile ins Protokoll (auch jedes /uhr, das braucht die Auswertung).

Arten:
  klick           /k/hallo, /k/set/neu 128, dann --bereit anlegen, auf --aufnahme-bereit warten, /test/klick an,
                  zuhören bis --schlaege Schläge plus 2 Beats vorbei sind, /test/klick aus, /k/tschuess
  ohne-klick      /k/hallo, /k/set/neu 128, --bereit anlegen, --sekunden lang nur zuhören (Negativ-Kontrolle)
  klick-verboten  /k/hallo, /test/klick an; erfüllt, wenn /e/protokollfehler mit Adresse /test/klick kommt und
                  keine Quittung (Kern ohne --pruefmodus)
Nach der Anmeldung schickt der Prüfer jede Sekunde /k/hallo (Herzschlag, SCHNITTSTELLEN.md §4.1: spätestens alle 2 s).
Umgebung: CYPHERDJ_INSTANZ verschiebt die Ports um 1000*k (ROADMAP Z2).
Rückgabe: 0 erfüllt, 1 nicht erfüllt, 2 Aufruf falsch.
"""
import argparse
import json
import os
import queue
import socket
import struct
import sys
import threading
import time

QUELLE = "pruefstand"


def text(s):
    b = s.encode() + b"\0"
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def osc(adresse, typen, *werte):
    p = text(adresse) + text("," + typen)
    for t, w in zip(typen, werte):
        p += {"i": lambda v: struct.pack(">i", v), "h": lambda v: struct.pack(">q", v),
              "f": lambda v: struct.pack(">f", v), "d": lambda v: struct.pack(">d", v), "s": text}[t](w)
    return p


def lies(p):
    def zk(o):
        e = p.index(b"\0", o)
        return p[o:e].decode(), o + ((e - o) // 4 + 1) * 4
    adresse, o = zk(0)
    typen, o = zk(o)
    werte = []
    for t in typen[1:]:
        if t == "s":
            w, o = zk(o)
        else:
            fmt, n = {"i": (">i", 4), "h": (">q", 8), "f": (">f", 4), "d": (">d", 8)}[t]
            w = struct.unpack(fmt, p[o:o + n])[0]
            o += n
        werte.append(w)
    return adresse, typen[1:], werte


class Pruefer:
    def __init__(self, log_pfad):
        inst = os.environ.get("CYPHERDJ_INSTANZ", "")
        if inst and not (len(inst) == 1 and "a" <= inst <= "i"):
            raise SystemExit(2)
        k = ord(inst) - ord("a") + 1 if inst else 0
        self.kern = ("127.0.0.1", 47100 + 1000 * k)
        self.port = 47140 + 1000 * k
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.settimeout(0.05)
        self.log = open(log_pfad, "w")
        self.q = queue.Queue()
        self.stop = False
        self.beat = None
        self.herzschlag = None  # time.monotonic() des letzten /k/hallo nach der Anmeldung
        self.id = time.monotonic_ns()  # §1.4: Zählerstart = mono_ns
        self.t = threading.Thread(target=self.empfang, daemon=True)
        self.t.start()

    def empfang(self):
        while not self.stop:
            if self.herzschlag is not None and time.monotonic() - self.herzschlag > 1.0:
                self.herzschlag = time.monotonic()
                self.sende("/k/hallo", "sii", QUELLE, self.port, 1)
            try:
                p = self.sock.recv(2048)
            except socket.timeout:
                continue
            t = time.monotonic_ns()
            try:
                a, typen, w = lies(p)
            except Exception as e:  # ein unlesbares Paket ist ein Befund, kein Absturz
                self.log.write(json.dumps({"t_ns": t, "fehler": str(e), "roh": p.hex()}) + "\n")
                continue
            self.log.write(json.dumps({"t_ns": t, "adresse": a, "typen": typen, "werte": w}) + "\n")
            if a == "/uhr":
                self.beat = w[2]
            else:
                self.q.put((a, w))

    def sende(self, adresse, typen, *werte):
        self.sock.sendto(osc(adresse, typen, *werte), self.kern)

    def naechste_id(self):
        self.id += 1
        return self.id

    def warte(self, pruefe, sekunden):
        ende = time.monotonic() + sekunden
        while time.monotonic() < ende:
            try:
                a, w = self.q.get(timeout=0.05)
            except queue.Empty:
                continue
            if pruefe(a, w):
                return a, w
        return None

    def anmelden(self):
        for _ in range(15):
            self.sende("/k/hallo", "sii", QUELLE, self.port, 1)
            if self.warte(lambda a, w: a == "/k/willkommen", 0.2):
                self.herzschlag = time.monotonic()
                return True
        return False

    def quittung(self, i, status, sekunden=2.0):
        r = self.warte(lambda a, w: a == "/q" and w[0] == i and w[2] in (status, 6), sekunden)
        return r[1] if r else None

    def set_neu(self, bpm):
        i = self.naechste_id()
        self.sende("/k/set/neu", "hsd", i, QUELLE, bpm)
        return self.quittung(i, 2)

    def ende(self, zusammenfassung):
        self.herzschlag = None
        self.sende("/k/tschuess", "s", QUELLE)
        time.sleep(0.1)
        self.stop = True
        self.t.join()
        self.log.write(json.dumps({"zusammenfassung": zusammenfassung}) + "\n")
        self.log.close()
        print(json.dumps(zusammenfassung, ensure_ascii=False))


def warte_datei(pfad, sekunden):
    ende = time.monotonic() + sekunden
    while time.monotonic() < ende:
        if os.path.exists(pfad):
            return True
        time.sleep(0.02)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art", choices=["klick", "ohne-klick", "klick-verboten"])
    ap.add_argument("--log", required=True)
    ap.add_argument("--bereit")
    ap.add_argument("--aufnahme-bereit")
    ap.add_argument("--schlaege", type=int, default=101)
    ap.add_argument("--sekunden", type=float, default=60.0)
    ap.add_argument("--bpm", type=float, default=128.0)
    a = ap.parse_args()
    p = Pruefer(a.log)
    z = {"art": a.art, "erfuellt": False}
    if not p.anmelden():
        z["grund"] = "kein /k/willkommen"
        p.ende(z)
        return 1
    if a.art == "klick-verboten":
        i = p.naechste_id()
        p.sende("/test/klick", "hssi", i, QUELLE, "master", 1)
        r = p.warte(lambda adr, w: (adr == "/e/protokollfehler" and w[0] == "/test/klick") or
                    (adr == "/q" and w[0] == i), 2.0)
        z["antwort"] = r
        z["erfuellt"] = bool(r and r[0] == "/e/protokollfehler")
        p.ende(z)
        return 0 if z["erfuellt"] else 1
    q = p.set_neu(a.bpm)
    z["set_neu"] = q
    if not q or q[2] != 2:
        z["grund"] = "keine Quittung 2 auf /k/set/neu"
        p.ende(z)
        return 1
    if a.bereit:
        open(a.bereit, "w").write("bereit\n")
    if a.aufnahme_bereit and not warte_datei(a.aufnahme_bereit, 15.0):
        z["grund"] = "Aufnehmer meldet sich nicht"
        p.ende(z)
        return 1
    time.sleep(0.3)
    if a.art == "ohne-klick":
        time.sleep(a.sekunden)
        z["erfuellt"] = True
        p.ende(z)
        return 0
    i = p.naechste_id()
    p.sende("/test/klick", "hssi", i, QUELLE, "master", 1)
    q1, q2 = p.quittung(i, 1), p.quittung(i, 2, 3.0)
    z["klick_angenommen"], z["klick_gestartet"] = q1, q2
    if not q2 or q2[2] != 2:
        z["grund"] = "keine Quittung 2 auf /test/klick"
        p.ende(z)
        return 1
    erster = q2[4]
    ziel = erster + a.schlaege - 1 + 2
    ende = time.monotonic() + (a.schlaege + 4) * 60.0 / a.bpm
    while (p.beat is None or p.beat < ziel) and time.monotonic() < ende:
        time.sleep(0.05)
    i2 = p.naechste_id()
    p.sende("/test/klick", "hssi", i2, QUELLE, "master", 0)
    z["klick_aus"] = p.quittung(i2, 2)
    z["erster_klick_beat"], z["erster_klick_sample"] = erster, q2[3]
    z["letzter_beat_gesehen"] = p.beat
    z["erfuellt"] = p.beat is not None and p.beat >= ziel
    p.ende(z)
    return 0 if z["erfuellt"] else 1


if __name__ == "__main__":
    sys.exit(main())
