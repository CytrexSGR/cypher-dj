# launchpad.py: the Novation Launchpad Mini MK3 (USB 1235:0113, ALSA client "Launchpad Mini MK3") as the step grid of the SEQ deck.
# Spec: docs/superpowers/specs/2026-11-20-launchpad-seq-design.md, device doc: docs/controller/launchpad-mini-mk3.md.
#
# It shows the note lanes of one pattern of the first SEQ deck (GET /seq/stand?zellen=1) on the 8 x 8 grid, two rows per lane (cells 1..8 above,
# 9..16 below), and toggles a cell on a press. It adds no data: a press is one POST /seq/text with the text of the pattern in which that one cell
# is changed (the write path the hand uses; one write = one undo step), sent as Andreas' hand (x-djk-quelle: andreas).
#
# Device side: programmer mode on at connect (SysEx 0E 01), live mode again at the end (0E 00). All LEDs are RGB SysEx (03 03 <led> r g b),
# sent only where they changed. In programmer mode the LED index is the note / CC number of the control: pads 11..88 (10 * row + column, row 1 at
# the bottom), top row CC 91..98, right column CC 89 (top) .. 19 (bottom).
# Ports: ALSA "Launchpad Mini MK3:0" is the DAW port (LPMiniMK3 DA), ":1" the MIDI port (LPMiniMK3 MI). SysEx goes to the DAW port; presses are
# read from both ports (see the device doc for what was and was not checked).
import json
import math
import re
import time
import urllib.request

import alsa_seq

SEITE = "http://127.0.0.1:47300"
GERAET_DAW = "Launchpad Mini MK3:0"
GERAET_MIDI = "Launchpad Mini MK3:1"
KOPF = bytes([0xF0, 0x00, 0x20, 0x29, 0x02, 0x0D])

LANES = 4                       # note lanes on the grid (two rows each)
ZELLEN_SEITE = 16               # cells per lane on the grid
OBEN = {91: "hoch", 92: "runter", 93: "links", 94: "rechts", 95: "session"}   # top row buttons (CC)
RECHTS = list(range(89, 18, -10))   # right column CCs, top to bottom: pattern 1..8
PFEILE = (91, 92, 93, 94)
SESSION = 95

# One colour per lane index (RGB 0..127): red, green, blue, yellow, magenta, cyan, orange, violet.
LANE_FARBEN = [(127, 0, 0), (0, 127, 0), (0, 40, 127), (127, 90, 0), (127, 0, 60), (0, 110, 110), (127, 30, 0), (60, 0, 127)]
WEISS = (127, 127, 127)
WEISS_DIMM = (24, 24, 24)
ROT = (127, 0, 0)
PFEIL_FARBE = (30, 30, 30)
FOLGE_EDIT, FOLGE_GEWAEHLT, FOLGE_STUMM = (0, 30, 60), (127, 127, 127), (50, 8, 8)
GEISTER = 0.35                  # factor of a ghost note (o), the second brightness step
BEAT_DIMM = 0.12                # factor of the first empty cell of a beat


def skaliert(farbe, f):
    return tuple(int(c * f) for c in farbe)


# -- device messages ------------------------------------------------------------------------------------------------------------------
def programmer_modus(an):
    return KOPF + bytes([0x0E, 0x01 if an else 0x00, 0xF7])


def led_sysex(paare):
    """One SysEx that sets the LEDs in `paare` [(index, (r, g, b))] (RGB colour spec 3, 0..127 each)."""
    daten = bytearray(KOPF + bytes([0x03]))
    for index, (r, g, b) in paare:
        daten += bytes([0x03, index & 0x7F, r & 0x7F, g & 0x7F, b & 0x7F])
    return bytes(daten + bytes([0xF7]))


def led_nachrichten(neu, alt, je_nachricht=24):
    """The SysEx messages that turn the LEDs from `alt` ({index: rgb}) into `neu`; only changed LEDs are sent."""
    diff = [(i, c) for i, c in sorted(neu.items()) if alt.get(i) != c]
    return [led_sysex(diff[k:k + je_nachricht]) for k in range(0, len(diff), je_nachricht)]


