# s8_loopdeck.py: the S8 loops view as a pure model. One LoopSicht per side holds the visible row pair; the functions turn
# pad presses, encoder steps and display buttons into page server requests (/loopdeck/*, frozen interface of the loop deck
# plan 1.5) and the deck state (`GET /loopdeck/stand` decks[n]) into pad LED colours. No device, no network, no drawing.
import math
import threading

RASTER = ["1/4", "1/2", "1", "takt", "4takte"]  # the grid ladder of the loop deck (LoopRaster)
PAIRE = 4                                       # row pairs 1-2, 3-4, 5-6, 7-8
DIMM = 0.25                                     # filled cell: palette colour at 25 %
BLINK_HZ = 2.0                                  # pending cell: 2 blinks per second

# The 16 cell colours (Zelle.farbe 0..15). This is the authoritative table for cells: the page (public/loopdeck/) carries
# the same 16 values.
PALETTE = [
    (255, 64, 48), (255, 128, 32), (255, 190, 32), (230, 230, 40),
    (150, 230, 40), (50, 220, 70), (30, 220, 140), (30, 220, 220),
    (40, 160, 255), (60, 90, 255), (130, 80, 255), (190, 70, 240),
    (240, 70, 200), (255, 80, 130), (200, 200, 200), (140, 150, 170),
]
AUS = (0, 0, 0)
FADER_MIN_DB = -200.0                           # FADER_MIN of djk/ui/project/model.ts: "off" in the mixer
MITTE_RASTEN = 2                                # knob centre detent: |v7 - 64| <= 2 reads as 0
POST_JE_S = 30                                  # at most this many posts per second and control
EQ_MIN_DB, EQ_MAX_DB = -26.0, 6.0               # the kern's isolator range (s8_karte.zu_7bit, art "eq")
SCHICHTEN = ("filter", "tief", "mitte", "hoch", "hall", "delay")  # knob layers of the channel strip, in fx_1..4 order + SHIFT
SCHICHT_TEXT = {"filter": "FLT", "tief": "LO", "mitte": "MID", "hoch": "HI", "hall": "HALL", "delay": "DLY"}
RASTER_TEXT = {"1/4": "1/4", "1/2": "1/2", "1": "BEAT", "takt": "BAR", "4takte": "4 BARS"}


class LoopSicht:
    """View state of one side."""

    def __init__(self):
        self.paar = 0   # 0..3: rows 1-2 .. 7-8
        self.fokus = 1  # 1..4: track of the last pad pressed
        self.slice = False  # FREEZE slice mode: the 8 pads are the 8 slices of the focus track
        self.schicht = "filter"  # knob layer of the fx dials (SCHICHTEN)


def pad_ziel(sicht, pad):
    """Pad 1..8 -> (track 1..4, cell 1..8): pads 1-4 are the upper row of the pair, pads 5-8 the lower row."""
    spur = (pad - 1) % 4 + 1
    zeile = sicht.paar * 2 + (1 if pad <= 4 else 2)
    return spur, zeile


def _zelle(stand_deck, spur, zelle):
    try:
        return stand_deck["spuren"][spur - 1]["zellen"][zelle - 1]
    except (TypeError, KeyError, IndexError):
        return None


def pad_befehl(sicht, deck, pad, shift, stand_deck):
    """(route, body) for a pad press, or None. SHIFT + pad stops the pad's track; a pad on an empty cell does nothing
    (the page's load-target selection has no S8 equivalent). Remembers the track as focus."""
    spur, zelle = pad_ziel(sicht, pad)
    sicht.fokus = spur
    if not stand_deck:
        return None
    if shift:
        return "/loopdeck/stopp", {"deck": deck, "spur": spur}
    if not _zelle(stand_deck, spur, zelle):
        return None
    return "/loopdeck/start", {"deck": deck, "spur": spur, "zelle": zelle}


def _skaliert(farbe, f):
    return tuple(int(c * f) for c in farbe)


