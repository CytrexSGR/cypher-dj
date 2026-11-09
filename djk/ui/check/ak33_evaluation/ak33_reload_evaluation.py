# Per-reload evaluation: capture (pw-record of the sink monitor) against the export (abgriff set) of the same project, residual per 10 ms block,
# events = runs of blocks above LIMIT dB relative to the block level, each attributed to the nearest project change (time axis of the capture).
import sys, json, numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve
LIMIT = -50.0
LAG_SUCHE = (38000, 44500)   # None = global peak of the first 10 s
def lies(p):
    sr, x = wavfile.read(p); return sr, x.astype(float)
def auswerte(name, ordner):
    sr, e = lies(f'{ordner}/{name}-export.wav'); sr, a = lies(f'{ordner}/{name}-capture.wav'); roh = json.load(open(f'{ordner}/{name}.json'))
    ref = e[:10*sr].mean(1); c = fftconvolve(a.mean(1), ref[::-1], mode='full'); lag = max(int(np.argmax(c)) - (len(ref)-1), 0)
    # periodic loops make the global correlation peak ambiguous (multiples of a beat); the capture offset of this setup is 41069 +-3000 samples in every clean run: search there, over the whole export
    if LAG_SUCHE:
        ref2 = e.mean(1); lo, hi = LAG_SUCHE; a1 = a.mean(1)[lo:hi+len(ref2)]
        c2 = fftconvolve(a1, ref2[::-1], mode='valid'); lag = lo + int(np.argmax(c2))
    seg = a[lag:lag+len(e)]; L = min(len(seg), len(e)); seg, e = seg[:L], e[:L]; res = seg - e
    blk = 480; rel = []
    for i in range(0, L-blk, blk):
        pe = np.sqrt(np.mean(e[i:i+blk]**2)); rel.append(20*np.log10(np.sqrt(np.mean(res[i:i+blk]**2)) + 1e-12) - 20*np.log10(pe + 1e-12))
    rel = np.array(rel); bad = np.where(rel > LIMIT)[0]
    ev = []
    for b in bad:
        if ev and b - ev[-1][-1] <= 3: ev[-1].append(b)
        else: ev.append([b])
    # transport start at wall time t0; the capture starts 0.8 s earlier; the first change times are wall times relative to t0, the audio of the transport starts at index `lag`
    wech = [c['t_ms']/1000 for c in roh.get('aenderungen', [])]
    out = dict(name=name, lag_samples=lag, residual_rel_db_total=round(float(20*np.log10(np.sqrt(np.mean(res**2))+1e-12) - 20*np.log10(np.sqrt(np.mean(e**2))+1e-12)), 1),
               aenderungen=len(wech), events=[])
    for g in ev:
        t0 = g[0]*0.01; t1 = (g[-1]+1)*0.01; worst = float(rel[g].max())
        nah = min(wech, key=lambda w: abs(w - t0)) if wech else None
        out['events'].append(dict(von_s=round(t0, 2), bis_s=round(t1, 2), worst_db=round(worst, 1), naechste_aenderung_s=nah, abstand_s=None if nah is None else round(t0 - nah, 2)))
    out['n_events'] = len(ev); out['worst_db'] = round(float(rel.max()), 1)
    return out
if __name__ == '__main__':
    for n in sys.argv[2:]: print(json.dumps(auswerte(n, sys.argv[1])))
