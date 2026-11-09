# AK33 G2: where does a slip of the playback capture live? Compares the offline export (abgriff "set", the reference) with up to three taps of the SAME playback:
#   --ring     the kern's own master ring, read by cypherdj-mitschnitt (raw f32 stereo; no PipeWire in between, i.e. what the kern wrote),
#   --capture  pw-record on the sink monitor (one or more files; the first is the one ak33_playback.mjs always records).
# Per tap: global alignment (the lag with the most bit-equal frames in the first seconds), then the local lag per 0.2 s block against the reference. A slip is a change of
# the local lag; the first bit mismatch frame and the number of bit-equal frames are reported too.
# Verdict: ring clean + capture(s) slipped -> not the core output (the slip is added behind the kern: PipeWire graph / sink / pw-record);
#          both captures slip at the same place -> shared graph or sink path; only one -> that pw-record process;
#          ring slipped -> the core wrote a different stream (drop/duplicate in the core).
# usage: ak33_source.py --export E.wav [--ring R.f32] --capture C1.wav [C2.wav ...] [--json out.json]
import sys, json, argparse, warnings
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve

warnings.filterwarnings('ignore')
SR = 48000
BLOCK = 9600      # 0.2 s
SUCH = 2560       # local search +-2560 frames (10 quanta)
SEG = 24000       # 0.5 s segment for the global alignment


def lies_wav(p):
    sr, x = wavfile.read(p)
    assert sr == SR, sr
    x = x.astype(np.float32)
    return x if x.ndim == 2 else np.stack([x, x], 1)


