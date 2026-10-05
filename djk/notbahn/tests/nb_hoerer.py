#!/usr/bin/env python3
"""Scheibe 10: empfängt /nb ,iiih (SCHNITTSTELLEN §5.10) auf einem UDP-Port und schreibt je Nachricht eine Zeile
'<mono_s> <zustand> <takte> <generation> <w>' nach <datei>, bis SIGTERM. Aufruf: nb_hoerer.py <port> <datei>"""
import signal, socket, struct, sys, time
port, datei = int(sys.argv[1]), sys.argv[2]
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(('127.0.0.1', port))
s.settimeout(0.2)
lauf = [True]
signal.signal(signal.SIGTERM, lambda *_: lauf.__setitem__(0, False))
with open(datei, 'w') as f:
    while lauf[0]:
        try:
            b = s.recv(64)
        except socket.timeout:
            continue
        if b[:4] != b'/nb\0' or b[4:12] != b',iiih\0\0\0' or len(b) != 32:
            f.write(f'{time.monotonic():.3f} FORMFEHLER {b.hex()}\n'); continue
        z, t, g, w = struct.unpack('>iiiq', b[12:32])
        f.write(f'{time.monotonic():.3f} {z} {t} {g} {w}\n'); f.flush()
