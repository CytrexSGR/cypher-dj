# mk2.py: Maschine MK2 (17cc:1140, HID interface 2) as the Baukasten desk.
# Group buttons A..H pick a channel that carries a Baukasten graph, the 8 screen encoders turn that graph's knobs
# (<kanal>/bk/N), top buttons 1..8 pick the knob page (knobs 1-8, 9-16, ...). The two displays show channel, graph,
# knob names and values. Knob moves go to the page server as POST /regler (Andreas' hand, the same way the page and
# the tablet set graph knobs), so every graph knob works without a mapping table.
# Protocol (measured in the sandbox): buttons LSB-first, encoders absolute
# 0..999 wrapping, display 256x64 1 bpp packed row by row (32 bytes per row). Bit 7 is the leftmost pixel of a byte: the
# sandbox note "bit 0 = leftmost" showed every 8-pixel group mirrored on the device (photo 2026-11-14).
import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import nidrv as N
import s8_usb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # djk: the storage table package `ablage`
import storage as ablage  # noqa: E402

SEITE = "http://127.0.0.1:47300"
PLAETZE = [  # group button -> (channel, short name, colour)
    ("erz/2", "BASS", (255, 60, 0)), ("erz/3", "MELODY", (255, 180, 0)), ("erz/5", "I5", (120, 255, 0)),
    ("erz/6", "I6", (0, 255, 120)), ("erz/7", "I7", (0, 180, 255)), ("pad/1", "L1", (60, 60, 255)),
    ("pad/2", "L2", (180, 0, 255)), ("fx/3", "REMIX", (0, 230, 200)),
]
GRAPH_ORDNER = str(ablage.ordner("geraete"))
SCHRITT = 0.01      # value change per encoder step (knobs run 0..1)
_F = "/usr/share/fonts/truetype/dejavu/"
F_GROSS = ImageFont.truetype(_F + "DejaVuSansCondensed-Bold.ttf", 13)
F_KLEIN = ImageFont.truetype(_F + "DejaVuSansCondensed-Bold.ttf", 11)  # bold reads better on the 1-bit display


def _get(pfad):
    with urllib.request.urlopen(SEITE + pfad, timeout=0.5) as r:
        return json.loads(r.read())


def _post(pfad, body):
    req = urllib.request.Request(SEITE + pfad, data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=0.5) as r:
        return json.loads(r.read() or b"{}")


ABKUERZUNG = {  # knob-name words -> short forms for the 64-pixel columns
    "resonance": "Reso", "release": "Rel", "attack": "Atk", "decay": "Dec", "sustain": "Sus", "frequency": "Freq",
    "cutoff": "Cut", "wobble": "Wob", "depth": "Dpth", "rate": "Rate", "isolate": "Iso", "type": "Typ",
    "position": "Pos", "volume": "Vol", "build-up": "Build", "break-down": "Break", "feedback": "Fdbk",
    "envelope": "Env", "amount": "Amt", "filter": "Filt", "drive": "Drv", "level": "Lvl", "pitch": "Ptch",
    "overdub": "Ovdb", "lever": "Lev", "touch": "Tch", "hold": "Hld", "input": "In", "output": "Out", "detune": "Det",
    "spread": "Sprd", "tone": "Tone", "mix": "Mix", "time": "Time", "width": "Wdth", "shape": "Shp", "noise": "Nois",
    "harmonics": "Harm", "brightness": "Brt", "modulation": "Mod", "sub": "Sub", "glide": "Gld", "accent": "Acc",
}


def kurzform(d, text, font, breite):
    """Fit `text` into `breite` pixels: full text, else known short forms, else words without inner vowels, else cut."""
    if d.textlength(text, font=font) <= breite:
        return text
    woerter = [ABKUERZUNG.get(w.lower(), w) for w in text.replace("_", " ").split()]
    t = " ".join(woerter)
    if d.textlength(t, font=font) <= breite:
        return t
    t = " ".join(w[0] + "".join(c for c in w[1:] if c.lower() not in "aeiou") for w in woerter)
    if d.textlength(t, font=font) <= breite:
        return t
    t = t.replace(" ", "")
    while t and d.textlength(t, font=font) > breite:
        t = t[:-1]
    return t