def led_farben(sicht, stand_deck, jetzt_s):
    """8 RGB values for pads 1..8: off = empty, dim = filled, bright = playing, blinking (2 Hz) = pending."""
    if not stand_deck:
        return [AUS] * 8
    an = int(math.floor(jetzt_s * BLINK_HZ * 2)) % 2 == 0
    out = []
    for pad in range(1, 9):
        spur, nr = pad_ziel(sicht, pad)
        z = _zelle(stand_deck, spur, nr)
        if not z:
            out.append(AUS)
            continue
        try:
            farbe = PALETTE[min(max(int(z.get("farbe", 0)), 0), 15)]
        except (TypeError, ValueError):
            farbe = PALETTE[0]
        lauf = (stand_deck["spuren"][spur - 1].get("lauf") or {})
        wartend = lauf.get("wartend")
        if wartend and wartend.get("zelle") == nr:
            out.append(farbe if an else _skaliert(farbe, DIMM))
        elif lauf.get("zelle") == nr and not lauf.get("verwaist"):
            out.append(farbe)
        else:
            out.append(_skaliert(farbe, DIMM))
    return out


SLICES = 8


def freeze_umschalten(sicht):
    """FREEZE: toggle the slice mode of the side; returns the new state."""
    sicht.slice = not sicht.slice
    return sicht.slice


def fokus_waehlen(sicht, spur):
    """Slice mode: `on_1..4` pick the focus track (1..4) instead of muting."""
    sicht.fokus = min(max(int(spur), 1), 4)


def slice_befehl(sicht, deck, pad, stand_deck):
    """(route, body) for a pad press in slice mode: jump the focus track to slice `pad` (1..8), or None without a loop deck."""
    if not stand_deck:
        return None
    return "/loopdeck/sprung", {"deck": deck, "spur": sicht.fokus, "slice": pad}


def slice_nr(zelle, lauf, jetzt_beat):
    """Slice 1..8 under the play position of the running cell, or None when nothing plays or the beat is unknown."""
    if not zelle or not lauf or jetzt_beat is None or not (zelle.get("beats") or 0) > 0:
        return None
    return min(int(_position(zelle, lauf, jetzt_beat) * SLICES), SLICES - 1) + 1


def _fokus_lauf(stand_deck, fokus):
    """(running cell or None, lauf) of the focus track; an orphaned run counts as nothing playing."""
    try:
        lauf = stand_deck["spuren"][fokus - 1].get("lauf") or {}
    except (TypeError, KeyError, IndexError):
        return None, {}
    if lauf.get("verwaist") or not lauf.get("zelle"):
        return None, lauf
    return _zelle(stand_deck, fokus, lauf["zelle"]), lauf


def slice_led_farben(sicht, stand_deck, jetzt_beat):
    """8 RGB values for slice mode: the colour of the focus track's playing cell, dim, the slice under the play position
    bright. Nothing playing on the focus track (or no loop deck): dark."""
    z, lauf = _fokus_lauf(stand_deck, sicht.fokus)
    if not z:
        return [AUS] * SLICES
    try:
        farbe = PALETTE[min(max(int(z.get("farbe", 0)), 0), 15)]
    except (TypeError, ValueError):
        farbe = PALETTE[0]
    hell = slice_nr(z, lauf, jetzt_beat)
    return [farbe if i == hell else _skaliert(farbe, DIMM) for i in range(1, SLICES + 1)]


def paar_drehen(sicht, schritte):
    sicht.paar = max(0, min(PAIRE - 1, sicht.paar + schritte))


def raster_drehen(raster, schritte):
    """The grid `schritte` steps along RASTER, clamped; an unknown grid counts as "1"."""
    i = RASTER.index(raster) if raster in RASTER else RASTER.index("1")
    return RASTER[max(0, min(len(RASTER) - 1, i + schritte))]


def szene_befehl(sicht, deck, unten):
    """Display button: scene of the upper (unten False) or lower visible row."""
    return "/loopdeck/szene", {"deck": deck, "zeile": sicht.paar * 2 + (2 if unten else 1)}


def capture_befehl(deck):
    """CAPTURE: load the active loop of the deck's own source into the loop deck (frozen route, quelle von_deck)."""
    return "/loopdeck/laden", {"deck": deck, "quelle": {"von_deck": deck}}


def fader_db(v7):
    """Track fader law: 7-bit value -> dB. 0 is the model's fader floor, 127 is 0 dB, in between 40 * log10(v7 / 127)."""
    v7 = min(int(v7), 127)
    if v7 <= 0:
        return FADER_MIN_DB
    return 40.0 * math.log10(v7 / 127.0)


