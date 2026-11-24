"""Tour runner for the release journeys (journey tours plan, task 1).

One place for what every tour needs: a test instance of its own (`Instanz`), calls to the page (`Tour.ruf`), the hand MCP server
(`Hand`), waiting on state, the master level, the core's xrun counter (`XrunZaehler`), the check of a written file and the report
(`Bericht`). The pieces of `djk/tools/dauerlauf.py` are imported, not copied: instance ports, the core subscriber, the
minute counter, the level reader and the real-time lock path.

A tour never raises into its caller for a refusal of the page: `ruf` answers code and reason, a step that goes wrong is a red
step, and the report is written whatever happened.
"""
import contextlib
import json
import math
import os
import re
import select
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))
sys.path.insert(0, os.path.join(HIER, "..", "..", "core", "tests", "restart"))
import dauerlauf  # noqa: E402

DJK = dauerlauf.DJK
ERLAUBT = "bcdef"                      # the tours' instances; a, g, h, i belong to others (gate, reviewers, the owner's checks)
STUMM_DB = -60.0                       # silent: master below this over the phase
DC_GRENZE = 0.01                       # absolute mean above this on any channel
STANDARD_STUFEN = ["graphen", "kits", "loops", "demo"]   # never bibliothek unless asked: J0 starts with an empty library
LAGE_FRIST_S = 90
STILLE_FENSTER_S = 0.05               # window of the silence scan in pruefe_datei
LIVE_URL = "http://127.0.0.1:47300"   # the live studio: read only, one GET /pegel
URTEIL_REIHE = ("OK", "FEHL", "SKIP")


# ---------------------------------------------------------------- answers

@dataclass
class Antwort:
    code: int
    j: object = None
    roh: bytes = b""

    @property
    def grund(self):
        """`j.grund ?? j.fehler`; a call that never got an answer says so."""
        if isinstance(self.j, dict):
            g = self.j.get("grund")
            return g if g is not None else self.j.get("fehler")
        if self.code == 0:
            return "keine_verbindung"
        return None

    @property
    def ok(self):
        return dauerlauf.antwort_ok(self.code, self.j)


def _http(url, methode, daten, kopf, timeout):
    req = urllib.request.Request(url, data=daten, method=methode, headers=kopf)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            code, roh = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, roh = e.code, e.read()
    except Exception:  # noqa: BLE001 - refused connection, timeout, reset: one failed call, the step decides
        return Antwort(0, None, b"")
    try:
        return Antwort(code, json.loads(roh), roh)
    except ValueError:
        return Antwort(code, None, roh)


# ---------------------------------------------------------------- instance

def live_laut(url=LIVE_URL):
    """True when the master of the live studio is above -60 dB (one read-only GET /pegel; unreadable counts as quiet). Tours that make sound check this first."""
    a = _http(url + "/pegel?sek=1", "GET", None, {}, 5)
    db = dauerlauf.master_db(a.j) if a.code == 200 else None
    return db is not None and db > STUMM_DB