def alle_leds():
    return [10 * r + c for r in range(1, 9) for c in range(1, 9)] + list(OBEN) + list(PFEILE) + [96, 97, 98] + RECHTS


def druck(daten):
    """What a press is: ('pad', row_from_top 0..7, column 0..7), ('oben', name), ('folge', 0..7), or None (release, other message)."""
    if len(daten) != 3:
        return None
    art, nr, wert = daten[0] & 0xF0, daten[1], daten[2]
    if wert == 0:
        return None
    if art == 0x90 and 11 <= nr <= 88 and 1 <= nr % 10 <= 8:
        return ("pad", 8 - nr // 10, nr % 10 - 1)
    if art == 0xB0:
        if nr in OBEN:
            return ("oben", OBEN[nr])
        if nr in RECHTS:
            return ("folge", RECHTS.index(nr))
    return None


# -- the text of a pattern: change one cell -------------------------------------------------------------------------------------------
def _lane_zeile(zeilen, lane_id, trigger):
    """(line index, offset of the cell part in the line) of the note lane `lane_id`, or None. A trigger lane reads `noten <id> <note> <grid> <cells>`,
    a pitched lane `noten <id> <grid> <cells>`."""
    kopf = r"^(\s*noten\s+" + re.escape(lane_id) + r"\s+" + (r"\d+\s+" if trigger else "") + r"\d+/\d+\s+)"
    for i, z in enumerate(zeilen):
        m = re.match(kopf, z, re.IGNORECASE)
        if m:
            return i, len(m.group(1))
    return None


def _spannen(teil, trigger):
    """[(start, end)] of the cells in the cell part of a lane line: one character per cell on a trigger lane, one word on a pitched lane; `|` and
    blanks separate, `;` starts a comment."""
    ende = teil.find(";")
    teil = teil if ende < 0 else teil[:ende]
    if trigger:
        return [(m.start(), m.end()) for m in re.finditer(r"[^\s|]", teil)]
    return [(m.start(), m.end()) for m in re.finditer(r"[^\s|]+", teil)]


STANDARD_TON = "c3"             # MIDI 60 in the names of the text notation


def zelle_text(text, lane_id, trigger, zelle, an):
    """The pattern text with cell `zelle` of lane `lane_id` set (`an`) or cleared. A set cell is `x` (velocity 100) on a trigger lane (the lane
    writes its own note); on a pitched lane it is the note name of the nearest set cell before it in the lane, `c3` when there is none, and no tie
    follows. Clearing a pitched cell also clears the ties (`~`) that lengthened it. None when the lane or the cell is not in the text."""
    zeilen = text.split("\n")
    f = _lane_zeile(zeilen, lane_id, trigger)
    if f is None:
        return None
    i, ab = f
    zeile = zeilen[i]
    spannen = _spannen(zeile[ab:], trigger)
    if not 0 <= zelle < len(spannen):
        return None
    worte = [zeile[ab + s:ab + e] for s, e in spannen]
    if trigger:
        worte[zelle] = "x" if an else "."
    elif an:
        davor = [w for w in worte[:zelle] if w not in (".", "~")]
        worte[zelle] = davor[-1].split("+")[0] if davor else STANDARD_TON
    else:
        worte[zelle] = "."
        k = zelle + 1
        while k < len(worte) and worte[k] == "~":
            worte[k] = "."
            k += 1
    neu = zeile[:ab]
    letzte = 0
    for (s, e), w in zip(spannen, worte):
        neu += zeile[ab + letzte:ab + s] + w
        letzte = e
    zeilen[i] = neu + zeile[ab + letzte:]
    return "\n".join(zeilen)


# -- the model: what the grid shows ---------------------------------------------------------------------------------------------------
def deck_platz(stand):
    """(place number, entry) of the lowest place of GET /seq/stand that has a deck, else None."""
    for k in sorted((stand or {}), key=lambda x: int(x) if str(x).isdigit() else 99):
        if isinstance(stand[k], dict) and stand[k].get("folgen") is not None:
            return int(k), stand[k]
    return None


def note_lanes(folge):
    return [z for z in (folge or {}).get("zeilen") or [] if z.get("art") == "noten" and isinstance(z.get("zellen"), str)]


def zellen_zahl(z):
    return len(z["zellen"])


def kopf_zelle(z, laenge, beat):
    """Cell of lane `z` under the play position `beat` (a number or None); the pattern loops at `laenge` beats."""
    teiler = z.get("teiler") or 0.25
    if beat is None or not laenge or laenge <= 0 or teiler <= 0:
        return None
    zelle = int(math.floor((beat % laenge) / teiler + 1e-9))
    return zelle if 0 <= zelle < zellen_zahl(z) else None


class Raster:
    """The state of the grid view: which pattern, how far the lanes are scrolled, which 16-cell page. Pure: no device, no network."""

    def __init__(self):
        self.stand = None       # the last answer of /seq/stand?zellen=1
        self.folge_nr = None    # chosen pattern index, None = the first editable
        self.zeile = 0          # first visible lane
        self.seite = 0          # 16-cell page

    # -- state
    def setze_stand(self, stand):
        self.stand = stand
        self._klemmen()

    def deck(self):
        return deck_platz(self.stand)

    def folge(self):
        d = self.deck()
        if d is None:
            return None, None
        folgen = d[1].get("folgen") or []
        if self.folge_nr is not None and self.folge_nr < len(folgen):
            return self.folge_nr, folgen[self.folge_nr]
        for i, f in enumerate(folgen):
            if f.get("editierbar"):
                return i, f
        return None, None

    def lanes(self):
        return note_lanes(self.folge()[1])

    def _klemmen(self):
        lanes = self.lanes()
        self.zeile = max(0, min(self.zeile, max(0, len(lanes) - LANES)))
        seiten = max(1, math.ceil(max((zellen_zahl(z) for z in lanes), default=0) / ZELLEN_SEITE))
        self.seite = max(0, min(self.seite, seiten - 1))

    def seiten(self):
        lanes = self.lanes()
        return max(1, math.ceil(max((zellen_zahl(z) for z in lanes), default=0) / ZELLEN_SEITE))

    # -- presses
    def zelle_unter(self, reihe, spalte):
        """(lane, lane index, cell index) under a pad (row from top 0..7, column 0..7), None when no cell is there."""
        lanes = self.lanes()
        k = self.zeile + reihe // 2
        if k >= len(lanes):
            return None
        zelle = self.seite * ZELLEN_SEITE + (reihe % 2) * 8 + spalte
        return (lanes[k], k, zelle) if zelle < zellen_zahl(lanes[k]) else None

    def oben(self, name):
        if name == "hoch":
            self.zeile -= 1
        elif name == "runter":
            self.zeile += 1
        elif name == "links":
            self.seite -= 1
        elif name == "rechts":
            self.seite += 1
        self._klemmen()

    def waehle_folge(self, nr):
        d = self.deck()
        if d is not None and nr < len(d[1].get("folgen") or []):
            self.folge_nr, self.zeile, self.seite = nr, 0, 0
            self._klemmen()
            return True
        return False

    def umschalten(self, lane, zelle):
        """Toggle a cell in the local copy (optimistic) and return (place, new pattern text, lane id, trigger, set?) for the write, or None."""
        d = self.deck()
        nr, folge = self.folge()
        if d is None or folge is None or not folge.get("editierbar") or not folge.get("text"):
            return None
        an = lane["zellen"][zelle] == "."
        neu = zelle_text(folge["text"], lane["id"], lane.get("ton") is not None, zelle, an)
        if neu is None:
            return None
        z = lane["zellen"]
        lane["zellen"] = z[:zelle] + ("x" if an else ".") + z[zelle + 1:]
        folge["text"] = neu   # the next press builds on this text, not on the one before the poll
        return d[0], neu

    # -- picture
    def leds(self, beat):
        """{led index: (r, g, b)} of the whole device for the play position `beat`."""
        aus = {i: (0, 0, 0) for i in alle_leds()}
        d = self.deck()
        if d is None:
            aus[SESSION] = ROT
            return aus
        nr, folge = self.folge()
        lanes = self.lanes()
        laenge = (folge or {}).get("laenge_beats")
        for reihe in range(8):
            k = self.zeile + reihe // 2
            if k >= len(lanes):
                continue
            z = lanes[k]
            farbe = LANE_FARBEN[k % len(LANE_FARBEN)]
            je_beat = max(1, round(1 / (z.get("teiler") or 0.25)))
            kopf = kopf_zelle(z, laenge, beat)
            for spalte in range(8):
                zelle = self.seite * ZELLEN_SEITE + (reihe % 2) * 8 + spalte
                if zelle >= zellen_zahl(z):
                    continue
                zeichen = z["zellen"][zelle]
                if zeichen == ".":
                    c = skaliert(farbe, BEAT_DIMM) if zelle % je_beat == 0 else (0, 0, 0)
                else:
                    c = skaliert(farbe, GEISTER) if zeichen == "o" else farbe
                if zelle == kopf:
                    c = WEISS if zeichen != "." else WEISS_DIMM
                aus[10 * (8 - reihe) + spalte + 1] = c
        if self.zeile > 0:
            aus[91] = PFEIL_FARBE
        if self.zeile + LANES < len(lanes):
            aus[92] = PFEIL_FARBE
        if self.seite > 0:
            aus[93] = PFEIL_FARBE
        if self.seite + 1 < self.seiten():
            aus[94] = PFEIL_FARBE
        folgen = d[1].get("folgen") or []
        for i in range(min(8, len(folgen))):
            f = folgen[i]
            aus[RECHTS[i]] = FOLGE_GEWAEHLT if i == nr else FOLGE_EDIT if f.get("editierbar") and not f.get("stumm") else FOLGE_STUMM
        return aus


# -- network ---------------------------------------------------------------------------------------------------------------------------
def holen(pfad, timeout=0.5):
    req = urllib.request.Request(SEITE + pfad, headers={"x-djk-quelle": "andreas"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def hole_stand():
    return holen("/seq/stand?zellen=1")


def hole_bpm():
    return float((holen("/lage") or {}).get("uhr", {}).get("bpm") or 0)


def schreibe_text(platz, text):
    """POST /seq/text as Andreas' hand. Returns True when the server took it."""
    req = urllib.request.Request(SEITE + "/seq/text", data=json.dumps({"platz": platz, "text": text}).encode(), method="POST",
                                 headers={"content-type": "application/json", "x-djk-quelle": "andreas"})
    with urllib.request.urlopen(req, timeout=2.0) as r:
        r.read()
    return True


class Takt:
    """The project beat of the live container: /zustand/arr (50 Hz while it plays) from the event stream, extrapolated with the project tempo
    between two messages; None when it stands (the same source as the S8 SEQ screen, seq_view.py)."""

    def __init__(self):
        self.arr = None

    def ereignis(self, f, t):
        self.arr = (f, t)

    def beat(self, bpm, jetzt):
        if not self.arr:
            return None
        f, t = self.arr
        if int(f.get("status") or 0) < 2 or jetzt - t > 2.0:
            return None
        return float(f.get("projekt_beat") or 0) + (jetzt - t) * (bpm or 0) / 60.0

    def strom(self, stop):
        while not stop.is_set():
            try:
                req = urllib.request.Request(SEITE + "/strom", headers={"x-djk-quelle": "andreas"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    for zeile in r:
                        if stop.is_set():
                            return
                        if not zeile.startswith(b"data:"):
                            continue
                        try:
                            ev = json.loads(zeile[5:])
                        except ValueError:
                            continue
                        if ev.get("a") == "/zustand/arr":
                            self.ereignis(ev.get("f") or {}, time.monotonic())
            except Exception:
                stop.wait(2)


class AlsaGeraet:
    """The device over ALSA: SysEx out on the DAW port, presses in from both ports."""

    def __init__(self):
        self.seq = alsa_seq.Client("cypherdj-launchpad")
        self.aus = self.seq.port_out("daw")
        self.ein = self.seq.port_in("ein")

    def da(self):
        """'new' when the device was (re)connected just now, 'kept' while it stays, None when it is absent."""
        z = self.seq.connect_to_state(self.aus, GERAET_DAW)
        if z == "new":
            self.seq.connect_from(self.ein, GERAET_DAW)
            self.seq.connect_from(self.ein, GERAET_MIDI)
            time.sleep(0.1)   # a fresh subscription needs a moment before the device takes messages
        return z

    def senden(self, daten):
        self.seq.send(self.aus, daten)
        time.sleep(0.002)

    def lesen(self):
        return [bytes(d) for _p, d in self.seq.receive()]

    def schliessen(self):
        self.seq.close()


def lauf(stop, log, geraet=None, hole=hole_stand, schreibe=schreibe_text, takt=None, bpm=hole_bpm, uhr=time.monotonic, tick=0.03):
    """Runs until `stop` is set. Programmer mode while the device is there; live mode and dark LEDs at the end."""
    import threading
    geraet = geraet or AlsaGeraet()
    if takt is None:
        takt = Takt()
        threading.Thread(target=takt.strom, args=(stop,), daemon=True).start()
    r = Raster()
    an, gesendet, stand_um, bpm_wert, bpm_um, da_um = False, {}, 0.0, 0.0, 0.0, 0.0
    try:
        while not stop.is_set():
            jetzt = uhr()
            if jetzt >= da_um:
                da_um = jetzt + 1.0
                z = geraet.da()
                if z is None:
                    if an:
                        log("Launchpad: device gone")
                    an, gesendet = False, {}
                elif z == "new" or not an:
                    geraet.senden(programmer_modus(True))
                    an, gesendet = True, {}
                    log("Launchpad: programmer mode on")
            if jetzt >= stand_um:
                try:
                    r.setze_stand(hole())
                except (OSError, ValueError):
                    pass   # page server away: keep what the grid shows
                stand_um = uhr() + (0.25 if r.deck() else 2.0)
            if not an:
                stop.wait(tick)
                continue
            if jetzt >= bpm_um:
                bpm_um = jetzt + 1.0
                try:
                    bpm_wert = bpm()
                except (OSError, ValueError):
                    pass
            for daten in geraet.lesen():
                p = druck(daten)
                if p is None:
                    continue
                if p[0] == "oben":
                    r.oben(p[1])
                elif p[0] == "folge":
                    r.waehle_folge(p[1])
                else:
                    ziel = r.zelle_unter(p[1], p[2])
                    w = r.umschalten(ziel[0], ziel[2]) if ziel else None
                    if w:
                        for n in led_nachrichten(r.leds(takt.beat(bpm_wert, uhr())), gesendet):   # optimistic: the LED follows at once
                            geraet.senden(n)
                        gesendet = r.leds(takt.beat(bpm_wert, uhr()))
                        try:
                            schreibe(*w)
                        except (OSError, ValueError) as e:
                            log("Launchpad: cell not written:", e)
                        stand_um = 0.0   # read the project back now: it corrects what the optimistic picture got wrong
            neu = r.leds(takt.beat(bpm_wert, uhr()))
            for n in led_nachrichten(neu, gesendet):
                geraet.senden(n)
            gesendet = neu
            stop.wait(tick)
    finally:
        if an:
            for n in led_nachrichten({i: (0, 0, 0) for i in alle_leds()}, {}):
                geraet.senden(n)
            geraet.senden(programmer_modus(False))
        geraet.schliessen()


if __name__ == "__main__":
    import sys
    import threading
    ende = threading.Event()
    try:
        lauf(ende, lambda *a: print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True))
    except KeyboardInterrupt:
        ende.set()