def lies_f32(p):
    x = np.fromfile(p, dtype=np.float32)
    return x[: len(x) // 2 * 2].reshape(-1, 2)


def global_lag(ref, cap):
    """Frames of cap before ref starts. A short audible segment from the START of the span (a slip later in the span cannot spoil it; an early slip made the old
    first-5-second correlation lock on a later, louder repeat) is looked up in the first 4 s of cap by NORMALISED correlation; among the best candidates the one with the
    most bit-equal frames wins."""
    m = ref.mean(1, dtype=np.float64); a = cap.mean(1, dtype=np.float64)   # float64: the cumulative energy below loses its precision in float32
    i0 = 0
    while i0 + SEG < min(len(m), 4 * SR) and np.std(m[i0:i0 + SEG]) < 1e-3:
        i0 += SEG // 2
    seg_ref = m[i0:i0 + SEG]
    w = a[: 5 * SR + i0 + SEG]
    c = fftconvolve(w, seg_ref[::-1], mode='valid')
    cs = np.concatenate([[0.0], np.cumsum(w * w)])
    en = cs[SEG:SEG + len(c)] - cs[:len(c)]
    ncc = c / np.sqrt(en * float(np.dot(seg_ref, seg_ref)) + 1e-12)
    cand, cc = [], ncc.copy()
    for _ in range(8):
        k = int(np.argmax(cc)); cand.append(k); cc[max(0, k - 300):k + 300] = -1e30
    best = None
    for k in cand:
        seg = cap[k:k + SEG]
        n = int(np.sum(np.all(seg == ref[i0:i0 + len(seg)], axis=1)))
        if best is None or n > best[0]:
            best = (n, k - i0)
    return best[1], best[0], SEG


def vergleich(ref, cap, name):
    lag, n_equal_start, n_start = global_lag(ref, cap)
    L = min(len(ref), len(cap) - lag)
    seg = cap[lag:lag + L]
    gleich = np.all(seg == ref[:L], axis=1)
    ungleich = np.flatnonzero(~gleich)
    erst = int(ungleich[0]) if len(ungleich) else None
    em, am = ref.mean(1), cap.mean(1)
    serie, events, prev, komp = [], [], 0, 0
    for i in range(0, L - BLOCK, BLOCK):
        b = em[i:i + BLOCK]
        lo = lag + i - SUCH
        if lo < 0 or lag + i + BLOCK + SUCH > len(am) or np.std(b) < 1e-5:
            serie.append(None); continue
        w = am[lo:lag + i + BLOCK + SUCH]
        cc = fftconvolve(w, b[::-1], mode='valid')
        d = int(np.argmax(cc)) - SUCH
        serie.append(d)
        j = lag + i + d
        if j >= 0 and j + BLOCK <= len(cap): komp += int(np.sum(np.all(cap[j:j + BLOCK] == ref[i:i + BLOCK], axis=1)))
        if d != prev:
            events.append(dict(block_start_s=round(i / SR, 3), von=prev, nach=d))
            prev = d
    gueltig = [d for d in serie if d is not None]
    return dict(name=name, lag=lag, frames_ref=len(ref), frames_compared=L,
                bit_equal_frames=int(gleich.sum()), bit_identical=bool(len(ungleich) == 0 and L == len(ref)), bit_equal_at_local_lag=komp,
                first_mismatch_frame=erst, first_mismatch_s=(round(erst / SR, 4) if erst is not None else None),
                slips=events, final_local_lag=(gueltig[-1] if gueltig else None), local_lag_min=(min(gueltig) if gueltig else None),
                local_lag_max=(max(gueltig) if gueltig else None), slipped=bool(events))


def urteil(ring, caps, orte=None):
    """orte: where each capture file was written while recording ('ordner' = output folder on disk, 'shm' = tmpfs), same order as caps; None = unknown."""
    sl = lambda r: r is not None and r['slipped']
    if ring is None:
        return 'NO RING TAP: the source cannot be separated (kern vs pw)'
    if sl(ring):
        return 'CORE: the kern ring itself differs from the export (slip in the stream the core wrote)'
    if not any(sl(c) for c in caps):
        return 'CLEAN: ring and all captures bit-equal (up to the slip detector, see bit_equal_frames)'
    orte = orte or ['?'] * len(caps)
    slipped = [i for i, c in enumerate(caps) if sl(c)]
    sauber = [i for i, c in enumerate(caps) if not sl(c)]
    if len(caps) > 1 and not sauber:
        ts = [[e['block_start_s'] for e in caps[i]['slips']] for i in slipped]
        same = all(any(abs(a - b) <= 0.4 for b in ts[0]) for t in ts[1:] for a in t)
        return ('SHARED PATH: ring clean, every pw capture slips' + (' at the same place' if same else ' (at different places)') +
                ' -> added behind the kern (PipeWire graph or sink), not the core output stream')
    if len(caps) > 1:
        gs = {orte[i] for i in slipped}
        if len(gs) == 1 and '?' not in gs and not any(orte[i] in gs for i in sauber) and any(orte[i] != next(iter(gs)) for i in sauber):
            return (f'CAPTURE FILE WRITE ({next(iter(gs))}): ring clean, every capture written to {next(iter(gs))} slips, the other location(s) are clean although they record the same '
                    'monitor -> a stall of the recorder while writing its file, not the core and not the sink')
        return 'ONE pw-record PROCESS: ring clean, only some captures slip (not explained by the file location) -> a single capture client, not the core and not the sink'
    return 'BEHIND THE KERN: ring clean, the (single) pw capture slips -> not the core output stream; pw-record or sink (add a second capture to split)'


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--export', required=True); ap.add_argument('--ring'); ap.add_argument('--capture', nargs='+', required=True); ap.add_argument('--json'); ap.add_argument('--orte', help='comma list: where each capture was written (ordner|shm), same order as --capture')
    a = ap.parse_args()
    ref = lies_wav(a.export)
    ring = vergleich(ref, lies_f32(a.ring), 'ring') if a.ring else None
    caps = [vergleich(ref, lies_wav(p), f'capture{i + 1}') for i, p in enumerate(a.capture)]
    out = dict(ring=ring, captures=caps, verdict=urteil(ring, caps, a.orte.split(',') if a.orte else None))
    print(json.dumps(out))
    if a.json:
        json.dump(out, open(a.json, 'w'), indent=1)
