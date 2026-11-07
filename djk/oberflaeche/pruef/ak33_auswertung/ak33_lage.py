# AK33 M3 evaluation: position of hits relative to the project grid in an export (starts on a project beat), foot method.
# Band-pass, 1 ms RMS envelope, peaks above REL of the global maximum, foot = last sample before the peak below FOOT of the peak (max 60 ms back).
# phase = foot time modulo the beat period; reported as median of the wrapped phase in ms (positive = hit AFTER the grid line).
# The instrument has a constant offset (filter delay + foot threshold); it cancels when the SAME layer is compared with its own source file
# (--quelle) or two exports of the same material are compared.
import sys, json, subprocess, numpy as np
from scipy.signal import butter, sosfilt, find_peaks
SR = 48000
BANDEN = {'low': (30, 150), 'mid': (300, 3000), 'high': (5000, 16000)}
def lies(p, sr=SR):
    raw = subprocess.run(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(sr),'-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(raw,np.float32).astype(np.float64)
def fuesse(x, band, rel=0.5, foot=0.15, abstand=0.12, t_end=None, cap=0.2):
    lo, hi = BANDEN[band]
    y = sosfilt(butter(4,[lo,hi],'bandpass',fs=SR,output='sos'), x)
    w = int(SR*0.001); e = np.sqrt(np.convolve(y**2,np.ones(w)/w,'same'))
    if t_end: e = e[:int(t_end*SR)]
    pk, _ = find_peaks(e, height=rel*e.max(), distance=int(abstand*SR))
    out = []
    for i in pk:
        j = i
        while j > 0 and i - j < cap*SR and e[j] > foot*e[i]: j -= 1
        out.append(j / SR)
    return np.array(out), e
def phase_ms(t, T):
    ph = np.mod(t, T); ph = np.where(ph > T/2, ph - T, ph)     # wrap to +-T/2
    return ph*1000
def bericht(name, p, band, bpm, rel=0.5, t_end=None):
    x = lies(p); T = 60.0/bpm
    t, e = fuesse(x, band, rel=rel, t_end=t_end)
    ph = phase_ms(t, T)
    if len(ph) == 0: return dict(name=name, band=band, n=0)
    return dict(name=name, band=band, bpm=bpm, n=int(len(ph)), median_ms=round(float(np.median(ph)),2), p10_ms=round(float(np.percentile(ph,10)),2), p90_ms=round(float(np.percentile(ph,90)),2),
                spread_ms=round(float(ph.max()-ph.min()),2), rms_db=round(float(20*np.log10(np.sqrt(np.mean(x**2))+1e-12)),1))
if __name__ == '__main__':
    # usage: ak33_lage.py <file>@<bpm>@<band>[@rel] ...
    for a in sys.argv[1:]:
        f = a.split('@'); r = bericht(f[0].split('/')[-1], f[0], f[2], float(f[1]), float(f[3]) if len(f)>3 else 0.5)
        print(json.dumps(r))

def falte(x, T, band='low'):
    """Envelope (1 ms RMS of the band) folded modulo T over all full periods: profile at 1 ms (array of len T*1000)."""
    lo, hi = BANDEN[band]
    y = sosfilt(butter(4,[lo,hi],'bandpass',fs=SR,output='sos'), x)
    w = int(SR*0.001); e = np.sqrt(np.convolve(y**2,np.ones(w)/w,'same'))
    P = int(round(T*SR)); n = len(e)//P
    prof = e[:n*P].reshape(n, P).mean(0)
    return prof
def profil_kennzahlen(prof, foot=0.15):
    P = len(prof); i = int(np.argmax(prof)); pk = prof[i]
    j = i
    while prof[(j-1) % P] > foot*pk and (i-j) % P < 0.2*SR: j = (j-1) % P
    # centroid of the part above 50 % of the peak around the peak
    return dict(peak_ms=round(i/SR*1000,2), foot_ms=round(j/SR*1000,2), peak_rel_db=round(20*np.log10(pk+1e-12),1))
def lag_ms(a, b):
    """circular lag (ms) by which profile b is later than profile a (maximum of the circular cross-correlation), plus normalised peak value"""
    A = np.fft.rfft(a-a.mean()); B = np.fft.rfft(b-b.mean())
    c = np.fft.irfft(np.conj(A)*B, len(a)); k = int(np.argmax(c)); P = len(a)
    if k > P//2: k -= P
    return k/SR*1000, float(c.max()/np.sqrt(np.sum((a-a.mean())**2)*np.sum((b-b.mean())**2)))

def anstieg(x, T, lo, hi, glatt_ms=2.0):
    """Folded envelope of band [lo,hi] (1 ms-ish RMS), position (ms after the grid line) of the steepest rise per beat period, and the rise's size relative to the peak."""
    y = sosfilt(butter(4,[lo,hi],'bandpass',fs=SR,output='sos'), x)
    w = max(1,int(SR*glatt_ms/1000)); e = np.sqrt(np.convolve(y**2,np.ones(w)/w,'same'))
    P = int(round(T*SR)); n = len(e)//P
    prof = e[:n*P].reshape(n, P).mean(0)
    d = np.diff(np.concatenate([prof[-1:], prof]))
    # only rises in the first 40 % of the beat and the last 10 % (a kick may sit slightly before the grid line)
    i = int(np.argmax(d))
    return i/SR*1000 if i < P/2 else (i-P)/SR*1000, float(d[i]/ (prof.max()+1e-12))