def filter_wert(v7):
    """Track filter law: 7-bit value -> -1..1 (low-cut left, high-cut right), centre detent of +-2 around 64."""
    if abs(int(v7) - 64) <= MITTE_RASTEN:
        return 0.0
    return max(-1.0, min(1.0, (int(v7) - 64) / 63.0))


def eq_db(v7):
    """EQ knob law: 7-bit value -> dB. Centre detent of +-2 around 64 reads 0 dB; below it linear -26..0 (0 gives -26, 62
    gives 0), above it linear 0..+6 (66 gives 0, 127 gives +6). Mirrors the eq law of s8_karte.zu_7bit."""
    v7 = min(max(int(v7), 0), 127)
    if abs(v7 - 64) <= MITTE_RASTEN:
        return 0.0
    if v7 < 64:
        return EQ_MIN_DB + (-EQ_MIN_DB) * v7 / (64 - MITTE_RASTEN)
    return EQ_MAX_DB * (v7 - 64 - MITTE_RASTEN) / (127 - 64 - MITTE_RASTEN)


def eq_v7(db):
    """Inverse of eq_db for the pickup: the 7-bit value closest to `db`, clamped to -26..+6 (a value below -26, as the model
    holds for a send-less band, gives 0; 0 dB gives the detent centre 64)."""
    db = min(max(db, EQ_MIN_DB), EQ_MAX_DB)
    if db == 0:
        return 64
    if db < 0:
        return int(round((db - EQ_MIN_DB) / -EQ_MIN_DB * (64 - MITTE_RASTEN)))
    return 64 + MITTE_RASTEN + int(round(db / EQ_MAX_DB * (127 - 64 - MITTE_RASTEN)))


def send_db(v7):
    """Send knob law: the fader law, capped at 0 dB; 0 gives the floor (-200)."""
    return min(fader_db(v7), 0.0)


def schicht_waehlen(sicht, note, shift):
    """fx_1..4 (notes 31..34) pick the knob layer FILTER, LO, MID, HI; SHIFT + fx_1 / fx_2 pick HALL / DELAY (SHIFT + fx_3/4
    and every other note change nothing). True when the layer changed."""
    if not 31 <= note <= 34:
        return False
    if shift:
        neu = {31: "hall", 32: "delay"}.get(note)
        if neu is None:
            return False
    else:
        neu = SCHICHTEN[note - 31]
    if neu == sicht.schicht:
        return False
    sicht.schicht = neu
    return True


def schicht_feld(schicht):
    """Layer -> (route field, key): ("filter", None), ("eq", band) or ("send", key)."""
    if schicht in ("tief", "mitte", "hoch"):
        return "eq", schicht
    if schicht in ("hall", "delay"):
        return "send", schicht
    return "filter", None


def modell_wert(stand_spur, schicht):
    """The model value of the layer from a DeckSpur of the stand (filter, eq dB or send dB), None when it is missing."""
    feld, key = schicht_feld(schicht)
    try:
        v = stand_spur[feld] if key is None else stand_spur[feld][key]
        return None if v is None else float(v)
    except (TypeError, KeyError, ValueError):
        return None


def kill_spuren(stand_deck, schicht):
    """{track 1..4} whose band of the shown EQ layer is killed in the stand (empty for the other layers)."""
    feld, band = schicht_feld(schicht)
    if feld != "eq":
        return set()
    out = set()
    try:
        for i, sp in enumerate(stand_deck["spuren"][:4]):
            if (sp.get("kill") or {}).get(band):
                out.add(i + 1)
    except (TypeError, KeyError, AttributeError):
        return set()
    return out


def schicht_druck(deck, spur, schicht, stand_spur, anstehend=None):
    """SHIFT + on_n: (route, body) or None without a track. LO/MID/HI: toggle that band's kill; FILTER: filter to 0;
    HALL/DELAY: send to -200, a second press restores the value the stand had before the close. `anstehend` ({key: value},
    cleared by the next poll after the post was answered, like mute_befehl's) makes presses before a poll build on the
    request: kill toggles from the pending value, the send close is undone from the remembered one."""
    if not stand_spur:
        return None
    anstehend = {} if anstehend is None else anstehend
    feld, key = schicht_feld(schicht)
    body = {"deck": deck, "spur": spur}
    k = (deck, spur, feld, key)
    if feld == "eq":
        try:
            jetzt = bool(stand_spur["kill"][key])
        except (TypeError, KeyError):
            jetzt = False
        neu = not anstehend.get(k, jetzt)
        anstehend[k] = neu
        body["kill"] = {key: neu}
    elif feld == "send":
        if k in anstehend:  # a close is on its way: this press undoes it (when there is something to restore)
            geschlossen, vorher = anstehend[k]
            neu = vorher if geschlossen and vorher is not None and vorher > FADER_MIN_DB else -200
        else:
            neu, vorher = -200, modell_wert(stand_spur, schicht)
        anstehend[k] = (neu == -200, vorher if vorher is not None and vorher > FADER_MIN_DB else None)
        body["send"] = {key: neu}
    else:
        body["filter"] = 0
    return "/loopdeck/spur", body


