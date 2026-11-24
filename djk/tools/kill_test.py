#!/usr/bin/env python3
"""Kill test (release reliability R2): kill -9 once each on the page server, the leitstand, the core and an instrument host
of a TEST instance, at fixed points of a production session, and prove that no acknowledged change is lost.

Usage: kill_test.py --instanz a..i [--ausgabe DIR]
Exit:  0 all four kills passed, 1 a change was lost or a unit did not come back, 2 setup unusable.

The instance must run (`djk-start --instanz <i> --strudel --instrumente`, silent sink). The script only ever acts on units
named `cypherdj-<name>-<i>` (see einheit()); the live studio's units carry no suffix and can never be built here. It never
opens the live page port. Standard library only.

What is compared after each kill (after the unit is ready again and the project was reopened):
 (a) project.json on disk and GET /proj/aktuell against the project document of the last acknowledged answer;
 (b) the knob value the core reports in GET /lage (field regler["pad/1/trim"]) against the last acknowledged value.
     Project track mixer rows (spur/<n>/...) are not part of /lage (server.ts lage() lists deck, pad and erz rows only), so a
     live strip trim is the knob that /lage can show. A knob that is not refilled is a FINDING in the report, with the numbers.
"""
import argparse
import json
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional

SCHRITT_S = 0.25                 # poll step of every bounded wait
BEREIT_FRIST_S = 30.0            # readiness wait per kill (instrument hosts restart after RestartSec=2)
KNOPF_FRIST_KERN_S = 20.0        # knob refill poll after the core kill
KNOPF_FRIST_SONST_S = 10.0
KNOPF_TOLERANZ = 0.05            # tolerance on a knob value (the core reports floats)
FADER_DB = -6.5                  # project track fader and pan of the knob steps: they travel project -> core (setzeRegler(alleRegler(projekt)) after a core restart)
PAN = -0.25
# Fields that change by themselves when a project is opened and are no user data: none known; filled only from evidence.
IGNORIERT: tuple = ()
PROJEKT_NAME = "kill-test"
AUFNAHME_VOR_KILL_S = 4.0        # the page server is killed this long after REC was acknowledged (a take of 8 bars runs 16 s at 120 BPM)
AUFNAHME_RATE = 48000            # sample rate of the core's takes


# ---------------------------------------------------------------- pure logic

def einheit(instanz, name: str) -> str:
    """Unit name `cypherdj-<name>-<instanz>`. An empty or odd instance letter raises: the live units can never be built."""
    if not isinstance(instanz, str) or not re.fullmatch(r"[a-i]", instanz):
        raise ValueError(f"instance letter must be one of a..i, got {instanz!r}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        raise ValueError(f"unit name {name!r}")
    return f"cypherdj-{name}-{instanz}"


def _gleich(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    return a == b


def vergleiche(ack, platte, ignoriere=(), _pfad="") -> list:
    """Canonical comparison of two project documents; returns the sorted differing paths (dotted, list indices as numbers).
    A key or list element present on one side only counts as differing; bool never equals a number, None never equals 0."""
    out = []

    def lauf(a, b, pfad):
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b), key=str):
                if k in ignoriere:
                    continue
                p = f"{pfad}.{k}" if pfad else str(k)
                if k not in a or k not in b:
                    out.append(p)
                else:
                    lauf(a[k], b[k], p)
        elif isinstance(a, list) and isinstance(b, list):
            for i in range(max(len(a), len(b))):
                p = f"{pfad}.{i}" if pfad else str(i)
                if i >= len(a) or i >= len(b):
                    out.append(p)
                else:
                    lauf(a[i], b[i], p)
        elif not _gleich(a, b):
            out.append(pfad or "$")

    lauf(ack, platte, _pfad)
    return sorted(out)


def warte_neue_generation(quelle: Callable[[], Optional[int]], alt: int, frist_s: float,
                          schlaf: Callable[[float], None] = time.sleep) -> Optional[int]:
    """Poll `quelle` until it returns a generation greater than `alt`; None on timeout. A source that gives None (core still
    restarting), the old value, or raises does not end the wait. Bounded by `frist_s` (slept time or real time, whichever
    comes first), never an endless loop."""
    start = time.monotonic()
    geschlafen = 0.0
    while True:
        try:
            g = quelle()
        except Exception:   # noqa: BLE001 - a source that is down means "not yet"
            g = None
        if g is not None and g > alt:
            return g
        if geschlafen >= frist_s or time.monotonic() - start >= frist_s:
            return None
        schlaf(SCHRITT_S)
        geschlafen += SCHRITT_S


@dataclass(frozen=True)
class Kill:
    name: str          # short name in the report
    einheit: str       # unit name without prefix and suffix
    nach: str          # session step whose acknowledgement the kill follows


KILL_PLAN = (
    Kill("page server", "oberflaeche", "noten"),
    Kill("leitstand", "leitstand", "clip_verschoben"),
    Kill("core", "kern", "knopf"),
    Kill("instrument host", "wirt-arr1", "knopf_antwort"),
)

SCHRITTE = ("neu", "spur_audio", "spur_rb338", "spur_surge", "clip_midi", "noten", "clip_verschoben", "knopf", "knopf_antwort")


class Einrichtungsfehler(Exception):
    """The setup cannot give a verdict (no acknowledgement state, instance not usable): exit 2, never a pass."""


