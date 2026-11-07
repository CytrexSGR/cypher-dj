#!/usr/bin/env python3
"""Put the master recording under the OBS video (djk-demo zusammen).

The OBS file carries its own copy of the master (JACK capture of the kern ports) with an unknown start offset against the
set recording (cypherdj-setmitschnitt, master.wav plus master.wav.json). The offset is found by cross-correlating both
signals (mono, 8 kHz, a window of the OBS audio searched in the WAV around the wall-clock estimate), then ffmpeg copies
the video and replaces the audio with the master WAV, shifted by that offset, as AAC 320 kbit/s.

Usage: demo_zusammen.py <obs video> <master.wav> <out.mp4> [--fenster S] [--suche S]
Prints one JSON line: offset in samples and seconds, correlation peak, ratio to the second peak (a sure match is > 3).
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

R = 8000


def lies(pfad, ab_s, dauer_s):
    roh = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, ab_s):.3f}", "-t", f"{dauer_s:.3f}", "-i", pfad,
                          "-map", "a:0", "-ac", "1", "-ar", str(R), "-f", "f32le", "-"], check=True,
                         capture_output=True).stdout
    return np.frombuffer(roh, dtype=np.float32)


def dauer(pfad):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", pfad],
                       check=True, capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:   # an OBS mkv may carry no duration in its header: take the last audio packet
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0",
                            pfad], check=True, capture_output=True, text=True)
        z = [x for x in r.stdout.split() if x and x != "N/A"]
        return float(z[-1]) if z else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("wav")
    ap.add_argument("aus")
    ap.add_argument("--fenster", type=float, default=30.0)
    ap.add_argument("--suche", type=float, default=None, help="search radius in s; default 0.25 around the wall-clock estimate, 20 without one")
    a = ap.parse_args()
    meta = json.load(open(a.wav + ".json")) if os.path.exists(a.wav + ".json") else {}
    # wall-clock estimate: OBS records the mtime-independent start in the file name only, so take the creation as
    # given by the caller's demo.json if there is one beside the WAV
    demo = os.path.join(os.path.dirname(a.wav), "demo.json")
    schaetz = 0.0
    if os.path.exists(demo) and meta.get("start_unix_ns"):
        d = json.load(open(demo))
        if d.get("obs_start_unix_ns"):
            schaetz = (d["obs_start_unix_ns"] - meta["start_unix_ns"]) / 1e9   # OBS starts this many seconds after the WAV
    if a.suche is None:   # a repetitive beat has a second peak one beat away: search only near the wall-clock estimate
        a.suche = 0.25 if schaetz != 0.0 else 20.0
    v_dauer = dauer(a.video)
    fenster = min(a.fenster, max(2.0, v_dauer - 2.0))
    v_ab = min(5.0, max(0.0, v_dauer - fenster - 1.0))
    v = lies(a.video, v_ab, fenster)
    w_ab = schaetz + v_ab - a.suche
    w = lies(a.wav, w_ab, fenster + 2 * a.suche)
    w_ab = max(0.0, w_ab)
    if len(v) < R or len(w) < len(v) or float(np.max(np.abs(v))) < 1e-4:
        print(json.dumps({"fehler": "zu_wenig_signal", "video_s": len(v) / R, "wav_s": len(w) / R}))
        return 1
    n = 1
    while n < len(w) + len(v):
        n *= 2
    k = np.fft.irfft(np.fft.rfft(w, n) * np.conj(np.fft.rfft(v, n)), n)[: len(w) - len(v) + 1]
    # normalise by the energy of each WAV window, so a loud passage does not win by level alone
    c = np.concatenate([[0.0], np.cumsum(w.astype(np.float64) ** 2)])
    e = np.sqrt(np.maximum(c[len(v):] - c[: len(w) - len(v) + 1], 1e-12)) * np.sqrt(float(np.sum(v.astype(np.float64) ** 2)))
    k = k / e
    i = int(np.argmax(k))
    spitze = float(k[i])
    maske = np.ones_like(k, dtype=bool)
    maske[max(0, i - R // 20): i + R // 20] = False
    zweite = float(np.max(k[maske])) if maske.any() else 0.0
    # the OBS sample at v_ab sits at WAV time w_ab + i / R: the WAV starts (w_ab + i/R - v_ab) seconds before the video
    versatz_s = w_ab + i / R - v_ab
    ergebnis = {"versatz_s": round(versatz_s, 4), "versatz_samples_48k": round(versatz_s * 48000), "korrelation": round(spitze, 3),
                "abstand_zweite": round(spitze / zweite, 2) if zweite > 0 else None, "schaetzung_s": round(schaetz, 3)}
    if spitze < 0.5:
        ergebnis["fehler"] = "keine_sichere_deckung"
        print(json.dumps(ergebnis))
        return 1
    if versatz_s >= 0:
        audio = ["-ss", f"{versatz_s:.4f}", "-i", a.wav]
        filt = []
    else:
        audio = ["-i", a.wav]
        ms = round(-versatz_s * 1000)
        filt = ["-af", f"adelay={ms}|{ms}"]
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a.video, *audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                    *filt, "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", a.aus], check=True)
    ergebnis["datei"] = a.aus
    print(json.dumps(ergebnis))
    return 0


if __name__ == "__main__":
    sys.exit(main())
