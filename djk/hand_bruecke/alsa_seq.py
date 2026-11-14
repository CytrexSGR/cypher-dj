# alsa_seq.py: minimal ALSA sequencer client over ctypes (no third-party module), for the controller bridge.
# One non-blocking client with named ports; raw MIDI bytes in and out (snd_midi_event encode/decode).
import ctypes
import ctypes.util
import errno

_lib = ctypes.CDLL(ctypes.util.find_library("asound") or "libasound.so.2")

OPEN_DUPLEX = 3
NONBLOCK = 1
CAP_READ, CAP_WRITE, CAP_SUBS_READ, CAP_SUBS_WRITE = 1, 2, 0x20, 0x40
TYPE_MIDI_GENERIC, TYPE_APPLICATION = 2, 1 << 20
QUEUE_DIRECT, ADDR_SUBSCRIBERS, ADDR_UNKNOWN = 253, 254, 253
EV_SIZE = 28  # sizeof(snd_seq_event_t) on Linux (type, flags, tag, queue, time[8], source[2], dest[2], data[12])

_vp = ctypes.c_void_p
_lib.snd_seq_open.argtypes = [ctypes.POINTER(_vp), ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
_lib.snd_seq_set_client_name.argtypes = [_vp, ctypes.c_char_p]
_lib.snd_seq_create_simple_port.argtypes = [_vp, ctypes.c_char_p, ctypes.c_uint, ctypes.c_uint]
_lib.snd_seq_client_id.argtypes = [_vp]
_lib.snd_seq_event_input.argtypes = [_vp, ctypes.POINTER(_vp)]
_lib.snd_seq_event_output_direct.argtypes = [_vp, _vp]
_lib.snd_seq_parse_address.argtypes = [_vp, _vp, ctypes.c_char_p]
_lib.snd_seq_connect_from.argtypes = [_vp, ctypes.c_int, ctypes.c_int, ctypes.c_int]
_lib.snd_seq_connect_to.argtypes = [_vp, ctypes.c_int, ctypes.c_int, ctypes.c_int]
_lib.snd_seq_close.argtypes = [_vp]
_lib.snd_midi_event_new.argtypes = [ctypes.c_size_t, ctypes.POINTER(_vp)]
_lib.snd_midi_event_no_status.argtypes = [_vp, ctypes.c_int]
_lib.snd_midi_event_encode.argtypes = [_vp, ctypes.c_char_p, ctypes.c_long, _vp]
_lib.snd_midi_event_encode.restype = ctypes.c_long
_lib.snd_midi_event_decode.argtypes = [_vp, ctypes.c_char_p, ctypes.c_long, _vp]
_lib.snd_midi_event_decode.restype = ctypes.c_long
_lib.snd_midi_event_reset_encode.argtypes = [_vp]


class Client:
    def __init__(self, name):
        self.h = _vp()
        if _lib.snd_seq_open(ctypes.byref(self.h), b"default", OPEN_DUPLEX, NONBLOCK) < 0:
            raise OSError("snd_seq_open failed")
        _lib.snd_seq_set_client_name(self.h, name.encode())
        self.id = _lib.snd_seq_client_id(self.h)
        self.enc, self.dec = _vp(), _vp()
        _lib.snd_midi_event_new(64, ctypes.byref(self.enc))
        _lib.snd_midi_event_new(64, ctypes.byref(self.dec))
        _lib.snd_midi_event_no_status(self.dec, 1)  # always full status bytes, no running status
        self.ev = (ctypes.c_ubyte * EV_SIZE)()

    def port_out(self, name):
        return _lib.snd_seq_create_simple_port(self.h, name.encode(), CAP_READ | CAP_SUBS_READ,
                                               TYPE_MIDI_GENERIC | TYPE_APPLICATION)

    def port_in(self, name):
        return _lib.snd_seq_create_simple_port(self.h, name.encode(), CAP_WRITE | CAP_SUBS_WRITE,
                                               TYPE_MIDI_GENERIC | TYPE_APPLICATION)

    def send(self, port, data):
        """Send one complete MIDI message (bytes) from `port` to its subscribers."""
        ctypes.memset(self.ev, 0, EV_SIZE)
        _lib.snd_midi_event_reset_encode(self.enc)
        if _lib.snd_midi_event_encode(self.enc, bytes(data), len(data), ctypes.addressof(self.ev)) <= 0 or self.ev[0] == 0:
            return False
        self.ev[3] = QUEUE_DIRECT
        self.ev[13] = port
        self.ev[14] = ADDR_SUBSCRIBERS
        self.ev[15] = ADDR_UNKNOWN
        return _lib.snd_seq_event_output_direct(self.h, ctypes.addressof(self.ev)) >= 0

    def receive(self):
        """Non-blocking: list of (dest_port, midi_bytes) waiting now."""
        out = []
        p = _vp()
        buf = ctypes.create_string_buffer(64)
        while True:
            r = _lib.snd_seq_event_input(self.h, ctypes.byref(p))
            if r < 0:
                if r in (-errno.EAGAIN, -errno.ENOSPC):
                    if r == -errno.ENOSPC:
                        continue  # input overrun: events were lost, keep reading
                    break
                break
            if not p.value:
                break
            raw = (ctypes.c_ubyte * EV_SIZE).from_address(p.value)
            n = _lib.snd_midi_event_decode(self.dec, buf, 64, p.value)
            if n > 0:
                out.append((raw[15], buf.raw[:n]))
        return out

    def _addr(self, text):
        a = (ctypes.c_ubyte * 2)()
        if _lib.snd_seq_parse_address(self.h, ctypes.addressof(a), text.encode()) < 0:
            return None
        return a[0], a[1]

    def connect_from(self, my_port, source):
        """Subscribe `source` ('Client name:port') to my input port; False if absent. Already connected counts as True."""
        a = self._addr(source)
        if not a:
            return False
        r = _lib.snd_seq_connect_from(self.h, my_port, a[0], a[1])
        return r >= 0 or r == -errno.EBUSY

    def connect_to(self, my_port, dest):
        a = self._addr(dest)
        if not a:
            return False
        r = _lib.snd_seq_connect_to(self.h, my_port, a[0], a[1])
        return r >= 0 or r == -errno.EBUSY

    def close(self):
        _lib.snd_seq_close(self.h)