@dataclass
class Ergebnis:
    projekt: Optional[dict]          # project document served right after the acknowledged answer
    knoepfe: Optional[dict] = None   # core knob path -> value acknowledged by this step, e.g. {"spur/1/fader": -6.5} (None: no knob)
    rec_start: Optional[float] = None   # umg.jetzt() when REC was acknowledged (only the recording step)


class Umgebung:
    """What the driver needs from the instance. The real one talks to systemd, the page and the core; tests fake it."""
    def schlaf(self, s: float) -> None: raise NotImplementedError
    def jetzt(self) -> float: raise NotImplementedError
    def schritt(self, name: str) -> Ergebnis: raise NotImplementedError
    def restarts(self, einheit: str) -> Optional[int]: raise NotImplementedError
    def kill(self, einheit: str) -> int: raise NotImplementedError
    def aktiv(self, einheit: str) -> bool: raise NotImplementedError
    def kern_generation(self) -> Optional[int]: raise NotImplementedError
    def zustand_generation(self) -> Optional[int]: raise NotImplementedError
    def seite_antwortet(self) -> bool: raise NotImplementedError
    def oeffnen(self) -> None: raise NotImplementedError
    def platte(self) -> Optional[dict]: raise NotImplementedError
    def aktuell(self) -> Optional[dict]: raise NotImplementedError
    def kern_knopf(self, pfad: str) -> Optional[float]: raise NotImplementedError   # the core's own report on /e/regler since its current generation
    # recording part (--aufnahme)
    def laufdatei_da(self) -> bool: raise NotImplementedError          # a run file `.laufend-*.json` lies in the project's aufnahmen/
    def waise_messen(self, label: str) -> dict: raise NotImplementedError   # state of the orphan take: {label, f32_bytes, waechst, status, laufdatei_da, gerettet_saetze}
    def aufnahme_beenden(self) -> None: raise NotImplementedError      # stop the take at the core (only the test does it, at the very end of the run)
    def aufnahme_nach_oeffnen(self) -> dict: raise NotImplementedError  # {laufdatei_entfernt, take_dauer_s (None: no WAV), als_wiederhergestellt_gelistet}


ALLE_EINHEITEN = ("kern", "notbahn", "leitstand", "oberflaeche", "wirt-arr1")


def _bereit(umg: Umgebung, k: Kill, vor: int, alt_generation: Optional[int]) -> tuple:
    """Wait for readiness after a kill. Returns (ready, seconds, notes). Core: new generation on /e/neustart, cross-checked with
    the generation of /zustand/kern, NRestarts plus one. Others: NRestarts plus one, unit active, page answering."""
    t0 = umg.jetzt()
    notiz = []
    if k.einheit == "kern":
        if alt_generation is None:
            notiz.append("old core generation unknown before the kill")
            return False, 0.0, notiz
        neu = warte_neue_generation(umg.kern_generation, alt_generation, BEREIT_FRIST_S, umg.schlaf)
        if neu is None:
            notiz.append(f"core: no new generation (old {alt_generation}) within {BEREIT_FRIST_S:.0f} s")
            return False, umg.jetzt() - t0, notiz
        quer = warte_neue_generation(lambda: umg.zustand_generation() if umg.zustand_generation() == neu else None, neu - 1, 10.0, umg.schlaf)
        if quer is None:
            notiz.append(f"core: /e/neustart said generation {neu}, /zustand/kern says {umg.zustand_generation()}")
            return False, umg.jetzt() - t0, notiz
    ende = t0 + BEREIT_FRIST_S
    while True:
        r = umg.restarts(k.einheit)
        if r is not None and r >= vor + 1 and umg.aktiv(k.einheit) and umg.seite_antwortet():
            return True, umg.jetzt() - t0, notiz
        if umg.jetzt() >= ende:
            notiz.append(f"{k.einheit}: not ready within {BEREIT_FRIST_S:.0f} s (NRestarts {vor} -> {r}, active {umg.aktiv(k.einheit)}, page answers {umg.seite_antwortet()})")
            return False, umg.jetzt() - t0, notiz
        umg.schlaf(SCHRITT_S)


def _knopf_pruefen(umg: Umgebung, erwartet: dict, frist_s: float) -> Optional[dict]:
    """Poll the core's own report of every acknowledged knob (bounded). The core must report the acknowledged value in its current generation:
    a value that is missing or different is a lost acknowledged change."""
    if not erwartet:
        return None
    t0 = umg.jetzt()

    def lies():
        felder = []
        for pfad, soll in sorted(erwartet.items()):
            try:
                v = umg.kern_knopf(pfad)
            except Exception:   # noqa: BLE001
                v = None
            felder.append({"pfad": pfad, "erwartet": soll, "kern_sagt": v, "ok": v is not None and abs(v - soll) <= KNOPF_TOLERANZ})
        return felder
    while True:
        felder = lies()
        if all(f["ok"] for f in felder) or umg.jetzt() - t0 >= frist_s:
            break
        umg.schlaf(SCHRITT_S / 2)
    return {"felder": felder, "gewartet_s": round(umg.jetzt() - t0, 2), "frist_s": frist_s, "ok": all(f["ok"] for f in felder)}


