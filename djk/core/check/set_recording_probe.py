#!/usr/bin/env python3
"""Probe for cypherdj-setmitschnitt against a fake audio ring (INTERFACES §6.1), no kern needed.

A writer fills a ring file in real time with a counter signal (left = kern sample / 2^24, right = -left), then
  1. runs normally for 3 s,
  2. stalls for 2 s (more than the ring holds: the reader must report an overrun and fill the gap with silence),
  3. runs 2 s more,
  4. jumps to a new time axis (sample_minus_w changes: a kern restart),
  5. runs 2 s more, then the stop file appears.
Checks: the WAV is readable, its length is the run time without the jump pause, every recorded frame carries the value
of its own kern sample (no frame lost, doubled or shifted), the gap is silence of the right length, and the JSON names
one gap and one jump. Exit 0 = all checks passed.

Usage: set_recording_probe.py <path to cypherdj-setmitschnitt>
"""
import json
import mmap
import os
import struct
import subprocess
import sys
import tempfile
import time

RATE, KAN, CAP, KOPF = 48000, 4, 65536, 64
BLOCK = 256


def main():
    prog = sys.argv[1]
    d = tempfile.mkdtemp(prefix="setmitschnitt-")
    ring_pfad = os.path.join(d, "bus")
    groesse = KOPF + CAP * KAN * 4
    with open(ring_pfad, "wb") as f:
        f.write(b"\0" * groesse)
    fd = os.open(ring_pfad, os.O_RDWR)
    mm = mmap.mmap(fd, groesse)
    mm[0:20] = b"CDJB" + struct.pack("<IIII", 1, RATE, KAN, CAP)
    smw = 1000  # kern sample = w + smw
    w = 0

    def kopf():
        mm[32:40] = struct.pack("<Q", w)
        mm[56:64] = struct.pack("<Q", smw % (1 << 64))

    def schreibe(sekunden):
        nonlocal w
        t0 = time.monotonic()
        ziel = int(sekunden * RATE)
        geschrieben = 0
        while geschrieben < ziel:
            soll = int((time.monotonic() - t0) * RATE)
            while geschrieben < min(soll, ziel):
                n = min(BLOCK, ziel - geschrieben)
                for i in range(n):
                    s = w + i + smw
                    v = ((s % (1 << 24)) + 1) / float(1 << 24)
                    off = KOPF + ((w + i) % CAP) * KAN * 4
                    mm[off:off + 8] = struct.pack("<ff", v, -v)
                w += n
                geschrieben += n
                kopf()
            time.sleep(0.005)

    kopf()
    wav = os.path.join(d, "set.wav")
    stopp = os.path.join(d, "stopp")
    p = subprocess.Popen([prog, "--aus", wav, "--ring", ring_pfad, "--stopp", stopp], stderr=subprocess.PIPE, text=True)
    time.sleep(0.3)
    schreibe(3.0)
    # 2. the reader stalls (SIGSTOP) for 2 s while the ring runs on: more than the ring holds, so an overrun
    import signal
    p.send_signal(signal.SIGSTOP)
    schreibe(2.0)
    p.send_signal(signal.SIGCONT)
    schreibe(2.0)
    smw += 10_000_000  # 4. new time axis
    kopf()
    schreibe(2.0)
    time.sleep(0.3)   # the reader takes the last frames (it reads every 20 ms)
    w_ende = w
    open(stopp, "w").close()
    _, err = p.communicate(timeout=10)
    fehler = []
    if p.returncode != 0:
        fehler.append(f"return code {p.returncode}: {err}")
    with open(wav, "rb") as f:
        roh = f.read()
    assert roh[:4] == b"RIFF" and roh[8:12] == b"WAVE", "no RIFF/WAVE"
    fmt = struct.unpack("<HHIIHH", roh[20:36])
    if fmt != (3, 2, 48000, 384000, 8, 32):
        fehler.append(f"fmt {fmt}")
    daten_len = struct.unpack("<I", roh[54:58])[0]
    daten = roh[58:58 + daten_len]
    if len(daten) != daten_len:
        fehler.append(f"data size {daten_len} but {len(daten)} bytes")
    n = daten_len // 8
    werte = struct.unpack(f"<{2 * n}f", daten)
    meta = json.load(open(wav + ".json"))
    s0 = meta["s0"]
    arten = [e["art"] for e in meta["ereignisse"]]
    if arten.count("luecke") != 1 or arten.count("sprung") != 1:
        fehler.append(f"events {arten}")
    # walk the file: before the jump, frame i carries kern sample s0 + i (or silence inside the gap)
    falsch = still = 0
    sprung_i = None
    for i in range(n):
        l, r = werte[2 * i], werte[2 * i + 1]
        if l == 0.0 and r == 0.0:
            still += 1
            continue
        s = round(l * (1 << 24)) - 1
        if sprung_i is None and s != s0 + i:
            if s >= 10_000_000:
                sprung_i = i
            else:
                falsch += 1
        if r != -l:
            falsch += 1
    # ring w is continuous over the stall (filled) and the jump (kept): the file holds exactly the frames from its first
    # w to the last w, nothing lost at the jump (review 2026-11-07: 768 to 1024 frames were lost there)
    w0 = s0 - 1000
    if n != w_ende - w0:
        fehler.append(f"{n} frames in the file, the ring wrote {w_ende - w0} since the start (lost at the jump?)")
    # after the jump the values run on frame by frame on the new axis
    if sprung_i is not None:
        for i in range(sprung_i, n):
            s_ = round(werte[2 * i] * (1 << 24)) - 1
            if s_ != round(werte[2 * sprung_i] * (1 << 24)) - 1 + (i - sprung_i):
                falsch += 1
        erstes_neu = round(werte[2 * sprung_i] * (1 << 24)) - 1
        if erstes_neu != (w0 + sprung_i) + 1000 + 10_000_000:
            fehler.append(f"first frame of the new axis carries {erstes_neu}, expected {(w0 + sprung_i) + 10_001_000}")
    if falsch:
        fehler.append(f"{falsch} frames carry a wrong value")
    luecke = [e for e in meta["ereignisse"] if e["art"] == "luecke"]
    luecke_frames = luecke[0]["frames"] if luecke else -1
    if still != luecke_frames or not (RATE <= still <= 2 * RATE + RATE // 2):
        fehler.append(f"silence {still} frames, gap noted {luecke_frames}")
    erwartet = 9 * RATE  # 3 + 2 + 2 + 2 s of real-time frames, the stalled 2 s are inside as silence
    print(json.dumps({"frames": n, "sekunden": n / RATE, "still": still, "luecke": luecke_frames, "sprung_bei": sprung_i,
                      "ereignisse": arten, "s0": s0, "erwartet_ca": erwartet, "fehler": fehler}, ensure_ascii=False))
    if abs(n - erwartet) > RATE // 2:
        fehler.append(f"length {n} frames, expected about {erwartet}")
    print("OK" if not fehler else "FAILED: " + "; ".join(fehler))
    return 0 if not fehler else 1


if __name__ == "__main__":
    sys.exit(main())
