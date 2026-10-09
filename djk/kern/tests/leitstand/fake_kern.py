"""Kleiner Schein-Kern für die Tests der Leitstand-Attrappe (Scheibe 08): spricht §4.1, §4.2 und §5.1 bis §5.3 über
UDP in Echtzeit (Blöcke zu 256 bei 48 kHz), Tempo-Karte aus djk/vertrag/karte.py (Scheibe 02). Kein Ton.
Fehlerarten für die Fehlerfälle des Läufers: ohne_fertig, extra_ablehnung, set_neu_stumm, bpm_daneben, uhr_pause
(ab Sample 48 000 für 0,5 s Wanduhr kein Block, zählt die /k/hallo in der Pause).
Zusätze für die Schritt-Arten von 09 (FORMAT.md Punkt 16): Bündel an /erz/fenster beantwortet er mit /erz/quittung;
Arten deck (/zustand/deck für Deck 1 und /zustand/box für Box 1 alle 4 Blöcke, quell_beat = Beat der Kern-Uhr), regler (/e/regler deck/2/fader:
-200 bei 48 128, Sprung auf -15 bei 96 000, dann Rampe bis 0 bei 144 000 im Takt von 960 Samples), extra_invariante
(/e/invariante hoerschein beim Rampenstart), ohne_neustart (nach dem Neustart weder neue Generation noch /e/neustart).
Als eigener Prozess (python3 fake_kern.py --port P --zustand DATEI [--frisch] [--fehler F]) übersteht er kill -9:
ohne --frisch setzt er auf dem gespeicherten Anker fort, Generation + 1, /e/neustart an die gespeicherten Abonnenten."""
from __future__ import annotations

import argparse
import json
import math
import os
import socket
import struct
import sys
import threading
import time
from pathlib import Path

DJK = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DJK / "vertrag"))
from attrappe_leitstand import kodiere, zerlege  # noqa: E402
from karte import Karte, ziel_sample  # noqa: E402

N = 256


REGLER_PLAN = [(48128, -200.0)] + [(96000 + 960 * j, -15.0 + 0.3 * j) for j in range(51)]