def inhalt(doc) -> dict:
    """What the compared document actually holds (so a report shows the comparison had real changes to lose)."""
    spuren = doc.get("spuren", []) if isinstance(doc, dict) else []
    clips = [c for s in spuren for c in s.get("clips", [])]
    return {"rev": doc.get("rev") if isinstance(doc, dict) else None, "spuren": len(spuren),
            "clips": [{"id": c.get("id"), "start_beat": c.get("start_beat"), "noten": len(c.get("noten", []))} for c in clips],
            "fader_db": [s.get("fader_db") for s in spuren], "pan": [s.get("pan") for s in spuren]}


def _aufnahme_befunde(a: dict) -> list:
    b = []
    if not a["laufdatei_gefunden"]:
        b.append("recording: no run file found after the page server kill")
    if not a["laufdatei_entfernt"]:
        b.append("recording: the run file is still there after the final reopen")
    if a["take_dauer_s"] is None:
        b.append("recording: no recovered take WAV after the final reopen")
    elif a["take_dauer_s"] < a["verstrichen_s"]:
        b.append(f"recording: take shorter than the time between REC start and kill ({a['take_dauer_s']} s < {a['verstrichen_s']} s)")
    if not a["als_wiederhergestellt_gelistet"]:
        b.append("recording: the take is not listed as recovered")
    return b


def _verlust_text(eintrag: dict) -> list:
    """What exactly was lost at one kill, in words."""
    t = []
    for p in eintrag["pfade_platte"]:
        t.append(f"project.json {p}")
    for p in eintrag["pfade_aktuell"]:
        t.append(f"GET /proj/aktuell {p}")
    kn = eintrag["knopf"]
    if kn is not None and not kn["ok"]:
        for f in kn["felder"]:
            if not f["ok"]:
                t.append(f"knob {f['pfad']} acknowledged {f['erwartet']}, core says {f['kern_sagt']}")
    return t


def lauf(umg: Umgebung, plan=KILL_PLAN, schritte=SCHRITTE, aufnahme: bool = False) -> tuple:
    """Drive the session, kill at the fixed points, compare. Returns (exit code, report dict).
    aufnahme: the recording step follows the notes and the page server kill falls into the running recording. The take is NOT stopped
    for the reopen: the restarted page server meets a core that still writes. The test stops it only at the very end of the run."""
    bericht = {"projekt": PROJEKT_NAME, "kills": [], "verloren": False, "befunde": [], "ausgang": None}
    rec_start = rec_kill = None
    rec_vor = None
    rec_laeuft = False
    waise: list = []
    if aufnahme:
        schritte = tuple(x for n in schritte for x in ((n, "aufnahme") if n == "noten" else (n,)))
        plan = tuple(Kill(k.name, k.einheit, "aufnahme") if k.einheit == "oberflaeche" else k for k in plan)
    ack: Optional[dict] = None
    knopf_ack: dict = {}
    nach = {k.nach: k for k in plan}
    try:
        for name in schritte:
            e = umg.schritt(name)
            if e.projekt is None:
                raise Einrichtungsfehler(f"step {name}: no project document of the acknowledged answer, nothing to compare against")
            ack = e.projekt
            if name == "aufnahme":
                rec_start = e.rec_start if e.rec_start is not None else umg.jetzt()
                umg.schlaf(AUFNAHME_VOR_KILL_S)
            if e.knoepfe:
                knopf_ack.update(e.knoepfe)
            k = nach.get(name)
            if k is None:
                continue
            vor = {u: umg.restarts(u) for u in ALLE_EINHEITEN}
            if vor.get(k.einheit) is None:
                raise Einrichtungsfehler(f"{k.einheit}: NRestarts unknown before the kill")
            alt_gen = umg.kern_generation()
            pid = umg.kill(k.einheit)
            kill_zeit = umg.jetzt()
            bereit, sek, befund = _bereit(umg, k, vor[k.einheit], alt_gen)
            eintrag = {"kill": k.name, "einheit": k.einheit, "nach_schritt": name, "pid": pid, "bereit": bereit,
                       "bereit_nach_s": round(sek, 2), "restarts_vor": vor[k.einheit], "restarts_nach": umg.restarts(k.einheit),
                       "restarts_alle_vor": vor, "restarts_alle_nach": {u: umg.restarts(u) for u in ALLE_EINHEITEN},
                       "pfade_platte": [], "pfade_aktuell": [], "pfade_platte_vor": None, "pfade_aktuell_vor": None,
                       "knopf": None, "befund": befund, "verloren": False}
            bericht["kills"].append(eintrag)
            if not bereit:
                eintrag["verloren"] = None   # not measurable
                bericht["befunde"].extend(befund)
                bericht["ausgang"] = "unit did not come back"
                return 1, bericht
            if aufnahme and name == "aufnahme":
                rec_vor = umg.laufdatei_da()   # the run file must exist before anything touches it
                rec_kill = kill_zeit
                rec_laeuft = True
            if rec_laeuft:   # the restarted unit is back, nothing has opened the project yet: does the core still write?
                waise.append(umg.waise_messen(f"after the {k.name} kill, before the reopen"))
            # state before the reopen (information), then reopen and compare (verdict)
            p0, a0 = umg.platte(), umg.aktuell()
            eintrag["pfade_platte_vor"] = ["<project.json missing>"] if p0 is None else vergleiche(ack, p0, IGNORIERT)
            eintrag["pfade_aktuell_vor"] = ["<no answer>"] if a0 is None else vergleiche(ack, a0, IGNORIERT)
            try:
                umg.oeffnen()
            except Exception as ex:   # noqa: BLE001
                befund.append(f"reopen failed: {ex}")
                eintrag["verloren"] = True
            p1, a1 = umg.platte(), umg.aktuell()
            eintrag["pfade_platte"] = ["<project.json missing>"] if p1 is None else vergleiche(ack, p1, IGNORIERT)
            eintrag["pfade_aktuell"] = ["<no answer>"] if a1 is None else vergleiche(ack, a1, IGNORIERT)
            if eintrag["pfade_platte"] or eintrag["pfade_aktuell"]:
                eintrag["verloren"] = True
            if rec_laeuft:   # orphan take: what the core does with it after this restart and this reopen
                waise.append(umg.waise_messen(f"after the {k.name} kill and the reopen"))
            fr = KNOPF_FRIST_KERN_S if k.einheit == "kern" else KNOPF_FRIST_SONST_S
            eintrag["knopf"] = _knopf_pruefen(umg, knopf_ack, fr)
            kn = eintrag["knopf"]
            if kn is not None and not kn["ok"]:
                eintrag["verloren"] = True   # an acknowledged knob that the core does not have again is a lost change
                for f in kn["felder"]:
                    if not f["ok"]:
                        befund.append(f"knob not refilled: {f['pfad']} acknowledged {f['erwartet']}, core says {f['kern_sagt']} after {kn['gewartet_s']} s")
            if eintrag["verloren"]:
                bericht["verloren"] = True
            bericht["befunde"].extend(f"{k.name}: {b}" for b in befund)
        if rec_laeuft:   # the very end of the run: still growing? then the test stops the take, reopens and looks for the rescue
            waise.append(umg.waise_messen("end of the run, before the test stops the take"))
            umg.aufnahme_beenden()
            rec_laeuft = False
            try:
                umg.oeffnen()
            except Exception as ex:   # noqa: BLE001
                bericht["befunde"].append(f"recording: final reopen failed: {ex}")
            nr = umg.aufnahme_nach_oeffnen()
            ende = next((w["label"] for w in waise if not w["waechst"]), None)
            bericht["aufnahme"] = {"laufdatei_gefunden": rec_vor, "laufdatei_entfernt": nr["laufdatei_entfernt"],
                                   "take_dauer_s": nr["take_dauer_s"], "als_wiederhergestellt_gelistet": nr["als_wiederhergestellt_gelistet"],
                                   "verstrichen_s": round(rec_kill - rec_start, 2), "waise": waise,
                                   "waise_beendet_durch": ende or "nothing: the core kept writing until the test stopped the take"}
            bericht["befunde"].extend(_aufnahme_befunde(bericht["aufnahme"]))
    except Einrichtungsfehler as ex:
        bericht["ausgang"] = f"setup unusable: {ex}"
        bericht["befunde"].append(str(ex))
        return 2, bericht
    finally:
        if rec_laeuft:   # never leave a take running behind an aborted run
            try:
                umg.aufnahme_beenden()
            except Exception:   # noqa: BLE001
                pass
    bericht["ack_inhalt"] = inhalt(ack)
    rec_fehl = "aufnahme" in bericht and bool(_aufnahme_befunde(bericht["aufnahme"]))
    verloren = [f"{k['kill']}: {t}" for k in bericht["kills"] if k["verloren"] for t in (_verlust_text(k) or ["reopen failed"])]
    bericht["ausgang"] = (("changes lost: " + "; ".join(verloren)) if bericht["verloren"] else "no acknowledged change lost") \
        + ("; recording not recovered" if rec_fehl else "")
    return (1 if bericht["verloren"] or rec_fehl else 0), bericht


