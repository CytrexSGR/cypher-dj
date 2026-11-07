# Kick onset of a SOURCE file against its own warp grid (marker list or t0 + period), same instrument everywhere:
# envelope of the band (2 ms RMS), folded modulo the beat period starting at t0, onset = position of the steepest rise in the window [-60, +120] ms around the grid line.
import sys, numpy as np, subprocess
from scipy.signal import butter, sosfilt
SR = 48000
def lies(p, a=None, b=None):
    cmd = ['ffmpeg','-v','error'] + (['-ss', str(a)] if a else []) + (['-t', str(b-a)] if b else []) + ['-i',p,'-ac','1','-ar',str(SR),'-f','f32le','-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True).stdout, np.float32).astype(np.float64)
def anstieg(x, t0, T, lo, hi, glatt_ms=1.0, n_max=None):
    y = sosfilt(butter(4,[lo,hi],'bandpass',fs=SR,output='sos'), x)
    w = max(1,int(SR*glatt_ms/1000)); e = np.sqrt(np.convolve(y**2,np.ones(w)/w,'same'))
    P = int(round(T*SR)); i0 = int(round(t0*SR)); n = (len(e)-i0)//P
    if n_max: n = min(n, n_max)
    prof = e[i0:i0+n*P].reshape(n,P).mean(0)
    # rise window around the grid line: [-60 ms, +120 ms]
    idx = np.arange(-int(0.06*SR), int(0.12*SR)); pr = prof[idx % P]
    d = np.diff(pr); k = int(np.argmax(d)); return (idx[k]+1)/SR*1000, n
if __name__ == '__main__':
    p, t0, bpm = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]); a = float(sys.argv[4]) if len(sys.argv)>4 else None; b = float(sys.argv[5]) if len(sys.argv)>5 else None
    x = lies(p, a, b); T = 60/bpm
    off = (t0 - (a or 0))
    for lo,hi in [(2000,8000),(100,600),(40,120)]:
        ms, n = anstieg(x, off % T, T, lo, hi); print(f'{p.split("/")[-1][:40]:40} {lo}-{hi} Hz: steepest rise {ms:+7.2f} ms after the grid line ({n} beats)')
