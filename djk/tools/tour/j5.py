"""J5 tour: the agent plays the studio (journey tours plan, task 6).

Talks to the studio the way a stranger's agent does: through the hand MCP server, started with the command of the one-line
registration (`claude mcp add ... -- node <checkout>/djk/hand/hand.ts --seite <url>`, djk/hand/AUFRUF.md). Steps:

  j5.registrieren   the server starts with the registration command and answers the MCP handshake (the line is in the manual)
  j5.werkzeuge      the tools it lists are as many as the code has (the rule of tests/support/werkzeugzahl.mjs)
  j5.acht_takte     the agent builds eight bars through tool calls: project, kit track, pattern clip
  j5.spielt         transport start; the master level of every one of the eight bars is above -60 dBFS (one reading per bar)
  j5.uebernahme     the human grabs a control the agent is ramping, through /griff: the ramp stops, the agent is refused for
                    the 32 beat hold and may write again after it; a fader and the tempo are taken over by the human as well
  j5.stopp_cypher   Stop Cypher: only the human may press it; the agent's writes are refused, the human's pass; release

Run: `python3 djk/tools/tour/j5.py --instanz b [--kurz]`. The instance is started and stopped by the runner.
"""
import argparse
import math
import os
import sys
import time

try:
    from . import runner as L
except ImportError:  # run as a script
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    from tour import runner as L

REGISTRIERUNG = "djk/hand/hand.ts --seite"
LIVE_URL = "http://127.0.0.1:47300"
FADER, FILTER = "deck/1/fader", "deck/1/filter"      # the three controls of the takeover: a mixer fader, a filter knob, the tempo
MUSTER = 's("bd*4, ~ hh ~ hh")'                      # kit sounds every kit of the starter stage has
TAKTE = 8


def code_zahl(quelle=None):
    """Tools in hand.ts: one entry per line that starts with `  { name: '` (the counting rule of werkzeugzahl.mjs)."""
    quelle = quelle or os.path.join(L.DJK, "hand", "hand.ts")
    with open(quelle, encoding="utf-8") as f:
        return sum(1 for z in f.read().split("\n") if z.startswith("  { name: '"))


def live_laut(url):
    """True when the live studio plays (master above the silent threshold). An unreachable studio is quiet."""
    a = L._http(url + "/pegel?sek=1", "GET", None, {}, 3)
    db = L.dauerlauf.master_db(a.j) if a.code == 200 else None
    return db is not None and db >= L.STUMM_DB


def _ok(r, was):
    """A tool answer that is an error is a red step with the page's reason."""
    if r.get("_fehler"):
        raise RuntimeError(f"{was} refused: {r.get('fehler') or r.get('rpc') or r.get('text')}")
    return r


def _verweigert(hand, name, args):
    """A tool call that is expected to be refused. `Hand.rufe(erwartet=...)` matches code, status and grund of the answer, but the hand
    names the reason `fehler` (ki_gestoppt, regler_beim_menschen), so it cannot declare this refusal: the call goes through the
    hand without the tour, and the step judges the answer itself."""
    tour, hand.tour = hand.tour, None
    try:
        return hand.rufe(name, args)
    finally:
        hand.tour = tour


def _nahe(a, b, tol=0.15):
    return isinstance(a, (int, float)) and abs(a - b) <= tol


def schritte(t, befehl=None, live_url=LIVE_URL, frist_s=6.0, tempo_frist_s=30.0, anlauf_s=12.0):
    """The J5 steps. `befehl` replaces the registration command (tests), the rest are deadlines."""
    z = {"hand": None, "bpm": 120.0, "projekt": False}
    try:
        _schritte(t, z, befehl, live_url, frist_s, tempo_frist_s, anlauf_s)
    finally:
        _aufraeumen(t, z)


def _lage(t):
    a = t.ruf("GET", "/lage")
    return a.j if a.code == 200 and isinstance(a.j, dict) else {}


