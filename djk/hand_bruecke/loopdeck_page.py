# loopdeck_page.py: loop deck requests of the desk through the page server (POST /loopdeck/*) and the deck state for the
# pad LEDs (GET /loopdeck/stand, polled at 4 Hz while a side shows the loops view). Own thread like deck_page.py so the USB
# and MIDI loops never wait. No device.
import collections
import json
import threading
import time

import deck_page as deck_seite
import s8_loopdeck

POLL_S = 0.25  # 4 Hz
TICK_S = 1.0 / 60  # the throttle of the faders and knobs is checked this often
LOG_S = 5.0  # one log line per reason and this many seconds
LADEN_S = 10.0  # timeout of /loopdeck/laden (loading takes long); never retried
KEIN_DECK = ("projekt_offen", "kein_loopdeck")  # answers of the server that mean: there is no loop deck to address


def _grund(r=None, e=None):
    """Reason of a refusal: `grund` of an answer {ok:false, grund} or of the JSON body of an HTTP error; else None."""
    if r is not None:
        return None if r.get("ok", True) else r.get("grund") or "unknown"
    try:
        return json.loads(e.read().decode(errors="replace")).get("grund")
    except Exception:
        return None


def seiten_decks(decks):
    """({side: deck}, {side: deck number}) from decks of GET /loopdeck/stand. The faders belong to the places: a deck shown in a left place (1, 3) sounds on
    the left side's channel, one in a right place (2, 4) on the right side's. A side whose place holds no deck, or two, shows the deck of its own number."""
    def seite(d):
        return 1 if (d or {}).get("ausgang_platz") in (1, 3) else 2 if (d or {}).get("ausgang_platz") in (2, 4) else None
    roh = {n: decks.get(str(n)) for n in (1, 2)}
    nr = {1: 1, 2: 2}
    if roh[1] and roh[2] and seite(roh[1]) is not None and seite(roh[1]) != seite(roh[2]):
        nr = {seite(roh[1]): 1, seite(roh[2]): 2}
    elif (roh[1] is None) != (roh[2] is None):  # only one deck exists: it is on its own side
        n = 1 if roh[1] else 2
        if seite(roh[n]) is not None:
            nr = {seite(roh[n]): n, 3 - seite(roh[n]): 3 - n}
    return {s: roh[nr[s]] for s in (1, 2)}, nr


