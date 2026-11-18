# apc_production.py: the Akai APC20 as the project mixer while the main window shows PRODUCTION (2026-11-18, Andreas: "nun richten wir den apc 20 ein
# für das production fenster"). Otherwise the APC20 stays the DJ console (pult.json channels 1..8, forwarded unchanged by pult_bridge.py).
#
# Source of the mode, the bank and the tracks: GET /controller/pult (djk/ui/areas/controller/pult_production.ts), polled four times a second.
# Columns 1..8 are the tracks of the bank in front (8 tracks per bank, in track order). What a control does in PRODUCTION:
#   fader n          -> channel 16 CC <track nr>        kern row spur/<nr>/fader (pult.json; soft takeover in the kern: the first value only primes)
#                       The fader position is read with the taper of the page (ANKER, the same anchors as djk/ui/public/production/fader_curve.js;
#                       tests/test_apc_production.py compares them) and sent as dB on a linear -60..+6 dB scale (pult.json kurve linear, kill_unter_min):
#                       a fader at half travel is where the head's fader is at half travel (Andreas 2026-11-18: "kanal 1 fader mittig, anzeige 90%"; the
#                       kern's own fader_db curve put 0 dB at half travel, the page at 85 %).
#   master fader     -> channel 16 CC 100               pm/fader (project master)
#   activator n      -> channel 16 note <track nr>      spur/<nr>/mute (a press toggles)
#   solo/cue n       -> channel 16 note 64 + <nr>       spur/<nr>/solo
#   record arm n     -> POST /controller/pult/arm {nr}  the arm of the track (a project command; the kern has no row for it)
#   Shift + PLAY / STOP -> channel 16 note 120          arr/start_stopp (the kern's own hand start/stop of the arrangement), only when it changes something
#   Shift + LEFT / RIGHT -> POST /controller/pult/bank {schritt}
#   Shift + UP / DOWN    -> POST /controller/fokus {spur_id} of the previous / next track: the track in front, the synths and the window follow
#   clip grid, clip stop, scene launch, cue level: nothing for now (dropped, so they do not play decks)
# The Shift functions come as a burst of CC 16..23 with value 0 on the channel of the function (1 play, 2 stop, 3 rec, 4 MIDI overdub, 5 left, 6 right,
# 7 up, 8 down, 9 note mode); taken from an APC20 MIDI description Andreas gave on 2026-11-18, not yet measured on the unit. Only CC 16 triggers.
# LEDs per column: activator lit = muted, solo lit = soloed, record arm lit = armed; the clip grid is dark in PRODUCTION.
import json
import queue
import threading
import urllib.request

SEITE = "http://127.0.0.1:47300"
KANAL16 = 0x0F
MASTER_CC = 100
SOLO_AB = 64
START_STOPP_NOTE = 120
ARM, SOLO, AKTIVATOR = 48, 49, 50
CLIP_NOTEN = (52, 53, 54, 55, 56, 57)       # clip stop + the five clip rows, per column
SZENEN = (82, 83, 84, 85, 86)               # scene launch, channel 1
FUNKTION = {0: "play", 1: "stop", 4: "links", 5: "rechts", 6: "hoch", 7: "runter"}   # channel (0-based) of a Shift burst -> function
LED_AN = 127
ANKER = [(0, -200), (0.05, -60), (0.2, -40), (0.4, -24), (0.6, -12), (0.72, -6), (0.85, 0), (1, 6)]   # position 0..1 -> dB (fader_curve.js)
DB_MIN, DB_MAX = -60.0, 6.0   # the linear scale of the channel 16 fader entries in pult.json


def db_von_pos(p):
    """Fader position 0..1 -> dB on the page's taper (-200 = off). Pure."""
    if p <= 0:
        return -200.0
    if p >= 1:
        return ANKER[-1][1]
    for (p0, d0), (p1, d1) in zip(ANKER, ANKER[1:]):
        if p <= p1:
            return d0 + (p - p0) / (p1 - p0) * (d1 - d0)
    return ANKER[-1][1]


def fader_cc(roh):
    """The APC fader value 0..127 -> the CC value for the linear -60..+6 dB entry (0 = off). Pure."""
    db = db_von_pos(roh / 127.0)
    if db <= DB_MIN:
        return 0
    return max(1, min(127, round((db - DB_MIN) / (DB_MAX - DB_MIN) * 127)))