# ---------------------------------------------------------------- report

def bericht_md(b: dict) -> str:
    z = [f"# Kill test report", "", f"Result: **{b['ausgang']}**", ""]
    for k in b["kills"]:
        z.append(f"## {k['kill']} (`{k['einheit']}`, after step `{k['nach_schritt']}`)")
        z.append(f"- killed pid {k['pid']}; ready: {'yes' if k['bereit'] else 'NO'} after {k['bereit_nach_s']} s; NRestarts {k['restarts_vor']} -> {k['restarts_nach']}")
        z.append(f"- differing paths, project.json after reopen: {k['pfade_platte'] or 'none'}; GET /proj/aktuell after reopen: {k['pfade_aktuell'] or 'none'}")
        if k["pfade_platte_vor"] is not None:
            z.append(f"- before the reopen: project.json {k['pfade_platte_vor'] or 'none'}, GET /proj/aktuell {k['pfade_aktuell_vor'] or 'none'}")
        kn = k["knopf"]
        if kn is None:
            z.append("- knobs: none acknowledged yet at this kill")
        else:
            for f in kn["felder"]:
                z.append(f"- knob `{f['pfad']}`: acknowledged {f['erwartet']}, the core itself reports {f['kern_sagt']} after {kn['gewartet_s']} s ({'ok' if f['ok'] else 'NOT REFILLED'})")
        z.append(f"- lost: {'unknown' if k['verloren'] is None else ('YES' if k['verloren'] else 'no')}")
        z.append("")
    if "ack_inhalt" in b:
        z.append(f"Last acknowledged state compared against: {json.dumps(b['ack_inhalt'], sort_keys=True)}")
    for f in b["befunde"]:
        z.append(f"FINDING: {f}")
    if "aufnahme" in b:
        a = b["aufnahme"]
        z += ["", "## Recording part (page server killed during REC)",
              f"- run file found after the kill: {'yes' if a['laufdatei_gefunden'] else 'NO'}; gone after the reopen: {'yes' if a['laufdatei_entfernt'] else 'NO'}",
              f"- take WAV: {a['take_dauer_s']} s long; REC start to kill: {a['verstrichen_s']} s",
              f"- listed as recovered: {'yes' if a['als_wiederhergestellt_gelistet'] else 'NO'}",
              f"- what ended the orphan take: {a['waise_beendet_durch']}", "- orphan take over the run:"]
        for w in a["waise"]:
            z.append(f"  - {w['label']}: f32 {w['f32_bytes']} bytes, growing {'yes' if w['waechst'] else 'no'}, sidecar {w['status']}, "
                     f"run file {'present' if w['laufdatei_da'] else 'gone'}, recovered records {w['gerettet_saetze']}")
    return "\n".join(z) + "\n"


