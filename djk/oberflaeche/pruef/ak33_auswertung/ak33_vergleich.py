# Export (abgriff set) vs capture of the playback at the sink monitor (pw-record): align by cross-correlation, then residual level per block.
# Needs only numpy/scipy. usage: ak33_vergleich.py <export.wav> <capture.wav> [--json out.json]
import sys, json, numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve
def lies(p):
    sr, x = wavfile.read(p)
    x = x.astype(np.float64)
    if x.dtype != np.float64 or np.abs(x).max() > 4: x = x / 32768.0
    return sr, (x if x.ndim == 2 else np.stack([x, x], 1))
def db(x): return 20*np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12)
def vergleich(pe, pc):
    sr, e = lies(pe); sr2, a = lies(pc); assert sr == sr2 == 48000, (sr, sr2)
    em, am = e.mean(1), a.mean(1)
    # global lag: correlation of the first 10 s of the export against the capture
    ref = em[:min(len(em), 10*sr)]
    c = fftconvolve(am, ref[::-1], mode='full'); k = int(np.argmax(c)) - (len(ref)-1)
    lag = max(k, 0); seg = a[lag:lag+len(e)]; L = min(len(seg), len(e)); seg, ee = seg[:L], e[:L]
    g = float(np.dot(seg.ravel(), ee.ravel()) / np.dot(ee.ravel(), ee.ravel()))
    res = seg - ee
    out = dict(lag_samples=lag, lag_s=round(lag/sr, 4), compared_s=round(L/sr, 2), gain=round(g, 4), export_rms_db=round(db(ee), 1),
               residual_db=round(db(res), 1), residual_rel_db=round(db(res)-db(ee), 1))
    blk = 4800; rel = []; lagb = []
    for i in range(0, L-blk, blk):
        rel.append(db(res[i:i+blk]) - db(ee[i:i+blk]))
        # local lag by correlation of this block against the capture within +-20 ms (sub-block drift/shift detector)
        seg_e = em[i:i+blk]; cap = am[lag+i-960:lag+i+blk+960]
        if len(cap) == blk+1920 and np.std(seg_e) > 1e-6:
            cc = fftconvolve(cap, seg_e[::-1], mode='valid'); lagb.append(int(np.argmax(cc)) - 960)
    out.update(block_rel_median_db=round(float(np.median(rel)), 1), block_rel_worst_db=round(float(max(rel)), 1), block_worst_at_s=round(float(np.argmax(rel)*0.1), 1),
               block_lag_samples_min=(min(lagb) if lagb else None), block_lag_samples_max=(max(lagb) if lagb else None))
    return out
if __name__ == '__main__':
    r = vergleich(sys.argv[1], sys.argv[2]); print(json.dumps(r))
    if '--json' in sys.argv: json.dump(r, open(sys.argv[sys.argv.index('--json')+1], 'w'), indent=1)
