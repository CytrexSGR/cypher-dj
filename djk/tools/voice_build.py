#!/usr/bin/env python3
"""voice_build.py: turn voice phrase WAVs into one slotted stereo loop in the loop library.

Usage: voice_build.py <wav>... --stil roh|fluester --name N --loops DIR [--takte n] [--bpm b] [--notiz text]
One input file = one phrase = one slot of n bars. No TTS here: input is WAV files only.
Prints one JSON line {name, ordner, beats, frames, phrasen}."""
import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

RATE = 48000
NAME_RE = re.compile(r"[a-z0-9_-]{1,32}")   # the loop name becomes a folder name: no path parts, no case

WHISPER = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
           "silenceremove=start_periods=1:start_threshold=-45dB,areverse,aresample=48000,asplit[a][b];"
           "[a]afftfilt=real='hypot(re,im)*cos(random(0)*6.2832)':imag='hypot(re,im)*sin(random(1)*6.2832)'"
           ":win_size=512:overlap=0.75[w];[b]volume=0.22[d];"
           "[w][d]amix=inputs=2:normalize=0,highpass=f=350,lowpass=f=9500,"
           "aecho=0.8:0.5:60|140:0.25|0.15,acompressor=threshold=-20dB:ratio=3,loudnorm=I=-18:TP=-2,aresample=48000")
RAW = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
       "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
       "highpass=f=80,loudnorm=I=-16:TP=-2,aresample=48000")


def chain(stil: str, slot: int) -> str:
    tail = f"apad=whole_len={slot},atrim=end_sample={slot},afade=t=out:st={slot / RATE - 0.03}:d=0.03"
    if stil == "fluester":
        return f"{WHISPER},{tail}"
    return f"{RAW},{tail}"


def phrase(datei: Path, stil: str, slot: int) -> bytes:
    """One phrase as stereo f32le, exactly slot frames."""
    f = chain(stil, slot)
    if stil == "fluester":
        f = f"[0:a]{f}"
    f += ",aformat=channel_layouts=stereo[o]" if stil == "fluester" else ",aformat=channel_layouts=stereo"
    cmd = ["nice", "-n", "10", "ffmpeg", "-v", "error", "-nostdin", "-i", str(datei), "-filter_complex" if stil == "fluester" else "-af", f]
    if stil == "fluester":
        cmd += ["-map", "[o]"]
    cmd += ["-ar", str(RATE), "-ac", "2", "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"{datei}: ffmpeg failed: {r.stderr.decode()[-300:]}")
    if len(r.stdout) != slot * 8:
        raise RuntimeError(f"{datei}: got {len(r.stdout) // 8} frames, expected {slot}")
    return r.stdout


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dateien", nargs="+")
    ap.add_argument("--stil", choices=["roh", "fluester"], required=True)
    ap.add_argument("--takte", type=int, default=1)
    ap.add_argument("--bpm", type=float, default=128)
    ap.add_argument("--name", required=True)
    ap.add_argument("--loops", required=True)
    ap.add_argument("--notiz", default="")
    a = ap.parse_args(argv)
    if a.takte < 1 or a.bpm <= 0:
        print("takte must be >= 1 and bpm > 0", file=sys.stderr)
        return 2
    if not NAME_RE.fullmatch(a.name):
        print("name must match [a-z0-9_-]{1,32}", file=sys.stderr)
        return 2
    ziel = Path(a.loops) / a.name
    if ziel.exists():
        print(f"loop folder exists: {ziel}", file=sys.stderr)
        return 1
    slot = round(4 * a.takte * 60 / a.bpm * RATE)
    for d in a.dateien:
        if not Path(d).is_file():
            print(f"missing input: {d}", file=sys.stderr)
            return 1
    ziel.mkdir(parents=True)
    try:
        with open(ziel / "loop.f32", "wb") as out:
            for d in a.dateien:  # one phrase in memory at a time
                out.write(phrase(Path(d), a.stil, slot))
        n = len(a.dateien)
        meta = {"schema": 1, "name": a.name, "beats": 4 * a.takte * n, "bpm": a.bpm if a.bpm != int(a.bpm) else int(a.bpm),
                "frames": slot * n, "datei": "loop.f32", "quelle": "cypher",
                "erstellt": time.strftime("%Y-%m-%d %H:%M"), "notiz": a.notiz}
        (ziel / "loop.json").write_text(json.dumps(meta, indent=1))
    except BaseException as e:   # any failure, also an interrupt: no half-written loop folder stays behind
        shutil.rmtree(ziel, ignore_errors=True)
        if not isinstance(e, Exception):
            raise
        print(str(e), file=sys.stderr)
        return 1
    print(json.dumps({"name": a.name, "ordner": str(ziel), "beats": meta["beats"], "frames": meta["frames"], "phrasen": n}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
