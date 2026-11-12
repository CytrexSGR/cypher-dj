//! Kamm (type 38, `kamm`): tuned feedback comb filter, per voice.
//!
//! **Loop.** `w[n] = x[n] + fb * L(y[n - 1])`, `y[n] = w[n - d]`, output `w[n]` (crossfaded with the dry `x` by `mix`).
//! The delay line is `leitung::Leitung` (reused, not rewritten: it clamps every written value to +-4, flushes
//! non-finite values and denormals to 0 and reads with cubic Lagrange interpolation, `chorus::lagrange4`). `L` is a
//! one-pole low-pass (`daempf`). The loop delay is `T = d + 1 + pd`, the `1` being the sample between `y` and `w`
//! and `pd` the low-pass's phase delay at the tuning frequency.
//!
//! **Interpolation.** Cubic Lagrange, not an all-pass: the delay changes at audio rate (`hz` from a note, an LFO, a
//! glide), and a first-order all-pass keeps a state that rings and clicks when its coefficient moves, while Lagrange is
//! a plain FIR on the stored samples and follows any delay without a transient. Its price is a gain slightly below 1
//! and a phase-delay error that grows with frequency; both are handled: gain <= 1 keeps the loop stable, and the phase
//! error is computed at the tuning frequency and subtracted from the delay (`lagrange_fehler`, two fixed-point steps),
//! so the pitch stays exact at the top of the range too.
//!
//! **Tuning.** `fb >= 0`: peaks at `hz, 2 hz, 3 hz ...` (T = sr / hz). `fb < 0`: the loop inverts, a delay of T would put
//! the peaks at `hz/2 * (1, 3, 5, ...)`, an octave below the played note, so the delay is halved (T = sr / (2 hz)):
//! peaks at `hz, 3 hz, 5 hz ...`, the hollow odd-harmonic colour at the played pitch. Range 20 Hz ..= sr / 5 for
//! negative feedback (8.8 kHz at 44.1 kHz), up to 0.4 sr for positive; the translation needs sr >= 44.1 kHz. Delay
//! memory is allocated in `neu` for 20 Hz.
//!
//! **Moving `hz`.** The delay target is read every sample, then smoothed by a one-pole of 2 ms (a jump in `hz` becomes a
//! glide, no discontinuity in the line). Audio-rate `hz` therefore acts as vibrato up to about 300 Hz. The damping
//! pole, the low-pass phase delay and the Lagrange correction are recomputed every 8 samples.
//!
//! **Level.** The output `w` is scaled by `sqrt(1 - fb^2)`: unit power for white noise at any feedback. A tone on a
//! peak is amplified by `sqrt((1 + |fb|) / (1 - |fb|))` (23 dB at 0.99); the loop saturates at +-4 (`GRENZE`).
//! **Damping** `daempf` 0..1: cutoff `fc = hz * 2^(1 + 5 (1 - daempf))` (relative to the pitch, so the timbre is the
//! same on every note): 0 is 64 times the tuning frequency, 1 is two times; from 0.45 sr up the low-pass is left out.
//! The low-pass leaves the loop's phase at the tuning frequency exact (compensated) but tilts the magnitude, so with
//! strong damping the harmonics above the first sit a little off the grid and the magnitude peak of the first lies a few
//! cent low (measured in tests/kamm.rs).
//!
//! **Real time.** No allocation, lock or panic in `prozess`; non-finite inputs fall back (hz keeps the last value, fb,
//! daempf, mix 0), a non-finite output resets the voice like `svf.rs`.
use crate::leitung::{Leitung, GRENZE};

/// lowest tuning in Hz (buffer size)
pub const MIN_HZ: f64 = 20.0;
/// highest tuning as a fraction of the sample rate for fb < 0 (loop delay of half a period >= 2.5 samples); twice that for fb >= 0
pub const MAX_HZ_ANTEIL: f64 = 0.2;
/// largest |feedback|
pub const FB_MAX: f32 = 0.995;
/// time constant of the delay smoother in seconds
const GLATT_S: f64 = 0.002;
const SCHRITT: u32 = 8;

pub struct Kamm {
    l: Leitung,
    sr: f64,
    /// low-pass in the feedback path
    tp: f64,
    /// smoothed delay of the line in samples
    zeit: f64,
    erst: bool,
    zaehler: u32,
    /// low-pass coefficient
    k: f64,
    /// correction in samples (low-pass phase delay plus Lagrange error), recomputed every SCHRITT samples
    korr: f64,
    hz: f64,
    k_glatt: f64,
}

/// phase delay of the low-pass `y += k (x - y)` at `w` rad/sample, in samples
pub fn tiefpass_verzug(k: f64, w: f64) -> f64 {
    ((1.0 - k) * w.sin()).atan2(1.0 - (1.0 - k) * w.cos()) / w
}

