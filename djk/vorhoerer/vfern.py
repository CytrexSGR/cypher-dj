#!/usr/bin/env python3
"""Fernsteuerung des Vorhörers (djk/vorhoerer, OSC/UDP 127.0.0.1:47740 + 1000·k). Modul für Prüfung und Cue-Server,
dazu ein Kommandozeilen-Werkzeug.

  vfern.py laden <pfad> [--warte]     /v/laden; mit --warte bis /v/geladen oder /v/fehler (Ausgabe als JSON-Zeile)
  vfern.py play | pause | loop_aus
  vfern.py springe <s>
  vfern.py loop <a_s> <b_s>
  vfern.py blende 0|1
  vfern.py hoere [--sekunden S]       meldet sich mit /v/hallo an und gibt jede Meldung als JSON-Zeile aus

Jede gesendete Nachricht wird mit CLOCK_MONOTONIC (ns) protokolliert, wenn ein Protokoll übergeben ist.
"""
import argparse
import json
import os
import socket
import struct
import sys
import time

PORT_BASIS = 47740


def port(inst=None):
    inst = os.environ.get("CYPHERDJ_INSTANZ", "") if inst is None else inst
    if inst == "":
        return PORT_BASIS
    if len(inst) == 1 and "a" <= inst <= "i":
        return PORT_BASIS + 1000 * (ord(inst) - ord("a") + 1)
    raise ValueError(f"CYPHERDJ_INSTANZ ungültig: {inst!r}")


def _text(s):
    b = s.encode() + b"\0"
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def kodiere(adresse, typen="", *werte):
    p = _text(adresse) + _text("," + typen)
    for t, w in zip(typen, werte, strict=True):
        p += {"i": lambda v: struct.pack(">i", v), "h": lambda v: struct.pack(">q", v),
              "f": lambda v: struct.pack(">f", v), "d": lambda v: struct.pack(">d", v),
              "s": lambda v: _text(v)}[t](w)
    return p


def dekodiere(b):
    def text(o):
        e = b.index(b"\0", o)
        return b[o:e].decode(errors="replace"), o + ((e - o + 4) & ~3)
    adr, o = text(0)
    if o >= len(b):
        return adr, []
    typen, o = text(o)
    werte = []
    for t in typen[1:]:
        if t in "if":
            werte.append(struct.unpack(">" + t, b[o:o + 4])[0]); o += 4
        elif t in "hd":
            werte.append(struct.unpack(">" + ("q" if t == "h" else "d"), b[o:o + 8])[0]); o += 8
        elif t == "s":
            s, o = text(o); werte.append(s)
    return adr, werte


class Vorhoerer:
    """Sender und Empfänger in einem UDP-Socket: Antworten kommen an die Absenderadresse (/v/hallo ohne Port)."""

    def __init__(self, ziel_port=None, protokoll=None):
        self.ziel = ("127.0.0.1", ziel_port or port())
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.bind(("127.0.0.1", 0))
        self.protokoll = protokoll  # Datei-Objekt für JSON-Zeilen oder None

    def _log(self, richtung, adr, werte):
        if self.protokoll:
            self.protokoll.write(json.dumps({"t_ns": time.monotonic_ns(), "r": richtung, "adr": adr, "w": werte}) + "\n")

    def senden(self, adr, typen="", *werte):
        t = time.monotonic_ns()
        self.s.sendto(kodiere(adr, typen, *werte), self.ziel)
        self._log(">", adr, list(werte))
        return t

    def hallo(self): return self.senden("/v/hallo")
    def laden(self, pfad): return self.senden("/v/laden", "s", pfad)
    def play(self): return self.senden("/v/play")
    def pause(self): return self.senden("/v/pause")
    def springe(self, s): return self.senden("/v/springe", "d", float(s))
    def loop(self, a, b): return self.senden("/v/loop", "dd", float(a), float(b))
    def loop_aus(self): return self.senden("/v/loop_aus")
    def blende(self, an): return self.senden("/v/blende", "i", 1 if an else 0)

    def empfange(self, timeout):
        self.s.settimeout(timeout)
        try:
            b, _ = self.s.recvfrom(2048)
        except socket.timeout:
            return None
        t = time.monotonic_ns()
        adr, w = dekodiere(b)
        self._log("<", adr, w)
        return t, adr, w

    def warte_auf(self, adressen, timeout):
        ende = time.monotonic() + timeout
        while time.monotonic() < ende:
            m = self.empfange(max(0.01, ende - time.monotonic()))
            if m and m[1] in adressen:
                return m
        return None

    def sammle(self, sekunden):
        """Alle Meldungen für sekunden einsammeln (hält den Empfang leer)."""
        aus, ende = [], time.monotonic() + sekunden
        while time.monotonic() < ende:
            m = self.empfange(max(0.005, ende - time.monotonic()))
            if m:
                aus.append(m)
        return aus


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("befehl")
    ap.add_argument("werte", nargs="*")
    ap.add_argument("--port", type=int)
    ap.add_argument("--warte", action="store_true")
    ap.add_argument("--sekunden", type=float, default=1e9)
    a = ap.parse_args()
    v = Vorhoerer(a.port)
    b, w = a.befehl, a.werte
    if b == "hoere":
        v.hallo()
        ende = time.monotonic() + a.sekunden
        while time.monotonic() < ende:
            m = v.empfange(0.5)
            if m:
                print(json.dumps({"t_ns": m[0], "adr": m[1], "w": m[2]}), flush=True)
        return 0
    if b == "laden":
        if a.warte:
            v.hallo()
        v.laden(os.path.abspath(w[0]))
        if a.warte:
            m = v.warte_auf({"/v/geladen", "/v/fehler"}, 120)
            print(json.dumps({"adr": m[1], "w": m[2]} if m else {"adr": None}))
            return 0 if m and m[1] == "/v/geladen" else 1
    elif b in ("play", "pause", "loop_aus"):
        getattr(v, b)()
    elif b == "springe":
        v.springe(w[0])
    elif b == "loop":
        v.loop(w[0], w[1])
    elif b == "blende":
        v.blende(int(w[0]))
    else:
        print(f"unbekannt: {b}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