def schreibe_bericht(b: dict, ordner: str) -> None:
    os.makedirs(ordner, exist_ok=True)
    with open(os.path.join(ordner, "kill_bericht.json"), "w") as f:
        json.dump(b, f, indent=2, sort_keys=True)
    with open(os.path.join(ordner, "kill_bericht.md"), "w") as f:
        f.write(bericht_md(b))


# ---------------------------------------------------------------- djk-start state

def lies_zustand(text: str) -> dict:
    """`djk-start --zustand` unit lines -> {unit: (active, pid, restarts)}."""
    out = {}
    for m in re.finditer(r"^\s+(cypherdj-[a-z0-9-]+)\s+(\S+)\s+pid\s+(\d+)\s+restarts\s+(\d+)", text, re.M):
        out[m.group(1)] = (m.group(2) == "active", int(m.group(3)), int(m.group(4)))
    return out


def lies_ports(text: str) -> dict:
    m = re.search(r"ports\s+kern udp (\d+), leitstand ws (\d+), page (\d+)", text)
    return {} if not m else {"kern": int(m.group(1)), "leitstand": int(m.group(2)), "seite": int(m.group(3))}


# ---------------------------------------------------------------- real instance

def _osc_str(s: str) -> bytes:
    r = s.encode() + b"\0"
    return r + b"\0" * (-len(r) % 4)


def _osc_lies(b: bytes):
    """(address, [values]) for the types i h f d s; None on a malformed packet."""
    try:
        e = b.index(b"\0")
        adr = b[:e].decode("ascii", "replace")
        i = (e + 4) & ~3
        e = b.index(b"\0", i)
        typen = b[i:e].decode("ascii", "replace")
        i = (e + 4) & ~3
        w = []
        for t in typen[1:]:
            if t == "i":
                w.append(struct.unpack_from(">i", b, i)[0]); i += 4
            elif t == "h":
                w.append(struct.unpack_from(">q", b, i)[0]); i += 8
            elif t == "f":
                w.append(struct.unpack_from(">f", b, i)[0]); i += 4
            elif t == "d":
                w.append(struct.unpack_from(">d", b, i)[0]); i += 8
            elif t == "s":
                e = b.index(b"\0", i); w.append(b[i:e].decode("ascii", "replace")); i = (e + 4) & ~3
            else:
                return None
        return adr, w
    except (ValueError, struct.error):
        return None


class KernBeobachter:
    """Subscriber of the instance's core (/k/hallo every second, INTERFACES 4.1): remembers the highest generation seen on
    /k/willkommen and /e/neustart and the generation of the latest /zustand/kern."""
    def __init__(self, kern_port: int):
        self.kern = ("127.0.0.1", kern_port)
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.bind(("127.0.0.1", 0))
        self.s.settimeout(0.2)
        self.port = self.s.getsockname()[1]
        self.gen = None
        self.zustand = (None, 0.0)
        self.regler = {}      # path -> value, as the core reports it on /e/regler in its current generation
        self.stop = False
        self.lock = threading.Lock()
        self.t = threading.Thread(target=self._lauf, daemon=True)
        self.t.start()

    def _lauf(self):
        naechster = 0.0
        while not self.stop:
            if time.monotonic() >= naechster:
                try:
                    self.s.sendto(_osc_str("/k/hallo") + _osc_str(",sii") + _osc_str("kill-test") + struct.pack(">ii", self.port, 1), self.kern)
                except OSError:
                    pass
                naechster = time.monotonic() + 1.0
            try:
                b = self.s.recv(4096)
            except (socket.timeout, OSError):
                continue
            m = _osc_lies(b)
            if m is None:
                continue
            adr, w = m
            with self.lock:
                if adr in ("/k/willkommen", "/e/neustart") and len(w) >= (2 if adr == "/k/willkommen" else 1):
                    g = w[1] if adr == "/k/willkommen" else w[0]
                    if self.gen is not None and g > self.gen:
                        self.regler = {}   # a new generation: the old core's values are history
                    self.gen = g if self.gen is None else max(self.gen, g)
                elif adr == "/e/regler" and len(w) >= 2:
                    self.regler[w[0]] = w[1]
                elif adr == "/zustand/kern" and w:
                    self.zustand = (w[0], time.monotonic())

    def generation(self):
        with self.lock:
            return self.gen

    def knopf(self, pfad):
        with self.lock:
            return self.regler.get(pfad)

    def rec_stopp(self, id_: int):
        """/k/rec/stopp ,hs (id, quelle): the safe direction; ends a running take at the core (INTERFACES 4.12)."""
        self.s.sendto(_osc_str("/k/rec/stopp") + _osc_str(",hs") + struct.pack(">q", id_) + _osc_str("andreas"), self.kern)

    def zustand_generation(self):
        with self.lock:
            g, t = self.zustand
        return g if g is not None and time.monotonic() - t < 2.0 else None

    def schliessen(self):
        self.stop = True
        try:
            self.s.sendto(_osc_str("/k/tschuess") + _osc_str(",s") + _osc_str("kill-test"), self.kern)
        except OSError:
            pass
        self.t.join(timeout=2)
        self.s.close()


