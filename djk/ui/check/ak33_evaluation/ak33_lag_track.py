# lag trace: per 1 s window of the export, the lag (capture index minus export index) with the highest normalised correlation, searched +-1500 samples around the first window's lag.
import sys, json, numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve
def spur(ordner, name, fenster=1.0, such=1500):
    sr, e = wavfile.read(f'{ordner}/{name}-export.wav'); sr, a = wavfile.read(f'{ordner}/{name}-capture.wav'); E = e.astype(float).mean(1); A = a.astype(float).mean(1)
    # coarse start lag: whole first 4 s, wide window
    ref = E[:4*sr]; c = fftconvolve(A[:30*sr], ref[::-1], 'valid'); l0 = int(np.argmax(c))
    out = []; prev = l0
    for t in np.arange(0, len(E)/sr - fenster, fenster):
        s = int(t*sr); seg = E[s:s+int(fenster*sr)]
        if np.sqrt(np.mean(seg**2)) < 1e-4: out.append((round(t,1), None, None)); continue
        lo = s + prev - such; w = A[lo:lo+len(seg)+2*such]
        c = fftconvolve(w, seg[::-1], 'valid'); i = int(np.argmax(c)); l = prev - such + i
        nrm = np.sqrt(np.sum(seg**2)*np.sum(A[s+l:s+l+len(seg)]**2)); out.append((round(t,1), l, round(float(c[i]/nrm),4))); prev = l
    return out
if __name__ == '__main__':
    for n in sys.argv[2:]:
        r = spur(sys.argv[1], n); roh = json.load(open(f'{sys.argv[1]}/{n}.json')); w = [c['t_ms']/1000 for c in roh.get('aenderungen', [])]
        lags = [l for _, l, _ in r if l is not None]
        sprung = [(t, l) for (t, l, _), (t2, l2, _) in zip(r[1:], r) if l is not None and l2 is not None and l != l2]
        print(n, 'lags min/max', min(lags), max(lags), 'jumps', sprung, 'changes at', [round(x,2) for x in w][:8], 'min corr', min(c for _,_,c in r if c))
