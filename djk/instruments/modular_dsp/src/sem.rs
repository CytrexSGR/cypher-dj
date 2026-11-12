//! SEM-style 12 dB/oct state-variable filter with a continuous mode morph, low-pass -> notch -> high-pass, and a separate
//! band-pass output (the filter of the Oberheim SEM: smooth, wide, a resonance that sings but never self-oscillates).
//!
//! Core. The linear part is `svf::Stufe` (TPT / zero-delay feedback, f64, Zavalishin ch. 4), one stage = 12 dB/oct. It gives
//! low-pass `tp`, band-pass `v1` (peak gain 1/k) and high-pass `hp = x - k v1 - tp`, so `tp + hp = x - k v1` is an exact
//! notch (zero at the cutoff for every resonance).
//!
//! Morph. `form` 0..1 mixes the two outputs the way the SEM's mode knob does: 0 .. 0.5 `tp + t hp` with t = 2 form (low-pass
//! fades into the notch), 0.5 .. 1 `(1 - t) tp + hp` with t = 2 form - 1 (the notch fades into the high-pass). The mix is
//! linear in `form` and both parts are computed at all times, so the morph has no state of its own to jump. `form` runs
//! through a one-pole smoother (1 ms) so that a knob stepped at control rate becomes a short ramp, not a step in the
//! waveform; audio-rate modulation of `form` is therefore band-limited to about 160 Hz (stable and finite, but not a
//! wideband modulator). `cutoff` is read per sample unsmoothed: TPT stays stable for any g >= 0.
//!
//! Level. On a signal with equal energy per octave around the cutoff the three ends (low-pass, notch, high-pass) are
//! equally loud (the notch passes both sides in full), but the blends in between dip by up to 1.3 dB at form 0.25 and 0.75,
//! where the two parts partly cancel around the cutoff. The output gets the smooth gain `1 + AUSGLEICH sin^2(2 pi form)`:
//! 1 at 0, 0.5 and 1, raised by AUSGLEICH between them (value measured, tests/sem.rs `lautstaerke_ueber_die_fahrt`). What
//! stays: with resonance the notch lacks the peak, so it is quieter than the ends (about 3 dB at reso 0.6), and on signals
//! tilted around the cutoff (pink noise) the low-pass and high-pass ends differ by the tilt itself.
//!
//! Resonance and saturation. `reso` 0..1 maps to k = 1.5 .. 0.18 (Q 0.67 .. 5.6, geometric): the peak stops at about +15 dB
//! and the filter is a linear damped pole pair, so it cannot self-oscillate; the impulse response decays at every setting.
//! Saturation is gentle and in two places. (1) The input passes a tanh-like soft clipper with a ceiling of 2 (unity gain for
//! small signals, -0.6 dB at 0.5, -1.2 dB at 1). (2) In the loop the damping rises with the square of the band state of
//! the previous sample, `k_eff = k (1 + 0.05 v1^2)`: a cubic loss that costs nothing at low resonance (v1 is small) and
//! compresses the resonant peak when it grows large, which is what keeps the singing round instead of shrill. `v1` of the
//! last sample keeps the loop explicit; since `k_eff >= k > 0` every sample is a stable stage.
//!
//! Real time: no allocation, no lock; state `Sem` per voice; non-finite state or output resets it, like `svf.rs`.

use crate::svf::Stufe;

/// Damping at `reso` 0 and 1: Q 0.67 and Q 5.6.
pub const K_WEICH: f64 = 1.5;
pub const K_SCHARF: f64 = 0.18;
/// Weight of the cubic loss on the band state.
const KUBIK: f64 = 0.05;
/// Ceiling of the input clipper.
const DECKE: f64 = 2.0;
/// Time constant of the `form` smoother, seconds.
const FORM_ZEIT: f64 = 0.001;
/// Gain lift of the blends at form 0.25 and 0.75, fraction of unity.
pub const AUSGLEICH: f64 = 0.16;

#[derive(Clone, Copy)]
pub struct Sem {
    stufe: Stufe,
    /// band state of the last sample (the loop's amplitude detector)
    v1: f64,
    /// smoothed form
    z: f64,
    gestartet: bool,
    sr: f32,
    a: f64,
}

impl Default for Sem {
    fn default() -> Self { Sem { stufe: Stufe::default(), v1: 0.0, z: 0.0, gestartet: false, sr: 0.0, a: 1.0 } }
}

/// tanh-like soft clipper, unity slope at 0, +-`DECKE` beyond |x| = 3 DECKE. NaN stays NaN (caught by the caller).
#[inline]
fn weich(x: f64) -> f64 {
    let u = (x / DECKE).clamp(-3.0, 3.0);
    DECKE * u * (27.0 + u * u) / (27.0 + 9.0 * u * u)
}

/// Gain at `form`: 1 at 0, 0.5 and 1, `1 + AUSGLEICH` at 0.25 and 0.75.
#[inline]
pub fn pegel(form: f64) -> f64 {
    let s = (2.0 * std::f64::consts::PI * form).sin();
    1.0 + AUSGLEICH * s * s
}

/// Weights (low-pass, high-pass) of the morph at `form` (0..1).
#[inline]
pub fn mischung(form: f64) -> (f64, f64) {
    if form < 0.5 { (1.0, 2.0 * form) } else { (2.0 - 2.0 * form, 1.0) }
}

impl Sem {
    /// (aus, bp) for input `x`, cutoff in Hz, `reso` 0..1, `form` 0..1.
    #[inline]
    pub fn prozess(&mut self, x: f32, cutoff: f32, reso: f32, form: f32, sr: f32) -> (f32, f32) {
        if self.sr != sr {
            self.sr = sr;
            self.a = 1.0 - (-1.0 / (FORM_ZEIT * sr as f64)).exp();
        }
        let fc = (cutoff as f64).clamp(20.0, sr as f64 * 0.45);
        let g = (std::f64::consts::PI * fc / sr as f64).tan();
        let r = (reso as f64).clamp(0.0, 1.0);
        let k = K_WEICH * (K_SCHARF / K_WEICH).powf(r) * (1.0 + KUBIK * self.v1 * self.v1);
        let f = (form as f64).clamp(0.0, 1.0);
        if f.is_finite() {
            if self.gestartet { self.z += self.a * (f - self.z); } else { self.z = f; self.gestartet = true; }
        }
        let (tp, v1, hp) = self.stufe.prozess(weich(x as f64), g, k);
        let (wt, wh) = mischung(self.z);
        let aus = (wt * tp + wh * hp) * pegel(self.z);
        let bp = k * v1;
        if !(aus.is_finite() && bp.is_finite() && v1.is_finite()) {
            let (sr, a) = (self.sr, self.a);
            *self = Sem { sr, a, ..Sem::default() };
            return (0.0, 0.0);
        }
        self.v1 = v1;
        (aus as f32, bp as f32)
    }
}
