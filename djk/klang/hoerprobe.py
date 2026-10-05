"""Hoerprobe-Server: Proben server-seitig ueber die Master-Senke vorhoeren, Kandidaten auswaehlen.

Aufruf: werkstatt/.venv/bin/python -m klang.hoerprobe --proben <ordner> [--port 8811] [--senke ...]
Nur 127.0.0.1. Pfade kommen ausschliesslich aus index.json, nie aus dem Request.
"""
import argparse
import ctypes
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SENKE = "alsa_output.pci-0000_16_00.6.iec958-stereo"
MAX_JE_ROLLE = 8
SEITE = Path(__file__).with_name("hoerprobe.html")


MAX_BODY = 65536
PR_SET_PDEATHSIG = 1


def _pdeathsig():
    """Kind stirbt mit SIGKILL, wenn der Server stirbt (auch bei SIGKILL des Servers).

    Gilt relativ zum erzeugenden Thread, darum laeuft der Server bewusst single-threaded
    (HTTPServer): der Thread, der den Player startet, lebt so lange wie der Server."""
    ctypes.CDLL("libc.so.6", use_errno=True).prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)


def _popen(argv):
    return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, preexec_fn=_pdeathsig)


def pruefe_senke(name, run=subprocess.run):
    """True, wenn `pactl list short sinks` die Senke `name` fuehrt (2. Spalte)."""
    try:
        r = run(["pactl", "list", "short", "sinks"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return False
    if r.returncode != 0:
        return False
    return any(len(z.split("\t")) > 1 and z.split("\t")[1] == name for z in r.stdout.splitlines())


class Hoerprobe:
    def __init__(self, proben, senke=SENKE, player=_popen, port=8811):
        self.proben = Path(proben)
        self.senke = senke
        self.player = player
        self.port = port
        self._index_pfad = self.proben / "index.json"
        self._index_stempel = None
        self.index = {}
        self.version = ""
        self._lade_index()
        self._auswahl_pfad = self.proben / "auswahl.json"
        self.auswahl = self._lade_auswahl()
        self._lock = threading.Lock()
        self._proc = None
        self.httpd = None

    # -- Logik ---------------------------------------------------------
    def _lade_index(self):
        """index.json (neu) lesen, wenn sich mtime/Groesse geaendert haben. Fehler: alter Stand bleibt."""
        try:
            st = self._index_pfad.stat()
            stempel = (st.st_mtime_ns, st.st_size)
            if stempel == self._index_stempel:
                return
            roh = self._index_pfad.read_bytes()
            neu = json.loads(roh)
            if not isinstance(neu, dict):
                raise ValueError("index.json ist kein Objekt")
        except (OSError, ValueError) as e:
            if self._index_stempel is None:
                raise
            print(f"hoerprobe: index.json nicht lesbar, alter Stand bleibt: {e}", file=sys.stderr)
            return
        self.index, self._index_stempel = neu, stempel
        self.version = hashlib.sha256(roh).hexdigest()[:12]

    def _lade_auswahl(self):
        try:
            text = self._auswahl_pfad.read_text()
        except FileNotFoundError:
            return {}
        except OSError as e:
            print(f"hoerprobe: auswahl.json nicht lesbar: {e}", file=sys.stderr)
            raise
        try:
            d = json.loads(text)
            if not isinstance(d, dict) or not all(
                    isinstance(v, list) and all(isinstance(q, str) for q in v) for v in d.values()):
                raise ValueError("kein Objekt {rolle: [quelle, ...]}")
            return d
        except ValueError as e:
            ziel = self._auswahl_pfad.with_name("auswahl.json.kaputt-" + time.strftime("%Y%m%d-%H%M%S"))
            self._auswahl_pfad.replace(ziel)
            print(f"hoerprobe: WARNUNG auswahl.json kaputt ({e}), gesichert nach {ziel}, starte leer",
                  file=sys.stderr)
            return {}

    def finde(self, rolle, nr, kontext=False):
        """Eintrag aus dem Index oder None. Rolle/nr nur als Schluessel, nie als Pfad."""
        self._lade_index()
        if not isinstance(rolle, str) or isinstance(nr, bool) or not isinstance(nr, int):
            return None
        for e in self.index.get(rolle, []):
            if isinstance(e, dict) and e.get("nr") == nr and bool(e.get("kontext")) == bool(kontext):
                return e
        return None

    def stoppe(self):
        with self._lock:
            self._stoppe_unlocked()

    def _stoppe_unlocked(self):
        p, self._proc = self._proc, None
        if p is None or p.poll() is not None:
            return
        p.terminate()
        try:
            p.wait(1)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()

    def entferne(self, rolle, quelle):
        """Quelle aus der Auswahl streichen (nur was in auswahl.json steht). False, wenn nicht vorhanden."""
        with self._lock:
            liste = self.auswahl.get(rolle)
            if not isinstance(liste, list) or quelle not in liste:
                return False
            neu = dict(self.auswahl)
            neu[rolle] = [q for q in liste if q != quelle]
            self._schreibe_auswahl(neu)
            return True

    def _schreibe_auswahl(self, neu):
        tmp = self._auswahl_pfad.with_suffix(".tmp")
        tmp.write_text(json.dumps(neu, indent=1, ensure_ascii=False))
        tmp.replace(self._auswahl_pfad)
        self.auswahl = neu

    def spiele(self, e):
        with self._lock:
            self._stoppe_unlocked()
            self._proc = self.player(["pw-play", "--target", self.senke, e["pfad"]])

    def waehle(self, e, rolle, an):
        with self._lock:
            liste = list(self.auswahl.get(rolle, []))
            q = e["quelle"]
            if an and q not in liste:
                if len(liste) >= MAX_JE_ROLLE:
                    return False
                liste.append(q)
            elif not an and q in liste:
                liste.remove(q)
            neu = dict(self.auswahl)
            neu[rolle] = liste
            self._schreibe_auswahl(neu)
            return True

    # -- Server --------------------------------------------------------
    def start(self):
        app = self

        class H(BaseHTTPRequestHandler):
            timeout = 10

            def log_message(self, *a):
                pass

            def _send(self, code, body=b"", typ="application/json"):
                self.send_response(code)
                self.send_header("Content-Type", typ)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _json(self, code, obj):
                self._send(code, json.dumps(obj).encode())

            def do_GET(self):
                if self.path == "/":
                    self._send(200, SEITE.read_bytes(), "text/html; charset=utf-8")
                elif self.path == "/index":
                    app._lade_index()
                    self._json(200, {"index": app.index, "auswahl": app.auswahl, "version": app.version})
                elif self.path == "/favicon.ico":
                    self._send(204)
                else:
                    self._send(404)

            def do_POST(self):
                try:
                    self._post()
                except Exception as e:  # nie ohne Antwort abbrechen
                    print(f"hoerprobe: Fehler bei {self.path}: {e!r}", file=sys.stderr)
                    try:
                        self._json(500, {"fehler": "intern"})
                    except OSError:
                        pass

            def _post(self):
                try:
                    n = int(self.headers["Content-Length"])
                    if n < 0 or n > MAX_BODY:
                        raise ValueError
                    d = json.loads(self.rfile.read(n) or b"{}")
                    if not isinstance(d, dict):
                        raise ValueError
                except (ValueError, TypeError, KeyError):
                    return self._json(400, {"fehler": "body"})
                if self.path == "/stop":
                    app.stoppe()
                    return self._json(200, {"ok": True})
                if self.path == "/entferne":
                    q = d.get("quelle")
                    if not isinstance(d.get("rolle"), str) or not isinstance(q, str) \
                            or not app.entferne(d["rolle"], q):
                        return self._json(404, {"fehler": "nicht in der Auswahl"})
                    return self._json(200, {"auswahl": app.auswahl})
                if self.path not in ("/play", "/waehle"):
                    return self._send(404)
                app._lade_index()
                if d.get("version") != app.version:
                    return self._json(409, {"fehler": "index_geaendert"})
                e = app.finde(d.get("rolle"), d.get("nr"),
                              d.get("kontext") is True and self.path == "/play")
                if e is None:
                    return self._json(404, {"fehler": "unbekannt"})
                if self.path == "/play":
                    app.spiele(e)
                    return self._json(200, {"ok": True})
                if not app.waehle(e, d["rolle"], d.get("an") is True):
                    return self._json(409, {"fehler": f"max {MAX_JE_ROLLE}"})
                self._json(200, {"auswahl": app.auswahl})

        self.httpd = HTTPServer(("127.0.0.1", self.port), H)
        self.port = self.httpd.server_address[1]
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        self.stoppe()
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()


def main(argv=None, player=_popen, senke_pruefer=pruefe_senke):
    ap = argparse.ArgumentParser(description="Hoerprobe-Server")
    ap.add_argument("--proben", required=True)
    ap.add_argument("--port", type=int, default=8811)
    ap.add_argument("--senke", default=SENKE)
    a = ap.parse_args(argv)
    if not senke_pruefer(a.senke):
        print(f"hoerprobe: Senke '{a.senke}' nicht in `pactl list short sinks` - pw-play koennte auf die "
              "Standardsenke ausweichen. Abbruch.", file=sys.stderr)
        return 2
    h = Hoerprobe(a.proben, a.senke, player=player, port=a.port)
    ende = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, lambda *_: ende.set())
    h.start()
    print(f"http://127.0.0.1:{h.port}/  senke={a.senke}", flush=True)
    ende.wait()
    h.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
