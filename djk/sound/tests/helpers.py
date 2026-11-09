import numpy as np
SR = 48000

def sinus(f, db, sek=20.0, kanaele=2, phase=0.0):
    t = np.arange(int(SR * sek)) / SR
    x = (10 ** (db / 20)) * np.sin(2 * np.pi * f * t + phase)
    return np.stack([x] * kanaele, axis=1).astype(np.float32)
