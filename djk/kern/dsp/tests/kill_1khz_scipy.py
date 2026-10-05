# Unabhängige Gegenrechnung (scipy, ohne C++, Scheibe 04 Task 4): Mitten-Kill des LR8-Isolators 246/2484 Hz bei 781,7 Hz und 1 kHz.
# LR8 = Butterworth 4. Ordnung zweimal; Aufbau wie 04 isolator.lib: tief = LP2484·LP246, hoch = HP2484·HP246.
import numpy as np
from scipy import signal
fs = 48000.0
def lr8(art, fc):
    sos = signal.butter(4, fc, art, fs=fs, output='sos')
    return np.vstack([sos, sos])
def H(sos, f):
    return signal.sosfreqz(sos, worN=[f], fs=fs)[1][0]
for f in (781.7, 1000.0):
    t = H(lr8('lowpass', 2484), f) * H(lr8('lowpass', 246), f)
    h = H(lr8('highpass', 2484), f) * H(lr8('highpass', 246), f)
    m = H(lr8('lowpass', 2484), f) * H(lr8('highpass', 246), f)
    print(f'{f:7.1f} Hz: Kill Mitte = {20*np.log10(abs(t + h)):8.3f} dB   neutral = {20*np.log10(abs(t + m + h)):+.6f} dB')