def _anfrage(pfad, body=None):
    req = urllib.request.Request(SEITE + pfad, data=None if body is None else json.dumps(body).encode(),
                                 method="GET" if body is None else "POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=1.0) as r:
        return json.loads(r.read() or b"{}")


def uebersetze(data, lage):
    """What an APC20 message does in PRODUCTION: a list of ("kern", bytes) and ("http", path, body) / ("fokus", step) actions; [] drops it. Pure."""
    if len(data) != 3:
        return []
    typ, ch, nr, wert = data[0] & 0xF0, data[0] & 0x0F, data[1], data[2]
    spalten = lage.get("spalten") or []
    spur = spalten[ch] if ch < len(spalten) else None
    if typ == 0xB0:
        if nr == 7 and ch < 8:
            return [("kern", bytes([0xB0 | KANAL16, spur["nr"], fader_cc(wert)]))] if spur else []
        if nr == 14 and ch == 0:
            return [("kern", bytes([0xB0 | KANAL16, MASTER_CC, fader_cc(wert)]))]
        if nr == 16 and wert == 0 and ch in FUNKTION:
            f = FUNKTION[ch]
            laeuft = bool(lage.get("laeuft"))
            if f == "play":
                return [] if laeuft else _start_stopp()
            if f == "stop":
                return _start_stopp() if laeuft else []
            if f in ("links", "rechts"):
                return [("http", "/controller/pult/bank", {"schritt": -1 if f == "links" else 1})]
            return [("fokus", -1 if f == "hoch" else 1)]
        return []
    if typ in (0x80, 0x90) and ch < 8 and spur:
        an = typ == 0x90 and wert > 0
        if nr == AKTIVATOR:
            return [("kern", bytes([(0x90 if an else 0x80) | KANAL16, spur["nr"], 127 if an else 0]))]
        if nr == SOLO:
            return [("kern", bytes([(0x90 if an else 0x80) | KANAL16, SOLO_AB + spur["nr"], 127 if an else 0]))]
        if nr == ARM and an:
            return [("http", "/controller/pult/arm", {"nr": spur["nr"]})]
    return []


def _start_stopp():
    return [("kern", bytes([0x90 | KANAL16, START_STOPP_NOTE, 127])), ("kern", bytes([0x80 | KANAL16, START_STOPP_NOTE, 0]))]


def leds(lage):
    """{(channel, note): velocity} the APC20 shows in PRODUCTION: the three track buttons per column, the clip grid and scenes dark. Pure."""
    aus = {}
    spalten = lage.get("spalten") or []
    for ch in range(8):
        s = spalten[ch] if ch < len(spalten) else None
        aus[(ch, AKTIVATOR)] = LED_AN if s and s.get("mute") else 0
        aus[(ch, SOLO)] = LED_AN if s and s.get("solo") else 0
        aus[(ch, ARM)] = LED_AN if s and s.get("arm") else 0
        for n in CLIP_NOTEN:
            aus[(ch, n)] = 0
    for n in SZENEN:
        aus[(0, n)] = 0
    return aus


def nachbar(spuren, jetzt, schritt):
    """The track id `schritt` (+1 / -1) away from `jetzt` in `spuren` ([{id}] in track order); the first track without a current one. Pure."""
    ids = [s["id"] for s in spuren or []]
    if not ids:
        return None
    if jetzt not in ids:
        return ids[0]
    i = ids.index(jetzt) + schritt
    return ids[i] if 0 <= i < len(ids) else None


class ApcProduktion:
    """The PRODUCTION mode of the APC20 inside the pult bridge. `led(bytes)` sends to the APC20; `kern(bytes)` to the kern hand port."""

    def __init__(self, log, led, kern, holen=_anfrage):
        self.log, self.led, self.kern, self.holen = log, led, kern, holen
        self.lage = {}
        self.gezeigt = {}      # (channel, note) -> velocity sent in PRODUCTION
        self.dj_leds = {}      # (channel, note) -> the last LED message of the kern (DJ mapping), replayed when PRODUCTION ends
        self.q = queue.Queue()
        self.gemeldet = set()

    def an(self):
        return bool(self.lage.get("produktion"))

    def starte(self, stop):
        threading.Thread(target=self._abfrage, args=(stop,), daemon=True).start()
        threading.Thread(target=self._arbeit, daemon=True).start()

    def vom_apc(self, data):
        """An APC20 message while PRODUCTION is on: translated (kern messages at once, page server calls in the worker)."""
        for a in uebersetze(data, self.lage):
            if a[0] == "kern":
                self.kern(a[1])
            else:
                self.q.put(a)

    def vom_kern(self, data):
        """An LED message of the kern for the APC20: kept for DJ mode; True when it may go out now (not in PRODUCTION)."""
        if len(data) == 3 and data[0] & 0xF0 in (0x80, 0x90):
            self.dj_leds[(data[0] & 0x0F, data[1])] = bytes(data)
        return not self.an()

    def _zeige(self, neu):
        for (ch, n), v in neu.items():
            if self.gezeigt.get((ch, n)) != v:
                self.led(bytes([0x90 | ch, n, v]))
        self.gezeigt = dict(neu)

    def _abfrage(self, stop):
        while not stop.is_set():
            try:
                neu = self.holen("/controller/pult")
            except (OSError, ValueError):
                neu = None   # page server away: keep the mode as it is
            if isinstance(neu, dict):
                vorher = self.an()
                self.lage = neu
                if self.an():
                    if not vorher:
                        self.log("APC20: PRODUCTION mode (bank", neu.get("bank", 0) + 1, "of", str(neu.get("banken", 1)) + ")")
                        self.gezeigt = {}
                    self._zeige(leds(neu))
                elif vorher:
                    self.log("APC20: DJ mode")
                    self._zeige({k: 0 for k in self.gezeigt})
                    self.gezeigt = {}
                    for m in self.dj_leds.values():
                        self.led(m)
            stop.wait(0.25)

    def _arbeit(self):
        while True:
            a = self.q.get()
            try:
                if a[0] == "http":
                    antwort = self.holen(a[1], a[2])
                    if isinstance(antwort, dict) and "spalten" in antwort:
                        self.lage = antwort   # the new bank or arm state at once, not only at the next poll
                        if self.an():
                            self._zeige(leds(antwort))
                elif a[0] == "fokus":
                    jetzt = (self.holen("/controller/fokus").get("fokus") or {}).get("spur_id")
                    ziel = nachbar(self.lage.get("spuren"), jetzt, a[1])
                    if ziel:
                        self.holen("/controller/fokus", {"spur_id": ziel})
            except (OSError, ValueError) as e:
                if str(a) not in self.gemeldet:
                    self.gemeldet.add(str(a))
                    self.log("APC20: page server call failed:", a[1], e)
