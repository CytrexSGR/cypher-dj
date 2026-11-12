"""Notes from a separated stem (audio to MIDI), decision 8 and 18 of the Live modules plan.

Only for stems, never for a full mix. The WAV is exactly one loop: beat 0 = sample 0, tempo = len / beats.

  drums(wav, beats) -> notes   onsets in three bands (fa.onsets_band), 36 kick / 39 clap / 42 closed hat
  bass(wav, beats)  -> notes   onsets (fa.onsets_band, 30-400 Hz) + Essentia PitchYin per segment

Note: {"beat": float (multiple of 0.25), "laenge": float (beats, >= 0.25), "ton": int (MIDI), "vel": int 1..127}.
Same field names as `Note` in djk/ui/project/model.ts (without `id`, the server assigns it).
Thresholds (bands, boden, delta, smoothing, delay compensation) were tuned on 2026-11-12 against 8 real Suno stems with their MIDI;
report and raw data: ~/messungen/2026-11-12-live-module/suno-ref/bericht.md.
Velocity comes from the onset strength, relative to the strongest onset of the same band.

Command line (the server starts it as a child process, low priority):
  nice -n 19 python -m werkstatt.midi_off_stem drums|bass <wav> <beats>
stdout: {"noten": [...]}; on error exit code != 0 and {"fehler": "<code>"}.
Silent or empty stem: empty list, no error.
"""
import json
import sys

import numpy as np

from werkstatt import fa

DRUM_TON = {"tief": 36, "mitte": 39, "hoch": 42}
DRUM_BAENDER = [("tief", 30, 250), ("mitte", 800, 3000), ("hoch", 3000, 16000)]
# per band: boden = onsets below this fraction of the band's strongest onset are leakage from other bands or tails, not hits;
# delta = adaptive threshold (mean + delta * sd), min_abstand_s, glatt_ms = envelope smoothing (see fa.onsets_band)
# versatz_s = detector delay compensation: seconds added to the onset time before it is put on the 1/16 grid (negative = earlier)
DRUM_PARAM = {
    "tief": {"boden": 0.7, "delta": 1.5, "min_abstand_s": 0.05, "glatt_ms": 10, "versatz_s": 0.0},
    "mitte": {"boden": 0.25, "delta": 3.0, "min_abstand_s": 0.05, "glatt_ms": 10, "versatz_s": 0.0},
    "hoch": {"boden": 0.25, "delta": 3.0, "min_abstand_s": 0.05, "glatt_ms": 10, "versatz_s": 0.0},
}
BASS_BAND = (30, 400)
BASS_GLATT_MS = 30   # longer smoothing than drums: a sawtooth envelope ripples at the fundamental (18 ms at 55 Hz) and gave false onsets
BASS_MIN_ABSTAND = 0.08
BASS_DELTA = 1.5
BASS_VERSATZ_S = -0.045  # like versatz_s of the drums (the 30 ms smoothing delays the bass onsets)
BASS_YIN_TOL = 0.15
BASS_YIN_KONF = 0.5
SCHRITT = 0.25


def _lade_mono(wav):
    return fa.lade(wav).mean(axis=1)


def _raster(t_s, beats, n_samples):
    """Seconds -> beat on the 1/16 grid; the loop is cyclic, so 16.0 wraps to 0."""
    bpb = beats / (n_samples / fa.SR)          # beats per second
    return (np.round(t_s * bpb / SCHRITT) * SCHRITT) % beats


def _vel(st):
    if len(st) == 0:
        return np.array([], dtype=int)
    rel = np.sqrt(np.asarray(st) / max(float(np.max(st)), 1e-12))
    return np.clip(np.round(127 * rel), 1, 127).astype(int)


def _leise(x):
    return len(x) == 0 or float(np.max(np.abs(x))) < 1e-4


def drums(wav, beats):
    return drums_x(_lade_mono(wav), beats)


