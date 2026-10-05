#!/usr/bin/env python3
"""Leitstand-Attrappe (SCHNITTSTELLEN.md §19.2, Werkstück K1, Scheibe 08): fährt Golden-Folgen aus
djk/vertrag/folgen/*.jsonl gegen einen laufenden Kern (oder die Kern-Attrappe, Scheibe 13) und prüft Quittungen,
Ereignisse und Werte. Format und Läufer-Regeln: djk/vertrag/folgen/FORMAT.md (Punkte 1 bis 22, Scheiben 02 und 09).
Geurteilt wird am Ende über die ganze Beobachtung mit djk/vertrag/folgen_vergleich.py (Scheibe 09), wie in golden.mjs
und echtzeit.mjs der Attrappe (Plan 13, Nachtrag B8; Befunde B1, B6, B7). Dieser Läufer setzt die Punkte so um:

  * Punkt 2: der erste Schritt ist /k/set/neu. Bis dessen Quittung gestartet (Status 2) da ist, wartet der Läufer
    höchstens 2 s Wanduhr (sonst rot). Was vorher eintraf, gehört zur alten Zeitachse und fällt weg, ausgenommen die
    Quittungen von /k/set/neu selbst (Sample 0).
  * Punkt 3, 5, 15 (B7): die Handlungen sende, buendel, hand, aktion gehen in Dateireihenfolge hinaus, jede sobald die
    aus /uhr hochgerechnete Kern-Uhr ihr Sample erreicht (§5.2), /test/hand ,sfh 4 800 Samples (100 ms) vor seinem.
    Prüf-Zeilen halten keine Handlung auf: der Läufer beobachtet bis zum letzten Sample der Folge plus 0,3 s und
    urteilt dann.
  * Punkt 4: Felder namens id oder ziel_id (Namen aus osc.json, Typ h im Paket) bekommen die Basis B = mono_ns beim
    Start der Folge (§1.4) beim Senden, auch in Bündeln; in der Beobachtung wird sie wieder abgezogen.
  * Zeitstempel einer Nachricht (Punkt 6 und 14; Befund B5, Regel aus echtzeit.mjs): /uhr trägt sein Sample; eine
    Nachricht mit eigenem Feld ist_sample bzw. sample, das nicht vor dem zuletzt empfangenen /uhr liegt, trägt dieses
    Feld; jede andere gilt am Blockanfang nach dem zuletzt empfangenen /uhr (+256). So zählt eine Nachricht nur, wenn
    sie eintraf, bevor die Kern-Uhr über ihren Block hinaus war, und die Last des Läufers verschiebt keine Stempel.
  * Punkt 6, 8, 14, 16 (erwarte, erwarte_nicht, erlaube): folgen_vergleich.pruefe (größtes Matching, erlaube verbraucht
    den Rest, am Ende rot bei unverbrauchtem /e/protokollfehler, /e/invariante oder /q mit Status 4 bis 8).
  * Punkt 7 (B6): wert aus /e/regler (Feld sample): linear nur zwischen zwei Meldungen, die höchstens 1 100 Samples
    auseinander liegen (50-Hz-Takt laufender Rampen), sonst der letzte Wert (ein Setzen ist ein Sprung); ohne Meldung
    bis zum Sample die Vorgabe aus §1.5.
  * Punkt 16 deck_wert (B4): aus /zustand/deck, bezogen auf den Blockanfang des /uhr davor, zwischen zwei Meldungen
    linear wie wert (quell_beat nicht über eine Naht), status die letzte Meldung davor.
  * Punkt 16 buendel: OSC-Bündel mit Zeitmarke 1, null an h (t_send_us) als 0.
  * Punkt 16 aktion kern_kill9: der Läufer als Prüfstand sucht den Prozess, der den Kern-Port hält, beendet ihn mit
    SIGKILL und startet ihn mit derselben Befehlszeile ohne --frisch neu (Fortsetzen auf dem Anker, §6.3); den neu
    gestarteten Kern beendet er am Ende seines Laufs.
  * Punkt 14: Zeilen der Bereiche leitstand (WebSocket) und rechner baut dieser Läufer nicht und überspringt sie;
    messung (Ton am Ziel) misst er nicht, eine messung-Zeile ist rot.
  * Punkt 16: jede andere Schritt-Art macht die Folge rot, bevor sie beginnt.
  * Herzschlag (Punkt 13, §4.1, §16.3): /k/hallo jede Sekunde; kommt 100 ms lang kein /uhr, sofort und dann alle 50 ms.

Aufruf: attrappe_leitstand.py [--kern-port P] [--port P] [--name N] [--bericht B.json] [--protokoll P.jsonl]
                              folge.jsonl [folge.jsonl ...]
Ports nach ROADMAP Z2 aus CYPHERDJ_INSTANZ (Kern 47100 + 1000·k, eigener Port 47140 + 1000·k, Prüfstand).
Rückgabe: 0 alle Folgen grün, 1 mindestens eine rot, 2 Aufruf- oder Verbindungsfehler.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.dont_write_bytecode = True           # kein __pycache__ in djk/vertrag/ durch den Import unten
sys.path.insert(0, str(HIER))
import folgen_vergleich as fv  # noqa: E402  (Scheibe 09)

RATE = 48000
BLOCK = 256                     # Blockanfang nach dem letzten /uhr: Stempel für Nachrichten ohne eigenes Sample
HAND_VORLAUF = 4800
NACHLAUF = 14400                # 0,3 s nach dem letzten Sample der Folge
MELDEABSTAND = 1100             # /e/regler, /zustand/deck während Bewegung etwa alle 960 Samples (B6, echtzeit.mjs)
STUMM_NS = 2_000_000_000        # Kern stumm: 2 s kein /uhr
HERZSCHLAG_NS = 1_000_000_000   # §4.1: spätestens alle 2 s, hier jede Sekunde
UHR_STILL_NS = 100_000_000      # §16.3: 100 ms kein /uhr ...
HALLO_EILIG_NS = 50_000_000      # ... dann alle 50 ms
HANDLUNGEN = ("sende", "buendel", "hand", "aktion")
PRUEFUNGEN = ("erwarte", "erwarte_nicht", "erlaube", "wert", "deck_wert", "messung")
BEREICHE_AUS = ("leitstand", "rechner")          # FORMAT.md Punkt 14: nicht gebaut, Zeilen übersprungen
DECK_FELDER = ("status", "quell_beat", "beats_bis_ende", "faktor")


def _vorgaben() -> dict[str, float]:
    """§1.5 Spalte Vorgabe je Regler-Pfad (wie attrappe_kern/vertrag.mjs); trim: Busse 0, sonst erst beim Laden."""
    kanalzug = {"fader": -200.0, "trim": 0.0, "eq/tief": 0.0, "eq/mitte": 0.0, "eq/hoch": 0.0, "kill/tief": 0.0,
                "kill/mitte": 0.0, "kill/hoch": 0.0, "filter": 0.0, "send/1": -200.0, "send/2": -200.0,
                "send/3": -200.0, "send/4": -200.0, "xseite": 1.0, "pfl": 0.0}
    v = {}
    kanaele = ([f"deck/{n}" for n in range(1, 5)] + [f"erz/{n}" for n in range(1, 9)] + ["pad/1", "pad/2"]
               + [f"bus/{n}" for n in range(1, 5)])
    for k in kanaele:
        for p, w in kanalzug.items():
            v[f"{k}/{p}"] = w
        if not k.startswith("bus/"):
            v[f"{k}/ziel"] = 0.0
        if k.startswith("deck/"):
            for stem in ("drums", "bass", "vocals", "other"):
                v[f"{k}/stem/{stem}"] = 0.0
    v.update({"xfader": 0.0, "master/pegel": 0.0, "master/kleber": 0.0, "cue/mix": -1.0, "cue/pegel": -12.0, "cue/split": 0.0,
              "fx/1/notenwert": 0.75, "fx/2/notenwert": 0.75, "fx/1/rueckkopplung": 0.5, "fx/2/rueckkopplung": 0.5})
    v.update({f"fx/{n}/rueckweg": 0.0 for n in range(1, 5)})
    v.update({"duck/tiefe": 0.0, "duck/release": 200.0})
    return v


VORGABE = _vorgaben()


def instanz_k() -> int:
    i = os.environ.get("CYPHERDJ_INSTANZ", "")
    if i == "":
        return 0
    if len(i) != 1 or not ("a" <= i <= "i"):
        raise SystemExit(f"CYPHERDJ_INSTANZ='{i}': erlaubt sind leer oder a bis i (ROADMAP Z2)")
    return ord(i) - ord("a") + 1


def _text(s: str) -> bytes:
    b = s.encode("ascii") + b"\0"
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def kodiere(adresse: str, typen: str, werte: list) -> bytes:
    """OSC 1.0, Big Endian (Vorlage proben/02-uhr-sync-planer/kern/absender.mjs); typen mit führendem Komma.
    Gleitkomma "NaN", "inf", "-inf" wie in den Folgen; null an h ist 0 (t_send_us, FORMAT.md Punkt 16)."""
    b = _text(adresse) + _text(typen)
    for t, v in zip(typen[1:], werte):
        if t in "fd" and isinstance(v, str):
            v = {"NaN": math.nan, "inf": math.inf, "-inf": -math.inf}[v]
        if t == "i":
            b += struct.pack(">i", int(v))
        elif t == "h":
            b += struct.pack(">q", 0 if v is None else int(v))
        elif t == "f":
            b += struct.pack(">f", float(v))
        elif t == "d":
            b += struct.pack(">d", float(v))
        elif t == "s":
            b += _text(str(v))
        else:
            raise ValueError(f"Typ '{t}' nicht unterstützt")
    return b


def kodiere_buendel(nachrichten: list[list]) -> bytes:
    """§4.8: OSC-Bündel mit Zeitmarke 1 ("sofort"), je Element Länge und Nachricht."""
    b = b"#bundle\0" + struct.pack(">Q", 1)
    for n in nachrichten:
        m = kodiere(n[0], n[1], n[2:])
        b += struct.pack(">i", len(m)) + m
    return b


def zerlege(p: bytes) -> tuple[str, str, list]:
    def text(o):
        e = p.index(b"\0", o)
        return p[o:e].decode("ascii"), (e + 4) & ~3
    adresse, o = text(0)
    typen, o = text(o)
    werte = []
    for t in typen[1:]:
        if t == "s":
            w, o = text(o)
        else:
            fmt, n = {"i": (">i", 4), "h": (">q", 8), "f": (">f", 4), "d": (">d", 8)}[t]
            w = struct.unpack_from(fmt, p, o)[0]
            o += n
        werte.append(w)
    return adresse, typen, werte


def lade_feldnamen(osc_json: Path) -> dict[str, list[str]]:
    """Adresse -> Feldnamen in Reihenfolge, aus djk/vertrag/osc.json (Scheibe 02)."""
    d = json.loads(osc_json.read_text(encoding="utf-8"))
    return {a["adresse"]: [f["name"] for f in a["felder"]] for a in d["adressen"]}


def sample_felder(felder: dict[str, list[str]]) -> dict[str, int]:
    """Adresse -> Index ihres eigenen Samples (ist_sample vor sample), für den Zeitstempel."""
    r = {}
    for a, namen in felder.items():
        for n in ("ist_sample", "sample"):
            if n in namen:
                r[a] = namen.index(n)
                break
    return r


def _id_stellen(osc: list, felder: dict[str, list[str]]) -> list[int]:
    namen = felder.get(osc[0], [])
    return [p for p, t in enumerate(osc[1][1:]) if t == "h" and p < len(namen) and namen[p] in ("id", "ziel_id")]


def mit_basis(osc: list, felder: dict[str, list[str]], basis: int) -> list:
    """Punkt 4: id und ziel_id (Typ h im Paket) um die Basis verschieben."""
    osc = list(osc)
    for p in _id_stellen(osc, felder):
        if osc[2 + p] is not None:
            osc[2 + p] = int(osc[2 + p]) + basis
    return osc


def ohne_basis(osc: list, felder: dict[str, list[str]], basis: int) -> list:
    """Punkt 4 rückwärts für die Beobachtung: Kennungen dieser Folge in ihrer eigenen Zählung (folgen_vergleich.py)."""
    osc = list(osc)
    for p in _id_stellen(osc, felder):
        if isinstance(osc[2 + p], int) and osc[2 + p] >= basis:
            osc[2 + p] -= basis
    return osc


def wert_aus_reihe(r: list[tuple[float, float]], s: float, fortlaufend: bool = False):
    """Wert am Sample s aus einer nach Sample sortierten Reihe [(sample, wert)] (B6, wie wertAusReihe in echtzeit.mjs):
    linear nur zwischen zwei Meldungen, die höchstens MELDEABSTAND auseinander liegen, sonst die letzte. fortlaufend
    (quell_beat): über eine Naht (Rücksprung) nicht interpolieren, sondern aus dem Paar davor weiterrechnen."""
    i = -1
    for j, (x, _) in enumerate(r):
        if x > s:
            break
        i = j
    if i < 0:
        return None
    x0, w0 = r[i]
    if x0 == s or not math.isfinite(w0):
        return w0

    def glatt(a, b):
        return (b[1] >= a[1] if fortlaufend else True) and math.isfinite(b[1]) and b[0] - a[0] <= MELDEABSTAND

    if i + 1 < len(r) and glatt(r[i], r[i + 1]):
        x1, w1 = r[i + 1]
        return w0 + (w1 - w0) * (s - x0) / (x1 - x0)
    if fortlaufend and i >= 1 and glatt(r[i - 1], r[i]) and s - x0 <= MELDEABSTAND:
        xa, wa = r[i - 1]
        return w0 + (w0 - wa) * (s - x0) / (x0 - xa)
    return w0


class Nachricht:
    """Eine empfangene Nachricht; sample ist ihr Zeitstempel auf der Kern-Uhr (Regel im Kopf dieser Datei)."""
    __slots__ = ("adresse", "typen", "werte", "sample")

    def __init__(self, adresse: str, typen: str, werte: list, sample: float):
        self.adresse, self.typen, self.werte, self.sample = adresse, typen, werte, sample

    def roh(self) -> list:
        return [self.adresse, self.typen, self.werte]


class Kern:
    """Verbindung zum Kern: Anmeldung mit Herzschlag (§4.1, §16.3), Empfang mit Zeitstempel, Kern-Uhr aus /uhr (§5.2),
    Deck-Reihen aus /zustand/deck, Neustart nach kill -9 (aktion kern_kill9)."""

    def __init__(self, kern_port: int, eigener_port: int, name: str, protokoll: Path | None = None,
                 felder: dict[str, list[str]] | None = None):
        self.kern = ("127.0.0.1", kern_port)
        self.name = name
        self.felder = felder or {}
        self.sample_idx = sample_felder(self.felder)
        deck = self.felder.get("/zustand/deck", [])
        self.deck_idx = {f: deck.index(f) for f in DECK_FELDER if f in deck}
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
        self.sock.bind(("127.0.0.1", eigener_port))
        self.port = self.sock.getsockname()[1]  # bei Port 0 (Tests) der vergebene
        self.sock.settimeout(0.002)
        self.uhr: tuple[int, int] | None = None  # (sample, mono_ns) des letzten /uhr
        self.uhr_zuletzt_ns = time.monotonic_ns()  # Wanduhr beim Eintreffen des letzten /uhr
        self.eingang: list[Nachricht] = []
        self.deck: dict[tuple[int, str], list[tuple[float, float]]] = {}
        self.set_neu: int | None = None  # Kennung eines /k/set/neu, dessen gestartet noch aussteht
        self.letzter_hallo = 0
        self.hallos = 0
        self.kinder: list[subprocess.Popen] = []
        self.protokoll = open(protokoll, "w", encoding="utf-8") if protokoll else None

    def schicke(self, adresse: str, typen: str, werte: list) -> None:
        self.sock.sendto(kodiere(adresse, typen, werte), self.kern)

    def schicke_roh(self, p: bytes) -> None:
        self.sock.sendto(p, self.kern)

    def hallo(self) -> None:
        self.schicke("/k/hallo", ",sii", [self.name, self.port, 1])
        self.letzter_hallo = time.monotonic_ns()
        self.hallos += 1

    def stempel(self, adresse: str, werte: list) -> float:
        if adresse == "/uhr":
            return float(werte[0])
        basis = self.uhr[0] if self.uhr else 0
        i = self.sample_idx.get(adresse)
        eigen = werte[i] if i is not None and i < len(werte) else None
        if isinstance(eigen, (int, float)) and eigen >= basis:
            return float(eigen)
        return float(basis + BLOCK) if self.uhr else 0.0

    def pumpe(self) -> None:
        jetzt = time.monotonic_ns()
        still = jetzt - self.uhr_zuletzt_ns > UHR_STILL_NS
        if jetzt - self.letzter_hallo > (HALLO_EILIG_NS if still else HERZSCHLAG_NS):
            self.hallo()
        while True:
            try:
                p = self.sock.recv(65536)
            except (socket.timeout, BlockingIOError):
                return
            if p.startswith(b"#bundle"):
                continue  # der Kern meldet in Einzelnachrichten (§5)
            try:
                adresse, typen, werte = zerlege(p)
            except (ValueError, struct.error, KeyError, UnicodeDecodeError):
                continue
            t_ns = time.monotonic_ns()
            if self.protokoll:
                self.protokoll.write(json.dumps({"t_ns": t_ns, "adresse": adresse, "typen": typen,
                                                 "werte": werte}) + "\n")
            neue_achse = (self.set_neu is not None and adresse == "/q" and len(werte) > 2
                          and werte[0] == self.set_neu and werte[2] == 2)
            if neue_achse:
                self.uhr = None   # Punkt 2: ab hier Sample 0 der neuen Zeitachse bis zu ihrem ersten /uhr
            if adresse == "/uhr":
                self.uhr = (werte[0], werte[1])
                self.uhr_zuletzt_ns = t_ns
            self.eingang.append(Nachricht(adresse, typen, werte, self.stempel(adresse, werte)))
            if adresse == "/zustand/deck" and self.uhr is not None:
                for f, i in self.deck_idx.items():
                    self.deck.setdefault((werte[0], f), []).append((float(self.uhr[0]), werte[i]))
            if neue_achse:
                kennung, self.set_neu = self.set_neu, None
                self.eingang = [Nachricht(m.adresse, m.typen, m.werte, 0.0) for m in self.eingang
                                if m.adresse == "/q" and m.werte[0] == kennung]
                self.deck.clear()

    def sample_jetzt(self) -> float | None:
        if self.uhr is None:
            return None
        s, mono = self.uhr
        return s + (time.monotonic_ns() - mono) * RATE / 1e9

    def verbinde(self, frist_s: float = 2.0):
        ende = time.monotonic() + frist_s
        self.hallo()
        while time.monotonic() < ende:
            self.pumpe()
            for m in self.eingang:
                if m.adresse == "/k/willkommen":
                    return m.werte
        return None

    def kern_pid(self) -> int | None:
        """Prozess, der den UDP-Port des Kerns hält (/proc/net/udp und /proc/<pid>/fd)."""
        hexport = f"{self.kern[1]:04X}"
        inodes = set()
        for datei in ("/proc/net/udp", "/proc/net/udp6"):
            try:
                zeilen = Path(datei).read_text().splitlines()[1:]
            except OSError:
                continue
            for z in zeilen:
                sp = z.split()
                if len(sp) > 9 and sp[1].rsplit(":", 1)[1] == hexport:
                    inodes.add(f"socket:[{sp[9]}]")
        for pid in (d for d in os.listdir("/proc") if d.isdigit()):
            try:
                for fd in os.listdir(f"/proc/{pid}/fd"):
                    if os.readlink(f"/proc/{pid}/fd/{fd}") in inodes:
                        return int(pid)
            except OSError:
                continue
        return None

    def port_frei(self) -> bool:
        hexport = f"{self.kern[1]:04X}"
        for datei in ("/proc/net/udp", "/proc/net/udp6"):
            try:
                if any(z.split()[1].rsplit(":", 1)[1] == hexport for z in Path(datei).read_text().splitlines()[1:]):
                    return False
            except OSError:
                continue
        return True

    def kill9_und_neustart(self) -> str:
        """aktion kern_kill9 (FORMAT.md Punkt 16): SIGKILL an den Kern, Neustart mit derselben Befehlszeile, derselben
        Umgebung und demselben Arbeitsordner, ohne --frisch (Fortsetzen auf dem Anker, §6.3). Rückgabe: Fehlertext
        oder leer."""
        pid = self.kern_pid()
        if pid is None:
            return f"kein Prozess hält den Kern-Port {self.kern[1]}"
        if pid == os.getpid():
            return "der Kern läuft im Prozess des Läufers, kill -9 nicht möglich"
        try:
            argv = [a.decode() for a in Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0") if a]
            umgebung = dict(e.decode(errors="replace").split("=", 1)
                            for e in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0") if b"=" in e)
            ordner = os.readlink(f"/proc/{pid}/cwd")
        except OSError as e:
            return f"Befehlszeile des Kerns (pid {pid}) nicht lesbar: {e}"
        os.kill(pid, signal.SIGKILL)
        ende = time.monotonic() + 2.0
        while not self.port_frei() and time.monotonic() < ende:
            time.sleep(0.001)
        if not self.port_frei():
            return f"Kern-Port {self.kern[1]} nach kill -9 (pid {pid}) nach 2 s nicht frei"
        argv = [a for a in argv if a != "--frisch"]
        self.kinder.append(subprocess.Popen(argv, cwd=ordner, env=umgebung, stdin=subprocess.DEVNULL,
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        return ""

    def schliesse(self) -> None:
        try:
            self.schicke("/k/tschuess", ",s", [self.name])
        finally:
            self.sock.close()
            for k in self.kinder:   # neu gestartete Kerne gehören dem Läufer: keine Waisen, Port frei
                if k.poll() is None:
                    k.terminate()
                    try:
                        k.wait(5)
                    except subprocess.TimeoutExpired:
                        k.kill()
                        k.wait()
            if self.protokoll:
                self.protokoll.close()


def letztes_sample(zeilen: list[dict]) -> float:
    return max([0.0] + [float(z[k]) for z in zeilen for k in ("sample", "bis_sample") if isinstance(z.get(k), (int, float))])


class Lauf:
    """Eine Folge gegen einen verbundenen Kern."""

    def __init__(self, kern: Kern, felder: dict[str, list[str]]):
        self.k = kern
        self.felder = felder
        self.basis = time.monotonic_ns()
        self.ids: set[int] = set()
        self.schritte: list[dict] = []
        self.beobachtet: list[Nachricht] = []

    def warte_bis(self, sample: float, frist_s: float = 900.0) -> bool:
        ende = time.monotonic() + frist_s
        while time.monotonic() < ende:
            self.k.pumpe()
            jetzt = self.k.sample_jetzt()
            if jetzt is not None and jetzt >= sample:
                return True
            if self.k.uhr is not None and time.monotonic_ns() - self.k.uhr_zuletzt_ns > STUMM_NS:
                return False
        return False

    def set_neu(self, osc: list) -> tuple[bool, str]:
        """Punkt 2: neue Zeitachse; alles vor ihrer Quittung gestartet gehört zur alten."""
        kennung = int(osc[2])
        self.ids.add(kennung)
        self.k.pumpe()
        self.k.eingang.clear()
        self.k.deck.clear()
        self.k.set_neu = kennung
        self.k.schicke(osc[0], osc[1], osc[2:])
        ende = time.monotonic() + 2.0
        while time.monotonic() < ende:
            self.k.pumpe()
            if self.k.set_neu is None:
                while self.k.uhr is None and time.monotonic() < ende:
                    self.k.pumpe()
                return (self.k.uhr is not None), ("" if self.k.uhr else "kein /uhr nach /k/set/neu")
            eigene = [m for m in self.k.eingang if m.adresse == "/q" and m.werte[0] == kennung]
            if any(m.werte[2] >= 4 for m in eigene):
                self.k.set_neu = None
                return False, f"/k/set/neu: Quittung {[m.werte[2] for m in eigene]}, Grund {eigene[-1].werte[5]!r}"
        self.k.set_neu = None
        return False, "keine Quittung gestartet für /k/set/neu in 2 s"

    def handle(self, z: dict) -> tuple[bool, str]:
        t = z["t"]
        if t == "sende":
            osc = mit_basis(z["osc"], self.felder, self.basis)
            if osc[0] == "/k/set/neu":
                return self.set_neu(osc)
            if not self.warte_bis(z["sample"]):
                return False, f"Kern-Uhr erreicht Sample {z['sample']} nicht"
            if osc[1].startswith(",h") and len(osc) > 2 and osc[2] is not None:
                self.ids.add(int(osc[2]))
            self.k.schicke(osc[0], osc[1], osc[2:])
        elif t == "buendel":
            if not self.warte_bis(z["sample"]):
                return False, f"Kern-Uhr erreicht Sample {z['sample']} nicht"
            self.k.schicke_roh(kodiere_buendel([mit_basis(n, self.felder, self.basis) for n in z["nachrichten"]]))
        elif t == "hand":
            if not self.warte_bis(z["sample"] - HAND_VORLAUF):
                return False, "Kern-Uhr erreicht das Hand-Sample nicht"
            self.k.schicke("/test/hand", ",sfh", [z["pfad"], z["midi_roh"], z["sample"]])
        elif t == "aktion":
            if z.get("was") != "kern_kill9":
                return False, f"aktion {z.get('was')!r} unbekannt (FORMAT.md Punkt 16: heute nur kern_kill9)"
            if not self.warte_bis(z["sample"]):
                return False, f"Kern-Uhr erreicht Sample {z['sample']} nicht"
            fehler = self.k.kill9_und_neustart()
            if fehler:
                return False, fehler
        return True, ""

    def wert_bei(self, pfad: str, sample: float):
        r = sorted(((float(m.werte[3]), m.werte[1]) for m in self.beobachtet
                    if m.adresse == "/e/regler" and m.werte[0] == pfad), key=lambda x: x[0])
        if not r or r[0][0] > sample:
            return VORGABE.get(pfad)   # nie oder erst später gemeldet: Vorgabe aus §1.5 (B6)
        return wert_aus_reihe(r, sample)

    def deck_bei(self, deck: int, feld: str, sample: float):
        r = sorted(self.k.deck.get((deck, feld), []), key=lambda x: x[0])
        if feld == "status":
            vor = [w for s, w in r if s <= sample]
            return vor[-1] if vor else None
        return wert_aus_reihe(r, sample, fortlaufend=(feld == "quell_beat"))

    def fahre(self, zeilen: list[tuple[int, dict]]) -> bool:
        aktiv = [(nr, z) for nr, z in zeilen if z.get("bereich") not in BEREICHE_AUS]
        for nr, z in aktiv:
            if z.get("t") not in HANDLUNGEN + PRUEFUNGEN:
                self.schritte.append({"zeile": nr, "t": z.get("t"), "ok": False,
                                      "info": f"unbekannte Schritt-Art {z.get('t')!r}"})
                return False
        # Handlungen in Dateireihenfolge, jede zu ihrem Sample (Punkt 3, 5, 15); Prüfungen halten nichts auf (B7)
        for nr, z in aktiv:
            if z["t"] in HANDLUNGEN:
                ok, info = self.handle(z)
                if not ok:
                    self.schritte.append({"zeile": nr, "t": z["t"], "ok": False, "info": info})
                    return False
        if aktiv:
            ende = letztes_sample([z for _, z in aktiv]) + NACHLAUF
            if not self.warte_bis(ende, frist_s=ende / RATE + 60):
                self.schritte.append({"zeile": None, "t": "ende", "ok": False,
                                      "info": f"Kern stumm oder Uhr erreicht Sample {ende:.0f} nicht"})
                return False
            self.k.pumpe()
        self.beobachtet = list(self.k.eingang)
        return self.urteile(zeilen)

    def urteile(self, zeilen: list[tuple[int, dict]]) -> bool:
        """folgen_vergleich.pruefe über die ganze Beobachtung; übersprungene Zeilen (Punkt 14) werden wirkungslos."""
        folge = [({"t": "ausgelassen"} if z.get("bereich") in BEREICHE_AUS else z) for _, z in zeilen]
        beob = [{"sample": m.sample, "osc": ohne_basis([m.adresse, m.typen] + list(m.werte), self.felder, self.basis)}
                for m in self.beobachtet]
        befunde = fv.pruefe(folge, beob, self.wert_bei, self.deck_bei, lambda name, s: None)
        je: dict[int, list[str]] = {}
        for n, art, text in befunde:
            je.setdefault(n, []).append(f"{art}: {text}")
        for i, (nr, z) in enumerate(zeilen, 1):
            if z.get("bereich") in BEREICHE_AUS:
                self.schritte.append({"zeile": nr, "t": z.get("t"), "ok": True, "info": "übersprungen (Punkt 14)"})
            elif i in je:
                info = "; ".join(je[i])
                if z["t"] in ("erwarte",):
                    info = f"bis Sample {z['bis_sample']} nicht gekommen: {info}"
                self.schritte.append({"zeile": nr, "t": z["t"], "ok": False, "info": info[:2000]})
            else:
                self.schritte.append({"zeile": nr, "t": z.get("t"), "ok": True, "info": ""})
        if 0 in je:
            self.schritte.append({"zeile": None, "t": "ende", "ok": False,
                                  "info": ("unverbraucht: " + "; ".join(je[0]))[:2000]})
        return not befunde

    def quittungen(self) -> dict[str, list[int]]:
        je: dict[str, list[int]] = {}
        for m in self.beobachtet or self.k.eingang:
            if m.adresse == "/q" and m.werte[0] in self.ids:
                je.setdefault(str(m.werte[0] - self.basis), []).append(m.werte[2])
        return je


def lies_folge(pfad: str) -> list[tuple[int, dict]]:
    with open(pfad, encoding="utf-8") as f:
        return [(nr, json.loads(z)) for nr, z in enumerate(f, 1) if z.strip()]


def main(argv: list[str] | None = None) -> int:
    k = instanz_k()
    ap = argparse.ArgumentParser(description="Leitstand-Attrappe: Golden-Folgen gegen den Kern (§19.2)")
    ap.add_argument("folgen", nargs="+")
    ap.add_argument("--kern-port", type=int, default=47100 + 1000 * k)
    ap.add_argument("--port", type=int, default=47140 + 1000 * k, help="eigener Port (Vorgabe: Prüfstand)")
    ap.add_argument("--name", default="pruefstand")
    ap.add_argument("--osc-json", default=str(HIER / "osc.json"))
    ap.add_argument("--bericht")
    ap.add_argument("--protokoll", help="jede empfangene Nachricht als JSON-Zeile (auch /uhr)")
    a = ap.parse_args(argv)
    felder = lade_feldnamen(Path(a.osc_json))
    bericht, alle_gruen = [], True
    kern = Kern(a.kern_port, a.port, a.name, Path(a.protokoll) if a.protokoll else None, felder)
    try:
        if kern.verbinde() is None:
            print(f"kein /k/willkommen vom Kern auf Port {a.kern_port}", file=sys.stderr)
            return 2
        for pfad in a.folgen:
            lauf = Lauf(kern, felder)
            t0 = time.monotonic()
            gruen = lauf.fahre(lies_folge(pfad))
            alle_gruen &= gruen
            rot = [s for s in lauf.schritte if not s["ok"]]
            print(("GRÜN " if gruen else "ROT  ") + f"{os.path.basename(pfad)}: {len(lauf.schritte)} Schritte"
                  + ("" if gruen else f", Zeile {rot[0]['zeile']}: {rot[0]['info'][:400]}"
                     + (f" (+{len(rot) - 1})" if len(rot) > 1 else "")), flush=True)
            bericht.append({"folge": pfad, "gruen": gruen, "dauer_s": round(time.monotonic() - t0, 3),
                            "schritte": lauf.schritte, "quittungen": lauf.quittungen()})
    finally:
        kern.schliesse()
    if a.bericht:
        Path(a.bericht).write_text(json.dumps(bericht, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0 if alle_gruen else 1


if __name__ == "__main__":
    sys.exit(main())