class Instanz:
    """A test instance b..f: starts it the way the dauerlauf does, with its own folders, and stops it again."""

    def __init__(self, buchstabe, optionen=None, stufen=None, env=None):
        if not isinstance(buchstabe, str) or len(buchstabe) != 1 or buchstabe not in ERLAUBT:
            raise ValueError(f"tour instances are b to f, got {buchstabe!r}")
        self.buchstabe = buchstabe
        self.optionen = list(optionen or [])
        self.stufen = list(stufen) if stufen is not None else list(STANDARD_STUFEN)
        self.url = f"http://127.0.0.1:{dauerlauf.seiten_port(buchstabe)}"
        self.kern_port = dauerlauf.kern_port(buchstabe)
        self.shm = f"/dev/shm/cypherdj-{buchstabe}"
        b = f"{self.shm}/bibliothek"
        self.kit_ordner = f"{self.shm}/tour/kits"
        self.env = dict(os.environ, DJK=DJK, CYPHERDJ_INSTANZ=buchstabe,
                        CYPHERDJ_KATALOG=f"{b}/katalog.sqlite", CYPHERDJ_BIBLIOTHEK_KONFIG=f"{b}/bibliothek.json",
                        CYPHERDJ_BIBLIOTHEK_CACHE=f"{b}/merkmale.sqlite", CYPHERDJ_HEIM=f"{b}/heimat",
                        CYPHERDJ_KIT_ORDNER=self.kit_ordner, CYPHERDJ_BK_ORDNER=f"{self.shm}/tour/baukasten",
                        CYPHERDJ_IMPORTE=f"{self.shm}/importe")
        # Everything a test instance could otherwise take from the owner's own folders: the page server falls back to them when the variable is
        # unset (mediathek, sampler cuts, own sounds, loop sets, analysis, reference curves, module store). The mediathek is a file that does not
        # exist: its routes answer 503 mediathek_fehlt, nothing reads the owner's database.
        iso = f"{self.shm}/tour/iso"
        self.iso_ordner = [f"{iso}/{n}" for n in ("sampler", "klaenge", "loopsets", "analyse", "referenzen", "module", "mediathek")]
        self.env.update(CYPHERDJ_MEDIATHEK=f"{iso}/mediathek/mediathek.sqlite", CYPHERDJ_ANALYSE=f"{iso}/analyse", CYPHERDJ_SAMPLER=f"{iso}/sampler",
                        CYPHERDJ_KLAENGE=f"{iso}/klaenge", CYPHERDJ_LOOPSETS=f"{iso}/loopsets", CYPHERDJ_REFERENZEN=f"{iso}/referenzen",
                        CYPHERDJ_MODULE=f"{iso}/module")
        if env:
            self.env.update({k: str(v) for k, v in env.items()})   # the caller wins: a journey that needs its own mediathek names it here
        self.starter_rc = {}            # stage -> return code of djk-starter (4 = done with skipped steps)
        self._angelegt = []             # folders this object created, removed by stopp()
        self._gestartet = False
        self.hinweise = []              # things the report should say (a folder moved aside, ...)
        self._projekte_beiseite = None

    def _sh(self, args, timeout=600):
        return subprocess.run(args, capture_output=True, text=True, env=self.env, timeout=timeout)

    def _ordner_anlegen(self):
        for d in (f"{self.shm}/bibliothek/heimat", self.kit_ordner, self.env["CYPHERDJ_BK_ORDNER"], self.env["CYPHERDJ_IMPORTE"], *self.iso_ordner):
            fehlend = []
            p = Path(d)
            while not p.exists() and str(p) != self.shm and p != p.parent:
                fehlend.append(p)
                p = p.parent
            os.makedirs(d, exist_ok=True)
            self._angelegt.extend(fehlend[::-1][:1])   # the topmost new folder removes its children with it

    def _projekte_anlegen(self):
        """The page server keeps the projects of a test instance in /dev/shm/cypherdj-<x>/projekte and has no option for another place, so that
        name becomes a link to a folder of this run (tour/projekte): stopp() removes the link and the folder, never the instance's own folders.
        A real folder with content is renamed to projekte.vor-tour-<time> and renamed back by stopp(); nothing of it is deleted."""
        link, ziel = Path(self.shm) / "projekte", Path(self.shm) / "tour" / "projekte"
        if link.is_symlink():
            link.unlink()
        elif link.is_dir():
            if any(link.iterdir()):
                # somebody's projects from earlier runs: renamed aside (never deleted) and moved back by stopp()
                beiseite = Path(self.shm) / f"projekte.vor-tour-{time.strftime('%Y%m%d-%H%M%S')}"
                n = 1
                while beiseite.exists():
                    n += 1
                    beiseite = Path(self.shm) / f"projekte.vor-tour-{time.strftime('%Y%m%d-%H%M%S')}-{n}"
                link.rename(beiseite)
                self._projekte_beiseite = beiseite
                self.hinweise.append(f"{link} held projects: moved aside to {beiseite.name} for this run and moved back at stop")
            else:
                link.rmdir()
        ziel.mkdir(parents=True, exist_ok=True)
        link.symlink_to(ziel)
        self._projekte_unser = True

    def _projekte_raeumen(self):
        if not getattr(self, "_projekte_unser", False):
            return
        link, ziel = Path(self.shm) / "projekte", Path(self.shm) / "tour" / "projekte"
        with contextlib.suppress(OSError):
            if link.is_symlink():
                link.unlink()
        shutil.rmtree(ziel, ignore_errors=True)
        with contextlib.suppress(OSError):
            ziel.parent.rmdir()                     # tour/ goes when nothing else of the run is in it
        if self._projekte_beiseite is not None:
            if not link.exists() and not link.is_symlink():
                self._projekte_beiseite.rename(link)
                self.hinweise.append(f"{link} moved back")
            else:
                self.hinweise.append(f"{link} exists again: the earlier projects stay in {self._projekte_beiseite.name}")
            self._projekte_beiseite = None
        self._projekte_unser = False

    def start(self):
        """Refuses a running instance, starts djk-start and the starter stages, waits until /lage answers 200."""
        if dauerlauf.einheiten_aktiv(self.buchstabe):
            raise RuntimeError(f"instance {self.buchstabe} already has active units: a foreign instance is never taken over")
        self._gestartet = True
        try:
            self._ordner_anlegen()
            self._projekte_anlegen()
            z = [os.path.join(DJK, "start", "djk-start"), "--instanz", self.buchstabe]
            if "--kit-ordner" not in self.optionen:
                z += ["--kit-ordner", self.kit_ordner]
            r = self._sh(z + self.optionen)
            if r.returncode != 0:
                raise RuntimeError(f"djk-start failed (rc {r.returncode}): {(r.stderr or r.stdout).strip()[-300:]}")
            for stufe in self.stufen:
                r = self._sh([os.path.join(DJK, "start", "djk-starter"), "--instanz", self.buchstabe, "--nur", stufe])
                self.starter_rc[stufe] = r.returncode
                if r.returncode not in (0, 4):
                    raise RuntimeError(f"djk-starter {stufe} failed (rc {r.returncode}): {(r.stderr or r.stdout).strip()[-300:]}")
            ende = time.monotonic() + LAGE_FRIST_S
            while True:
                if _http(self.url + "/lage", "GET", None, {}, 5).code == 200:
                    break
                if time.monotonic() > ende:
                    raise RuntimeError(f"GET /lage of {self.url} did not answer 200 within {LAGE_FRIST_S} s")
                time.sleep(0.5)
        except BaseException:
            self.stopp()
            raise
        return self

    def stopp(self):
        """Stops the recorder unit of the instance if one runs (djk-start refuses an instance whose ring is still mapped), then the instance."""
        if not self._gestartet:
            return
        unit = f"cypherdj-setmitschnitt-{self.buchstabe}"
        try:
            if dauerlauf._sh(["systemctl", "--user", "is-active", unit]).stdout.strip() in ("active", "activating"):
                dauerlauf._sh(["systemctl", "--user", "stop", unit])
        except OSError:
            pass
        with contextlib.suppress(Exception):
            self._sh([os.path.join(DJK, "start", "djk-stop"), "--instanz", self.buchstabe], timeout=300)
        self._projekte_raeumen()
        for d in self._angelegt:
            shutil.rmtree(d, ignore_errors=True)
        self._angelegt = []
        self._gestartet = False

    def __enter__(self):
        return self.start()

    def __exit__(self, *a):
        self.stopp()


