#!/usr/bin/env python3
"""Logs everything the core of TEST INSTANCE e sends to the pruefstand port (52140), for acceptance_p1.mjs (frame_luecken of /zustand/kern).
Usage: acceptance_p1_kernlog.py <log file>. Stops on SIGTERM. Instance e only."""
import os
import signal
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pruefstand"))
from osc import Hoerer  # noqa: E402

h = Hoerer(sys.argv[1], inst="e", mit_kern=True, name="abnahme_p1")
signal.signal(signal.SIGTERM, lambda *a: (h.ende(), sys.exit(0)))
while True:
    time.sleep(1)