class EchteUmgebung(Umgebung):
    def __init__(self, instanz: str, djk: str):
        einheit(instanz, "kern")   # validates the letter
        self.i = instanz
        self.djk = djk
        self.start = os.path.join(djk, "start", "djk-start")
        text = self._zustand_text()
        self.ports = lies_ports(text)
        if not self.ports:
            raise Einrichtungsfehler(f"djk-start --zustand --instanz {instanz} shows no ports: instance not running?")
        if self.ports["seite"] == 47300:
            raise Einrichtungsfehler("refusing: the page port is the live studio's")
        self.url = f"http://127.0.0.1:{self.ports['seite']}"
        self.wurzel = f"/dev/shm/cypherdj-{instanz}"
        self.beo = KernBeobachter(self.ports["kern"])
        self.ids: dict = {}
        self.f32: list = []   # raw take files named by the run file (recording part)
        self.slug = PROJEKT_NAME   # replaced by the slug /proj/neu answers (a name that exists already gets a new slug)

    # time
    def schlaf(self, s): time.sleep(s)
    def jetzt(self): return time.monotonic()

    # HTTP
    def http(self, methode, pfad, body=None, timeout=30):
        r = urllib.request.Request(self.url + pfad, method=methode, data=None if body is None else json.dumps(body).encode(),
                                   headers={"x-djk-quelle": "andreas", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=timeout) as x:
                raw = x.read()
                return x.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(errors="replace")[:300]

    def _zustand_text(self) -> str:
        return subprocess.run([self.start, "--zustand", "--instanz", self.i], capture_output=True, text=True, timeout=30).stdout

    def _z(self, einh):
        u = einheit(self.i, einh)
        z = lies_zustand(self._zustand_text()).get(u)
        if z is not None:
            return z
        # djk-start --zustand lists only its four units; a host unit (djk-instrumente) is read from systemd directly
        o = subprocess.run(["systemctl", "--user", "show", "-p", "ActiveState", "-p", "MainPID", "-p", "NRestarts", u + ".service"],
                           capture_output=True, text=True, timeout=15).stdout
        d = dict(l.split("=", 1) for l in o.splitlines() if "=" in l)
        if "NRestarts" not in d:
            return None
        return d.get("ActiveState") == "active", int(d.get("MainPID") or 0), int(d["NRestarts"])

    def restarts(self, einh):
        z = self._z(einh)
        return None if z is None else z[2]

    def aktiv(self, einh):
        z = self._z(einh)
        return bool(z and z[0])

    def kill(self, einh):
        u = einheit(self.i, einh) + ".service"
        o = subprocess.run(["systemctl", "--user", "show", "-p", "Id", "-p", "MainPID", "-p", "ControlGroup", u],
                           capture_output=True, text=True, timeout=15).stdout
        d = dict(l.split("=", 1) for l in o.splitlines() if "=" in l)
        if d.get("Id") != u or not d.get("ControlGroup", "").endswith("/" + u):
            raise Einrichtungsfehler(f"unit check failed before kill -9: wanted {u}, systemd says {d}")
        pid = int(d.get("MainPID", "0"))
        if pid <= 1:
            raise Einrichtungsfehler(f"{u}: no main pid ({d})")
        os.kill(pid, 9)
        return pid

    def kern_generation(self): return self.beo.generation()
    def zustand_generation(self): return self.beo.zustand_generation()

    def seite_antwortet(self):
        try:
            return self.http("GET", "/lage", timeout=3)[0] == 200
        except (urllib.error.URLError, OSError, ValueError):
            return False

    def oeffnen(self):
        c, d = self.http("POST", "/proj/oeffnen?antwort=kurz", {"slug": self.slug})
        if c != 200:
            raise RuntimeError(f"POST /proj/oeffnen -> {c} {d}")

    def platte(self):
        try:
            with open(os.path.join(self.wurzel, "projekte", self.slug, "project.json")) as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def aktuell(self):
        try:
            c, d = self.http("GET", "/proj/aktuell")
        except (urllib.error.URLError, OSError, ValueError):
            return None
        return d.get("projekt") if c == 200 and isinstance(d, dict) else None

    def kern_knopf(self, pfad):
        v = self.beo.knopf(pfad)
        return float(v) if v is not None else None

    # session
    def _aendern(self, label, befehle):
        c, d = self.http("GET", "/proj/aktuell?nur=rev")
        if c != 200:
            raise Einrichtungsfehler(f"GET /proj/aktuell?nur=rev -> {c}")
        c, d = self.http("POST", "/proj/aendern?antwort=kurz", {"label": label, "rev": d["rev"], "befehle": befehle})
        if c != 200:
            raise Einrichtungsfehler(f"/proj/aendern {label} -> {c} {d}")
        return d

    def _kern_zeigt(self, pfad, nach):
        """The acknowledged value must be visible as the core's own /e/regler report before it counts as acknowledged (bounded)."""
        t0 = time.monotonic()
        while time.monotonic() - t0 < 5:
            v = self.kern_knopf(pfad)
            if v is not None and abs(v - nach) <= KNOPF_TOLERANZ:
                return
            time.sleep(0.1)
        raise Einrichtungsfehler(f"{pfad}: acknowledged by the page, but the core does not report {nach} within 5 s")

    def _spur_nr(self, wer):
        c, d = self.http("GET", "/proj/aktuell")
        return [s["nr"] for s in d["projekt"]["spuren"] if s["name"] == wer][0]

    def _spur(self, wer):
        c, d = self.http("GET", "/proj/aktuell")
        return [s["id"] for s in d["projekt"]["spuren"] if s["name"] == wer][0]

    def schritt(self, name):
        knoepfe = None
        if name == "neu":
            c, d = self.http("POST", "/proj/neu?antwort=kurz", {"name": PROJEKT_NAME}, timeout=60)
            if c != 200 or not isinstance(d, dict) or not d.get("slug"):
                raise Einrichtungsfehler(f"/proj/neu -> {c} {d}")
            self.slug = d["slug"]
        elif name == "spur_audio":
            self._aendern("audio track", [{"befehl": "spur_neu", "art": "audio", "name": "Audio"}])
        elif name == "spur_rb338":
            self._aendern("rb338 track", [{"befehl": "spur_neu", "art": "instrument", "name": "RB", "geraet": {"art": "intern", "name": "rb338"}}])
        elif name == "spur_surge":
            self._aendern("surge track", [{"befehl": "spur_neu", "art": "instrument", "name": "Surge", "geraet": {"art": "wirt", "name": "surge", "slot": 1}}])
        elif name == "clip_midi":
            self.ids["rb"] = self._spur("RB")
            self._aendern("midi clip", [{"befehl": "clip_neu", "spur_id": self.ids["rb"], "art": "midi", "start_beat": 0, "laenge_beats": 16, "name": "Notes"}])
            c, d = self.http("GET", "/proj/aktuell")
            self.ids["clip"] = [x["id"] for s in d["projekt"]["spuren"] if s["id"] == self.ids["rb"] for x in s["clips"]][0]
        elif name == "noten":
            self._aendern("notes", [{"befehl": "noten_neu", "clip_id": self.ids["clip"],
                                     "noten": [{"beat": b, "laenge": 0.5, "ton": 40 + 3 * (b % 4), "vel": 100} for b in range(8)]}])
        elif name == "clip_verschoben":
            self._aendern("clip move", [{"befehl": "clip_aendern", "clip_id": self.ids["clip"], "start_beat": 8}])
        elif name == "knopf":
            self._aendern("knob change", [{"befehl": "spur_aendern", "spur_id": self._spur("Audio"), "fader_db": FADER_DB}])
            pfad = f"spur/{self._spur_nr('Audio')}/fader"
            self._kern_zeigt(pfad, FADER_DB)
            knoepfe = {pfad: FADER_DB}
        elif name == "knopf_antwort":
            self._aendern("second knob", [{"befehl": "spur_aendern", "spur_id": self._spur("Audio"), "pan": PAN}])
            pfad = f"spur/{self._spur_nr('Audio')}/pan"
            self._kern_zeigt(pfad, PAN)
            knoepfe = {pfad: PAN}
        elif name == "aufnahme":
            self._aendern("arm audio", [{"befehl": "spur_aendern", "spur_id": self._spur("Audio"), "eingang": {"art": "intern", "name": "erz/1"}, "arm": True}])
            ende = time.monotonic() + 10   # the core has the arm a few cycles after the page server sent it: retry REC start, bounded
            while True:
                c, d = self.http("POST", "/proj/aufnahme", {"aktion": "start", "von_beat": 0})
                if c == 200:
                    break
                if time.monotonic() >= ende:
                    raise Einrichtungsfehler(f"POST /proj/aufnahme start -> {c} {d}")
                time.sleep(0.5)
            return Ergebnis(projekt=self.aktuell(), rec_start=time.monotonic())
        else:
            raise Einrichtungsfehler(f"unknown step {name}")
        return Ergebnis(projekt=self.aktuell(), knoepfe=knoepfe)

    # recording part
    def _aufn(self) -> str:
        return os.path.join(self.wurzel, "projekte", self.slug, "aufnahmen")

    def _laufdateien(self) -> list:
        try:
            return sorted(n for n in os.listdir(self._aufn()) if n.startswith(".laufend-") and n.endswith(".json"))
        except OSError:
            return []

    def laufdatei_da(self):
        self.f32 = []
        for n in self._laufdateien():
            try:
                with open(os.path.join(self._aufn(), n)) as f:
                    self.f32 += [s["f32"] for s in json.load(f).get("spuren", [])]
            except (OSError, ValueError, KeyError):
                pass
        return bool(self.f32)

    def _f32_bytes(self):
        try:
            return sum(os.path.getsize(f) for f in self.f32 if os.path.exists(f))
        except OSError:
            return -1

    def _sidecar_status(self):
        st = []
        for f in self.f32:
            try:
                with open(f.replace(".f32", ".json")) as x:
                    st.append(json.load(x).get("status"))
            except (OSError, ValueError):
                st.append("missing")
        return ",".join(str(x) for x in st) or "unknown"

    def waise_messen(self, label):
        b0 = self._f32_bytes()
        time.sleep(1.0)   # a measurement, not a wait: does the raw file grow within one second
        b1 = self._f32_bytes()
        try:
            gerettet = sum(1 for n in os.listdir(self._aufn()) if n.startswith(".gerettet-") and n.endswith(".json"))
        except OSError:
            gerettet = 0
        return {"label": label, "f32_bytes": b1, "waechst": b1 > b0 >= 0, "status": self._sidecar_status(),
                "laufdatei_da": bool(self._laufdateien()), "gerettet_saetze": gerettet}

    def aufnahme_beenden(self):
        if not self.f32:
            return   # nothing known to wait for; the check afterwards reports the missing run file
        self.beo.rec_stopp(900000 + int(time.time()) % 90000)
        ende = time.monotonic() + 10
        while time.monotonic() < ende:   # bounded: every raw file that is still there gets a final sidecar (a rescued one is gone)
            try:
                if all(json.load(open(f.replace(".f32", ".json"))).get("status") in ("fertig", "luecken", "abgebrochen") for f in self.f32 if os.path.exists(f)):
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.25)

    def aufnahme_nach_oeffnen(self):
        ende = time.monotonic() + 25   # the rescue runs behind the open: run file gone and a record there, bounded
        rec = None
        while True:
            namen = sorted(n for n in (os.listdir(self._aufn()) if os.path.isdir(self._aufn()) else []) if n.startswith(".gerettet-") and n.endswith(".json"))
            if not self._laufdateien() and namen:
                rec = namen[0]
                break
            if time.monotonic() >= ende:
                break
            time.sleep(0.25)
        dauer, gelistet = None, False
        for n in ([rec] if rec else sorted(x for x in (os.listdir(self._aufn()) if os.path.isdir(self._aufn()) else []) if x.startswith(".gerettet-"))):
            try:
                with open(os.path.join(self._aufn(), n)) as f:
                    r = json.load(f)
                if os.path.exists(os.path.join(self._aufn(), r["datei"])):
                    dauer = round(r["frames"] / AUFNAHME_RATE, 2)
                    gelistet = r.get("format") == "cypherdj-gerettet/1" and r.get("gerettet") is True   # what gerettetListe() of the page server lists
                    break
            except (OSError, ValueError, KeyError):
                pass
        return {"laufdatei_entfernt": not self._laufdateien(), "take_dauer_s": dauer, "als_wiederhergestellt_gelistet": gelistet}

    def schliessen(self):
        self.beo.schliessen()


