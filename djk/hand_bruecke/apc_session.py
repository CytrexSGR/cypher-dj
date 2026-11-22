# apc_session.py: the Akai APC20 as the launch grid while the loop deck pop-up is open (2026-11-22, session view S1, decision D12; the pop-up replaced the SESSION view).
# In every other view the APC20 stays the DJ console (pult.json channels 1..8, forwarded unchanged by pult_bridge.py); in PRODUCTION it is the
# project mixer (apc_production.py). Source of the grid: GET /session/stand (SessionStand, polled four times a second while the pop-up is open);
# commands: POST /session/start|stopp|szene with the header x-djk-quelle: andreas.
#
#   clip grid (notes 53..57, channels 1..8)  -> POST /session/start {spur_id, zelle}   column = window column + channel, cell = window row + row;
#                                               on the playing cell POST /session/stopp {spur_id} (toggle)
#   clip stop (note 52, channel c)           -> POST /session/stopp {spur_id}           of that column
#   scene launch (notes 82..86, channel 1)   -> POST /session/szene {zeile}            the window row + 1..5
#   stop all clips (note 81, channel 1)      -> POST /session/stopp {}
#   Shift + LEFT / RIGHT / UP / DOWN         -> the window: 8 columns x 5 rows over the stand (columns 0..n-8, rows 0..3)
#   everything else (faders, activator, solo, master, cue level, Shift + PLAY / STOP) is not taken and goes the DJ console way.
# Columns are the stand's columns in container order, the parked loop decks (stand["geparkt"]) last. A cell is `None` (empty), `{halten: true}`
# (empty, "leave the column as it is" in a scene) or a cell. LED velocities (APC40 rev 1): 0 off, 1 green = playing, 2 green blink = start
# pending, 4 red blink = stop pending, 5 yellow = filled. The scene LED is green while its row has a playing cell. No live project: the stand
# is None and the grid stays dark. Not measured on the unit (the Shift burst decoding is the one of apc_production.py).
import json
import queue
import threading
import urllib.error
import urllib.request

from apc_production import FUNKTION, SZENEN

SEITE = "http://127.0.0.1:47300"
KOPF = {"x-djk-quelle": "andreas"}
STOPP = 52
GITTER = (53, 54, 55, 56, 57)               # the five clip rows of a column
ALLE_STOPP = 81                             # stop all clips, channel 1
SPALTEN, ZEILEN = 8, 5                      # the window
MAX_ZEILE0 = 3                              # 8 scene rows - 5 visible
PFEILE = ("links", "rechts", "hoch", "runter")
BURST_CC = range(16, 24)


def spalten_von(stand):
    """The columns of a stand in order: the containers' columns, then the parked ones. [] without a stand. Pure."""
    if not isinstance(stand, dict):
        return []
    aus = [s for c in stand.get("container") or [] for s in c.get("spalten") or []]
    for gruppe in stand.get("geparkt") or []:
        aus.extend(gruppe)
    return [s for s in aus if isinstance(s, dict) and s.get("spur_id")]   # a column without an id cannot be launched: skipped


def _zelle(spalte, nr):
    """Cell number nr (1-based) of a column: a dict, or None when empty or out of range."""
    z = spalte.get("zellen") or []
    return z[nr - 1] if 1 <= nr <= len(z) else None


def sichtbar(stand, fenster):
    """5 rows x 8 columns of the visible window; fenster = (spalte0, zeile0). A cell is a dict or None. Pure."""
    spalten, (s0, z0) = spalten_von(stand), fenster
    return [[(_zelle(spalten[s0 + c], z0 + r + 1) if s0 + c < len(spalten) else None) for c in range(SPALTEN)] for r in range(ZEILEN)]


def led_farbe(spalte, zeile):
    """LED velocity of cell number `zeile` (1-based) of a column: 0 empty or halten, 5 filled, 1 playing, 2 pending start,
    4 pending stop on the playing cell. Pure."""
    if not spalte:
        return 0
    z = _zelle(spalte, zeile)
    if not z or z.get("halten"):
        return 0
    lauf = spalte.get("lauf") or {}
    wartend = lauf.get("wartend")
    if wartend and wartend.get("zelle") == zeile:
        return 2
    if lauf.get("zelle") == zeile:
        return 4 if wartend and wartend.get("zelle") is None else 1
    return 5


