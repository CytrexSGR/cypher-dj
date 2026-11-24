#!/usr/bin/env python3
"""Soak run collector and load driver (R3), standard library only.

One command for the whole run on a test instance (letters a to i), for the four-hour soak:

    djk/tools/dauerlauf.py lauf --instanz h --ausgabe ~/messungen/<date>-release-reliability/dauerlauf

30 minutes idle baseline, then 240 minutes load (--leerlauf-min, --last-min). `--probelauf` is the 10 minute dry run
(2 minutes idle, 8 minutes load, reference window 3:4). The tool starts the instance (djk-start, silent sink, slim
journal), holds the real-time lock for the whole run (waits at most 900 s, never deletes it: a long run blocks other
timing runs, so pick a quiet time), drives the load, writes one row per minute to minuten.jsonl, stops the instance
again (only if it started it) and writes the verdict (urteil.md, urteil.json). Exit code: 0 passed, 1 failed, 2 unusable
or the run could not be done (3 lock not obtained, 4 instance did not start).

Collector: a stored subscriber of the core (/k/hallo, fixed heartbeat 2 s, like core/tests/restart/subscriber.py) reads
/zustand/kern and /e/luecke; every 30 s the resident memory and open file handles of every cypherdj-*-<i> unit are
read from /proc (pids of the unit's cgroup). A minute's row keeps the maximum of its samples.

Load project: the live container (POST /live/oeffnen), not the demo project. Loop decks exist only in the live container
and another open project refuses them (projekt_offen). Load: transport running, three Strudel streams (patterns
re-posted every 16 bars), both loop decks launching a cell every 16 bars (alternating, project tempo), one knob change
per second on a bounded wave (own thread, absolute schedule, `ab: jetzt`). A cell needs audio and the test instance's
library is empty: the driver records two bars of stream 1 with POST /loop (rec) once at the start and loads it into
both decks, then opens the container faders (the master is silent otherwise). An instrument track with the shipped
RB-338 VST3 and a looping clip makes the server start a plugin host (cypherdj-wirt-arr<slot>); without it the run is
labelled "partial R3 coverage". The instance's old projects are moved aside first so every run starts clean.

Honesty checks of the verdict (see dauerlauf_evaluation.py): per endpoint minimum counts per minute, a dead driver
thread, the master level floor, a run shorter than planned is "aborted", units are listed again at every sample.
"""
import argparse
import fcntl
import json
import math
import os
import select
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
sys.path.insert(0, os.path.join(HIER, "..", "core", "tests", "restart"))
import dauerlauf_evaluation as auswertung  # noqa: E402
import osc  # noqa: E402

DJK = os.environ.get("DJK") or os.path.abspath(os.path.join(HIER, ".."))
BUCHSTABEN = "abcdefghi"
STICHPROBE_S = 30
HERZSCHLAG_S = 2.0
LOCK_WARTEN_S = 900
PEGEL_NICHTS_DB = -200.0
RB338_PFAD = os.path.expanduser("~/.local/lib/cypherdj/vst3/rb338.vst3")
RB338_NOTEN = [{"beat": 0, "laenge": 0.25, "ton": 36, "vel": 100}, {"beat": 0.75, "laenge": 0.25, "ton": 36, "vel": 100},
               {"beat": 1.5, "laenge": 0.5, "ton": 39, "vel": 100}, {"beat": 2.5, "laenge": 0.25, "ton": 36, "vel": 100}]


def _pruefe_instanz(i):
    if not isinstance(i, str) or len(i) != 1 or i not in BUCHSTABEN:
        raise ValueError(f"instance letter must be one of a to i, got {i!r}")
    return i


def _k(i):
    return BUCHSTABEN.index(_pruefe_instanz(i)) + 1


def seiten_port(i):
    return 47300 + 1000 * _k(i)


def kern_port(i):
    return 47100 + 1000 * _k(i)


def start_zeile(instanz):
    """The djk-start command line: silent sink (no --master), slim journal, strudel, instruments, baukasten streams."""
    _pruefe_instanz(instanz)
    return [os.path.join(DJK, "start", "djk-start"), "--instanz", instanz, "--strudel", "--instrumente",
            "--bk-stroeme", "--journal", "schlank"]


def _ganz(v):
    return isinstance(v, int) and not isinstance(v, bool)