def _schritte(t, z, befehl, live_url, frist_s, tempo_frist_s, anlauf_s):
    with t.schritt("j5.registrieren", "the hand server starts with the registration command and answers the handshake", pflicht=True) as w:
        with open(os.path.join(L.DJK, "hand", "AUFRUF.md"), encoding="utf-8") as f:
            if REGISTRIERUNG not in f.read():
                t.rot(f"the registration line `{REGISTRIERUNG} <url>` is not in AUFRUF.md")
        w["befehl"] = " ".join(befehl or L.Hand.standardbefehl(t.instanz.url))
        z["hand"] = L.Hand(t.instanz, befehl=befehl, tour=t)
    hand = z["hand"]

    with t.schritt("j5.werkzeuge", "the tools the server lists are as many as the code has") as w:
        namen = hand.werkzeuge()
        code = code_zahl()
        w.update(gelistet=len(namen), im_code=code)
        if len(set(namen)) != len(namen):
            t.rot("a tool name is listed twice")
        if len(namen) != code:
            t.rot(f"the server lists {len(namen)} tools, hand.ts has {code}")

    with t.schritt("j5.acht_takte", f"the agent builds {TAKTE} bars through tool calls: project, kit track, pattern clip", pflicht=True) as w:
        _ok(hand.rufe("proj_neu", {"name": f"tour-j5-{int(time.time())}"}), "proj_neu")
        z["projekt"] = True
        kits = [k.get("name") for k in (_ok(hand.rufe("proj_kits"), "proj_kits").get("kits") or []) if isinstance(k, dict)]
        if not kits:
            raise RuntimeError("proj_kits lists no kit: the kits stage did not fill the kit folder")
        kit = "starter" if "starter" in kits else kits[0]
        _ok(hand.rufe("proj_aendern", {"label": "J5 tour: kit track", "befehle": [
            {"befehl": "spur_neu", "art": "instrument", "geraet": {"art": "intern", "name": "kit", "kit": kit}}]}), "proj_aendern spur_neu")
        projekt = _ok(hand.rufe("proj_lage"), "proj_lage").get("projekt") or {}
        spuren = projekt.get("spuren") or []
        if not spuren:
            raise RuntimeError("the project has no track after spur_neu")
        z["bpm"] = float(projekt.get("tempo_bpm") or 120.0)
        m = _ok(hand.rufe("proj_muster", {"spur_id": spuren[-1]["id"], "start_beat": 0, "takte": TAKTE, "code": MUSTER}), "proj_muster")
        clip = (m.get("muster") or [{}])[0]
        w.update(kit=kit, spur=spuren[-1]["id"], takte=clip.get("takte"), noten=clip.get("noten_zahl"), tempo_bpm=z["bpm"])
        if clip.get("takte") != TAKTE:
            t.rot(f"the clip is {clip.get('takte')} bars long, expected {TAKTE}")
        elif not clip.get("noten_zahl"):
            t.rot("the clip holds no notes")

    with t.schritt("j5.spielt", f"transport start; the master level is above -60 dBFS in each of the {TAKTE} bars") as w:
        if live_laut(live_url):
            t.skip("the live studio is playing music: no sound step", ursache="live")
        _ok(hand.rufe("proj_transport", {"aktion": "start"}), "proj_transport start")
        def laut():
            db = L.dauerlauf.master_db(t.ruf("GET", "/pegel?sek=1", timeout=10).j)
            return db is not None and db >= L.STUMM_DB

        if not t.warte_bis(laut, anlauf_s, "the master to sound after the start"):
            t.rot("the master stayed silent after the transport start")
        else:
            # the clip starts on a bar: the bar that holds the first sound is bar 1. One reading per bar, taken when the master clock
            # reaches the end of the bar; its window is floor(bar seconds) long (1..10 s), so it never reaches back into the bar before.
            beat = (_lage(t).get("uhr") or {}).get("beat")
            bpm = (_lage(t).get("uhr") or {}).get("bpm") or z["bpm"]
            if beat is None:
                raise RuntimeError("/lage has no master beat")
            start = math.floor(beat / 4) * 4
            sek = max(1, min(10, math.floor(4 * 60.0 / bpm)))
            takte = []
            for k in range(TAKTE):
                ende = start + 4 * (k + 1)
                if not t.warte_bis(lambda: ((_lage(t).get("uhr") or {}).get("beat") or 0) >= ende, 4 * 60.0 / bpm * 2 + 5, f"the clock to reach the end of bar {k + 1}"):
                    raise RuntimeError(f"the master clock did not reach the end of bar {k + 1}")
                a = t.ruf("GET", f"/pegel?sek={sek}", timeout=10)
                db = L.dauerlauf.master_db(a.j) if a.code == 200 else None
                takte.append(round(db, 1) if db is not None else None)
            w.update(fenster_s=sek, takt_max_db=takte)
            stumm = [k + 1 for k, db in enumerate(takte) if db is None or db < L.STUMM_DB]
            if stumm:
                t.rot(f"the master is silent in bar {', '.join(map(str, stumm))} of {TAKTE} (max dB per bar: {takte})")

    with t.schritt("j5.uebernahme", "the human grabs a ramping control (hold, refusal, release), and takes over a fader and the tempo") as w:
        probleme = []

        def lies_regler(pfad):
            return (_lage(t).get("regler") or {}).get(pfad)

        def uebernimm(name, setze_agent, setze_mensch, lies, agent_wert, mensch_wert, frist):
            try:
                _ok(setze_agent(), f"agent {name}")
                if not t.warte_bis(lambda: _nahe(lies(), agent_wert), frist, f"{name} to follow the agent"):
                    raise RuntimeError(f"{name} did not follow the agent to {agent_wert}")
                a = setze_mensch()
                if not a.ok:
                    raise RuntimeError(f"human {name} refused: {a.code} {a.grund}")
                if not t.warte_bis(lambda: _nahe(lies(), mensch_wert), frist, f"{name} to take the human value"):
                    raise RuntimeError(f"{name} did not take the human value {mensch_wert} (reads {lies()})")
                time.sleep(0.5)
                if not _nahe(lies(), mensch_wert):
                    raise RuntimeError(f"{name} did not keep the human value {mensch_wert} (reads {lies()})")
                w[name] = {"agent": agent_wert, "mensch": mensch_wert}
            except Exception as e:  # noqa: BLE001 - every control is tried, the step lists what failed
                probleme.append(f"{name}: {e}")

        def regler_mensch(pfad, nach):
            return t.ruf("POST", "/regler", {"pfad": pfad, "nach": nach, "takte": 0}, quelle="andreas")

        # the agent cannot open a closed channel (kein_hoerschein): the human opens the fader first, then the agent moves it
        a = regler_mensch(FADER, -20)
        if not a.ok or not t.warte_bis(lambda: _nahe(lies_regler(FADER), -20), frist_s, "the fader to open"):
            probleme.append(f"fader: the human could not open {FADER}: {a.code} {a.grund}")
        else:
            uebernimm("fader", lambda: hand.rufe("regler", {"pfad": FADER, "nach": -14, "takte": 0}), lambda: regler_mensch(FADER, -26),
                      lambda: lies_regler(FADER), -14, -26, frist_s)
        try:
            _filter_griff(t, hand, w, frist_s)
        except Exception as e:  # noqa: BLE001
            probleme.append(f"filter: {e}")
        uebernimm("tempo", lambda: hand.rufe("tempo", {"bpm": 126}),
                  lambda: t.ruf("POST", "/tempo", {"bpm": 124}, quelle="andreas"),
                  lambda: (_lage(t).get("uhr") or {}).get("bpm"), 126, 124, tempo_frist_s)
        if probleme:
            t.rot("; ".join(probleme))

    with t.schritt("j5.stopp_cypher", "Stop Cypher: the agent's writes are refused, the human's pass, the release clears it") as w:
        a = t.ruf("POST", "/taste", {"name": "stopp"}, quelle="cypher", erwartet={403})
        if a.code != 403 or a.grund != "nur_hand":
            t.rot(f"the agent pressed Stop Cypher: expected 403 nur_hand, got {a.code} {a.grund}")
        b = t.ruf("POST", "/taste", {"name": "stopp"}, quelle="andreas", erwartet={409})   # 409 pruefmodus_aus is judged below
        if b.code == 409 and b.grund == "pruefmodus_aus":
            t.skip("needs pruefmodus: the core runs without test mode, the page's hand key does not arrive")
        try:
            if not b.ok:
                raise RuntimeError(f"the human's Stop Cypher was refused: {b.code} {b.grund}")
            if not t.warte_bis(lambda: (_lage(t).get("ki") or {}).get("gestoppt") is True, 5.5, "ki.gestoppt to show"):
                t.rot("/lage did not show ki.gestoppt within 5 s")
            for name, args in (("regler", {"pfad": FILTER, "nach": 0.2, "takte": 0}), ("tempo", {"bpm": 122})):
                r = _verweigert(hand, name, args)
                w[f"agent_{name}"] = r.get("fehler") if r.get("_fehler") else "accepted"
                if not (r.get("_fehler") and r.get("fehler") == "ki_gestoppt"):
                    t.rot(f"the agent's {name} was not refused with ki_gestoppt after Stop Cypher (answer: {r})")
            h = t.ruf("POST", "/regler", {"pfad": FILTER, "nach": 0.6, "takte": 0}, quelle="andreas")
            w["mensch_regler"] = h.code
            if not h.ok or ((h.j or {}).get("quittung") or {}).get("status") == 6:
                t.rot(f"the human's /regler was refused during Stop Cypher: {h.code} {h.grund}")
        finally:
            f = t.ruf("POST", "/taste", {"name": "freigabe"}, quelle="andreas")
            if not t.warte_bis(lambda: (_lage(t).get("ki") or {}).get("gestoppt") is False, 5.5, "ki.gestoppt to clear"):
                t.rot(f"the release did not clear ki.gestoppt (freigabe answered {f.code})")
        r = hand.rufe("regler", {"pfad": FILTER, "nach": 0.5, "takte": 0})
        if r.get("_fehler"):
            t.rot(f"the agent's write is still refused after the release: {r.get('fehler')}")