def leds(stand, fenster):
    """(channel 0..7, note, velocity) for the whole grid (53..57 on every channel) and the scene LEDs (82..86, channel 0). Pure."""
    spalten, (s0, z0) = spalten_von(stand), fenster
    aus = []
    for c in range(SPALTEN):
        sp = spalten[s0 + c] if s0 + c < len(spalten) else None
        for r, note in enumerate(GITTER):
            aus.append((c, note, led_farbe(sp, z0 + r + 1)))
    for r, note in enumerate(SZENEN):
        spielt = any((sp.get("lauf") or {}).get("zelle") == z0 + r + 1 for sp in spalten)
        aus.append((0, note, 1 if spielt else 0))
    return aus


def taste(stand, fenster, kanal, note):
    """What a note-on does: (path, body) of a session route, or None (empty cell, no column, no live project). Pure."""
    if not isinstance(stand, dict):
        return None
    spalten, (s0, z0) = spalten_von(stand), fenster
    if note in SZENEN and kanal == 0:
        return ("/session/szene", {"zeile": z0 + note - SZENEN[0] + 1})
    if note == ALLE_STOPP and kanal == 0:
        return ("/session/stopp", {})
    if not (0 <= kanal < SPALTEN) or s0 + kanal >= len(spalten):
        return None
    sp = spalten[s0 + kanal]
    if note == STOPP:
        return ("/session/stopp", {"spur_id": sp.get("spur_id")})
    if note in GITTER:
        nr = z0 + GITTER.index(note) + 1
        z = _zelle(sp, nr)
        if not z or z.get("halten"):
            return None
        if led_farbe(sp, nr) == 1 and not (sp.get("lauf") or {}).get("verwaist"):   # the playing cell: a second press stops its column
            return ("/session/stopp", {"spur_id": sp.get("spur_id")})
        return ("/session/start", {"spur_id": sp.get("spur_id"), "zelle": nr})
    return None


def verschiebe(fenster, funktion, n_spalten):
    """Shift + left / right: the column window by 1, clamped to 0..max(0, n-8); up / down: the row window 0..3. Pure."""
    s0, z0 = fenster
    if funktion == "links":
        s0 -= 1
    elif funktion == "rechts":
        s0 += 1
    elif funktion == "hoch":
        z0 -= 1
    elif funktion == "runter":
        z0 += 1
    return (max(0, min(max(0, n_spalten - SPALTEN), s0)), max(0, min(MAX_ZEILE0, z0)))


def _anfrage(pfad, body=None, kopf=None):
    """GET (no body) or POST. A refusal (HTTP 4xx/5xx with a JSON body) is returned as the body, {ok: false, grund, text}; no server raises OSError."""
    kopfzeilen = {"content-type": "application/json", **(kopf or {})}
    req = urllib.request.Request(SEITE + pfad, data=None if body is None else json.dumps(body).encode(),
                                 method="GET" if body is None else "POST", headers=kopfzeilen)
    try:
        with urllib.request.urlopen(req, timeout=1.0) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read() or b"{}")
        except ValueError:
            raise OSError("HTTP %d" % e.code)


def _gitter_note(kanal, note):
    """True for the notes SESSION mode owns: clip stop + grid on channels 1..8, scene launch and stop all on channel 1."""
    return (kanal < SPALTEN and note in (STOPP,) + GITTER) or (kanal == 0 and (note in SZENEN or note == ALLE_STOPP))


