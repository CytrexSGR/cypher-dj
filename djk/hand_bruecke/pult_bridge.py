#!/usr/bin/env python3
"""pult_bruecke: one MIDI source for the kern's hand_in, made from all hardware controllers of the DJ desk.

- Akai APC20 (class-compliant MIDI, channels 1..8) is forwarded unchanged, except while the main window shows PRODUCTION: then
  apc_production.py makes it the project mixer (channel 16 to the kern, bank and arm through the page server); while it shows SESSION,
  apc_session.py makes it the launch grid (/session/* routes), everything but the grid, scenes and Shift + arrows still goes the DJ console way.
- Traktor Kontrol S8 (HID, no MIDI of its own) is read over usbfs (interface 5) and turned into MIDI on channels 9..15
  (layout in s8_map.py).
- Maschine MK2 (HID) is the Baukasten desk: group buttons pick a channel, encoders turn its graph knobs (mk2.py, via the
  page server like the tablet).
- LED messages from the kern (port "led") on channels 1..8 go back to the APC20; S8 pad LEDs follow the hot cues (see s8_leds); button LEDs are probed with --led-probe.

ALSA client "cypherdj-pult": port "hand" (out, -> kern hand_in), "led" (in, <- kern hand_led), "apc_ein", "apc_aus".
The bridge links its own "hand" port to cypherdj-kern:hand_in every few seconds (the kern only links the quelle_port it read
at start). Mapping in djk/config/controller/pult.json.

  pult_bridge.py            run (service)
  pult_bridge.py --monitor  also print every S8 event with its name (for checking the map by hand)
  pult_bridge.py --led-probe 0x80 --offsets 44-72 [--wert 127] [--sekunden 2.0]  light one LED byte at a time (service stopped)
"""
import argparse
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alsa_seq  # noqa: E402
import nidrv  # noqa: E402
import s8_map as K  # noqa: E402
import s8_usb  # noqa: E402
import assignment as belegung  # noqa: E402
import deck_page as deck_seite  # noqa: E402
import loopdeck_page as loopdeck_seite  # noqa: E402
import s8_loopdeck  # noqa: E402
import lc3  # noqa: E402
import launchpad  # noqa: E402
import apc_production as apc_produktion  # noqa: E402
import apc_session  # noqa: E402

try:
    import mk2  # noqa: E402  (needs numpy and Pillow)
except ImportError as e:
    mk2 = None
    _MK2_FEHLER = e

try:
    import s8_display as s8_anzeige  # noqa: E402  (needs numpy and Pillow)
except ImportError as e:  # the controls work without the screens
    s8_anzeige = None
    _ANZEIGE_FEHLER = e

APC = "Akai APC20:0"
KERN_HAND = "cypherdj-kern:hand_in"
JACK_HAND = "Midi-Bridge:cypherdj-pult:hand (capture)"
S8_PID = 0x1370
S8_IFACE = 5
ZAEHLER_JE_RASTE = 40  # screen encoder counts per relative step (no detents, see 02-UEBERGABE §2.4)
NUDGE_JE_UMDREHUNG = 1.0  # beats one turn of screen encoder 2 (1000 counts) moves a deck


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


