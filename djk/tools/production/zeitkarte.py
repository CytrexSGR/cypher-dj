#!/usr/bin/env python3
"""Time map and mix check of an audio file (thin first version, 2026-11-10).

Measures a track over time instead of as one sum: per phrase (default 8 bars) loudness, band balance,
onset density, stereo width, low-end correlation, kick share (0..1: beats with a low-band onset) and how much changed against the phrase
before. A summary block carries the mix checks (true peak, PSR, crest, mono loss, DC, low-end mono).

Needs python3 with numpy and scipy, and ffmpeg on the path. Decodes everything to 48 kHz stereo float.

    zeitkarte.py FILE --bpm 134 [--eins SECONDS] [--takte 8] [--json OUT]

--eins is the time of a bar one in seconds. Without it the beat phase is estimated from the low band and
the phrase offset from where the sound changes most (good enough for references, not exact).
"""
import argparse
import json
import subprocess
import sys

import numpy as np
from scipy import signal

SR = 48000
BANDS = [("sub", 20, 60), ("bass", 60, 120), ("lowmid", 120, 400), ("mid", 400, 2000),
         ("pres", 2000, 5000), ("high", 5000, 10000), ("air", 10000, 20000)]


def decode(path):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def k_weight(x):
    """ITU-R BS.1770 K-weighting at 48 kHz."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def lufs(kx):
    ms = np.mean(kx ** 2, axis=0).sum()
    return -0.691 + 10 * np.log10(ms) if ms > 1e-12 else -120.0


def db(v):
    return 20 * np.log10(max(float(v), 1e-9))


def band_db(seg_mono, fft=8192):
    f, p = signal.welch(seg_mono, SR, nperseg=min(fft, len(seg_mono)))
    total = p.sum() + 1e-20
    return {n: round(10 * np.log10(p[(f >= lo) & (f < hi)].sum() / total + 1e-12), 1) for n, lo, hi in BANDS}


def low_env(mono, hop=512):
    sos = signal.butter(4, [35, 120], btype="band", fs=SR, output="sos")
    e = signal.sosfilt(sos, mono) ** 2
    n = len(e) // hop
    return np.log10(e[:n * hop].reshape(n, hop).mean(axis=1) + 1e-10)


def low_power(mono, hop=64):
    """Linear power of the low band (35 to 120 Hz) per hop; the basis of the kick measure."""
    sos = signal.butter(4, [35, 120], btype="band", fs=SR, output="sos")
    e = signal.sosfilt(sos, mono) ** 2
    n = len(e) // hop
    return e[:n * hop].reshape(n, hop).mean(axis=1)


def kick_share(pw, beat_times, hop=64, vor_s=0.12, nach_s=0.12, such_s=0.03, schwelle_db=6.0, min_db=-60.0):
    """Share (0..1) of the given beats that carry a kick: low-band power in the window after the beat is at least
    `schwelle_db` above the window before it, the beat searched within +-`such_s` (so a beat grid that is a few
    ms off or a hop rounding does not matter). Windows quieter than `min_db` (power, full scale) count as no kick.
    Bounded and without a divisor that can go to zero: the earlier ratio of onset means jumped between 0.6 and 20."""
    if len(beat_times) == 0:
        return 0.0
    vor, nach, such = int(vor_s * SR / hop), int(nach_s * SR / hop), int(such_s * SR / hop)
    csum = np.concatenate([[0.0], np.cumsum(pw)])

    def mean(a, b):
        a, b = max(a, 0), min(b, len(pw))
        return (csum[b] - csum[a]) / (b - a) if b > a else 0.0

    treffer = 0
    for t in beat_times:
        c = int(round(t * SR / hop))
        best = 0.0
        for d in range(-such, such + 1, max(1, such // 6)):
            p0, p1 = mean(c + d - vor, c + d), mean(c + d, c + d + nach)
            if 10 * np.log10(p1 + 1e-20) < min_db:
                continue
            best = max(best, p1 / (p0 + 1e-12))
        if best >= 10 ** (schwelle_db / 10):
            treffer += 1
    return treffer / len(beat_times)


def flux(mono, hop=512):
    f, t, s = signal.stft(mono, SR, nperseg=1024, noverlap=1024 - hop, padded=False, boundary=None)
    m = np.log1p(100 * np.abs(s))
    d = np.diff(m, axis=1)
    return np.maximum(d, 0).sum(axis=0)


def beat_phase(env, bpm, hop=512):
    on = np.maximum(np.diff(env), 0)
    period = 60.0 / bpm * SR / hop
    best, best_score = 0.0, -1.0
    for ph in np.arange(0, period, 0.5):
        idx = np.round(ph + period * np.arange(int((len(on) - ph) / period))).astype(int)
        idx = idx[idx < len(on)]
        score = on[idx].mean() if len(idx) else 0.0
        if score > best_score:
            best, best_score = ph, score
    return best * hop / SR


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--bpm", type=float, required=True)
    ap.add_argument("--eins", type=float, default=None)
    ap.add_argument("--takte", type=int, default=8)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    x = decode(a.file)
    mono = x.mean(axis=1)
    kx = k_weight(x)
    beat = 60.0 / a.bpm
    seg_s = beat * 4 * a.takte
    hop = 512
    env = low_env(mono, hop)
    pw = low_power(mono)
    fl = flux(mono, hop)
    thr = np.median(fl) + 1.5 * np.std(fl)
    peaks, _ = signal.find_peaks(fl, height=thr, distance=int(0.05 * SR / hop))

    eins = a.eins
    geschaetzt = eins is None
    if geschaetzt:
        ph = beat_phase(env, a.bpm, hop)
        # phrase offset: the beat offset at which neighbouring phrases differ most
        nb = int((len(mono) / SR - ph) / beat)
        feat = np.array([env[int((ph + i * beat) * SR / hop):int((ph + (i + 1) * beat) * SR / hop)].mean()
                         for i in range(nb)])
        per = 4 * a.takte
        best, best_score = 0, -1.0
        for off in range(per):
            m = [feat[i:i + per].mean() for i in range(off, nb - per + 1, per)]
            score = float(np.abs(np.diff(m)).sum()) if len(m) > 1 else 0.0
            if score > best_score:
                best, best_score = off, score
        eins = ph + best * beat

    low_sos = signal.butter(4, 120, btype="low", fs=SR, output="sos")
    xl = signal.sosfilt(low_sos, x, axis=0)
    rows, prev = [], None
    start = eins % seg_s if geschaetzt else eins
    k = 0
    while start + seg_s <= len(mono) / SR + 0.01:
        i0, i1 = int(start * SR), min(int((start + seg_s) * SR), len(mono))
        seg, segk, segl = x[i0:i1], kx[i0:i1], xl[i0:i1]
        mid, side = seg.mean(axis=1), (seg[:, 0] - seg[:, 1]) / 2
        b = band_db(mid)
        h0, h1 = i0 // hop, i1 // hop
        dichte = float(((peaks >= h0) & (peaks < h1)).sum()) / a.takte
        # kick presence: share of the beats of this phrase that carry a low-band onset (0..1)
        bt = start + ((eins - start) % beat) + beat * np.arange(4 * a.takte)
        bt = bt[bt < start + seg_s - 0.15]
        kick = kick_share(pw, bt)
        cl = np.corrcoef(segl[:, 0], segl[:, 1])[0, 1] if segl[:, 0].std() > 1e-7 and segl[:, 1].std() > 1e-7 else 1.0
        row = {"nr": k + 1, "takt": int(round((start - eins) / (beat * 4))) + 1, "t_s": round(start, 2),
               "lufs": round(lufs(segk), 1), "spitze_db": round(db(np.abs(seg).max()), 1), **b,
               "anschlaege_je_takt": round(dichte, 1), "kick": round(kick, 2),
               "breite_db": round(db(np.sqrt((side ** 2).mean())) - db(np.sqrt((mid ** 2).mean())), 1),
               "tief_korr": round(float(cl), 2)}
        vec = np.array([row["lufs"]] + [b[n] for n, _, _ in BANDS] + [dichte])
        row["wechsel"] = None if prev is None else round(float(np.abs(vec - prev).sum()), 1)
        prev = vec
        rows.append(row)
        start += seg_s
        k += 1

    # summary and mix checks
    st = int(3 * SR)
    psr = []
    for i in range(0, len(x) - st, st):
        l = lufs(kx[i:i + st])
        if l > -50:
            psr.append(db(np.abs(x[i:i + st]).max()) - l)
    blocks = [lufs(kx[i:i + int(0.4 * SR)]) for i in range(0, len(x) - int(0.4 * SR), int(0.1 * SR))]
    blocks = np.array([v for v in blocks if v > -70])
    integ = -120.0
    if len(blocks):
        gate = 10 * np.log10(np.mean(10 ** (blocks / 10))) - 10
        sel = blocks[blocks > gate]
        integ = float(10 * np.log10(np.mean(10 ** (sel / 10)))) if len(sel) else -120.0
    tp = db(np.abs(signal.resample_poly(x, 4, 1, axis=0)).max())
    rms = db(np.sqrt((x ** 2).mean()))
    monok = k_weight(np.stack([mono, mono], axis=1))
    cl_all = float(np.corrcoef(xl[:, 0], xl[:, 1])[0, 1]) if xl[:, 0].std() > 1e-7 and xl[:, 1].std() > 1e-7 else 1.0
    summe = {"datei": a.file, "bpm": a.bpm, "eins_s": round(eins, 3), "eins_geschaetzt": geschaetzt,
             "dauer_s": round(len(x) / SR, 1), "lufs_i": round(integ, 1), "true_peak_dbtp": round(tp, 2),
             "spitze_db": round(db(np.abs(x).max()), 2), "crest_db": round(db(np.abs(x).max()) - rms, 1),
             "psr_median": round(float(np.median(psr)), 1) if psr else None,
             "mono_verlust_lu": round(lufs(monok) - lufs(kx), 1), "tief_korr": round(cl_all, 2),
             "dc": round(float(np.abs(x.mean(axis=0)).max()), 5), "baender": band_db(mono),
             "ende_spitze_db": round(db(np.abs(x[-int(0.05 * SR):]).max()), 1)}
    out = {"summe": summe, "phrasen": rows}
    if a.json:
        with open(a.json, "w") as f:
            json.dump(out, f, indent=1)
    names = [n for n, _, _ in BANDS]
    print(json.dumps(summe))
    print("nr takt  lufs  " + " ".join(f"{n:>6}" for n in names) + "  an/T kick breite tkorr wechsel")
    for r in rows:
        print(f"{r['nr']:>2} {r['takt']:>4} {r['lufs']:>5} " + " ".join(f"{r[n]:>6}" for n in names) +
              f" {r['anschlaege_je_takt']:>5} {r['kick']:>4} {r['breite_db']:>6} {r['tief_korr']:>5} {r['wechsel']}")


if __name__ == "__main__":
    sys.exit(main())