/// phase delay of `chorus::lagrange4` at delay `v` (samples) minus `v`, at `w` rad/sample (deviation from the target).
/// Positive: the interpolation delays too much.
pub fn lagrange_fehler(v: f64, w: f64) -> f64 {
    let d = v - v.floor() + 1.0;
    let g = [-(d - 1.0) * (d - 2.0) * (d - 3.0) / 6.0, d * (d - 2.0) * (d - 3.0) / 2.0, -d * (d - 1.0) * (d - 3.0) / 2.0, d * (d - 1.0) * (d - 2.0) / 6.0];
    // weight g[k] sits (floor - 1 + k) samples back; the integer part adds nothing to the error
    let (mut re, mut im) = (0.0, 0.0);
    for (k, g) in g.iter().enumerate() {
        let t = w * (k as f64 - 1.0);
        re += g * t.cos();
        im -= g * t.sin();
    }
    -im.atan2(re) / w - (v - v.floor())
}

impl Kamm {
    pub fn neu(sr: f32) -> Self {
        let sr = sr as f64;
        let max = (sr / MIN_HZ).ceil() as usize + 4;
        Kamm { l: Leitung::neu(max), sr, tp: 0.0, zeit: 0.0, erst: true, zaehler: 0, k: 1.0, korr: 0.0, hz: 440.0,
               k_glatt: 1.0 - (-1.0 / (GLATT_S * sr)).exp() }
    }

    pub fn zuruecksetzen(&mut self) {
        self.l.zuruecksetzen();
        self.tp = 0.0;
        self.zeit = 0.0;
        self.erst = true;
        self.zaehler = 0;
        self.k = 1.0;
        self.korr = 0.0;
        self.hz = 440.0;
    }

    /// One sample. `hz` tuning, `fb` -1..1, `daempf` 0..1, `mix` 0..1.
    #[inline]
    pub fn prozess(&mut self, x: f32, hz: f32, fb: f32, daempf: f32, mix: f32) -> f32 {
        let fb = if fb.is_nan() { 0.0 } else { fb.clamp(-FB_MAX, FB_MAX) };
        let neg = fb < 0.0;
        let daempf = if daempf.is_nan() { 0.0 } else { daempf.clamp(0.0, 1.0) as f64 };
        let mix = if mix.is_nan() { 0.0 } else { mix.clamp(0.0, 1.0) };
        if hz.is_finite() {
            self.hz = (hz as f64).clamp(MIN_HZ, self.sr * MAX_HZ_ANTEIL * if neg { 1.0 } else { 2.0 });
        }
        // loop length in samples
        let t = self.sr / self.hz * if neg { 0.5 } else { 1.0 };
        if self.zaehler == 0 {
            let w = 2.0 * std::f64::consts::PI * self.hz / self.sr;
            let fc = self.hz * (1.0 + 5.0 * (1.0 - daempf)).exp2();
            // a cutoff at or above 0.45 sr is no damping at all: the low-pass drops out (k = 1, no loss, no delay)
            self.k = if fc >= 0.45 * self.sr { 1.0 } else { 1.0 - (-2.0 * std::f64::consts::PI * fc / self.sr).exp() };
            let d = (t - 1.0 - tiefpass_verzug(self.k, w)).max(1.0);
            let mut v = d;
            for _ in 0..2 {
                v = (d - lagrange_fehler(v, w)).max(1.0);
            }
            self.korr = v - (t - 1.0);
        }
        self.zaehler = (self.zaehler + 1) % SCHRITT;
        let ziel = (t - 1.0 + self.korr).max(1.0);
        if self.erst {
            self.zeit = ziel;
            self.erst = false;
        } else {
            self.zeit += self.k_glatt * (ziel - self.zeit);
        }
        let x = if x.is_finite() { x } else { 0.0 };
        let w = (x + fb * self.tp as f32).clamp(-GRENZE, GRENZE);
        // y[n-1] feeds w[n]: the low-pass gets y only now, which is the one sample of loop length
        let y = self.l.prozess(w, self.zeit);
        self.tp += self.k * (y as f64 - self.tp);
        if self.tp.abs() < 1e-30 {
            self.tp = 0.0;
        }
        let nass = w * (1.0 - fb * fb).sqrt();
        let aus = x + mix * (nass - x);
        if !(aus.is_finite() && self.tp.is_finite()) {
            self.zuruecksetzen();
            return 0.0;
        }
        aus
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nan_eingaenge_bleiben_endlich() {
        let mut k = Kamm::neu(48_000.0);
        let (n, inf) = (f32::NAN, f32::INFINITY);
        for i in 0..4000 {
            let (x, hz, fb, d, m) = match i % 4 { 0 => (n, n, n, n, n), 1 => (inf, inf, inf, inf, inf), 2 => (1.0, 440.0, 0.9, 0.3, 1.0), _ => (-inf, -inf, -inf, -inf, -inf) };
            assert!(k.prozess(x, hz, fb, d, m).is_finite(), "sample {i}");
        }
    }

    #[test]
    fn lagrange_fehler_klein_bei_tiefen_frequenzen() {
        for v in [10.0, 10.25, 10.5, 10.75] {
            assert!(lagrange_fehler(v, 0.05).abs() < 1e-4, "{v}");
        }
        // integer delay: exact
        assert!(lagrange_fehler(7.0, 1.0).abs() < 1e-12);
    }
}