class Bruecke:
    def __init__(self, monitor=False):
        self.monitor = monitor
        self.seq = alsa_seq.Client("cypherdj-pult")
        self.p_hand = self.seq.port_out("hand")
        self.p_led = self.seq.port_in("led")
        self.p_apc_ein = self.seq.port_in("apc_ein")
        self.p_apc_aus = self.seq.port_out("apc_aus")
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.s8_leds_verworfen = 0
        self.deck = deck_seite.DeckSeite(log)  # hot cues and loop through the page server (not in the kern hand path yet)
        self.apc = apc_produktion.ApcProduktion(log, self.zum_apc, self.senden)  # the APC20 as the project mixer while the main window shows PRODUCTION
        # the APC20 as the launch grid while the main window shows SESSION (apc_session.py); the view comes from the PRODUCTION poll
        self.apc_session = apc_session.ApcSession(log, self.zum_apc, ansicht=lambda: self.apc.lage.get("ansicht"),
                                                  wiederhole=lambda: list(self.apc.dj_leds.values()))
        self.loops = {1: s8_loopdeck.LoopSicht(), 2: s8_loopdeck.LoopSicht()}  # loops view state per side (s8_loopdeck.py)
        self.strip_zeit = {}  # side -> time of the last needle-search jump
        self.strip_griff = {}  # side -> grip state while the strip holds the deck without SHIFT (bend or scratch)
        self.strip_sprung = {}  # side -> {"start", "gesendet"} while SHIFT + strip seeks
        self.loop_groesse = {1: 4, 2: 4}  # beats per deck, set by the loop encoder (ladder 1..64)
        self.stand = {"ansicht": {1: "deck", 2: "deck"}, "loop_groesse": self.loop_groesse}  # shared with the screen loop
        self.loopdeck = loopdeck_seite.LoopdeckSeite(log, self.stand["ansicht"])  # loop deck requests and stand (loops view)
        self.stand["loopdeck"], self.stand["loops_sicht"] = self.loopdeck, self.loops  # the loops screen reads both
        self.analog_loops = set()  # analog rows (names) that went to the loop deck instead of MIDI since their view began
        self.analog_v7 = {}  # row name -> last 7-bit value (physical position of the control)
        self.abholung = {}  # row name -> s8_loopdeck.Abholung: soft takeover of a control in the loops view
        self.midi_zuletzt = {}  # row name -> last value forwarded as MIDI before its loops view began
        self.rueck = {}  # row name -> (remembered MIDI value, side of the control): held back after the view until crossed
        self.stand["abholung"] = self.abholung  # the loops screen marks controls that have not picked up
        # lage/pegel from the screen loop, read by the LED loop
        self.tasten = K.tasten()
        self.analog = K.analog()
        self.encoder = K.encoder()
        bekannt = {(b, m) for _, b, m, _, _ in self.tasten}
        self.frei_bits = {(b, 1 << i) for b in range(4, 26) for i in range(8)} - bekannt  # unmapped, for the monitor

    def senden(self, data):
        with self.lock:
            self.seq.send(self.p_hand, data)

    def zum_apc(self, data):
        with self.lock:
            self.seq.send(self.p_apc_aus, data)

    def led_vom_kern(self, data):
        """A kern LED message on channels 1..8 for the APC20: sent unless PRODUCTION or SESSION owns the grid."""
        if self.apc.vom_kern(bytes(data)) and not self.apc_session.haelt_zurueck(bytes(data)):
            with self.lock:
                self.seq.send(self.p_apc_aus, data)

    # -- S8 -------------------------------------------------------------------------------------------------------
    def s8_schleife(self):
        while not self.stop.is_set():
            dev = nidrv.find_ni(S8_PID)
            if not dev:
                time.sleep(2)
                continue
            try:
                t = nidrv.UsbfsTransport(dev, S8_IFACE, ep_in=0x84, ep_out=0x03, in_size=256)
            except (OSError, RuntimeError) as e:
                log("S8: cannot claim interface 5:", e)
                time.sleep(5)
                continue
            log("S8: claimed", dev["path"], t.how)
            alt1, alt2, gesendet, enc_alt, enc_rest = None, None, {}, {}, {}
            ende = threading.Event()
            try:
                usb = s8_usb.S8Usb(t, log)
                usb.senden(bytes([0xF3, 0x01]))  # Encdr: "Traktor mode" handshake that unlocks LED control (unverified)
                threading.Thread(target=self.s8_leds, args=(usb, ende), daemon=True).start()
                for r in usb.berichte(self.stop):
                    if r[0] == 0x01 and len(r) >= 26:
                        alt1 = self.s8_tasten(r, alt1)
                    elif r[0] == 0x02 and len(r) >= 109:
                        alt2 = self.s8_analog(r, alt2, gesendet, enc_alt, enc_rest)
            except OSError as e:
                log("S8: read ended:", e)
            finally:
                ende.set()
                t.close()
            time.sleep(1)

    def s8_leds(self, usb, ende, hz=10.0):
        """Per deck section one frame: pads (set hot cues in the deck colour, empty pads dim) and, with the card
        s8_leds.json, the PLAY and LOOP LEDs from deck state. Frames go out only on change."""
        import s8_led
        try:
            karte = s8_led.lade_karte(os.path.join(os.path.dirname(os.path.abspath(__file__)), "s8_leds.json"))
        except (OSError, ValueError) as e:
            log("S8 button LEDs off:", e)
            karte = None
        alt = {}
        while not ende.is_set() and not self.stop.is_set():
            cues = self.stand.get("cues") or {}
            lage = self.stand.get("lage")
            for rid, deck in ((0x80, 1), (0x81, 2)):
                farben = None
                if self.stand["ansicht"].get(deck) == "loops":  # loops view: pads show the cells of the visible row pair
                    sicht = self.loops[deck]
                    if sicht.slice:
                        farben = s8_loopdeck.slice_led_farben(sicht, self.loopdeck.deck(deck), self.loopdeck.beat_jetzt())
                    else:
                        farben = s8_loopdeck.led_farben(sicht, self.loopdeck.deck(deck), time.time())
                frame = s8_led.rahmen_fuer_seite(rid, deck, set(cues.get(deck) or {}), lage, karte, farben,
                                                 freeze=self.loops[deck].slice and self.stand["ansicht"].get(deck) == "loops")
                if alt.get(rid) != frame:
                    usb.senden(frame)
                    alt[rid] = frame
            ende.wait(1.0 / hz)

    def s8_tasten(self, r, alt):
        shift = {13: bool(r[9] & 0x80), 14: bool(r[17] & 0x80)}  # left/right SHIFT held in this report
        for name, b, m, kanal, note in self.tasten:
            jetzt = bool(r[b] & m)
            if alt is not None and jetzt == bool(alt[b] & m):
                continue
            if alt is None and not jetzt:
                continue  # first report: only report what is held
            d = kanal - 12  # deck A left, B right
            if belegung.faengt_ab(kanal, note, self.stand["ansicht"].get(d)):
                if jetzt:  # pads = hot cues 1..8 (SHIFT deletes; empty pad during a loop stores the loop), LOOP = loop on/off
                    a = self.stand["ansicht"]
                    if note == 15:
                        self.deck.loop(d, self.loop_groesse[d])
                    elif note == 19:  # DECK: deck <-> loops view (from studio or seq it goes to loops)
                        self.ansicht_setzen(d, "deck" if a[d] == "loops" else "loops")
                    elif note == 40:  # top-left screen button: next screen view (deck -> studio -> seq -> loops -> deck)
                        self.ansicht_setzen(d, {"deck": "studio", "studio": "seq", "seq": "loops"}.get(a[d], "deck"))
                    elif a[d] == "loops":
                        self.loops_taste(d, note, shift[kanal])
                    else:
                        self.deck.hotcue(d, note - 19, loeschen=shift[kanal], loop_laenge=self.loop_groesse[d])
                if self.monitor:
                    log("S8", name, "down" if jetzt else "up")
                continue
            self.senden(bytes([(0x90 if jetzt else 0x80) | (kanal - 1), note, 127 if jetzt else 0]))
            if self.monitor:
                log("S8", name, "down" if jetzt else "up")
        if alt is not None and len(r) >= 38:  # touch strips: finger 1 left bytes 28/29, right 34/35 (both measured 2026-11-14)
            for d, b in ((1, 28), (2, 34)):
                pos, vorher = r[b] | r[b + 1] << 8, alt[b] | alt[b + 1] << 8
                if pos != vorher:
                    self.strip(d, pos, vorher, bool(r[9 if d == 1 else 17] & 0x80))
        if alt is not None:
            for d, b, sh in ((1, 1, 4), (2, 2, 4)):  # browse encoders: left byte 1 high nibble (measured), right byte 2 high
                schritt = ((r[b] >> sh & 15) - (alt[b] >> sh & 15) + 8) % 16 - 8   # (measured 2026-11-14); deck view: move the track
                if schritt and self.stand["ansicht"].get(d) == "loops":  # loops view: the row pair
                    s8_loopdeck.paar_drehen(self.loops[d], schritt)
                elif schritt:  # one detent = 1 beat, with SHIFT 1 bar (Traktor's jog when stopped)
                    self.deck.spulen(d, schritt * (4 if r[9 if d == 1 else 17] & 0x80 else 1))
            for d, b, sh in ((1, 1, 0), (2, 2, 0)):  # loop encoders next to the small faders: left byte 1 low nibble
                # (measured 2026-11-14), right byte 2 low nibble (measured the same evening); 4-bit absolute, wrapping
                schritt = ((r[b] >> sh & 15) - (alt[b] >> sh & 15) + 8) % 16 - 8
                if schritt:
                    self.loop_drehen(d, schritt)
        if self.monitor and alt is not None:
            for b, m in self.frei_bits:
                if (r[b] ^ alt[b]) & m:
                    log("S8 unmapped bit", b, hex(m), "now", bool(r[b] & m))
            for b in (1, 2, 3):  # descriptor: 6 x 4-bit endless encoders (browse/loop?), never decoded so far
                for k, sh in ((0, 0), (1, 4)):
                    if ((r[b] >> sh) & 15) != ((alt[b] >> sh) & 15):
                        log("S8 nibble", b, "lo" if k == 0 else "hi", (alt[b] >> sh) & 15, "->", (r[b] >> sh) & 15)
            if len(r) >= 38:  # descriptor: 2 x (16-bit time + 2 x 16-bit finger) = touch strips left 26..31, right 32..37
                for seite, b in (("left", 28), ("right", 34)):
                    f1, f2 = r[b] | r[b + 1] << 8, r[b + 2] | r[b + 3] << 8
                    a1, a2 = alt[b] | alt[b + 1] << 8, alt[b + 2] | alt[b + 3] << 8
                    if (f1, f2) != (a1, a2):
                        log("S8 strip", seite, f1, f2)
        return bytes(r)

    STRIP_MIN, STRIP_MAX = 20, 950  # finger values at the ends of the strip (measured left, 2026-11-14: 17..949); 0 = untouched
    STRIP_BEATS = 8                 # stopped deck without SHIFT: the whole strip scratches the track by 8 beats
    SEEK_BEATS = 64                 # SHIFT: the whole strip moves the track by 16 bars (relative, whole beats)
    BEND_MAX = 0.35                 # playing deck without SHIFT: at most 35 % faster/slower while the finger moves
    BEND_VOLL = 1500.0              # finger speed (counts/s; the strip is ~930 counts) that gives the full bend
    BEND_RUHE = 250.0               # below this the finger counts as still (the strip jitters by about 5 counts)
    BEND_TAU = 0.06                 # s, smoothing of the finger speed

    def strip(self, d, pos, vorher, shift):
        """Traktor (S8 QML, see s8-traktor-belegung.md 2): SHIFT + touch = track seek, here relative (Andreas 2026-11-14:
        the absolute needle search jumped too far to control; one count was about a beat). Without SHIFT a stopped deck is
        scratched (the finger holds and moves the track), a playing deck gets a tempo bend: moving the finger right
        speeds it up, left slows it down, in proportion to the finger speed; a still finger is normal speed. Both go
        through the audible drag (/deck/scrub); lifting the finger releases it."""
        g = self.strip_griff.get(d)  # grip without SHIFT: {"art", "start", "delta", "t", "pos", "v"}
        if not pos:
            sp = self.strip_sprung.pop(d, None)
            if sp and sp["ziel"] != sp["gesendet"]:  # the last beats the throttle held back
                self.deck.spulen(d, sp["ziel"] - sp["gesendet"])
            if g:
                del self.strip_griff[d]
                self.deck.scrub(d, 0, g["delta"])
            return
        self.STRIP_MAX = max(self.STRIP_MAX, pos)
        self.STRIP_MIN = min(self.STRIP_MIN, pos)
        breite = self.STRIP_MAX - self.STRIP_MIN
        lage = self.stand.get("lage") or {}
        deck = next((z for z in lage.get("decks", []) if z.get("deck") == d), {})
        jetzt = time.monotonic()
        if shift and not g:  # relative seek: the finger's way from where it touched, in whole beats (the deck stays on the beat)
            s = self.strip_sprung.get(d)
            if s is None:
                s = self.strip_sprung[d] = {"start": pos, "gesendet": 0, "ziel": 0}
                if deck.get("loop"):  # first touch: end a running loop, otherwise the kern drags it along
                    self.deck.loop(d, 0)
            ziel = s["ziel"] = int(round((pos - s["start"]) / breite * self.SEEK_BEATS))
            if ziel != s["gesendet"] and jetzt - self.strip_zeit.get(d, 0.0) >= 0.05:  # at most ~20 jumps per second
                self.strip_zeit[d] = jetzt
                self.deck.spulen(d, ziel - s["gesendet"])
                s["gesendet"] = ziel
            return
        if not g:
            if vorher:  # the finger came with SHIFT and SHIFT was let go: no grip until the next touch
                return
            art = "bend" if int(deck.get("status") or 0) >= 2 else "scratch"
            self.strip_griff[d] = {"art": art, "start": pos, "delta": 0.0, "t": jetzt, "pos": pos, "v": 0.0}
            self.deck.scrub(d, 1, 0.0)
            return
        if g["art"] == "scratch":
            g["delta"] = (pos - g["start"]) / breite * self.STRIP_BEATS
        else:
            dt = max(1e-3, jetzt - g["t"])
            v = (pos - g["pos"]) / dt
            g["v"] += (v - g["v"]) * min(1.0, dt / self.BEND_TAU)
            v = g["v"] if abs(g["v"]) >= self.BEND_RUHE else 0.0
            bend = max(-self.BEND_MAX, min(self.BEND_MAX, v / self.BEND_VOLL * self.BEND_MAX))
            bpm = float(deck.get("basis_bpm") or 0) * float(deck.get("faktor") or 0) or float((lage.get("uhr") or {}).get("bpm") or 128)
            beats_je_s = bpm / 60.0  # track beats per second at the deck's current speed
            g["delta"] += bend * beats_je_s * min(dt, 0.05)  # the extra beats the bend adds; a gap in reports adds nothing
        g["t"], g["pos"] = jetzt, pos
        self.deck.scrub(d, 2, g["delta"])

    def jetzt(self):
        return time.monotonic()

    def ansicht_setzen(self, d, neu):
        """Change the view of side d. Leaving the loops view sends nothing: a control that moved in the loops view is held
        back from MIDI until its value has reached or crossed the value last forwarded before the view (`rueck`), so the
        deck's own track does not jump. Controls that did not move forward at once. Only the rows of side d are touched."""
        a = self.stand["ansicht"]
        alt, a[d] = a[d], neu
        if neu != "loops":
            self.loops[d].slice = False  # slice mode ends with the loops view
        if alt == "loops" and neu != "loops":
            for name, _, kanal, cc, _ in self.analog:
                if kanal == 12 + d and 20 <= cc <= 27 and name in self.analog_loops:
                    ziel, v = self.midi_zuletzt.pop(name, None), self.analog_v7.get(name)
                    if ziel is not None and v is not None and v != ziel:
                        self.rueck[name] = (ziel, (v > ziel) - (v < ziel))
                    self.analog_loops.discard(name)
                    self.abholung.pop(name, None)

    def loops_regler(self, d, name, cc, v):
        """Loops view: a fader (CC 24..27) is the volume of track 1..4; an fx dial (CC 20..23) is the value of the side's knob
        layer (filter, EQ band or send) of track 1..4. Soft takeover: the control posts only once its value has reached or
        crossed the model value of the stand (s8_loopdeck.Abholung), per layer. Without a loop deck nothing is posted."""
        stand = self.loopdeck.deck(d)
        if cc >= 24:
            spur, feld = cc - 23, "fader_db"
        else:
            spur = cc - 19
            gruppe, key = s8_loopdeck.schicht_feld(self.loops[d].schicht)
            feld = gruppe if key is None else f"{gruppe}:{key}"
        try:
            sp = stand["spuren"][spur - 1]
            modell = float(sp[feld]) if cc >= 24 else s8_loopdeck.modell_wert(sp, self.loops[d].schicht)
            kennung = (stand.get("gruppe_id"), sp.get("spur_id"))
            if modell is None:
                raise ValueError(feld)
        except (TypeError, KeyError, IndexError, ValueError):
            self.abholung.pop(name, None)
            return
        ab = self.abholung.get(name)
        if ab is not None and ab.feld != feld:  # the layer changed: the knob has to pick up again
            self.loopdeck.vergessen(d, ab.spur, ab.feld)
            ab = None
        if ab is None:
            ab = self.abholung[name] = s8_loopdeck.Abholung(d, spur, feld)
        if ab.schritt(v, modell, kennung, self.jetzt()):
            self.loopdeck.regeln(d, spur, feld, ab.wert(v))
        else:
            self.loopdeck.vergessen(d, spur, feld)

    def loops_taste(self, d, note, shift):
        """A bridge-owned press in the loops view of side d: pads 20..27, fx buttons 31..34 (knob layer), buttons under the knobs
        35..38 (mutes; with SHIFT the layer's reset or kill), display buttons 44/45 (scene), CAPTURE 49, FREEZE 16 (slice mode:
        pads jump to slices, on 1..4 pick the focus)."""
        befehl = None
        sicht = self.loops[d]
        if note == 16:
            s8_loopdeck.freeze_umschalten(sicht)
        elif 31 <= note <= 34:
            if s8_loopdeck.schicht_waehlen(sicht, note, shift):
                self.schicht_gewechselt(d)
        elif 35 <= note <= 38 and sicht.slice:  # slice mode: the buttons under the knobs pick the focus track
            s8_loopdeck.fokus_waehlen(sicht, note - 34)
        elif 35 <= note <= 38 and shift:  # SHIFT + on_n: the layer's kill (LO/MID/HI), filter reset or send off
            try:
                sp = self.loopdeck.deck(d)["spuren"][note - 35]
            except (TypeError, KeyError, IndexError):
                sp = None
            befehl = s8_loopdeck.schicht_druck(d, note - 34, sicht.schicht, sp, self.loopdeck.streifen)
        elif 35 <= note <= 38:
            befehl = s8_loopdeck.mute_befehl(d, note - 34, self.loopdeck.deck(d), self.loopdeck.mute)
        elif 20 <= note <= 27 and sicht.slice:
            befehl = s8_loopdeck.slice_befehl(sicht, d, note - 19, self.loopdeck.deck(d))
        elif 20 <= note <= 27:
            befehl = s8_loopdeck.pad_befehl(self.loops[d], d, note - 19, shift, self.loopdeck.deck(d))
        elif note in (44, 45):
            befehl = s8_loopdeck.szene_befehl(self.loops[d], d, note == 45)
        elif note == 49:
            befehl = s8_loopdeck.capture_befehl(d)
        if befehl:
            self.loopdeck.senden(*befehl)

    def schicht_gewechselt(self, d):
        """The knob layer of side d changed: the dials (not the faders) lose their pickup and pick up again in the new layer."""
        for name in [n for n, a in self.abholung.items() if a.deck == d and a.feld != "fader_db"]:
            a = self.abholung.pop(name)
            self.loopdeck.vergessen(d, a.spur, a.feld)

    def raster_drehen(self, d, schritt):
        """Loops view: the loop encoder steps the grid (1/4 .. 4 bars). No loop deck yet: nothing to change."""
        stand = self.loopdeck.deck(d)
        if not stand:
            return
        alt = self.loopdeck.raster.get(d) or stand.get("raster")
        neu = s8_loopdeck.raster_drehen(alt, schritt)
        if neu != alt:
            self.loopdeck.raster[d] = neu  # builds further turns on the request until the next poll
            self.loopdeck.senden("/loopdeck/raster", {"deck": d, "raster": neu})

    LOOP_LEITER = [1, 2, 4, 8, 16, 32, 64]  # beats the page server accepts for a deck loop

    def loop_drehen(self, d, schritt):
        """Traktor's loop encoder: one detent halves/doubles the loop size; a running loop takes the new size.
        In the loops view it steps the grid instead."""
        if self.stand["ansicht"].get(d) == "loops":
            return self.raster_drehen(d, schritt)
        i = self.LOOP_LEITER.index(self.loop_groesse[d]) if self.loop_groesse[d] in self.LOOP_LEITER else 2
        neu = self.LOOP_LEITER[max(0, min(len(self.LOOP_LEITER) - 1, i + (1 if schritt > 0 else -1)))]
        if neu != self.loop_groesse[d]:
            self.loop_groesse[d] = neu
            self.deck.loop_groesse(d, neu)

    def s8_analog(self, r, alt, gesendet, enc_alt, enc_rest):
        for name, b, kanal, cc, art in self.analog:
            roh = r[b] | (r[b + 1] << 8)
            v = K.zu_7bit(roh, art)
            if kanal in (13, 14) and 20 <= cc <= 27:
                self.analog_v7[name] = v
                if self.stand["ansicht"].get(kanal - 12) == "loops":  # loops view: track volume and filter, not MIDI
                    if name not in self.analog_loops:  # the view began: remember what the deck last got from this control
                        self.analog_loops.add(name)
                        self.midi_zuletzt[name] = gesendet.get(name)
                        self.rueck.pop(name, None)
                    self.loops_regler(kanal - 12, name, cc, v)
                    continue
                if name in self.rueck:  # after the loops view: forward again once the remembered value is reached or crossed
                    ziel, vz = self.rueck[name]
                    if (v > ziel) - (v < ziel) not in (0, -vz):
                        continue
                    del self.rueck[name]
            if gesendet.get(name) == v:
                continue
            gesendet[name] = v
            self.senden(bytes([0xB0 | (kanal - 1), cc, v]))
            if self.monitor and alt is not None:
                log("S8", name, roh, "->", v)
        for name, b, kanal, cc in self.encoder:
            pos = r[b] | (r[b + 1] << 8)
            if name not in enc_alt:
                enc_alt[name], enc_rest[name] = pos, 0
                continue
            d = (pos - enc_alt[name] + 500) % 1000 - 500
            enc_alt[name] = pos
            if not d:
                continue
            seite = 1 if name.startswith("left") else 2
            if name.endswith("_encoder_2"):  # screen encoder 2: fine nudge, one turn = 1 beat (one grip per turning)
                self.deck.nudge(seite, d / 1000.0 * NUDGE_JE_UMDREHUNG)
                if self.monitor:
                    log("S8", name, "nudge counts", d)
                continue
            enc_rest[name] += d
            schritte = int(enc_rest[name] / ZAEHLER_JE_RASTE)
            if not schritte:
                continue
            enc_rest[name] -= schritte * ZAEHLER_JE_RASTE
            schritte = max(-63, min(63, schritte))
            if name.endswith("_encoder_1"):  # screen encoder 1: loop size, like the loop encoder next to the small faders
                self.loop_drehen(seite, schritte)
                if self.monitor:
                    log("S8", name, "loop steps", schritte)
                continue
            self.senden(bytes([0xB0 | (kanal - 1), cc, schritte & 0x7F]))
            if self.monitor:
                log("S8", name, "steps", schritte)
        if self.monitor and alt is not None:
            for i in range(17, 109, 2):
                if any(i == b or i == b + 1 for _, b, _, _, _ in self.analog):
                    continue
                if abs((r[i] | r[i + 1] << 8) - (alt[i] | alt[i + 1] << 8)) > 40:
                    log("S8 unmapped analog at", i, r[i] | r[i + 1] << 8)
        return bytes(r)

    def anzeige_schleife(self):
        if s8_anzeige is None:
            log("S8 screens off:", _ANZEIGE_FEHLER)
            return
        while not self.stop.is_set():
            dev = nidrv.find_ni(S8_PID)
            if not dev:
                time.sleep(2)
                continue
            try:
                a = s8_anzeige.Anzeige(dev, log)
            except (OSError, RuntimeError) as e:
                log("S8 screens: cannot claim the vendor interface:", e)
                time.sleep(5)
                continue
            log("S8 screens: running")
            try:
                a.schleife(self.stop, self.stand)
            except OSError as e:
                log("S8 screens ended:", e)
            finally:
                a.close()
            time.sleep(1)

    def mk2_schleife(self):
        if mk2 is None:
            log("MK2 off:", _MK2_FEHLER)
            return
        while not self.stop.is_set():
            dev = nidrv.find_ni(0x1140)
            if not dev:
                time.sleep(2)
                continue
            try:
                p = mk2.Mk2Pult(dev, log)
            except (OSError, RuntimeError) as e:
                log("MK2: cannot claim the HID interface:", e)
                time.sleep(5)
                continue
            log("MK2: claimed", dev["path"])
            try:
                p.lauf(self.stop)
            except OSError as e:
                log("MK2: read ended:", e)
            time.sleep(1)

    # -- MIDI side ------------------------------------------------------------------------------------------------
    def verbinden(self):
        with self.lock:
            self.seq.connect_from(self.p_apc_ein, APC)
            self.seq.connect_to(self.p_apc_aus, APC)
        r = subprocess.run(["pw-link", JACK_HAND, KERN_HAND], capture_output=True, text=True)
        if r.returncode == 0:
            log("linked", JACK_HAND, "->", KERN_HAND)

    def lauf(self):
        threading.Thread(target=self.s8_schleife, daemon=True).start()
        threading.Thread(target=self.anzeige_schleife, daemon=True).start()
        threading.Thread(target=self.mk2_schleife, daemon=True).start()
        threading.Thread(target=lc3.lauf, args=(self.stop, log), daemon=True).start()   # Launch Control 3: LEDs and display follow the learn table
        threading.Thread(target=launchpad.lauf, args=(self.stop, log), daemon=True).start()   # Launchpad Mini MK3: SEQ step grid (launchpad.py)
        self.apc.starte(self.stop)   # APC20: DJ console or, while the main window shows PRODUCTION, the project mixer (apc_production.py)
        self.apc_session.starte(self.stop)   # ... or, while it shows SESSION, the launch grid (apc_session.py)
        naechste = 0.0
        while not self.stop.is_set():
            if time.monotonic() >= naechste:
                self.verbinden()
                naechste = time.monotonic() + 3.0
            with self.lock:
                ein = self.seq.receive()
            if not ein:
                time.sleep(0.001)
                continue
            for port, data in ein:
                if port == self.p_apc_ein:
                    if data and self.apc.an():
                        self.apc.vom_apc(bytes(data))
                        continue
                    try:
                        if data and self.apc_session.vom_apc(bytes(data)):
                            continue
                    except Exception as e:   # a malformed stand must not end the MIDI loop
                        log("APC20 session:", repr(e))
                        continue   # SESSION: grid, clip stop, scenes, stop all and Shift + arrows are taken; the rest goes the DJ console way
                    if data and (data[0] & 0x0F) < 8:
                        if len(data) == 3 and data[0] & 0xF0 == 0x90 and data[2] and (data[0] & 0x0F) < 4 and data[1] in (55, 56, 57):
                            d = (data[0] & 0x0F) + 1  # APC20 deck columns: rows 3/4 = hot cue 1/2, row 5 = loop
                            (self.deck.loop(d) if data[1] == 57 else self.deck.hotcue(d, data[1] - 54))
                            continue
                        if len(data) == 3 and data[0] & 0xF0 in (0x80, 0x90) and (data[0] & 0x0F) < 4 and data[1] in (55, 56, 57):
                            continue
                        self.senden(data)
                elif port == self.p_led and data:
                    if (data[0] & 0x0F) < 8:
                        self.led_vom_kern(data)
                    else:
                        self.s8_leds_verworfen += 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--monitor", action="store_true", help="print every S8 event with its name")
    ap.add_argument("--led-probe", metavar="REPORT", help="light one LED report byte at a time (0x80, 0x81 or 0x82) and exit; "
                    "stop the cypherdj-pult unit first, it owns the S8")
    ap.add_argument("--offsets", help="with --led-probe: offsets such as 58,59,60,65-68 (default 44-72, or 44-56 for 0x82)")
    ap.add_argument("--wert", type=int, default=127, help="with --led-probe: byte value (default 127)")
    ap.add_argument("--sekunden", type=float, default=2.0, help="with --led-probe: seconds per offset (default 2.0)")
    a = ap.parse_args()
    if a.led_probe is not None:
        import s8_led
        try:
            bericht = int(a.led_probe, 0)
            offsets = s8_led.probe_offsets(a.offsets or ("44-56" if bericht == 0x82 else "44-72"))
            s8_led.einzel_bericht(bericht, offsets[0], a.wert)
        except ValueError as e:
            ap.error(str(e))
        sys.exit(s8_led.probe_lauf(log, bericht, offsets, a.wert, a.sekunden))
    belegung.schreibe(belegung.DATEI)  # the register lists these controls (they are in no mapping file)
    b = Bruecke(monitor=a.monitor)
    log("cypherdj-pult up, ALSA client", b.seq.id)
    try:
        b.lauf()
    except KeyboardInterrupt:
        pass
    finally:
        b.stop.set()


if __name__ == "__main__":
    main()