def vorpruefung(umg: EchteUmgebung) -> None:
    """Readiness of the instance: four units active, the host unit active (started if needed), the page answers 200."""
    text = umg._zustand_text()
    z = lies_zustand(text)
    for u in ("kern", "notbahn", "leitstand", "oberflaeche"):
        s = z.get(einheit(umg.i, u))
        if not s or not s[0]:
            raise Einrichtungsfehler(f"{einheit(umg.i, u)} is not active")
    if not umg.aktiv("wirt-arr1"):  # not in djk-start --zustand
        subprocess.run([os.path.join(umg.djk, "start", "djk-instrumente"), "--instanz", umg.i, "--arr1"], capture_output=True, text=True, timeout=120)
        if not umg.aktiv("wirt-arr1"):
            raise Einrichtungsfehler(f"{einheit(umg.i, 'wirt-arr1')} did not start")
    if not umg.seite_antwortet():
        raise Einrichtungsfehler("the page does not answer 200")
    t0 = time.monotonic()
    while umg.kern_generation() is None and time.monotonic() - t0 < 10:
        time.sleep(0.25)
    if umg.kern_generation() is None:
        raise Einrichtungsfehler("no core generation seen on /k/willkommen within 10 s")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="kill -9 once each on page server, leitstand, core and an instrument host of a test instance")
    ap.add_argument("--instanz", required=True)
    ap.add_argument("--aufnahme", action="store_true", help="also record 8 bars on an armed audio track; the page server kill falls into the recording")
    ap.add_argument("--ausgabe", default=None, help="report folder (default ~/messungen/2026-11-23-release-reliability/kill, with --aufnahme kill-aufnahme)")
    a = ap.parse_args(argv)
    if a.ausgabe is None:
        a.ausgabe = os.path.expanduser("~/messungen/2026-11-23-release-reliability/" + ("kill-aufnahme" if a.aufnahme else "kill"))
    djk = os.environ.get("DJK") or os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    try:
        umg = EchteUmgebung(a.instanz, djk)
    except (ValueError, Einrichtungsfehler) as ex:
        print(f"setup unusable: {ex}", file=sys.stderr)
        return 2
    try:
        vorpruefung(umg)
        code, bericht = lauf(umg, aufnahme=a.aufnahme)
    except Einrichtungsfehler as ex:
        print(f"setup unusable: {ex}", file=sys.stderr)
        return 2
    finally:
        umg.schliessen()
    schreibe_bericht(bericht, a.ausgabe)
    print(bericht_md(bericht))
    return code


if __name__ == "__main__":
    sys.exit(main())
