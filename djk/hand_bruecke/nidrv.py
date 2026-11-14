#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
nidrv.py -- Treiberkern fuer Native-Instruments-Controller (Schichten 1-3).

Gemessen am Maschine MK2 (17cc:1140), 2026-11-14. Siehe /workspace/ni/01-PROTOKOLL.md.

Schichten:
  1. Transport   -- rohes usbfs (ctypes + libc.ioctl), kein libusb, kein root
  2. Deskriptor  -- Report-ID -> Groesse/Teilung -> semantische Items (Daten)
  3. API         -- Ereignisse nach oben, LED-/Display-Zustand nach unten

Absichtlich ohne Abhaengigkeiten und ohne Threads: `read_events()` ist ein Generator,
der Aufrufer entscheidet ueber Threading. Das ist die Flaeche, die eine DAW anfasst.

Beispiel:
    with Mk2() as mk2:
        for ev in mk2.read_events(seconds=30):
            print(ev)
            if ev.kind == "pad":
                mk2.set_pad_leds({ev.index: pressure_color(ev.value)})
"""

import ctypes
import errno
import json
import os
import struct
import sys
import time

VID_NI = 0x17CC

# --- usbfs ------------------------------------------------------------------
USBDEVFS_CONTROL = 0xC0185500
USBDEVFS_CLAIMINTERFACE = 0x8004550F
USBDEVFS_DISCONNECT_CLAIM = 0x8108551B
USBDEVFS_SUBMITURB = 0x8038550A
USBDEVFS_DISCARDURB = 0x550B
USBDEVFS_REAPURBNDELAY = 0x4008550D

URB_TYPE_INTERRUPT = 1          # NICHT 2 -- 2 ist CONTROL (kostet sonst EINVAL)
URB_ZERO_PACKET = 0x40

_libc = ctypes.CDLL("libc.so.6", use_errno=True)


def ioctl(fd, code, ptr):
    """libc.ioctl mit explizitem Zeiger. fcntl.ioctl segfaultet hier bei _IOW(void*)."""
    r = _libc.ioctl(fd, ctypes.c_ulong(code), ptr)
    if r < 0:
        e = ctypes.get_errno()
        raise OSError(e, os.strerror(e))
    return r


USBDEVFS_BULK = 0xC0185502          # _IOWR('U', 2, struct usbdevfs_bulktransfer)


def max_in_report(report_descriptor, default=64, runden=64):
    """
    Groessten IN-Report aus dem HID-Report-Deskriptor bestimmen -- pro REPORT-ID
    aufsummiert (ein Report ist die Summe seiner Felder, nicht das groesste Feld).

    WICHTIG: usbfs verwirft Transfers, deren Puffer kleiner ist als der Report
    (Status -EOVERFLOW). Ein fest verdrahteter Puffer -- hier war er 65 Byte fuer
    den MK2 -- laesst Geraete mit groesseren Reports (Traktor Kontrol S8: 109 Byte)
    STUMM erscheinen, weil der Reaper sie stillschweigend wegwirft.
    Rueckgabe auf ein Vielfaches von `runden` aufgerundet.
    """
    rid = size = count = 0
    bits_je_report = {}
    i, n = 0, len(report_descriptor or b"")
    while i < n:
        b = report_descriptor[i]
        i += 1
        ln = (0, 1, 2, 4)[b & 3]
        val = int.from_bytes(report_descriptor[i:i + ln], "little") if ln else 0
        if b == 0x85:
            rid = val
        elif b == 0x75:
            size = val
        elif b == 0x95:
            count = val
        elif b == 0x81:                                   # Input
            bits_je_report[rid] = bits_je_report.get(rid, 0) + size * count
        i += ln
    best = max(((b + 7) // 8 + 1 for b in bits_je_report.values()), default=0)
    best = max(best, default)
    return (best + runden - 1) // runden * runden


class ControlTransfer(ctypes.Structure):
    """struct usbdevfs_ctrltransfer {
           __u8 bRequestType, bRequest; __u16 wValue, wIndex, wLength;
           __u32 timeout; void *data; }   -- 24 Byte mit Ausrichtung"""
    _fields_ = [("bRequestType", ctypes.c_ubyte), ("bRequest", ctypes.c_ubyte),
                ("wValue", ctypes.c_ushort), ("wIndex", ctypes.c_ushort),
                ("wLength", ctypes.c_ushort), ("timeout", ctypes.c_uint),
                ("data", ctypes.c_void_p)]


assert ctypes.sizeof(ControlTransfer) == 24


class BulkTransfer(ctypes.Structure):
    """struct usbdevfs_bulktransfer { unsigned int ep, len, timeout; void *data; }"""
    _fields_ = [("ep", ctypes.c_uint), ("length", ctypes.c_uint),
                ("timeout", ctypes.c_uint), ("data", ctypes.c_void_p)]


assert ctypes.sizeof(BulkTransfer) == 24


class Urb(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ubyte), ("endpoint", ctypes.c_ubyte),
                ("status", ctypes.c_int), ("flags", ctypes.c_uint),
                ("buffer", ctypes.c_void_p), ("buffer_length", ctypes.c_int),
                ("actual_length", ctypes.c_int), ("start_frame", ctypes.c_int),
                ("number_of_packets", ctypes.c_int), ("error_count", ctypes.c_int),
                ("signr", ctypes.c_uint), ("usercontext", ctypes.c_void_p)]


assert ctypes.sizeof(Urb) == 56


# --- Geraet finden ----------------------------------------------------------
def find_ni(product_id=None):
    base = "/sys/bus/usb/devices"
    for name in sorted(os.listdir(base)):
        if ":" in name or name.endswith("-0"):
            continue
        d = os.path.join(base, name)

        def rd(attr, _d=d):
            try:
                with open(os.path.join(_d, attr)) as fh:
                    return fh.read().strip()
            except OSError:
                return None
        if (rd("idVendor") or "").lower() != "17cc":
            continue
        pid = int(rd("idProduct") or "0", 16)
        if product_id is not None and pid != product_id:
            continue
        return {"sysfs": d, "name": name, "pid": pid, "vid": VID_NI,
                "product": rd("product"), "serial": rd("serial"),
                "bcdDevice": rd("bcdDevice"),
                "path": "/dev/bus/usb/%03d/%03d" % (int(rd("busnum")), int(rd("devnum")))}
    return None


def hid_interface(sysfs_name):
    """(Nummer, sysfs-Pfad, report_descriptor-Bytes) der HID-Schnittstelle."""
    base = "/sys/bus/usb/devices"
    for name in sorted(os.listdir(base)):
        if not name.startswith(sysfs_name + ":") or name.endswith("-0"):
            continue
        d = os.path.join(base, name)
        try:
            with open(d + "/bInterfaceClass") as fh:
                if int(fh.read().strip(), 16) != 3:
                    continue
            with open(d + "/bInterfaceNumber") as fh:
                num = int(fh.read().strip(), 16)
        except (OSError, ValueError):
            continue
        rd = b""
        for entry in os.listdir(d):
            p = os.path.join(d, entry, "report_descriptor")
            if ":" in entry and os.path.exists(p):
                with open(p, "rb") as fh:
                    rd = fh.read()
        return num, d, rd
    return None, None, b""


# --- Transport --------------------------------------------------------------
class UsbfsTransport:
    """
    Beansprucht die HID-Schnittstelle und spricht Interrupt-In/Out.

    Nebenwirkung, die der Aufrufer kennen muss: `usbhid` wird abgehaengt und kommt
    beim Schliessen NICHT zuverlaessig zurueck -- dem Nutzer fehlt dann sein
    hidraw-Knoten, bis er das Kabel neu steckt.
    """

    def __init__(self, dev, iface, ep_in=0x82, ep_out=0x02, verbose=False,
                 in_size=256):
        self.dev, self.iface = dev, iface
        self.ep_in, self.ep_out = ep_in, ep_out
        self.verbose = verbose
        # URB-Puffer: abgeleitete Groesse, aber mit Sicherheitsmarge (ein zu
        # grosser Puffer kostet nichts, ein zu kleiner macht das Geraet STUMM).
        self.in_size = max(256, (in_size + 63) // 64 * 64)
        self.status_counts = {}             # URB-Statuscodes, um Ueberlaeufe zu belegen
        self.fd = os.open(dev["path"], os.O_RDWR)
        self._in_urbs = []
        try:
            arg = ctypes.create_string_buffer(
                struct.pack("II256s", iface, 0, b""), 264)
            ioctl(self.fd, USBDEVFS_DISCONNECT_CLAIM, ctypes.byref(arg))
            self.how = "disconnect_claim"
        except OSError:
            try:
                n = ctypes.create_string_buffer(struct.pack("I", iface), 4)
                ioctl(self.fd, USBDEVFS_CLAIMINTERFACE, ctypes.byref(n))
                self.how = "claim"
            except OSError as exc:
                os.close(self.fd)
                raise RuntimeError("Schnittstelle %d nicht uebernehmbar: %s"
                                   % (iface, exc.strerror))

    def close(self):
        for urb in self._in_urbs:
            try:
                ioctl(self.fd, USBDEVFS_DISCARDURB, ctypes.byref(urb))
            except OSError:
                pass
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- Ausgang ------------------------------------------------------------
    def interrupt_out(self, data, timeout_s=2.0):
        buf = ctypes.create_string_buffer(bytes(data), len(data))
        urb = Urb()
        urb.type = URB_TYPE_INTERRUPT
        urb.endpoint = self.ep_out
        urb.flags = URB_ZERO_PACKET if len(data) % 64 == 0 else 0
        urb.buffer = ctypes.cast(buf, ctypes.c_void_p)
        urb.buffer_length = len(data)
        ioctl(self.fd, USBDEVFS_SUBMITURB, ctypes.byref(urb))
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            done = self._reap(deadline - time.monotonic())
            if done is None:
                break
            if done.buffer != urb.buffer:
                continue
            if done.status:
                raise OSError(-done.status, "URB-Status %d" % done.status)
            return done.actual_length
        raise TimeoutError("interrupt OUT ohne Abschluss (%d B)" % len(data))

    # -- Feature-Report (SET_REPORT per Control-Transfer) -------------------
    def control(self, bmRequestType, bRequest, wValue=0, wIndex=0, length=0,
                data=None, timeout_ms=2000):
        """
        Beliebiger Control-Transfer. Fuer die Suche nach dem hersteller-
        spezifischen Handschlag (bmRequestType 0x40/0xC0) unverzichtbar.
        """
        payload = b"" if data is None else bytes(data)
        n = len(payload) if data is not None else length
        buf = ctypes.create_string_buffer(max(n, 1))
        if payload:
            ctypes.memmove(buf, payload, len(payload))
        ctrl = ControlTransfer(bmRequestType, bRequest, wValue, wIndex, n,
                               timeout_ms, ctypes.cast(buf, ctypes.c_void_p))
        got = ioctl(self.fd, USBDEVFS_CONTROL, ctypes.byref(ctrl))
        return bytes(buf.raw[:got])

    def set_feature(self, report_id, data, interface=None, timeout_ms=2000):
        """
        Feature-Report schreiben (SET_REPORT).
        NI nutzt das u. a. zum Freischalten/Initialisieren der Screens
        (Verdacht: MK2 0xd0/0xd1, S8 0xf8/0xf9).
        bmRequestType 0x21 = Host->Geraet, Klasse, Empfaenger Interface.
        """
        iface = self.iface if interface is None else interface
        payload = bytes([report_id]) + bytes(data)
        buf = ctypes.create_string_buffer(payload, len(payload))
        ctrl = ControlTransfer(0x21, 0x09, (3 << 8) | report_id, iface, len(payload),
                               timeout_ms, ctypes.cast(buf, ctypes.c_void_p))
        return ioctl(self.fd, USBDEVFS_CONTROL, ctypes.byref(ctrl))

    def get_feature(self, report_id, length, interface=None, timeout_ms=2000):
        """
        Feature-Report LESEN (GET_REPORT). Bei NI-Geraeten der uebliche Handschlag:
        der Host fragt Faehigkeiten/Zustand ab. bmRequestType 0xA1 = Geraet->Host.
        """
        iface = self.iface if interface is None else interface
        buf = ctypes.create_string_buffer(length)
        ctrl = ControlTransfer(0xA1, 0x01, (3 << 8) | report_id, iface, length,
                               timeout_ms, ctypes.cast(buf, ctypes.c_void_p))
        n = ioctl(self.fd, USBDEVFS_CONTROL, ctypes.byref(ctrl))
        return bytes(buf.raw[:n])

    # -- HID-Grundinitialisierung -------------------------------------------
    def clear_halt(self, endpoint):
        """Gestallten Endpunkt aufheben: CLEAR_FEATURE(ENDPOINT_HALT)."""
        return self.control(0x02, 0x01, 0, endpoint, length=0)

    def set_idle(self, dauer=0, report_id=0):
        """SET_IDLE -- was usbhid sonst erledigt. Ohne das kann ein Geraet
        schweigen, obwohl es Daten haette."""
        return self.control(0x21, 0x0A, (dauer << 8) | report_id, self.iface, length=0)

    def set_protocol(self, protokoll=1):
        """SET_PROTOCOL: 1 = Report-Protokoll (nicht Boot)."""
        return self.control(0x21, 0x0B, protokoll, self.iface, length=0)

    def hid_init(self):
        """
        Was usbhid beim Binden tut und mein eigener Treiber bisher NICHT getan hat.
        Belegt: nach mehreren Claim/Close-Zyklen und einem gestallten Control-Transfer
        (EPIPE) sendete das Geraet gar nichts mehr -- vorher 30 Reports in 20 s.
        """
        ergebnis = {}
        for name, fn in (("clear_halt in", lambda: self.clear_halt(self.ep_in)),
                         ("clear_halt out", lambda: self.clear_halt(self.ep_out)),
                         ("set_idle 0", lambda: self.set_idle(0)),
                         ("set_protocol report", lambda: self.set_protocol(1))):
            try:
                fn()
                ergebnis[name] = "ok"
            except OSError as exc:
                ergebnis[name] = str(exc)
        return ergebnis

    # -- Bulk (fuer die Vendor-Screens, z. B. Traktor Kontrol S8) -----------
    def bulk_out(self, data, timeout_ms=3000, endpoint=None):
        """
        Synchroner Bulk-Transfer. `usbfs` bietet dafuer einen eigenen ioctl --
        kein URB noetig. Die Screen-Schnittstellen der NI-Geraete sind Bulk.
        """
        ep = self.ep_out if endpoint is None else endpoint
        buf = ctypes.create_string_buffer(bytes(data), len(data))
        bulk = BulkTransfer(ep, len(data), timeout_ms,
                            ctypes.cast(buf, ctypes.c_void_p))
        n = ioctl(self.fd, USBDEVFS_BULK, ctypes.byref(bulk))
        return n

    # -- Eingang ------------------------------------------------------------
    def _reap(self, timeout_s):
        """usbfs meldet Fertigstellung als POLLOUT, nicht lesbar -> NDELAY pollen."""
        raw = ctypes.create_string_buffer(8)
        deadline = time.monotonic() + max(timeout_s, 0)
        while time.monotonic() < deadline:
            try:
                ioctl(self.fd, USBDEVFS_REAPURBNDELAY, ctypes.byref(raw))
            except OSError as exc:
                if exc.errno != errno.EAGAIN:
                    raise
                time.sleep(0.001)
                continue
            addr = struct.unpack("Q", raw.raw)[0]
            if addr:
                return ctypes.cast(addr, ctypes.POINTER(Urb)).contents
            time.sleep(0.001)
        return None

    def arm(self, count=4, size=None):
        size = self.in_size if size is None else size
        self._in_urbs, self._in_bufs = [], []
        for _ in range(count):
            buf = ctypes.create_string_buffer(size)
            urb = Urb()
            urb.type = URB_TYPE_INTERRUPT
            urb.endpoint = self.ep_in
            urb.flags = 0
            urb.buffer = ctypes.cast(buf, ctypes.c_void_p)
            urb.buffer_length = size
            ioctl(self.fd, USBDEVFS_SUBMITURB, ctypes.byref(urb))
            self._in_urbs.append(urb)
            self._in_bufs.append(buf)

    def read_reports(self, seconds=None):
        """Generator roher Reports (bytes). Bewaffnet URBs nach."""
        self.arm()
        t0 = time.monotonic()
        while seconds is None or time.monotonic() - t0 < seconds:
            done = self._reap(0.05)
            if done is None:
                continue
            idx = next((i for i, u in enumerate(self._in_urbs)
                        if u.buffer == done.buffer), None)
            if idx is None:
                continue
            urb, buf = self._in_urbs[idx], self._in_bufs[idx]
            if urb.status:
                self.status_counts[urb.status] = self.status_counts.get(urb.status, 0) + 1
            data = bytes(buf.raw[:urb.actual_length]) if urb.status == 0 else b""
            urb.buffer = ctypes.cast(buf, ctypes.c_void_p)   # neu bewaffnen
            urb.buffer_length = len(buf)
            ioctl(self.fd, USBDEVFS_SUBMITURB, ctypes.byref(urb))
            if data:
                yield data


# --- Ereignisse -------------------------------------------------------------
class Event:
    __slots__ = ("kind", "index", "value", "name", "raw")

    def __init__(self, kind, index=None, value=None, name=None, raw=None):
        self.kind, self.index, self.value, self.name, self.raw = \
            kind, index, value, name, raw

    def __repr__(self):
        if self.name:
            return "<%s %s%s>" % (self.kind, self.name,
                                  "" if self.value is None else "=%s" % self.value)
        return "<%s %s%s>" % (self.kind, self.index,
                              "" if self.value is None else "=%s" % self.value)


# --- Deskriptor als Daten ---------------------------------------------------
# Reihenfolge je Byte ist LSB-first -- am Geraet an vier Tastendruecken gemessen.
MK2_BUTTONS = {
    1: ["top_1", "top_2", "top_3", "top_4", "top_5", "top_6", "top_7", "top_8"],
    2: ["control", "step", "browse", "sampling", "browse_left", "browse_right",
        "all", "auto_wr"],
    3: ["volume", "swing", "tempo", "master_left", "master_right", "enter",
        "note_repeat", "master_wheel"],
    4: ["group_a", "group_b", "group_c", "group_d", "group_e", "group_f",
        "group_g", "group_h"],
    5: ["restart", "step_left", "step_right", "grid", "play", "rec", "erase",
        "shift"],
    6: ["scene", "pattern", "pad_mode", "navigate", "duplicate", "select",
        "solo", "mute"],
}
MK2_BUTTON_LED_ORDER = ["control", "step", "browse", "sampling", "browse_left",
                        "browse_right", "all", "auto_wr",
                        "top_1", "top_2", "top_3", "top_4", "top_5", "top_6",
                        "top_7", "top_8",
                        "scene", "pattern", "pad_mode", "navigate", "duplicate",
                        "select", "solo", "mute",
                        "volume", "swing", "tempo", "master_left", "master_right",
                        "enter", "note_repeat"]
MK2_DESCRIPTOR = {
    "name": "NI Maschine Mk2", "vid": VID_NI, "pid": 0x1140,
    "iface": 2, "ep_in": 0x82, "ep_out": 0x02,
    "reports": {
        "buttons": {"id": 0x01, "in": True, "size": 25},
        "pads": {"id": 0x20, "in": True, "size": 65},
        "led_pads": {"id": 0x80, "out": True, "size": 49},
        "led_groups": {"id": 0x81, "out": True, "size": 57},
        "led_buttons": {"id": 0x82, "out": True, "size": 32},
        "screen_left": {"id": 0xE0, "out": True, "size": 265},
        "screen_right": {"id": 0xE1, "out": True, "size": 265},
    },
    "pad_threshold": 200,
    "screen": {"width": 256, "height": 64, "bands": 8,
               "packing": "row_major_32_bytes_per_row"},
}


def pack_pixel(fb, x, y):
    """
    Pixel in einen 2048-Byte-Rahmen packen.

    Am Geraet gemessen (Sichtpruefung): ZEILENWEISE gepackt, nicht seitenweise.
        Band = y//8 ; Byteindex = Band*256 + (y%8)*32 + x//8 ; Bit = x%8
    """
    fb[(y // 8) * 256 + (y % 8) * 32 + (x // 8)] |= 1 << (x % 8)


class FrameBuffer(bytearray):
    def __init__(self, fill=0):
        super().__init__(bytes([fill]) * 2048)

    def pixel(self, x, y, on=True):
        idx = (y // 8) * 256 + (y % 8) * 32 + (x // 8)
        bit = 1 << (x % 8)
        if on:
            self[idx] |= bit
        else:
            self[idx] &= ~bit & 0xFF
        return self

    def rect(self, x0, y0, w, h, on=True):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                self.pixel(x, y, on)
        return self

    def line(self, x0, y0, x1, y1, on=True):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.pixel(x0, y0, on)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
        return self

    def bands(self, report_id):
        out = []
        for band in range(8):
            pk = bytearray(265)
            pk[0] = report_id
            pk[3] = band * 8
            pk[5] = 0x20
            pk[7] = 0x08
            pk[9:265] = self[band * 256:(band + 1) * 256]
            out.append(bytes(pk))
        return out


# --- Geraeteklasse ----------------------------------------------------------
class Mk2:
    """Schicht 3: gerätenahe API fuer das Maschine MK2."""

    DESCRIPTOR = MK2_DESCRIPTOR
    # Der Screen-Encoder ist GLATT -- er hat KEIN Rastgefuehl (am Geraet geprueft:
    # Schrittweiten 4..9 ohne Vielfachen-Muster). Es gibt also gar keine Raststufe,
    # und diese Zahl ist eine EMPFINDLICHKEIT, keine Messung:
    #   eine Umdrehung = 1000 Rohzaehler; 40 Zaehler ~ 1/25 Umdrehung ~ 1 Parameter-Schritt.
    # Wer die feine Spur selbst auswerten will: quantize=False.
    COUNTS_PER_STEP = 40

    def __init__(self, verbose=False, quantize=True, counts_per_step=None):
        dev = find_ni(0x1140)
        if not dev:
            raise RuntimeError("kein Maschine MK2 (17cc:1140) gefunden")
        iface, _, _ = hid_interface(dev["name"])
        self.dev = dev
        self.transport = UsbfsTransport(dev, iface, 0x82, 0x02, verbose=verbose)
        self._buttons = bytearray(7)
        self._pad_state = {}
        self._enc_pos = [None] * 8
        self._enc_acc = {}
        self._wheel_pos = None
        self.quantize = quantize
        self.counts_per_step = counts_per_step or self.COUNTS_PER_STEP

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self.transport.close()

    # -- Eingang ------------------------------------------------------------
    def read_events(self, seconds=None):
        """
        Generator von Ereignissen.

        Tasten sind edge-triggered (kommen nur bei Aenderung), Pads sind ein
        750-Hz-Dauerstrom -- deshalb hier Schwellwert + Aenderungsfilter.
        """
        thr = self.DESCRIPTOR["pad_threshold"]
        for data in self.transport.read_reports(seconds):
            rid = data[0]
            if rid == 0x01 and len(data) >= 25:
                for ev in self._decode_buttons(data):
                    yield ev
            elif rid == 0x20 and len(data) >= 65:
                for ev in self._decode_pads(data, thr):
                    yield ev

    def _decode_buttons(self, data):
        for i in range(1, 7):
            new, old = data[i], self._buttons[i]
            if new == old:
                continue
            for bit in range(8):
                if (new ^ old) & (1 << bit):
                    yield Event("button", index=(i, bit),
                                name=MK2_BUTTONS[i][bit],
                                value=bool(new & (1 << bit)))
            self._buttons[i] = new
        # Screen-Encoder: glatter Endlosgeber, absoluter 10-Bit-Zaehler (0..999, umlaufend),
        # den das Geraet mit ~200 Hz als FEINE Positionsspur liefert (Schritte 4..20).
        # Fuer eine DAW wird daraus per Sammler + Schwelle ein Schritt je counts_per_step.
        for k in range(8):
            pos = struct.unpack_from("<H", data, 9 + 2 * k)[0]
            if self._enc_pos[k] is not None and pos != self._enc_pos[k]:
                delta = (pos - self._enc_pos[k] + 500) % 1000 - 500
                if not self.quantize:
                    if delta:
                        yield Event("encoder", index=k, value=delta)
                else:
                    self._enc_acc[k] = self._enc_acc.get(k, 0) + delta
                    K = self.counts_per_step
                    while abs(self._enc_acc[k]) >= K:
                        step = K if self._enc_acc[k] > 0 else -K
                        self._enc_acc[k] -= step
                        yield Event("encoder", index=k,
                                    value=1 if step > 0 else -1)
            self._enc_pos[k] = pos
        wheel = data[8]
        if self._wheel_pos is not None and wheel != self._wheel_pos:
            delta = (wheel - self._wheel_pos + 8) % 16 - 8
            if delta:
                yield Event("wheel", index=0, value=delta)
        self._wheel_pos = wheel

    def _decode_pads(self, data, threshold):
        for k in range(16):
            word = struct.unpack_from("<H", data, 1 + 2 * k)[0]
            pid, pressure = word >> 12, word & 0x0FFF
            if pressure < threshold:
                pressure = 0
            old = self._pad_state.get(pid, 0)
            if pressure != old:
                self._pad_state[pid] = pressure
                kind = "pad_down" if old == 0 else ("pad_up" if pressure == 0
                                                   else "pad_aftertouch")
                yield Event(kind, index=pid, value=pressure)

    # -- Ausgang ------------------------------------------------------------
    def set_pad_leds(self, colors, leds=None):
        """colors: {pad_index: (r,g,b)} oder Liste von 16 Triplets. leds: Rest bleibt."""
        data = bytearray(leds) if leds else bytearray(49)
        data[0] = 0x80
        if isinstance(colors, dict):
            for idx, rgb in colors.items():
                data[1 + 3 * idx:4 + 3 * idx] = bytes(rgb)
        else:
            for idx in range(16):
                data[1 + 3 * idx:4 + 3 * idx] = bytes(colors[idx])
        self.transport.interrupt_out(bytes(data))

    def set_button_leds(self, brightness):
        """brightness: Zahl (alle) oder {name: 0..127}."""
        data = bytearray(32)
        data[0] = 0x82
        if isinstance(brightness, dict):
            for name, val in brightness.items():
                if name in MK2_BUTTON_LED_ORDER:
                    data[1 + MK2_BUTTON_LED_ORDER.index(name)] = val & 0xFF
        else:
            for i in range(31):
                data[1 + i] = brightness & 0xFF
        self.transport.interrupt_out(bytes(data))

    def set_group_leds(self, groups):
        """groups: 8x (links, rechts) als RGB-Tripletts; Transport-LEDs optional."""
        data = bytearray(57)
        data[0] = 0x81
        for i in range(8):
            left, right = groups[i] if i < len(groups) else ((0, 0, 0), (0, 0, 0))
            data[1 + 6 * i:4 + 6 * i] = bytes(left)
            data[4 + 6 * i:7 + 6 * i] = bytes(right)
        for i in range(8):
            data[49 + i] = 0x40
        self.transport.interrupt_out(bytes(data))

    def blit(self, screen, framebuffer):
        """screen: 'left'|'right'; framebuffer: 2048 Byte (FrameBuffer)."""
        rid = 0xE0 if screen == "left" else 0xE1
        fb = FrameBuffer()
        fb[:] = framebuffer[:2048]
        for pk in fb.bands(rid):
            self.transport.interrupt_out(pk)


# --- NI-Farbscreens (Vendor-Bulk, 480x272 BGR565) ---------------------------
# Format aus Encdrs Quellcode gelesen (encdr/src/screen/protocol.rs) und am S8 zu
# pruefen -- NICHT uebernommen, sondern als Hypothese formuliert:
#   16-Byte-Kopf [0x84, 0x00, display, 0x60, 0,0,0,0, x_be, y_be, w_be, h_be]
#   dann Opcodes: 0x00 nnnnnn = roh, 0x01 nnnnnn = RLE (n Paare), 0x02 = ueberspringen
#   0x03,0,0,0 = Blit/Tausch, 0x40,0,0,0 = Ende
# Gezaehlt wird in PAAREN (2 Pixel = 4 Byte BGR565).
def encode_screen_fill(display, color_4bytes, width=480, height=272,
                       x=0, y=0, w=None, h=None):
    w = width if w is None else w
    h = height if h is None else h
    f = bytearray([0x84, 0x00, display & 0xFF, 0x60, 0, 0, 0, 0])
    f += x.to_bytes(2, "big") + y.to_bytes(2, "big")
    f += w.to_bytes(2, "big") + h.to_bytes(2, "big")
    pairs = (w * h) // 2
    f += bytes([0x01, (pairs >> 16) & 0xFF, (pairs >> 8) & 0xFF, pairs & 0xFF])
    f += bytes(color_4bytes)
    # Der Display-Index steht AUCH im Footer (7. Byte) -- ohne ihn reagiert nur
    # das linke Display, egal was im Kopf steht. Belegt: screens[1].full_blit.footer
    # lautet 0x03,0,0,0,0x40,0,0x01,0 gegenueber 0x03,0,0,0,0x40,0,0x00,0 fuer links.
    f += bytes([0x03, 0, 0, 0, 0x40, 0, display & 0xFF, 0])
    return bytes(f)


def encode_screen_raw(display, pixels_bgr565_be, width, height, x=0, y=0):
    """Rohvariante ohne RLE (fuer Muster, die nicht einfarbig sind)."""
    f = bytearray([0x84, 0x00, display & 0xFF, 0x60, 0, 0, 0, 0])
    f += x.to_bytes(2, "big") + y.to_bytes(2, "big")
    f += width.to_bytes(2, "big") + height.to_bytes(2, "big")
    pairs = len(pixels_bgr565_be) // 4
    f += bytes([0x00, (pairs >> 16) & 0xFF, (pairs >> 8) & 0xFF, pairs & 0xFF])
    f += bytes(pixels_bgr565_be)
    f += bytes([0x03, 0, 0, 0, 0x40, 0, display & 0xFF, 0])
    return bytes(f)


def rgb888_to_bgr565_be(r, g, b):
    """2 Pixel = 4 Byte. Kanalreihenfolge ist am Geraet noch zu bestaetigen."""
    v = ((b >> 3) << 11) | ((g >> 2) << 5) | (r >> 3)      # BGR565
    return bytes([(v >> 8) & 0xFF, v & 0xFF]) * 2


# --- Maschine Jam -----------------------------------------------------------
# Am Geraet gemessen 2026-11-14 (Report-Deskriptor 550 B + Live-Tests):
#   Interface 0 (usbhid), Interrupt 0x01 OUT / 0x81 IN, Full Speed (12 Mbps) -- anders als MK2.
#   Kein 24-Bit-RGB-Feld im ganzen Deskriptor: alle LED-Reports sind EIN Byte je LED.
JAM_DESCRIPTOR = {
    "name": "NI Maschine Jam", "vid": VID_NI, "pid": 0x1500,
    "iface": 0, "ep_in": 0x81, "ep_out": 0x01,
    "reports": {
        "buttons": {"id": 0x01, "in": True, "size": 17},   # 4 Bit x 2 Knobs + 1 Bit x 120
        "strips":  {"id": 0x02, "in": True, "size": 49},   # 8 x (16 Bit ts + 2 x 16 Bit Finger)
        "unknown": {"id": 0x40, "in": True, "size": 25},   # 12 x 16 Bit -- [offen]
        "led_buttons": {"id": 0x80, "out": True, "size": 54},
        "led_matrix":  {"id": 0x81, "out": True, "size": 81},
        "led_strips":  {"id": 0x82, "out": True, "size": 89},
        "cfg": {"id": 0xF4, "out": True, "size": 4},
    },
    "n_buttons": 120,
    "n_strips": 8,
    "strip_segments": 11,
    # [vermutet, an der Hardware noch nicht bestaetigt] 80 = 64 Matrix-Pads + 16 Gruppen/Nummern
    "led_layout": {"0x80": 53, "0x81": 80, "0x82": 88},
}


class Jam:
    """Schicht 3 fuer die Maschine Jam. Tastennamen sind noch [offen] -- es gibt nur Indizes,
    bis eine gefuehrte Aufnahme sie belegt (die einzige Fremdquelle mit Namen hat sich beim
    MK2 in vier Punkten geirrt)."""

    DESCRIPTOR = JAM_DESCRIPTOR

    def __init__(self, verbose=False):
        dev = find_ni(0x1500)
        if not dev:
            raise RuntimeError("keine Maschine Jam (17cc:1500) gefunden")
        iface, _, _ = hid_interface(dev["name"])
        if iface is None:
            iface = 0
        self.dev = dev
        self.transport = UsbfsTransport(dev, iface, 0x81, 0x01, verbose=verbose)
        # Zustand je Report-Byte-Offset (2..16), damit der Zugriff ohne Umrechnung passt
        self._buttons = bytearray(17)
        self._strips = [None] * 8
        self._knob_prev = [None] * 2

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self.transport.close()

    def read_events(self, seconds=None):
        for data in self.transport.read_reports(seconds):
            rid = data[0]
            if rid == 0x01 and len(data) >= 17:
                for ev in self._decode_buttons(data):
                    yield ev
            elif rid == 0x02 and len(data) >= 49:
                for ev in self._decode_strips(data):
                    yield ev

    def _decode_buttons(self, data):
        # 4 Bit x 2 = Knobs (Rohwert 0..15), dann 120 Button-Bits LSB-first je Byte
        knobs = data[1]
        for k in range(2):
            val = (knobs >> (4 * k)) & 0x0F
            if self._knob_prev[k] is not None and val != self._knob_prev[k]:
                delta = (val - self._knob_prev[k] + 8) % 16 - 8
                if delta:
                    yield Event("knob", index=k, value=delta)
            self._knob_prev[k] = val
        for i in range(2, 17):
            new, old = data[i], self._buttons[i]
            if new == old:
                continue
            for bit in range(8):
                if (new ^ old) & (1 << bit):
                    yield Event("button", index=(i - 2) * 8 + bit,
                                name=None, value=bool(new & (1 << bit)))
            self._buttons[i] = new

    def _decode_strips(self, data):
        for s in range(8):
            ts, f1, f2 = struct.unpack_from("<HHH", data, 1 + 6 * s)
            cur = (ts, f1, f2)
            if self._strips[s] is not None and cur != self._strips[s]:
                old_ts, old_f1, old_f2 = self._strips[s]
                for finger, (new, old) in enumerate(((f1, old_f1), (f2, old_f2))):
                    if new != old:
                        yield Event("strip", index=s, name="finger%d" % (finger + 1),
                                    value=new)
            self._strips[s] = cur

    # -- Ausgang ------------------------------------------------------------
    def set_led_buttons(self, values):
        """values: Liste von 53 Bytes oder {index: byte}."""
        data = bytearray(54)
        data[0] = 0x80
        if isinstance(values, dict):
            for i, v in values.items():
                data[1 + i] = v & 0xFF
        else:
            for i, v in enumerate(values[:53]):
                data[1 + i] = v & 0xFF
        self.transport.interrupt_out(bytes(data))

    def set_led_matrix(self, values):
        """80 Bytes (64 Matrix-Pads + 16 Gruppen/Nummern -- Aufteilung [offen])."""
        data = bytearray(81)
        data[0] = 0x81
        if isinstance(values, dict):
            for i, v in values.items():
                data[1 + i] = v & 0xFF
        else:
            for i, v in enumerate(values[:80]):
                data[1 + i] = v & 0xFF
        self.transport.interrupt_out(bytes(data))

    def set_led_strips(self, per_strip):
        """per_strip: {strip: [11 Segmente]} oder Liste von 8 Listen."""
        data = bytearray(89)
        data[0] = 0x82
        if isinstance(per_strip, dict):
            for s, segs in per_strip.items():
                for seg, v in enumerate(segs[:11]):
                    data[1 + s * 11 + seg] = v & 0xFF
        else:
            for s, segs in enumerate(per_strip[:8]):
                for seg, v in enumerate(segs[:11]):
                    data[1 + s * 11 + seg] = v & 0xFF
        self.transport.interrupt_out(bytes(data))


# --- CLI --------------------------------------------------------------------
def _emit(ev, out):
    if out:
        out.write(json.dumps({"t": round(time.time(), 6), "kind": ev.kind,
                              "index": ev.index, "name": ev.name,
                              "value": ev.value}) + "\n")
        out.flush()


def cmd_monitor(args):
    out = open(args.output, "a") if args.output else None
    with Mk2(verbose=True, quantize=not args.raw) as mk2:
        print("MK2 an %s, Interface %d -- %d s Ereignisse (Strg-C beendet)"
              % (mk2.dev["path"], mk2.transport.iface, args.seconds))
        n = 0
        try:
            for ev in mk2.read_events(args.seconds):
                n += 1
                print("  %-14s %s" % (ev.kind, ev))
                _emit(ev, out)
                if ev.kind == "pad_down":
                    mk2.set_pad_leds({ev.index: (0x20, 0x08, 0x00)})
                elif ev.kind == "pad_up":
                    mk2.set_pad_leds({ev.index: (0, 0, 0)})
        except KeyboardInterrupt:
            pass
        print("%d Ereignisse" % n)
    if out:
        out.close()
    return 0


def cmd_demo(args):
    out = open(args.output, "a") if args.output else None
    with Mk2(verbose=True, quantize=not args.raw) as mk2:
        print("Demo: LEDs, Display, dann 20 s Bedienung")
        mk2.set_pad_leds([(0x20, 0x08, 0x00)] * 16)
        mk2.set_button_leds(0x3F)
        mk2.set_group_leds([((0, 0x20, 0), (0x20, 0, 0x20))] * 8)
        fb = FrameBuffer()
        fb.rect(0, 0, 8, 8)
        fb.line(0, 0, 255, 63)
        mk2.blit("left", fb)
        fb2 = FrameBuffer()
        for (x0, y0) in ((0, 0), (248, 0), (0, 56), (248, 56)):
            fb2.rect(x0, y0, 8, 8)
        mk2.blit("right", fb2)
        print("Bediene das Geraet -- Ereignisse kommen live:")
        for ev in mk2.read_events(args.seconds):
            print("  %-14s %s" % (ev.kind, ev))
            _emit(ev, out)
    if out:
        out.close()
    return 0


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("monitor"); p.add_argument("-s", "--seconds", type=float, default=30)
    p.add_argument("-o", "--output", help="Ereignisse als JSONL mitschreiben")
    p.add_argument("--raw", action="store_true", help="Encoder roh (feine Spur) statt Raststufen")
    p = sub.add_parser("demo"); p.add_argument("-s", "--seconds", type=float, default=20)
    p.add_argument("-o", "--output", help="Ereignisse als JSONL mitschreiben")
    p.add_argument("--raw", action="store_true", help="Encoder roh (feine Spur) statt Raststufen")
    args = ap.parse_args()
    if args.cmd == "monitor":
        return cmd_monitor(args)
    if args.cmd == "demo":
        return cmd_demo(args)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