def mute_befehl(deck, spur, stand_deck, anstehend):
    """(route, body) toggling the mute of track `spur` from the last stand, or None without a loop deck. `anstehend`
    ({(deck, spur): value}, cleared by the next poll) makes two presses before a poll toggle twice."""
    if not stand_deck:
        return None
    try:
        jetzt = bool(stand_deck["spuren"][spur - 1].get("mute"))
    except (TypeError, KeyError, IndexError):
        return None
    neu = not anstehend.get((deck, spur), jetzt)
    anstehend[(deck, spur)] = neu
    return "/loopdeck/spur", {"deck": deck, "spur": spur, "mute": neu}


class Drossel:
    """Throttle for continuous controls: per key at most one value every `abstand` seconds, always the latest one; a value
    equal to the last one sent is dropped. `grundwert` sets the last sent value without a post (the control's position when
    its view starts, so entering the view does not move anything)."""

    def __init__(self, abstand=1.0 / POST_JE_S):
        self.abstand = abstand
        self.wartend = {}
        self.zuletzt = {}  # key -> (value, time)
        self._lock = threading.Lock()

    def grundwert(self, schluessel, wert):
        with self._lock:
            self.zuletzt[schluessel] = (wert, self.zuletzt.get(schluessel, (None, None))[1])
            self.wartend.pop(schluessel, None)

    def vergiss(self, schluessel):
        """Drop the last sent and the pending value of a key (its control lost the pickup: a later equal value must go out)."""
        with self._lock:
            self.zuletzt.pop(schluessel, None)
            self.wartend.pop(schluessel, None)

    def setze(self, schluessel, wert, jetzt=None):
        with self._lock:
            self.wartend[schluessel] = wert

    def faellig(self, jetzt):
        """[(key, value)] that may go out at time `jetzt` (seconds); those leave the queue."""
        out = []
        with self._lock:
            for k in list(self.wartend):
                wert, zeit = self.zuletzt.get(k, (None, None))
                if zeit is not None and jetzt - zeit < self.abstand:
                    continue
                neu = self.wartend.pop(k)
                if neu == wert and k in self.zuletzt:
                    continue
                self.zuletzt[k] = (neu, jetzt)
                out.append((k, neu))
        return out


def raster_text(raster):
    return RASTER_TEXT.get(raster, "-")


def fuss_text(paar, raster, schicht="filter"):
    """Footer: the visible rows, the grid and the knob layer (always named, FLT included)."""
    return "ROWS %d-%d  GRID %s  %s" % (paar * 2 + 1, paar * 2 + 2, raster_text(raster), SCHICHT_TEXT.get(schicht, "FLT"))


def _position(zelle, lauf, jetzt_beat):
    """Play position 0..1 of the running cell (index 1.5: (beat - ab_beat + versatz_beats) mod beats / beats)."""
    beats = (zelle or {}).get("beats")
    if jetzt_beat is None or not beats or beats <= 0:
        return 0.0
    try:
        ab, versatz = float(lauf.get("ab_beat") or 0), float(lauf.get("versatz_beats") or 0)
    except (TypeError, ValueError):
        return 0.0
    p = ((max(jetzt_beat, ab) - ab + versatz) % beats) / beats
    return min(max(p, 0.0), 1.0)