HALTE_BEATS = 32      # the hand keeps a control for this many beats after the last movement (INTERFACES.md 7.3 item 4)


def _filter_griff(t, hand, w, frist_s):
    """The way a person takes over: the agent ramps the filter over several bars, the human grabs it through /griff (two values
    more than 3/128 apart: the first only sets the position, the second leaves the dead zone and takes over). Then (a) the ramp has
    stopped, (b) the agent's write inside the hold is refused, (c) after the hold the agent may write again."""
    def beat():
        return (_lage(t).get("uhr") or {}).get("beat")

    def wert():
        return (_lage(t).get("regler") or {}).get(FILTER)

    ziel, takte = 0.9, 8
    bpm = (_lage(t).get("uhr") or {}).get("bpm") or 120
    b_ruf = beat()
    _ok(hand.rufe("regler", {"pfad": FILTER, "nach": ziel, "takte": takte}), "agent ramp")
    if not t.warte_bis(lambda: wert() is not None and wert() >= 0.2, frist_s + takte * 4 * 60.0 / bpm, "the ramp to run"):
        raise RuntimeError("the agent's ramp did not move the filter")
    b_ende = math.ceil(b_ruf / 4) * 4 + 4 * takte          # the ramp starts on the next bar
    for u in (0.3, 0.4):
        a = t.ruf("POST", "/griff", {"pfad": FILTER, "u": u}, quelle="andreas")
        if not a.ok:
            raise RuntimeError(f"the human's grab was refused: {a.code} {a.grund}")
    b_griff = beat()
    if not t.warte_bis(lambda: beat() >= b_griff + 2, 10, "two beats after the grab"):
        raise RuntimeError("the master clock stopped")
    # (b) inside the hold the agent is refused, and the refusal changes nothing
    r = _verweigert(hand, "regler", {"pfad": FILTER, "nach": 0.5, "takte": 0})
    w["agent_im_halt"] = r.get("fehler") if r.get("_fehler") else "accepted"
    if not (r.get("_fehler") and r.get("fehler") == "regler_beim_menschen"):
        raise RuntimeError(f"the agent's write inside the hold was not refused with regler_beim_menschen (answer: {r})")
    # (a) the value stays the human's for the rest of the ramp time
    ref = wert()
    proben = []

    def probe():
        v = wert()
        if v is not None:
            proben.append(v)
        return (beat() or 0) >= b_ende + 1

    t.warte_bis(probe, (b_ende - b_griff + 4) * 60.0 / bpm + 10, "the end of the ramp time")
    w.update(halter_wert=ref, proben=len(proben), letzter=proben[-1] if proben else None, rampenziel=ziel)
    if ref is None or not proben:
        raise RuntimeError("the filter value could not be read")
    if max(abs(v - ref) for v in proben) > 0.15 or abs(proben[-1] - ziel) < 0.3:
        raise RuntimeError(f"the ramp went on after the human's grab (held {ref}, then {min(proben)}..{max(proben)}, target {ziel})")
    # (c) after the hold the agent may write again
    b_frei = {}

    def frei():
        if hand.rufe("regler", {"pfad": FILTER, "nach": 0.5, "takte": 0}).get("_fehler"):
            return False
        b_frei["beat"] = beat()
        return True

    if not t.warte_bis(frei, HALTE_BEATS * 60.0 / bpm * 2 + 5, "the hold to end"):
        raise RuntimeError("the agent is still refused long after the hold")
    gehalten = (b_frei["beat"] or 0) - b_griff
    w["halt_beats"] = round(gehalten, 1)
    if gehalten < HALTE_BEATS - 4:
        raise RuntimeError(f"the hold ended after {gehalten:.1f} beats, expected about {HALTE_BEATS}")


def _aufraeumen(t, z):
    """Closes the hand, and leaves nothing behind: transport stopped, fader closed (as the human: the agent cannot stop his transport)."""
    if z.get("hand") is not None:
        z["hand"].ende()
    if z.get("projekt"):
        t.ruf("POST", "/proj/transport", {"aktion": "stopp"}, quelle="andreas")
        t.ruf("POST", "/regler", {"pfad": FADER, "nach": -200, "takte": 0}, quelle="andreas")
    t.ruf("POST", "/taste", {"name": "freigabe"}, quelle="andreas")   # never leave the studio stopped (a no-op when it is free)


def main(argv=None):
    p = argparse.ArgumentParser(description="J5 tour: the agent plays the studio")
    p.add_argument("--instanz", required=True, help="test instance b..f")
    p.add_argument("--kurz", action="store_true")
    p.add_argument("--ausgabe", default=os.path.expanduser("~/messungen/2026-11-23-tour/j5"))
    a = p.parse_args(argv)
    with L.Instanz(a.instanz) as inst:
        return L.Tour("j5", inst, a.ausgabe, kurz=a.kurz).fuehre(schritte)


if __name__ == "__main__":
    sys.exit(main())
