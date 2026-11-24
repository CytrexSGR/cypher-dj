"""Fixture music of the J1 tour: two mixable tracks rendered from the starter demo project.

Track one is the demo at 124 bpm in A minor, track two the demo at 128 bpm transposed up a fifth (E minor). Both get a kick on every
beat (the demo's break has none) so that a beat analysis has something to find. The 32 bar demo is rendered offline through
`djk/starter/render_project.ts` and repeated to whole bars: 96 bars (about 3 minutes), or 48 bars (about 90 seconds) when `kurz`.
The file names carry no tempo or key on purpose: the analysis must find both in the audio, not in the name.

Two things make the mix measurable afterwards. Track two starts with 0.37 s of silence before its first kick, so the beat grid of the
file is not its first sample and only a real analysis plus a real SYNC can put its kicks on the grid of track one. Each track carries
a quiet marker tone in the low band (below the 246 Hz crossover of the channel EQ), at its own pitch: 100.0 Hz in track one, 149.8 Hz
(a fifth above) in track two. Both lie between two notes of the scale (about 35 cents above G2 and D3), so no note of either track sits on a
marker and the other deck's music does not leak into its measurement. In a recording of both decks the marker tells which deck's bass is still there.

The library folder gets the two audio files and nothing else (the project file and the raw render go to a temporary folder).
"""
import copy
import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path

HIER = os.path.dirname(os.path.abspath(__file__))
DJK = os.path.normpath(os.path.join(HIER, "..", ".."))
DEMO = Path(DJK) / "starter" / "demo" / "project.json"
RENDER = Path(DJK) / "starter" / "render_project.ts"
RATE = 48000
DEMO_TAKTE = 32
DEMO_BEATS = DEMO_TAKTE * 4
KICK = 36
SPITZE_MAX = 0.9                 # the fixtures are scaled down to this peak when the render is louder
RENDER_FRIST_S = 900

# Amplitude of each marker tone (peak, before the final scaling). The key detection of the library hears the markers: with a marker in the file its
# confidence falls from 0.91 to about 0.53, and at some levels it names another key. Measured with the library's own detection on the 48 bar (kurz) and
# the 96 bar (lang) fixtures, level by level:
#   track one (8A):  0.05 to 0.07 right, 0.075 and 0.08 5A (kurz), 0.09 to 0.12 right
#   track two (9A):  0.05 to 0.075 right, 0.10 6A (both lengths)
# Track one's marker (100 Hz) is what the drop of deck 1 is read from, against what the other deck's program leaves in that bin after the swap
# (-61 dB): at 0.05 that is 12.2 dB, at 0.10 about 19. Track two's marker only has to stay below the level where its key breaks.
MARKER_PEGEL = {"Tour Track One.wav": 0.10, "Tour Track Two.wav": 0.06}

# name, tempo, semitones the melodic tracks are moved up, rendered key as Camelot, silence before the first kick in seconds, marker tone in Hz
TRACKS = (
    ("Tour Track One.wav", 124, 0, "8A", 0.0, 100.0),
    ("Tour Track Two.wav", 128, 7, "9A", 0.37, 100.0 * 2 ** (7 / 12)),
)


class MusikFehlt(RuntimeError):
    """A dependency of the fixture render is missing (node, the demo project, the core build)."""


def projekt(tempo, halbtoene):
    """The demo project at `tempo`, melodic tracks moved up by `halbtoene`, a kick on every beat of the drum track."""
    p = copy.deepcopy(json.loads(DEMO.read_text()))
    p["tempo_bpm"] = tempo
    naechste = int(p["naechste_noten_id"])
    for s in p["spuren"]:
        for clip in s["clips"]:
            noten = clip.get("noten") or []
            if s["nr"] == 1:
                da = {round(n["beat"]) for n in noten if n["ton"] == KICK and abs(n["beat"] - round(n["beat"])) < 1e-9}
                for b in range(DEMO_BEATS):
                    if b not in da:
                        noten.append({"beat": b, "id": f"n{naechste}", "laenge": 0.25, "ton": KICK, "vel": 112})
                        naechste += 1
                noten.sort(key=lambda n: n["beat"])
            elif halbtoene:
                for n in noten:
                    n["ton"] += halbtoene
    p["naechste_noten_id"] = naechste
    p["loop"] = {"an": True, "von_beat": 0, "bis_beat": DEMO_BEATS}
    return p