def drums_x(x, beats):
    """drums() on an already loaded mono signal (48 kHz); the measurement scripts use it on cut-out loops."""
    if _leise(x):
        return []
    baender = {}
    for name, lo, hi in DRUM_BAENDER:
        pr = DRUM_PARAM[name]
        res = fa.onsets_band(x, lo, hi, min_abstand_s=pr["min_abstand_s"], delta=pr["delta"], glatt_ms=pr["glatt_ms"], mit_staerke=True)
        if not isinstance(res, tuple):
            continue
        t, st = np.asarray(res[0]), np.asarray(res[1])
        gut = st >= pr["boden"] * np.max(st)
        baender[name] = (t[gut], st[gut])
    noten = {}
    for name, (t, st) in baender.items():
        for b, v in zip(_raster(t + DRUM_PARAM[name]["versatz_s"], beats, len(x)), _vel(st)):
            k = (float(b), DRUM_TON[name])
            noten[k] = max(noten.get(k, 0), int(v))      # two hits on one step in a band: keep the louder
    return [{"beat": b, "laenge": SCHRITT, "ton": ton, "vel": v} for (b, ton), v in sorted(noten.items())]


def _tonhoehe(seg):
    """MIDI pitch of a segment: median over confident YIN frames, None if unvoiced."""
    import essentia.standard as es
    seg = seg.astype(np.float32)
    rahmen = 4096
    if len(seg) < rahmen:
        seg = np.pad(seg, (0, rahmen - len(seg)))
    yin = es.PitchYin(frameSize=rahmen, sampleRate=fa.SR, minFrequency=30, maxFrequency=500, tolerance=BASS_YIN_TOL)
    f, c = [], []
    for fr in es.FrameGenerator(seg, frameSize=rahmen, hopSize=1024, startFromZero=True):
        p, conf = yin(fr)
        if p > 0 and conf > BASS_YIN_KONF:
            f.append(p); c.append(conf)
    if not f:
        return None
    return int(round(69 + 12 * np.log2(np.median(f) / 440.0)))


def bass(wav, beats):
    return bass_x(_lade_mono(wav), beats)


def bass_x(x, beats):
    if _leise(x):
        return []
    res = fa.onsets_band(x, *BASS_BAND, min_abstand_s=BASS_MIN_ABSTAND, delta=BASS_DELTA, glatt_ms=BASS_GLATT_MS, mit_staerke=True)
    if not isinstance(res, tuple):
        return []
    t, st = res
    t = np.asarray(t); vel = _vel(st)
    n = len(x)
    spb = n / beats                                           # samples per beat
    s0 = np.round(t * fa.SR).astype(int)
    # envelope for the note end (5 ms boxcar of |x|)
    w = int(0.005 * fa.SR)
    env = np.convolve(np.abs(x), np.ones(w) / w, "same")
    noten = {}
    for i, s in enumerate(s0):
        nxt = s0[i + 1] if i + 1 < len(s0) else n
        # pitch from the stable part: skip 30 ms attack, stop 10 ms before the next onset
        a, b = s + int(0.03 * fa.SR), max(s + int(0.03 * fa.SR) + 1, nxt - int(0.01 * fa.SR))
        ton = _tonhoehe(x[a:b])
        if ton is None:
            continue
        bis = max(s + 1, nxt - int(0.03 * fa.SR))        # the next attack already lifts the envelope shortly before its onset time
        pk = env[s:bis].max()
        lebt = np.flatnonzero(env[s:bis] > 0.1 * pk)
        ende = s + (int(lebt[-1]) + 1 if len(lebt) else 1)
        # the note sounds until the signal dies or the next onset, rounded to the grid
        lg = max(SCHRITT, round((ende - s) / spb / SCHRITT) * SCHRITT)
        lg = min(lg, max(SCHRITT, round((nxt - s) / spb / SCHRITT) * SCHRITT))
        beat = float(_raster(np.array([t[i] + BASS_VERSATZ_S]), beats, n)[0])
        noten[beat] = {"beat": beat, "laenge": float(lg), "ton": ton, "vel": int(vel[i])}
    return [noten[k] for k in sorted(noten)]


def main(argv):
    try:
        art, wav, beats = argv[1], argv[2], float(argv[3])
        if art not in ("drums", "bass") or beats <= 0:
            raise ValueError("argument")
        noten = (drums if art == "drums" else bass)(wav, beats)
        print(json.dumps({"noten": noten}))
        return 0
    except IndexError:
        code = "argumente"
    except ValueError:
        code = "argumente"
    except FileNotFoundError:
        code = "datei"
    except Exception as e:                                    # any decoding or analysis failure
        code = "lauf:" + type(e).__name__
    print(json.dumps({"fehler": code}))
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