def zwei_zeilen(d, text, font, breite):
    """Knob name on up to two lines of `breite` pixels; words are only shortened when a line still does not fit."""
    if d.textlength(text, font=font) <= breite:
        return [text]
    woerter = text.replace("_", " ").split()
    for versuch in (woerter, [ABKUERZUNG.get(w.lower(), w) for w in woerter]):
        for i in range(1, len(versuch)):
            a, b = " ".join(versuch[:i]), " ".join(versuch[i:])
            if d.textlength(a, font=font) <= breite and d.textlength(b, font=font) <= breite:
                return [a, b]
    kurz = [ABKUERZUNG.get(w.lower(), w) for w in woerter]
    mitte = max(1, len(kurz) // 2)
    return [kurzform(d, " ".join(kurz[:mitte]), font, breite), kurzform(d, " ".join(kurz[mitte:]), font, breite)][:2] \
        if len(kurz) > 1 else [kurzform(d, kurz[0], font, breite)]


def _packe(img):
    """PIL 1-bit image 256x64 -> 2048 bytes in the MK2 row-major packing."""
    a = np.asarray(img.convert("1"), dtype=bool)
    return np.packbits(a, axis=1, bitorder="big").tobytes()  # bit 7 = leftmost pixel (seen on the device 2026-11-14)


def _baender(rid, fb):
    out = []
    for band in range(8):
        pk = bytearray(265)
        pk[0], pk[3], pk[5], pk[7] = rid, band * 8, 0x20, 0x08
        pk[9:265] = fb[band * 256:(band + 1) * 256]
        out.append(bytes(pk))
    return out


class Mk2Pult:
    def __init__(self, dev, log):
        self.log = log
        iface, _, _ = N.hid_interface(dev["name"])
        self.t = N.UsbfsTransport(dev, iface if iface is not None else 2, 0x82, 0x02)
        self.usb = s8_usb.S8Usb(self.t, log)
        self.dek = N.Mk2.__new__(N.Mk2)  # reuse the measured decoders without opening a second handle
        self.dek._buttons, self.dek._pad_state, self.dek._enc_pos = bytearray(7), {}, [None] * 8
        self.dek._enc_acc, self.dek._wheel_pos = {}, None
        self.dek.quantize, self.dek.counts_per_step = True, N.Mk2.COUNTS_PER_STEP
        self.platz, self.seite = 0, 0
        self.werte = {}            # pfad -> last known value 0..1
        self.offen = {}            # pfad -> value waiting to be posted
        self.graphen, self.geladen = {}, {}
        self.vorgaben = {}         # graph name -> {knob nr: default 0..1} from the graph file ("vorgabe", else 0.5)
        self.lock = threading.Lock()
        self.neu_zeichnen = threading.Event()
        self.alt_bild = [None, None]

    # -- state from the page server -----------------------------------------------------------------------------
    def stand_holen(self):
        try:
            g = _get("/graphen")
            self.graphen = {x["name"]: x for x in g.get("graphen", [])}
            self.geladen = g.get("geladen") or {}
        except Exception:
            pass
        try:
            reg = _get("/lage").get("regler", {})
            with self.lock:
                for k, v in reg.items():
                    if "/bk/" in k and k not in self.offen:
                        self.werte[k] = v
        except Exception:
            pass
        self.neu_zeichnen.set()

    def vorgabe(self, kanal, nr):
        name = self.geladen.get(kanal)
        if not name:
            return 0.5
        if name not in self.vorgaben:
            v = {}
            try:
                with open(os.path.join(GRAPH_ORDNER, name + ".json")) as fh:
                    for k in json.load(fh).get("knoten", []):
                        if k.get("art") == "regler" and "vorgabe" in k:
                            v[int(k["nr"])] = float(k["vorgabe"])
            except (OSError, ValueError):
                pass
            self.vorgaben[name] = v
        return self.vorgaben[name].get(nr, 0.5)

    def wert(self, kanal, nr):
        """Current knob value: what the kern reported or we sent, else the graph's default (the kern only reports
        knobs that left their default)."""
        return self.werte.get(f"{kanal}/bk/{nr}", self.vorgabe(kanal, nr))

    def knopf_namen(self):
        kanal = PLAETZE[self.platz][0]
        g = self.graphen.get(self.geladen.get(kanal) or "", {})
        return g.get("name"), g.get("regler_namen") or {}

    # -- input --------------------------------------------------------------------------------------------------
    def ereignis(self, ev):
        if ev.kind == "button" and ev.value:
            if ev.name.startswith("group_"):
                self.platz, self.seite = "abcdefgh".index(ev.name[-1]), 0
                self.leds()
                self.neu_zeichnen.set()
            elif ev.name.startswith("top_"):
                self.seite = int(ev.name[-1]) - 1
                self.neu_zeichnen.set()
        elif ev.kind == "encoder":
            kanal = PLAETZE[self.platz][0]
            nr = self.seite * 8 + ev.index + 1
            pfad = f"{kanal}/bk/{nr}"
            with self.lock:
                v = min(1.0, max(0.0, self.offen.get(pfad, self.wert(kanal, nr)) + SCHRITT * ev.value))
                self.offen[pfad] = v
                self.werte[pfad] = v
            self.neu_zeichnen.set()

    def senden_schleife(self, stop):
        """Posts pending knob values at most every 30 ms per knob (latest value wins)."""
        while not stop.is_set():
            with self.lock:
                offen, self.offen = self.offen, {}
            for pfad, v in offen.items():
                try:
                    _post("/regler", {"pfad": pfad, "nach": round(v, 4), "ab": "jetzt"})
                except Exception as e:
                    self.log("MK2: knob not sent", pfad, e)
            stop.wait(0.03)

    # -- output -------------------------------------------------------------------------------------------------
    def leds(self):
        g = bytearray(57)
        g[0] = 0x81
        for i, (_, _, farbe) in enumerate(PLAETZE):
            hell = 1.0 if i == self.platz else 0.12
            c = bytes(int(x * hell) >> 1 for x in farbe)  # 7-bit values
            g[1 + 6 * i:4 + 6 * i] = c
            g[4 + 6 * i:7 + 6 * i] = c
        self.usb.senden(g)
        p = bytearray(49)
        p[0] = 0x80
        farbe = bytes(int(x * 0.15) >> 1 for x in PLAETZE[self.platz][2])
        for i in range(16):
            p[1 + 3 * i:4 + 3 * i] = farbe
        self.usb.senden(p)
        b = bytearray(32)
        b[0] = 0x82
        for i, name in enumerate(N.MK2_BUTTON_LED_ORDER):
            if name.startswith("top_"):
                b[1 + i] = 0x7F if int(name[-1]) - 1 == self.seite else 0x10
        self.usb.senden(b)

    def zeichnen(self):
        kanal, kurz, _ = PLAETZE[self.platz]
        name, namen = self.knopf_namen()
        bilder = []
        for halb in range(2):
            img = Image.new("1", (256, 64), 0)
            d = ImageDraw.Draw(img)
            if halb == 0:
                d.text((2, 0), kurzform(d, f"{kurz}  {name or '(no graph)'}", F_GROSS, 250), font=F_GROSS, fill=1)
            else:
                d.text((254, 0), f"page {self.seite + 1}", font=F_GROSS, fill=1, anchor="ra")
            for j in range(4):
                nr = self.seite * 8 + halb * 4 + j + 1
                x = j * 64
                text = namen.get(str(nr), "") if name else ""
                for z, zeile in enumerate(zwei_zeilen(d, text, F_KLEIN, 59)):
                    d.text((x + 2, 14 + 11 * z), zeile, font=F_KLEIN, fill=1)
                if text:
                    v = self.wert(kanal, nr)
                    d.rectangle([x + 2, 41, x + 60, 47], outline=1)
                    d.rectangle([x + 3, 42, x + 3 + int(56 * v), 46], fill=1)
                    d.text((x + 2, 51), f"{v * 100:.0f}%", font=F_KLEIN, fill=1)
            bilder.append(_packe(img))
        for rid, fb, i in ((0xE0, bilder[0], 0), (0xE1, bilder[1], 1)):
            if fb != self.alt_bild[i]:
                for pk in _baender(rid, fb):
                    self.usb.senden(pk)
                self.alt_bild[i] = fb

    def anzeige_schleife(self, stop):
        naechster_stand = 0.0
        while not stop.is_set():
            if time.monotonic() >= naechster_stand:
                self.stand_holen()
                naechster_stand = time.monotonic() + 1.0
            if self.neu_zeichnen.wait(0.1):
                self.neu_zeichnen.clear()
                self.zeichnen()

    def lauf(self, stop):
        ende = threading.Event()
        threading.Thread(target=self.senden_schleife, args=(ende,), daemon=True).start()
        threading.Thread(target=self.anzeige_schleife, args=(ende,), daemon=True).start()
        self.leds()
        try:
            thr = N.MK2_DESCRIPTOR["pad_threshold"]
            for r in self.usb.berichte(stop):
                if r[0] == 0x01 and len(r) >= 25:
                    for ev in self.dek._decode_buttons(r):
                        self.ereignis(ev)
                elif r[0] == 0x20 and len(r) >= 65:
                    for ev in self.dek._decode_pads(r, thr):
                        pass  # pads: not assigned yet
        finally:
            ende.set()
            self.t.close()