def _lies_wav(pfad):
    """Interleaved stereo float samples of a WAV the core wrote (float32 or 16 bit), as (numpy array [n, 2], rate)."""
    import numpy as np
    roh = Path(pfad).read_bytes()
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(pfad), "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(RATE), "-"],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"cannot decode {pfad}: {r.stderr.decode(errors='replace')[-200:]} ({len(roh)} bytes)")
    return np.frombuffer(r.stdout, dtype="<f4").reshape(-1, 2).astype("float64")


def _schreibe_wav(pfad, a):
    import numpy as np
    pcm = np.clip(np.round(a * 32767.0), -32767, 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def _rendere(proj, ziel, arbeit):
    """One offline render of the 32 bar project to `ziel` with the starter's proof tool; raises MusikFehlt or RuntimeError.
    `arbeit` is a scratch folder, never the library folder."""
    datei = Path(arbeit) / "projekt.json"
    datei.write_text(json.dumps(proj))
    r = subprocess.run(["nice", "-n", "19", "node", str(RENDER), "--projekt", str(datei), "--aus", str(ziel),
                        "--von-beat", "0", "--bis-beat", str(DEMO_BEATS)],
                       capture_output=True, text=True, timeout=RENDER_FRIST_S)
    if r.returncode == 3:
        raise MusikFehlt(f"cypherdj-render is missing: {r.stderr.strip()[-200:]}")
    if r.returncode != 0:
        raise RuntimeError(f"render_projekt failed (rc {r.returncode}): {(r.stderr or r.stdout).strip()[-300:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def erzeuge(ordner, kurz):
    """Renders the two fixture tracks into `ordner` (created) and returns their paths. `kurz`: 48 bars instead of 96.

    A file that is already there and has the length it should is kept: a repeated tour does not render again. Only the two audio files
    are written into `ordner`."""
    import numpy as np
    if not DEMO.is_file():
        raise MusikFehlt(f"demo project missing: {DEMO}")
    ordner = Path(ordner)
    ordner.mkdir(parents=True, exist_ok=True)
    takte = 48 if kurz else 96
    aus = []
    with tempfile.TemporaryDirectory(prefix="j1-musik-") as arbeit:
        for name, tempo, halbtoene, _camelot, vorlauf_s, marker_hz in TRACKS:
            ziel = ordner / name
            soll_s = takte * 4 * 60.0 / tempo + vorlauf_s
            if ziel.is_file():
                try:
                    with wave.open(str(ziel)) as w:
                        if abs(w.getnframes() / w.getframerate() - soll_s) < 0.01:
                            aus.append(ziel)
                            continue
                except (wave.Error, EOFError):
                    pass
            roh = Path(arbeit) / f"roh-{tempo}.wav"
            _rendere(projekt(tempo, halbtoene), roh, arbeit)
            a = _lies_wav(roh)
            roh.unlink()
            je_takt = RATE * 4 * 60.0 / tempo
            je_demo = int(round(je_takt * DEMO_TAKTE))
            a = a[:je_demo] if len(a) >= je_demo else np.vstack([a, np.zeros((je_demo - len(a), 2))])
            wiederholt = np.vstack([a] * (takte // DEMO_TAKTE + 1))
            a = wiederholt[:int(round(je_takt * takte))]
            n = len(a)
            ton = MARKER_PEGEL[name] * np.sin(2 * np.pi * marker_hz * np.arange(n) / RATE)
            a = a + ton[:, None]
            a = np.vstack([np.zeros((int(round(vorlauf_s * RATE)), 2)), a])
            spitze = float(np.abs(a).max())
            if spitze > SPITZE_MAX:
                a = a * (SPITZE_MAX / spitze)
            _schreibe_wav(ziel, a)
            aus.append(ziel)
    return aus


def fingerabdruck(kurz):
    """Short token of everything that shapes the fixtures (this file, short or long). The tour puts the tracks into a folder named with it: the
    library of a test instance keeps what it prepared by path and file name, so a changed fixture under an old folder name would be played from
    the old preparation."""
    import hashlib
    roh = Path(__file__).read_bytes() + (b"kurz" if kurz else b"lang") + DEMO.read_bytes()
    return hashlib.sha1(roh).hexdigest()[:8]


def sollwerte():
    """name -> (tempo, camelot) the fixtures were rendered with."""
    return {n: (t, c) for n, t, _h, c, _v, _m in TRACKS}


def vorlauf(name):
    """Seconds of silence before the first kick of the file `name`."""
    return {n: v for n, _t, _h, _c, v, _m in TRACKS}[name]


def marker(name):
    """The low marker tone of the file `name` in Hz."""
    return {n: m for n, _t, _h, _c, _v, m in TRACKS}[name]