class LoopdeckSeite:
    def __init__(self, log, ansicht, anfrage=None, starte=True):
        """`ansicht` is the bridge's {side: view name} dict; `anfrage(pfad, body=None)` is the HTTP call (injectable)."""
        self.log = log
        self.ansicht = ansicht
        self.anfrage = anfrage or deck_seite._anfrage
        self.starte = starte
        self.decks = {1: None, 2: None}  # side -> the loop deck on that side (decks[n] of /loopdeck/stand, see seiten_decks)
        self.deck_nr = {1: 1, 2: 2}      # side -> number of the loop deck shown there (the requests carry this number)
        self.raster = {}                 # side -> grid asked for by the encoder, until the post is answered and a poll shows it
        self.mute = {}                   # (side, track) -> mute asked for by a button, the same
        self.streifen = {}               # (side, track, "eq"/"send", key) -> kill / send close asked for by SHIFT + on, the same
        self.takt = None                 # (beat, bpm, monotonic time) of the last poll, for the display's progress bars
        self.drossel = s8_loopdeck.Drossel()
        self._fehler = 0
        self._cv = threading.Condition()
        self._eilig = collections.deque()      # pad starts/stops, scenes, slices, mutes, grid, capture: in order, never merged
        self._regler = collections.OrderedDict()  # (deck, spur, field or "eq"/"send") -> body: a newer value replaces a queued older one
        self._offen = collections.Counter()    # optimistic key -> posts queued or in flight
        self._logzeit = {}                     # reason -> time of its last log line
        if starte:
            threading.Thread(target=self._senden_lauf, daemon=True).start()
            threading.Thread(target=self._poll_lauf, daemon=True).start()
            threading.Thread(target=self._regel_lauf, daemon=True).start()

    @staticmethod
    def _optimistisch(pfad, body):
        """Key of the optimistic value (self.mute / self.raster) a post stands for, or None."""
        if pfad == "/loopdeck/spur" and "mute" in body:
            return ("mute", body.get("deck"), body.get("spur"))
        if pfad == "/loopdeck/spur":
            for gruppe in ("kill", "send"):
                if isinstance(body.get(gruppe), dict) and len(body[gruppe]) == 1:
                    return ("streifen", body.get("deck"), body.get("spur"), gruppe, next(iter(body[gruppe])))
        if pfad == "/loopdeck/raster":
            return ("raster", body.get("deck"))
        return None

    def senden(self, pfad, body):
        """Queue a request that must happen exactly as asked (never merged); it goes ahead of queued control values."""
        with self._cv:
            k = self._optimistisch(pfad, body)
            if k:
                self._offen[k] += 1
            self._eilig.append((pfad, body, k))
            self._cv.notify()

    def deck(self, nr):
        return self.decks.get(nr)

    def regeln(self, deck, spur, feld, wert):
        """A fader or knob moved (feld "fader_db", "filter", "eq:<band>" or "send:<key>"): goes out on the next tick, at most
        30 per second per control."""
        self.drossel.setze((deck, spur, feld), wert)

    def vergessen(self, deck, spur, feld):
        self.drossel.vergiss((deck, spur, feld))

    def tick(self, jetzt=None):
        """Move due control values into the queue. Nothing for a side without a loop deck in the last stand: a fader touch
        must never create or open anything."""
        for (deck, spur, feld), wert in self.drossel.faellig(time.monotonic() if jetzt is None else jetzt):
            if not self.decks.get(deck):
                continue
            with self._cv:
                if ":" in feld:  # eq:<band> / send:<key>: one queued post per track and group, its keys merge
                    gruppe, key = feld.split(":", 1)
                    body = self._regler.setdefault((deck, spur, gruppe), {"deck": deck, "spur": spur, gruppe: {}})
                    body[gruppe][key] = wert
                else:
                    self._regler[(deck, spur, feld)] = {"deck": deck, "spur": spur, feld: wert}  # replaces a queued older value
                self._cv.notify()

    def beat_jetzt(self, jetzt=None):
        """Core beat now, extrapolated from the last poll with its bpm; None before the first poll."""
        if not self.takt or self.takt[0] is None:
            return None
        beat, bpm, zeit = self.takt
        return beat + ((time.monotonic() if jetzt is None else jetzt) - zeit) * (bpm or 0) / 60.0

    def _log(self, grund, *a):
        jetzt = time.monotonic()
        if jetzt - self._logzeit.get(grund, -LOG_S) >= LOG_S:
            self._logzeit[grund] = jetzt
            self.log(*a)

    def _echt(self, pfad, body):
        """The bridge works with sides (1 left, 2 right); the server wants the deck number: the deck that sounds on the channel of that side."""
        if pfad.startswith("/loopdeck/") and isinstance(body, dict) and body.get("deck") in self.deck_nr:
            return {**body, "deck": self.deck_nr[body["deck"]]}
        return body

    def _melde(self, pfad, body):
        body = self._echt(pfad, body)
        try:
            if pfad == "/loopdeck/laden":  # slow, called once, never retried
                r = self.anfrage(pfad, body, timeout=LADEN_S)
            else:
                r = self.anfrage(pfad, body)
            g = _grund(r)
            if g:  # a refusal; ok:true answers (also with `abgelehnt` lists) are not errors
                self._log(g, "loopdeck", pfad, body, "->", r)
        except Exception as e:  # HTTP errors carry the reason in the body
            text = e.read().decode(errors="replace")[:200] if hasattr(e, "read") else str(e)
            self._log(text[:60], "loopdeck", pfad, body, "failed:", text)

    def _naechste(self):
        """Next queued request (path, body, key) or None: urgent ones first, then the oldest control value."""
        with self._cv:
            if self._eilig:
                return self._eilig.popleft()
            if self._regler:
                return "/loopdeck/spur", self._regler.popitem(last=False)[1], None
        return None

    def _fertig(self, k):
        if k:
            with self._cv:
                self._offen[k] -= 1
                if self._offen[k] <= 0:
                    del self._offen[k]

    def _bearbeite(self, pfad, body, k):
        try:
            self._melde(pfad, body)
        finally:
            self._fertig(k)

    def leeren(self):
        """Work off the queue in this thread (tests, no thread running)."""
        while True:
            n = self._naechste()
            if n is None:
                return
            self._bearbeite(*n)

    def _senden_lauf(self):
        while True:
            with self._cv:
                while not self._eilig and not self._regler:
                    self._cv.wait()
            n = self._naechste()
            if n is None:
                continue
            pfad, body, k = n
            if pfad == "/loopdeck/laden":  # its own thread: the 10 s wait must not hold back pads and faders
                threading.Thread(target=self._bearbeite, args=n, daemon=True).start()
            else:
                self._bearbeite(pfad, body, k)

    def holen(self):
        """One poll: update self.decks from GET /loopdeck/stand. False when the request failed (last state is kept). The
        optimistic grid and mute values are kept while their post is still queued or in flight."""
        vorher = set(self._offen)
        try:
            r = self.anfrage("/loopdeck/stand") or {}
        except Exception as e:
            g = _grund(e=e) if hasattr(e, "read") else None
            if g in KEIN_DECK:  # the server says: no project open / no loop deck
                self.decks = {1: None, 2: None}
                self._log("stand " + g, "loopdeck stand:", g)
                return False
            self._fehler += 1
            if self._fehler in (1, 20) or self._fehler % 200 == 0:
                self.log("loopdeck stand failed (%d in a row): %s" % (self._fehler, e))
            return False
        self._fehler = 0
        if r.get("ok", True) is False:  # {ok:false, grund}
            self.decks = {1: None, 2: None}
            self._log("stand " + str(r.get("grund")), "loopdeck stand refused:", r)
            return False
        self.decks, self.deck_nr = seiten_decks(r.get("decks") or {})
        jetzt = set(self._offen)
        for k in [k for k in self.raster if ("raster", k) not in vorher and ("raster", k) not in jetzt]:
            self.raster.pop(k, None)
        for k in [k for k in self.mute if ("mute", *k) not in vorher and ("mute", *k) not in jetzt]:
            self.mute.pop(k, None)
        for k in [k for k in self.streifen if not any(("streifen", k[0], k[1], g, k[3]) in vorher | jetzt for g in ("kill", "send"))]:
            self.streifen.pop(k, None)
        beat, bpm = r.get("beat"), r.get("bpm")
        self.takt = (float(beat), float(bpm or 0), time.monotonic()) if isinstance(beat, (int, float)) else None
        return True

    def _regel_lauf(self):
        while True:
            self.tick()
            time.sleep(TICK_S)

    def _poll_lauf(self):
        while True:
            if "loops" in (self.ansicht.get(1), self.ansicht.get(2)):
                self.holen()
            time.sleep(POLL_S)
