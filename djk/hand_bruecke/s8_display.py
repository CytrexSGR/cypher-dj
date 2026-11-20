# s8_display.py: the two S8 screens (480x272, RGB565 big endian, vendor interface 6, bulk 0x04) show the DJ view.
# Left screen: deck A, right screen: deck B. Each: title, tempo/key/bar, a scrolling waveform (playhead in the middle, beat
# and bar lines, numbered hot cue marks), the row of hot cue pads 1..8, and at the bottom the Strudel streams (left) or the
# loop slots and Baukasten streams (right).
# Data from the page server (127.0.0.1:47300): the event stream /strom (deck position and version at 10 Hz, hot cue events),
# /lage and /pegel (a few times per second), /welle + /fassung (waveform of the loaded version), /deck/hotcues.
# The static part is drawn with Pillow a few times per second, the waveform with numpy every frame (~12 fps).
import hashlib
import json
import os
import threading
import time
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import nidrv
import s8_loopdeck
from seq_view import seq_sicht

W, H = 480, 272
SEITE = os.environ.get("CYPHERDJ_SEITE", "http://127.0.0.1:47300")
SR = 48000
_F = "/usr/share/fonts/truetype/dejavu/"
FONT = {n: ImageFont.truetype(_F + f, s) for n, f, s in (
    ("titel", "DejaVuSansCondensed-Bold.ttf", 22), ("gross", "DejaVuSansCondensed-Bold.ttf", 34),
    ("mittel", "DejaVuSansCondensed-Bold.ttf", 18), ("klein", "DejaVuSansCondensed.ttf", 15),
    ("cue", "DejaVuSansCondensed-Bold.ttf", 16), ("mono", "DejaVuSansMono.ttf", 13))}
HG, TEXT, GRAU, LINIE = (12, 14, 18), (230, 232, 236), (130, 136, 148), (40, 44, 54)
AKZENT = {1: (0, 190, 220), 2: (240, 150, 30)}  # deck A cyan, deck B orange
GRUEN, ROT, GELB = (60, 200, 110), (230, 70, 60), (235, 200, 60)
CUE_FARBE = (255, 140, 40)
STROM_NAME = {1: "DRUMS", 2: "BASS", 3: "MELODY", 5: "I5", 6: "I6", 7: "I7", 9: "L1", 10: "L2"}
STROM_KANAL = {1: "erz/1", 2: "erz/2", 3: "erz/3", 5: "erz/5", 6: "erz/6", 7: "erz/7", 9: "pad/1", 10: "pad/2"}
WELLE_Y, WELLE_H = 66, 76          # waveform band around the playhead
UEBER_Y, UEBER_H = 146, 28         # whole-track overview (the touch strip maps onto it)
CUES_Y = 178                       # hot cue row
UNTEN_Y = 210                      # streams row
FENSTER_BEATS = 32                 # 8 bars across the screen


def leer_bild():
    img = np.zeros((H, W, 3), dtype=np.uint8)
    img[:] = HG
    return img