class ApcSession:
    """The SESSION mode of the APC20 inside the pult bridge. `led(bytes)` sends to the APC20; `holen(path, body, headers)` calls the page server;
    `ansicht()` is the view the main window shows (apc_produktion's lage); `wiederhole()` the kern's last DJ LED messages, replayed when SESSION ends."""

    def __init__(self, log, led, holen=_anfrage, ansicht=lambda: None, wiederhole=lambda: []):
        self.log, self.led, self.holen, self.ansicht, self.wiederhole = log, led, holen, ansicht, wiederhole
        self.stand = None
        self.fenster = (0, 0)
        self.gezeigt = {}      # (channel, note) -> velocity sent in SESSION
        self.q = queue.Queue()
        self.gemeldet = set()
        self.war_an = False

    def an(self):
        # "studio" is the contract value the main window reports while the loop deck pop-up is open (the SESSION view it once named is gone)
        return self.ansicht() == "studio"

    def starte(self, stop):
        threading.Thread(target=self._abfrage, args=(stop,), daemon=True).start()
        threading.Thread(target=self._arbeit, daemon=True).start()

    def haelt_zurueck(self, data):
        """An LED message of the kern for a grid or scene note: True while SESSION owns the grid (the kern's DJ LED is replayed afterwards)."""
        return self.an() and len(data) == 3 and data[0] & 0xF0 in (0x80, 0x90) and _gitter_note(data[0] & 0x0F, data[1])

    def vom_apc(self, data):
        """An APC20 message while SESSION shows. True = taken (grid, clip stop, scenes, stop all, Shift + arrows); False = the DJ console path."""
        if not self.an() or len(data) != 3:
            return False
        typ, ch, nr, wert = data[0] & 0xF0, data[0] & 0x0F, data[1], data[2]
        if typ == 0xB0 and nr in BURST_CC and ch in FUNKTION and FUNKTION[ch] in PFEILE:
            if nr == 16 and wert == 0:     # only CC 16 of the burst triggers; the rest is taken so it does not reach the kern
                self.fenster = verschiebe(self.fenster, FUNKTION[ch], len(spalten_von(self.stand)))
                self._zeige(leds(self.stand, self.fenster))
            return True
        if typ in (0x80, 0x90) and _gitter_note(ch, nr):
            if typ == 0x90 and wert > 0:
                a = taste(self.stand, self.fenster, ch, nr)
                if a:
                    self.q.put(a)
            return True
        return False

    def _zeige(self, neu):
        for c, n, v in neu:
            if self.gezeigt.get((c, n)) != v:
                self.led(bytes([0x90 | c, n, v]))
                self.gezeigt[(c, n)] = v

    def _melde(self, schluessel, *text):
        if schluessel not in self.gemeldet:
            self.gemeldet.add(schluessel)
            self.log("APC20 session:", *text)

    def _hole_stand(self):
        try:
            neu = self.holen("/session/stand")
        except (OSError, ValueError) as e:
            self._melde("stand", "page server call failed: /session/stand", e)
            return      # page server away: keep the grid as it is
        self.gemeldet.discard("stand")
        if isinstance(neu, dict) and "container" in neu:
            self.stand = neu
        elif isinstance(neu, dict) and neu.get("grund") == "kein_projekt":
            self.stand = None      # no live project: the grid goes dark
            self.fenster = (0, 0)
        else:
            return      # another refusal is transient: the last stand and window stay
        self.fenster = verschiebe(self.fenster, "", len(spalten_von(self.stand)))
        self._zeige(leds(self.stand, self.fenster))

    def _abfrage_einmal(self):
        try:
            self._abfrage_schritt()
        except Exception as e:      # one malformed stand must not end the poll thread
            self._melde("schritt", "poll step failed:", repr(e))

    def _abfrage_schritt(self):
        if self.an():
            if not self.war_an:
                self.log("APC20: SESSION mode")
                self.war_an = True
                self.gezeigt = {}
            self._hole_stand()
        elif self.war_an:
            self.war_an = False
            self.log("APC20: DJ mode")
            for (c, n), v in list(self.gezeigt.items()):
                if v:
                    self.led(bytes([0x90 | c, n, 0]))
            self.gezeigt = {}
            for m in (self.wiederhole() if self.ansicht() != "produktion" else []):   # PRODUCTION keeps the grid dark (apc_production.py)
                if len(m) == 3 and m[0] & 0xF0 in (0x80, 0x90) and _gitter_note(m[0] & 0x0F, m[1]):
                    self.led(m)

    def _abfrage(self, stop):
        while not stop.is_set():
            self._abfrage_einmal()
            stop.wait(0.25)

    def _arbeite_einen(self, block=False):
        a = self.q.get(block=block)
        try:
            antwort = self.holen(a[0], a[1], KOPF)
            if isinstance(antwort, dict) and antwort.get("ok") is False:
                self._melde(a[0] + str(antwort.get("grund")), "refused:", a[0], antwort.get("grund"), antwort.get("text", ""))
            self._hole_stand()      # the new state at once, not only at the next poll
        except Exception as e:
            self._melde(a[0], "page server call failed:", a[0], e)

    def _arbeit(self):
        while True:
            self._arbeite_einen(block=True)