def spalten(stand_deck, paar, jetzt_beat):
    """What the display draws: 4 columns, each {name, p, zeilen: [upper, lower]} with name the playing cell (or "-"), p its
    position 0..1 and a row entry {zelle, name, farbe, zustand} (zustand leer, gefuellt, spielt or wartend)."""
    out = []
    for spur in range(1, 5):
        try:
            lauf = stand_deck["spuren"][spur - 1].get("lauf") or {}
        except (TypeError, KeyError, IndexError):
            lauf = {}
        spielend = None if lauf.get("verwaist") else lauf.get("zelle")
        wartend = (lauf.get("wartend") or {}).get("zelle")
        zeilen = []
        for nr in (paar * 2 + 1, paar * 2 + 2):
            z = _zelle(stand_deck, spur, nr)
            zust = "leer"
            if z:
                zust = "wartend" if wartend == nr else "spielt" if spielend == nr else "gefuellt"
            try:
                farbe = min(max(int((z or {}).get("farbe", 0)), 0), 15)
            except (TypeError, ValueError):
                farbe = 0
            zeilen.append({"zelle": nr, "name": (z or {}).get("name") or "", "farbe": farbe, "zustand": zust})
        z = _zelle(stand_deck, spur, spielend) if spielend else None
        out.append({"name": (z.get("name") or "-") if z else "-", "p": _position(z, lauf, jetzt_beat) if z else 0.0,
                    "farbe": min(max(int(z.get("farbe", 0)), 0), 15) if z else 0, "zeilen": zeilen})
    return out


def fader_v7(db):
    """Inverse of fader_db: the 7-bit value whose dB is closest to `db` (floor and below give 0, above 0 dB gives 127)."""
    if db <= FADER_MIN_DB:
        return 0
    return max(0, min(127, int(round(127 * 10 ** (db / 40.0)))))


def _vorzeichen(x):
    return (x > 1e-9) - (x < -1e-9)


class Abholung:
    """Soft takeover of one fader or knob in the loops view. The control posts only after its value (through the same law as
    the posts) has reached or crossed the model value; until then nothing goes out. After the pickup it follows. The pickup
    is lost again when the track it addresses changes (`kennung`), or when the model changes from elsewhere by more than one
    step while the control is at rest (RUHE_S without a move)."""
    RUHE_S = 0.5

    def __init__(self, deck, spur, feld):
        self.deck, self.spur, self.feld = deck, spur, feld
        self.kennung = None
        self.abgeholt = False
        self.vz = 0
        self.v = None
        self.seit = 0.0

    def wert(self, v7):
        if self.feld == "fader_db":
            return fader_db(v7)
        if self.feld.startswith("eq:"):
            return eq_db(v7)
        if self.feld.startswith("send:"):
            return send_db(v7)
        return filter_wert(v7)

    def _ziel(self, modell):
        if self.feld == "fader_db":
            return min(max(modell, FADER_MIN_DB), fader_db(127))  # a model above the fader's range is picked up at the top
        if self.feld.startswith("eq:"):
            return min(max(modell, EQ_MIN_DB), EQ_MAX_DB)
        if self.feld.startswith("send:"):
            return min(max(modell, FADER_MIN_DB), 0.0)
        return min(max(modell, -1.0), 1.0)

    def _schritte(self, v7, modell):
        if self.feld == "fader_db" or self.feld.startswith("send:"):
            return abs(fader_v7(self._ziel(modell)) - v7)
        if self.feld.startswith("eq:"):
            ziel = self._ziel(modell)
            return 0 if eq_db(v7) == ziel else abs(eq_v7(ziel) - v7)  # the detent counts as the model's 0
        return abs(filter_wert(v7) - modell) * 63.0  # the detent counts as the model's 0

    def schritt(self, v7, modell, kennung, jetzt):
        """One report of the control: True when it may post `self.wert(v7)`."""
        w, ziel = self.wert(v7), self._ziel(modell)
        if kennung != self.kennung:
            self.kennung, self.abgeholt, self.vz, self.v, self.seit = kennung, False, _vorzeichen(w - ziel), v7, jetzt
        if not self.abgeholt:
            s = _vorzeichen(w - ziel)
            if s == 0 or s != self.vz:
                self.abgeholt = True
        else:
            if v7 != self.v:
                self.seit = jetzt
            elif jetzt - self.seit >= self.RUHE_S and self._schritte(v7, modell) > 1:
                self.abgeholt, self.vz = False, _vorzeichen(w - ziel)
        self.v = v7
        return self.abgeholt


def nicht_abgeholt(abholungen, deck):
    """{track: [field, ...]} of the controls of side `deck` that are not picked up (for the display marker)."""
    out = {}
    for a in abholungen.values():
        if a.deck == deck and not a.abgeholt:
            out.setdefault(a.spur, []).append(a.feld)
    return out