def holen(pfad, timeout=0.5, roh=False):
    req = urllib.request.Request(SEITE + pfad, headers={"x-djk-quelle": "andreas"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
    return b if roh else json.loads(b)


def rle_rahmen(display, a):
    """Full-screen frame in NI's ni_color_rle: runs of equal pixel pairs as 0x01 (count, 4 bytes), everything else as raw
    0x00 (count, data). Counts are pixel pairs (2 pixels = 4 bytes). The flat backgrounds shrink a 261 KB frame to a few KB."""
    roh = zu_rgb565(a)
    paare = np.frombuffer(roh, dtype=">u4")
    n = len(paare)
    grenze = np.flatnonzero(paare[1:] != paare[:-1]) + 1
    starts = np.concatenate(([0], grenze))
    laengen = np.diff(np.concatenate((starts, [n])))
    out = bytearray([0x84, 0x00, display & 0xFF, 0x60, 0, 0, 0, 0, 0, 0, 0, 0])
    out += W.to_bytes(2, "big") + H.to_bytes(2, "big")
    roh_von = None
    for st, ln in zip(starts.tolist(), laengen.tolist()):
        if ln >= 3:
            if roh_von is not None:
                k = st - roh_von
                out += bytes([0x00, k >> 16 & 0xFF, k >> 8 & 0xFF, k & 0xFF]) + roh[roh_von * 4:st * 4]
                roh_von = None
            out += bytes([0x01, ln >> 16 & 0xFF, ln >> 8 & 0xFF, ln & 0xFF]) + roh[st * 4:st * 4 + 4]
        elif roh_von is None:
            roh_von = st
    if roh_von is not None:
        k = n - roh_von
        out += bytes([0x00, k >> 16 & 0xFF, k >> 8 & 0xFF, k & 0xFF]) + roh[roh_von * 4:]
    out += bytes([0x03, 0, 0, 0, 0x40, 0, display & 0xFF, 0])
    return bytes(out), roh


def zu_rgb565(a):
    a = a.astype(np.uint16)
    v = ((a[:, :, 0] >> 3) << 11) | ((a[:, :, 1] >> 2) << 5) | (a[:, :, 2] >> 3)
    return v.astype(">u2").tobytes()


def _kuerzen(d, text, font, breite):
    if d.textlength(text, font=font) <= breite:
        return text
    while text and d.textlength(text + "…", font=font) > breite:
        text = text[:-1]
    return text + "…"


class Welle:
    """Waveform of one track version (DJKW v1: hop, columns of peak/low/mid/high) and its beat grid."""

    def __init__(self, material, bpm, fassung):
        q = f"material={material}&bpm={bpm}&fassung={fassung}"
        b = holen("/welle?" + q, timeout=3, roh=True)
        if b[:4] != b"DJKW":
            raise ValueError("no DJKW waveform")
        self.hop = int.from_bytes(b[8:12], "little")
        n = int.from_bytes(b[12:16], "little")
        self.d = np.frombuffer(b, dtype=np.uint8, count=n * 4, offset=16).reshape(n, 4)
        p98 = np.maximum(np.percentile(self.d[:, 1:], 98, axis=0), 1)
        self.gain = np.concatenate([[1.0], 255.0 / p98])
        f = holen("/fassung?" + q, timeout=2)
        self.s0 = float(f["erster_schlag_frame"])
        self.eins = int(f.get("erste_eins_quell_beat", 0))
        self.fpb = SR * 60.0 / float(bpm)
        self.beats_gesamt = (float(f.get("frames") or 0) - self.s0) / self.fpb  # track length in quell beats
        self.frames = float(f.get("frames") or len(self.d) * self.hop)
        # overview: the whole track squeezed into W columns (peak and band colours per column), computed once
        grenzen = np.linspace(0, len(self.d), W + 1).astype(np.int64)
        starts = np.minimum(grenzen[:-1], len(self.d) - 1)
        spitze = np.maximum.reduceat(self.d[:, 0], starts) / 255.0
        summe = np.add.reduceat(self.d[:, 1:].astype(np.float64), starts, axis=0)
        anzahl = np.maximum(np.diff(grenzen), 1)[:, None]
        t, m, h = ((summe / anzahl) * self.gain[1:]).clip(0, 255).T
        self.ueber_hoehe = (spitze * (UEBER_H // 2 - 1)).astype(np.int64)
        self.ueber_farbe = np.stack([np.minimum(255, 0.35 * t + 0.9 * m), np.minimum(255, 0.55 * m + 0.9 * h),
                                     np.minimum(255, 0.95 * t + 0.4 * h)], axis=1)

    def frame(self, quell_beat):
        return self.s0 + quell_beat * self.fpb

    def band(self, kopf_beat, cues, akzent):
        """RGB array WELLE_H x W: waveform around the playhead, beat/bar lines, hot cue marks."""
        img = np.zeros((WELLE_H, W, 3), dtype=np.uint8)
        img[:] = (8, 9, 12)
        fenster = FENSTER_BEATS * self.fpb
        fpp = fenster / W
        links = self.frame(kopf_beat) - fenster / 2
        f0 = links + np.arange(W) * fpp
        c0 = np.floor(f0 / self.hop).astype(np.int64)
        c1 = np.maximum(c0 + 1, np.floor((f0 + fpp) / self.hop).astype(np.int64))
        gueltig = (c0 >= 0) & (c0 < len(self.d))
        c0c, c1c = np.clip(c0, 0, len(self.d) - 1), np.clip(c1, 1, len(self.d))
        mitte = WELLE_H // 2
        for x in np.nonzero(gueltig)[0]:
            blk = self.d[c0c[x]:c1c[x]]
            if not len(blk):
                continue
            p = blk[:, 0].max() / 255.0
            t, m, h = (blk[:, 1:].mean(axis=0) * self.gain[1:]).clip(0, 255)
            farbe = (min(255, 0.35 * t + 0.9 * m), min(255, 0.55 * m + 0.9 * h), min(255, 0.95 * t + 0.4 * h))
            hh = int(p * (mitte - 2))
            if hh:
                img[mitte - hh:mitte + hh, x] = farbe
        # beat lines, bars brighter
        k0 = int(np.ceil((links - self.s0) / self.fpb))
        k1 = int(np.floor((links + fenster - self.s0) / self.fpb))
        for k in range(k0, k1 + 1):
            x = int(round((self.s0 + k * self.fpb - links) / fpp))
            if 0 <= x < W:
                takt = (k - self.eins) % 4 == 0
                img[:, x] = np.maximum(img[:, x], (70, 74, 84) if takt else (30, 32, 38))
        # hot cue marks
        for nr, q in cues.items():
            x = int(round((self.frame(q) - links) / fpp))
            if 0 <= x < W - 1:
                img[:, x:x + 2] = CUE_FARBE
                img[0:11, x:min(W, x + 11)] = CUE_FARBE
                _ziffer(img, x + 2, 1, int(nr))
        # playhead
        img[:, W // 2 - 1:W // 2 + 1] = (255, 255, 255)
        img[[0, -1], :] = akzent
        return img


def uebersicht(w, kopf_beat, cues, loop, akzent):
    """Whole-track overview band: dim waveform, played part brighter, playhead line, hot cue ticks, loop region."""
    img = np.zeros((UEBER_H, W, 3), dtype=np.uint8)
    img[:] = (8, 9, 12)
    mitte = UEBER_H // 2
    pos = int(min(W - 1, max(0, w.frame(kopf_beat) / w.frames * W))) if w.frames else 0
    for x in range(W):
        hh = w.ueber_hoehe[x]
        if hh:
            f = w.ueber_farbe[x] * (1.0 if x < pos else 0.45)
            img[mitte - hh:mitte + hh + 1, x] = f
    if loop:
        a = int(w.frame(loop.get("start", 0)) / w.frames * W)
        b = max(a + 2, int(w.frame(loop.get("start", 0) + loop.get("laenge", 0)) / w.frames * W))
        img[:, max(0, a):min(W, b)] = np.maximum(img[:, max(0, a):min(W, b)], (30, 110, 60))
    for nr, q in cues.items():
        x = int(w.frame(q) / w.frames * W)
        if 0 <= x < W:
            img[0:7, max(0, x - 1):x + 2] = CUE_FARBE
    img[:, max(0, pos - 1):pos + 1] = (255, 255, 255)
    img[[0, -1], :] = (40, 44, 54)
    return img


_ZIFFERN = {}


def _ziffer(img, x, y, n):
    if n not in _ZIFFERN:
        m = Image.new("L", (8, 10), 0)
        ImageDraw.Draw(m).text((0, -2), str(n), font=ImageFont.truetype(_F + "DejaVuSansMono-Bold.ttf", 11), fill=255)
        _ZIFFERN[n] = np.asarray(m) > 100
    mask = _ZIFFERN[n]
    h, w = mask.shape
    w = min(w, img.shape[1] - x)
    if w > 0:
        img[y:y + h, x:x + w][mask[:, :w]] = (0, 0, 0)


class Stand:
    """Latest deck state from the page server's event stream, plus hot cues and the waveform cache."""

    def __init__(self, log):
        self.log = log
        self.deck = {}            # deck -> (fields of /zustand/deck, monotonic time received)
        self.cues = {1: {}, 2: {}}
        self.cues_alt = {1: 0.0, 2: 0.0}
        self.arr = None           # (fields of /zustand/arr, time): projekt_beat of the live container drives the SEQ playhead
        self.seq, self.seq_alt = {}, 0.0
        self.wellen = {}          # (material, bpm, fassung) -> Welle or None while loading/failed
        self.lock = threading.Lock()
        threading.Thread(target=self._strom, daemon=True).start()

    def _strom(self):
        while True:
            try:
                req = urllib.request.Request(SEITE + "/strom", headers={"x-djk-quelle": "andreas"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    for zeile in r:
                        if not zeile.startswith(b"data:"):
                            continue
                        try:
                            ev = json.loads(zeile[5:])
                        except ValueError:
                            continue
                        a = ev.get("a")
                        if a == "/zustand/deck":
                            f = ev.get("f") or {}
                            with self.lock:
                                self.deck[f.get("deck")] = (f, time.monotonic())
                        elif a == "/zustand/arr":
                            with self.lock:
                                self.arr = (ev.get("f") or {}, time.monotonic())
                        elif a == "seq":
                            self.seq_alt = 0.0
                        elif a == "/e/hotcue":
                            self.cues_alt = {1: 0.0, 2: 0.0}  # refetch soon
            except Exception:
                time.sleep(2)

    def kopf(self, nr):
        """(fields, playhead quell_beat now) or (None, None)."""
        with self.lock:
            e = self.deck.get(nr)
        if not e:
            return None, None
        f, t = e
        q = float(f.get("quell_beat") or 0.0)
        if int(f.get("status") or 0) >= 2:  # running: extrapolate between the 10 Hz messages
            q += (time.monotonic() - t) * float(f.get("basis_bpm") or 0) * float(f.get("faktor") or 1) / 60.0
        return f, q

    def welle(self, f):
        k = (f.get("material_id"), f.get("basis_bpm"), f.get("fassung"))
        if not k[0]:
            return None
        if k not in self.wellen:
            self.wellen[k] = None
            def laden():
                try:
                    self.wellen[k] = Welle(*k)
                except Exception as e:
                    self.log("S8 screens: waveform", k, e)
            threading.Thread(target=laden, daemon=True).start()
        return self.wellen.get(k)

    def seq_platz(self, nr):
        if time.monotonic() - self.seq_alt > 1.0:
            self.seq_alt = time.monotonic()
            try:
                self.seq = holen("/seq/stand?zellen=1") or {}
            except Exception:
                pass
        return self.seq.get(str(nr))

    def projekt_beat(self, bpm):
        """Current project beat extrapolated between the 10 Hz messages, None when the container stands."""
        with self.lock:
            e = self.arr
        if not e or int(e[0].get("status") or 0) < 2:
            return None
        return float(e[0].get("projekt_beat") or 0) + (time.monotonic() - e[1]) * (bpm or 0) / 60.0

    def hotcues(self, nr):
        if time.monotonic() - self.cues_alt.get(nr, 0.0) > 1.0:
            self.cues_alt[nr] = time.monotonic()
            try:
                self.cues[nr] = {int(k): float(v["quell_beat"]) for k, v in (holen(f"/deck/hotcues?deck={nr}") or {}).items()}
            except Exception:
                pass
        return self.cues.get(nr, {})


def kopf_bild(lage, pegel, stand, nr, stroeme, loop_groesse=4):
    """Static part of the deck view (Pillow), redrawn a few times per second."""
    img = Image.new("RGB", (W, H), HG)
    d = ImageDraw.Draw(img)
    ak = AKZENT[nr]
    deck = next((x for x in lage.get("decks", []) if x.get("deck") == nr), {})
    uhr = lage.get("uhr", {})
    d.rectangle([0, 0, 30, 30], fill=ak)
    d.text((15, 15), "AB"[nr - 1], font=FONT["mittel"], fill=HG, anchor="mm")
    d.text((38, 4), _kuerzen(d, deck.get("titel") or "(empty)", FONT["mittel"], W - 70), font=FONT["mittel"], fill=TEXT)
    lvl = (pegel.get(f"deck/{nr}") or {}).get("max_db")
    if lvl is not None and lvl > -90:
        d.ellipse([W - 22, 8, W - 10, 20], fill=GRUEN)
    bpm = (deck.get("basis_bpm") or 0) * (deck.get("faktor") or 1)
    d.text((8, 32), f"{bpm:.1f}" if bpm else "--.-", font=FONT["titel"], fill=TEXT)
    d.text((100, 34), deck.get("camelot") or "--", font=FONT["klein"], fill=ak)
    d.text((140, 34), f"bar {deck.get('takt_im_track', '-')}", font=FONT["klein"], fill=GRAU)
    loop = deck.get("loop")
    if loop:  # running loop: green with its length; otherwise the size the loop encoder has chosen
        d.rounded_rectangle([222, 33, 300, 57], radius=5, fill=GRUEN)
        d.text((261, 45), f"LOOP {loop.get('laenge', 0):g}", font=FONT["klein"], fill=HG, anchor="mm")
    else:
        d.rounded_rectangle([222, 33, 300, 57], radius=5, outline=LINIE)
        d.text((261, 45), f"loop {loop_groesse:g}", font=FONT["klein"], fill=GRAU, anchor="mm")
    reg = lage.get("regler", {})
    fader = reg.get(f"deck/{nr}/fader")
    d.text((308, 38), f"vol {fader:.0f}" if fader is not None else "", font=FONT["mono"], fill=GRAU)
    d.text((W - 8, 32), f"{uhr.get('bpm', 0):.1f}  {uhr.get('takt', 0)}.{uhr.get('schlag', 0)}", font=FONT["klein"],
           fill=GRAU, anchor="ra")
    # hot cue pads 1..8, filled when set (same order as the pads: 1-4 top row, 5-8 bottom row on the S8)
    cues = stand.hotcues(nr) if deck.get("material_id") else {}
    for i in range(8):
        x = 4 + i * 59
        an = (i + 1) in cues
        d.rounded_rectangle([x, CUES_Y, x + 54, CUES_Y + 24], radius=4, fill=CUE_FARBE if an else None,
                            outline=CUE_FARBE if an else LINIE)
        d.text((x + 27, CUES_Y + 12), str(i + 1), font=FONT["cue"], fill=HG if an else GRAU, anchor="mm")
    # bottom row: streams
    d.line([0, UNTEN_Y - 4, W, UNTEN_Y - 4], fill=LINIE)
    st = {s["strom"]: s for s in lage.get("studio", {}).get("stroeme", [])}
    breite = W // len(stroeme)
    for i, s in enumerate(stroeme):
        x = i * breite + 8
        kanal = STROM_KANAL[s]
        lv = (pegel.get(kanal) or {}).get("max_db")
        d.text((x, UNTEN_Y), STROM_NAME[s], font=FONT["mittel"], fill=GRUEN if lv is not None and lv > -90 else GRAU)
        txt = (st.get(s) or {}).get("text_kurz") or "-"
        d.text((x, UNTEN_Y + 22), _kuerzen(d, txt, FONT["mono"], breite - 14), font=FONT["mono"], fill=GRAU)
    return np.asarray(img).copy(), cues


def studio_bild(lage, pegel, nr, stroeme):
    """Second view (top-left screen button): the streams of this side in detail: level, fader, sound, pattern."""
    img = Image.new("RGB", (W, H), HG)
    d = ImageDraw.Draw(img)
    ak = AKZENT[nr]
    d.rectangle([0, 0, 34, 34], fill=ak)
    d.text((17, 17), "AB"[nr - 1], font=FONT["titel"], fill=HG, anchor="mm")
    d.text((44, 6), "STUDIO  " + ("Strudel" if nr == 1 else "loops + Baukasten"), font=FONT["titel"], fill=TEXT)
    st = {s["strom"]: s for s in lage.get("studio", {}).get("stroeme", [])}
    reg = lage.get("regler", {})
    klang = lage.get("studio", {}).get("klang") or {}
    hoch = (H - 40) // len(stroeme)
    for i, s in enumerate(stroeme):
        y = 40 + i * hoch
        kanal = STROM_KANAL[s]
        lv = (pegel.get(kanal) or {}).get("max_db")
        an = lv is not None and lv > -90
        d.line([0, y, W, y], fill=LINIE)
        d.text((8, y + 4), STROM_NAME[s], font=FONT["mittel"], fill=GRUEN if an else GRAU)
        # level bar
        anteil = 0.0 if lv is None else max(0.0, min(1.0, (lv + 60) / 60))
        d.rectangle([110, y + 8, 230, y + 18], outline=LINIE)
        if anteil:
            d.rectangle([111, y + 9, 111 + int(118 * anteil), y + 17], fill=GRUEN if (lv or -200) < -3 else ROT)
        f = reg.get(f"{kanal}/fader")
        d.text((240, y + 6), f"{f:.0f} dB" if f is not None else "-- dB", font=FONT["mono"], fill=GRAU)
        name = {2: klang.get("bass"), 3: klang.get("melodie")}.get(s) or ""
        if name:
            d.text((W - 8, y + 6), _kuerzen(d, name, FONT["mono"], 160), font=FONT["mono"], fill=ak, anchor="ra")
        txt = (st.get(s) or {}).get("text_kurz") or "-"
        d.text((8, y + 26), _kuerzen(d, txt, FONT["mono"], W - 16), font=FONT["mono"], fill=TEXT if an else GRAU)
    return np.asarray(img).copy()


def seq_bild(stand, nr, bpm):
    """Third view: the SEQ deck place of this side (place 1 left, 2 right): the first audible pattern, rows x 16 cells, playhead per row."""
    img = Image.new("RGB", (W, H), HG)
    d = ImageDraw.Draw(img)
    ak = AKZENT[nr]
    d.rectangle([0, 0, 34, 34], fill=ak)
    d.text((17, 17), "AB"[nr - 1], font=FONT["titel"], fill=HG, anchor="mm")
    sicht = seq_sicht(stand.seq_platz(nr), stand.projekt_beat(bpm))
    if sicht["leer"]:
        d.text((44, 6), f"SEQ {nr}  (empty place)", font=FONT["titel"], fill=GRAU)
        return np.asarray(img).copy()
    zeilen = sicht["zeilen"]
    d.text((44, 6), f"SEQ {nr}  " + _kuerzen(d, sicht["kopf"], FONT["titel"], W - 100), font=FONT["titel"], fill=TEXT)
    x0, bx = 92, (W - 96) / 16
    zh = (H - 44) / max(1, len(zeilen))
    gedimmt = tuple(int(HG[i] + (ak[i] - HG[i]) * 0.45) for i in range(3))
    hell = tuple(min(255, int(c * 0.6 + 255 * 0.4)) for c in ak)
    for i, z in enumerate(zeilen):
        y = 42 + i * zh
        d.text((6, y + zh / 2), _kuerzen(d, z["name"], FONT["mono"], 82), font=FONT["mono"], fill=TEXT, anchor="lm")
        for k, c in enumerate(z["zellen"]):
            if c == " ":
                continue
            x = x0 + k * bx
            an = c in "oxX"
            farbe = {"o": gedimmt, "x": ak, "X": hell}.get(c) or ((34, 37, 45) if k % 4 else (48, 52, 62))
            if k == z["kopf_index"]:
                farbe = (255, 255, 255) if an else (90, 94, 104)
            d.rectangle([x + 1, y + 2, x + bx - 2, y + zh - 3], fill=farbe)
    return np.asarray(img).copy()


def loops_bild(stand, nr, jetzt_beat, paar=0, slice_fokus=None, offen=None, schicht="filter"):
    """Fourth view: the loop deck of this side. `stand` is `decks[nr]` of GET /loopdeck/stand (None or empty: no loop deck),
    `jetzt_beat` the core beat now (None: unknown, bars stand at 0), `paar` the visible row pair 0..3. Four columns: the
    playing cell, a progress bar and the two visible rows as coloured boxes; footer with rows and grid. No waveform.
    `slice_fokus` (1..4, slice mode): that column is outlined and its bar is split into the 8 slices, the one under the
    play position filled. `offen` ({track: [field, ...]} from s8_loopdeck.nicht_abgeholt): a yellow marker `!V` (fader) and
    `!F` (knob) in the track's header while that control has not picked up the model value (soft takeover). `schicht` is the
    knob layer of the side (named in the footer); a killed band of a shown EQ layer puts a red `K` after the track number."""
    img = Image.new("RGB", (W, H), HG)
    d = ImageDraw.Draw(img)
    ak = AKZENT.get(nr, AKZENT[1])
    d.rectangle([0, 0, 34, 34], fill=ak)
    d.text((17, 17), "AB"[(nr - 1) % 2], font=FONT["titel"], fill=HG, anchor="mm")
    if not stand:
        d.text((44, 6), f"LOOPS {nr}  (no loop deck)", font=FONT["titel"], fill=GRAU)
        d.text((W // 2, H // 2), "-", font=FONT["gross"], fill=LINIE, anchor="mm")
        return np.asarray(img).copy()
    d.text((44, 6), f"LOOPS {nr}", font=FONT["titel"], fill=TEXT)
    spalten = s8_loopdeck.spalten(stand, paar, jetzt_beat)
    killed = s8_loopdeck.kill_spuren(stand, schicht)
    br = W // 4
    for i, c in enumerate(spalten):
        x = i * br
        if i:
            d.line([x, 40, x, H - 28], fill=LINIE)
        spur = (stand.get("spuren") or [{}] * 4)[i] if len(stand.get("spuren") or []) > i else {}
        kopf = f"T{i + 1}"
        if i + 1 in killed:
            d.text((x + 6 + d.textlength(kopf, font=FONT["klein"]) + 4, 42), "K", font=FONT["klein"], fill=ROT)
            kopf += "  "
        d.text((x + 6, 42), kopf + ("  MUTE" if spur.get("mute") else ""), font=FONT["klein"],
               fill=ROT if spur.get("mute") else GRAU)
        fe = (offen or {}).get(i + 1, ())
        marke = " ".join(m for m, hit in (("!V", "fader_db" in fe), ("!F", any(f != "fader_db" for f in fe))) if hit)
        if marke:
            d.text((x + br - 6, 44), marke, font=FONT["mono"], fill=GELB, anchor="ra")
        spielt = c["name"] != "-"
        farbe = s8_loopdeck.PALETTE[c["farbe"]] if spielt else GRAU
        d.text((x + 6, 62), _kuerzen(d, c["name"], FONT["mittel"], br - 12), font=FONT["mittel"], fill=TEXT if spielt else GRAU)
        if slice_fokus == i + 1:
            d.rectangle([x + 1, 38, x + br - 2, H - 30], outline=AKZENT.get(nr, AKZENT[1]), width=2)
            sb = (br - 12) / 8.0
            hell = min(int(c["p"] * 8), 7) if c["name"] != "-" else None
            for k in range(8):
                sx = x + 6 + int(k * sb)
                d.rectangle([sx, 88, sx + int(sb) - 2, 100], outline=LINIE, fill=farbe if k == hell else None)
        else:
            d.rectangle([x + 6, 90, x + br - 7, 98], outline=LINIE)
            if c["p"] > 0:
                d.rectangle([x + 7, 91, x + 7 + int((br - 15) * c["p"]), 97], fill=farbe)
        for k, z in enumerate(c["zeilen"]):
            y = 112 + k * 70
            zf = s8_loopdeck.PALETTE[z["farbe"]]
            box = [x + 6, y, x + br - 7, y + 62]
            if z["zustand"] == "leer":
                d.rectangle(box, outline=LINIE)
                continue
            fuell = {"gefuellt": s8_loopdeck.DIMM, "spielt": 1.0, "wartend": 0.6}[z["zustand"]]
            d.rectangle(box, fill=tuple(int(v * fuell) for v in zf), outline=(255, 255, 255) if z["zustand"] == "wartend" else None)
            hell = z["zustand"] != "gefuellt"
            d.text((x + 10, y + 4), str(z["zelle"]), font=FONT["mono"], fill=HG if hell else GRAU)
            d.text((x + 10, y + 24), _kuerzen(d, z["name"], FONT["klein"], br - 20), font=FONT["klein"], fill=HG if hell else TEXT)
    d.text((W - 8, H - 4), s8_loopdeck.fuss_text(paar, stand.get("raster"), schicht), font=FONT["klein"], fill=GRAU, anchor="rb")
    if slice_fokus:
        d.text((8, H - 4), f"SLICE  T{slice_fokus}", font=FONT["klein"], fill=TEXT, anchor="lb")
    return np.asarray(img).copy()


class Anzeige:
    """Owns the vendor interface 6 of the S8 and refreshes both screens."""

    def __init__(self, dev, log):
        self.log = log
        num = None
        for i in sorted(os.listdir("/sys/bus/usb/devices")):
            if not i.startswith(dev["name"] + ":"):
                continue
            p = "/sys/bus/usb/devices/" + i
            try:
                if int(open(p + "/bInterfaceClass").read(), 16) == 0xFF:
                    num = int(open(p + "/bInterfaceNumber").read(), 16)
            except (OSError, ValueError):
                continue
        if num is None:
            raise RuntimeError("S8 vendor interface not found")
        self.t = nidrv.UsbfsTransport(dev, num, ep_in=0x84, ep_out=0x04)
        self.stand = Stand(log)
        self.alt = [None, None]
        self.haenger = 0

    def schleife(self, stop, stand=None, fps=10.0, kopf_alle_s=0.25):
        kopf = [None, None]
        cues = [{}, {}]
        naechster_kopf = 0.0
        while not stop.is_set():
            t0 = time.monotonic()
            if t0 >= naechster_kopf:
                naechster_kopf = t0 + kopf_alle_s
                try:
                    lage = holen("/lage")
                    pegel = holen("/pegel?sek=1").get("kanaele", {})
                    if stand is not None:
                        stand.update(lage=lage, pegel=pegel, zeit=time.monotonic(), cues={1: cues[0], 2: cues[1]})
                    ansicht = (stand or {}).get("ansicht") or {}
                    groesse = (stand or {}).get("loop_groesse") or {}
                    for i, nr, unten in ((0, 1, (1, 2, 3)), (1, 2, (9, 10, 5, 6, 7))):
                        if ansicht.get(nr) == "loops":  # drawn every frame below (the progress bars move)
                            kopf[i] = kopf[i] if kopf[i] is not None else leer_bild()
                            cues[i] = {}
                        elif ansicht.get(nr) == "seq":
                            kopf[i] = seq_bild(self.stand, nr, float(lage.get("uhr", {}).get("bpm") or 0))
                            cues[i] = self.stand.hotcues(nr)
                        elif ansicht.get(nr) == "studio":
                            kopf[i] = studio_bild(lage, pegel, nr, unten)
                            cues[i] = self.stand.hotcues(nr)
                        else:
                            kopf[i], cues[i] = kopf_bild(lage, pegel, self.stand, nr, unten, groesse.get(nr, 4))
                except Exception:
                    leer = np.zeros((H, W, 3), dtype=np.uint8)
                    leer[:] = HG
                    kopf = [leer, leer]
            for disp in (0, 1):
                bild = kopf[disp].copy()
                f, q = self.stand.kopf(disp + 1)
                w = self.stand.welle(f) if f else None
                if w is not None and stand is not None:  # track length for the touch strip's needle search
                    stand.setdefault("laenge", {})[disp + 1] = w.beats_gesamt
                if w is not None and ((stand or {}).get("ansicht") or {}).get(disp + 1, "deck") == "deck":
                    bild[WELLE_Y:WELLE_Y + WELLE_H] = w.band(q, cues[disp], AKZENT[disp + 1])
                    bild[UEBER_Y:UEBER_Y + UEBER_H] = uebersicht(w, q, cues[disp], self.loop_von(stand, disp + 1),
                                                                     AKZENT[disp + 1])
                if ((stand or {}).get("ansicht") or {}).get(disp + 1) == "loops":
                    seite = (stand or {}).get("loopdeck")
                    sicht = ((stand or {}).get("loops_sicht") or {}).get(disp + 1)
                    bild = loops_bild(seite.deck(disp + 1) if seite else None, disp + 1, seite.beat_jetzt() if seite else None,
                                      sicht.paar if sicht else 0, sicht.fokus if sicht and sicht.slice else None,
                                      s8_loopdeck.nicht_abgeholt((stand or {}).get("abholung") or {}, disp + 1),
                                      sicht.schicht if sicht else "filter")
                h = hashlib.blake2b(bild.tobytes(), digest_size=8).digest()
                if h == self.alt[disp]:
                    continue
                rahmen, _ = rle_rahmen(disp, bild)
                try:
                    self.t.bulk_out(rahmen, endpoint=0x04, timeout_ms=1000)
                    self.alt[disp] = h
                    self.haenger = 0
                except OSError as e:  # the display did not take the frame: keep the handle and pause (closing it shows
                    self.haenger += 1  # the S8's factory screen, which flickered); no CLEAR_FEATURE, the sandbox saw
                    if self.haenger in (1, 10) or self.haenger % 100 == 0:  # such requests silence a device
                        self.log("S8 screens: frame not taken (%s), %d in a row" % (e, self.haenger))
                    self.alt = [None, None]  # resend both screens in full afterwards
                    stop.wait(0.3)
                    if self.haenger >= 300:
                        raise
            stop.wait(max(0.0, 1.0 / fps - (time.monotonic() - t0)))

    @staticmethod
    def loop_von(stand, nr):
        decks = ((stand or {}).get("lage") or {}).get("decks", [])
        return next((x.get("loop") for x in decks if x.get("deck") == nr), None)

    def close(self):
        self.t.close()
