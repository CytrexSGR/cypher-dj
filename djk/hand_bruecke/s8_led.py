# s8_led.py: S8 LED reports. This module holds the probe that lights one report byte at a time (to find the button LEDs
# by eye); the device is only opened inside probe_lauf, never at import.
import json
import threading
import time

# OUT report id -> total length in bytes (byte 0 is the report id)
LED_BERICHT_LAENGE = {0x80: 119, 0x81: 119, 0x82: 74}


def einzel_bericht(bericht, offset, wert):
    """One OUT report with exactly one byte set: byte 0 = report id, byte `offset` = `wert`, all others 0."""
    if bericht not in LED_BERICHT_LAENGE:
        raise ValueError(f"unknown LED report {bericht!r}")
    laenge = LED_BERICHT_LAENGE[bericht]
    if not 1 <= offset < laenge:
        raise ValueError(f"offset {offset} outside 1..{laenge - 1} for report 0x{bericht:02x}")
    if not 0 <= wert <= 255:
        raise ValueError(f"value {wert} outside 0..255")
    b = bytearray(laenge)
    b[0] = bericht
    b[offset] = wert
    return bytes(b)


def probe_offsets(spec):
    """'58,59,60,65-68' -> sorted unique offsets."""
    teile = [t.strip() for t in str(spec).split(",") if t.strip()]
    if not teile:
        raise ValueError("no offsets given")
    aus = set()
    for t in teile:
        try:
            if "-" in t:
                von, bis = (int(x) for x in t.split("-", 1))
                if bis < von:
                    raise ValueError(f"reversed range {t!r}")
                aus.update(range(von, bis + 1))
            else:
                aus.add(int(t))
        except ValueError as e:
            if "reversed" in str(e):
                raise
            raise ValueError(f"bad offset text {t!r}") from None
    return sorted(aus)


# -- deck state on the LEDs --------------------------------------------------------------------------------------------

FARBE = {0x80: (0, 190, 220), 0x81: (240, 150, 30)}  # left = deck A, right = deck B (as on the screens)
SEITE = {0x80: "links", 0x81: "rechts"}


def lade_karte(pfad):
    """Read s8_leds.json: byte offsets of the deck button LEDs per side and the two brightness values."""
    with open(pfad, encoding="utf-8") as f:
        k = json.load(f)
    if not isinstance(k, dict) or k.get("version") != 1:
        raise ValueError(f"{pfad}: unsupported version")
    for key in ("hell", "gedimmt", "links", "rechts"):
        if key not in k:
            raise ValueError(f"{pfad}: missing key {key!r}")
    for seite in ("links", "rechts"):
        if not isinstance(k[seite], dict) or "play" not in k[seite] or "loop" not in k[seite]:
            raise ValueError(f"{pfad}: side {seite!r} needs play and loop")
    return k


def tasten_zustand(deck, karte):
    """Brightness of PLAY and LOOP for one entry of /lage decks[] (None = unknown: both dim). CUE stays unlit."""
    hell, gedimmt = karte["hell"], karte["gedimmt"]
    if not deck:
        return {"play": gedimmt, "loop": gedimmt}
    try:
        laeuft = int(deck.get("status") or 0) >= 2
    except (TypeError, ValueError):
        laeuft = False
    return {"play": hell if laeuft else gedimmt, "loop": hell if deck.get("loop") else gedimmt}


def rahmen_fuer_seite(bericht, deck, gesetzt, lage, karte, pad_farben=None, freeze=False):
    """One full 119-byte LED report of a deck section: pads 1..8 (bytes 1..24) and, with a card, the button bytes.
    `pad_farben` (8 RGB triples, from s8_loopdeck.led_farben in the loops view) replaces the hot cue pad colours.

    `freeze` lights the FREEZE LED (slice mode) when the card names its offsets under "freeze"; without that key nothing is lit.

    A report carries every LED of the section, so pads and buttons always go out together."""
    frame = bytearray(LED_BERICHT_LAENGE[bericht])
    frame[0] = bericht
    for p in range(8):
        if pad_farben is not None:
            frame[1 + 3 * p:4 + 3 * p] = bytes(min(255, max(0, int(c))) for c in pad_farben[p])
            continue
        hell = 1.0 if (p + 1) in gesetzt else 0.06
        frame[1 + 3 * p:4 + 3 * p] = bytes(int(c * hell) for c in FARBE[bericht])
    if karte is not None:
        decks = (lage or {}).get("decks") or []
        eintrag = next((d for d in decks if isinstance(d, dict) and d.get("deck") == deck), None)
        z = tasten_zustand(eintrag, karte)
        seite = karte[SEITE[bericht]]
        frame[seite["play"]] = z["play"]
        for o in seite["loop"]:
            frame[o] = z["loop"]
        for o in seite.get("freeze", []):
            frame[o] = karte["hell"] if freeze else karte["gedimmt"]
    return bytes(frame)


def probe_lauf(log, bericht, offsets, wert, sekunden):
    """Claim the S8 as the bridge does, send the `f3 01` handshake and light each offset for `sekunden`, then zero it.

    Returns 0, or 2 when the interface cannot be claimed. Arguments are validated before any device is touched."""
    for o in offsets:
        einzel_bericht(bericht, o, wert)
    import nidrv
    import s8_usb
    dev = nidrv.find_ni(0x1370)
    if not dev:
        log("S8: not found")
        return 2
    try:
        t = nidrv.UsbfsTransport(dev, 5, ep_in=0x84, ep_out=0x03, in_size=256)
    except (OSError, RuntimeError) as e:
        log("S8: cannot claim interface 5:", e)
        return 2
    stop = threading.Event()
    try:
        usb = s8_usb.S8Usb(t, log)
        usb.senden(bytes([0xF3, 0x01]))

        def lesen():  # the report loop also flushes the OUT queue
            try:
                for _ in usb.berichte(stop):
                    pass
            except OSError as e:
                log("S8: read ended:", e)
        th = threading.Thread(target=lesen, daemon=True)
        th.start()
        for o in offsets:
            log(f"LED report 0x{bericht:02x} offset {o} value {wert}")
            usb.senden(einzel_bericht(bericht, o, wert))
            time.sleep(sekunden)
            usb.senden(einzel_bericht(bericht, o, 0))
        time.sleep(0.2)
    finally:
        stop.set()
        t.close()
    return 0