class Minute:
    """Aggregates one minute of core messages and driver counts into one row (T9 schema without phase and t_min)."""

    def __init__(self, vorher=None):
        # vorher = (generation, frame_luecken) at the end of the previous minute: the delta continues from there
        self.gen, self.letzt = vorher if vorher else (None, None)
        self.delta = 0
        self.ereignisse = 0
        self.ereignis_frames = 0
        self.cb_max = 0
        self.cb_p99 = 0
        self.zustand_n = 0
        self.fehler = 0
        self.aufrufe = 0
        self.endpunkte = {}          # name -> [calls, errors] of this minute
        self.pegel = None            # highest master level (dB) seen in this minute

    def fuettere(self, adresse, felder):
        if adresse == "/zustand/kern":
            if len(felder) < 7 or not all(_ganz(x) for x in felder[:7]):
                return
            gen, fl, cbm, cbp = felder[0], felder[3], felder[5], felder[6]
            self.zustand_n += 1
            self.cb_max = max(self.cb_max, cbm)
            self.cb_p99 = max(self.cb_p99, cbp)
            if self.gen is None:
                pass                                # first value ever seen: only the baseline
            elif gen != self.gen:
                self.delta += fl                    # a new generation counts from 0
            else:
                d = fl - self.letzt
                self.delta += d if d >= 0 else fl   # a drop inside a generation: count from 0, never negative
            self.gen, self.letzt = gen, fl
        elif adresse == "/e/luecke":
            if len(felder) < 3 or not all(_ganz(x) for x in felder[:3]):
                return
            self.ereignisse += 1
            self.ereignis_frames += felder[1]

    def treiber_zaehlen(self, ok, name="sonst"):
        self.aufrufe += 1
        e = self.endpunkte.setdefault(name, [0, 0])
        e[0] += 1
        if not ok:
            self.fehler += 1
            e[1] += 1

    def pegel_sehen(self, db):
        self.pegel = db if self.pegel is None else max(self.pegel, db)

    def abschluss(self, rss, fds, neustarts, lebt=True):
        return {"rss_kib": dict(rss), "fds": dict(fds), "luecken_frames_delta": self.delta,
                "luecke_ereignisse": self.ereignisse, "luecke_frames": self.ereignis_frames,
                "cb_max_us": self.cb_max, "cb_p99_us_max": self.cb_p99, "neustarts": dict(neustarts),
                "generation": self.gen if self.gen is not None else 0,
                "treiber_fehler": self.fehler, "treiber_aufrufe": self.aufrufe, "zustand_n": self.zustand_n,
                "treiber_endpunkte": {k: list(v) for k, v in self.endpunkte.items()}, "treiber_lebt": bool(lebt),
                # no level reading in the minute counts as silence: the verdict must not read it as audible
                "pegel_master_db": self.pegel if self.pegel is not None else PEGEL_NICHTS_DB}

    def fortsetzung(self):
        return Minute((self.gen, self.letzt) if self.gen is not None else None)


def lies_rss_fds(pids, proc="/proc"):
    """Sum of VmRSS (KiB) and of open file handles over the pids, as (rss, fds).

    None, never (0, 0), when the sample is not a reading: no pid, a pid that vanished or whose status has no VmRSS
    (a kernel thread or a zombie). The caller drops that sample."""
    if not pids:
        return None
    rss = fds = 0
    for p in pids:
        try:
            gefunden = False
            with open(os.path.join(proc, str(p), "status"), encoding="utf-8", errors="replace") as f:
                for z in f:
                    if z.startswith("VmRSS:"):
                        rss += int(z.split()[1])
                        gefunden = True
                        break
            if not gefunden:
                return None
            fds += len(os.listdir(os.path.join(proc, str(p), "fd")))
        except (OSError, ValueError, IndexError):
            return None
    return rss, fds


def master_db(j):
    """Highest master level (dB) of a /pegel answer, or None when it holds no master channel."""
    k = j.get("kanaele") if isinstance(j, dict) else None
    if not isinstance(k, dict):
        return None
    werte = [v.get("max_db") for n, v in k.items() if str(n).startswith("master") and isinstance(v, dict)]
    werte = [w for w in werte if isinstance(w, (int, float)) and not isinstance(w, bool) and w == w]
    return float(max(werte)) if werte else None


