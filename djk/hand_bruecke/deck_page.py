# deck_page.py: deck actions of the desk through the page server, exactly like the DJ page (POST /deck/hotcue, /deck/loop,
# /deck/sprung, /deck/scrub as Andreas' hand). The page server owns hot cues, loop cues and the active loop (files per track
# version), so this is the right owner, not the kern's hand path. Runs in its own thread so the USB and MIDI loops never wait.
import collections
import json
import queue
import threading
import time
import urllib.request

SEITE = "http://127.0.0.1:47300"
RASTER = 1  # beats: jumps and new cue points land on the beat grid of the track
SCRUB_TAKT = 1 / 60  # s between two scrub targets (the kern's audible drag expects ~60 Hz, POST /deck/scrub)
NUDGE_LOS = 0.15     # s without an encoder step: the nudge grip is released and the deck plays on from the new place


def _anfrage(pfad, body=None):
    req = urllib.request.Request(SEITE + pfad, data=None if body is None else json.dumps(body).encode(),
                                 method="GET" if body is None else "POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=1.0) as r:
        return json.loads(r.read() or b"{}")


class DeckSeite:
    def __init__(self, log):
        self.log = log
        self.q = queue.Queue()
        self._vorne = collections.deque()  # items taken out while coalescing that must run next, in order
        self._nudge = {}  # deck -> [beats moved so far, time of the last step] (worker thread only)
        self._scrub_zeit = 0.0
        threading.Thread(target=self._lauf, daemon=True).start()

    def hotcue(self, deck, nr, loeschen=False, loop_laenge=4):
        """Traktor way: empty pad = cue here (during a running loop: the loop is stored as a loop cue), set pad = jump there,
        delete = SHIFT + pad."""
        self.q.put(("hotcue", deck, nr, (loeschen, loop_laenge)))

    def spulen(self, deck, beats):
        """Move the playhead by `beats` (browse encoder in the deck view); quick detents are summed into one jump."""
        self.q.put(("sprung", deck, beats, None))

    def suchen(self, deck, beat):
        """Jump to an absolute place (quell beat) of the track; while the finger moves only the latest place is sent."""
        self.q.put(("suchen", deck, beat, None))

    def loop_groesse(self, deck, laenge):
        """New loop size from the encoder: a running loop takes it and keeps its start; no loop: nothing to send."""
        self.q.put(("groesse", deck, laenge, None))

    def scrub(self, deck, phase, beats):
        """Audible drag (touch strip): phase 1 grips, 2 moves the grip to `beats` from where it started, 0 releases.
        A playing deck keeps running under the grip, so a small move is a nudge; a stopped deck is scrubbed."""
        self.q.put(("scrub", deck, phase, beats))

    def nudge(self, deck, beats):
        """Screen encoder: move a deck by `beats` as one drag; released by itself after NUDGE_LOS without a step."""
        self.q.put(("nudge", deck, beats, None))

    def loop(self, deck, laenge=4):
        """Loop on (laenge beats) or off when one runs."""
        self.q.put(("loop", deck, laenge, None))

    @staticmethod
    def _loop_laeuft(deck):
        return any(x.get("deck") == deck and x.get("loop") for x in _anfrage("/lage").get("decks", []))

    def _naechstes(self, block):
        if self._vorne:
            return self._vorne.popleft()
        return self.q.get(timeout=0.05) if block else self.q.get_nowait()

    def _sammle(self, passt, wert, verbinde):
        """Coalesce the items that queued up meanwhile and match `passt`; the first other item runs next."""
        while True:
            try:
                n = self._naechstes(False)
            except queue.Empty:
                return wert
            if passt(n):
                wert = verbinde(wert, n)
            else:
                self._vorne.appendleft(n)
                return wert

    def _scrub(self, deck, phase, beats):
        if phase == 2:  # at most ~60 targets per second; only the latest one counts
            warte = self._scrub_zeit + SCRUB_TAKT - time.monotonic()
            if warte > 0:
                time.sleep(warte)
            beats = self._sammle(lambda n: n[0] == "scrub" and n[1] == deck and n[2] == 2, beats, lambda w, n: n[3])
            self._scrub_zeit = time.monotonic()
        return _anfrage("/deck/scrub", {"deck": deck, "phase": phase, "delta": round(beats, 5)})

    def _nudge_los(self, alle=False):
        jetzt = time.monotonic()
        for deck, (summe, zuletzt) in list(self._nudge.items()):
            if alle or jetzt - zuletzt >= NUDGE_LOS:
                del self._nudge[deck]
                self._melde("nudge", deck, summe, lambda: _anfrage("/deck/scrub", {"deck": deck, "phase": 0, "delta": round(summe, 5)}))

    def _melde(self, art, deck, a, tu):
        try:
            r = tu()
            if r is not None and (not r.get("ok", True) or r.get("fehler")):
                self.log("deck action", art, deck, a, "->", r)
        except Exception as e:  # HTTP errors carry the reason in the body
            text = e.read().decode(errors="replace")[:200] if hasattr(e, "read") else str(e)
            self.log("deck action", art, deck, a, "failed:", text)

    def _lauf(self):
        while True:
            try:
                art, deck, a, b = self._naechstes(True)
            except queue.Empty:
                self._nudge_los()
                continue
            self._melde(art, deck, a, lambda: self._aktion(art, deck, a, b))
            self._nudge_los()

    def _aktion(self, art, deck, a, b):
        if art == "scrub":
            return self._scrub(deck, a, b)
        if art == "nudge":
            a = self._sammle(lambda n: n[0] == "nudge" and n[1] == deck, a, lambda w, n: w + n[2])
            if deck not in self._nudge:
                self._nudge[deck] = [0.0, 0.0]
                _anfrage("/deck/scrub", {"deck": deck, "phase": 1, "delta": 0})
            g = self._nudge[deck]
            g[0] += a
            g[1] = time.monotonic()
            return self._scrub(deck, 2, g[0])
        if art == "hotcue":
            loeschen, laenge = b
            if loeschen:
                return _anfrage("/deck/hotcue", {"deck": deck, "nr": a, "aktion": "loeschen", "raster": RASTER})
            if str(a) in (_anfrage(f"/deck/hotcues?deck={deck}") or {}):
                return _anfrage("/deck/hotcue", {"deck": deck, "nr": a, "raster": RASTER, "aktion": "spielen"})
            if self._loop_laeuft(deck):  # Traktor: an empty cue button during a loop saves that loop
                return _anfrage("/deck/hotcue", {"deck": deck, "nr": a, "raster": RASTER, "aktion": "setzen",
                                                 "aus_loop": True, "laenge": laenge})
            return _anfrage("/deck/hotcue", {"deck": deck, "nr": a, "raster": RASTER, "aktion": "setzen", "art": "shot"})
        if art == "suchen":  # only the latest place counts
            a = self._sammle(lambda n: n[0] == "suchen" and n[1] == deck, a, lambda w, n: n[2])
            return _anfrage("/deck/sprung", {"deck": deck, "ziel": round(a, 3), "raster": 0})
        if art == "sprung":  # sum detents that queued up meanwhile for the same deck
            a = self._sammle(lambda n: n[0] == "sprung" and n[1] == deck, a, lambda w, n: w + n[2])
            if not a:
                return None
            return _anfrage("/deck/sprung", {"deck": deck, "delta": a, "raster": 0})
        if art == "groesse":
            if not self._loop_laeuft(deck):
                return None
            return _anfrage("/deck/loop", {"deck": deck, "laenge": a, "raster": RASTER, "behalte_start": True})
        return _anfrage("/deck/loop", {"deck": deck, "laenge": 0 if self._loop_laeuft(deck) else a, "raster": RASTER})
