# s8_usb.py: one thread owns the S8's HID interface 5 and serves input and LED output on the same usbfs handle.
# nidrv's read_reports()/interrupt_out() each reap URBs on their own and would steal each other's completions,
# so this loop keeps IN URBs armed and submits OUT URBs (LED reports) from a queue, telling them apart by address.
import ctypes
import errno
import queue
import time

import nidrv as N

IN_URBS = 4
IN_SIZE = 256


class S8Usb:
    def __init__(self, transport, melde=None):
        self.t = transport
        self.melde = melde
        self.aus = queue.Queue()
        self._ein = []        # (urb, buffer)
        self._offen = {}      # address of an OUT urb -> (urb, buffer), kept alive until reaped
        self.verworfen = 0    # IN URBs that completed with an error status
        self.aus_status = {}  # OUT completions per status code (0 = ok, -32 = stall), for the log
        for _ in range(IN_URBS):
            buf = ctypes.create_string_buffer(IN_SIZE)
            urb = N.Urb()
            urb.type, urb.endpoint, urb.flags = N.URB_TYPE_INTERRUPT, self.t.ep_in, 0
            urb.buffer, urb.buffer_length = ctypes.cast(buf, ctypes.c_void_p), IN_SIZE
            N.ioctl(self.t.fd, N.USBDEVFS_SUBMITURB, ctypes.byref(urb))
            self._ein.append((urb, buf))
        self._ein_adr = {ctypes.addressof(u): (u, b) for u, b in self._ein}

    def senden(self, data):
        """Queue one OUT report (any thread)."""
        self.aus.put(bytes(data))

    def _ausgeben(self):
        while True:
            try:
                data = self.aus.get_nowait()
            except queue.Empty:
                return
            buf = ctypes.create_string_buffer(data, len(data))
            urb = N.Urb()
            urb.type, urb.endpoint = N.URB_TYPE_INTERRUPT, self.t.ep_out
            urb.flags = N.URB_ZERO_PACKET if len(data) % 64 == 0 else 0
            urb.buffer, urb.buffer_length = ctypes.cast(buf, ctypes.c_void_p), len(data)
            N.ioctl(self.t.fd, N.USBDEVFS_SUBMITURB, ctypes.byref(urb))
            self._offen[ctypes.addressof(urb)] = (urb, buf)

    def berichte(self, stop):
        """Generator of input reports; also flushes queued OUT reports. Ends when `stop` is set."""
        raw = ctypes.create_string_buffer(8)
        while not stop.is_set():
            self._ausgeben()
            try:
                N.ioctl(self.t.fd, N.USBDEVFS_REAPURBNDELAY, ctypes.byref(raw))
            except OSError as exc:
                if exc.errno != errno.EAGAIN:
                    raise
                time.sleep(0.001)
                continue
            adr = int.from_bytes(raw.raw, "little")
            if adr in self._offen:
                urb, buf = self._offen.pop(adr)
                neu = urb.status not in self.aus_status
                self.aus_status[urb.status] = self.aus_status.get(urb.status, 0) + 1
                if neu and self.melde:
                    self.melde("S8 OUT report 0x%02x: first completion with status %d" % (buf.raw[0], urb.status))
                continue
            paar = self._ein_adr.get(adr)
            if not paar:
                continue
            urb, buf = paar
            data = bytes(buf.raw[:urb.actual_length]) if urb.status == 0 else b""
            if urb.status:
                self.verworfen += 1
            urb.buffer, urb.buffer_length = ctypes.cast(buf, ctypes.c_void_p), IN_SIZE
            N.ioctl(self.t.fd, N.USBDEVFS_SUBMITURB, ctypes.byref(urb))
            if data:
                yield data