def parse_show(text):
    """`systemctl show -p Id ...` of several units: blocks separated by an empty line, keyed by Id."""
    aus = {}
    for block in text.split("\n\n"):
        d = {}
        for z in block.splitlines():
            if "=" in z:
                k, v = z.split("=", 1)
                d[k] = v
        if d.get("Id"):
            aus[d["Id"]] = d
    return aus


class NeustartZaehler:
    """Restarts of a unit as seen from outside: NRestarts of systemd plus every new activation (a unit without
    Restart= that was started again) plus one for every transition away from active."""

    def __init__(self):
        self.zus = {}

    def sehe(self, unit, p):
        z = self.zus.setdefault(unit, {"extra": 0, "aet": None, "aktiv": True})
        aet = p.get("ActiveEnterTimestampMonotonic")
        aktiv = p.get("ActiveState") == "active"
        if z["aet"] is not None and aet != z["aet"] and aktiv:
            z["extra"] += 1
        if z["aktiv"] and not aktiv:
            z["extra"] += 1
        z["aktiv"] = aktiv
        if aet is not None and aktiv:
            z["aet"] = aet
        try:
            n = int(p.get("NRestarts", "0"))
        except ValueError:
            n = 0
        return n + z["extra"]


def antwort_ok(code, j):
    """A driver call counts as ok for a 2xx answer whose body is not ok:false and whose core receipt (if any) is not a refusal."""
    if not isinstance(code, int) or not 200 <= code < 300:
        return False
    if isinstance(j, dict):
        if j.get("ok") is False:
            return False
        q = j.get("quittung")
        if isinstance(q, dict) and q.get("status") in (4, 6, 7, 8):
            return False
    return True