class FakeKern:
    def __init__(self, fehler: str = "", port: int = 0, zustand: str | None = None, frisch: bool = True):
        self.fehler = fehler
        self.zustand = zustand
        self.generation = 0
        self.gespeicherte_abos: dict[str, int] = {}
        self.buendel: list[tuple[int, list]] = []
        self.empfangen: list[tuple[str, int]] = []   # (Adresse, Kern-Sample beim Eintreffen)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", port))
        self.sock.settimeout(0.001)
        self.port = self.sock.getsockname()[1]
        self.abos: dict[str, int] = {}
        self.karte = Karte(128.0)
        self.sample = 0
        self.rampen: list[dict] = []
        self.ids: list[int] = []
        self.hallos = 0
        self.hallos_in_pause = 0
        self.pause_bis = 0.0
        self.stop = False
        self.faden = threading.Thread(target=self.lauf, daemon=True)
        if zustand and not frisch and os.path.exists(zustand):
            z = json.loads(Path(zustand).read_text())
            vergangen = (time.monotonic_ns() - z["mono_ns"]) * 48000 / 1e9
            self.sample = z["sample"] + N * math.ceil(vergangen / N)   # auf dem Anker weiter (§6.3)
            if fehler != "ohne_neustart":
                self.generation = z["generation"] + 1
                self.gespeicherte_abos = z["abos"]

    def speichere(self):
        if self.zustand:
            neu = self.zustand + ".neu"
            Path(neu).write_text(json.dumps({"generation": self.generation, "sample": self.sample,
                                             "mono_ns": time.monotonic_ns(), "abos": self.abos}))
            os.replace(neu, self.zustand)

    def __enter__(self):
        self.faden.start()
        return self

    def __exit__(self, *a):
        self.stop = True
        self.faden.join()
        self.sock.close()

    def an_alle(self, adresse, typen, werte):
        p = kodiere(adresse, typen, werte)
        for port in self.abos.values():
            self.sock.sendto(p, ("127.0.0.1", port))

    def q(self, kennung, quelle, status, s, b, grund=""):
        self.an_alle("/q", ",hsihds", [kennung, quelle, status, s, b, grund])

    def paket(self, p):
        if p.startswith(b"#bundle\0"):
            return self.buendel_an(p)
        adresse, typen, w = zerlege(p)
        self.empfangen.append((adresse, self.sample))
        if adresse == "/k/hallo" and typen == ",sii":
            self.hallos += 1
            if time.monotonic() < self.pause_bis:
                self.hallos_in_pause += 1
            neu = w[0] not in self.abos
            self.abos[w[0]] = w[1]
            if neu:
                self.sock.sendto(kodiere("/k/willkommen", ",iihdds", [1, self.generation, self.sample, 0.0, 128.0, "fake"]),
                                 ("127.0.0.1", w[1]))
        elif adresse == "/k/tschuess":
            self.abos.pop(w[0], None)
        elif adresse == "/k/set/neu" and typen == ",hsd":
            self.ids.append(w[0])
            self.karte = Karte(w[2])
            self.sample = 0
            self.rampen = []
            self.q(w[0], w[1], 1, 0, 0.0)
            if self.fehler != "set_neu_stumm":
                self.q(w[0], w[1], 2, 0, 0.0)
        elif adresse == "/k/tempo/rampe" and typen == ",hsddd":
            self.ids.append(w[0])
            self.karte.rampe(w[2], w[3], w[4])
            self.rampen.append({"id": w[0], "quelle": w[1], "start": ziel_sample(self.karte, w[2]),
                                "ende": ziel_sample(self.karte, w[2] + w[4]), "gestartet": False})
            self.q(w[0], w[1], 1, self.sample, self.karte.beat(self.sample))
            if self.fehler == "extra_ablehnung":
                self.q(w[0], w[1], 6, self.sample, 0.0, "karte_voll")
        else:
            self.an_alle("/e/protokollfehler", ",ss", [adresse, "unbekannte_adresse"])

    def buendel_an(self, p):
        """§4.8: Bündel mit /erz/fenster und /erz/ev; Antwort /erz/quittung mit eingefuegt = Zahl der Ereignisse."""
        zeitmarke = struct.unpack_from(">Q", p, 8)[0]
        o, elemente = 16, []
        while o < len(p):
            n = struct.unpack_from(">i", p, o)[0]
            elemente.append(zerlege(p[o + 4:o + 4 + n]))
            o += 4 + n
        self.buendel.append((zeitmarke, elemente))
        fenster = [w for a, _, w in elemente if a == "/erz/fenster"]
        ev = sum(1 for a, _, _ in elemente if a == "/erz/ev")
        if fenster:
            self.an_alle("/erz/quittung", ",iiiiiii", [fenster[0][0], fenster[0][1], 0, 0, ev, 0, 0])

    def block(self):
        n0 = self.sample
        mono = time.monotonic_ns()
        for r in list(self.rampen):
            if not r["gestartet"] and r["start"] < n0 + N:
                r["gestartet"] = True
                self.q(r["id"], r["quelle"], 2, r["start"], self.karte.beat(r["start"]))
                if self.fehler == "extra_invariante":
                    self.an_alle("/e/invariante", ",ssihd", ["hoerschein", "", 0, r["start"], self.karte.beat(r["start"])])
            if r["gestartet"] and r["ende"] < n0 + N:
                if self.fehler != "ohne_fertig":
                    self.q(r["id"], r["quelle"], 3, r["ende"], self.karte.beat(r["ende"]))
                self.rampen.remove(r)
        self.an_alle("/uhr", ",hhddd", [n0, mono, self.karte.beat(n0), self.karte.bpm(n0), self.karte.k(n0)])
        if self.fehler == "regler":
            for s, w in REGLER_PLAN:
                if n0 <= s < n0 + N:
                    self.an_alle("/e/regler", ",sfshd", ["deck/2/fader", w, "cypher", s, self.karte.beat(s)])
        if self.fehler == "deck" and (n0 // N) % 4 == 0:
            qb = self.karte.beat(n0)
            self.an_alle("/zustand/deck", ",iisdidddfiifii", [1, 2, "f0000000000000a1", 128.0, 1, qb, 100.0 - qb, 1.0,
                                                              0.0, 0, 0, 0.0, 0, 0])  # Keylock Task 3: Zähler
            self.an_alle("/zustand/box", ",iiiiii", [1, 3, 0, 0, 0, 0])  # Keylock 7b.3/7c.3 (§5.5b): Zähler der Box 1
        b = 4.0 * math.ceil(self.karte.beat(max(n0 - 0.5, 0.0)) / 4.0)  # karte.py kennt keine Samples vor 0
        while True:
            s = ziel_sample(self.karte, b)
            if s >= n0 + N:
                break
            if s >= n0:
                bpm = self.karte.bpm(self.karte.sample(b)) + (2e-6 if self.fehler == "bpm_daneben" else 0.0)
                self.an_alle("/takt", ",iihdd", [int(b // 4) + 1, int(b // 32) + 1, s, b, bpm])
            b += 4.0
        self.sample = n0 + N
        if self.zustand and (n0 // N) % 16 == 0:
            self.speichere()

    def lauf(self):
        t0 = time.monotonic()
        k = 0
        for name, port in self.gespeicherte_abos.items():   # §4.1: erste Nachricht der neuen Generation
            self.sock.sendto(kodiere("/e/neustart", ",ih", [self.generation, self.sample]), ("127.0.0.1", port))
        while not self.stop:
            try:
                while True:
                    self.paket(self.sock.recv(2048))
            except (socket.timeout, BlockingIOError):
                pass
            if self.fehler == "uhr_pause" and self.sample == 48128 and self.pause_bis == 0.0:
                self.pause_bis = time.monotonic() + 0.5
            if time.monotonic() < self.pause_bis:
                t0 = time.monotonic() - k * N / 48000  # nach der Pause ohne Aufholen weiter
                continue
            if time.monotonic() >= t0 + k * N / 48000:
                self.block()
                k += 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--zustand", required=True)
    ap.add_argument("--fehler", default="")
    ap.add_argument("--frisch", action="store_true")
    a = ap.parse_args()
    k = FakeKern(a.fehler, a.port, a.zustand, a.frisch)
    print(f"port={k.port}", flush=True)
    k.lauf()