# ---------------------------------------------------------------- hand MCP

class Hand:
    """The hand MCP server over stdio, started with the registration command of djk/hand/AUFRUF.md."""

    @staticmethod
    def standardbefehl(url):
        return ["node", os.path.join(DJK, "hand", "hand.ts"), "--seite", url]

    def __init__(self, instanz, befehl=None, tour=None):
        self.tour = tour                # with a tour, a tool error inside a step turns the step red (see rufe)
        self._id = 0
        self._puffer = b""
        self.p = subprocess.Popen(befehl or self.standardbefehl(instanz.url), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, cwd=os.path.join(DJK, "hand"))
        try:
            self._anfrage("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "tour", "version": "1"}}, 30)
            self._senden({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except BaseException:
            self.ende()
            raise

    def _senden(self, obj):
        self.p.stdin.write((json.dumps(obj) + "\n").encode())
        self.p.stdin.flush()

    def _zeile(self, frist):
        fd = self.p.stdout.fileno()
        while b"\n" not in self._puffer:
            rest = frist - time.monotonic()
            if rest <= 0:
                raise RuntimeError("the hand server did not answer in time")
            r, _, _ = select.select([fd], [], [], min(rest, 0.5))
            if r:
                b = os.read(fd, 65536)
                if not b:
                    raise RuntimeError("the hand server ended")
                self._puffer += b
        z, self._puffer = self._puffer.split(b"\n", 1)
        return z

    def _anfrage(self, methode, params, timeout=120):
        self._id += 1
        mid = self._id
        self._senden({"jsonrpc": "2.0", "id": mid, "method": methode, "params": params})
        frist = time.monotonic() + timeout
        while True:
            z = self._zeile(frist)
            try:
                m = json.loads(z)
            except ValueError:
                continue
            if isinstance(m, dict) and m.get("id") == mid:
                return m

    def werkzeuge(self):
        m = self._anfrage("tools/list", {})
        return [t["name"] for t in (m.get("result") or {}).get("tools", [])]

    def rufe(self, name, argumente=None, timeout=120, erwartet=None):
        """A tool answer as a dict; a tool error is data (`_fehler: True`), never an exception. With a tour, a tool error inside a step marks
        the step red unless it is expected: `erwartet` is a set of error codes or reasons (matched against the answer's `code`, `status`, `grund` or `fehler`: the hand reports refusals such as ki_gestoppt there)."""
        r = self._rufe(name, argumente, timeout)
        if self.tour is not None and r.get("_fehler"):
            self.tour._melde(f"tool {name}", r.get("code") or r.get("rpc", {}).get("code") or 0, r.get("grund") or r.get("fehler") or (r.get("rpc") or {}).get("message"),
                             erwartet, [r.get("code"), r.get("status"), r.get("grund"), r.get("fehler")])
        return r

    def _rufe(self, name, argumente, timeout):
        m = self._anfrage("tools/call", {"name": name, "arguments": argumente or {}}, timeout)
        if "error" in m:
            return {"_fehler": True, "rpc": m["error"]}
        r = m.get("result") or {}
        text = "".join(c.get("text", "") for c in r.get("content", []) if isinstance(c, dict))
        try:
            j = json.loads(text)
        except ValueError:
            j = {"text": text}
        if not isinstance(j, dict):
            j = {"wert": j}
        return {**j, "_fehler": bool(r.get("isError"))}

    def ende(self):
        with contextlib.suppress(Exception):
            self.p.stdin.close()
        try:
            self.p.wait(3)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait(3)


# ---------------------------------------------------------------- xruns

@dataclass
class Messung:
    delta: object = None            # None when no /zustand/kern message arrived during the phase
    sek: object = None
    meldungen: int = 0
    neustarts: int = 0              # generation changes of the core seen during the phase
    grund: object = None            # "keine_meldungen" (the core sent nothing) or "neustart" (the generation changed): ok() is then False


def _ganz_zahl(x):
    return isinstance(x, int) and not isinstance(x, bool)


class XrunZaehler:
    """The core's frame_luecken delta over a phase, against an idle baseline of the same instance."""

    def __init__(self, kern_port, erste_frist_s=5.0):
        self.erste_frist_s = erste_frist_s
        self._sperre = threading.Lock()
        self._minute = dauerlauf.Minute()
        self._n = 0
        self._gen = None
        self._wechsel = 0               # generation changes seen so far
        self._basis_delta = None
        self._basis_sek = None
        self._stop = threading.Event()
        self._abo = dauerlauf.Abonnent(kern_port, self._fuettere, self._stop)
        self._abo.start()

    def _fuettere(self, adresse, felder):
        with self._sperre:
            if adresse == "/zustand/kern":
                self._n += 1
                if felder and _ganz_zahl(felder[0]):
                    if self._gen is not None and felder[0] != self._gen:
                        self._wechsel += 1
                    self._gen = felder[0]
            self._minute.fuettere(adresse, felder)

    def basis(self, sek):
        """Idle delta over `sek` seconds; raises when no /zustand/kern message arrives (then the xrun step is red, never green)."""
        ende = time.monotonic() + self.erste_frist_s
        while True:
            with self._sperre:
                if self._n > 0:
                    break
            if time.monotonic() > ende:
                raise RuntimeError("no /zustand/kern message from the core: the idle baseline cannot be measured")
            self._stop.wait(0.05)
        with self.phase() as m:
            self._stop.wait(sek)
        if m.grund == "neustart":
            raise RuntimeError("the core restarted during the idle baseline: it cannot be measured")
        self._basis_delta, self._basis_sek = m.delta, float(sek)
        return m.delta

    @contextlib.contextmanager
    def phase(self):
        m = Messung()
        with self._sperre:
            self._minute = self._minute.fortsetzung()
        t0 = time.monotonic()
        with self._sperre:
            n0, w0 = self._n, self._wechsel
        try:
            yield m
        finally:
            with self._sperre:
                m.meldungen = self._n - n0
                m.neustarts = self._wechsel - w0
                m.delta = self._minute.delta if m.meldungen > 0 else None
                m.grund = "keine_meldungen" if m.meldungen == 0 else ("neustart" if m.neustarts else None)
                self._minute = self._minute.fortsetzung()
            m.sek = time.monotonic() - t0

    def ok(self, delta, sek=None):
        """Within the baseline scaled to the phase length; without a baseline: not ok."""
        if isinstance(delta, Messung):
            if delta.grund is not None:
                return False                    # a silent core or a restart inside the phase: the delta says nothing
            sek, delta = delta.sek if sek is None else sek, delta.delta
        if self._basis_delta is None or delta is None:
            return False
        sek = self._basis_sek if sek is None else sek
        return delta <= self._basis_delta * (sek / self._basis_sek)

    def ende(self):
        self._stop.set()
        self._abo.join(timeout=5)


# ---------------------------------------------------------------- results

@dataclass
class PegelErgebnis:
    max_db: float
    median_db: float
    still: bool
    uebersteuert: bool
    proben: list = field(default_factory=list)
    lesefehler: int = 0


@dataclass
class DateiErgebnis:
    ok: bool
    gruende: list
    dauer_s: object = None
    format: object = None
    kanaele: int = 0
    spitze_db: list = field(default_factory=list)
    dc: list = field(default_factory=list)
    nan: bool = False
    stumm: bool = False
    max_stille_s: float = 0.0       # longest stretch below -60 dBFS (all channels), in 50 ms windows


class TourAbbruch(Exception):
    """A step marked pflicht went red: the tour ends here (the report is still written)."""


class _Skip(Exception):
    pass


class Bericht:
    def __init__(self, tour, instanz, start, ende, kurz, schritte, ausgabe, hinweise=None):
        self.hinweise = list(hinweise or [])
        self.tour, self.instanz, self.start, self.ende, self.kurz = tour, instanz, start, ende, kurz
        self.schritte, self.ausgabe = schritte, Path(ausgabe)

    @property
    def zusammen(self):
        z = {"ok": 0, "fehl": 0, "skip": 0}
        for s in self.schritte:
            z[s["urteil"].lower()] += 1
        return z

    def als_dict(self):
        return {"tour": self.tour, "instanz": self.instanz, "start": self.start, "ende": self.ende, "kurz": self.kurz,
                "schritte": self.schritte, "zusammen": self.zusammen, "hinweise": self.hinweise}

    def markdown(self):
        z = self.zusammen
        zeilen = [f"# Tour {self.tour} on instance {self.instanz}{' (short)' if self.kurz else ''}", "",
                  f"{z['ok']} ok, {z['fehl']} red, {z['skip']} skipped. Exit code {self.exitcode()}.", ""]
        zeilen += [f"Note: {h}" for h in self.hinweise] + ([""] if self.hinweise else [])
        for s in self.schritte:
            rest = ""
            if s["urteil"] != "OK" and s.get("grund"):
                rest = f" | {s['ruf'] + ' ' if s.get('ruf') else ''}{s.get('code') if s.get('code') is not None else ''} {s['grund']}".rstrip()
            zeilen.append(f"- {s['urteil']} `{s['kennung']}` {s['text']} ({s['sek']:.1f} s){rest}")
            for k, v in (s.get("werte") or {}).items():
                w = v if isinstance(v, str) else json.dumps(v, default=str, ensure_ascii=False)
                w = " ".join(w.split())
                zeilen.append(f"  - {k}: {w[:117] + '...' if len(w) > 120 else w}")
        return "\n".join(zeilen) + "\n"

    def schreibe(self):
        self.ausgabe.mkdir(parents=True, exist_ok=True)
        (self.ausgabe / "bericht.json").write_text(json.dumps(self.als_dict(), indent=1, default=str))
        (self.ausgabe / "bericht.md").write_text(self.markdown())

    def exitcode(self):
        """0 all green, 1 a step red, 77 nothing red but a skip caused by the live studio or a missing required dependency."""
        if any(s["urteil"] == "FEHL" for s in self.schritte):
            return 1
        if any(s["urteil"] == "SKIP" and (s.get("werte") or {}).get("ursache") in ("live", "abhaengigkeit") for s in self.schritte):
            return 77
        return 0


# ---------------------------------------------------------------- tour

class Tour:
    def __init__(self, name, instanz, ausgabe, kurz=False):
        self.name, self.instanz, self.ausgabe, self.kurz = name, instanz, Path(ausgabe), bool(kurz)
        self._schritte = []
        self._aktuell = None
        self._tls = threading.local()   # the last call is kept per thread: overlapping calls from threads never swap each other's record
        self._start = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    @property
    def _letzter(self):
        return getattr(self._tls, "letzter", None)

    @_letzter.setter
    def _letzter(self, wert):
        self._tls.letzter = wert

    # -- calls
    def ruf(self, methode, pfad, koerper=None, quelle="cypher", timeout=60, erwartet=None):
        """The call is recorded for the current step in the calling thread only: a call from a worker thread does not show in the step's
        `ruf`/`code`; hand its answer to `notiere()` from the step's own thread.
        Inside a step an answer that is not ok (not 2xx, or ok:false, or a refused receipt) and whose code is not in `erwartet` (a set of codes the
        step declares) marks the step red with route, code and reason; the body may go on. A poll (`warte_bis`) never marks."""
        daten = json.dumps(koerper).encode() if koerper is not None else None
        kopf = {"x-djk-quelle": quelle}
        if daten is not None:
            kopf["content-type"] = "application/json"
        a = _http(self.instanz.url + pfad, methode, daten, kopf, timeout)
        self._letzter = (f"{methode} {pfad}", a)
        self._melde(f"{methode} {pfad}", a.code, a.grund, erwartet, [a.code], a)
        return a

    def _melde(self, ruf, code, grund, erwartet, kennzeichen, antwort=None):
        """A failed call inside a step: the step goes red (the first failure names it, all are listed), unless declared in `erwartet` or polled."""
        s = self._aktuell
        if s is None or getattr(self._tls, "still", 0) > 0:
            return
        if antwort is not None and antwort.ok:
            return
        if antwort is None and erwartet and any(k in erwartet for k in kennzeichen if k is not None):
            return
        if antwort is not None and erwartet and antwort.code in erwartet:
            return
        text = f"{ruf} {code} {grund}".strip() if grund else f"{ruf} {code}"
        s["werte"].setdefault("fehlerhafte_aufrufe", []).append(text)
        if s.get("_rot_auto") is None:
            s["_rot_auto"] = text
            s["_ruf_fehl"] = (ruf, code, grund)

    def notiere(self, antwort, ruf=None):
        """Records `antwort` (from `ruf`, e.g. a worker thread) as the current step's last call; call it from the step's own thread."""
        self._letzter = (ruf or "call", antwort)
        return antwort

    def hochladen(self, route, datei, query=None, timeout=300, erwartet=None):
        """Raw upload as the owner (the upload routes are owner-only): x-djk-roh: 1, application/octet-stream, x-djk-quelle: andreas."""
        q = ("?" + urllib.parse.urlencode(query)) if query else ""
        kopf = {"x-djk-roh": "1", "content-type": "application/octet-stream", "x-djk-quelle": "andreas"}
        a = _http(self.instanz.url + route + q, "POST", Path(datei).read_bytes(), kopf, timeout)
        self._letzter = (f"POST {route}", a)
        self._melde(f"POST {route}", a.code, a.grund, erwartet, [a.code], a)
        return a

    def warte_bis(self, f, frist_s, text="the condition"):
        """Polls `f` (an exception counts as not yet) every 0.25 s up to `frist_s`; False on the deadline."""
        ende = time.monotonic() + frist_s
        while True:
            self._tls.still = getattr(self._tls, "still", 0) + 1     # a poll may see errors on the way: only the deadline decides
            try:
                if f():
                    return True
            except Exception:  # noqa: BLE001
                pass
            finally:
                self._tls.still -= 1
            if time.monotonic() >= ende:
                if self._aktuell is not None:
                    self._aktuell["werte"]["wartete_auf"] = text
                return False
            time.sleep(0.25)

    # -- steps
    @contextlib.contextmanager
    def schritt(self, kennung, text, pflicht=False):
        s = {"kennung": kennung, "text": text, "urteil": "OK", "sek": 0.0, "ruf": None, "code": None, "grund": None, "werte": {}}
        self._aktuell, self._letzter = s, None
        t0 = time.monotonic()
        rot = None
        try:
            yield s["werte"]
            if s.get("_rot") is not None:
                rot = s.pop("_rot")
        except _Skip:
            s["urteil"] = "SKIP"
        except Exception as e:  # noqa: BLE001 - a failing step is data, not a crash
            rot = f"{type(e).__name__}: {e}".strip(": ")
            s["werte"]["ausnahme"] = traceback.format_exc(limit=4)[-600:]
        finally:
            s["sek"] = round(time.monotonic() - t0, 3)
            auto = s.pop("_rot_auto", None)
            fehl = s.pop("_ruf_fehl", None)
            if self._letzter is not None:
                s["ruf"], a = self._letzter[0], self._letzter[1]
                s["code"] = a.code
                if not a.ok and s["urteil"] != "SKIP":
                    s["grund"] = a.grund or s["grund"]
            if fehl is not None and s["urteil"] != "SKIP":
                s["ruf"], s["code"], s["grund"] = fehl[0], fehl[1], fehl[2] or s["grund"]
                rot = rot or auto
            if rot is not None:
                s["urteil"] = "FEHL"
                s["grund"] = s["grund"] or rot
                if s["werte"].get("rot_text") is None and rot != s["grund"]:
                    s["werte"]["rot_text"] = rot
            s.pop("_rot", None)
            self._schritte.append(s)
            self._aktuell = None
        if pflicht and s["urteil"] == "FEHL":
            raise TourAbbruch(kennung)

    def rot(self, grund, **werte):
        """Marks the current step red without raising (the step runs on and may add values)."""
        if self._aktuell is None:
            raise RuntimeError("rot() outside a step")
        self._aktuell["_rot"] = str(grund)
        self._aktuell["werte"].update(werte)

    def werte(self, **kw):
        if self._aktuell is not None:
            self._aktuell["werte"].update(kw)

    def skip(self, grund, sitzung=None, ursache="sonst"):
        """Ends the current step as SKIP. `ursache` live or abhaengigkeit makes the tour exit 77; `sitzung` names the owner session that covers it."""
        if self._aktuell is None:
            raise RuntimeError("skip() outside a step")
        self._aktuell["grund"] = grund
        self._aktuell["werte"]["ursache"] = ursache
        if sitzung:
            self._aktuell["werte"]["sitzung"] = sitzung
        raise _Skip()

    # -- measurements
    def pegel_phase(self, sek, takt=1.0):
        """Reads GET /pegel?sek=1 once per second (`takt`) for `sek` samples: highest and median master level, silent, clipping."""
        proben, fehler = [], 0
        for i in range(max(1, int(sek))):
            self._tls.still = getattr(self._tls, "still", 0) + 1     # an unreadable sample is counted in lesefehler, not a red step
            try:
                a = self.ruf("GET", "/pegel?sek=1", timeout=10)
            finally:
                self._tls.still -= 1
            db = dauerlauf.master_db(a.j) if a.code == 200 else None
            if db is None:
                fehler += 1
                db = dauerlauf.PEGEL_NICHTS_DB
            proben.append(db)
            if i < int(sek) - 1:
                time.sleep(takt)
        mx = max(proben)
        return PegelErgebnis(mx, statistics.median(proben), mx < STUMM_DB, mx >= 0.0, proben, fehler)

    def pruefe_datei(self, pfad, min_sek, max_stille=None):
        """Decodes the whole file. `max_stille` (seconds) turns a silent gap longer than that into the reason `stille`; the gap is always measured."""
        pfad = Path(pfad)
        if not pfad.is_file():
            return DateiErgebnis(False, ["fehlt"])
        gruende = []
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,format_name:stream=channels,sample_rate",
                            "-of", "json", str(pfad)], capture_output=True, text=True)
        try:
            info = json.loads(r.stdout)
            dauer = float(info["format"]["duration"])
            ch = int(info["streams"][0]["channels"])
            fmt = info["format"].get("format_name")
            rate = int(info["streams"][0].get("sample_rate") or 48000)
        except (ValueError, KeyError, IndexError, TypeError):
            return DateiErgebnis(False, ["unlesbar"])
        if dauer < min_sek:
            gruende.append("zu_kurz")
        spitze, summe, n, nan, rc, fehltext, stille = self._dekodiere(pfad, ch, rate)
        if rc != 0 or fehltext:
            gruende.append("decode")
        if nan:
            gruende.append("nan")
        if any(p >= 1.0 for p in spitze):
            gruende.append("clipping")
        dc = [s / n if n else 0.0 for s in summe]
        if any(abs(d) > DC_GRENZE for d in dc):
            gruende.append("dc")
        if max_stille is not None and stille > max_stille:
            gruende.append("stille")
        db = [20 * math.log10(p) if p > 0 else -200.0 for p in spitze]
        stumm = bool(db) and max(db) < STUMM_DB
        if stumm:
            gruende.append("still")                 # a file that is silent from end to end is never ok
        return DateiErgebnis(not gruende, gruende, dauer, fmt, ch, db, dc, nan, stumm, stille)

    @staticmethod
    def _dekodiere(pfad, ch, rate=48000):
        """Full decode to f32le: per channel peak, DC sum and the frame count; NaN or Inf anywhere; the longest silent stretch in seconds."""
        import numpy as np
        spitze, summe, n, nan = [0.0] * ch, [0.0] * ch, 0, False
        fenster = max(1, int(rate * STILLE_FENSTER_S))
        schwelle = 10 ** (STUMM_DB / 20)
        rest_f = np.zeros((0, ch))                  # frames that do not fill a window yet
        lauf = laengster = 0                        # silent windows in a row, the longest run
        with tempfile.TemporaryFile() as err:
            p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(pfad), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
                                 stdout=subprocess.PIPE, stderr=err)
            rest = b""
            while True:
                b = p.stdout.read(1 << 20)
                if not b:
                    break
                b = rest + b
                k = len(b) // (4 * ch) * 4 * ch
                rest = b[k:]
                a = np.frombuffer(b[:k], dtype="<f4").reshape(-1, ch).astype(np.float64)
                gut = np.isfinite(a)
                if not gut.all():
                    nan = True
                    a = np.where(gut, a, 0.0)
                if len(a):
                    spitze = [max(spitze[c], float(np.abs(a[:, c]).max())) for c in range(ch)]
                    summe = [summe[c] + float(a[:, c].sum()) for c in range(ch)]
                    n += len(a)
                    a = np.concatenate([rest_f, a])
                    voll = len(a) // fenster * fenster
                    rest_f = a[voll:]
                    if voll:
                        leise = (np.abs(a[:voll]).reshape(-1, fenster, ch).max(axis=(1, 2)) < schwelle)
                        for l in leise:
                            lauf = lauf + 1 if l else 0
                            laengster = max(laengster, lauf)
            rc = p.wait()
            err.seek(0)
            fehltext = err.read().decode(errors="replace").strip()
        return spitze, summe, n, nan, rc, fehltext, round(laengster * STILLE_FENSTER_S, 3)

    # -- report
    def bericht(self):
        return Bericht(self.name, getattr(self.instanz, "buchstabe", "?"), self._start, time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                       self.kurz, list(self._schritte), self.ausgabe, getattr(self.instanz, "hinweise", None))

    def fuehre(self, schritte):
        """Runs `schritte(self)`; whatever happens the report is written. Returns the exit code."""
        try:
            schritte(self)
        except TourAbbruch:
            pass
        except Exception as e:  # noqa: BLE001 - a stack trace and no report is the failure this runner exists to prevent
            self._schritte.append({"kennung": "tour.fehler", "text": "the tour function raised", "urteil": "FEHL", "sek": 0.0, "ruf": None,
                                   "code": None, "grund": f"{type(e).__name__}: {e}", "werte": {"ausnahme": traceback.format_exc(limit=6)[-800:]}})
        b = self.bericht()
        b.schreibe()
        return b.exitcode()