def http(url, methode, pfad, koerper=None, timeout=10):
    daten = json.dumps(koerper).encode() if koerper is not None else None
    req = urllib.request.Request(url + pfad, data=daten, method=methode,
                                 headers={"x-djk-quelle": "andreas", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            code, roh = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, roh = e.code, e.read()
    except Exception:  # noqa: BLE001 - refused connection, timeout, reset: all one failed call
        return 0, None
    try:
        return code, json.loads(roh)
    except ValueError:
        return code, None


MUSTER = {
    1: ['s("bd*4, [~ hh]*4")', 's("bd*4, hh*8")'],
    2: ['note("c2 [~ eb2] g2 [c2 bb1]").s("sawtooth")', 'note("c2 c2 [g1 bb1] c2").s("sawtooth")'],
    3: ['note("c4 [eb4 g4] ~ bb4")', 'note("g4 [bb4 c5] ~ eb4")'],
}


class Treiber:
    """The load driver: a setup thread, then one worker thread per kind of call (knob, deck launches, strudel posts).

    Every call is counted per endpoint (`zaehle(ok, name)`); a failed call is never fatal. A worker that dies from an
    exception is recorded in `tot` and `lebt()` turns False: a dead driver must not look like a quiet one."""

    def __init__(self, url, zaehle, stop, vst3=RB338_PFAD):
        self.url, self.zaehle, self.stop, self.vst3 = url, zaehle, stop, vst3
        self.statistik = {}          # "METHODE pfad" -> [calls, errors]
        self.letzter_fehler = {}
        self.tempo = 128.0
        self.tot = set()
        self.faeden = []             # the workers: they must run until stop
        self.aufbau_faden = []       # the setup thread: it ends by design
        self.aufbau_fertig = False
        self.instrument = {"versucht": False, "ok": False, "grund": ""}
        self.t0 = None

    def ruf(self, methode, pfad, koerper=None, name="sonst"):
        code, j = http(self.url, methode, pfad, koerper)
        ok = antwort_ok(code, j)
        self.zaehle(ok, name)
        s = self.statistik.setdefault(f"{methode} {pfad}", [0, 0])
        s[0] += 1
        if not ok:
            s[1] += 1
            self.letzter_fehler[f"{methode} {pfad}"] = {"code": code, "antwort": str(j)[:200]}
        return code, j

    def _faden(self, name, ziel, arbeiter=True):
        def rumpf():
            try:
                ziel()
            except Exception as e:  # noqa: BLE001 - recorded, and lebt() turns False
                self.letzter_fehler[name] = {"ausnahme": repr(e)}
                self.tot.add(name)
                self.zaehle(False, name)
        t = threading.Thread(target=rumpf, daemon=True, name=f"treiber-{name}")
        (self.faeden if arbeiter else self.aufbau_faden).append(t)
        t.start()
        return t

    def lebt(self):
        """No thread died from an exception and every worker runs. The setup thread ends by design once the workers
        run, so a finished one is fine; a setup that died is in `tot`."""
        return not self.tot and all(t.is_alive() for t in self.faeden)

    def warte_auf(self):
        for t in self.aufbau_faden + list(self.faeden):
            t.join(timeout=15)

    def start(self):
        self._faden("aufbau", self._aufbau_und_arbeit, arbeiter=False)

    # --- setup -------------------------------------------------------------------------------------------
    def _rev(self):
        code, j = self.ruf("GET", "/proj/aktuell?nur=rev")
        for quelle in (j, j.get("projekt") if isinstance(j, dict) else None):
            if isinstance(quelle, dict) and _ganz(quelle.get("rev")):
                return quelle["rev"]
        return None

    def _aendern(self, label, befehle):
        """POST /proj/aendern with the current rev; a stale rev (a concurrent edit) is retried."""
        for _ in range(4):
            rev = self._rev()
            if rev is None:
                continue
            code, j = self.ruf("POST", "/proj/aendern", {"rev": rev, "label": label, "befehle": befehle})
            if antwort_ok(code, j):
                return True
            if "rev_veraltet" not in str(j):
                return False
        return False

    def instrument_aufbauen(self):
        """An instrument track with a Carla host (RB-338, shipped VST3) playing a looping MIDI clip: this is what
        starts a cypherdj-wirt-arr<slot> unit. The reason is kept when it cannot be done (partial R3 coverage)."""
        self.instrument["versucht"] = True
        if not os.path.exists(self.vst3):
            self.instrument["grund"] = f"VST3 not found: {self.vst3}"
            return
        plugin = {"format": "vst3", "pfad": self.vst3, "uid": "RB-338"}
        if not self._aendern("soak instrument track", [{"befehl": "spur_neu", "art": "instrument", "name": "soak-rb338",
                                                         "geraet": {"art": "wirt", "name": "plugin", "slot": 1,
                                                                    "plugin": plugin}}]):
            self.instrument["grund"] = "spur_neu refused"
            return
        code, j = self.ruf("GET", "/proj/aktuell")
        spuren = ((j or {}).get("projekt") or {}).get("spuren") if isinstance(j, dict) else None
        if not spuren or not isinstance(spuren[-1], dict) or "id" not in spuren[-1]:
            self.instrument["grund"] = "new track not found in the project"
            return
        spur = spuren[-1]["id"]
        if not self._aendern("soak instrument clip", [{"befehl": "clip_neu", "spur_id": spur, "art": "midi",
                                                        "name": "acid", "start_beat": 0, "laenge_beats": 4,
                                                        "noten": RB338_NOTEN}]):
            self.instrument["grund"] = "clip_neu refused"
            return
        if not self._aendern("soak instrument loop", [{"befehl": "loop_setzen", "an": True, "von_beat": 0, "bis_beat": 4}]):
            self.instrument["grund"] = "loop_setzen refused"
            return
        self.instrument.update(ok=True, spur=spur)

    def _fader_auf(self, pfade):
        for pfad in pfade:
            self.ruf("POST", "/regler", {"pfad": pfad, "nach": -6, "takte": 0, "ab": "jetzt"})

    def aufbau(self):
        w = self.stop.wait
        self.ruf("POST", "/live/oeffnen", {})
        for strom in (1, 2, 3):
            self.ruf("POST", "/strudel", {"strom": strom, "text": MUSTER[strom][0]})
        # the container faders start closed: without them the load would be silent (checked by the level floor)
        self._fader_auf(("erz/1/fader", "erz/2/fader", "erz/3/fader"))
        self.ruf("POST", "/proj/transport", {"aktion": "start"})
        if w(5):
            return
        self.ruf("POST", "/loop", {"aktion": "rec", "beats": 8, "name": "dauerlauf"})
        if w(8):
            return
        for deck in (1, 2):
            for _ in range(3):
                code, j = self.ruf("POST", "/loopdeck/laden", {"deck": deck, "spur": 1, "zelle": 1,
                                                                "quelle": {"loop": "dauerlauf"}})
                if code == 200 or w(3):
                    break
        # a place whose pad or deck channel is open refuses to change to loops (kanal_offen): open them after loading
        self._fader_auf(("deck/1/fader", "deck/2/fader", "pad/1/fader", "pad/2/fader"))
        self.instrument_aufbauen()
        self.ruf("POST", "/proj/transport", {"aktion": "start"})

    def _aufbau_und_arbeit(self):
        self.aufbau()
        self.aufbau_fertig = True
        if self.stop.is_set():
            return
        self.t0 = time.monotonic()
        for name, ziel in (("knopf", self._knopf), ("deck", self._deck), ("muster", self._muster)):
            self._faden(name, ziel)

    # --- workers -----------------------------------------------------------------------------------------
    def _knopf(self):
        """One knob change per second on an ABSOLUTE schedule (t0 + n s), so a slow call does not stretch the rate.
        'ab: jetzt' makes /regler answer at once instead of waiting for the grid (1.3 to 1.9 s per call otherwise)."""
        t0, n = self.t0, 0
        while not self.stop.is_set():
            ziel = t0 + n
            if self.stop.wait(max(0.0, ziel - time.monotonic())):
                return
            wert = -3 + 3 * math.sin(2 * math.pi * n / 60.0)
            self.ruf("POST", "/regler", {"pfad": "erz/1/eq/hoch", "nach": round(wert, 3), "takte": 0, "ab": "jetzt"},
                     "regler")
            n += 1
            if time.monotonic() - (t0 + n) > 5:      # more than 5 s behind: jump ahead instead of a burst
                n = int(time.monotonic() - t0) + 1

    def _deck(self):
        deck, ziel = 1, time.monotonic()
        while not self.stop.is_set():
            if self.stop.wait(max(0.0, ziel - time.monotonic())):
                return
            self.ruf("POST", "/loopdeck/start", {"deck": deck, "spur": 1, "zelle": 1, "raster": "takt"}, "deck_start")
            deck = 2 if deck == 1 else 1
            code, j = self.ruf("GET", "/loopdeck/stand")
            bpm = j.get("bpm") if isinstance(j, dict) else None
            if isinstance(bpm, (int, float)) and 40 <= bpm <= 240:
                self.tempo = float(bpm)
            ziel += 64 * 60.0 / self.tempo           # one launch per 16 bars, decks alternating

    def _muster(self):
        tick, ziel = 0, time.monotonic() + 5
        while not self.stop.is_set():
            if self.stop.wait(max(0.0, ziel - time.monotonic())):
                return
            strom = tick % 3 + 1
            variante = (tick // 3 + 1) % 2
            self.ruf("POST", "/strudel", {"strom": strom, "text": MUSTER[strom][variante]}, "strudel")
            tick += 1
            ziel += 64 * 60.0 / self.tempo / 3       # one post per 16/3 bars: every stream changes every 16 bars


class PegelLeser(threading.Thread):
    """Reads the master level of the test instance (GET /pegel, read-only) every 5 s into the current minute."""

    def __init__(self, url, sehe, stop):
        super().__init__(daemon=True, name="pegel")
        self.url, self.sehe, self.stop = url, sehe, stop

    def run(self):
        while not self.stop.wait(5):
            code, j = http(self.url, "GET", "/pegel?sek=5")
            db = master_db(j) if code == 200 else None
            if db is not None:
                self.sehe(db)


class Abonnent(threading.Thread):
    """Stored subscriber of the core: /k/hallo every 2 s, forwards every datagram to `fuettere`."""

    def __init__(self, kern, fuettere, stop):
        super().__init__(daemon=True, name="abonnent")
        self.kern, self.fuettere, self.stop = ("127.0.0.1", kern), fuettere, stop
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.bind(("127.0.0.1", 0))
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
        self.port = self.s.getsockname()[1]

    def run(self):
        naechster = time.monotonic()
        while not self.stop.is_set():
            jetzt = time.monotonic()
            if jetzt >= naechster:
                try:
                    self.s.sendto(osc.kodiere("/k/hallo", ",sii", "dauerlauf", self.port, 1), self.kern)
                except OSError:
                    pass
                naechster = jetzt + HERZSCHLAG_S
            r, _, _ = select.select([self.s], [], [], max(0.0, min(naechster - time.monotonic(), 0.5)))
            while r:
                try:
                    b = self.s.recv(4096, socket.MSG_DONTWAIT)
                except (BlockingIOError, OSError):
                    break
                m = osc.lies(b)
                if m is not None:
                    self.fuettere(m[0], m[2])
        try:
            self.s.sendto(osc.kodiere("/k/tschuess", ",s", "dauerlauf"), self.kern)
        except OSError:
            pass


def _sh(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def einheiten(instanz):
    r = _sh(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", "--type=service",
             f"cypherdj-*-{instanz}.service"])
    return sorted(z.split()[0] for z in r.stdout.splitlines() if z.strip())


def einheiten_aktiv(instanz):
    return [u for u in einheiten(instanz)
            if _sh(["systemctl", "--user", "is-active", u]).stdout.strip() in ("active", "activating", "reloading")]


def pids_von(p, cgroup_wurzel="/sys/fs/cgroup"):
    cg = p.get("ControlGroup", "")
    if cg:
        try:
            with open(os.path.join(cgroup_wurzel, cg.lstrip("/"), "cgroup.procs")) as f:
                pids = [int(x) for x in f.read().split()]
            if pids:
                return pids
        except (OSError, ValueError):
            pass
    try:
        pid = int(p.get("MainPID", "0"))
    except ValueError:
        pid = 0
    return [pid] if pid > 0 else []


def schlosspfad():
    r = _sh(["bash", "-c", '. "$1"; printf %s "$CYPHERDJ_ECHTZEIT_SCHLOSS"', "x",
             os.path.join(DJK, "config", "realtime_lock.sh")])
    return r.stdout.strip() or os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "cypherdj-echtzeit.lock")


def zusatz_markdown(zeilen, leerlauf_min):
    """Informational tables next to the verdict: memory per unit and callback times, baseline against load."""
    leer = [z for z in zeilen if z["phase"] == "leerlauf"]
    last = [z for z in zeilen if z["phase"] == "last"]
    if not leer or not last:
        return ""
    z = ["", "## Memory per unit, maximum of the phase (KiB), and file handles", "",
         "| Unit | idle max | load max | idle fds | load fds |", "|---|---|---|---|---|"]
    for u in sorted({u for r in zeilen for u in r["rss_kib"]}):
        z.append("| {} | {} | {} | {} | {} |".format(
            u, max(r["rss_kib"].get(u, 0) for r in leer), max(r["rss_kib"].get(u, 0) for r in last),
            max(r["fds"].get(u, 0) for r in leer), max(r["fds"].get(u, 0) for r in last)))
    z += ["", "## Core callback (informational, not judged)", "", "| Phase | callback max us | callback p99 max us |",
          "|---|---|---|",
          f"| idle | {max(r['cb_max_us'] for r in leer)} | {max(r['cb_p99_us_max'] for r in leer)} |",
          f"| load | {max(r['cb_max_us'] for r in last)} | {max(r['cb_p99_us_max'] for r in last)} |", ""]
    return "\n".join(z)


def stichprobe(einh, zeigen, zaehler, rss_max, fds_max, neu, warnungen, m):
    """One sample of every unit into the minute's maxima. A unit without a usable sample (no pid, a vanished pid,
    an empty `systemctl show` block) is left out of the maxima rather than read as 0; an empty show answer is logged
    (the restart counter then reads it as a transition away from active: the safe direction)."""
    if einh and not zeigen:
        warnungen.append(f"minute {m}: systemctl show returned nothing for {len(einh)} unit(s)")
    for u in einh:
        p = zeigen.get(u, {})
        if not p:
            warnungen.append(f"minute {m}: no show block for {u}")
        k = u[:-8]
        neu[k] = zaehler.sehe(k, p)
        lesen = lies_rss_fds(pids_von(p))
        if lesen is None:
            warnungen.append(f"minute {m}: no usable memory sample of {k}")
            continue
        rss_max[k] = max(rss_max.get(k, 0), lesen[0])
        fds_max[k] = max(fds_max.get(k, 0), lesen[1])


def projekte_beiseite(instanz, ziel, wurzel="/dev/shm"):
    """The test instance keeps its projects between runs (/dev/shm/cypherdj-<i>/projekte). A leftover live container
    (tracks, instrument hosts, a plugin slot in use) changes what the load does, so every run starts clean; the old
    folder is moved into the run's output folder, never deleted. Returns the new place or None."""
    quelle = os.path.join(wurzel, f"cypherdj-{_pruefe_instanz(instanz)}", "projekte")
    if not os.path.isdir(quelle):
        return None
    neu = os.path.join(ziel, "projekte-vor-lauf")
    shutil.move(quelle, neu)
    return neu


def nicht_abgedeckt(zeilen, treiber):
    """What the load did not cover. R3 wants the instrument plugin host (cypherdj-wirt-arr<slot>) under load."""
    fehlt = []
    last = [z for z in zeilen if z["phase"] == "last"]
    if not any("-wirt-arr" in u for z in last for u in z["rss_kib"]):
        grund = ""
        if treiber is not None and not treiber.instrument.get("ok"):
            grund = f" ({treiber.instrument.get('grund') or 'instrument track not built'})"
        fehlt.append("instrument plugin host cypherdj-wirt-arr<slot> did not run under load" + grund)
    return fehlt


def lauf(a):
    i = _pruefe_instanz(a.instanz)
    leer_min, last_min, bezug = a.leerlauf_min, a.last_min, a.bezug
    if a.probelauf:
        leer_min, last_min, bezug = 2, 8, (3, 4)
    aus = os.path.abspath(os.path.expanduser(a.ausgabe))
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    vorhanden = einheiten_aktiv(i)
    if vorhanden and not a.vorhanden:
        print(f"dauerlauf: units of instance {i} are already active ({', '.join(vorhanden)}); stop them or pass --vorhanden",
              file=sys.stderr)
        return 4
    os.makedirs(aus, exist_ok=True)
    url = f"http://127.0.0.1:{seiten_port(i)}"
    meta = {"start": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "instanz": i, "leerlauf_min": leer_min,
            "last_min": last_min, "bezug": list(bezug), "probelauf": bool(a.probelauf),
            "djk_start": start_zeile(i), "selbst_gestartet": not vorhanden,
            "lastprojekt": "live container (POST /live/oeffnen): loop decks exist only there and another open project "
                           "refuses them; the demo project is not used. One loop of two bars is recorded from stream 1 "
                           "at the start and loaded into both decks (the test library is empty).",
            "treiber_tempo": "launch of a deck cell every 16 bars at the project tempo, decks alternating; strudel streams "
                             "re-posted one stream per 16/3 bars, a knob (erz/1/eq/hoch) once per second on a sine between -6 and 0 dB"}

    def schreibe_meta():
        with open(os.path.join(aus, "meta.json"), "w") as f:
            json.dump(meta, f, indent=1)

    schreibe_meta()
    lockfile = open(schlosspfad(), "a")
    t_lock = time.monotonic()
    while True:
        try:
            fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except OSError:
            if time.monotonic() - t_lock > LOCK_WARTEN_S or stop.wait(10):
                print("dauerlauf: real-time lock not obtained", file=sys.stderr)
                return 3
    selbst = not vorhanden
    abonnent = treiber = None
    aktuelle = [Minute()]
    sperre = threading.Lock()

    def fuettere(adr, w):
        with sperre:
            aktuelle[0].fuettere(adr, w)

    def zaehle(ok, name="sonst"):
        with sperre:
            aktuelle[0].treiber_zaehlen(ok, name)

    def pegel(db):
        with sperre:
            aktuelle[0].pegel_sehen(db)

    zeilen, warnungen, pegel_leser = [], [], None
    meta["warnungen"] = warnungen
    try:
        if selbst:
            meta["projekte_beiseite"] = projekte_beiseite(i, aus)
            schreibe_meta()
            env = dict(os.environ, DJK=DJK)
            with open(os.path.join(aus, "start.txt"), "w") as f:
                rc = subprocess.run(start_zeile(i), stdout=f, stderr=subprocess.STDOUT, env=env, timeout=600).returncode
            if rc != 0:
                print(f"dauerlauf: djk-start failed (rc {rc}), see {aus}/start.txt", file=sys.stderr)
                return 4
        abonnent = Abonnent(kern_port(i), fuettere, stop)
        abonnent.start()
        pegel_leser = PegelLeser(url, pegel, stop)
        pegel_leser.start()
        stop.wait(5)                                # the units settle, the first /zustand/kern arrives
        bekannt = einheiten(i)
        meta["einheiten"] = [e[:-8] for e in bekannt]
        meta["neue_einheiten"] = []
        schreibe_meta()
        zaehler = NeustartZaehler()
        t0 = time.monotonic()
        with open(os.path.join(aus, "minuten.jsonl"), "w", buffering=1) as jl:
            for m in range(leer_min + last_min):
                if m == leer_min:
                    treiber = Treiber(url, zaehle, stop)
                    treiber.start()
                rss_max, fds_max, neu = {}, {}, {}
                for halb in range(60 // STICHPROBE_S):
                    if stop.wait(max(0.0, t0 + m * 60 + halb * STICHPROBE_S - time.monotonic())):
                        break
                    # listed again at every sample: a unit that starts later (an instrument host) is measured from
                    # its first sample and reported, one that disappears from the list drops out of the row
                    jetzt = einheiten(i)
                    for u in jetzt:
                        if u not in bekannt:
                            meta["neue_einheiten"].append({"einheit": u[:-8], "t_min": m})
                    bekannt = sorted(set(bekannt) | set(jetzt))
                    zeigen = parse_show(_sh(["systemctl", "--user", "show", "-p", "Id", "-p", "MainPID", "-p", "NRestarts",
                                             "-p", "ActiveState", "-p", "ActiveEnterTimestampMonotonic", "-p",
                                             "ControlGroup", *jetzt]).stdout) if jetzt else {}
                    stichprobe(jetzt, zeigen, zaehler, rss_max, fds_max, neu, warnungen, m)
                if stop.wait(max(0.0, t0 + (m + 1) * 60 - time.monotonic())):
                    break
                with sperre:
                    z = aktuelle[0].abschluss({k: v for k, v in rss_max.items()}, fds_max,
                                              {k: v for k, v in neu.items() if k in rss_max},
                                              treiber.lebt() if treiber else True)
                    aktuelle[0] = aktuelle[0].fortsetzung()
                z = {"t_min": m, "phase": "leerlauf" if m < leer_min else "last", **z}
                zeilen.append(z)
                jl.write(json.dumps(z) + "\n")
    finally:
        stop.set()
        if abonnent:
            abonnent.join(timeout=5)
        if pegel_leser:
            pegel_leser.join(timeout=5)
        if treiber:
            treiber.warte_auf()
            meta["treiber_statistik"] = treiber.statistik
            meta["treiber_letzte_fehler"] = treiber.letzter_fehler
            meta["instrument_track"] = treiber.instrument
        if selbst:
            subprocess.run([os.path.join(DJK, "start", "djk-stop"), "--instanz", i], capture_output=True,
                           env=dict(os.environ, DJK=DJK), timeout=300)
            meta["rest_einheiten_nach_stopp"] = einheiten(i)
        meta["ende"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        meta["zeilen"] = len(zeilen)
        schreibe_meta()
        fcntl.flock(lockfile, fcntl.LOCK_UN)
        lockfile.close()
    if zeilen:
        fehlt = nicht_abgedeckt(zeilen, treiber)
        urteil = auswertung.auswerten(zeilen, leer_min, bezug, 5, last_min, bool(a.probelauf), fehlt)
    else:
        urteil = auswertung._leer_ergebnis("no rows")
    with open(os.path.join(aus, "urteil.json"), "w") as f:
        json.dump(urteil, f, indent=1)
    md = auswertung.markdown(urteil) + (zusatz_markdown(zeilen, leer_min) if zeilen else "")
    with open(os.path.join(aus, "urteil.md"), "w") as f:
        f.write(md)
    print(md)
    return auswertung.exit_code(urteil)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Soak run collector and load driver")
    sub = ap.add_subparsers(dest="befehl", required=True)
    p = sub.add_parser("lauf")
    p.add_argument("--instanz", required=True)
    p.add_argument("--ausgabe", required=True)
    p.add_argument("--leerlauf-min", type=int, default=30)
    p.add_argument("--last-min", type=int, default=240)
    p.add_argument("--bezug", default="25:30")
    p.add_argument("--probelauf", action="store_true")
    p.add_argument("--vorhanden", action="store_true", help="use an instance that is already running; it is not stopped")
    a = ap.parse_args(argv)
    try:
        a.bezug = tuple(int(x) for x in a.bezug.split(":"))
        _pruefe_instanz(a.instanz)
    except ValueError as e:
        print(f"dauerlauf: {e}", file=sys.stderr)
        return 2
    return lauf(a)


if __name__ == "__main__":
    sys.exit(main())
