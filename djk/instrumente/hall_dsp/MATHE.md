# Cypher Hall: Mathematics

Status 2026-10-11. Sources: Vickers et al., *Frequency Domain Artificial Reverberation using Spectral
Magnitude Decay* (copy in `~/messungen/2026-10-11-cypher-eq/vickers.pdf`); Roth et al. (ETH), *FDverb:
A Frequency-Domain Artificial Reverberator Plug-In*, arXiv:2608.27695 (27.08.2026); Roads, *Computer
Music Tutorial* ch. 33; Puckette, *Theory and Technique* (echo density ≥ 1000/s); Pirkle ch. 17/20
(RT60, phase vocoder, COLA).

## 1 Structure

    y = (1 − mix)·x + mix·( early·ER(x) + late·T(x) )

- **ER** (early reflections): thin FIR in the time domain, no block latency. E taps per channel, times
  distributed quadratically in [T_pre, T_pre + L_er] (density grows with time as in a room), weights
  ±10^(−3(t_i − T_pre)/T60_er), energy normalized to 1. Own random seed per channel (stereo).
- **T** (tail, Fahne): STFT reverb after Vickers/FDverb, starts delayed by T_pre + L_er/2 and fades
  in over the analysis window. Because the tail starts later than the STFT latency anyway,
  the plugin reports **no latency**; the dry path stays undelayed.

## 2 STFT

Frame N (512…8192), hop H = N/4, √Hann window (periodic) for analysis and synthesis.
√Hann·√Hann = Hann, Σ Hann at hop N/4 = 2 (COLA). Vickers: at R = N/4 the ripple of the
overlap-add is negligible compared with an exponential curve.

## 3 Decay per bin

Reverberation time T60(f) (seconds to −60 dB). Per hop the amplitude falls by g:

    20·log10(g_k) / (H/fs) = −60 / T60(f_k)   ⇒   g_k = 10^(−3H / (fs·T60(f_k)))

(Vickers equation for g(Ω_k); FDverb footnote 5 identical with β = 1 − g.)

T60(f) from three anchor values: decay at 1 kHz, low factor (at 150 Hz), high factor (at 8 kHz),
interpolated linearly in log2(f) between them, constant outside.

## 4 Accumulate energy instead of amplitude

Vickers accumulates magnitudes (Y = X + g·Y). With random phase, however, reflections add
**incoherently**, that is, in power. Therefore here

    P_k(u) = g_k² · P_k(u−1) + |X_k(u)|²
    M_k(u) = √( (1 − g_k²) · P_k(u) )

For an impulse, Σ_u M_k(u)² = Σ_u |X_k(u)|²: the tail carries exactly the energy fed in,
independent of T60. The loudness therefore depends on the control "Level", not on the length.

## 5 Phase: coherence versus diffusion

Vickers 6.3 (Partial Phase Randomization): φ_s = φ + V·θ, θ ~ U[−π, π], V ∈ [0, 1].
Phase propagation needs a frequency per bin which, according to Vickers 5.1.3, should come from
the history, "weighted by magnitude and recency, at the pace of the decay". A complex accumulator
with the SAME feedback as the energy does this:

    Δ_in,k(u) = princarg( ∠X_k(u) − ∠X_k(u−1) )
    C_k(u)    = g_k² · C_k(u−1) + |X_k(u)|² · e^{jΔ_in,k(u)}
    φ_k(u)    = φ_k(u−1) + ∠C_k(u) + V · π · r,   r ~ U[−1, 1]

V = 0: tonal, "frozen" reverb (Vickers 3.1, sounds periodic with impulses);
V = 1: full diffusion (FDverb, noise carrier). Parameter "Diffusion".

## 6 Stereo

Two tails with independent random sequences (L from x_L, R from x_R). Width w via M/S:
M = (t_L + t_R)/2, S = (t_L − t_R)/2, output L = M + w·S, R = M − w·S.

## 7 Ducking per frequency (Cypher-specific)

The reverb clears the bins that the dry signal currently occupies (Wiener form):

    D_k: envelope of |X_k|² of the UNDELAYED dry signal (own analysis, rise immediately,
         fall 80 ms in amplitude = 40 ms in power)
    d_k = √( M_k² / (M_k² + a · D_k) ),   a = 30 · duck²

duck = 0 ⇒ d_k = 1. Where the dry signal dominates, the reverb recedes, otherwise it stays.

## 8 Freeze, Kill

Freeze: g_k = 1 and no feed-in (P stays where it is, phase keeps running).
Kill: P = C = 0.

## 9 Measured quantities (acceptance)

- **T60 per band**: backward integration after Schroeder, EDC(t) = ∫_t^∞ h²(τ) dτ, straight line
  through −5 … −35 dB (T30), ×2.
- **Echo density**: normalized echo density profile after Abel & Huang (WASPAA 2006, from memory,
  not re-checked online): share of samples in the 20 ms window that lie above the local standard
  deviation, divided by erfc(1/√2) ≈ 0.3173. Gaussian noise ⇒ 1. The measure is calibrated in the
  test itself against noise (≈ 1) and a sparse impulse train (≪ 1).
- **Energy**: impulse in ⇒ tail energy = Level (±0.5 dB).
