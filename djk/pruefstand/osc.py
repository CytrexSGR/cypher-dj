"""OSC 1.0 kodieren und lesen (Typen i, h, f, d, s) und der Hörer des Prüfstands (SCHNITTSTELLEN §2, §4.1, §5, §5.10).

Der Hörer bindet den Prüfstand-Port 47140 + 1000·k (ROADMAP Z2), schreibt jede Nachricht als JSON-Zeile mit
CLOCK_MONOTONIC-Zeit und hält sich mit /k/hallo alle `herzschlag_s` beim Kern angemeldet (§4.1: Abonnenten fallen nach
5 s Stille heraus). /nb der Notbahn kommt ohne Anmeldung auf denselben Port.
"""
import json
import os
import socket
import struct
import threading
import time

QUELLE = "pruefstand"


def instanz_k(inst=None):
    """k aus CYPHERDJ_INSTANZ (leer: 0, a..i: 1..9); ValueError bei anderem Wert."""
    inst = os.environ.get("CYPHERDJ_INSTANZ", "") if inst is None else inst
    if inst == "":
        return 0
    if len(inst) == 1 and "a" <= inst <= "i":
        return ord(inst) - ord("a") + 1
    raise ValueError(f"CYPHERDJ_INSTANZ ungültig: {inst!r}")


def _text(s):
    b = s.encode() + b"\0"
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def kodiere(adresse, typen, *werte):
    p = _text(adresse) + _text("," + typen)
    for t, w in zip(typen, werte, strict=True):
        if t == "i":
            p += struct.pack(">i", w)
        elif t == "h":
            p += struct.pack(">q", w)
        elif t == "f":
            p += struct.pack(">f", w)
        elif t == "d":
            p += struct.pack(">d", w)
        elif t == "s":
            p += _text(w)
        else:
            raise ValueError(f"Typ {t} nicht unterstützt")
    return p


def lies(p):
    """(adresse, typen ohne Komma, [werte])."""
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


class Hoerer:
    """Protokolliert alles, was an den Prüfstand-Port kommt; spricht mit dem Kern, wenn `mit_kern`."""

    def __init__(self, log_pfad, inst=None, mit_kern=False, herzschlag_s=1.0, name="pruefstand"):
        k = instanz_k(inst)
        self.kern = ("127.0.0.1", 47100 + 1000 * k)
        self.port = 47140 + 1000 * k
        self.name = name
        self.mit_kern = mit_kern
        self.herzschlag_s = herzschlag_s
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.settimeout(0.05)
        self.log = open(log_pfad, "w", buffering=1)
        self.id = time.monotonic_ns()          # §1.4: Zählerstart = mono_ns, streng steigend
        self.stop = False
        self.sperre = threading.Lock()
        self.letzte = {}                        # adresse -> (t_ns, werte) der letzten Nachricht
        self.faeden = [threading.Thread(target=self._empfang, daemon=True)]
        if mit_kern:
            self.faeden.append(threading.Thread(target=self._herz, daemon=True))
        for f in self.faeden:
            f.start()

    def _empfang(self):
        while not self.stop:
            try:
                p = self.sock.recv(2048)
            except socket.timeout:
                continue
            t = time.monotonic_ns()
            try:
                a, typen, w = lies(p)
            except (ValueError, KeyError, struct.error, UnicodeDecodeError) as e:
                with self.sperre:
                    self.log.write(json.dumps({"t_ns": t, "fehler": str(e), "roh": p.hex()}) + "\n")
                continue
            with self.sperre:
                self.letzte[a] = (t, w)
                self.log.write(json.dumps({"t_ns": t, "adresse": a, "typen": typen, "werte": w}) + "\n")

    def _herz(self):
        while not self.stop:
            self.sende("/k/hallo", "sii", self.name, self.port, 1)
            time.sleep(self.herzschlag_s)

    def sende(self, adresse, typen, *werte):
        """Schickt an den Kern und protokolliert; Empfangs- und Herzschlag-Faden schreiben dieselbe Datei, darum unter
        der Sperre (sonst können sich zwei JSON-Zeilen mischen)."""
        self.sock.sendto(kodiere(adresse, typen, *werte), self.kern)
        with self.sperre:
            self.log.write(json.dumps({"t_ns": time.monotonic_ns(), "gesendet": adresse, "typen": typen,
                                       "werte": list(werte)}) + "\n")

    def naechste_id(self):
        self.id += 1
        return self.id

    def warte_auf(self, adresse, sekunden, pruefe=lambda w: True, seit_ns=0):
        """Wartet, bis eine Nachricht `adresse` nach `seit_ns` eingeht und `pruefe(werte)` erfüllt; gibt die Werte zurück."""
        ende = time.monotonic() + sekunden
        while time.monotonic() < ende:
            with self.sperre:
                t, w = self.letzte.get(adresse, (0, None))
            if w is not None and t > seit_ns and pruefe(w):
                return w
            time.sleep(0.01)
        return None

    def ende(self):
        if self.mit_kern:
            self.sende("/k/tschuess", "s", self.name)
        self.stop = True
        for f in self.faeden:
            f.join()
        self.sock.close()
        self.log.close()
